import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { attachExistingRunningPostgres, parseAttachedArgs } from './attached-client-provider-cli.mjs';

const sid='7694034680113450848', sha='a'.repeat(64), receiptSha='b'.repeat(64);
const ownerAction='ATTACH_EXISTING_RUNNING_LOCAL_POSTGRES_17';
const uuid='8a28c33d-b975-40af-a72d-d9f89f47a10b';
const publicUrl='http://127.0.0.1:55434/a2-browser-native-supervisor-v1';

test('CLI parses only an exact bounded order and action', () => {
  const flags=['--config','--bundle','--bundle-sha256','--system-id',
    '--receipt','--receipt-sha256','--appdata','--owner-action'];
  const values=['/config','/bundle',sha,sid,'/receipt',receiptSha,'/appdata',ownerAction];
  const args=flags.flatMap((flag,i)=>[flag,values[i]]);
  assert.equal(parseAttachedArgs(args).ownerAction,ownerAction);
  assert.throws(()=>parseAttachedArgs(args.slice(2)),/attached_provider_arguments_invalid/);
  assert.throws(()=>parseAttachedArgs([...args,'--extra','1']),/attached_provider_arguments_invalid/);
  assert.throws(()=>parseAttachedArgs(['--receipt',args[1],...args.slice(2)]),
    /attached_provider_arguments_invalid/);
});
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-attached-provider-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const state=path.join(root,'state'),bundle=path.join(root,'bundle'),
    appdata=path.join(root,'appdata'),data=path.join(state,'postgresql-17-live');
  await fs.mkdir(data,{recursive:true});
  await fs.writeFile(path.join(data,'client-vault.key'),'f'.repeat(64)+'\n');
  await fs.mkdir(bundle);
  await fs.mkdir(appdata);
  const configFile=path.join(state,'attached-private-runtime.json');
  const receiptFile=path.join(root,'restore-report.json');
  const config={schema:'compute.runtime-host-config.v1',version:1,
    bundle_directory:bundle,expected_bundle_sha256:sha,state_directory:state,
    pg_data_directory:data,database_url:'postgresql://api:secret@127.0.0.1:55432/postgres',
    inspect_database_url:'postgresql://inspect:secret@127.0.0.1:55432/postgres',
    api_port:55433,edge_port:55434,startup_timeout_ms:60000,
    postgres_mode:'attached',postgres_system_id:sid};
  const receipt={schema:'metaengine.database-restore-report.v1',data_verified:true,
    schema_verified:true,errors:[],source_dump_sha256:'c'.repeat(64)};
  await fs.writeFile(configFile,JSON.stringify(config));
  await fs.writeFile(receiptFile,JSON.stringify(receipt));
  const crypto=await import('node:crypto');
  const receiptDigest=crypto.createHash('sha256').update(await fs.readFile(receiptFile)).digest('hex');
  const options={configFile,bundleDirectory:bundle,expectedBundleDigest:sha,expectedSystemId:sid,
    restoreReceiptFile:receiptFile,expectedReceiptSha256:receiptDigest,appDataDirectory:appdata,
    ownerAction,platform:'win32'};
  const events=[];
  let sequence=0;
  const hooks={
    verifyBundle:async()=>{events.push('bundle');return {paths:{postgresBinDirectory:path.join(root,'bin'),denoExecutable:path.join(root,'deno')}};},
    verifySystem:async({expectedSystemId})=>{assert.equal(expectedSystemId,sid);events.push('system');},
    inspect:async()=>{events.push('postgres_inspect');return {};},
    assertIdentity:async()=>({pid:99999,data_directory:data,started_at:'2026-10-10T10:00:00Z'}),
    inspectApi:async()=>{events.push('api');},
    startHost:async({config:publicConfig})=>{
      events.push('host_start');assert.equal(publicConfig.runtime_host.config_file,configFile);
      assert.equal(publicConfig.base_url,publicUrl);
      await fs.writeFile(path.join(state,'runtime-instance.json'),JSON.stringify({
        schema:'metaengine.client-state.runtime-status.v1',state:'READY',runtime_ready:true,
        state_provider:'LOCAL_POSTGRES',instance_id:uuid,endpoint:publicUrl,
        hosted_supabase_required:false,automatic_cloud_fallback:false,authority_effect:false,
        capability_health:{state:'ATTESTED',authority_effect:false}
      }));
      return {state:'READY',runtime_owned:true,instance_id:uuid,endpoint:publicUrl};
    },
    fetchHealth:async()=>({ok:true,json:async()=>({
      ok:true,instance_id:uuid,state_provider:'LOCAL_POSTGRES',runtime_ready:true,
      hosted_supabase_required:false,capability_health:{state:'ATTESTED',authority_effect:false}
    })}),
    stopHost:async()=>{events.push('host_stop');return {cleanup_confirmed:true};},
    publishOwner:async({ownerFile})=>{events.push('owner_publish');assert.ok(ownerFile.includes('browser-shell'));return {state:'CONFIGURED'};}
  };
  return {root,state,configFile,receiptFile,options,hooks,events};
}
test('attached runtime attests exact cluster, health, API and cleans child host before publishing',async t=>{
  const f=await fixture(t);
  const result=await attachExistingRunningPostgres(f.options,f.hooks);
  assert.equal(result.state,'CONFIGURED');
  assert.equal(result.database_not_stopped,true);
  assert.equal(result.authority_effect,false);
  assert.deepEqual(f.events,['bundle','system','postgres_inspect','api','host_start','host_stop',
    'system','postgres_inspect','bundle','owner_publish']);
  assert.equal(await fs.readFile(f.configFile,'utf8').then(JSON.parse).then(x=>x.postgres_mode),'attached');
});
test('wrong system identifier blocks before any runtime or owner effect',async t=>{
  const f=await fixture(t); f.options.expectedSystemId='7'.repeat(19);
  await assert.rejects(attachExistingRunningPostgres(f.options,f.hooks),/attached_provider_config_binding_mismatch/);
  assert.deepEqual(f.events,[]);
});
test('incorrect receipt pin blocks before any runtime effect',async t=>{
  const f=await fixture(t);f.options.expectedReceiptSha256='c'.repeat(64);
  await assert.rejects(attachExistingRunningPostgres(f.options,f.hooks),/attached_provider_restore_receipt_sha_mismatch/);
  assert.deepEqual(f.events,[]);
});
test('no implicit manual wizard or cloud owner action',async t=>{
  const f=await fixture(t);f.options.ownerAction='SELECT_ANY_CLOUD_DATABASE';
  await assert.rejects(attachExistingRunningPostgres(f.options,f.hooks),/attached_provider_arguments_invalid/);
  assert.deepEqual(f.events,[]);
});
test('failed restricted API admission is fail-closed before spawning a host',async t=>{
  const f=await fixture(t);
  f.hooks.inspectApi=async()=>{throw Error('restricted_account_incomplete')};
  await assert.rejects(attachExistingRunningPostgres(f.options,f.hooks),/restricted_account_incomplete/);
  assert.equal(f.events.includes('host_start'),false);
});
test('uncertain host cleanup never publishes owner profile',async t=>{
  const f=await fixture(t);
  f.hooks.stopHost=async()=>({cleanup_confirmed:false});
  await assert.rejects(attachExistingRunningPostgres(f.options,f.hooks),/attached_provider_cleanup_unconfirmed/);
  assert.equal(f.events.includes('owner_publish'),false);
});
test('changing Vault bytes during host proof must never publish owner',async t=>{
  const f=await fixture(t);
  const originalStop=f.hooks.stopHost;
  f.hooks.stopHost=async()=>{const result=await originalStop();
    await fs.writeFile(path.join(f.state,'postgresql-17-live','client-vault.key'),'0'.repeat(64)+'\n');
    return result;};
  await assert.rejects(attachExistingRunningPostgres(f.options,f.hooks),/attached_provider_evidence_changed/);
  assert.equal(f.events.includes('owner_publish'),false);
});
test('changed PG incarnation after health proof fences registration',async t=>{
  const f=await fixture(t);
  f.hooks.assertIdentity=async()=>{
    sequenceUnused();
    return {pid:10000,data_directory:f.state,started_at:'2026-10-10T10:00:00Z'};
  };
  function sequenceUnused() {}
  let calls=0;
  f.hooks.assertIdentity=async()=>({pid:++calls===1?12000:12001,data_directory:f.state,
    started_at:'2026-10-10T10:00:00Z'});
  await assert.rejects(attachExistingRunningPostgres(f.options,f.hooks),/attached_provider_postgres_incarnation_changed/);
  assert.equal(f.events.includes('owner_publish'),false);
});
