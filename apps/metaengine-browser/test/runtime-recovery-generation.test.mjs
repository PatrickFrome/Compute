import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {startConfiguredLocalRuntimeHost, stopOwnedLocalRuntimeHost,
  subscribeOwnedLocalRuntimeHostGeneration, readOwnedLocalRuntimeHostRecoveryObservation} from '../src/local-runtime-host-controller.mjs';
import {LOCAL_STATE_PROVIDER_CONFIG_SCHEMA, LOCAL_STATE_PROVIDER_PROFILE} from '../src/local-state-provider-policy.mjs';
import {evaluateRuntimeRecoveryEligibility, finiteRuntimeRecoveryHealthFailure} from '../src/runtime-recovery-policy.mjs';

const protectedFixture = async () => ({owner_dacl_verified:true});
const failure = patch => ({schema:'metaengine.client-state.health-failure.v1',code:'health_connection_refused',
  component:'api',consecutive_failures:3,http_status:null,authority_effect:false,...patch});
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
const childSource = `import fs from 'node:fs';
const config=JSON.parse(fs.readFileSync(process.env.COMPUTE_RUNTIME_HOST_CONFIG,'utf8'));
const sendTerminal=reason=>process.send({schema:'compute.runtime-host-terminal.v1',launch_nonce:process.env.COMPUTE_RUNTIME_HOST_LAUNCH_NONCE,
  host_pid:process.pid,instance_id:config.instance,state:'STOPPED',children_stopped:true,ownership_released:true,reason,authority_effect:false},()=>process.exit(2));
process.on('message',message=>{
  if(message?.schema==='fixture.fail'){
    fs.writeFileSync(config.status,JSON.stringify({schema:'metaengine.client-state.runtime-status.v1',state:'STOPPED',runtime_ready:false,
      host_pid:process.pid,instance_id:config.instance,bundle_sha256:config.bundle,children_stopped:true,reason:'runtime_health_failed',
      stopped_at:new Date().toISOString(),last_health_failure:config.failure,authority_effect:false}));
    sendTerminal('runtime_health_failed');
  } else if(message?.command==='stop')sendTerminal('requested');
});
process.once('disconnect',()=>process.exit(0));
process.send({schema:'compute.runtime-host-provider.v1',provider:'LOCAL_POSTGRES',endpoint:config.endpoint,instance_id:config.instance,
  status_file:config.status,runtime_ready:true,automatic_cloud_fallback:false,hosted_supabase_required:false,authority_effect:false});`;

async function inertHost(t, healthFailure=failure()) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-recovery-generation-')));
  const bundle=path.join(root,'bundle'),configFile=path.join(root,'config.json'),status=path.join(root,'runtime-instance.json');
  await fs.mkdir(bundle);
  const hostFile=path.join(bundle,'host.mjs'),instance=randomUUID(),bundleHash='a'.repeat(64);
  const endpoint='http://127.0.0.1:25433/a2-browser-native-supervisor-v1';
  await fs.writeFile(hostFile,childSource);
  await fs.writeFile(configFile,JSON.stringify({instance,endpoint,status,bundle:bundleHash,failure:healthFailure}));
  let child;
  t.after(async()=>{
    assert.equal((await stopOwnedLocalRuntimeHost({timeoutMs:5000})).cleanup_confirmed,true);
    // root is the exact mkdtemp directory; never a live profile or database.
    assert.ok(root.startsWith(await fs.realpath(os.tmpdir())));
    await fs.rm(root,{recursive:true,force:true});
  });
  const config={schema:LOCAL_STATE_PROVIDER_CONFIG_SCHEMA,version:1,profile:LOCAL_STATE_PROVIDER_PROFILE,provider:'LOCAL_POSTGRES',
    base_url:endpoint,runtime_identity_file:status,authority_effect:false,
    runtime_host:{bundle_directory:bundle,config_file:configFile,expected_bundle_sha256:bundleHash}};
  const summary=await startConfiguredLocalRuntimeHost({config,env:{...process.env},startupTimeoutMs:30000,stopTimeoutMs:5000,
    verifyBundleImpl:async()=>({paths:{nodeExecutable:process.execPath,hostEntry:hostFile,sourceRoot:bundle}}),
    spawnImpl:(...args)=>{child=spawn(...args);return child;}});
  return {summary,root,status,fail:()=>child.send({schema:'fixture.fail'})};
}

