import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { provisionRestoredClientProvider } from './restored-client-provider.mjs';
import { localStateProviderOwnerFile } from '../../apps/metaengine-browser/src/local-state-provider-policy.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'compute-restored-admission-')));
  t.after(() => fs.rm(root,{recursive:true,force:true}));
  const stateDirectory = path.join(root,'private-state'); const pgDataDirectory = path.join(stateDirectory,'data');
  const bundleDirectory = path.join(root,'offline-bundle'); const appDataDirectory = path.join(root,'appdata');
  await fs.mkdir(path.join(pgDataDirectory,'global'),{recursive:true}); await fs.mkdir(bundleDirectory);
  await fs.writeFile(path.join(pgDataDirectory,'PG_VERSION'),'17\n'); await fs.writeFile(path.join(pgDataDirectory,'global','pg_control'),'existing control bytes');
  const vaultFile = path.join(pgDataDirectory,'client-vault.key'); const vault = 'd'.repeat(64)+'\n'; await fs.writeFile(vaultFile,vault,{mode:0o600});
  const privateConfigFile = path.join(stateDirectory,'private-runtime-config.json');
  const expectedBundleDigest = 'a'.repeat(64);
  const config = {schema:'compute.runtime-host-config.v1',version:1,bundle_directory:bundleDirectory,expected_bundle_sha256:expectedBundleDigest,
    state_directory:stateDirectory,pg_data_directory:pgDataDirectory,database_url:'postgresql://restricted_api:private-api-password@127.0.0.1:35432/postgres',
    inspect_database_url:'postgresql://private_owner:private-admin-password@127.0.0.1:35432/postgres',api_port:35433,edge_port:35434,startup_timeout_ms:60000};
  const configBytes = JSON.stringify(config); await fs.writeFile(privateConfigFile,configBytes,{mode:0o600});
  const restoreReceiptFile = path.join(root,'private-restore-report.json');
  const restore = {schema:'metaengine.database-restore-report.v1',source_dump_sha256:'b'.repeat(64),data_verified:true,schema_verified:true,
    errors:[],ddl_adaptations:[{name:'supabase_vault',replacement:'local_pgcrypto_vault'}]};
  const receiptBytes = JSON.stringify(restore); await fs.writeFile(restoreReceiptFile,receiptBytes,{mode:0o600});
  const ownerFile = localStateProviderOwnerFile({env:{APPDATA:appDataDirectory},platform:'win32'});
  const options = {ownerChoice:'LOCAL_POSTGRES',ownerAction:'USE_EXISTING_RESTORED_POSTGRES_17',stateDirectory,pgDataDirectory,privateConfigFile,
    ownerFile,bundleDirectory,expectedBundleDigest,appDataDirectory,restoreReceiptFile,expectedRestoreReceiptSha256:digest(receiptBytes),expectedDumpSha256:restore.source_dump_sha256};
  const id = randomUUID(); const events = []; const endpoint = 'http://127.0.0.1:35434/a2-browser-native-supervisor-v1';
  const statusFile = path.join(stateDirectory,'runtime-instance.json');
  const status = {schema:'metaengine.client-state.runtime-status.v1',state:'READY',runtime_ready:true,state_provider:'LOCAL_POSTGRES',
    hosted_supabase_required:false,automatic_cloud_fallback:false,authority_effect:false,instance_id:id,endpoint,capability_health:{state:'ATTESTED',authority_effect:false}};
  const health = {ok:true,instance_id:id,state_provider:'LOCAL_POSTGRES',hosted_supabase_required:false,runtime_ready:true,capability_health:{state:'ATTESTED',authority_effect:false}};
  const hooks = {
    verifyBundle: async input => { events.push('verify'); assert.equal(input.expectedBundleDigest,expectedBundleDigest); return {paths:{postgresBinDirectory:bundleDirectory}}; },
    startHost: async () => { events.push('start'); await assert.rejects(fs.stat(ownerFile),{code:'ENOENT'}); await fs.writeFile(statusFile,JSON.stringify(status));
      return {state:'READY',runtime_owned:true,instance_id:id,endpoint,status_file:statusFile,authority_effect:false}; },
    inspectApiAdmission: async () => { events.push('role-grants'); },
    fetchImpl: async (url,request) => { events.push('health'); assert.equal(url,endpoint+'/health'); assert.equal(request.redirect,'error'); await assert.rejects(fs.stat(ownerFile),{code:'ENOENT'});
      return {ok:true,json:async()=>health}; },
    stopHost: async () => { events.push('stop'); await assert.rejects(fs.stat(ownerFile),{code:'ENOENT'}); return {cleanup_confirmed:true}; },
  };
  return {root,options,hooks,events,status,health,id,vaultFile,vault,config,configBytes,restore,receiptBytes,statusFile};
}

