import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import test from 'node:test';
import { prepareInstalledAttachedPg17AfterReboot, prepareInstalledAttachedPg17 } from '../src/local-restored-pg17-auto-prepare.mjs';

const OLD='a'.repeat(64),NEW='b'.repeat(64),PID=19551001;
const digest=x=>createHash('sha256').update(x).digest('hex');
async function fixture(t) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-reboot-replacement-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const state=path.join(root,'private','failed'),data=path.join(root,'keeper'),bundle=path.join(root,'bundle');
  for(const dir of [state,data,bundle])await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(path.join(data,'postmaster.pid'),'independent-keeper-must-not-change\n');
  const oldConfigFile=path.join(state,'attached-config.json');
  const config={schema:'compute.runtime-host-config.v1',version:1,bundle_directory:path.join(root,'old-bundle'),
    expected_bundle_sha256:OLD,state_directory:state,pg_data_directory:data,postgres_mode:'attached',api_role_mode:'direct',
    expected_cluster_system_identifier:'7694034680113450848',
    database_url:'postgres://api:private-api-password@127.0.0.1:25432/metaengine',
    inspect_database_url:'postgres://inspect:private-inspect-password@127.0.0.1:25432/metaengine',
    api_port:25433,edge_port:25434,startup_timeout_ms:30000};
  const lockFile=path.join(state,'runtime-host-lock.json'),statusFile=path.join(state,'runtime-instance.json');
  const lock={schema:'compute.runtime-host-lock.v1',pid:PID,owner_nonce:randomUUID()};
  const status={schema:'metaengine.client-state.runtime-status.v1',state:'STARTING',runtime_ready:false,
    host_pid:PID,bundle_sha256:OLD,state_provider:'LOCAL_POSTGRES',hosted_supabase_required:false,
    automatic_cloud_fallback:false,authority_effect:false};
  for(const [file,obj] of [[oldConfigFile,config],[lockFile,lock],[statusFile,status]])await fs.writeFile(file,JSON.stringify(obj)+'\n');
  const originals=await Promise.all([oldConfigFile,lockFile,statusFile,path.join(data,'postmaster.pid')].map(file=>fs.readFile(file)));
  const boot=Date.now()+10000,calls={pids:[],ports:[],acl:[]};
  const args={oldConfigFile,bundleDirectory:bundle,bundleDigest:NEW,platform:'win32',
    operatorChoice:'PRESERVE_FAILED_STATE_AND_PREPARE_REPLACEMENT',
    protectStorage:async target=>{calls.acl.push(target);return {owner_dacl_verified:true};},
    verifyStorage:async()=>({owner_dacl_verified:true})};
  const deps={readBootTime:async()=>boot,now:()=>boot+10000,
    pidState:async pid=>{calls.pids.push(pid);return 'ABSENT';},
    portState:async port=>{calls.ports.push(port);return port===25432?'PRESENT':'ABSENT';},delay:async()=>{}};
  return {root,state,data,bundle,args,deps,config,lock,status,oldConfigFile,lockFile,statusFile,originals,boot,calls};
}
const prepare=(f,args={},deps={})=>prepareInstalledAttachedPg17AfterReboot({...f.args,...args},{...f.deps,...deps});
async function unchanged(f){
  const after=await Promise.all([f.oldConfigFile,f.lockFile,f.statusFile,path.join(f.data,'postmaster.pid')].map(file=>fs.readFile(file)));
  assert.deepEqual(after,f.originals);
}

test('explicit post-reboot preparation preserves predecessor and Keeper, fences old profile, creates protected successor',async t=>{
  const f=await fixture(t),result=await prepare(f);
  await unchanged(f);
  assert.equal(result.oldLockPreserved,true);
  assert.equal(result.historicalEffectsReconciled,false);
  assert.equal(result.providerPublished,false);
  assert.equal(result.automaticRetryAllowed,false);
  assert.equal(result.postgresLifecycleOwned,false);
  assert.equal(result.authorityEffect,false);
  assert.equal(result.priorConfigSha256,digest(f.originals[0]));
  assert.equal(result.priorLockSha256,digest(f.originals[1]));
  assert.equal(result.priorStatusSha256,digest(f.originals[2]));
  assert.equal(path.dirname(result.stateDirectory),path.dirname(f.state));
  assert.notEqual(result.stateDirectory,f.state);
  const next=JSON.parse(await fs.readFile(result.configFile,'utf8'));
  assert.deepEqual(next,{...f.config,state_directory:result.stateDirectory,
    bundle_directory:f.bundle,expected_bundle_sha256:NEW});
  assert.ok(f.calls.acl.every(target=>!target.startsWith(f.data)&&target!==f.state));
  const gate=JSON.parse(await fs.readFile(result.gateFile,'utf8'));
  assert.equal(gate.reason,'OPERATOR_REBOOT_REPLACEMENT');
  await assert.rejects(prepare(f),/existing_destination_requires_review/);
  assert.deepEqual(f.calls.pids,[PID,PID,PID,PID]);
  assert.deepEqual(f.calls.ports,Array(4).fill([25433,25434,25432]).flat());
  assert.ok(!JSON.stringify(result).includes('private-api-password'));
});

