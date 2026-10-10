import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { RPC_ALLOWLIST, RPC_CATALOG_QUERY, TABLE_ALLOWLIST } from './db-api-core.mjs';
import { localApiRolePolicyName } from './db-api-grants.mjs';
import { inspectAttachedApiAdmission, onboardAttachedPostgres, readAttachedOnboardingOptionsFile,
  secureAttachedPrivateFile } from './attached-postgres-onboarding.mjs';

const admission = { restricted_login: true, api_role_mode: 'direct', memberships: 0,
  rpc_names_granted: RPC_ALLOWLIST.length, tables_granted: Object.keys(TABLE_ALLOWLIST).length };

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'compute-attached-onboarding-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const state = path.join(root, 'private-state'); const data = path.join(root, 'keeper-data'); const bundle = path.join(root, 'reviewed-bundle');
  await fs.mkdir(state); await fs.mkdir(path.join(data, 'global'), { recursive: true }); await fs.mkdir(bundle);
  const startedAt = '2026-10-10T09:00:00.000Z';
  const original = new Map([
    ['PG_VERSION', '17\n'], ['client-vault.key', 'e'.repeat(64) + '\n'], ['global/pg_control', 'existing pg17 control'],
    ['postmaster.pid', `21999\n${data}\n${Date.parse(startedAt) / 1000}\n35432\n127.0.0.1\n`],
  ]);
  for (const [file, bytes] of original) await fs.writeFile(path.join(data, file), bytes);
  const options = { ownerAction: 'ONBOARD_EXISTING_LOCAL_POSTGRES_17', bundleDirectory: bundle, stateDirectory: state,
    pgDataDirectory: data, runtimeConfigFile: path.join(state, 'attached-runtime.json'), expectedBundleDigest: 'a'.repeat(64),
    expectedMigrationSourcesSha256: 'b'.repeat(64), expectedClusterSystemIdentifier: '7654321098765432100', expectedPostmasterStartedAt: startedAt,
    adminDatabaseUrl: 'postgresql://keeper_owner:separate-private-administrator-password@127.0.0.1:35432/postgres',
    apiLogin: 'restricted_metaengine_api', apiPassword: 'api-password-private-' + 'c'.repeat(32), apiPort: 35433, edgePort: 35434 };
  const identity = { version: 170006, data_directory: data, address: '127.0.0.1', port: 35432, database: 'postgres', login: 'keeper_owner',
    system_identifier: options.expectedClusterSystemIdentifier, started_at: startedAt, writable: true, audit_log: null, superuser: true, can_login: true };
  const events = []; let began = false; let committed = false;
  const adminSql = {
    unsafe: async query => {
      if (query.includes('pg_control_system')) { events.push('identity'); return [{ ...identity }]; }
      if (query.includes('AS internal_create')) { events.push('capabilities'); return [{ database_create: true, public_create: true, internal_create: true }]; }
      events.push(query);
      return [];
    },
    begin: async run => {
      assert.equal(began, false); began = true; events.push('begin');
      try { const result = await run(adminSql); committed = true; events.push('commit'); return result; }
      catch (error) { events.push('rollback'); throw error; }
    },
    end: async () => { events.push('admin-close'); },
  };
  const apiSql = { unsafe: async () => [], end: async () => { events.push('api-close'); } };
  const hooks = {
    verifyBundle: async () => { events.push('bundle'); return { manifest: { bundle_sha256: options.expectedBundleDigest } }; },
    loadMigrationPlan: async () => ({ source_manifest_sha256: options.expectedMigrationSourcesSha256 }),
    connect: url => {
      const parsed = new URL(url); events.push('connect:' + decodeURIComponent(parsed.username));
      return parsed.username === 'keeper_owner' ? adminSql : apiSql;
    },
    applyMigrations: async ({ sql, expectedMigrationSourcesSha256 }) => {
      assert.equal(began, true); assert.equal(committed, false); assert.equal(expectedMigrationSourcesSha256, options.expectedMigrationSourcesSha256);
      assert.equal(typeof sql.begin, 'function'); events.push('migrations');
      return { source_manifest_sha256: expectedMigrationSourcesSha256, migrations: [{ source: 'reviewed.sql', status: 'APPLIED_LOCAL_ONLY' }] };
    },
    provisionApiLogin: async value => {
      assert.equal(committed, false); assert.equal(value.roleMode, 'direct'); assert.equal(value.login, options.apiLogin);
      assert.equal(value.password, options.apiPassword); events.push('provision');
    },
    inspectApiAdmission: async ({ sql, expectedSessionLogin }) => {
      if (sql === adminSql) { assert.equal(expectedSessionLogin, 'keeper_owner'); events.push('transaction-admission'); }
      else { assert.equal(committed, true); events.push('reconnect-admission'); }
      return admission;
    },
    secureFile: async file => { assert.equal((await fs.stat(file)).size, 0); events.push('secure-empty-config'); },
  };
  return { root, options, hooks, events, identity, adminSql, apiSql, original };
}