test('restored provider verifies candidate, independent grants/health, confirmed stop, then exclusive owner publication',async t=>{
  const f = await fixture(t); const result = await provisionRestoredClientProvider(f.options,f.hooks);
  assert.deepEqual(f.events,['verify','start','role-grants','health','stop','verify']);
  assert.equal(result.state,'CONFIGURED'); assert.equal(result.database_initialized,false); assert.equal(result.existing_restored_database_selected,true);
  assert.equal(result.source_restore_receipt_verified,true); assert.equal(Object.hasOwn(result,'private_data_restored'),false);
  assert.equal(result.cleanup_confirmed,true); assert.equal(result.runtime_ready,false); assert.equal(result.source_schema_exact,false);
  assert.equal(result.attested_instance_id,f.id); assert.equal(result.source_restore_receipt_sha256,f.options.expectedRestoreReceiptSha256);
  assert.doesNotMatch(JSON.stringify(result),/private-api-password|private-admin-password|postgresql:|127\.0\.0\.1|config_file|owner_file/);
  const owner = JSON.parse(await fs.readFile(f.options.ownerFile,'utf8'));
  assert.equal(owner.runtime_host.config_file,f.options.privateConfigFile); assert.equal(owner.runtime_host.expected_bundle_sha256,f.options.expectedBundleDigest);
  assert.equal(await fs.readFile(f.vaultFile,'utf8'),f.vault); assert.equal(await fs.readFile(f.options.privateConfigFile,'utf8'),f.configBytes);
  assert.equal(await fs.readFile(f.options.restoreReceiptFile,'utf8'),f.receiptBytes);
  await assert.rejects(provisionRestoredClientProvider(f.options,f.hooks),/owner_file_exists/);
  assert.deepEqual(f.events,['verify','start','role-grants','health','stop','verify']);
});

test('explicit owner action and source pins are required before any filesystem/start work',async t=>{
  const f = await fixture(t);
  for (const change of [{ownerChoice:undefined},{ownerAction:undefined},{ownerAction:'INITIALIZE_FRESH_LOCAL_POSTGRES_17'}]) {
    await assert.rejects(provisionRestoredClientProvider({...f.options,...change},f.hooks),/explicit_owner_choice_required/);
  }
  for (const change of [{expectedBundleDigest:undefined},{expectedRestoreReceiptSha256:undefined},{expectedDumpSha256:'wrong'}]) {
    await assert.rejects(provisionRestoredClientProvider({...f.options,...change},f.hooks),/source_pins_required/);
  }
  assert.deepEqual(f.events,[]); await assert.rejects(fs.stat(f.options.ownerFile),{code:'ENOENT'});
});

test('missing existing vault key or postmaster state cannot initialize, repair or start the database',async t=>{
  const f = await fixture(t); await fs.unlink(f.vaultFile);
  await assert.rejects(provisionRestoredClientProvider(f.options,f.hooks),/private_path_unavailable/);
  await assert.rejects(fs.stat(f.vaultFile),{code:'ENOENT'});
  await fs.writeFile(f.vaultFile,f.vault); const stale = '1234\nexisting private state\n';
  await fs.writeFile(path.join(f.options.pgDataDirectory,'postmaster.pid'),stale);
  await assert.rejects(provisionRestoredClientProvider(f.options,f.hooks),/existing_postmaster_state_requires_review/);
  assert.equal(await fs.readFile(path.join(f.options.pgDataDirectory,'postmaster.pid'),'utf8'),stale);
  assert.deepEqual(f.events,[]);
});

test('mismatched/failed full restore evidence and remote private URLs reject before starting',async t=>{
  const f = await fixture(t);
  await assert.rejects(provisionRestoredClientProvider({...f.options,expectedRestoreReceiptSha256:'c'.repeat(64)},f.hooks),/restore_receipt_pin_mismatch/);
  const rejected = JSON.stringify({...f.restore,data_verified:false}); await fs.writeFile(f.options.restoreReceiptFile,rejected);
  await assert.rejects(provisionRestoredClientProvider({...f.options,expectedRestoreReceiptSha256:digest(rejected)},f.hooks),/restore_evidence_unverified/);
  await fs.writeFile(f.options.restoreReceiptFile,f.receiptBytes);
  await fs.writeFile(f.options.privateConfigFile,JSON.stringify({...f.config,database_url:'postgresql://private:secret@remote.example:35432/postgres'}));
  await assert.rejects(provisionRestoredClientProvider(f.options,f.hooks),/database_url_invalid/);
  assert.deepEqual(f.events,[]);
});