test('ordinary attached preparation still refuses legacy STARTING lock',async t=>{
  const f=await fixture(t);
  await assert.rejects(prepareInstalledAttachedPg17(f.args),/existing_destination_requires_review/);
  await unchanged(f);
});

test('operator choice, native reboot and exact owner evidence are mandatory before publication',async t=>{
  for(const scenario of ['choice','no_boot','recent_boot','future_boot','boot_changes','host_mismatch','bundle_mismatch','not_starting','bad_nonce']) {
    await t.test(scenario,async t=>{
      const f=await fixture(t);let reads=0;
      const args={},deps={};
      if(scenario==='choice')args.operatorChoice=undefined;
      if(scenario==='no_boot')deps.readBootTime=async()=>{throw new Error('native_boot_unavailable');};
      if(scenario==='recent_boot')deps.readBootTime=async()=>Date.now()-1000;
      if(scenario==='future_boot')deps.readBootTime=async()=>f.boot+20000;
      if(scenario==='boot_changes')deps.readBootTime=async()=>f.boot+(reads++?1:0);
      if(scenario==='host_mismatch')f.status.host_pid++;
      if(scenario==='bundle_mismatch')f.status.bundle_sha256=NEW;
      if(scenario==='not_starting')f.status.state='READY';
      if(scenario==='bad_nonce')f.lock.owner_nonce='zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz';
      await fs.writeFile(f.statusFile,JSON.stringify(f.status)+'\n');
      await fs.writeFile(f.lockFile,JSON.stringify(f.lock)+'\n');
      await assert.rejects(prepare(f,args,deps),/pg17_auto_prepare_|native_boot_unavailable/);
      assert.deepEqual((await fs.readdir(f.state)).sort(),['attached-config.json','runtime-host-lock.json','runtime-instance.json']);
      assert.deepEqual(await fs.readdir(path.dirname(f.state)),['failed']);
    });
  }
});

test('live or unknown process, busy endpoints and absent Keeper block successor before gate',async t=>{
  for(const scenario of ['host','unknown_host','api','edge_unknown','keeper'])await t.test(scenario,async t=>{
    const f=await fixture(t),deps={};
    if(scenario==='host'||scenario==='unknown_host')deps.pidState=async()=>scenario==='host'?'PRESENT':'UNKNOWN';
    else deps.portState=async p=>scenario==='api'&&p===25433?'PRESENT':scenario==='edge_unknown'&&p===25434?'UNKNOWN':p===25432&&scenario!=='keeper'?'PRESENT':'ABSENT';
    await assert.rejects(prepare(f,{},deps),/presence_unresolved|keeper_unavailable/);
    await unchanged(f);
    assert.equal((await fs.readdir(f.state)).length,3);
  });
});

test('recorded API or Edge child presence blocks reboot replacement even with closed ports',async t=>{
  const f=await fixture(t);
  f.status.children=[{name:'api',pid:PID+1},{name:'edge',pid:PID+2}];
  await fs.writeFile(f.statusFile,JSON.stringify(f.status)+'\n');
  f.originals[2]=await fs.readFile(f.statusFile);
  f.originals[2]=await fs.readFile(f.statusFile);
  await assert.rejects(prepare(f,{}, {pidState:async pid=>pid===PID+1?'PRESENT':'ABSENT'}),/replacement_child_presence_unresolved/);
  await unchanged(f);
  assert.equal((await fs.readdir(f.state)).length,3);
});

test('evidence changed during double observation cannot prepare a successor',async t=>{
  const f=await fixture(t);
  await assert.rejects(prepare(f,{}, {delay:()=>fs.writeFile(f.lockFile,JSON.stringify({...f.lock,owner_nonce:randomUUID()})+'\n')}),/replacement_evidence_changed/);
  await assert.rejects(fs.lstat(path.join(f.state,'runtime-host-recovery-gate.json')),{code:'ENOENT'});
});

test('failed successor ACL leaves durable old-profile gate and never silently retries',async t=>{
  const f=await fixture(t);
  await assert.rejects(prepare(f,{protectStorage:async()=>({owner_dacl_verified:false})}),/private_storage_acl_unverified/);
  await unchanged(f);
  assert.equal((await fs.lstat(path.join(f.state,'runtime-host-recovery-gate.json'))).isFile(),true);
  await assert.rejects(prepare(f),/existing_destination_requires_review/);
});

test('two preparations cannot publish competing successor profiles',async t=>{
  const f=await fixture(t);
  const results=await Promise.allSettled([prepare(f),prepare(f)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected').length,1);
  assert.equal((await fs.readdir(path.dirname(f.state))).filter(x=>x.startsWith('failed-replacement-')).length,1);
  await unchanged(f);
});
