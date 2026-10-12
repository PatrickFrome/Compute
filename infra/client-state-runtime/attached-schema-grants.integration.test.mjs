import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes, randomUUID, webcrypto } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import postgres from 'postgres';
import { inspectAttachedApiAdmission, onboardAttachedPostgres } from './attached-postgres-onboarding.mjs';
import { startDbApi } from './db-api.mjs';
import { loadLocalRuntimeMigrationPlan } from './local-runtime-migrations.mjs';
import { initializeLocalVaultKey } from './local-vault-key.mjs';
import { startOwnedWindowsPostgres } from './owned-postgres-process.mjs';
import { schemaOnlyRestorePlan } from './test/isolated-goal-fixture.mjs';

const exec = promisify(execFile);
const bin = process.env.LOCAL_STATE_TEST_PROJECT_PG_BIN_DIR;
const dump = process.env.LOCAL_STATE_TEST_ATTACHED_SCHEMA_DUMP;
const expectedDumpSha256 = process.env.LOCAL_STATE_TEST_ATTACHED_SCHEMA_DUMP_SHA256;
const ROLE_NAMES = ['anon', 'authenticated', 'authenticator', 'cli_login_postgres', 'cli_login_supabase_read_only_user',
  'dashboard_user', 'pgbouncer', 'postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin', 'supabase_etl_admin',
  'supabase_privileged_role', 'supabase_read_only_user', 'supabase_realtime_admin', 'supabase_replication_admin', 'supabase_storage_admin'];
const sha = value => createHash('sha256').update(value).digest('hex');

