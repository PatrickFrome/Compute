import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { RPC_ALLOWLIST, RPC_CATALOG_QUERY, TABLE_ALLOWLIST } from './db-api-core.mjs';
import { localApiRolePolicyName, provisionLocalApiLogin } from './db-api-grants.mjs';
import { applyLocalRuntimeMigrations, loadLocalRuntimeMigrationPlan } from './local-runtime-migrations.mjs';
import { verifyOfflineRuntimeBundle } from './offline-runtime-bundle.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fail = code => { throw Object.assign(new Error('attached_onboarding_' + code), { code: 'attached_onboarding_' + code }); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const timestampKey = value => {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) return null;
  const fraction = String(value).match(/\.(\d{1,6})(?:Z|[+-]\d\d(?::?\d\d)?)$/)?.[1] || '';
  return Math.floor(epoch / 1000) + '.' + fraction.padEnd(6, '0');
};
const equal = (left, right) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
const inside = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
};

async function privatePath(value, kind, allowMissingFile = false) {
  if (typeof value !== 'string' || value.length > 2048 || !path.isAbsolute(value)
    || /^(?:\\\\|\/\/)/.test(value) || /[\x00-\x1f]/.test(value)) fail('absolute_local_path_required');
  const absolute = path.resolve(value);
  let current = path.parse(absolute).root;
  for (const segment of path.relative(current, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let item;
    try { item = await fs.lstat(current); }
    catch (error) {
      if (allowMissingFile && current === absolute && error?.code === 'ENOENT') {
        return path.join(await fs.realpath(path.dirname(absolute)), path.basename(absolute));
      }
      fail('private_path_unavailable');
    }
    if (item.isSymbolicLink() || (current !== absolute && !item.isDirectory())) fail('path_alias_forbidden');
    if (current === absolute && (kind === 'directory' ? !item.isDirectory() : !item.isFile() || item.nlink !== 1)) fail('private_path_invalid');
  }
  return fs.realpath(absolute);
}

async function stableBytes(file, maximum = 16384) {
  const physical = await privatePath(file, 'file');
  const before = await fs.lstat(physical);
  if (before.size < 1 || before.size > maximum) fail('private_file_size_invalid');
  const bytes = await fs.readFile(physical);
  const after = await fs.lstat(physical);
  if (bytes.length !== before.size || after.size !== before.size || after.ino !== before.ino
    || after.mtimeMs !== before.mtimeMs) fail('private_file_changed');
  return bytes;
}

function localDatabase(value) {
  let url;
  try { url = new URL(value); } catch { fail('admin_database_url_invalid'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1'
    || !url.username || !url.password || !/^\/[A-Za-z0-9_-]+$/.test(url.pathname) || url.search || url.hash
    || !Number.isSafeInteger(Number(url.port)) || Number(url.port) < 1024 || Number(url.port) > 65535) fail('admin_database_url_invalid');
  try { decodeURIComponent(url.username); decodeURIComponent(url.password); } catch { fail('admin_database_url_invalid'); }
  return url;
}

function validateOptions(options) {
  if (options?.ownerAction !== 'ONBOARD_EXISTING_LOCAL_POSTGRES_17') fail('explicit_owner_action_required');
  if (!sha(options.expectedBundleDigest) || !sha(options.expectedMigrationSourcesSha256)) fail('source_pins_required');
  if (!/^[1-9][0-9]{0,19}$/.test(options.expectedClusterSystemIdentifier || '')
    || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(options.expectedPostmasterStartedAt || '')
    || !Number.isFinite(Date.parse(options.expectedPostmasterStartedAt))) fail('existing_cluster_binding_required');
  const admin = localDatabase(options.adminDatabaseUrl);
  if (!/^[a-z][a-z0-9_]{3,62}$/.test(options.apiLogin || '') || typeof options.apiPassword !== 'string'
    || options.apiPassword.length < 32 || options.apiPassword.length > 1024 || /[\x00-\x1f]/.test(options.apiPassword)
    || options.apiLogin === decodeURIComponent(admin.username) || options.apiPassword === decodeURIComponent(admin.password)
    || options.apiLogin === 'service_role' || options.apiLogin.startsWith('pg_')) fail('separate_restricted_api_credentials_required');
  if ([options.apiPort, options.edgePort].some(port => !Number.isSafeInteger(port) || port < 1024 || port > 65535)
    || new Set([Number(admin.port), options.apiPort, options.edgePort]).size !== 3) fail('distinct_ports_required');
  const startupTimeoutMs = options.startupTimeoutMs ?? 60000;
  if (!Number.isSafeInteger(startupTimeoutMs) || startupTimeoutMs < 1000 || startupTimeoutMs > 300000) fail('startup_timeout_invalid');
  return { admin, startupTimeoutMs };
}

// Only current owner and SYSTEM can read newly staged credentials on Windows.
// ACL is applied while the exclusive temporary file is still empty.
export async function secureAttachedPrivateFile(file) {
  if (process.platform !== 'win32') return fs.chmod(file, 0o600);
  const script = `$ErrorActionPreference = 'Stop'
$attachedFile = [Environment]::GetEnvironmentVariable('METAENGINE_ATTACHED_PRIVATE_FILE')
$attachedIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$attachedAcl = New-Object System.Security.AccessControl.FileSecurity
$attachedAcl.SetAccessRuleProtection($true, $false)
$attachedAcl.SetOwner($attachedIdentity.User)
$attachedAcl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($attachedIdentity.User, 'Read,Write,ReadPermissions,Delete', 'Allow'))
$attachedSystem = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$attachedAcl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($attachedSystem, 'FullControl', 'Allow'))
[System.IO.File]::SetAccessControl($attachedFile, $attachedAcl)
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, shell: false, timeout: 30000, stdio: 'ignore', env: { ...process.env, METAENGINE_ATTACHED_PRIVATE_FILE: file } });
  if (result.status !== 0) fail('private_file_acl_failed');
}

async function assertPrivateCredentialPermissions(file) {
  if (process.platform !== 'win32') {
    if ((await fs.stat(file)).mode & 0o077) fail('options_file_permissions_invalid');
    return;
  }
  const script = `$ErrorActionPreference = 'Stop'
$attachedFile = [Environment]::GetEnvironmentVariable('METAENGINE_ATTACHED_PRIVATE_FILE')
$attachedIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$attachedAllowed = @($attachedIdentity, 'S-1-5-18', 'S-1-5-32-544')
$attachedAcl = [System.IO.File]::GetAccessControl($attachedFile)
foreach ($attachedRule in $attachedAcl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
  if ($attachedRule.AccessControlType -eq 'Allow' -and (($attachedRule.FileSystemRights -band 0xC0007) -ne 0) -and $attachedRule.IdentityReference.Value -notin $attachedAllowed) { exit 2 }
}
exit 0
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, shell: false, timeout: 30000, stdio: 'ignore', env: { ...process.env, METAENGINE_ATTACHED_PRIVATE_FILE: file } });
  if (result.status !== 0) fail('options_file_permissions_invalid');
}

