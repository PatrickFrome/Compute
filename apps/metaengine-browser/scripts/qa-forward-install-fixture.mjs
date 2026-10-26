// Disposable Windows fixture for the manual forward consumer. This module
// creates no synthetic Owner/config/status receipts: the pinned predecessor's
// normal attached-onboarding and restored-provider CLIs publish those records.
import fs from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyOfflineRuntimeBundle } from '../../../infra/client-state-runtime/offline-runtime-bundle.mjs';
import { protectOwnerOnlyWindowsDirectory } from '../src/private-windows-storage-acl.mjs';
import { localStateProviderOwnerFile, validateLocalStateProviderConfig } from '../src/local-state-provider-policy.mjs';
import { captureInstalledTreeFingerprint } from './qa-installed-tree-fingerprint.mjs';

const exec = promisify(execFile);
const SHA = /^[a-f0-9]{64}$/;
const HEAD = /^[a-f0-9]{40}$/;
const prefix = 'runtime/postgresql/';
const repository = fileURLToPath(new URL('../../../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = reason => { throw new Error('qa_forward_fixture_' + reason); };
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const within = (root, file) => {
  const relative = path.relative(path.resolve(root).toLowerCase(), path.resolve(file).toLowerCase());
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
};
const localAbsolute = value => typeof value === 'string' && path.isAbsolute(value)
  && !/^(?:\\\\|\/\/)/.test(value) && !/[\x00-\x1f]/.test(value);

async function absent(file) {
  try { await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  fail('existing_state_requires_review');
}

async function physical(file, kind) {
  if (!localAbsolute(file)) fail('absolute_local_path_required');
  const absolute = path.resolve(file);
  let current = path.parse(absolute).root;
  for (const part of path.relative(current, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const info = await fs.lstat(current);
    if (info.isSymbolicLink() || (current !== absolute && !info.isDirectory())) fail('path_alias_forbidden');
    if (current === absolute && (kind === 'directory' ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)) fail('path_type_invalid');
  }
  const resolved = await fs.realpath(absolute), before = await fs.lstat(absolute), after = await fs.lstat(resolved);
  if (before.dev !== after.dev || before.ino !== after.ino) fail('path_identity_changed');
  return resolved;
}

async function hashFile(file) {
  const selected = await physical(file, 'file'), before = await fs.lstat(selected);
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(selected)) hash.update(bytes);
  const after = await fs.lstat(selected);
  if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1 || before.dev !== after.dev
    || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs
    || before.ctimeMs !== after.ctimeMs) fail('file_changed');
  return hash.digest('hex');
}

export function validateForwardSchemaFixture(value, sourceHead) {
  if (!value || value.kind !== 'REVIEWED_OFFLINE_EMPTY_SCHEMA' || !localAbsolute(value.file)
    || !SHA.test(value.sha256 || '') || !HEAD.test(value.source_head || '')
    || value.source_head !== sourceHead || value.source_data_rows !== 0
    || value.synthetic_rpc_bodies !== false) fail('reviewed_empty_schema_required');
  return Object.freeze({ file: path.resolve(value.file), sha256: value.sha256,
    source_head: value.source_head, kind: value.kind, source_data_rows: 0, synthetic_rpc_bodies: false });
}

// This plan is deliberately narrower than a generic pg_restore: data, external
// connectors, event triggers and environment-owned extensions cannot enter the
// disposable database. Existing ACL entries remain selected.
export function forwardSchemaOnlyRestorePlan(toc) {
  if (typeof toc !== 'string' || !toc.includes('Dumped from database version: 17.')) fail('pg17_schema_archive_required');
  const selected = [], omitted = [];
  for (const line of toc.split(/\r?\n/)) {
    if (!line || line.startsWith(';')) continue;
    if (!/^\d+; \d+ \d+ /.test(line)) fail('schema_archive_toc_invalid');
    if (/ (?:TABLE DATA|MATERIALIZED VIEW DATA|SEQUENCE SET|BLOBS?|LARGE OBJECT(?: DATA)?) /.test(line)
      || / SCHEMA - (?:extensions|vault) /.test(line)
      || / EXTENSION - (?:pgcrypto|supabase_vault) /.test(line)
      || / COMMENT - EXTENSION supabase_vault /.test(line)
      || / EVENT TRIGGER /.test(line)
      || / (?:SUBSCRIPTION|USER MAPPING|SERVER|FOREIGN DATA WRAPPER|FOREIGN TABLE) /.test(line)) omitted.push(line);
    else selected.push(line);
  }
  if (!selected.some(line => / TABLE (?:public|destruktion_meta) /.test(line))) fail('schema_archive_application_tables_missing');
  return Object.freeze({ selected, omitted, compatibility: ['generated_test_owner', 'nonlogin_compatibility_roles',
    'local_pgcrypto_vault', 'event_triggers_excluded', 'external_connectors_excluded'] });
}

function postgresRecords(verified) {
  const records = verified?.manifest?.files?.filter(row => row?.path?.startsWith(prefix));
  if (!Array.isArray(records) || !records.length) fail('pg_inventory_missing');
  const seen = new Set();
  for (const row of records) {
    const relative = row.path.slice(prefix.length);
    if (!/^(?:bin|lib|share)\//.test(relative)
      || !relative.split('/').every(part => /^[A-Za-z0-9_@+.-]+$/.test(part) && part !== '.' && part !== '..' && !part.startsWith('.'))
      || !SHA.test(row.sha256 || '') || !Number.isSafeInteger(row.bytes) || row.bytes < 0
      || row.component !== 'postgresql' || row.kind !== 'postgres_resource' || seen.has(relative.toLowerCase())) fail('pg_inventory_invalid');
    seen.add(relative.toLowerCase());
  }
  for (const required of ['bin/postgres.exe', 'bin/psql.exe', 'bin/initdb.exe', 'bin/pg_ctl.exe',
    'bin/pg_isready.exe', 'bin/pg_restore.exe', 'bin/pg_controldata.exe', 'lib/plpgsql.dll', 'share/postgres.bki']) {
    if (!seen.has(required)) fail('pg_inventory_incomplete');
  }
  return records;
}

export async function copyForwardPostgresRuntime({ verified, destination, expectedTreeSha256 }) {
  if (!localAbsolute(destination) || !SHA.test(expectedTreeSha256 || '')) fail('pg_copy_contract_invalid');
  const records = postgresRecords(verified);
  const source = await physical(path.dirname(verified.paths.postgresBinDirectory), 'directory');
  const parent = await physical(path.dirname(destination), 'directory');
  const target = path.join(parent, path.basename(destination));
  if (within(source, target) || within(target, source)) fail('pg_copy_scope_overlap');
  await absent(target);
  const before = await captureInstalledTreeFingerprint(source);
  if (before.tree_sha256 !== expectedTreeSha256) fail('pg_source_inventory_changed');
  await fs.mkdir(target);
  for (const row of records) {
    const relative = row.path.slice(prefix.length);
    const input = path.join(source, relative), output = path.join(target, relative);
    if (await hashFile(input) !== row.sha256 || (await fs.lstat(input)).size !== row.bytes) fail('pg_source_inventory_changed');
    await fs.mkdir(path.dirname(output), { recursive: true });
    await physical(path.dirname(output), 'directory');
    await fs.copyFile(input, output, constants.COPYFILE_EXCL);
    if (await hashFile(output) !== row.sha256 || (await fs.lstat(output)).size !== row.bytes) fail('pg_copy_inventory_changed');
  }
  const copied = await captureInstalledTreeFingerprint(target);
  if (copied.tree_sha256 !== expectedTreeSha256
    || (await captureInstalledTreeFingerprint(source)).tree_sha256 !== expectedTreeSha256) fail('pg_copy_inventory_changed');
  return Object.freeze({ directory: target, postgresBinDirectory: path.join(target, 'bin'),
    source_tree_sha256: before.tree_sha256, runtime_tree_sha256: copied.tree_sha256, file_count: copied.file_count });
}

export function forwardFixtureEnvironment(env = process.env, extra = {}) {
  const allowed = ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
    'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'PATH', 'Path', 'PATHEXT', 'COMSPEC', 'ProgramFiles',
    'ProgramFiles(x86)', 'ProgramData', 'SystemDrive', 'OS', 'LANG', 'LC_ALL', 'LC_CTYPE'];
  const result = Object.fromEntries(allowed.filter(key => typeof env[key] === 'string').map(key => [key, env[key]]));
  return { ...result, ...extra };
}

async function privateExec(executable, args, { env, stage, timeout = 180000, maxBuffer = 4 * 1024 * 1024 } = {}) {
  try {
    const pending = exec(executable, args, { env, shell: false, windowsHide: true, timeout, maxBuffer });
    pending.child.stdin?.end();
    return (await pending).stdout;
  } catch { fail(stage + '_outcome_requires_review'); }
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function writeOnce(file, value) {
  const handle = await fs.open(file, 'wx', 0o600);
  try { await handle.writeFile(Buffer.isBuffer(value) ? value : JSON.stringify(value) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
}

async function jsonFile(file) { return JSON.parse((await fs.readFile(await physical(file, 'file'), 'utf8')).replace(/^\uFEFF/, '')); }
const roles = ['anon', 'authenticated', 'authenticator', 'cli_login_postgres', 'cli_login_supabase_read_only_user',
  'dashboard_user', 'pgbouncer', 'postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin', 'supabase_etl_admin',
  'supabase_privileged_role', 'supabase_read_only_user', 'supabase_realtime_admin', 'supabase_replication_admin', 'supabase_storage_admin'];
const clusterQuery = `SELECT json_build_object('cluster_system_identifier',system_identifier::text,
  'postmaster_started_at',to_char(pg_postmaster_start_time() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'pg_data_directory',current_setting('data_directory'),'database_port',inet_server_port(),
  'database_name',current_database(),'database_user',current_user,
  'postmaster_pid_file',pg_read_file('postmaster.pid',0,8192,false)) FROM pg_catalog.pg_control_system()`;

export function assertForwardFixtureSqlIdentity(actual, { expectedClusterSystemIdentifier, expectedPort,
  expectedUser, dataDirectory, pidBytes } = {}) {
  if (!Buffer.isBuffer(pidBytes) || pidBytes.length < 1 || pidBytes.length > 8192
    || actual?.cluster_system_identifier !== expectedClusterSystemIdentifier || actual.database_port !== expectedPort
    || actual.database_name !== 'postgres' || actual.database_user !== expectedUser
    || !localAbsolute(actual.pg_data_directory) || !same(actual.pg_data_directory, dataDirectory)
    || !Number.isFinite(Date.parse(actual.postmaster_started_at || ''))
    || typeof actual.postmaster_pid_file !== 'string' || !Buffer.from(actual.postmaster_pid_file, 'utf8').equals(pidBytes)) {
    fail('postgres_sql_identity_unverified');
  }
  // postmaster.pid is written before the SQL-visible start timestamp is
  // finalized. Bind SQL to the exact file; native handle verification binds
  // that file to its process incarnation. Do not equate the two timestamps.
  return true;
}

export function assertForwardPostgresCleanShutdown(output, expectedClusterSystemIdentifier) {
  if (typeof output !== 'string' || output.length > 32768 || !/^[1-9][0-9]{0,19}$/.test(expectedClusterSystemIdentifier || '')) {
    fail('postgres_clean_shutdown_unverified');
  }
  const identifiers = [...output.matchAll(/^Database system identifier:\s*([0-9]+)[ \t]*\r?$/gm)];
  const states = [...output.matchAll(/^Database cluster state:[ \t]*([^\r\n]+)\r?$/gm)];
  if (identifiers.length !== 1 || identifiers[0][1] !== expectedClusterSystemIdentifier
    || states.length !== 1 || states[0][1].trim() !== 'shut down') fail('postgres_clean_shutdown_unverified');
  return Object.freeze({ cluster_system_identifier: expectedClusterSystemIdentifier, clean_shutdown_verified: true,
    control_readback_sha256: digest(output) });
}

async function provisionForwardFixtureInternal({ predecessor, installedBundle, fixtureRoot, appData } = {}) {
  if (process.platform !== 'win32') fail('windows_required');
  if (!localAbsolute(installedBundle) || !localAbsolute(fixtureRoot) || !localAbsolute(appData)
    || !SHA.test(predecessor?.bundle_sha256 || '') || !SHA.test(predecessor?.pg_tree_sha256 || '')) fail('input_contract_invalid');
  const schema = validateForwardSchemaFixture(predecessor.schema_fixture, predecessor.source_head);
  const temporary = await physical(os.tmpdir(), 'directory'), parent = await physical(path.dirname(fixtureRoot), 'directory');
  if (!same(parent, temporary) || !/^metaengine-forward-fixture-[a-f0-9-]{36}$/.test(path.basename(fixtureRoot))) fail('disposable_root_required');
  const root = path.join(parent, path.basename(fixtureRoot));
  if (within(repository, root) || within(installedBundle, root) || within(root, installedBundle)
    || within(root, schema.file) || within(root, appData)) fail('fixture_scope_overlap');
  const ownerFile = localStateProviderOwnerFile({ env: { APPDATA: appData }, platform: 'win32' });
  await physical(appData, 'directory'); await absent(root); await absent(ownerFile); await absent(path.dirname(ownerFile));
  if (await hashFile(schema.file) !== schema.sha256) fail('schema_digest_mismatch');
  const verified = await verifyOfflineRuntimeBundle({ bundleDirectory: installedBundle, expectedBundleDigest: predecessor.bundle_sha256 });
  const bundled = name => import(pathToFileURL(path.join(verified.paths.sourceRoot, 'infra/client-state-runtime', name)).href);
  const { secureAttachedPrivateFile } = await bundled('attached-postgres-onboarding.mjs');
  const { initializeLocalVaultKey } = await bundled('local-vault-key.mjs');
  const { startOwnedWindowsPostgres } = await bundled('owned-postgres-process.mjs');
  const { loadLocalRuntimeMigrationPlan, LOCAL_VAULT_COMPAT_SQL_RESOURCE } = await bundled('local-runtime-migrations.mjs');
  const migrationPlan = await loadLocalRuntimeMigrationPlan();
  let stage = 'CREATE_FIXTURE', rootCreated = false;
  try {
    await fs.mkdir(root); rootCreated = true; await protectOwnerOnlyWindowsDirectory(root);
    await writeOnce(path.join(root, 'fixture-identity.json'), { schema: 'metaengine.manual-forward-fixture.v1',
      fixture_id: randomUUID(), predecessor_source_head: predecessor.source_head, source_data_rows_restored: 0,
      production_profile: false, automatic_retry_allowed: false, authority_effect: false });
    stage = 'COPY_POSTGRES_RUNTIME';
    const copied = await copyForwardPostgresRuntime({ verified, destination: path.join(root, 'pg-runtime'), expectedTreeSha256: predecessor.pg_tree_sha256 });
    const bin = copied.postgresBinDirectory, data = path.join(root, 'pgdata'), state = path.join(root, 'runtime-state');
    await fs.mkdir(state); await protectOwnerOnlyWindowsDirectory(state);
    const ownerLogin = 'state_owner', apiLogin = 'forward_fixture_api';
    const ownerPassword = randomBytes(32).toString('hex'), apiPassword = randomBytes(32).toString('hex');
    const passwordFile = path.join(root, 'initdb-password.txt');
    await writeOnce(passwordFile, Buffer.alloc(0)); await secureAttachedPrivateFile(passwordFile);
    await fs.writeFile(passwordFile, ownerPassword + '\n');
    const ports = new Set(); while (ports.size < 3) ports.add(await freePort());
    const [pgPort, apiPort, edgePort] = [...ports];
    const toolEnv = forwardFixtureEnvironment(process.env, { PGHOST: '127.0.0.1', PGPORT: String(pgPort),
      PGUSER: ownerLogin, PGPASSWORD: ownerPassword, PGDATABASE: 'postgres', PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '5',
      PGCLIENTENCODING: 'UTF8', LANG: 'C', LC_ALL: 'C' });
    const command = (name, args, operation, maximum) => privateExec(path.join(bin, name + '.exe'), args,
      { env: toolEnv, stage: operation, ...(maximum ? { maxBuffer: maximum } : {}) });
    const query = async statement => {
      const output = await command('psql', ['-X', '-q', '-A', '-t', '--no-password', '-v', 'ON_ERROR_STOP=1', '-c', statement], 'sql', 4 * 1024 * 1024);
      try { return JSON.parse(output.trim()); } catch { fail('sql_json_unverified'); }
    };
    stage = 'INITDB';
    await command('initdb', ['-D', data, '--username=' + ownerLogin, '--auth=scram-sha-256', '--pwfile=' + passwordFile,
      '--no-locale', '--encoding=UTF8'], 'initdb');
    await fs.unlink(passwordFile);
    await fs.appendFile(path.join(data, 'postgresql.conf'), "\nunix_socket_directories = ''\n");
    await initializeLocalVaultKey({ dataDirectory: data });
    stage = 'START_POSTGRES';
    let pgHandle = await startOwnedWindowsPostgres({ pgBinDir: bin, pgDataDir: data, databasePort: pgPort,
      env: forwardFixtureEnvironment(), startupTimeoutMs: 120000 });
    let lifecycle = 'RUNNING', postgresGeneration = 1;
    const cluster = await query(clusterQuery);
    if (!/^[1-9][0-9]{0,19}$/.test(cluster.cluster_system_identifier || '') || cluster.database_port !== pgPort
      || cluster.database_name !== 'postgres' || cluster.database_user !== ownerLogin
      || !same(await fs.realpath(cluster.pg_data_directory), await fs.realpath(data))) fail('cluster_identity_unverified');
    await command('psql', ['-X', '-q', '--no-password', '-v', 'ON_ERROR_STOP=1', '-c', roles.map(role =>
      `CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION ${role === 'service_role' ? 'BYPASSRLS' : 'NOBYPASSRLS'}`).join(';')
      + '; CREATE SCHEMA extensions; CREATE SCHEMA vault; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;'], 'compatibility_roles');
    stage = 'RESTORE_EMPTY_SCHEMA';
    const toc = await command('pg_restore', ['--list', schema.file], 'schema_toc');
    const restorePlan = forwardSchemaOnlyRestorePlan(toc);
    if (!/ FUNCTION vault _local_key\(/.test(toc)) await command('psql', ['-X', '-q', '--no-password', '-v', 'ON_ERROR_STOP=1',
      '--file', fileURLToPath(LOCAL_VAULT_COMPAT_SQL_RESOURCE)], 'vault_schema');
    const tocFile = path.join(root, 'schema-only.list');
    await writeOnce(tocFile, Buffer.from(restorePlan.selected.join('\n') + '\n'));
    if (await hashFile(schema.file) !== schema.sha256) fail('schema_changed_before_restore');
    await command('pg_restore', ['--schema-only', '--no-owner', '--exit-on-error', '--single-transaction',
      '--host=127.0.0.1', '--port=' + pgPort, '--username=' + ownerLogin, '--dbname=postgres', '--use-list=' + tocFile, schema.file], 'schema_restore');
    if (await hashFile(schema.file) !== schema.sha256) fail('schema_changed_during_restore');
    const tables = await query(`SELECT coalesce(json_agg(json_build_object('schema',n.nspname,'table',c.relname) ORDER BY n.nspname,c.relname),'[]'::json)
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'`);
    if (!Array.isArray(tables) || tables.length < 1 || tables.length > 10000) fail('schema_tables_unverified');
    const quote = value => '"' + value.replaceAll('"', '""') + '"';
    for (const table of tables) {
      if (typeof table.schema !== 'string' || typeof table.table !== 'string') fail('schema_tables_unverified');
      if (await query(`SELECT to_json(count(*)::int) FROM ${quote(table.schema)}.${quote(table.table)}`) !== 0) fail('schema_has_user_rows');
    }
    const restoreFile = path.join(root, 'schema-only-restore-report.json');
    const restoreBytes = Buffer.from(JSON.stringify({ schema: 'metaengine.database-restore-report.v1',
      source_dump_sha256: schema.sha256, data_verified: true, schema_verified: true, errors: [],
      ddl_adaptations: restorePlan.compatibility, schema_only: true, disposable: true,
      source_data_rows_restored: 0, empty_tables_verified: tables.length, production_qualification: false }) + '\n');
    await writeOnce(restoreFile, restoreBytes);
    stage = 'SEED_SENTINEL';
    const nonce = randomUUID();
    const expectedRows = [{ id: 1, payload: 'before-migration', nonce }, { id: 2, payload: 'preserve-vault-and-data', nonce },
      { id: 3, payload: 'restart-continuity', nonce }];
    await command('psql', ['-X', '-q', '--no-password', '-v', 'ON_ERROR_STOP=1', '-c',
      `BEGIN; CREATE SCHEMA manual_forward_qa; CREATE TABLE manual_forward_qa.sentinel(id integer PRIMARY KEY,payload text NOT NULL,nonce uuid NOT NULL);
       INSERT INTO manual_forward_qa.sentinel VALUES ${expectedRows.map(row => `(${row.id},'${row.payload}','${nonce}')`).join(',')}; COMMIT;`], 'sentinel_insert');
    const configFile = path.join(state, 'attached-runtime.json'), optionsFile = path.join(root, 'onboarding-options.json');
    await writeOnce(optionsFile, Buffer.alloc(0)); await secureAttachedPrivateFile(optionsFile);
    await fs.writeFile(optionsFile, JSON.stringify({ ownerAction: 'ONBOARD_EXISTING_LOCAL_POSTGRES_17', bundleDirectory: installedBundle,
      stateDirectory: state, pgDataDirectory: data, runtimeConfigFile: configFile, expectedBundleDigest: predecessor.bundle_sha256,
      expectedMigrationSourcesSha256: migrationPlan.source_manifest_sha256, expectedClusterSystemIdentifier: cluster.cluster_system_identifier,
      expectedPostmasterStartedAt: cluster.postmaster_started_at,
      adminDatabaseUrl: `postgres://${ownerLogin}:${ownerPassword}@127.0.0.1:${pgPort}/postgres`, apiLogin, apiPassword, apiPort, edgePort, startupTimeoutMs: 120000 }));
    stage = 'ATTACHED_ONBOARDING';
    const parseReceipt = output => { try { return JSON.parse(output.trim()); } catch { fail('runtime_receipt_unverified'); } };
    const onboard = parseReceipt(await privateExec(verified.paths.nodeExecutable, [verified.paths.attachedOnboardingEntry, '--options-file', optionsFile],
      { env: forwardFixtureEnvironment(), stage: 'onboarding', timeout: 300000 }));
    if (onboard.state !== 'CONFIGURED_UNQUALIFIED' || onboard.postgres_mode !== 'attached' || onboard.api_role_mode !== 'direct'
      || onboard.postgres_started !== false || onboard.postgres_stopped !== false || onboard.owner_profile_written !== false
      || onboard.source_manifest_sha256 !== migrationPlan.source_manifest_sha256) fail('onboarding_receipt_unverified');
    await fs.unlink(optionsFile);
    const config = await jsonFile(configFile);
    if (config.postgres_mode !== 'attached' || config.api_role_mode !== 'direct' || config.expected_bundle_sha256 !== predecessor.bundle_sha256
      || config.expected_cluster_system_identifier !== cluster.cluster_system_identifier || !same(config.pg_data_directory, data)) fail('attached_config_unverified');
    stage = 'PUBLISH_OWNER';
    await absent(ownerFile); await absent(path.dirname(ownerFile));
    await fs.mkdir(path.dirname(ownerFile), { recursive: true }); await protectOwnerOnlyWindowsDirectory(path.dirname(ownerFile));
    const publisherEntry = path.join(verified.paths.sourceRoot, 'infra/client-state-runtime/restored-client-provider-cli.mjs');
    const published = parseReceipt(await privateExec(verified.paths.nodeExecutable, [publisherEntry, '--config', configFile,
      '--bundle-sha256', predecessor.bundle_sha256, '--restore-receipt', restoreFile, '--restore-receipt-sha256', digest(restoreBytes),
      '--appdata', appData, '--owner-action', 'USE_EXISTING_RESTORED_POSTGRES_17'],
    { env: forwardFixtureEnvironment(process.env, { APPDATA: appData }), stage: 'owner_publication', timeout: 300000 }));
    if (published.schema !== 'compute.restored-client-provider-provisioning.v1' || published.state !== 'CONFIGURED'
      || published.owner_profile_written !== true || published.cleanup_confirmed !== true || published.postgres_mode !== 'attached'
      || published.api_role_mode !== 'direct' || published.postgres_lifecycle_owned !== false || published.attached_postmaster_preserved !== true
      || published.bundle_sha256 !== predecessor.bundle_sha256 || published.source_dump_sha256 !== schema.sha256) fail('owner_publication_unverified');
    const owner = validateLocalStateProviderConfig(await jsonFile(ownerFile));
    if (owner.runtime_host.expected_bundle_sha256 !== predecessor.bundle_sha256 || !same(owner.runtime_host.bundle_directory, installedBundle)
      || !same(owner.runtime_host.config_file, configFile) || !same(owner.runtime_identity_file, path.join(state, 'runtime-instance.json'))) fail('owner_binding_unverified');
    const status = await jsonFile(owner.runtime_identity_file);
    if (status.state !== 'STOPPED' || status.runtime_ready !== false || status.children_stopped !== true
      || status.instance_id !== published.attested_instance_id || status.bundle_sha256 !== predecessor.bundle_sha256) fail('owner_stopped_unverified');
    await absent(path.join(state, 'runtime-host-lock.json'));
    stage = 'READBACK';
    const runtimeUnchanged = async () => {
      if ((await captureInstalledTreeFingerprint(copied.directory)).tree_sha256 !== predecessor.pg_tree_sha256) fail('external_runtime_changed');
    };
    const readbackSqlInternal = async () => {
      if (lifecycle !== 'RUNNING') fail('postgres_lifecycle_requires_review');
      await runtimeUnchanged();
      const before = await pgHandle.verify(), pidFile = path.join(data, 'postmaster.pid');
      const pidBytes = await fs.readFile(await physical(pidFile, 'file'));
      const actual = await query(clusterQuery);
      const rows = await query("SELECT json_agg(json_build_object('id',id,'payload',payload,'nonce',nonce) ORDER BY id) FROM manual_forward_qa.sentinel");
      const after = await pgHandle.verify();
      actual.pg_data_directory = await fs.realpath(actual.pg_data_directory);
      assertForwardFixtureSqlIdentity(actual, { expectedClusterSystemIdentifier: cluster.cluster_system_identifier,
        expectedPort: pgPort, expectedUser: ownerLogin, dataDirectory: await fs.realpath(data), pidBytes });
      if (JSON.stringify(before) !== JSON.stringify(after) || !(await fs.readFile(pidFile)).equals(pidBytes)
        || Number(pidBytes.toString('utf8').split(/\r?\n/)[0]) !== before.pid
        || JSON.stringify(rows) !== JSON.stringify(expectedRows)) fail('postgres_continuity_unverified');
      return Object.freeze({ cluster_system_identifier: actual.cluster_system_identifier, postmaster_started_at: actual.postmaster_started_at,
        pg_data_directory: await fs.realpath(data), postmaster_pid: before.pid, postmaster_created_at: before.processCreatedAt,
        postmaster_pidfile_sha256: digest(pidBytes), sentinel_count: rows.length, sentinel_sha256: digest(JSON.stringify(rows)),
        vault_sha256: await hashFile(path.join(data, 'client-vault.key')), runtime_tree_sha256: copied.runtime_tree_sha256 });
    };
    const readbackSql = async () => {
      try { return await readbackSqlInternal(); }
      catch (error) {
        throw new Error(/^qa_forward_fixture_[a-z0-9_]{1,100}$/.test(error?.message || '')
          ? error.message : 'qa_forward_fixture_postgres_readback_requires_review');
      }
    };
    const recordLifecycle = async (action, value) => writeOnce(path.join(root, 'postgres-' + action + '.json'), value);
    const stopPostgres = async () => {
      if (lifecycle !== 'RUNNING') fail('postgres_lifecycle_requires_review');
      lifecycle = 'STOP_PENDING';
      try {
        await recordLifecycle('stop-' + postgresGeneration + '-attempt', { state: lifecycle, automatic_retry_allowed: false });
        const result = await pgHandle.stop({ timeoutMs: 45000 });
        if (result.cleanup_confirmed !== true || await pgHandle.isAlive()) fail('postgres_stop_unconfirmed');
        await absent(path.join(data, 'postmaster.pid'));
        await runtimeUnchanged();
        const control = await privateExec(path.join(bin, 'pg_controldata.exe'), ['-D', data], {
          env: forwardFixtureEnvironment(process.env, { LANG: 'C', LC_ALL: 'C' }), stage: 'clean_shutdown', timeout: 30000, maxBuffer: 32768 });
        const clean = assertForwardPostgresCleanShutdown(control, cluster.cluster_system_identifier);
        await absent(path.join(data, 'postmaster.pid')); lifecycle = 'STOPPED';
        await recordLifecycle('stop-' + postgresGeneration + '-completed', { state: lifecycle, cleanup_confirmed: true, ...clean });
        return Object.freeze({ ...result, ...clean });
      } catch { lifecycle = 'HOLD'; fail('postgres_stop_outcome_requires_review'); }
    };
    const restartPostgres = async () => {
      if (lifecycle !== 'STOPPED') fail('postgres_lifecycle_requires_review');
      lifecycle = 'START_PENDING';
      try {
        await recordLifecycle('restart-attempt', { state: lifecycle, automatic_retry_allowed: false });
        await runtimeUnchanged();
        pgHandle = await startOwnedWindowsPostgres({ pgBinDir: bin, pgDataDir: data, databasePort: pgPort,
          env: forwardFixtureEnvironment(), startupTimeoutMs: 120000 });
        postgresGeneration += 1;
        lifecycle = 'RUNNING';
        const observed = await readbackSql();
        await recordLifecycle('restart-completed', { state: lifecycle, cluster_system_identifier: observed.cluster_system_identifier,
          postmaster_pid: observed.postmaster_pid, postmaster_created_at: observed.postmaster_created_at });
        return observed;
      } catch { lifecycle = 'HOLD'; fail('postgres_restart_outcome_requires_review'); }
    };
    const baseline = await readbackSql();
    const fixtureEvidence = Object.freeze({ schema: 'metaengine.manual-forward-provisioned-fixture.v1',
      predecessor_source_head: predecessor.source_head, predecessor_bundle_sha256: predecessor.bundle_sha256,
      schema_fixture_sha256: schema.sha256, schema_fixture_source_head: schema.source_head,
      schema_fixture_kind: schema.kind, empty_tables_verified: tables.length, source_data_rows_restored: 0,
      external_pg_runtime_inventory_verified: true, source_runtime_tree_sha256: copied.source_tree_sha256,
      runtime_tree_sha256: copied.runtime_tree_sha256, normal_attached_onboarding: true, normal_owner_publication: true,
      real_stopped_receipt: true, sentinel_count: baseline.sentinel_count, automatic_retry_allowed: false,
      production_profile: false, authority_effect: false });
    await writeOnce(path.join(root, 'fixture-provisioned.json'), fixtureEvidence);
    return Object.freeze({ ownerFile, owner, config, get pgHandle() { return pgHandle; }, postgresBinDirectory: bin,
      dataDirectory: data, stateDirectory: state, fixtureRoot: root, baseline, fixtureEvidence, readbackSql, stopPostgres, restartPostgres });
  } catch (error) {
    if (rootCreated) {
      try { await writeOnce(path.join(root, 'fixture-hold.json'), { schema: 'metaengine.manual-forward-fixture-hold.v1',
        state: 'HOLD', stage, completion_verified: false, automatic_retry_allowed: false, authority_effect: false }); } catch { /* Absence of this record cannot authorize replay. */ }
    }
    const reason = /^qa_forward_fixture_[a-z0-9_]{1,100}$/.test(error?.message || '') ? error.message : 'qa_forward_fixture_provisioning_requires_review';
    throw new Error(reason);
  }
}

export async function provisionForwardFixture(options) {
  try { return await provisionForwardFixtureInternal(options); }
  catch (error) {
    // Preflight filesystem/module errors can contain private paths too. The
    // caller receives only finite fixture categories, never raw subprocess or
    // PostgreSQL errors, connection strings or credential-bearing arguments.
    throw new Error(/^qa_forward_fixture_[a-z0-9_]{1,100}$/.test(error?.message || '')
      ? error.message : 'qa_forward_fixture_provisioning_requires_review');
  }
}