test('UUID/health/role failures stop the candidate and never publish an owner or expose raw errors',async t=>{
  for (const scenario of ['uuid','health','role']) {
    const f = await fixture(t); const hooks = {...f.hooks};
    if (scenario==='uuid') hooks.startHost = async input => { const result = await f.hooks.startHost(input); return {...result,instance_id:randomUUID()}; };
    if (scenario==='health') hooks.fetchImpl = async()=>({ok:true,json:async()=>({...f.health,instance_id:randomUUID()})});
    if (scenario==='role') hooks.inspectApiAdmission = async()=>{throw new Error('private-admin-password raw diagnostic');};
    await assert.rejects(provisionRestoredClientProvider(f.options,hooks),error=>/^restored_provider_(?:host_identity_unattested|health_unattested|provisioning_failed)$/.test(error.message));
    assert.equal(f.events.at(-1),'stop'); await assert.rejects(fs.stat(f.options.ownerFile),{code:'ENOENT'});
    assert.equal(await fs.readFile(f.vaultFile,'utf8'),f.vault);
  }
});

test('unconfirmed candidate cleanup retains private state and blocks owner publication',async t=>{
  const f = await fixture(t); let stopCalls = 0;
  await assert.rejects(provisionRestoredClientProvider(f.options,{...f.hooks,stopHost:async()=>{stopCalls++;return {cleanup_confirmed:false};}}),/cleanup_unconfirmed/);
  assert.equal(stopCalls,2); await assert.rejects(fs.stat(f.options.ownerFile),{code:'ENOENT'});
  assert.equal(await fs.readFile(f.vaultFile,'utf8'),f.vault); assert.equal(await fs.readFile(f.options.privateConfigFile,'utf8'),f.configBytes);
});

test('private input changes during startup block owner publication after confirmed cleanup',async t=>{
  const f = await fixture(t);
  await assert.rejects(provisionRestoredClientProvider(f.options,{...f.hooks,stopHost:async()=>{
    await f.hooks.stopHost(); await fs.writeFile(f.vaultFile,'e'.repeat(64)+'\n'); return {cleanup_confirmed:true};
  }}),/private_input_changed/);
  await assert.rejects(fs.stat(f.options.ownerFile),{code:'ENOENT'}); assert.equal(f.events.at(-1),'stop');
});

test('hardlinked private config and junction ancestor are rejected before candidate startup',async t=>{
  const f = await fixture(t); const hardlink = path.join(f.root,'shared-config.json');
  await fs.link(f.options.privateConfigFile,hardlink);
  await assert.rejects(provisionRestoredClientProvider(f.options,f.hooks),/private_path_invalid/); await fs.unlink(hardlink);
  const alias = path.join(f.root,'alias-state'); await fs.symlink(f.options.stateDirectory,alias,process.platform==='win32'?'junction':'dir');
  await assert.rejects(provisionRestoredClientProvider({...f.options,stateDirectory:alias},f.hooks),/private_path_alias_forbidden/);
  assert.deepEqual(f.events,[]); await assert.rejects(fs.stat(f.options.ownerFile),{code:'ENOENT'});
});

test('concurrent owner publication preserves the other owner and rejects incompatible configuration',async t=>{
  const f = await fixture(t); const concurrent = '{owner created by another process}';
  const hooks = {...f.hooks,stopHost:async()=>{
    await f.hooks.stopHost(); await fs.mkdir(path.dirname(f.options.ownerFile),{recursive:true});
    await fs.writeFile(f.options.ownerFile,concurrent,{flag:'wx'}); return {cleanup_confirmed:true};
  }};
  await assert.rejects(provisionRestoredClientProvider(f.options,hooks),/provisioning_failed/);
  assert.equal(await fs.readFile(f.options.ownerFile,'utf8'),concurrent);
  assert.deepEqual((await fs.readdir(path.dirname(f.options.ownerFile))),[path.basename(f.options.ownerFile)]);
});