export async function readAttachedOnboardingOptionsFile(file) {
  const physical = await privatePath(file, 'file');
  if (inside(await fs.realpath(repository), physical)) fail('options_file_private_boundary_invalid');
  await assertPrivateCredentialPermissions(physical);
  const bytes = await stableBytes(physical);
  let options;
  try { options = JSON.parse(bytes.toString('utf8')); } catch { fail('options_file_json_invalid'); }
  validateOptions(options);
  for (const directory of [options.bundleDirectory, options.pgDataDirectory, options.stateDirectory]) {
    if (inside(await privatePath(directory, 'directory'), physical)) fail('options_file_private_boundary_invalid');
  }
  return { options: Object.freeze(options), sourceSha256: digest(bytes), sourceFile: physical };
}

const identityQuery = `SELECT current_setting('server_version_num')::int AS version,
  current_setting('data_directory') AS data_directory, host(inet_server_addr()) AS address,
  inet_server_port() AS port, current_database() AS database, session_user AS login,
  pg_catalog.to_char(pg_postmaster_start_time() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS started_at,
  (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS system_identifier,
  current_setting('transaction_read_only') = 'off' AS writable,
  current_setting('pgaudit.log', true) AS audit_log,
  r.rolsuper AS superuser, r.rolcanlogin AS can_login
  FROM pg_catalog.pg_roles r WHERE r.rolname = session_user`;

