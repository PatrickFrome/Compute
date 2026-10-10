import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import postgres from 'postgres';
import { verifyOfflineRuntimeBundle } from './offline-runtime-bundle.mjs';
import { schemaOnlyRestorePlan } from './test/isolated-goal-fixture.mjs';

const exec = promisify(execFile);
const bundleDirectory = process.env.LOCAL_STATE_TEST_ATTACHED_BUNDLE_DIRECTORY;
const expectedBundleDigest = process.env.LOCAL_STATE_TEST_ATTACHED_BUNDLE_SHA256;
const dump = process.env.LOCAL_STATE_TEST_ATTACHED_SCHEMA_DUMP;
const expectedDumpSha256 = process.env.LOCAL_STATE_TEST_ATTACHED_SCHEMA_DUMP_SHA256;
const installedOwnerInputs = {
  installRoot: process.env.LOCAL_STATE_TEST_ATTACHED_INSTALL_ROOT,
  sourceHead: process.env.LOCAL_STATE_TEST_ATTACHED_INSTALL_SOURCE_HEAD,
  version: process.env.LOCAL_STATE_TEST_ATTACHED_INSTALL_VERSION,
  evidenceDirectory: process.env.LOCAL_STATE_TEST_ATTACHED_INSTALL_EVIDENCE_DIRECTORY,
};
const installedOwnerSelected = Object.values(installedOwnerInputs).some(Boolean);
// The archive is the explicit opt-in. A public bundle-only CI run must not
// require private schema fixtures simply because it supplies bundle pins.
const enabled = Boolean(dump || expectedDumpSha256 || installedOwnerSelected);
const fail = code => { throw new Error('attached_bundle_fixture_' + code); };
const ROLE_NAMES = ['anon', 'authenticated', 'authenticator', 'cli_login_postgres', 'cli_login_supabase_read_only_user',
  'dashboard_user', 'pgbouncer', 'postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin', 'supabase_etl_admin',
  'supabase_privileged_role', 'supabase_read_only_user', 'supabase_realtime_admin', 'supabase_replication_admin', 'supabase_storage_admin'];

function privateEnvironment(extra = {}) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^(?:PG|DENO_|SUPABASE_|LOCAL_STATE_|COMPUTE_RUNTIME_)/i.test(name)
    || /^(?:NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|ELECTRON_RUN_AS_NODE|GH_TOKEN|GITHUB_TOKEN|GITHUB_PAT|NPM_TOKEN|NODE_AUTH_TOKEN)$/i.test(name)) delete env[name];
  return { ...env, ...extra };
}

async function privateExec(executable, args, env, stage) {
  assert(['initdb', 'archive_toc', 'schema_restore'].includes(stage));
  try {
    return await exec(executable, args, { env, windowsHide: true, shell: false, timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
  } catch { fail(stage + '_private_tool_failed'); }
}

async function fileDigest(file) {
  const before = await fs.lstat(file);
  assert(before.isFile() && !before.isSymbolicLink() && before.nlink === 1);
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  const after = await fs.lstat(file);
  assert.equal(before.ino, after.ino);
  assert.equal(before.size, after.size);
  assert.equal(before.mtimeMs, after.mtimeMs);
  return hash.digest('hex');
}

async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  assert(port > 1023 && port <= 65535);
  return port;
}

async function assertPortClosed(port) {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('attached_bundle_fixture_port_probe_timeout')); }, 2000);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); reject(new Error('attached_bundle_fixture_port_still_open')); });
    socket.once('error', error => {
      clearTimeout(timer); socket.destroy();
      error.code === 'ECONNREFUSED' ? resolve() : reject(new Error('attached_bundle_fixture_port_probe_failed'));
    });
  });
}