async function assertDataPreserved(f) {
  for (const [file, content] of f.original) assert.equal(await fs.readFile(path.join(f.options.pgDataDirectory, file), 'utf8'), content);
}

test('existing Keeper onboarding binds identity, migrates and provisions atomically, reconnects, then exclusively publishes attached config', async t => {
  const f = await fixture(t); const receipt = await onboardAttachedPostgres(f.options, f.hooks);
  assert.equal(receipt.state, 'CONFIGURED_UNQUALIFIED'); assert.equal(receipt.runtime_ready, false);
  assert.equal(receipt.database_initialized, false); assert.equal(receipt.postgres_started, false); assert.equal(receipt.postgres_stopped, false);
  assert.equal(receipt.owner_profile_written, false); assert.equal(receipt.admin_credential_separate, true);
  assert.equal(receipt.api_role_mode, 'direct'); assert.equal(receipt.installed_socket_ui_smoke_required, true);
  assert.doesNotMatch(JSON.stringify(receipt), /password|postgresql:|keeper_owner|restricted_metaengine_api|7654321098765432100/);
  const config = JSON.parse(await fs.readFile(f.options.runtimeConfigFile, 'utf8'));
  assert.equal(config.postgres_mode, 'attached'); assert.equal(config.api_role_mode, 'direct');
  assert.equal(config.expected_cluster_system_identifier, f.options.expectedClusterSystemIdentifier);
  assert.equal(new URL(config.database_url).username, f.options.apiLogin);
  assert.equal(config.inspect_database_url, f.options.adminDatabaseUrl); assert.equal(config.pg_data_directory, f.options.pgDataDirectory);
  assert.equal((await fs.lstat(f.options.runtimeConfigFile)).nlink, 1);
  await assert.rejects(fs.stat(path.join(f.options.stateDirectory, 'runtime-host-lock.json')), { code: 'ENOENT' });
  assert.ok(f.events.indexOf('commit') < f.events.indexOf('reconnect-admission'));
  assert.ok(f.events.indexOf('reconnect-admission') < f.events.indexOf('secure-empty-config'));
  assert.ok(f.events.indexOf("SET LOCAL log_parameter_max_length_on_error = 0") < f.events.indexOf('provision'));
  assert.equal(f.events.filter(event => event === 'identity').length, 3);
  await assertDataPreserved(f);
  await assert.rejects(onboardAttachedPostgres(f.options, f.hooks), /private_config_already_exists/);
});

test('explicit choice, pins, separate credentials and local ports reject before connection or mutation', async t => {
  const f = await fixture(t);
  for (const change of [{ ownerAction: undefined }, { expectedBundleDigest: 'bad' }, { expectedMigrationSourcesSha256: undefined },
    { expectedClusterSystemIdentifier: undefined }, { expectedPostmasterStartedAt: 'invalid' }, { apiPort: 35432 },
    { apiLogin: 'keeper_owner' }, { apiPassword: 'short' }, { apiPassword: 'separate-private-administrator-password' },
    { adminDatabaseUrl: f.options.adminDatabaseUrl.replace('127.0.0.1', 'localhost') },
    { adminDatabaseUrl: f.options.adminDatabaseUrl + '?host=remote' }]) {
    await assert.rejects(onboardAttachedPostgres({ ...f.options, ...change }, f.hooks), error => error.code.startsWith('attached_onboarding_'));
  }
  assert.deepEqual(f.events, []); await assertDataPreserved(f);
});