async function inspectIdentity(sql, options, physical, admin, pidBytes) {
  const [record] = await sql.unsafe(identityQuery);
  if (!record || record.version < 170000 || record.version >= 180000 || record.address !== '127.0.0.1'
    || record.port !== Number(admin.port) || record.database !== admin.pathname.slice(1) || record.login !== decodeURIComponent(admin.username)
    || record.system_identifier !== options.expectedClusterSystemIdentifier || record.superuser !== true || record.can_login !== true
    || record.writable !== true || timestampKey(record.started_at) !== timestampKey(options.expectedPostmasterStartedAt)) fail('live_cluster_binding_unattested');
  if (record.audit_log && record.audit_log !== 'none') fail('credential_audit_logging_requires_review');
  if (!equal(await privatePath(record.data_directory, 'directory'), physical.data)) fail('live_data_directory_mismatch');
  const lines = pidBytes.toString('utf8').trim().split(/\r?\n/);
  if (!Number.isSafeInteger(Number(lines[0])) || Number(lines[0]) <= 0 || Number(lines[3]) !== Number(admin.port)
    || Number(lines[2]) !== Math.floor(Date.parse(record.started_at) / 1000)
    || !equal(await privatePath(lines[1], 'directory'), physical.data)) fail('postmaster_file_binding_unattested');
  return { systemIdentifier: record.system_identifier, startedAt: new Date(record.started_at).toISOString() };
}

export async function inspectAttachedApiAdmission({ sql, apiLogin, expectedSessionLogin = apiLogin }) {
  const [login] = await sql.unsafe(`SELECT r.rolname AS login,
    NOT r.rolsuper AND NOT r.rolinherit AND NOT r.rolcreatedb AND NOT r.rolcreaterole
      AND NOT r.rolreplication AND NOT r.rolbypassrls AND r.rolcanlogin AS restricted,
    (SELECT count(*)::int FROM pg_catalog.pg_auth_members m WHERE m.member = r.oid) AS memberships,
    pg_catalog.has_database_privilege(r.oid, current_database(), 'CONNECT') AS connect,
    pg_catalog.has_database_privilege(r.oid, current_database(), 'CREATE') AS database_create,
    session_user AS session_login
    FROM pg_catalog.pg_roles r WHERE r.rolname = current_user`);
  if (login?.login !== apiLogin || login.restricted !== true || login.memberships !== 0 || login.connect !== true
    || login.database_create !== false || login.session_login !== expectedSessionLogin) fail('restricted_api_login_unattested');
  const signatures = await sql.unsafe(RPC_CATALOG_QUERY, [JSON.stringify(RPC_ALLOWLIST)]);
  if (!Array.isArray(signatures) || signatures.length !== RPC_ALLOWLIST.length
    || RPC_ALLOWLIST.some(name => signatures.filter(signature => signature.name === name).length !== 1)) fail('api_rpc_catalog_incomplete');
  const grants = await sql.unsafe(`SELECT p.proname AS name,
    pg_catalog.has_function_privilege(current_user, p.oid, 'EXECUTE') AS executable,
    EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
      WHERE r.rolname = current_user AND a.privilege_type = 'EXECUTE' AND NOT a.is_grantable) AS direct_grant
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.proname::text IN (SELECT pg_catalog.jsonb_array_elements_text($1::text::jsonb))`, [JSON.stringify(RPC_ALLOWLIST)]);
  if (RPC_ALLOWLIST.some(name => !grants.some(row => row.name === name && row.executable === true && row.direct_grant === true))) fail('api_rpc_grants_unattested');
  const columns = Object.entries(TABLE_ALLOWLIST).flatMap(([table, policy]) => [
    ...[...new Set([...policy.select, ...policy.filters, ...policy.order])].map(column => ({ table, column, privilege: 'SELECT' })),
    ...(policy.insert || []).map(column => ({ table, column, privilege: 'INSERT' })),
  ]);
  const tables = await sql.unsafe(`SELECT c.relname AS name,
    c.relrowsecurity AS rls,
    pg_catalog.has_table_privilege(current_user, c.oid, 'UPDATE,DELETE,TRUNCATE,TRIGGER') AS excessive_write
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
      AND c.relname::text IN (SELECT pg_catalog.jsonb_array_elements_text($1::text::jsonb))`, [JSON.stringify(Object.keys(TABLE_ALLOWLIST))]);
  if (Object.keys(TABLE_ALLOWLIST).some(name => !tables.some(row => row.name === name && row.excessive_write === false))) fail('api_table_grants_unattested');
  const policies = await sql.unsafe(`SELECT c.relname AS table, p.polname AS name, p.polcmd AS command,
    p.polpermissive AS permissive, r.oid = ANY(p.polroles) AS scoped_to_login,
    0::oid = ANY(p.polroles) AS scoped_to_public,
    pg_catalog.pg_get_expr(p.polqual, p.polrelid) AS using_expression,
    pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) AS check_expression
    FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_roles r ON r.rolname = current_user
    WHERE n.nspname = 'public' AND c.relname::text IN (SELECT pg_catalog.jsonb_array_elements_text($1::text::jsonb))`,
  [JSON.stringify(Object.keys(TABLE_ALLOWLIST))]);
  for (const table of tables.filter(table => table.rls)) {
    if (policies.some(policy => policy.table === table.name && policy.permissive === false
      && (policy.scoped_to_login === true || policy.scoped_to_public === true)
      && (policy.command === '*' || policy.command === 'r' || (policy.command === 'a' && TABLE_ALLOWLIST[table.name].insert)))) {
      fail('api_restrictive_rls_requires_review');
    }
    const select = policies.some(policy => policy.table === table.name && policy.name === localApiRolePolicyName(apiLogin, 'select')
      && policy.command === 'r' && policy.permissive === true && policy.scoped_to_login === true && policy.using_expression === 'true');
    const insert = !TABLE_ALLOWLIST[table.name].insert || policies.some(policy => policy.table === table.name
      && policy.name === localApiRolePolicyName(apiLogin, 'insert') && policy.command === 'a' && policy.permissive === true
      && policy.scoped_to_login === true && policy.check_expression === 'true');
    if (!select || !insert) fail('api_rls_policy_unattested');
  }
  const columnGrants = await sql.unsafe(`SELECT x->>'table' AS table, x->>'column' AS column, x->>'privilege' AS privilege,
    pg_catalog.has_column_privilege(current_user, c.oid, a.attnum, x->>'privilege') AS available,
    EXISTS (SELECT 1 FROM pg_catalog.aclexplode(a.attacl) acl JOIN pg_catalog.pg_roles r ON r.oid = acl.grantee
      WHERE r.rolname = current_user AND acl.privilege_type = x->>'privilege' AND NOT acl.is_grantable) AS direct_grant
    FROM pg_catalog.jsonb_array_elements($1::text::jsonb) x
    JOIN pg_catalog.pg_namespace n ON n.nspname = 'public'
    JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid AND c.relname = x->>'table'
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attname = x->>'column' AND NOT a.attisdropped`, [JSON.stringify(columns)]);
  if (columns.some(column => !columnGrants.some(row => row.table === column.table && row.column === column.column
    && row.privilege === column.privilege && row.available === true && row.direct_grant === true))) fail('api_column_grants_unattested');
  return Object.freeze({ restricted_login: true, memberships: 0, api_role_mode: 'direct', rpc_names_granted: RPC_ALLOWLIST.length,
    tables_granted: Object.keys(TABLE_ALLOWLIST).length, select_columns_granted: columns.filter(column => column.privilege === 'SELECT').length,
    insert_columns_granted: columns.filter(column => column.privilege === 'INSERT').length,
    api_login_service_role_grants_modified: false, scoped_rls_policies_verified: true,
    rls_semantics_exercised: false, database_sql_privileges_exact_allowlist: false, application_rows_read: false });
}

