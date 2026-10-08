import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RPC_ALLOWLIST, TABLE_ALLOWLIST } from './db-api-core.mjs';
import { verifyOfflineRuntimeBundle } from './offline-runtime-bundle.mjs';
import { validateRuntimeHostConfig, validateRuntimeHostPhysicalBoundaries } from './runtime-host.mjs';
import { provisionPersistentClientProvider } from './persistent-client-provider.mjs';
import { localStateProviderOwnerFile, validateLocalStateProviderConfig, validateLocalStateRuntimeIdentity,
  localStateProviderHealthAttested } from '../../apps/metaengine-browser/src/local-state-provider-policy.mjs';
import { startConfiguredLocalRuntimeHost, stopOwnedLocalRuntimeHost } from '../../apps/metaengine-browser/src/local-runtime-host-controller.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error('restored_provider_' + code); };
const equalPath = (left, right) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
const within = (root, target) => { const relative = path.relative(root, target); return !relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep)); };
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

async function privatePath(value, kind, allowMissing = false) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /^(?:\\\\|\/\/)/.test(value) || /[\x00-\x1f]/.test(value)) fail('private_path_invalid');
  const absolute = path.resolve(value);
  let current = path.parse(absolute).root;
  let closestExisting = current;
  for (const part of path.relative(current, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let info;
    try { info = await fs.lstat(current); }
    catch (error) { if (allowMissing && error.code === 'ENOENT') continue; fail('private_path_unavailable'); }
    if (info.isSymbolicLink() || (current !== absolute && !info.isDirectory())) fail('private_path_alias_forbidden');
    if (current === absolute && (kind === 'directory' ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)) fail('private_path_invalid');
    closestExisting = current;
  }
  // Compare even missing owner destinations using their nearest existing
  // physical ancestor. A Windows 8.3 spelling must not bypass a bundle or
  // repository boundary before the destination directory is created.
  if (allowMissing) return path.join(await fs.realpath(closestExisting),path.relative(closestExisting,absolute));
  const physical = await fs.realpath(absolute);
  if (process.platform !== 'win32' && !equalPath(physical, absolute)) fail('private_path_alias_forbidden');
  return physical;
}

async function bytes(file, maximum = 16384) {
  const physical = await privatePath(file, 'file');
  const info = await fs.lstat(physical);
  if (info.size < 1 || info.size > maximum) fail('private_file_size_invalid');
  const content = await fs.readFile(physical);
  const after = await fs.lstat(physical);
  if (content.length !== info.size || after.size !== info.size || after.ino !== info.ino || after.mtimeMs !== info.mtimeMs) fail('private_file_changed');
  return content;
}

function json(content) { try { return JSON.parse(content.toString('utf8')); } catch { fail('private_json_invalid'); } }

function localDatabase(value) {
  let url;
  try { url = new URL(value); } catch { fail('database_url_invalid'); }
  if (!['postgresql:', 'postgres:'].includes(url.protocol) || url.hostname !== '127.0.0.1'
    || !url.username || !url.password || !/^\/[a-zA-Z0-9_-]+$/.test(url.pathname) || url.search || url.hash
    || !Number.isSafeInteger(Number(url.port)) || Number(url.port) < 1024 || Number(url.port) > 65535) fail('database_url_invalid');
  return url;
}