test('direct API role works on a disposable schema-only copy of an explicitly pinned PG17 archive', { skip: !bin || !dump, timeout: 540000 }, async t => {
  assert(path.isAbsolute(dump));
  assert.match(expectedDumpSha256 || '', /^[a-f0-9]{64}$/);
  const archiveInfo = await fs.lstat(dump);
  assert(archiveInfo.isFile() && !archiveInfo.isSymbolicLink());
  assert.equal(sha(await fs.readFile(dump)), expectedDumpSha256);
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'compute-attached-schema-')));
  const data = path.join(root, 'pgdata'), owner = 'attached_schema_fixture_owner';
  const ownerPassword = randomBytes(32).toString('hex'), passwordFile = path.join(root, 'initdb-password.txt');
  await fs.writeFile(passwordFile, ownerPassword + '\n', { flag: 'wx', mode: 0o600 });
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const sql = postgres({ host: '127.0.0.1', port, database: 'postgres', username: owner, password: ownerPassword, max: 2, prepare: false, connect_timeout: 2, onnotice: () => {} });
  let owned;
  let runtime;
  let direct;
  let cleanupUnconfirmed = false;
  t.after(async () => {
    await runtime?.close();
    await direct?.end({ timeout: 2 });
    await sql.end({ timeout: 2 });
    if (owned) assert.equal((await owned.stop()).cleanup_confirmed, true);
    if (cleanupUnconfirmed) return;
    const relative = path.relative(await fs.realpath(os.tmpdir()), await fs.realpath(root));
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    await fs.rm(root, { recursive: true, force: true });
  });
  await exec(path.join(bin, 'initdb' + suffix), ['-D', data, '--username=' + owner, '--auth=scram-sha-256', '--pwfile=' + passwordFile, '--no-locale', '-E', 'UTF8'], { windowsHide: true });
  await fs.unlink(passwordFile);
  if (process.platform === 'win32') {
    try { owned = await startOwnedWindowsPostgres({ pgBinDir: bin, pgDataDir: data, databasePort: port, startupTimeoutMs: 120000 }); }
    catch (error) { cleanupUnconfirmed = error.code === 'runtime_cleanup_unconfirmed'; throw error; }
  }
  else {
    await exec(path.join(bin, 'pg_ctl'), ['-D', data, '-l', path.join(root, 'postgres.log'), '-o', '-h 127.0.0.1 -p ' + port, 'start', '-w']);
    owned = { stop: async () => { await exec(path.join(bin, 'pg_ctl'), ['-D', data, 'stop', '-m', 'fast', '-w']); return { cleanup_confirmed: true }; } };
  }
  for (const role of ROLE_NAMES) await sql.unsafe('CREATE ROLE "' + role + '" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION ' + (role === 'service_role' ? 'BYPASSRLS' : 'NOBYPASSRLS'));
  await sql.unsafe('CREATE SCHEMA extensions; CREATE SCHEMA vault; CREATE EXTENSION pgcrypto WITH SCHEMA extensions');
  await initializeLocalVaultKey({ dataDirectory: data });
  const { stdout: toc } = await exec(path.join(bin, 'pg_restore' + suffix), ['--list', dump], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  // A local archive already carries the provider; a Supabase source archive needs the compatibility functions.
  if (!/ FUNCTION vault _local_key\(/.test(toc)) await sql.unsafe(await fs.readFile(new URL('./local-vault-compat.sql', import.meta.url), 'utf8'));
  const restorePlan = schemaOnlyRestorePlan(toc);
  const tocPath = path.join(root, 'schema-only.list');
  await fs.writeFile(tocPath, restorePlan.selected.join('\n') + '\n', { flag: 'wx' });
  await exec(path.join(bin, 'pg_restore' + suffix), ['--schema-only', '--no-owner', '--exit-on-error', '--single-transaction',
    '--host=127.0.0.1', '--port=' + port, '--username=' + owner, '--dbname=postgres', '--use-list=' + tocPath, dump],
    { windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, PGPASSWORD: ownerPassword } });
  const tables = await sql.unsafe("SELECT n.nspname,c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'");
  for (const table of tables) assert.equal((await sql.unsafe('SELECT count(*)::int AS count FROM "' + table.nspname.replaceAll('"', '""') + '"."' + table.relname.replaceAll('"', '""') + '"'))[0].count, 0);
  const plan = await loadLocalRuntimeMigrationPlan();
  const password = randomBytes(32).toString('hex'), login = 'attached_schema_fixture_api';
  const stateDirectory = path.join(root, 'runtime-state'), bundleDirectory = path.join(root, 'reviewed-bundle');
  await fs.mkdir(stateDirectory); await fs.mkdir(bundleDirectory);
  const [cluster] = await sql.unsafe(`SELECT system_identifier::text AS id,
    to_char(pg_postmaster_start_time() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS started
    FROM pg_catalog.pg_control_system()`);
  const configFile = path.join(stateDirectory, 'attached-runtime.json'), bundlePin = 'f'.repeat(64);
  const setup = await onboardAttachedPostgres({ ownerAction: 'ONBOARD_EXISTING_LOCAL_POSTGRES_17',
    bundleDirectory, stateDirectory, pgDataDirectory: data, runtimeConfigFile: configFile,
    expectedBundleDigest: bundlePin, expectedMigrationSourcesSha256: plan.source_manifest_sha256,
    expectedClusterSystemIdentifier: cluster.id, expectedPostmasterStartedAt: cluster.started,
    adminDatabaseUrl: `postgres://${owner}:${ownerPassword}@127.0.0.1:${port}/postgres`,
    apiLogin: login, apiPassword: password, apiPort: port === 35433 ? 35435 : 35433, edgePort: port === 35434 ? 35436 : 35434,
  }, { verifyBundle: async () => ({ manifest: { bundle_sha256: bundlePin } }) });
  assert.equal(setup.state, 'CONFIGURED_UNQUALIFIED');
  assert.equal(setup.restricted_api_admission.rpc_names_granted, 50);
  const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
  assert.equal(config.postgres_mode, 'attached');
  assert.equal(config.api_role_mode, 'direct');
  assert.equal(config.expected_cluster_system_identifier, cluster.id);
  await assert.rejects(fs.stat(path.join(stateDirectory, 'runtime-host-lock.json')), error => error.code === 'ENOENT');
  direct = postgres({ host: '127.0.0.1', port, database: 'postgres', username: login, password, max: 1, prepare: false, onnotice: () => {} });
  const admission = await inspectAttachedApiAdmission({ sql: direct, apiLogin: login });
  assert.equal(admission.restricted_login, true);
  assert.equal(admission.rpc_names_granted, 50);
  await assert.rejects(direct.unsafe('SET ROLE service_role'), error => error.code === '42501');
  const key = randomBytes(32).toString('hex'), client = 'schema-direct-' + randomUUID();
  runtime = await startDbApi({ databaseUrl: `postgres://${login}:${password}@127.0.0.1:${port}/postgres`, apiKey: key, roleMode: 'direct', port: 0 });
  const request = (url, init = {}) => fetch(runtime.address + url, { ...init, headers: { apikey: key, ...init.headers } });
  const health = await request('/health');
  assert.equal(health.status, 200, await health.clone().text());
  const capabilities = (await health.json()).runtime_capabilities;
  assert.equal(capabilities.schema, 'metaengine.native-browser-supervisor.capabilities.v1');
  const keyPair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicJwk = await webcrypto.subtle.exportKey('jwk', keyPair.publicKey);
  const enroll = await request('/rest/v1/compute_fabric_a2_browser_device_enrollment_request_h205f22?select=request_id,status', { method: 'POST', headers: { 'content-type': 'application/json', prefer: 'return=representation' },
    body: JSON.stringify({ client_id: client, profile: 'A2_DEVICE_HTTP_SIGNATURE_V1', public_jwk: publicJwk, key_fingerprint_sha256: randomBytes(32).toString('hex'), status: 'PENDING', metadata: { synthetic: true }, authority_effect: false }) });
  assert.equal(enroll.status, 201, await enroll.clone().text());
  const [enrolled] = await enroll.json();
  assert.equal(enrolled.status, 'PENDING');
  const listed = await request('/rest/v1/compute_fabric_a2_browser_device_enrollment_request_h205f22?select=request_id,status&client_id=eq.' + client);
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), [enrolled]);
  for (const name of ['compute_fabric_a2_browser_device_h205f22', 'compute_fabric_a2_chat_bridge_remote_pairing_h205f22', 'compute_fabric_a2_browser_supervisor_state_h205f22', 'compute_fabric_a2_browser_supervisor_command_h205f22']) {
    const response = await request('/rest/v1/' + name + '?limit=1');
    assert.equal(response.status, 200, name + ':' + await response.clone().text());
    assert.deepEqual(await response.json(), []);
  }
  console.log(JSON.stringify({ schema: 'compute.attached-schema-direct-role-evidence.v1', disposable: true, schema_only: true,
    source_dump_sha256: expectedDumpSha256, source_data_rows_restored: 0, empty_tables_verified: tables.length,
    migration_sources_sha256: plan.source_manifest_sha256, role_mode: 'direct', full_onboarding_sql_path: true, bundle_verification_stubbed: true, direct_http_health: true,
    exact_enrollment_rls_read_insert: true, scram_api_credentials_exercised: true, service_role_membership: false,
    production_database_modified: false, production_qualification: false }));
});