async function publishConfig(configFile, config, secureFile) {
  const temporary = path.join(path.dirname(configFile), `.attached-runtime-config-${randomUUID()}.tmp`);
  let published = false;
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try {
      await secureFile(temporary);
      await handle.writeFile(JSON.stringify(config, null, 2) + '\n');
      await handle.sync();
    } finally { await handle.close(); }
    await fs.link(temporary, configFile);
    published = true;
  } finally {
    try { await fs.unlink(temporary); }
    catch (error) { if (error?.code !== 'ENOENT') fail('private_config_staging_cleanup_requires_review'); }
  }
  if (!published) fail('private_config_publication_failed_review_required');
  await privatePath(configFile, 'file');
}

// A setup operation only: cluster lifecycle and browser owner publication belong
// to their own qualified runtime flow. This function never executes PG tools.
export async function onboardAttachedPostgres(options = {}, hooks = {}) {
  const { admin, startupTimeoutMs } = validateOptions(options);
  let sql;
  let apiSql;
  let lockFile;
  let lockBytes;
  let effectsPossible = false;
  let configPublished = false;
  try {
    const [bundle, state, data, configFile, source] = await Promise.all([
      privatePath(options.bundleDirectory, 'directory'), privatePath(options.stateDirectory, 'directory'),
      privatePath(options.pgDataDirectory, 'directory'), privatePath(options.runtimeConfigFile, 'file', true), fs.realpath(repository),
    ]);
    const physical = { bundle, state, data, configFile };
    if (inside(bundle, state) || inside(state, bundle) || inside(source, state) || inside(state, source)
      || inside(state, data) || inside(data, state) || inside(bundle, data) || inside(data, bundle)
      || inside(source, data) || inside(data, source) || !inside(state, configFile) || state === configFile) fail('private_layout_invalid');
    try { await fs.lstat(configFile); fail('private_config_already_exists'); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    const versionFile = path.join(data, 'PG_VERSION');
    const vaultFile = path.join(data, 'client-vault.key');
    const pidFile = path.join(data, 'postmaster.pid');
    const [versionBytes, vaultBytes, pidBytes] = await Promise.all([
      stableBytes(versionFile, 16), stableBytes(vaultFile, 128), stableBytes(pidFile, 16384), privatePath(path.join(data, 'global', 'pg_control'), 'file'),
    ]);
    if (versionBytes.toString('utf8').trim() !== '17' || !/^[a-f0-9]{64}\n$/.test(vaultBytes.toString('utf8'))) fail('existing_pg17_vault_required');
    const verified = await (hooks.verifyBundle || verifyOfflineRuntimeBundle)({ bundleDirectory: bundle, expectedBundleDigest: options.expectedBundleDigest });
    if (verified?.manifest?.bundle_sha256 !== options.expectedBundleDigest) fail('bundle_unattested');
    const plan = await (hooks.loadMigrationPlan || loadLocalRuntimeMigrationPlan)();
    if (plan?.source_manifest_sha256 !== options.expectedMigrationSourcesSha256) fail('migration_source_pin_mismatch');
    const connect = hooks.connect || ((url) => postgres(url, { max: 1, prepare: false, connect_timeout: 5,
      idle_timeout: 10, debug: false, onnotice: () => {}, onparameter: () => {} }));
    sql = connect(admin.href);
    await inspectIdentity(sql, options, physical, admin, pidBytes);
    const [capability] = await sql.unsafe(`SELECT pg_catalog.has_database_privilege(current_user, current_database(), 'CREATE') AS database_create,
      pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE') AS public_create,
      pg_catalog.has_schema_privilege(current_user, 'destruktion_meta', 'CREATE') AS internal_create`);
    if (capability?.database_create !== true || capability.public_create !== true || capability.internal_create !== true) fail('migration_capability_unattested');
    // Runtime host and setup acquire the same exclusive pathname. Neither may
    // race a schema/role update against a running API process.
    lockFile = path.join(state, 'runtime-host-lock.json');
    lockBytes = JSON.stringify({ schema: 'compute.attached-postgres-onboarding-lock.v1', nonce: randomUUID(), pid: process.pid }) + '\n';
    const lock = await fs.open(lockFile, 'wx', 0o600);
    try { await lock.writeFile(lockBytes); await lock.sync(); } finally { await lock.close(); }
    effectsPossible = true;
    const migrationReceipt = await sql.begin(async tx => {
      await tx.unsafe("SET LOCAL lock_timeout = '3s'");
      await tx.unsafe("SET LOCAL statement_timeout = '60s'");
      // Prevent standard PostgreSQL statement/parameter logs from recording
      // the new role password; unsupported controls fail before provisioning.
      await tx.unsafe("SET LOCAL log_statement = 'none'");
      await tx.unsafe("SET LOCAL log_min_error_statement = 'panic'");
      await tx.unsafe('SET LOCAL log_parameter_max_length = 0');
      await tx.unsafe('SET LOCAL log_parameter_max_length_on_error = 0');
      await tx.unsafe('SET LOCAL log_min_duration_statement = -1');
      await tx.unsafe('SET LOCAL log_min_duration_sample = -1');
      await tx.unsafe('SET LOCAL log_transaction_sample_rate = 0');
      await inspectIdentity(tx, options, physical, admin, pidBytes);
      const transaction = { unsafe: tx.unsafe.bind(tx), begin: run => run(tx) };
      const receipt = await (hooks.applyMigrations || applyLocalRuntimeMigrations)({ sql: transaction, expectedMigrationSourcesSha256: options.expectedMigrationSourcesSha256 });
      if (receipt?.source_manifest_sha256 !== options.expectedMigrationSourcesSha256) fail('migration_receipt_unattested');
      await (hooks.provisionApiLogin || provisionLocalApiLogin)({ sql: transaction, databaseName: admin.pathname.slice(1),
        login: options.apiLogin, password: options.apiPassword, roleMode: 'direct' });
      await tx.unsafe('SET LOCAL ROLE "' + options.apiLogin + '"');
      await (hooks.inspectApiAdmission || inspectAttachedApiAdmission)({ sql: tx, apiLogin: options.apiLogin, expectedSessionLogin: decodeURIComponent(admin.username) });
      await tx.unsafe('RESET ROLE');
      return receipt;
    });
    const api = new URL(admin.href); api.username = options.apiLogin; api.password = options.apiPassword;
    apiSql = connect(api.href);
    const admission = await (hooks.inspectApiAdmission || inspectAttachedApiAdmission)({ sql: apiSql, apiLogin: options.apiLogin });
    if (admission?.restricted_login !== true || admission.api_role_mode !== 'direct' || admission.memberships !== 0
      || admission.rpc_names_granted !== RPC_ALLOWLIST.length || admission.tables_granted !== Object.keys(TABLE_ALLOWLIST).length) fail('api_reconnect_admission_unattested');
    await inspectIdentity(sql, options, physical, admin, pidBytes);
    if (!(await stableBytes(versionFile, 16)).equals(versionBytes) || !(await stableBytes(vaultFile, 128)).equals(vaultBytes)
      || !(await stableBytes(pidFile, 16384)).equals(pidBytes)) fail('existing_cluster_files_changed');
    await (hooks.verifyBundle || verifyOfflineRuntimeBundle)({ bundleDirectory: bundle, expectedBundleDigest: options.expectedBundleDigest });
    if (hooks.beforePublish) await hooks.beforePublish();
    if (!equal(await privatePath(state, 'directory'), state) || !equal(await privatePath(path.dirname(configFile), 'directory'), path.dirname(configFile))) fail('private_layout_changed');
    await publishConfig(configFile, { schema: 'compute.runtime-host-config.v1', version: 1, bundle_directory: bundle,
      expected_bundle_sha256: options.expectedBundleDigest, state_directory: state, pg_data_directory: data,
      expected_cluster_system_identifier: options.expectedClusterSystemIdentifier,
      postgres_mode: 'attached', api_role_mode: 'direct', database_url: api.href, inspect_database_url: admin.href,
      api_port: options.apiPort, edge_port: options.edgePort, startup_timeout_ms: startupTimeoutMs }, hooks.secureFile || secureAttachedPrivateFile);
    configPublished = true;
    if (!(await stableBytes(lockFile)).equals(Buffer.from(lockBytes))) fail('setup_lock_changed_review_required');
    await fs.unlink(lockFile);
    lockFile = null;
    return Object.freeze({ schema: 'compute.attached-postgres-onboarding-receipt.v1', state: 'CONFIGURED_UNQUALIFIED',
      postgres_mode: 'attached', api_role_mode: 'direct', cluster_binding_verified: true, existing_vault_preserved: true,
      database_initialized: false, postgres_started: false, postgres_stopped: false, runtime_config_written: true,
      admin_credential_separate: true, credentials_exported: false, source_manifest_sha256: migrationReceipt.source_manifest_sha256,
      migrations: migrationReceipt.migrations, restricted_api_admission: admission, runtime_ready: false, owner_profile_written: false,
      installed_socket_ui_smoke_required: true, automatic_cloud_fallback: false, authority_effect: false });
  } catch (error) {
    if (error?.code?.startsWith('attached_onboarding_')) throw error;
    if (error?.code === 'EEXIST') fail(effectsPossible ? 'private_publication_conflict_review_required' : 'exclusive_setup_conflict');
    fail(configPublished ? 'configured_cleanup_requires_review' : effectsPossible ? 'incomplete_review_required' : 'preflight_failed');
  } finally {
    await Promise.allSettled([sql?.end?.({ timeout: 5 }), apiSql?.end?.({ timeout: 5 })]);
    // Any possible DB effect retains the exclusive setup lock on failure.
    // No automatic retry, DROP ROLE, credential rotation or cluster repair.
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--options-file') fail('private_options_file_argument_required');
    const source = await readAttachedOnboardingOptionsFile(process.argv[3]);
    const receipt = await onboardAttachedPostgres(source.options, { beforePublish: async () => {
      if (digest(await stableBytes(source.sourceFile)) !== source.sourceSha256) fail('options_file_changed');
    } });
    console.log(JSON.stringify(receipt));
  } catch (error) {
    const code = error?.code?.startsWith('attached_onboarding_') ? error.code : 'attached_onboarding_failed';
    console.error(JSON.stringify({ event: 'attached_postgres_onboarding_failed', code }));
    process.exitCode = 1;
  }
}