// This is a catalog/grant probe only. It never reads application rows, changes
// roles or grants, initializes a cluster, restores a dump or repairs an owner.
const literals = values => values.map(value => "'" + value.replaceAll("'", "''") + "'").join(',');
const rpcNames = literals(RPC_ALLOWLIST);
const tableNames = literals(Object.keys(TABLE_ALLOWLIST));
const insertColumns = TABLE_ALLOWLIST.compute_fabric_a2_browser_device_enrollment_request_h205f22.insert;
const admissionQuery = `SELECT json_build_object(
  'restricted_login', NOT r.rolsuper AND NOT r.rolinherit AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolbypassrls AND r.rolcanlogin,
  'login', current_user,
  'explicit_service_role', EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles parent ON parent.oid=m.roleid WHERE m.member=r.oid AND parent.rolname='service_role' AND NOT m.inherit_option AND m.set_option),
  'other_memberships', (SELECT count(*) FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles parent ON parent.oid=m.roleid WHERE m.member=r.oid AND parent.rolname<>'service_role'),
  'service_boundary', EXISTS (SELECT 1 FROM pg_catalog.pg_roles s WHERE s.rolname='service_role' AND NOT s.rolcanlogin AND NOT s.rolsuper AND NOT s.rolcreatedb AND NOT s.rolcreaterole AND NOT s.rolreplication),
  'rpc_functions', (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND p.proname IN (${rpcNames})),
  'rpc_names_granted', (SELECT count(DISTINCT p.proname) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND p.proname IN (${rpcNames}) AND has_function_privilege('service_role',p.oid,'EXECUTE')),
  'tables_granted', (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname IN (${tableNames}) AND has_table_privilege('service_role',c.oid,'SELECT')),
  'insert_columns_granted', (${insertColumns.map(column => `has_column_privilege('service_role','public.compute_fabric_a2_browser_device_enrollment_request_h205f22','${column}','INSERT')`).join(' AND ')})
)::text FROM pg_catalog.pg_roles r WHERE r.rolname=current_user`;

export async function inspectRestoredApiAdmission({ databaseUrl, postgresBinDirectory }) {
  const url = localDatabase(databaseUrl);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^PG/i.test(key)) delete env[key];
  Object.assign(env, { PGHOST: '127.0.0.1', PGPORT: url.port, PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: url.pathname.slice(1), PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '3' });
  const output = await new Promise((resolve, reject) => {
    const child = spawn(path.join(postgresBinDirectory, process.platform === 'win32' ? 'psql.exe' : 'psql'),
      ['-X', '--no-password', '-v', 'ON_ERROR_STOP=1', '-At', '-c', admissionQuery], { env, windowsHide: true, shell: false, stdio: ['ignore','pipe','ignore'] });
    let content = ''; let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill(); finish(new Error('restored_provider_api_admission_timeout')); }, 10000);
    child.stdout.on('data', data => { content += data; if (content.length > 16384) { child.kill(); finish(new Error('restored_provider_api_admission_failed')); } });
    child.once('error', () => finish(new Error('restored_provider_api_admission_failed')));
    child.once('close', code => finish(code === 0 ? null : new Error('restored_provider_api_admission_failed'), content.trim()));
  });
  const value = json(Buffer.from(output));
  if (value.login !== decodeURIComponent(url.username) || value.restricted_login !== true || value.explicit_service_role !== true
    || value.other_memberships !== 0 || value.service_boundary !== true || value.rpc_functions !== RPC_ALLOWLIST.length
    || value.rpc_names_granted !== RPC_ALLOWLIST.length || value.tables_granted !== Object.keys(TABLE_ALLOWLIST).length
    || value.insert_columns_granted !== true) fail('api_admission_unattested');
  return Object.freeze({ restricted_login: true, explicit_service_role: true, rpc_names_granted: RPC_ALLOWLIST.length,
    tables_granted: Object.keys(TABLE_ALLOWLIST).length, insert_columns_granted: true, application_rows_read: false });
}