function spawnBundled(verified, args, extra = {}, ipc = false, timeoutMs = 180000) {
  const child = spawn(verified.paths.nodeExecutable, args, { env: privateEnvironment(extra), windowsHide: true,
    shell: false, ...(ipc ? {} : { timeout: timeoutMs }),
    stdio: ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let oversized = false;
  const append = bytes => {
    if (output.length + bytes.length > 65536) oversized = true;
    else output += bytes.toString('utf8');
  };
  child.stdout.on('data', append); child.stderr.on('data', append);
  const closed = new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error('attached_bundle_fixture_bundled_process_failed')));
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  closed.catch(() => {});
  const ready = ipc ? new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('attached_bundle_fixture_host_ready_timeout')), 150000);
    child.once('message', descriptor => { clearTimeout(timer); resolve(descriptor); });
    child.once('error', () => { clearTimeout(timer); reject(new Error('attached_bundle_fixture_host_failed')); });
    child.once('close', () => { clearTimeout(timer); reject(new Error('attached_bundle_fixture_host_ended_before_ready')); });
  }) : null;
  ready?.catch(() => {});
  return { child, closed, ready, output: () => { assert.equal(oversized, false); return output; } };
}

async function stopHost(host) {
  if (host.child.exitCode !== null || host.child.signalCode !== null) return host.closed;
  assert.equal(host.child.connected, true);
  host.child.send({ schema: 'compute.runtime-host-control.v1', command: 'stop' });
  let timer;
  try {
    return await Promise.race([host.closed, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('attached_bundle_fixture_host_stop_timeout')), 30000);
    })]);
  } finally { clearTimeout(timer); }
}

