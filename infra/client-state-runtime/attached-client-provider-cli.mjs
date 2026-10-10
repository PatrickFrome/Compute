// One-time, locally authorized attachment of an already-running PG17.
// Never initializes, stops or rewrites PostgreSQL. No cloud fallback.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { verifyOfflineRuntimeBundle } from './offline-runtime-bundle.mjs';
import { validateRuntimeHostConfig, verifyAttachedClusterSystemId } from './runtime-host.mjs';
import { normalizeLauncherConfig, inspectPostgres, assertPostgresIdentity } from './launcher.mjs';
import { inspectRestoredApiAdmission } from './restored-client-provider.mjs';
import { provisionPersistentClientProvider } from './persistent-client-provider.mjs';
import { startConfiguredLocalRuntimeHost, stopOwnedLocalRuntimeHost } from '../../apps/metaengine-browser/src/local-runtime-host-controller.mjs';
import { localStateProviderOwnerFile, validateLocalStateRuntimeIdentity, localStateProviderHealthAttested } from '../../apps/metaengine-browser/src/local-state-provider-policy.mjs';

const ENTRY = fileURLToPath(import.meta.url);
const ACTION = 'ATTACH_EXISTING_RUNNING_LOCAL_POSTGRES_17';
const SHA = /^[a-f0-9]{64}$/;
const SID = /^[0-9]{15,22}$/;
const fail = code => { throw new Error('attached_provider_' + code); };
const local = value => typeof value === 'string' && path.isAbsolute(value) && value.length < 2048
  && !/^(?:\\\\|\/\/)/.test(value) && !/[\x00-\x1f]/.test(value);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const samePath = (a,b) => process.platform === 'win32'
  ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);

async function trustedBytes(file, max = 16384) {
  if (!local(file)) fail('path_invalid');
  let current = path.parse(file).root;
  for (const component of path.relative(current,file).split(path.sep).filter(Boolean)) {
    current = path.join(current,component);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || (current !== file && !stat.isDirectory())) fail('path_alias_forbidden');
  }
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 ||
      stat.size < 1 || stat.size > max) fail('private_file_invalid');
  const bytes = await fs.readFile(file);
  const after = await fs.lstat(file);
  if (bytes.length !== stat.size || after.ino !== stat.ino ||
      after.mtimeMs !== stat.mtimeMs || after.size !== stat.size) fail('private_file_changed');
  return bytes;
}
function parse(bytes) { try {return JSON.parse(bytes.toString('utf8'));}catch{fail('json_invalid');} }
export function parseAttachedArgs(argv=[]) {
  const keys=['--config','--bundle','--bundle-sha256','--system-id','--receipt',
    '--receipt-sha256','--appdata','--owner-action'];
  if (!Array.isArray(argv) || argv.length !== keys.length*2 || keys.some((v,i)=>
      argv[2*i] !== v || typeof argv[2*i+1] !== 'string' || !argv[2*i+1])) fail('arguments_invalid');
  const values=Object.fromEntries(keys.map((v,i)=>[v,argv[2*i+1]]));
  return {configFile:values['--config'],bundleDirectory:values['--bundle'],
    expectedBundleDigest:values['--bundle-sha256'],expectedSystemId:values['--system-id'],
    restoreReceiptFile:values['--receipt'],expectedReceiptSha256:values['--receipt-sha256'],
    appDataDirectory:values['--appdata'],ownerAction:values['--owner-action']};
}