export async function provisionRestoredClientProvider(options = {}, hooks = {}) {
  if (options.ownerChoice !== 'LOCAL_POSTGRES' || options.ownerAction !== 'USE_EXISTING_RESTORED_POSTGRES_17') fail('explicit_owner_choice_required');
  if (!sha(options.expectedBundleDigest) || !sha(options.expectedRestoreReceiptSha256)
    || (options.expectedDumpSha256 !== undefined && !sha(options.expectedDumpSha256))) fail('source_pins_required');
  let started = false;
  let cleaned = false;
  const stop = hooks.stopHost || stopOwnedLocalRuntimeHost;
  try {
    const [state, data, configFile, bundle, restoreFile, physicalRepository] = await Promise.all([
      privatePath(options.stateDirectory, 'directory'), privatePath(options.pgDataDirectory, 'directory'),
      privatePath(options.privateConfigFile, 'file'), privatePath(options.bundleDirectory, 'directory'),
      privatePath(options.restoreReceiptFile, 'file'), fs.realpath(repository),
    ]);
    validateRuntimeHostPhysicalBoundaries({ bundleDirectory: bundle, stateDirectory: state, pgDataDirectory: data,
      privateConfigFile: configFile, repositoryDirectory: physicalRepository });
    if (!within(state, configFile) || within(data, configFile) || within(bundle, restoreFile) || within(physicalRepository, restoreFile)) fail('private_file_boundary_invalid');
    const ownerExpected = localStateProviderOwnerFile({ env: { APPDATA: options.appDataDirectory }, platform: 'win32' });
    if (!ownerExpected || !equalPath(path.resolve(options.ownerFile || ''), path.resolve(ownerExpected))) fail('owner_file_invalid');
    const ownerDirectory = await privatePath(path.dirname(options.ownerFile), 'directory', true);
    if (within(bundle, ownerDirectory) || within(physicalRepository, ownerDirectory) || within(data, ownerDirectory)) fail('owner_file_invalid');
    try { await fs.lstat(options.ownerFile); fail('owner_file_exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const configBytes = await bytes(configFile);
    const config = validateRuntimeHostConfig(json(configBytes));
    if (!equalPath(await fs.realpath(config.state_directory), state) || !equalPath(await fs.realpath(config.pg_data_directory), data)
      || !equalPath(await fs.realpath(config.bundle_directory), bundle) || config.expected_bundle_sha256 !== options.expectedBundleDigest) fail('private_config_binding_mismatch');
    const api = localDatabase(config.database_url); const inspect = localDatabase(config.inspect_database_url);
    if (api.port !== inspect.port || api.pathname !== inspect.pathname || api.username === inspect.username
      || new Set([Number(api.port),config.api_port,config.edge_port]).size !== 3
      || [config.api_port,config.edge_port].some(port => !Number.isSafeInteger(port) || port < 1024 || port > 65535)) fail('private_config_database_binding_invalid');
    if ((await bytes(path.join(data,'PG_VERSION'),16)).toString().trim() !== '17') fail('existing_pg17_required');
    await privatePath(path.join(data,'global','pg_control'),'file');
    const vaultFile = path.join(data,'client-vault.key'); const vaultBytes = await bytes(vaultFile,128);
    if (!/^[a-f0-9]{64}\n$/.test(vaultBytes.toString())) fail('existing_vault_key_required');
    try { await fs.lstat(path.join(data,'postmaster.pid')); fail('existing_postmaster_state_requires_review'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const restoreBytes = await bytes(restoreFile,4*1024*1024);
    if (digest(restoreBytes) !== options.expectedRestoreReceiptSha256) fail('restore_receipt_pin_mismatch');
    const receipt = json(restoreBytes);
    if (receipt.schema !== 'metaengine.database-restore-report.v1' || receipt.data_verified !== true || receipt.schema_verified !== true
      || !Array.isArray(receipt.errors) || receipt.errors.length || !Array.isArray(receipt.ddl_adaptations) || !sha(receipt.source_dump_sha256)
      || (options.expectedDumpSha256 !== undefined && receipt.source_dump_sha256 !== options.expectedDumpSha256)) fail('restore_evidence_unverified');
    const verified = await (hooks.verifyBundle || verifyOfflineRuntimeBundle)({ bundleDirectory: bundle, expectedBundleDigest: options.expectedBundleDigest });
    const publicConfig = validateLocalStateProviderConfig({ schema:'metaengine.browser.local-state-provider-config.v1',version:1,
      profile:'CLIENT_LOCAL_POSTGRES_V1',provider:'LOCAL_POSTGRES',base_url:`http://127.0.0.1:${config.edge_port}/a2-browser-native-supervisor-v1`,
      runtime_identity_file:path.join(state,'runtime-instance.json'),runtime_host:{bundle_directory:bundle,expected_bundle_sha256:options.expectedBundleDigest,config_file:configFile},authority_effect:false });
    // No owner file exists while a candidate runtime is starting or while its
    // independent status, role admission and health are being checked.
    started = true;
    const runtime = await (hooks.startHost || startConfiguredLocalRuntimeHost)({ config: publicConfig, env: { ...process.env } });
    const status = validateLocalStateRuntimeIdentity(json(await bytes(publicConfig.runtime_identity_file,65536)),publicConfig.base_url);
    if (runtime?.state !== 'READY' || runtime.runtime_owned !== true || runtime.authority_effect !== false || runtime.instance_id !== status.instance_id
      || runtime.endpoint !== publicConfig.base_url || !equalPath(path.resolve(runtime.status_file || ''), publicConfig.runtime_identity_file)) fail('host_identity_unattested');
    await (hooks.inspectApiAdmission || inspectRestoredApiAdmission)({ databaseUrl:config.database_url,postgresBinDirectory:verified.paths.postgresBinDirectory });
    const response = await (hooks.fetchImpl || globalThis.fetch)(`${publicConfig.base_url}/health`, { method:'GET',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(3000) });
    if (!response?.ok || !localStateProviderHealthAttested(await response.json(),status.instance_id)) fail('health_unattested');
    const cleanup = await stop();
    if (cleanup?.cleanup_confirmed !== true) fail('cleanup_unconfirmed');
    cleaned = true;
    if (!(await bytes(configFile)).equals(configBytes) || !(await bytes(vaultFile,128)).equals(vaultBytes)
      || !(await bytes(restoreFile,4*1024*1024)).equals(restoreBytes)) fail('private_input_changed');
    // Reverify resources after the subprocess cycle, then exclusively publish
    // the durable descriptor. A concurrent owner is preserved by the existing
    // provisioner's hard-link publication; no replacement path is available.
    await (hooks.verifyBundle || verifyOfflineRuntimeBundle)({bundleDirectory:bundle,expectedBundleDigest:options.expectedBundleDigest});
    await provisionPersistentClientProvider({ ownerChoice:options.ownerChoice,ownerFile:options.ownerFile,appDataDirectory:options.appDataDirectory,
      baseUrl:publicConfig.base_url,runtimeIdentityFile:publicConfig.runtime_identity_file,runtimeHost:publicConfig.runtime_host });
    return Object.freeze({schema:'compute.restored-client-provider-provisioning.v1',state:'CONFIGURED',provider:'LOCAL_POSTGRES',
      existing_restored_database_selected:true,source_restore_receipt_verified:true,database_initialized:false,owner_profile_written:true,runtime_ready:false,cleanup_confirmed:true,
      attested_instance_id:status.instance_id,source_dump_sha256:receipt.source_dump_sha256,source_restore_receipt_sha256:options.expectedRestoreReceiptSha256,
      bundle_sha256:options.expectedBundleDigest,private_vault_key_preserved:true,source_schema_exact:receipt.ddl_adaptations.length===0,authority_effect:false});
  } catch (error) {
    if (started && !cleaned) {
      let cleanup;
      try { cleanup = await stop(); } catch { fail('cleanup_unconfirmed'); }
      if (cleanup?.cleanup_confirmed !== true) fail('cleanup_unconfirmed');
    }
    const message = String(error?.message || '');
    if (/^restored_provider_[a-z0-9_]+$/.test(message)) throw new Error(message);
    // Filesystem, driver and host errors may contain private configuration.
    fail(error?.code === 'EEXIST' || message === 'persistent_client_owner_file_exists' ? 'owner_file_exists' : 'provisioning_failed');
  }
}