test('real inert Host exit preserves exact READY/terminal generation and independently read finite health witness',async t=>{
  const observations=[];
  const unsubscribe=subscribeOwnedLocalRuntimeHostGeneration(value=>observations.push(value));t.after(unsubscribe);
  const host=await inertHost(t);
  const before=await readOwnedLocalRuntimeHostRecoveryObservation({verifyStorage:protectedFixture});
  assert.equal(before.ever_ready,true);assert.equal(before.exited,false);
  host.fail();
  const deadline=Date.now()+10000;
  let final;
  do{final=await readOwnedLocalRuntimeHostRecoveryObservation({verifyStorage:protectedFixture});if(final.exited)break;await delay(20);}while(Date.now()<deadline);
  assert.equal(final.exited,true);assert.equal(final.cleanup_confirmed,true);assert.equal(final.stopping,false);
  assert.equal(final.host_pid,host.summary.pid);assert.equal(final.instance_id,host.summary.instance_id);
  assert.equal(final.terminal.launch_nonce,before.launch_nonce);
  assert.equal(final.health_witness.launch_nonce,before.launch_nonce);
  assert.equal(final.health_witness.failure.code,'health_connection_refused');
  assert.equal(evaluateRuntimeRecoveryEligibility(final).eligible,true);
  assert.ok(observations.some(value=>value.ever_ready&&!value.exited));
  assert.ok(observations.some(value=>value.terminal&&!value.exited));
  assert.ok(observations.at(-1).exited);assert.equal(Object.isFrozen(observations.at(-1)),true);
  const serialized=JSON.stringify(final);
  assert.equal(serialized.includes(host.root),false,'private paths never reach generation observations');
  const tampered=JSON.parse(await fs.readFile(host.status,'utf8'));tampered.instance_id=randomUUID();
  await fs.writeFile(host.status,JSON.stringify(tampered));
  const unbound=await readOwnedLocalRuntimeHostRecoveryObservation({verifyStorage:protectedFixture});
  assert.equal(unbound.health_witness,null);assert.equal(evaluateRuntimeRecoveryEligibility(unbound).eligible,false);
});

test('requested inert Host shutdown cannot become automatic recovery eligibility',async t=>{
  await inertHost(t);
  assert.equal((await stopOwnedLocalRuntimeHost({timeoutMs:5000})).cleanup_confirmed,true);
  const observation=await readOwnedLocalRuntimeHostRecoveryObservation({verifyStorage:protectedFixture});
  assert.equal(observation.stopping,true);
  assert.equal(evaluateRuntimeRecoveryEligibility(observation).reason,'DELIBERATE_SHUTDOWN');
});

test('conservative policy refuses 503, PG, source/capability failure, incomplete cleanup, pre-READY and manual stop',()=>{
  const nonce=randomUUID(),instance=randomUUID();
  const observation={schema:'metaengine.browser.runtime-host-generation.v1',launch_nonce:nonce,host_pid:123,instance_id:instance,
    ever_ready:true,stopping:false,exited:true,cleanup_confirmed:true,terminal_rejected:false,authority_effect:false,
    terminal:{schema:'compute.runtime-host-terminal.v1',launch_nonce:nonce,host_pid:123,instance_id:instance,state:'STOPPED',
      children_stopped:true,ownership_released:true,reason:'runtime_health_failed',authority_effect:false},
    health_witness:{schema:'metaengine.browser.runtime-recovery-health-witness.v1',launch_nonce:nonce,host_pid:123,instance_id:instance,
      bundle_sha256:'a'.repeat(64),status_sha256:'b'.repeat(64),stopped_at:new Date().toISOString(),failure:failure(),authority_effect:false}};
  assert.equal(evaluateRuntimeRecoveryEligibility(observation).eligible,true);
  for(const diagnostic of [failure({code:'health_http_failed',http_status:503}),failure({code:'postgres_inspection_connection_refused',component:'postgres'}),
    failure({code:'health_capability_source_mismatch',component:'edge'}),failure({code:'health_capability_attestation_timeout',component:'edge'}),
    failure({consecutive_failures:2}),failure({code:'unbounded_error_text'})]){
    assert.equal(evaluateRuntimeRecoveryEligibility({...observation,health_witness:{...observation.health_witness,failure:diagnostic}}).eligible,false);
  }
  for(const patch of [{exited:false},{cleanup_confirmed:false},{ever_ready:false},{stopping:true},{terminal_rejected:true},
    {terminal:{...observation.terminal,launch_nonce:randomUUID()}},{health_witness:{...observation.health_witness,host_pid:456}}]){
    assert.equal(evaluateRuntimeRecoveryEligibility({...observation,...patch}).eligible,false);
  }
  assert.equal(finiteRuntimeRecoveryHealthFailure({...failure(),stderr:'private'}),null);
});