test('verified bundled onboarding and attached host restart preserve an existing SCRAM PG17 incarnation', {
  skip: !enabled, timeout: installedOwnerSelected ? 1800000 : 900000,
}, async t => {
  assert.equal(process.platform, 'win32');
  assert(bundleDirectory && dump && path.isAbsolute(bundleDirectory) && path.isAbsolute(dump), 'explicit absolute fixture inputs required');
  assert.match(expectedBundleDigest || '', /^[a-f0-9]{64}$/);
  assert.match(expectedDumpSha256 || '', /^[a-f0-9]{64}$/);
  assert.equal(await fileDigest(dump), expectedDumpSha256);
  const verified = await verifyOfflineRuntimeBundle({ bundleDirectory, expectedBundleDigest });
  t.diagnostic('verified pinned schema archive and complete offline runtime bundle');
  if (installedOwnerSelected) {
    assert(Object.values(installedOwnerInputs).every(Boolean), 'all installed Owner qualification pins required');
    for (const name of ['installRoot', 'evidenceDirectory']) assert(path.isAbsolute(installedOwnerInputs[name]));
    assert.match(installedOwnerInputs.sourceHead, /^[a-f0-9]{40}$/);
    assert.match(installedOwnerInputs.version, /^[a-zA-Z0-9.+-]{1,128}$/);
    assert.equal((await fs.realpath(path.join(installedOwnerInputs.installRoot, 'resources/client-state-runtime'))).toLowerCase(),
      (await fs.realpath(bundleDirectory)).toLowerCase(), 'qualify the exact installed bundle from onboarding through Owner UI');
    const evidence = await fs.lstat(installedOwnerInputs.evidenceDirectory);
    assert(evidence.isDirectory() && !evidence.isSymbolicLink());
  }
  const bundledModule = name => import(pathToFileURL(path.join(verified.paths.sourceRoot, 'infra/client-state-runtime', name)).href);
  const { loadLocalRuntimeMigrationPlan } = await bundledModule('local-runtime-migrations.mjs');
  const { secureAttachedPrivateFile, inspectAttachedApiAdmission } = await bundledModule('attached-postgres-onboarding.mjs');
  const { initializeLocalVaultKey } = await bundledModule('local-vault-key.mjs');
  const { startOwnedWindowsPostgres } = await bundledModule('owned-postgres-process.mjs');
  const plan = await loadLocalRuntimeMigrationPlan();
  const bin = verified.paths.postgresBinDirectory;
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'compute-attached-bundle-')));
  const marker = randomUUID(), markerFile = path.join(root, 'synthetic-test-owner.marker');
  await fs.writeFile(markerFile, marker, { flag: 'wx', mode: 0o600 });
  const data = path.join(root, 'pgdata'), state = path.join(root, 'runtime-state');
  await fs.mkdir(state);
  const owner = 'attached_bundle_fixture_owner', login = 'attached_bundle_fixture_api';
  const ownerPassword = randomBytes(32).toString('hex'), apiPassword = randomBytes(32).toString('hex');
  const passwordFile = path.join(root, 'initdb-password.txt');
  await fs.writeFile(passwordFile, '', { flag: 'wx', mode: 0o600 });
  await secureAttachedPrivateFile(passwordFile);
  await fs.writeFile(passwordFile, ownerPassword + '\n');
  const ports = [];
  while (ports.length < 3) { const port = await freePort(); if (!ports.includes(port)) ports.push(port); }
  const [port, apiPort, edgePort] = ports;
  const env = privateEnvironment({ PGHOST: '127.0.0.1', PGPORT: String(port), PGUSER: owner,
    PGPASSWORD: ownerPassword, PGDATABASE: 'postgres', PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '3' });
  const sql = postgres({ host: '127.0.0.1', port, database: 'postgres', username: owner, password: ownerPassword,
    max: 1, prepare: false, connect_timeout: 3, onnotice: () => {} });
  let owned;
  let direct;
  let cleanupUnconfirmed = false;
  const hosts = [];
  t.after(async () => {
    // Any inability to prove cleanup preserves the fixture for explicit review.
    const cleanupResults = [];
    for (const host of hosts) {
      try { await stopHost(host); }
      catch { cleanupResults.push(false); }
    }
    for (const connection of [direct, sql]) {
      try { await connection?.end({ timeout: 3 }); }
      catch { cleanupResults.push(false); }
    }
    // An interrupted installed qualification might still own UI/runtime
    // processes. Preserve its private synthetic state and external postmaster
    // for explicit review instead of inferring cleanup from the parent exit.
    if (cleanupUnconfirmed) return;
    try {
      if (owned) {
        assert.equal((await owned.stop()).cleanup_confirmed, true);
        assert.equal(await owned.isAlive(), false);
        await assertPortClosed(port);
      }
      await assertPortClosed(apiPort); await assertPortClosed(edgePort);
    } catch { cleanupResults.push(false); }
    assert.equal(cleanupResults.includes(false), false, 'fixture cleanup must be confirmed before deletion');
    assert.equal(await fs.readFile(markerFile, 'utf8'), marker);
    assert.equal(path.dirname(await fs.realpath(root)).toLowerCase(), (await fs.realpath(os.tmpdir())).toLowerCase());
    assert(path.basename(root).startsWith('compute-attached-bundle-'));
    await fs.rm(root, { recursive: true, force: false });
  });
  await privateExec(path.join(bin, 'initdb.exe'), ['-D', data, '--username=' + owner,
    '--auth=scram-sha-256', '--pwfile=' + passwordFile, '--no-locale', '-E', 'UTF8'], env, 'initdb');
  await fs.unlink(passwordFile);
  try { owned = await startOwnedWindowsPostgres({ pgBinDir: bin, pgDataDir: data, databasePort: port, env, startupTimeoutMs: 120000 }); }
  catch (error) { cleanupUnconfirmed = error.code === 'runtime_cleanup_unconfirmed'; throw error; }
  for (const role of ROLE_NAMES) await sql.unsafe('CREATE ROLE "' + role + '" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION ' + (role === 'service_role' ? 'BYPASSRLS' : 'NOBYPASSRLS'));
  await sql.unsafe('CREATE SCHEMA extensions; CREATE SCHEMA vault; CREATE EXTENSION pgcrypto WITH SCHEMA extensions');
  await initializeLocalVaultKey({ dataDirectory: data });
  const { stdout: toc } = await privateExec(path.join(bin, 'pg_restore.exe'), ['--list', dump], env, 'archive_toc');
  if (!/ FUNCTION vault _local_key\(/.test(toc)) await sql.unsafe(await fs.readFile(path.join(verified.paths.sourceRoot, 'infra/client-state-runtime/local-vault-compat.sql'), 'utf8'));
  const restorePlan = schemaOnlyRestorePlan(toc);
  const tocPath = path.join(root, 'schema-only.list');
  await fs.writeFile(tocPath, restorePlan.selected.join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  await privateExec(path.join(bin, 'pg_restore.exe'), ['--schema-only', '--no-owner', '--exit-on-error', '--single-transaction',
    '--host=127.0.0.1', '--port=' + port, '--username=' + owner, '--dbname=postgres', '--use-list=' + tocPath, dump], env, 'schema_restore');
  const tables = await sql.unsafe("SELECT n.nspname,c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'");
  for (const table of tables) {
    const rows = await sql.unsafe('SELECT count(*)::int AS count FROM "' + table.nspname.replaceAll('"', '""') + '"."' + table.relname.replaceAll('"', '""') + '"');
    assert.equal(rows[0].count, 0, 'only empty schema was restored');
  }
  t.diagnostic('restored empty schema into an owned disposable SCRAM PostgreSQL 17 cluster');
  const [cluster] = await sql.unsafe(`SELECT system_identifier::text AS id,
    to_char(pg_postmaster_start_time() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS started
    FROM pg_catalog.pg_control_system()`);
  const vaultDigest = await fileDigest(path.join(data, 'client-vault.key'));
  const pidBytes = await fs.readFile(path.join(data, 'postmaster.pid'));
  const configFile = path.join(state, 'attached-runtime.json'), optionsFile = path.join(root, 'onboarding-options.json');
  const options = { ownerAction: 'ONBOARD_EXISTING_LOCAL_POSTGRES_17', bundleDirectory, stateDirectory: state,
    pgDataDirectory: data, runtimeConfigFile: configFile, expectedBundleDigest,
    expectedMigrationSourcesSha256: plan.source_manifest_sha256, expectedClusterSystemIdentifier: cluster.id,
    expectedPostmasterStartedAt: cluster.started, adminDatabaseUrl: `postgres://${owner}:${ownerPassword}@127.0.0.1:${port}/postgres`,
    apiLogin: login, apiPassword, apiPort, edgePort, startupTimeoutMs: 120000 };
  await fs.writeFile(optionsFile, '', { flag: 'wx', mode: 0o600 });
  await secureAttachedPrivateFile(optionsFile);
  const runOnboarding = async selected => {
    await fs.writeFile(optionsFile, JSON.stringify(selected));
    const cli = spawnBundled(verified, [verified.paths.attachedOnboardingEntry, '--options-file', optionsFile]);
    const closed = await cli.closed;
    const output = cli.output();
    for (const secret of [ownerPassword, apiPassword, options.adminDatabaseUrl]) assert.equal(output.includes(secret), false);
    return { closed, receipt: JSON.parse(output.trim()) };
  };
  const rejected = await runOnboarding({ ...options, expectedClusterSystemIdentifier: cluster.id === '1' ? '2' : '1' });
  assert.deepEqual(rejected.closed, { code: 1, signal: null });
  assert.equal(rejected.receipt.code, 'attached_onboarding_live_cluster_binding_unattested');
  assert.equal((await sql.unsafe('SELECT count(*)::int AS count FROM pg_catalog.pg_roles WHERE rolname=$1', [login]))[0].count, 0);
  await assert.rejects(fs.lstat(configFile), { code: 'ENOENT' });
  await assert.rejects(fs.lstat(path.join(state, 'runtime-host-lock.json')), { code: 'ENOENT' });
  t.diagnostic('wrong live cluster binding rejected before API role and private config publication');
  const setup = await runOnboarding(options);
  assert.deepEqual(setup.closed, { code: 0, signal: null });
  assert.equal(setup.receipt.state, 'CONFIGURED_UNQUALIFIED');
  assert.equal(setup.receipt.source_manifest_sha256, plan.source_manifest_sha256);
  assert.equal(setup.receipt.restricted_api_admission.rpc_names_granted, 50);
  assert.equal(setup.receipt.postgres_started, false);
  assert.equal(setup.receipt.postgres_stopped, false);
  await fs.unlink(optionsFile);
  const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
  assert.equal(config.postgres_mode, 'attached');
  assert.equal(config.api_role_mode, 'direct');
  assert.equal(config.expected_cluster_system_identifier, cluster.id);
  direct = postgres({ host: '127.0.0.1', port, database: 'postgres', username: login, password: apiPassword,
    max: 1, prepare: false, connect_timeout: 3, onnotice: () => {} });
  const admission = await inspectAttachedApiAdmission({ sql: direct, apiLogin: login });
  assert.equal(admission.restricted_login, true);
  assert.equal(admission.rpc_names_granted, 50);
  await assert.rejects(direct.unsafe('SET ROLE service_role'), error => error.code === '42501');
  await direct.end({ timeout: 3 }); direct = null;
  t.diagnostic('real bundled onboarding configured all 50 RPC names and admitted the SCRAM direct API role');
  const instances = [], childPids = [];
  const statusFile = path.join(state, 'runtime-instance.json');
  for (let run = 0; run < 2; run += 1) {
    const host = spawnBundled(verified, [verified.paths.hostEntry], { COMPUTE_RUNTIME_HOST_CONFIG: configFile }, true);
    hosts.push(host);
    let descriptor;
    try { descriptor = await host.ready; }
    catch (error) {
      // Host output is private even on a failed assertion. Admit only the fixed
      // failure receipt category and sanitized status reason, never raw output.
      let reason = 'runtime_host_failure_receipt_unavailable';
      for (const line of host.output().split(/\r?\n/)) {
        let receipt;
        try { receipt = JSON.parse(line); } catch { continue; }
        if (receipt.schema === 'compute.runtime-host-failure.v1' && receipt.state === 'FAILED'
          && receipt.credentials_included === false && /^[a-z0-9_]{1,160}$/.test(receipt.reason || '')) reason = receipt.reason;
      }
      if (reason === 'runtime_host_failure_receipt_unavailable') {
        const status = await fs.readFile(statusFile, 'utf8').then(JSON.parse).catch(() => null);
        if (status?.schema === 'metaengine.client-state.runtime-status.v1' && status.state === 'FAILED'
          && /^[a-z0-9_]{1,160}$/.test(status.reason || '')) reason = status.reason;
      }
      t.diagnostic('bundled attached host startup failure reason: ' + reason);
      throw error;
    }
    assert.equal(descriptor.runtime_ready, true);
    assert.equal(descriptor.automatic_cloud_fallback, false);
    assert.equal(descriptor.endpoint, `http://127.0.0.1:${edgePort}/a2-browser-native-supervisor-v1`);
    const status = JSON.parse(await fs.readFile(statusFile, 'utf8'));
    assert.equal(status.state, 'READY');
    assert.equal(status.postgres_mode, 'attached');
    assert.equal(status.api_role_mode, 'direct');
    assert.equal(status.capability_health.state, 'ATTESTED');
    assert.equal(status.bundle_sha256, expectedBundleDigest);
    assert.deepEqual(status.children.map(child => child.name), ['api', 'edge']);
    for (const child of status.children) assert.notEqual(child.pid, owned.pid);
    instances.push(descriptor.instance_id); childPids.push(status.children.map(child => child.pid));
    const health = await fetch(descriptor.endpoint + '/health', { signal: AbortSignal.timeout(5000) });
    assert.equal(health.status, 200);
    const body = await health.json();
    assert.equal(body.instance_id, descriptor.instance_id);
    assert.equal(body.runtime_ready, true);
    assert.equal(body.capability_health.state, 'ATTESTED');
    assert.deepEqual(await stopHost(host), { code: 0, signal: null });
    await assertPortClosed(apiPort); await assertPortClosed(edgePort);
    for (const child of status.children) assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
    const stopped = JSON.parse(await fs.readFile(statusFile, 'utf8'));
    assert.equal(stopped.state, 'STOPPED');
    assert.equal(stopped.children_stopped, true);
    await assert.rejects(fs.lstat(path.join(state, 'runtime-host-lock.json')), { code: 'ENOENT' });
    assert.equal(await owned.isAlive(), true, 'attached host shutdown preserves the external postmaster');
    assert.equal((await owned.verify()).pid, owned.pid);
    assert.equal((await fs.readFile(path.join(data, 'postmaster.pid'))).equals(pidBytes), true);
    assert.equal(await fileDigest(path.join(data, 'client-vault.key')), vaultDigest);
    const [identity] = await sql.unsafe('SELECT system_identifier::text AS id FROM pg_catalog.pg_control_system()');
    assert.equal(identity.id, cluster.id);
    for (const secret of [ownerPassword, apiPassword, config.database_url, config.inspect_database_url]) assert.equal(host.output().includes(secret), false);
    t.diagnostic('bundled attached host run ' + (run + 1) + ' completed attested health and owned child cleanup');
  }
  assert.notEqual(instances[0], instances[1]);
  for (let index = 0; index < 2; index += 1) assert.notEqual(childPids[0][index], childPids[1][index]);
  let installedOwnerQualified = false;
  let ownerProfilePublished = false;
  if (installedOwnerSelected) {
    for (const directory of ['Roaming', 'Local', 'Temp']) await fs.mkdir(path.join(root, directory));
    await fs.writeFile(path.join(root, 'metaengine-isolated-launch-qa.json'), JSON.stringify({
      schema: 'metaengine.browser.isolated-owner-launch-fixture.v1', production_profile: false,
      source_data_rows_restored: 0, source_head: installedOwnerInputs.sourceHead,
    }) + '\n', { flag: 'wx', mode: 0o600 });
    // This report records only checks performed above. It explicitly attests
    // a disposable empty schema, never restoration of the archive's user rows.
    const restoreReportFile = path.join(root, 'schema-only-restore-report.json');
    const restoreReportBytes = Buffer.from(JSON.stringify({ schema: 'metaengine.database-restore-report.v1',
      source_dump_sha256: expectedDumpSha256, data_verified: true, schema_verified: true, errors: [],
      ddl_adaptations: restorePlan.compatibility, schema_only: true, disposable: true,
      source_data_rows_restored: 0, empty_tables_verified: tables.length, production_qualification: false,
    }) + '\n');
    await fs.writeFile(restoreReportFile, restoreReportBytes, { flag: 'wx', mode: 0o600 });
    const appData = path.join(root, 'Roaming');
    const publisherEntry = path.join(verified.paths.sourceRoot, 'infra/client-state-runtime/restored-client-provider-cli.mjs');
    cleanupUnconfirmed = true;
    const publisher = spawnBundled(verified, [publisherEntry, '--config', configFile,
      '--bundle-sha256', expectedBundleDigest, '--restore-receipt', restoreReportFile,
      '--restore-receipt-sha256', createHash('sha256').update(restoreReportBytes).digest('hex'),
      '--appdata', appData, '--owner-action', 'USE_EXISTING_RESTORED_POSTGRES_17'], {
      APPDATA: appData, LOCALAPPDATA: path.join(root, 'Local'), TEMP: path.join(root, 'Temp'), TMP: path.join(root, 'Temp'),
    }, false, 300000);
    const publicationClosed = await publisher.closed;
    const publicationOutput = publisher.output();
    for (const secret of [ownerPassword, apiPassword, config.database_url, config.inspect_database_url]) assert.equal(publicationOutput.includes(secret), false);
    const publication = JSON.parse(publicationOutput.trim());
    if (publicationClosed.code !== 0) {
      if (/^restored_(?:provider|client_cli)_[a-z0-9_]{1,160}$/.test(publication.reason || '')) t.diagnostic('installed Owner publication failure reason: ' + publication.reason);
      assert.deepEqual(publicationClosed, { code: 0, signal: null });
    }
    assert.equal(publication.schema, 'compute.restored-client-provider-provisioning.v1');
    assert.equal(publication.state, 'CONFIGURED');
    assert.equal(publication.owner_profile_written, true);
    assert.equal(publication.cleanup_confirmed, true);
    assert.equal(publication.postgres_mode, 'attached');
    assert.equal(publication.api_role_mode, 'direct');
    assert.equal(publication.postgres_lifecycle_owned, false);
    assert.equal(publication.attached_postmaster_preserved, true);
    assert.equal(publication.bundle_sha256, expectedBundleDigest);
    assert.equal(publication.source_dump_sha256, expectedDumpSha256);
    assert.equal(publication.source_schema_exact, false);
    await assertPortClosed(apiPort); await assertPortClosed(edgePort);
    assert.equal((await fs.readFile(path.join(data, 'postmaster.pid'))).equals(pidBytes), true);
    assert.equal(await fileDigest(path.join(data, 'client-vault.key')), vaultDigest);
    ownerProfilePublished = true;
    cleanupUnconfirmed = false;
    t.diagnostic('installed bundle candidate qualified and exclusively published its disposable durable Owner profile');
    const sourceRoot = await fs.realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
    const installedCli = path.join(sourceRoot, 'apps/metaengine-browser/scripts/qualify-installed-client-launch.mjs');
    cleanupUnconfirmed = true;
    const qualification = spawnBundled(verified, [installedCli, '--install-root', installedOwnerInputs.installRoot,
      '--source-root', sourceRoot, '--expected-head', installedOwnerInputs.sourceHead,
      '--expected-version', installedOwnerInputs.version, '--evidence-dir', installedOwnerInputs.evidenceDirectory,
      '--owner-qa-root', root], {}, false, 600000);
    const qualificationClosed = await qualification.closed;
    const qualificationOutput = qualification.output();
    for (const secret of [ownerPassword, apiPassword, config.database_url, config.inspect_database_url]) assert.equal(qualificationOutput.includes(secret), false);
    if (qualificationClosed.code !== 0) {
      const reason = qualificationOutput.match(/INSTALLED_CLIENT_LAUNCH_QUALIFICATION_FAILED: (installed_launch_[a-z0-9_]{1,160})/);
      if (reason) t.diagnostic('real installed Owner qualification failure reason: ' + reason[1]);
      assert.deepEqual(qualificationClosed, { code: 0, signal: null });
    }
    const qualificationReceipt = JSON.parse(qualificationOutput.trim());
    assert.equal(qualificationReceipt.owner_boot_qualified, true);
    assert.equal(qualificationReceipt.normal_ui_boot_verified, true);
    assert.equal(qualificationReceipt.bundle_sha256, expectedBundleDigest);
    assert.equal(qualificationReceipt.source_head, installedOwnerInputs.sourceHead);
    assert.equal(qualificationReceipt.package_version, installedOwnerInputs.version);
    const ownerProof = JSON.parse(await fs.readFile(path.join(installedOwnerInputs.evidenceDirectory, 'installed-owner-boot-proof.json'), 'utf8'));
    for (const key of ['process_cleanup_confirmed', 'runtime_host_lock_released', 'runtime_children_stopped',
      'runtime_ports_closed', 'attached_postgres_incarnation_preserved']) assert.equal(ownerProof[key], true);
    await assert.rejects(fs.lstat(path.join(state, 'runtime-host-lock.json')), { code: 'ENOENT' });
    await assertPortClosed(apiPort); await assertPortClosed(edgePort);
    assert.equal((await fs.readFile(path.join(data, 'postmaster.pid'))).equals(pidBytes), true);
    assert.equal(await fileDigest(path.join(data, 'client-vault.key')), vaultDigest);
    assert.equal((await owned.verify()).pid, owned.pid);
    installedOwnerQualified = true;
    cleanupUnconfirmed = false;
    t.diagnostic('real installed Owner UI/socket qualification passed and preserved the fixture postmaster');
  }
  await verifyOfflineRuntimeBundle({ bundleDirectory, expectedBundleDigest });
  assert.equal(await fileDigest(dump), expectedDumpSha256);
  console.log(JSON.stringify({ schema: 'compute.attached-bundled-runtime-evidence.v1', disposable: true,
    schema_only: true, source_dump_sha256: expectedDumpSha256, source_data_rows_restored: 0, empty_tables_verified: tables.length,
    bundle_sha256: expectedBundleDigest, migration_sources_sha256: plan.source_manifest_sha256,
    bundle_verification_stubbed: false, bundled_node_cli_onboarding: true, credential_file_acl_exercised: true,
    wrong_cluster_binding_rejected_before_sql_effect: true, scram_api_credentials_exercised: true,
    direct_role_grants_verified: true, service_role_membership: false, bundled_attached_host_starts: 2,
    bundled_api_edge_health_attested: true, owned_children_cleanup_confirmed: true,
    external_postmaster_incarnation_preserved: true, existing_vault_preserved: true,
    production_database_modified: false, owner_profile_published: ownerProfilePublished, installed_socket_ui_smoke: installedOwnerQualified,
    production_qualification: false }));
});