export async function attachExistingRunningPostgres(options={}, hooks={}) {
  const {configFile,bundleDirectory,expectedBundleDigest,expectedSystemId,
    restoreReceiptFile,expectedReceiptSha256,appDataDirectory,ownerAction,
    platform=process.platform}=options;
  if (platform !== 'win32' || ownerAction !== ACTION ||
      ![configFile,bundleDirectory,restoreReceiptFile,appDataDirectory].every(local) ||
      !SHA.test(expectedBundleDigest || '') || !SHA.test(expectedReceiptSha256 || '') ||
      !SID.test(expectedSystemId || '')) fail('arguments_invalid');
  const ownerFile=localStateProviderOwnerFile({env:{APPDATA:appDataDirectory},platform});
  if (!ownerFile) fail('owner_file_invalid');
  try {await fs.lstat(ownerFile);fail('owner_already_exists');}
  catch(error){if(error.message === 'attached_provider_owner_already_exists')throw error;
    if(error.code !== 'ENOENT')fail('owner_file_unreadable');}
  const cfgBytes=await trustedBytes(configFile);
  const cfg=validateRuntimeHostConfig(parse(cfgBytes));
  if (cfg.postgres_mode !== 'attached' || cfg.postgres_system_id !== expectedSystemId ||
      !samePath(cfg.bundle_directory,bundleDirectory) ||
      cfg.expected_bundle_sha256 !== expectedBundleDigest ||
      !samePath(path.dirname(configFile),cfg.state_directory)) fail('config_binding_mismatch');
  const receiptBytes=await trustedBytes(restoreReceiptFile,4*1024*1024);
  if (digest(receiptBytes) !== expectedReceiptSha256) fail('restore_receipt_sha_mismatch');
  const receipt=parse(receiptBytes);
  if (receipt.schema !== 'metaengine.database-restore-report.v1' ||
      receipt.data_verified !== true || receipt.schema_verified !== true ||
      !Array.isArray(receipt.errors) || receipt.errors.length !== 0 ||
      !SHA.test(receipt.source_dump_sha256 || '')) fail('restore_evidence_invalid');
  const verified=await (hooks.verifyBundle || verifyOfflineRuntimeBundle)(
    {bundleDirectory,expectedBundleDigest});
  const pgBinDir=verified?.paths?.postgresBinDirectory;
  if (!local(pgBinDir)) fail('bundle_unverified');
  const verifySystem=hooks.verifySystem || verifyAttachedClusterSystemId;
  await verifySystem({pgBinDir,pgDataDir:cfg.pg_data_directory,expectedSystemId});
  const launcher=normalizeLauncherConfig({mode:'local',postgresMode:'attached',
    databaseUrl:cfg.database_url,inspectDatabaseUrl:cfg.inspect_database_url,
    pgDataDir:cfg.pg_data_directory,pgBinDir,denoPath:verified.paths.denoExecutable,
    apiPort:cfg.api_port,edgePort:cfg.edge_port,startupTimeoutMs:cfg.startup_timeout_ms});
  const inspect=hooks.inspect || inspectPostgres;
  const assertIdentity=hooks.assertIdentity || assertPostgresIdentity;
  const before=await assertIdentity(await inspect(launcher),launcher);
  await (hooks.inspectApi || inspectRestoredApiAdmission)(
    {databaseUrl:cfg.database_url,postgresBinDirectory:pgBinDir});
  const publicConfig={schema:'metaengine.browser.local-state-provider-config.v1',
    version:1,profile:'CLIENT_LOCAL_POSTGRES_V1',provider:'LOCAL_POSTGRES',
    base_url:'http://127.0.0.1:'+cfg.edge_port+'/a2-browser-native-supervisor-v1',
    runtime_identity_file:path.join(cfg.state_directory,'runtime-instance.json'),
    runtime_host:{bundle_directory:bundleDirectory,
      expected_bundle_sha256:expectedBundleDigest,config_file:configFile},authority_effect:false};
  const start=hooks.startHost || startConfiguredLocalRuntimeHost;
  const stop=hooks.stopHost || stopOwnedLocalRuntimeHost;
  let started=false,cleaned=false;
  try {
    started=true;
    const runtime=await start({config:publicConfig,env:{...process.env}});
    const identity=validateLocalStateRuntimeIdentity(
      parse(await trustedBytes(publicConfig.runtime_identity_file,65536)),publicConfig.base_url);
    if(runtime?.state !== 'READY' || runtime?.runtime_owned !== true ||
       runtime?.instance_id !== identity.instance_id || runtime?.endpoint !== publicConfig.base_url)
      fail('runtime_attestation_invalid');
    const fetchHealth=hooks.fetchHealth || globalThis.fetch;
    if(typeof fetchHealth !== 'function')fail('health_unavailable');
    const health=await fetchHealth(publicConfig.base_url+'/health',
      {method:'GET',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(3000)});
    if(!health?.ok || !localStateProviderHealthAttested(await health.json(),identity.instance_id))
      fail('health_unattested');
    const cleanup=await stop();
    if(cleanup?.cleanup_confirmed !== true)fail('cleanup_unconfirmed');
    cleaned=true;
    await verifySystem({pgBinDir,pgDataDir:cfg.pg_data_directory,expectedSystemId});
    const after=await assertIdentity(await inspect(launcher),launcher);
    if(before.pid !== after.pid || before.started_at !== after.started_at ||
      before.data_directory !== after.data_directory)fail('postgres_incarnation_changed');
    if(!(await trustedBytes(configFile)).equals(cfgBytes) ||
       !(await trustedBytes(restoreReceiptFile,4*1024*1024)).equals(receiptBytes))
      fail('evidence_changed');
    await (hooks.verifyBundle || verifyOfflineRuntimeBundle)({bundleDirectory,expectedBundleDigest});
    const published=await (hooks.publishOwner || provisionPersistentClientProvider)(
      {ownerFile,baseUrl:publicConfig.base_url,
       runtimeIdentityFile:publicConfig.runtime_identity_file,ownerChoice:'LOCAL_POSTGRES',
       appDataDirectory,runtimeHost:publicConfig.runtime_host});
    if(published?.state !== 'CONFIGURED')fail('owner_publication_unconfirmed');
    return Object.freeze({schema:'compute.attached-client-provider.v1',
      state:'CONFIGURED',database_system_id_verified:true,postgres_incarnation_unchanged:true,
      database_not_stopped:true,owner_profile_written:true,automatic_cloud_fallback:false,authority_effect:false});
  }catch(error) {
    if(started && !cleaned){
      try{const cleanup=await stop();if(cleanup?.cleanup_confirmed !== true)fail('cleanup_unconfirmed');}
      catch{fail('cleanup_unconfirmed');}
    }
    if(/^attached_provider_[a-z0-9_]+$/.test(String(error?.message||'')))throw error;
    fail('qualification_failed');
  }
}
if(process.argv[1] && path.resolve(process.argv[1]) === ENTRY) {
  attachExistingRunningPostgres(parseAttachedArgs(process.argv.slice(2))).then(
    value=>console.log(JSON.stringify(value)),
    error=>{console.error(JSON.stringify({schema:'compute.attached-client-provider-error.v1',
      state:'BLOCKED',reason:/^attached_provider_[a-z0-9_]+$/.test(String(error?.message||''))
        ? error.message : 'attached_provider_qualification_failed',
      authority_effect:false}));process.exitCode=1;});
}