test('missing vault, bad PG17, physical overlap and aliases fail before connection, preserving existing cluster', async t => {
  const f = await fixture(t);
  await assert.rejects(onboardAttachedPostgres({ ...f.options, stateDirectory: f.options.pgDataDirectory,
    runtimeConfigFile: path.join(f.options.pgDataDirectory, 'runtime.json') }, f.hooks), /private_layout_invalid/);
  const alias = path.join(f.root, 'keeper-alias'); await fs.symlink(f.options.pgDataDirectory, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(onboardAttachedPostgres({ ...f.options, pgDataDirectory: alias }, f.hooks), /path_alias_forbidden/);
  await fs.unlink(path.join(f.options.pgDataDirectory, 'client-vault.key'));
  await assert.rejects(onboardAttachedPostgres(f.options, f.hooks), /private_path_unavailable/);
  await assert.rejects(fs.stat(path.join(f.options.pgDataDirectory, 'client-vault.key')), { code: 'ENOENT' });
  await fs.writeFile(path.join(f.options.pgDataDirectory, 'client-vault.key'), f.original.get('client-vault.key'));
  await fs.writeFile(path.join(f.options.pgDataDirectory, 'PG_VERSION'), '16\n');
  await assert.rejects(onboardAttachedPostgres(f.options, f.hooks), /existing_pg17_vault_required/);
  assert.deepEqual(f.events, []);
});

test('live server version, system id, address, epoch, directory and privileges are required before mutation', async t => {
  for (const change of [{ version: 160000 }, { system_identifier: '7654321098765432101' }, { address: '::1' },
    { started_at: '2026-10-10T09:01:00Z' }, { superuser: false }, { writable: false }, { audit_log: 'all' },
    { started_at: '2026-10-10T09:00:00.000001Z' },
    { data_directory: 'relative' }]) {
    const f = await fixture(t); Object.assign(f.identity, change);
    await assert.rejects(onboardAttachedPostgres(f.options, f.hooks), error => error.code.startsWith('attached_onboarding_'));
    assert.equal(f.events.includes('begin'), false); assert.equal(f.events.includes('migrations'), false);
    await assert.rejects(fs.stat(f.options.runtimeConfigFile), { code: 'ENOENT' }); await assertDataPreserved(f);
  }
});

test('migration capability and reviewed source pin fail closed before setup lock or DB effects', async t => {
  const f = await fixture(t);
  await assert.rejects(onboardAttachedPostgres(f.options, { ...f.hooks,
    loadMigrationPlan: async () => ({ source_manifest_sha256: 'f'.repeat(64) }) }), /migration_source_pin_mismatch/);
  const originalUnsafe = f.adminSql.unsafe;
  f.adminSql.unsafe = async query => query.includes('AS internal_create')
    ? [{ database_create: true, public_create: true, internal_create: false }] : originalUnsafe(query);
  await assert.rejects(onboardAttachedPostgres(f.options, f.hooks), /migration_capability_unattested/);
  assert.equal(f.events.includes('begin'), false);
  assert.deepEqual(await fs.readdir(f.options.stateDirectory), []);
});

test('existing runtime ownership lock blocks schema setup and preserves the active host lock', async t => {
  const f = await fixture(t); const lockFile = path.join(f.options.stateDirectory, 'runtime-host-lock.json');
  const active = JSON.stringify({ schema: 'compute.runtime-host-lock.v1', pid: 11999, owner_nonce: 'other-owner' });
  await fs.writeFile(lockFile, active);
  await assert.rejects(onboardAttachedPostgres(f.options, f.hooks), /exclusive_setup_conflict/);
  assert.equal(await fs.readFile(lockFile, 'utf8'), active); assert.equal(f.events.includes('begin'), false);
  assert.equal(f.events.includes('provision'), false); await assertDataPreserved(f);
});

test('migration or transactional role admission failure rolls back and retains review lock without exposing raw errors', async t => {
  for (const phase of ['applyMigrations', 'provisionApiLogin', 'inspectApiAdmission']) {
    const f = await fixture(t);
    await assert.rejects(onboardAttachedPostgres(f.options, { ...f.hooks,
      [phase]: async () => { throw new Error(f.options.apiPassword + ' raw postgres diagnostic'); } }),
    error => error.message === 'attached_onboarding_incomplete_review_required' && !error.message.includes(f.options.apiPassword));
    assert.ok(f.events.includes('rollback')); assert.equal(f.events.includes('commit'), false);
    assert.equal(f.events.includes('secure-empty-config'), false);
    await assert.rejects(fs.stat(f.options.runtimeConfigFile), { code: 'ENOENT' });
    assert.equal((await fs.stat(path.join(f.options.stateDirectory, 'runtime-host-lock.json'))).isFile(), true);
    await assertDataPreserved(f);
  }
});

test('failed independent reconnect or postcommit drift retains lock and never publishes credentials', async t => {
  for (const phase of ['reconnect', 'drift']) {
    const f = await fixture(t); const hooks = { ...f.hooks };
    if (phase === 'reconnect') hooks.inspectApiAdmission = async input => input.sql === f.apiSql ? { ...admission, memberships: 1 } : f.hooks.inspectApiAdmission(input);
    else hooks.inspectApiAdmission = async input => {
      const result = await f.hooks.inspectApiAdmission(input);
      if (input.sql === f.apiSql) await fs.writeFile(path.join(f.options.pgDataDirectory, 'postmaster.pid'), f.original.get('postmaster.pid') + 'changed\n');
      return result;
    };
    await assert.rejects(onboardAttachedPostgres(f.options, hooks), /api_reconnect_admission_unattested|existing_cluster_files_changed/);
    assert.ok(f.events.includes('commit')); await assert.rejects(fs.stat(f.options.runtimeConfigFile), { code: 'ENOENT' });
    assert.equal((await fs.stat(path.join(f.options.stateDirectory, 'runtime-host-lock.json'))).isFile(), true);
  }
});

test('concurrent configuration publication cannot replace an existing file after transaction commit', async t => {
  const f = await fixture(t); const competingBytes = 'concurrent private config';
  await assert.rejects(onboardAttachedPostgres(f.options, { ...f.hooks, beforePublish: async () => {
    await fs.writeFile(f.options.runtimeConfigFile, competingBytes, { flag: 'wx' });
  } }), /private_publication_conflict_review_required/);
  assert.equal(await fs.readFile(f.options.runtimeConfigFile, 'utf8'), competingBytes);
  assert.equal((await fs.readdir(f.options.stateDirectory)).some(file => file.endsWith('.tmp')), false);
  await assertDataPreserved(f);
});

function admissionSql(changes = {}) {
  return { unsafe: async (query, values) => {
    if (query.includes('AS session_login')) return [{ login: 'restricted_api', restricted: true, memberships: 0, connect: true,
      database_create: false, session_login: 'restricted_api', ...changes.login }];
    if (query === RPC_CATALOG_QUERY) return RPC_ALLOWLIST.filter(name => name !== changes.missingRpc).map(name => ({ name }));
    if (query.includes('has_function_privilege')) return RPC_ALLOWLIST.map(name => ({ name, executable: name !== changes.deniedRpc,
      direct_grant: name !== changes.publicOnlyRpc }));
    if (query.includes('excessive_write')) return Object.keys(TABLE_ALLOWLIST).map(name => ({ name, rls: name === changes.rlsTable,
      excessive_write: name === changes.excessiveTable }));
    if (query.includes('pg_catalog.pg_policy')) return changes.validRls ? [{ table: changes.rlsTable,
      name: localApiRolePolicyName('restricted_api', 'select'), command: 'r', permissive: true,
      scoped_to_login: true, using_expression: 'true' }, ...(changes.restrictivePolicy ? [{ table: changes.rlsTable,
        name: 'existing-restriction', command: changes.restrictivePolicy, permissive: false, scoped_to_public: true }] : [])] : [];
    if (query.includes('has_column_privilege')) return JSON.parse(values[0]).map(column => ({ ...column,
      available: column.column !== changes.deniedColumn, direct_grant: column.column !== changes.publicOnlyColumn }));
    throw new Error('unexpected probe query');
  } };
}

test('API catalog probe admits zero-membership direct credentials with explicit per-column and RPC grants only', async () => {
  const result = await inspectAttachedApiAdmission({ sql: admissionSql(), apiLogin: 'restricted_api' });
  assert.equal(result.memberships, 0); assert.equal(result.api_role_mode, 'direct'); assert.equal(result.api_login_service_role_grants_modified, false);
  assert.equal(result.rpc_names_granted, 50); assert.equal(result.tables_granted, 5);
  assert.equal(result.database_sql_privileges_exact_allowlist, false); assert.equal(result.application_rows_read, false);
  assert.equal(result.insert_columns_granted, 7);
});

test('API probe rejects elevated roles, SET memberships, missing signatures and PUBLIC-only or excessive grants', async () => {
  for (const changes of [{ login: { restricted: false } }, { login: { memberships: 1 } }, { login: { database_create: true } },
    { login: { session_login: 'keeper_owner' } }, { missingRpc: RPC_ALLOWLIST[0] }, { deniedRpc: RPC_ALLOWLIST[0] },
    { publicOnlyRpc: RPC_ALLOWLIST[0] }, { excessiveTable: Object.keys(TABLE_ALLOWLIST)[0] },
    { deniedColumn: 'client_id' }, { publicOnlyColumn: 'client_id' }, { rlsTable: Object.keys(TABLE_ALLOWLIST)[1] }]) {
    await assert.rejects(inspectAttachedApiAdmission({ sql: admissionSql(changes), apiLogin: 'restricted_api' }),
      error => error.code.startsWith('attached_onboarding_'));
  }
});

test('API admission verifies login-scoped RLS SELECT policy when the exposed table enables RLS', async () => {
  const result = await inspectAttachedApiAdmission({ sql: admissionSql({ rlsTable: Object.keys(TABLE_ALLOWLIST)[1], validRls: true }), apiLogin: 'restricted_api' });
  assert.equal(result.scoped_rls_policies_verified, true); assert.equal(result.rls_semantics_exercised, false);
});

test('applicable restrictive RLS policies require review because permissive login grants cannot override them', async () => {
  for (const command of ['r', '*']) await assert.rejects(inspectAttachedApiAdmission({ apiLogin: 'restricted_api',
    sql: admissionSql({ rlsTable: Object.keys(TABLE_ALLOWLIST)[1], validRls: true, restrictivePolicy: command }) }),
  /api_restrictive_rls_requires_review/);
});

test('private CLI options require protected external file and reject hardlinks or repository secrets', async t => {
  const f = await fixture(t); const file = path.join(f.root, 'owner-setup-options.json');
  await fs.writeFile(file, JSON.stringify(f.options), { mode: 0o600 }); await secureAttachedPrivateFile(file);
  const result = await readAttachedOnboardingOptionsFile(file); assert.equal(result.options.apiLogin, f.options.apiLogin);
  const hardlink = path.join(f.root, 'shared-options.json'); await fs.link(file, hardlink);
  await assert.rejects(readAttachedOnboardingOptionsFile(file), /private_path_invalid/); await fs.unlink(hardlink);
  const misplaced = path.join(f.options.pgDataDirectory, 'options.json');
  await fs.writeFile(misplaced, JSON.stringify(f.options)); await secureAttachedPrivateFile(misplaced);
  await assert.rejects(readAttachedOnboardingOptionsFile(misplaced), /options_file_private_boundary_invalid/);
});

test('Windows credential admission rejects append, permission-change and ownership takeover by an untrusted principal', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t); const file = path.join(f.root, 'owner-options-acl.json');
  await fs.writeFile(file, JSON.stringify(f.options)); await secureAttachedPrivateFile(file);
  const script = `$ErrorActionPreference = 'Stop'
$attachedFile = [Environment]::GetEnvironmentVariable('METAENGINE_ATTACHED_PRIVATE_FILE')
$attachedAcl = [System.IO.File]::GetAccessControl($attachedFile)
$attachedEveryone = [System.Security.Principal.SecurityIdentifier]::new('S-1-1-0')
$attachedAcl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($attachedEveryone, 'AppendData,ChangePermissions,TakeOwnership', 'Allow'))
[System.IO.File]::SetAccessControl($attachedFile, $attachedAcl)
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 30000, stdio: 'ignore', env: { ...process.env, METAENGINE_ATTACHED_PRIVATE_FILE: file } });
  assert.equal(result.status, 0);
  await assert.rejects(readAttachedOnboardingOptionsFile(file), /options_file_permissions_invalid/);
});

test('CLI argument failure emits a fixed code and never echoes arbitrary credential-like arguments', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./attached-postgres-onboarding.mjs', import.meta.url)), '--secret-password', 'private-leak-marker'],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(result.status, 1); assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(result.stderr), { event: 'attached_postgres_onboarding_failed', code: 'attached_onboarding_private_options_file_argument_required' });
  assert.doesNotMatch(result.stderr, /private-leak-marker/);
});
