import {readAgentResourceAdmission} from '../src/agent-resource-admission.mjs';
import {createNativeCodingWorkerRegistry} from '../src/native-coding-host-observers.mjs';
import {joinedSettlementFixture} from './fixtures/codex-cli-joined-settlement-fixture.mjs';
import {createNativeCodingCapacityOwner} from '../src/native-coding-capacity-owner.mjs';
import {nativeCapacityPrincipal} from '../src/native-coding-capacity-contract.mjs';
import {nativeCodingCanonicalSha256 as capacitySha} from '../src/native-coding-task-context.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import {fork} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createNativeCodingRuntime} from '../src/native-coding-runtime.mjs';
import {projectNativeRuntimeObservation} from '../src/client-native-runtime-observation.mjs';
import {nativeCodingEnvelopeSha256} from '../src/native-coding-transport-proof.mjs';
import {createNativeCodingHostIpcClient} from '../src/native-coding-host-ipc-client.mjs';

// Explicit private-capability fixtures exercise real runtime/executor/pool
// ordering. No fixture signature, process or receipt is native evidence.
const ids={task:'11111111-1111-4111-8111-111111111111',provider:'22222222-2222-4222-8222-222222222222',
  workspace:'33333333-3333-4333-8333-333333333333',project:'44444444-4444-4444-8444-444444444444',
  permit:'55555555-5555-4555-8555-555555555555',run:'66666666-6666-4666-8666-666666666666'};
const agent=`agent_${ids.task}`,hash=s=>createHash('sha256').update(s).digest('hex');
const host={pid:123,created_at:'2026-10-22T04:00:00.000Z',process_incarnation_id:'pid:123:created_100ns:134055792000000000'};
const processProof={process_incarnation_id:'pid:124:created_100ns:134055792000000000',job_id:ids.run};
function fixture(options={}){
  const hostListeners=new Set();
  const calls=[],prompt='HOST canonical task: implement the exact leased change.',expiry=new Date(Date.now()+300000).toISOString();
  const role=options.role||'IMPLEMENTER';
  const subject=role==='CRITIC'?{run_id:ids.provider,result_sha256:'d'.repeat(64),git_artifact_sha256:'e'.repeat(64),source_head:'a'.repeat(40)}:null;
  const lease={task_id:ids.task,agent_id:agent,lease_generation:1,agent_generation_epoch:1,role,
    workspace_id:ids.workspace,project_id:ids.project,provider_id:ids.provider,target_id:`codex-cli:${ids.provider}`,
    base_sha:'a'.repeat(40),prompt_sha256:hash(prompt),expires_at:expiry,state:'LEASED',verification_subject:subject};
  const permit={schema:'metaengine.native-coding.operator-permit.v1',trust_namespace:'LOCAL_OPERATOR_QA',permit_id:ids.permit,
    provider_id:ids.provider,agent_id:agent,agent_generation_epoch:1,goal_id:ids.task,goal_sha256:'a'.repeat(64),owner_epoch:1,
    workspace_id:ids.workspace,project_id:ids.project,role,revoked:false,user_sid:'S-1-5-21-111-1001',
    artifact:{installed_exe_sha256:'b'.repeat(64),installed_asar_sha256:'c'.repeat(64),runtime_bundle_sha256:'d'.repeat(64),source_sha:'e'.repeat(40),cli_executable_sha256:'f'.repeat(64)},
    postgres:{system_identifier:'fixture-only'},worktree:{path:path.resolve('fixture-worktree'),base_sha:lease.base_sha,root_identity_sha256:'a'.repeat(64)},
    expires_at:new Date(Date.now()+3600000).toISOString()};
  let executionState=null,receipt=null,runCount=0,providerIssues=0,prepared=false,readCount=0;
  const transitionEvents=[];
  const ledger={reserve:async scope=>{calls.push('reserve');executionState='RESERVED';return options.prior
      ?{state:'READBACK_ONLY',execution:{state:'ATTEMPTED'}}:{state:'RESERVED',scope:{...scope,reservation_id:ids.run}};},
    advance:async(scope,event)=>{calls.push(`ledger:${event.to}`);transitionEvents.push(event);executionState=event.to;
      if(options.unknownBarrier&&event.to==='ATTEMPTED')throw Error('fixture_commit_ack_lost');
      return {state:event.to};},
    read:async scope=>{readCount++;calls.push('read');return options.readback?.({scope,receipt,executionState})||{state:executionState};}};
  const ownPostgres={ledger,agentOperation:async()=>{throw Error('fixture_no_agent_tool_invocation');},readScope:async()=>{},readLease:async()=>({schema:'metaengine.native-coding.own-pg-lease.v1',
      source:'PRIVATE_RUNTIME_HOST_OWN_PG',observed_at:new Date().toISOString(),value:{...lease},task_prompt:options.badPrompt?'changed in transit':prompt}),
    onUnavailable:options.onUnavailable||((listener)=>{hostListeners.add(listener);return()=>hostListeners.delete(listener);}),
    snapshot:()=>({instance_id:ids.run,host_pid:123}),
    serviceHeartbeat:async packet=>{calls.push('service-heartbeat');return {schema:'metaengine.native-coding.service-heartbeat-ack.v1',accepted:true,
      body_sha256:packet.headers['x-a2-device-body-sha256'],witness_sha256:'a'.repeat(64),expires_at:new Date(Date.now()+30000).toISOString(),readback_only:false,authority_effect:false};},
    readServiceHeartbeat:async()=>null,
    registerProvider:async envelope=>{calls.push('register-provider');if(options.unknownRegistration)throw Error('fixture_registration_ack_lost');
      await options.beforeRegisterAck?.();return {registered:true,provider_id:envelope.payload.provider_id,envelope_sha256:nativeCodingEnvelopeSha256(envelope)};}};
  const issuer={issueProvider:async selector=>{assert(prepared);providerIssues++;calls.push('issue-provider');
      await options.beforeIssueProvider?.(selector,providerIssues);
      return {signature:'FIXTURE_ONLY',payload:{...permit,...selector,permit_id:selector.provider_id===ids.provider?permit.permit_id:selector.provider_id,host_process:host,expires_at:options.providerExpiry?.()||expiry}};},
    issueJob:async query=>{assert(prepared);calls.push('issue-job');return {signature:'FIXTURE_ONLY',payload:{...query,
      schema:'metaengine.codex-cli.job-proof.v1',trust_namespace:'LOCAL_OPERATOR_QA',production_qualified:false,
      target_id:lease.target_id,agent_generation_epoch:1,role,workspace_id:lease.workspace_id,project_id:lease.project_id,permit_id:permit.permit_id,
      host_process:host,worker_process:processProof,job_id:ids.run,worktree:permit.worktree,expires_at:expiry}};},close:()=>{calls.push('issuer-close');}};
  const store={publish:async value=>{calls.push('publish-author');assert.deepEqual(value,receipt);await options.beforePublish?.();},
    resolveRunnerSubject:async query=>{calls.push('resolve-subject');assert.deepEqual(query.verification_subject,subject);
      return {task_id:ids.provider,lease_generation:7,...subject};}};
  const workers={controllerFor:scope=>{calls.push('private-controller');assert.equal(scope.prompt_sha256,hash(prompt));return {};},
    close:async()=>{calls.push('workers-close');await options.workerClose?.();return {
      schema:'metaengine.native-coding.workers-close.v1',cleanup_confirmed:options.cleanupConfirmed!==false};}};
  const observers={prepareInstalledImage:async()=>{calls.push('prepare-image');prepared=true;},
    readNativeHost:async()=>({value:{host_process:host,user_sid:permit.user_sid}})};
  const signedRequest=async(url,{payload})=>{
    if(url.endsWith('/mark-running')){
      calls.push('mark-running');assert.equal(executionState,'ATTEMPTED');
      assert.deepEqual(payload.native_coding.job_proof,transitionEvents[0].job_proof);
      if(options.unknownRunning)throw Error('fixture_running_ack_lost');
      return {ok:true,json:async()=>({task_id:ids.task,state:'RUNNING'})};
    }
    assert(url.endsWith('/complete'));calls.push('complete');assert.equal(executionState,'RESULT_READY');
    await options.beforeCompleteAck?.();
    assert.equal(nativeCodingEnvelopeSha256(payload.native_coding.receipt),nativeCodingEnvelopeSha256(transitionEvents[1].result_receipt));
    if(options.unknownCompletion)throw Error('fixture_completion_ack_lost');
    const response={task_id:ids.task,state:'RESULT_READY',result_sha256:'0'.repeat(64),native_coding_ack:{state:'RESULT_READY',lease_generation:1,
      result_sha256:options.wrongAck?'0'.repeat(64):receipt.result_sha256}};
    return {ok:true,json:async()=>response};
  };
  const runnerFactory=({authorizeLease})=>({async run(request,{signal}={}){
    runCount++;calls.push('runner');assert.equal(request.prompt,prompt);
    if(role==='CRITIC')assert.deepEqual(request.subject,{task_id:ids.provider,lease_generation:7,...subject});
    else assert.equal(request.subject,undefined);
    if(options.gate)await options.gate;
    await authorizeLease({phase:'BEFORE_ATTEMPT',binding:request.lease});
    await authorizeLease({phase:'BEFORE_RESUME',binding:request.lease,run_id:ids.run,process:processProof});calls.push('resume');
    await options.afterResume?.({signal,calls});
    await authorizeLease({phase:'AFTER_EXECUTION',binding:request.lease});
    receipt={schema:'metaengine.codex-cli.run-receipt.v1',provider:'CODEX_CLI',trust_namespace:'LOCAL_OPERATOR_QA',state:'RESULT_READY',
      task_id:ids.task,lease_generation:options.wrongResult?2:1,agent_id:agent,run_id:ids.run,role,result_sha256:'b'.repeat(64),
      result:{outcome:'DONE'},git_after:{artifact_sha256:'c'.repeat(64),head:'a'.repeat(40)}};return receipt;
  }});
  const args={identity:{snapshot:()=>({enrolled:true,device_id:ids.task,client_id:ids.workspace,key_fingerprint_sha256:'a'.repeat(64)}),
      deviceHeaders:async(_method,_path,text)=>({'content-type':'application/json','x-a2-chat-bridge-client':ids.workspace,
        'x-a2-device-profile':'A2_DEVICE_HTTP_SIGNATURE_V1','x-a2-device-id':ids.task,'x-a2-device-timestamp':new Date().toISOString(),
        'x-a2-device-nonce':'a'.repeat(32),'x-a2-device-body-sha256':hash(text),'x-a2-device-signature':'a'.repeat(86)})},
    readServiceControl:()=>({supervisor_mode:'CONTROL',armed:true,interrupted_setup_recovery_fenced:false,runtime_control_generation:0}),
    ownPostgres,signedRequest,observers,issuer,
    runnerOptions:{expectedExecutableSha256:permit.artifact.cli_executable_sha256},resultStore:store,workerRegistry:options.workerRegistry||workers,
    permitRegistry:{listProviderSelectors:async()=>[{provider_id:ids.provider,agent_id:agent}],readProvider:async()=>permit},runnerFactory:options.runnerFactory||runnerFactory,
    // This generated executor fixture must not consume the real PC's transient
    // memory headroom. Production admission remains independently exercised.
    readResourceAdmission:options.readResourceAdmission||(()=>readAgentResourceAdmission({
      freeMemory:2*1024*1024*1024,totalMemory:8*1024*1024*1024,parallelism:2})),
    physicalSlotBudget:options.physicalSlotBudget||1,...(options.closeTimeoutMs?{closeTimeoutMs:options.closeTimeoutMs}:{})};
  const runtime=createNativeCodingRuntime(args);
  return {runtime,args,calls,lease,permit,prompt,transitionEvents,
    loseHost(reason='CHILD_EXIT'){for(const listener of [...hostListeners])listener({reason});},
    get runCount(){return runCount;},get providerIssues(){return providerIssues;},
    get receipt(){return receipt;},get readCount(){return readCount;}};
}
async function settled(f){
  for(let i=0;i<100;i++){
    const state=f.runtime.snapshot().jobs[0]?.state;
    if(state&&!['PREPARING','RUNNING'].includes(state))return state;
    await new Promise(r=>setImmediate(r));
  }
  assert.fail('fixture runtime did not settle');
}
async function providerRefreshDone(f){
  for(let i=0;i<100;i++){
    if(!f.runtime.snapshot().provider_refresh_running&&!f.runtime.snapshot().service_heartbeat.publication_running)return;
    await new Promise(r=>setImmediate(r));
  }
  assert.fail('fixture provider refresh did not settle');
}

test('real executor/pool composition durably registers exact job before W30 RUNNING and native resume',async t=>{
  const f=fixture();t.after(()=>f.runtime.close());
  assert.equal(f.runtime.dispatchLease({...f.lease,prompt:'MODEL supplied override ignored'}).state,'PREPARING');
  assert.equal(await settled(f),'RESULT_READY');
  assert.equal(f.calls.indexOf('ledger:ATTEMPTED')<f.calls.indexOf('mark-running'),true);
  assert.equal(f.calls.indexOf('mark-running')<f.calls.indexOf('resume'),true);
  assert.equal(f.transitionEvents[0].evidence_sha256,nativeCodingEnvelopeSha256(f.transitionEvents[0].job_proof));
  const result=await f.runtime.observeLease(f.lease);assert.equal(result.state,'RESULT_ACKNOWLEDGED');
  assert.equal(f.runtime.snapshot().occupied_slots,0);assert.equal(f.calls.filter(x=>x==='complete').length,1);
  assert.equal(f.runtime.snapshot().useful_work_verified,false);
  const ui=projectNativeRuntimeObservation(f.runtime.snapshot(),{localProviderAttested:true});
  assert.equal(ui.state,'OBSERVED');assert.equal(ui.retained_records,0);
  assert.equal(ui.physical_execution_proven,false);assert.equal(ui.useful_work_verified,false);
});

test('heartbeat dispatch is nonblocking and duplicate ticks cannot execute a second model process',async t=>{
  let release;const gate=new Promise(r=>{release=r;}),f=fixture({gate});t.after(()=>f.runtime.close());
  assert.equal(f.runtime.dispatchLease(f.lease).state,'PREPARING');
  f.runtime.dispatchLease(f.lease);await new Promise(r=>setImmediate(r));assert.equal(f.runCount,1);
  assert.equal(f.runtime.dispatchLease({...f.lease,task_id:ids.provider}).state,'PHYSICAL_POOL_BUSY');
  release();assert.equal(await settled(f),'RESULT_READY');assert.equal(f.runCount,1);
});

for(const failure of ['unknownBarrier','unknownRunning'])test(`${failure} fences before resume and never executes a retry`,async t=>{
  const f=fixture({[failure]:true});t.after(()=>f.runtime.close());f.runtime.dispatchLease(f.lease);
  assert.equal(await settled(f),'READBACK_REQUIRED');assert.equal(f.calls.includes('resume'),false);
  const ui=projectNativeRuntimeObservation(f.runtime.snapshot(),{localProviderAttested:true});
  assert.equal(ui.state,'OBSERVED');assert.equal(ui.counts.readback_required,1);
  assert.equal(ui.retained_records,1);assert.equal(ui.physical_execution_proven,false);
  for(let i=0;i<3;i++){f.runtime.dispatchLease(f.lease);await f.runtime.observeLease(f.lease);}
  assert.equal(f.runCount,1);assert.equal(f.transitionEvents.length,1);assert(f.readCount>0);
});

test('canonical private task prompt mismatch cannot reserve or launch a worker',async t=>{
  const f=fixture({badPrompt:true});t.after(()=>f.runtime.close());f.runtime.dispatchLease(f.lease);
  assert.equal(await settled(f),'READBACK_REQUIRED');assert.equal(f.runCount,0);assert.equal(f.calls.includes('reserve'),false);
});

test('result lease mismatch remains ambiguous and cannot POST a successful completion',async t=>{
  const f=fixture({wrongResult:true});t.after(()=>f.runtime.close());f.runtime.dispatchLease(f.lease);
  assert.equal(await settled(f),'AMBIGUOUS');assert.equal((await f.runtime.observeLease(f.lease)).state,'AMBIGUOUS');
  assert.equal(f.calls.includes('complete'),false);assert.equal(f.transitionEvents.at(-1).result_receipt,undefined);
});

for(const failure of ['unknownCompletion','wrongAck'])test(`${failure} retains its slot and never repeats complete POST`,async t=>{
  const f=fixture({[failure]:true});t.after(()=>f.runtime.close());f.runtime.dispatchLease(f.lease);await settled(f);
  assert.equal((await f.runtime.observeLease(f.lease)).state,'READBACK_REQUIRED');
  for(let i=0;i<3;i++)assert.equal((await f.runtime.observeLease(f.lease)).state,'READBACK_REQUIRED');
  assert.equal(f.calls.filter(x=>x==='complete').length,1);assert.equal(f.runtime.snapshot().occupied_slots,1);assert.equal(f.runCount,1);
});

test('lost completion acknowledgement can be reconciled only by exact private W30+registered receipt readback',async t=>{
  let valid=false;
  const f=fixture({unknownCompletion:true,readback:({receipt})=>receipt?{state:'RESULT_READY',task_state:'RESULT_READY',task_id:ids.task,lease_generation:1,
    task_result_summary:{schema:'metaengine.native-coding.result-summary.v1',run_id:ids.run,result_sha256:receipt.result_sha256,
      receipt_sha256:valid?nativeCodingEnvelopeSha256(receipt):'0'.repeat(64),git_artifact_sha256:receipt.git_after.artifact_sha256,source_head:receipt.git_after.head}}:{state:'ATTEMPTED'}});
  t.after(()=>f.runtime.close());f.runtime.dispatchLease(f.lease);await settled(f);
  assert.equal((await f.runtime.observeLease(f.lease)).state,'READBACK_REQUIRED');
  assert.equal((await f.runtime.observeLease(f.lease)).state,'READBACK_REQUIRED');valid=true;
  assert.equal((await f.runtime.observeLease(f.lease)).state,'RESULT_ACKNOWLEDGED');
  assert.equal(f.runtime.snapshot().occupied_slots,0);assert.equal(f.calls.filter(x=>x==='complete').length,1);
});

test('a restarted runtime reads prior durable execution without a new runner or completion POST',async t=>{
  const f=fixture();t.after(()=>f.runtime.close());
  const row=await f.runtime.observeLease(f.lease);assert.equal(row.state,'READBACK_ONLY');
  assert.equal(row.result.state,'HOLD');assert.equal(row.result.reason,'PRIVATE_PRIOR_EXECUTION_READBACK_UNAVAILABLE');
  assert.equal(f.runCount,0);assert.equal(f.calls.includes('complete'),false);assert.equal(f.calls.includes('reserve'),false);assert.equal(f.readCount,0);
});

test('an existing durable reservation cannot be converted into another process by dispatch',async t=>{
  const f=fixture({prior:true});t.after(()=>f.runtime.close());f.runtime.dispatchLease(f.lease);
  assert.equal(await settled(f),'READBACK_ONLY');assert.equal(f.runCount,0);assert.equal(f.calls.includes('issue-job'),false);
});

test('Critic receives the exact protected writer patch subject from a separate private lookup',async t=>{
  const f=fixture({role:'CRITIC'});t.after(()=>f.runtime.close());f.runtime.dispatchLease({...f.lease,
    verification_subject:{run_id:ids.task,result_sha256:'0'.repeat(64)}});
  assert.equal(await settled(f),'RESULT_READY');assert.equal(f.calls.filter(x=>x==='resolve-subject').length,1);
  assert.equal((await f.runtime.observeLease(f.lease)).state,'RESULT_ACKNOWLEDGED');assert.equal(f.calls.includes('publish-author'),false);
});

test('provider preparation precedes issuance, canonical protected registration occurs once, and cached providers remain private',async t=>{
  const f=fixture();t.after(()=>f.runtime.close());
  assert.equal((await f.runtime.observeProviders()).providers.length,0);await providerRefreshDone(f);
  const first=await f.runtime.observeProviders(),second=await f.runtime.observeProviders();
  assert.equal(first.providers.length,1);assert.equal(second.providers.length,1);assert.equal(f.providerIssues,1);
  first.providers[0].payload.provider_id=ids.task;
  assert.equal((await f.runtime.observeProviders()).providers[0].payload.provider_id,ids.provider);
  assert.equal(f.calls.filter(x=>x==='register-provider').length,1);
  assert(f.calls.indexOf('prepare-image')<f.calls.indexOf('issue-provider'));
});

test('unknown provider registration is quarantined without re-registration or model execution',async t=>{
  const f=fixture({unknownRegistration:true});t.after(()=>f.runtime.close());
  assert.equal((await f.runtime.observeProviders()).providers.length,0);await providerRefreshDone(f);
  assert.equal((await f.runtime.observeProviders()).providers.length,0);await providerRefreshDone(f);
  assert.equal(f.calls.filter(x=>x==='register-provider').length,1);assert.equal(f.runCount,0);assert.equal(f.runtime.snapshot().provider_fences,1);
});

test('temporarily removing an ambiguous provider from the roster cannot reset its no-retry fence',async t=>{
  const f=fixture({unknownRegistration:true});t.after(()=>f.runtime.close());
  await f.runtime.observeProviders();await providerRefreshDone(f);
  f.args.permitRegistry.listProviderSelectors=async()=>[];await f.runtime.observeProviders();await providerRefreshDone(f);
  f.args.permitRegistry.listProviderSelectors=async()=>[{provider_id:ids.provider,agent_id:agent}];
  assert.equal((await f.runtime.observeProviders()).providers.length,0);
  assert.equal(f.calls.filter(x=>x==='register-provider').length,1);assert.equal(f.runtime.snapshot().provider_fences,1);
});

test('a hanging protected roster read never holds the W30 heartbeat or starts parallel refreshes',async t=>{
  let release,reads=0;const gate=new Promise(r=>{release=r;}),f=fixture();
  t.after(async()=>{release();await f.runtime.close();});
  f.args.permitRegistry.listProviderSelectors=async()=>{reads++;await gate;return [];};
  let timeout;
  const returned=await Promise.race([f.runtime.observeProviders(),new Promise(r=>{timeout=setTimeout(()=>r('BLOCKED'),100);})]);
  clearTimeout(timeout);assert.notEqual(returned,'BLOCKED');
  for(let i=0;i<10;i++)await f.runtime.observeProviders();
  assert.equal(reads,1);assert.equal(f.providerIssues,0);assert.equal(f.runtime.snapshot().provider_refresh_running,true);
  release();await providerRefreshDone(f);
});

test('each registration ACK becomes visible while another issuer hangs, and expired envelopes are never returned',async t=>{
  let release,clock=Date.now();const gate=new Promise(r=>{release=r;});t.mock.method(Date,'now',()=>clock);
  const f=fixture({physicalSlotBudget:2,providerExpiry:()=>new Date(clock+1000).toISOString(),
    beforeIssueProvider:async(_selector,count)=>{if(count===2)await gate;}});
  t.after(async()=>{release();await f.runtime.close();});
  f.args.permitRegistry.listProviderSelectors=async()=>[{provider_id:ids.provider,agent_id:agent},{provider_id:ids.project,agent_id:agent}];
  await f.runtime.observeProviders();
  for(let i=0;i<100&&f.providerIssues<2;i++)await new Promise(r=>setImmediate(r));
  assert.equal(f.providerIssues,2);assert.equal(f.runtime.snapshot().provider_refresh_running,true);
  let timeout;
  const row=await Promise.race([f.runtime.observeProviders(),new Promise(r=>{timeout=setTimeout(()=>r('BLOCKED'),100);})]);
  clearTimeout(timeout);assert.notEqual(row,'BLOCKED');assert.equal(row.providers.length,1);assert.equal(row.providers[0].payload.provider_id,ids.provider);
  clock+=1001;
  for(let i=0;i<3;i++)assert.equal((await f.runtime.observeProviders()).providers.length,0);
  assert.equal(f.calls.filter(x=>x==='register-provider').length,1);assert.equal(f.providerIssues,2);
  release();await providerRefreshDone(f);
});

test('round-robin registration is bounded per heartbeat pass and reaches later logical providers',async t=>{
  const f=fixture({physicalSlotBudget:1});t.after(()=>f.runtime.close());
  f.args.permitRegistry.listProviderSelectors=async()=>[
    {provider_id:ids.provider,agent_id:agent},{provider_id:ids.project,agent_id:agent},{provider_id:ids.workspace,agent_id:agent}];
  for(let i=1;i<=3;i++){
    await f.runtime.observeProviders();await providerRefreshDone(f);assert.equal(f.providerIssues,i);
    assert.equal(f.calls.filter(x=>x==='register-provider').length,i);
  }
  const row=await f.runtime.observeProviders();assert.equal(row.providers.length,3);
  await providerRefreshDone(f);assert.equal(f.providerIssues,3);
});

test('closing during a hanging issuer prevents a later protected registration',async()=>{
  let release;const gate=new Promise(r=>{release=r;}),f=fixture({beforeIssueProvider:async()=>gate,closeTimeoutMs:10});
  await f.runtime.observeProviders();for(let i=0;i<100&&!f.providerIssues;i++)await new Promise(r=>setImmediate(r));
  assert.equal(f.providerIssues,1);assert.equal((await f.runtime.close()).shutdown_state,'DRAIN_TIMEOUT');release();await f.runtime.drainClosedWork();await providerRefreshDone(f);
  assert.equal(f.calls.filter(x=>x==='register-provider').length,0);assert.equal((await f.runtime.observeProviders()).providers.length,0);
});

test('missing private ledger capability is rejected at composition, not after a task starts',async t=>{
  const f=fixture();t.after(()=>f.runtime.close());const ownPostgres={...f.args.ownPostgres};delete ownPostgres.ledger;
  assert.throws(()=>createNativeCodingRuntime({...f.args,ownPostgres}),/private_ledger_required/);
});

test('runtime prepares the bridge with its full protected permit and binds it after exact ATTEMPTED/RUNNING acknowledgement',async t=>{
  const f=fixture();t.after(()=>f.runtime.close());let prepared=0,closed=0,bound=0;
  const runtime=createNativeCodingRuntime({...f.args,
    observers:{...f.args.observers,readAgentMcpLaunchPins:async()=>({fixture_pins:true})},
    agentBridgeFactory:async value=>{
      prepared++;assert.deepEqual(value.permit,f.permit);assert.equal(value.ownPostgres,f.args.ownPostgres);assert.equal(value.pins.fixture_pins,true);
      return {launch:{fixture_only:true},async bindRun(proof){
        assert.deepEqual(proof,processProof);assert(f.calls.includes('ledger:ATTEMPTED'));assert(f.calls.includes('mark-running'));bound++;
      },async close(){closed++;}};
    },runnerFactory:({authorizeLease,prepareAgentBridge})=>({async run(request){
      const authorization=await authorizeLease({phase:'BEFORE_ATTEMPT',binding:request.lease});
      const bridge=await prepareAgentBridge({runId:ids.run,binding:request.lease,authorization,deadlineAt:authorization.expires_at});
      try{
        await authorizeLease({phase:'BEFORE_RESUME',binding:request.lease,run_id:ids.run,process:processProof});
        await bridge.bindRun(processProof);throw Error('fixture_stops_before_any_model');
      }finally{await bridge.close();}
    }})});t.after(()=>runtime.close());
  runtime.dispatchLease(f.lease);
  for(let i=0;i<100&&['PREPARING','RUNNING'].includes(runtime.snapshot().jobs[0]?.state);i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(prepared,1);assert.equal(bound,1);assert.equal(closed,1);assert.equal(runtime.snapshot().jobs[0].state,'READBACK_REQUIRED');
});

test('real private Host disconnect synchronously fences an active fixture worker and drains it without replay',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-native-loss-'));
  const entry=path.join(directory,'host.mjs');
  await fs.writeFile(entry,"process.on('disconnect',()=>process.exit(0));process.send({ready:true});\n");
  const child=fork(entry,[],{execPath:process.execPath,windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
  let capability;
  t.after(async()=>{
    capability?.close();
    if(child.exitCode===null&&child.signalCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}
    const actual=await fs.realpath(directory),temporary=await fs.realpath(os.tmpdir());
    assert(actual.startsWith(temporary+path.sep)&&path.basename(actual).startsWith('metaengine-native-loss-'));
    await fs.rm(actual,{recursive:true,force:true});
  });
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('fixture_host_start_timeout')),5000);
    child.once('message',()=>{clearTimeout(timer);resolve();});
    child.once('error',error=>{clearTimeout(timer);reject(error);});
  });
  capability=createNativeCodingHostIpcClient({child,hostPid:child.pid,instanceId:ids.run});
  let aborted=false;
  const f=fixture({onUnavailable:capability.onUnavailable,afterResume:({signal})=>new Promise((_,reject)=>{
    signal.addEventListener('abort',()=>{aborted=true;reject(Error('fixture_worker_aborted'));},{once:true});
  })});
  t.after(()=>f.runtime.close());
  f.runtime.dispatchLease(f.lease);
  for(let i=0;i<100&&!f.calls.includes('resume');i++)await new Promise(resolve=>setImmediate(resolve));
  assert(f.calls.includes('resume'));assert.equal(aborted,false);
  const lost=new Promise(resolve=>capability.onUnavailable(resolve));child.disconnect();await lost;
  assert.equal(aborted,true);assert.equal(f.runtime.snapshot().closed,true);
  assert.equal(f.runtime.snapshot().host_unavailable_reason,'CHANNEL_CLOSED');
  assert(f.calls.includes('workers-close'));assert(f.calls.includes('issuer-close'));
  assert.equal(f.runtime.dispatchLease({...f.lease,task_id:ids.provider}).state,'STOPPED');
  assert.equal((await f.runtime.observeProviders()).providers.length,0);
  assert.equal(f.runtime.observeProjectCheckpoints([{malformed:true}]).state,'STOPPED');
  assert.equal((await f.runtime.completeFromTrustedCommand(f.lease)).state,'STOPPED');
  const closed=await f.runtime.close();
  assert.equal(closed.shutdown_state,'DRAINED');assert.equal(closed.jobs[0].state,'READBACK_REQUIRED');
  assert.equal(closed.occupied_slots,1);assert.equal(closed.execution_outcomes_reconciled,false);
  assert.equal(f.runCount,1);assert.equal(f.calls.includes('complete'),false);
});

test('loss immediately after dispatch prevents delayed preparation from reserving or launching',async()=>{
  const f=fixture();f.runtime.dispatchLease(f.lease);f.loseHost();
  const closed=await f.runtime.close();assert.equal(closed.shutdown_state,'DRAINED');
  assert.equal(f.runCount,0);assert.equal(f.calls.includes('reserve'),false);
  assert.equal(closed.jobs[0].state,'READBACK_REQUIRED');
});

test('loss hides a cached descriptor and a late registration ACK cannot publish another',async t=>{
  let release,registered=0;const gate=new Promise(resolve=>{release=resolve;});
  const f=fixture({physicalSlotBudget:2,beforeRegisterAck:async()=>{if(++registered===2)await gate;}});
  t.after(async()=>{release();await f.runtime.close();});
  f.args.permitRegistry.listProviderSelectors=async()=>[{provider_id:ids.provider,agent_id:agent},{provider_id:ids.project,agent_id:agent}];
  await f.runtime.observeProviders();
  for(let i=0;i<100&&registered<2;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(registered,2);assert.equal((await f.runtime.observeProviders()).providers.length,1);
  f.loseHost('SEND_FAILED');assert.equal((await f.runtime.observeProviders()).providers.length,0);
  release();await providerRefreshDone(f);await f.runtime.close();
  for(let i=0;i<3;i++)assert.equal((await f.runtime.observeProviders()).providers.length,0);
  assert.equal(registered,2);assert.equal(f.providerIssues,2);
});

test('loss during issuance cannot begin a registration when the issuer later resolves',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;}),f=fixture({beforeIssueProvider:async()=>gate,closeTimeoutMs:10});
  await f.runtime.observeProviders();
  for(let i=0;i<100&&!f.providerIssues;i++)await new Promise(resolve=>setImmediate(resolve));
  f.loseHost();assert.equal((await f.runtime.close()).shutdown_state,'DRAIN_TIMEOUT');release();await f.runtime.drainClosedWork();await providerRefreshDone(f);
  assert.equal(f.calls.filter(call=>call==='register-provider').length,0);
});

test('fencing preserves unknown completion and registration records',async()=>{
  const f=fixture({unknownCompletion:true,unknownRegistration:true});
  await f.runtime.observeProviders();await providerRefreshDone(f);
  f.runtime.dispatchLease(f.lease);await settled(f);await f.runtime.observeLease(f.lease);
  assert.equal(f.runtime.snapshot().completion_readbacks,1);assert.equal(f.runtime.snapshot().provider_fences,1);
  f.loseHost();const closed=await f.runtime.close();
  assert.equal(closed.completion_readbacks,1);assert.equal(closed.provider_fences,1);assert.equal(closed.occupied_slots,1);
  assert.equal((await f.runtime.completeFromTrustedCommand(f.lease)).state,'STOPPED');
  assert.equal(f.calls.filter(call=>call==='complete').length,1);assert.equal(f.runCount,1);
});

test('close is idempotent and bounded while an unresolved worker drain stays explicitly unconfirmed',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;}),f=fixture({workerClose:()=>gate,closeTimeoutMs:20});
  f.loseHost();const first=await f.runtime.close();
  assert.equal(first.shutdown_state,'DRAIN_TIMEOUT');assert.equal(first.closed,true);
  assert.equal(f.calls.filter(call=>call==='workers-close').length,1);
  assert.equal((await f.runtime.close()).shutdown_state,'DRAIN_TIMEOUT');
  assert.equal(f.runtime.dispatchLease(f.lease).state,'STOPPED');
  release();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.runtime.snapshot().shutdown_state,'DRAINED');
  assert.equal(f.runtime.snapshot().execution_outcomes_reconciled,false);
});

test('a failed drain remains fenced, and late subscription to an unavailable Host cannot admit work',async()=>{
  const failed=fixture({workerClose:async()=>{throw Error('fixture_cleanup_unconfirmed');}});
  failed.loseHost();assert.equal((await failed.runtime.close()).shutdown_state,'DRAIN_FAILED');
  assert.equal(failed.runtime.dispatchLease(failed.lease).state,'STOPPED');
  let unsubscribed=0;
  const late=fixture({onUnavailable:listener=>{listener({reason:'CLIENT_CLOSED'});return()=>{unsubscribed++;};}});
  assert.equal(late.runtime.snapshot().closed,true);assert.equal(unsubscribed,1);
  assert.equal(late.runtime.dispatchLease(late.lease).state,'STOPPED');
  assert.equal((await late.runtime.close()).shutdown_state,'DRAINED');assert.equal(late.runCount,0);
});

test('terminal Host loss while publishing prevents a new signed completion POST',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;}),f=fixture({beforePublish:()=>gate});
  f.runtime.dispatchLease(f.lease);await settled(f);const completion=f.runtime.observeLease(f.lease);
  for(let i=0;i<100&&!f.calls.includes('publish-author');i++)await new Promise(resolve=>setImmediate(resolve));
  f.loseHost('HOST_TERMINATED');assert.equal(f.runtime.snapshot().completion_readbacks,1);
  release();assert.equal((await completion).state,'READBACK_REQUIRED');
  assert.equal(f.calls.includes('complete'),false);assert.equal(f.runtime.snapshot().occupied_slots,1);
  await f.runtime.close();
});

for(const unknownAck of [false,true])test(`Host loss retains an already attempted completion while its late ACK is ${unknownAck?'unknown':'successful'}`,async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;}),f=fixture({beforeCompleteAck:()=>gate,unknownCompletion:unknownAck});
  f.runtime.dispatchLease(f.lease);await settled(f);const completion=f.runtime.observeLease(f.lease);
  for(let i=0;i<100&&!f.calls.includes('complete');i++)await new Promise(resolve=>setImmediate(resolve));
  assert(f.calls.includes('complete'));f.loseHost();assert.equal(f.runtime.snapshot().completion_readbacks,1);
  release();assert.equal((await completion).state,'READBACK_REQUIRED');
  const closed=await f.runtime.close();assert.equal(closed.occupied_slots,1);assert.equal(closed.completion_readbacks,1);
  assert.equal(f.calls.filter(call=>call==='complete').length,1);
});

test('fulfilled worker shutdown without positive physical cleanup cannot claim DRAINED',async()=>{
  const f=fixture({cleanupConfirmed:false});f.loseHost();const closed=await f.runtime.close();
  assert.equal(closed.shutdown_state,'DRAIN_UNCONFIRMED');assert.equal(closed.worker_cleanup_confirmed,false);
  assert.equal(f.runtime.dispatchLease(f.lease).state,'STOPPED');
});

test('Host loss revokes a prepared MCP bridge before joining a still-pending runner',async t=>{
  const f=fixture();t.after(()=>f.runtime.close());let releaseRun,preparedResolve,bridge,bridgeClosed=0;
  const prepared=new Promise(resolve=>{preparedResolve=resolve;});
  const runtime=createNativeCodingRuntime({...f.args,
    observers:{...f.args.observers,readAgentMcpLaunchPins:async()=>({fixture_pins:true})},
    agentBridgeFactory:async()=>({launch:{fixture_only:true},bindRun:async()=>{},close:async()=>{bridgeClosed++;}}),
    runnerFactory:({authorizeLease,prepareAgentBridge})=>({async run(request){
      const authorization=await authorizeLease({phase:'BEFORE_ATTEMPT',binding:request.lease});
      bridge=await prepareAgentBridge({runId:ids.run,binding:request.lease,authorization,deadlineAt:authorization.expires_at});
      preparedResolve();await new Promise(resolve=>{releaseRun=resolve;});
      throw Error('fixture_no_model');
    }})});t.after(()=>runtime.close());
  runtime.dispatchLease(f.lease);await prepared;f.loseHost();
  assert.equal(bridgeClosed,1);assert.equal(runtime.snapshot().shutdown_state,'DRAINING');
  assert.throws(()=>bridge.bindRun(processProof),/closed/);
  releaseRun();const stopped=await runtime.close();
  assert.equal(stopped.shutdown_state,'DRAINED');assert.equal(stopped.worker_cleanup_confirmed,true);
  assert.equal(stopped.execution_outcomes_reconciled,false);assert.equal(bridgeClosed,1);
});

test('runtime drain joins an in-flight private commit before journals and Host may retire',async t=>{
  const f=fixture();t.after(()=>f.runtime.close());let release,enteredResolve,writes=0,finished=false;
  const entered=new Promise(resolve=>{enteredResolve=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  const row={project_id:ids.project,checkpoint_id:ids.run,checkpoint_sha256:'a'.repeat(64),writer_task_id:ids.task,
    writer_lease_generation:1,critic_task_id:ids.permit,critic_lease_generation:2};
  const flags={production_qualified:false,automatic_retry_allowed:false,authority_effect:false,successor_admitted:false};
  const runtime=createNativeCodingRuntime({...f.args,ownPostgres:{...f.args.ownPostgres,
    readFinishCheckpoint:async query=>({schema:'metaengine.native-coding.host-commit-service.v1',...query,...flags,
      checkpoint_id:row.checkpoint_id,state:'PENDING_COMMIT',git_readback:{schema:'metaengine.native-coding.git-commit-receipt.v1',
        ...query,checkpoint_id:row.checkpoint_id,state:'NOT_ATTEMPTED',...flags}}),
    finishCheckpoint:async()=>{writes++;enteredResolve();await gate;return {state:'SQL_FINALIZE_UNKNOWN'};},
  }});t.after(()=>runtime.close());
  runtime.observeProjectCommits([row]);await entered;
  const closing=runtime.close().then(value=>{finished=true;return value;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);
  assert.equal(runtime.snapshot().shutdown_state,'DRAINING');assert.equal(runtime.snapshot().project_commits.readback_required,1);
  release();const result=await closing;assert.equal(result.shutdown_state,'DRAINED');assert.equal(writes,1);
  assert.equal(result.execution_outcomes_reconciled,false);
});

test('runtime drains its private rejection read without treating it as a repair or successful execution',async t=>{
 const f=fixture();t.after(()=>f.runtime.close());let release,enteredResolve,finished=false;
 const entered=new Promise(resolve=>{enteredResolve=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const runtime=createNativeCodingRuntime({...f.args,ownPostgres:{...f.args.ownPostgres,readProjectRejection:async()=>{enteredResolve();await gate;throw Error('fixture_unknown_read');}}});
 t.after(()=>runtime.close());
 runtime.observeProjectRejection({schema:'metaengine.native-coding.review-rejection.v1',project_id:ids.project,writer_task_id:ids.task,
  writer_lease_generation:1,critic_task_id:ids.provider,critic_lease_generation:1,result_sha256:'a'.repeat(64),verdict:'REJECT',automatic_retry_allowed:false,authority_effect:false});
 await entered;const closing=runtime.close().then(v=>{finished=true;return v;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);assert.equal(runtime.snapshot().project_rejections.repair_authorized,false);
 release();await closing;assert.equal(runtime.snapshot().project_rejections.closed,true);assert.equal(f.runCount,0);
});

test('actual runtime uses Main owner and signed census READ on existing heartbeat, status stays read-only',async()=>{
 const base=fixture();await base.runtime.close();const owner=createNativeCodingCapacityOwner();let reads=0,release;
 const gate=new Promise(r=>{release=r;}),actor={device_id:ids.task,client_id:ids.workspace,key_fingerprint_sha256:'a'.repeat(64),admin_grant_epoch:1};
 const ownPostgres={...base.args.ownPostgres,snapshot:()=>({instance_id:ids.run,host_pid:123,closed:false}),readNativeCapacity:async request=>{
  reads++;assert.equal(request.body.operation,'READ_NATIVE_CAPACITY_V1');await gate;const wall=Date.now();
  return {schema:'metaengine.native-coding.capacity-census.v1',host_instance_id:ids.run,host_pid:123,principal_sha256:nativeCapacityPrincipal(actor),
   postgres_scope_sha256:'b'.repeat(64),generation:1,owned_tasks_sha256:capacitySha(request.body.input.owned_tasks),observed_at:new Date(wall).toISOString(),expires_at:new Date(wall+10000).toISOString(),
   census_sha256:'c'.repeat(64),complete:true,state:'CURRENT',counts:{task_slots:0,setup_slots:0,represented_tasks:0,unrepresented_claims:0,unresolved_slots:0},automatic_retry_allowed:false,authority_effect:false};}};
 const runtime=createNativeCodingRuntime({...base.args,ownPostgres,capacityOwner:owner,capacityDevice:actor,readResourceAdmission:()=>({physical_start_allowed:true,physical_parallelism:2})});
 assert.equal(runtime.snapshot().capacity_observation.projection.free_slots,0);assert.equal(reads,0);
 await runtime.observeProviders();await runtime.observeProviders();await new Promise(r=>setImmediate(r));assert.equal(reads,1);
 assert.equal(runtime.snapshot().capacity_observation.projection.free_slots,0);assert.equal(base.runCount,0);
 release();await owner.drain();assert.equal(runtime.snapshot().capacity_observation.projection.free_slots,1);
 await runtime.close();assert.equal(runtime.snapshot().capacity_observation.projection.free_slots,0);assert.equal(base.runCount,0);
});

for(const mode of ['success','owner-change','mixed-v1'])test('actual runtime retained first dispatch uses current Main/v2 custody: '+mode,async()=>{
 const base=fixture();await base.runtime.close();const owner=createNativeCodingCapacityOwner();let generation=0,v2=0,v1=0;
 const actor={device_id:ids.task,client_id:ids.workspace,key_fingerprint_sha256:'a'.repeat(64),admin_grant_epoch:1};
 const ownPostgres={...base.args.ownPostgres,snapshot:()=>({instance_id:ids.run,host_pid:123,closed:false}),
  serviceHeartbeat:async()=>{v1++;throw Error('v1 fallback forbidden');},readNativeCapacity:async packet=>{
   const owned=packet.body.input.owned_tasks,wall=Date.now();return {schema:'metaengine.native-coding.capacity-census.v1',host_instance_id:ids.run,host_pid:123,
    principal_sha256:nativeCapacityPrincipal(actor),postgres_scope_sha256:'b'.repeat(64),generation:++generation,owned_tasks_sha256:capacitySha(owned),
    observed_at:new Date(wall).toISOString(),expires_at:new Date(wall+10000).toISOString(),census_sha256:'c'.repeat(64),complete:true,state:'CURRENT',
    counts:{task_slots:owned.length,setup_slots:0,represented_tasks:owned.length,unrepresented_claims:0,unresolved_slots:0},automatic_retry_allowed:false,authority_effect:false};}};
 if(mode!=='mixed-v1')Object.assign(ownPostgres,{serviceHeartbeatV2:async packet=>{v2++;assert.equal(packet.body.operation,'SERVICE_HEARTBEAT_V2');return {
  schema:'metaengine.native-coding.service-heartbeat-ack.v2',accepted:true,body_sha256:packet.headers['x-a2-device-body-sha256'],witness_sha256:'a'.repeat(64),
  expires_at:packet.body.input.capacity.census.expires_at,readback_only:false,authority_effect:false};},readServiceHeartbeatV2:async()=>null});
 const runtime=createNativeCodingRuntime({...base.args,ownPostgres,capacityOwner:owner,capacityDevice:actor,readResourceAdmission:()=>({physical_start_allowed:true,physical_parallelism:1})});
 try{
  for(let i=0;i<3;i++){await runtime.observeProviders();await owner.drain();await providerRefreshDone({runtime});}
  assert.equal(v1,0);assert.equal(runtime.snapshot().occupied_slots,0);
  if(mode==='mixed-v1'){assert.equal(v2,0);assert.equal((await runtime.observeProviders()).providers.length,0);return;}
  assert.ok(v2>0);assert.equal(runtime.dispatchLease(base.lease).reason,'WAITING_CAPACITY');assert.equal(base.runCount,0);
  await runtime.observeLease(base.lease);runtime.snapshot();assert.equal(base.runCount,0,'legacy observation cannot first-dispatch');
  await runtime.observeProviders();await owner.drain();await providerRefreshDone({runtime});
  assert.equal(runtime.snapshot().capacity_observation.projection.free_slots,0,'held lease counted once, not a new allocation');
  if(mode==='owner-change')base.permit.owner_epoch++;
  runtime.advanceUnattemptedLease(base.lease);await settled({runtime});
  if(mode==='owner-change'){assert.equal(base.runCount,0);assert.equal(runtime.snapshot().jobs[0].state,'READBACK_REQUIRED');}
  else{assert.equal(base.runCount,1);assert.equal((await runtime.observeLease(base.lease)).state,'RESULT_ACKNOWLEDGED');
   assert.equal(base.calls.filter(x=>x==='complete').length,1,'pre-existing completion POST remains explicit in evidence, not described as pure');}
  runtime.advanceUnattemptedLease(base.lease);await new Promise(r=>setImmediate(r));assert.equal(base.runCount,mode==='success'?1:0);
 }finally{await runtime.close();}
});

for(const failed of [false,true])test(`concurrent runtime quit joins a runner-started original bridge close (${failed?'failed retained':'held success'})`,async t=>{
 const f=fixture();t.after(()=>f.runtime.close());const gate=Promise.withResolvers(),entered=Promise.withResolvers();let closes=0,bridge;
 const runtime=createNativeCodingRuntime({...f.args,
  observers:{...f.args.observers,readAgentMcpLaunchPins:async()=>({fixture_pins:true})},
  agentBridgeFactory:async()=>({launch:{fixture_only:true},bindRun:async()=>{},close:()=>{closes++;return gate.promise;}}),
  runnerFactory:({authorizeLease,prepareAgentBridge})=>({async run(request){
   const authorization=await authorizeLease({phase:'BEFORE_ATTEMPT',binding:request.lease});
   bridge=await prepareAgentBridge({runId:ids.run,binding:request.lease,authorization,deadlineAt:authorization.expires_at});
   const first=bridge.close();void first.catch(()=>{});entered.resolve();
   try{await bridge.close();}finally{throw Error('fixture_no_model');}
  }})});t.after(()=>runtime.close());runtime.dispatchLease(f.lease);await entered.promise;
 let finished=false;const closing=runtime.close().then(value=>{finished=true;return value;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);assert.equal(closes,1);assert.ok(f.calls.includes('workers-close'));
 if(failed)gate.reject(Error('fixture_transport_close_failed'));else gate.resolve();
 const stopped=await closing;assert.equal(stopped.shutdown_state,failed?'DRAIN_FAILED':'DRAINED');assert.equal(closes,1);
 if(failed)await assert.rejects(bridge.close(),/fixture_transport_close_failed/);else await bridge.close();
 assert.equal(closes,1);
});

const lifetimeGate=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
const lifetimeTurn=()=>new Promise(resolve=>setImmediate(resolve));
test('staged drain fences real registry before pending authorization returns; empty map cannot admit a late child',async()=>{
 const auth=lifetimeGate(),entered=lifetimeGate();let spawnCalls=0;
 const workers=createNativeCodingWorkerRegistry({readProcess:async()=>{},processController:{spawn:async()=>{spawnCalls++;throw Error('must not spawn');}}});
 const f=fixture({workerRegistry:workers,closeTimeoutMs:10}),original=f.args.ownPostgres.readLease;
 const staleController=workers.controllerFor({provider_id:ids.provider,agent_id:agent,task_id:ids.task,lease_generation:1,prompt_sha256:hash(f.prompt)});
 f.args.ownPostgres.readLease=async()=>{entered.resolve();await auth.promise;return original();};
 f.runtime.dispatchLease(f.lease);await entered.promise;
 const workersDone=await f.runtime.drainNativeWorkers();assert.equal(workersDone.admission_fenced,true);assert.equal(workersDone.worker_cleanup_confirmed,true);
 assert.equal(f.runtime.dispatchLease(f.lease).state,'STOPPED');assert.equal(f.runtime.advanceUnattemptedLease(f.lease).state,'STOPPED');
 await assert.rejects(staleController.spawn({runId:ids.run,binding:f.lease}),/worker_scope_changed/);
 assert.throws(()=>workers.controllerFor({provider_id:ids.provider,prompt_sha256:hash(f.prompt)}),/worker_scope_invalid/);
 let fullyJoined=false;const full=f.runtime.drainClosedWork().then(value=>{fullyJoined=true;return value;});
 assert.equal((await f.runtime.close()).shutdown_state,'DRAIN_TIMEOUT');assert.equal(fullyJoined,false);assert.equal(spawnCalls,0);
 auth.resolve();assert.equal((await full).shutdown_state,'DRAINED');assert.equal(f.runCount,0);assert.equal(spawnCalls,0);
});
test('staged runtime worker drain owns pending native spawn and waits both late handle and checked cleanup',async()=>{
 const spawn=lifetimeGate(),entered=lifetimeGate(),completion=lifetimeGate(),terminated=lifetimeGate();let nativeSpawns=0,resumes=0,generated;
 const workers=createNativeCodingWorkerRegistry({readProcess:async()=>{},processController:{spawn:async spec=>{nativeSpawns++;generated=joinedSettlementFixture(spec);entered.resolve();return spawn.promise;}}});
 const f=fixture({workerRegistry:workers,closeTimeoutMs:10,runnerFactory:({processController})=>({async run(request){
   const handle=await processController.spawn({runId:ids.run,binding:request.lease});await handle.resume(request.prompt);return null;
 }})});
 f.runtime.dispatchLease(f.lease);await entered.promise;
 let drained=false;const drain=f.runtime.drainNativeWorkers().then(value=>{drained=true;return value;});
 await lifetimeTurn();assert.equal(drained,false);assert.equal((await f.runtime.close()).shutdown_state,'DRAIN_TIMEOUT');
 spawn.resolve({proof:generated.proof,completion:completion.promise,resume:async()=>{resumes++;},terminate:async()=>{terminated.resolve();}});
 await terminated.promise;await lifetimeTurn();assert.equal(drained,false,'handle arrival/terminate request is not physical cleanup');
 completion.resolve(generated.complete({exit_code:1}));assert.equal((await drain).worker_cleanup_confirmed,true);
 assert.equal((await f.runtime.drainClosedWork()).shutdown_state,'DRAINED');assert.equal(nativeSpawns,1);assert.equal(resumes,0);
});
for(const malformed of [false,true])test(`staged worker proof refuses native cleanup ${malformed?'without joined transcript':'failure'} and retains original promise`,async()=>{
 const f=fixture({cleanupConfirmed:false});
 if(malformed)f.args.workerRegistry.close=async()=>({schema:'wrong',cleanup_confirmed:true});
 await assert.rejects(f.runtime.drainNativeWorkers(),/worker_cleanup_unconfirmed/);
 await assert.rejects(f.runtime.drainNativeWorkers(),/worker_cleanup_unconfirmed/);
 assert.equal((await f.runtime.drainClosedWork()).shutdown_state,'DRAIN_UNCONFIRMED');
});
for(const method of ['observeLease','completeFromTrustedCommand'])test(`full close joins preexisting ${method} completion callback but worker drain does not depend on Host ACK`,async()=>{
 const ack=lifetimeGate(),entered=lifetimeGate();const f=fixture({closeTimeoutMs:10,beforeCompleteAck:async()=>{entered.resolve();await ack.promise;}});
 f.runtime.dispatchLease(f.lease);assert.equal(await settled(f),'RESULT_READY');
 const callback=f.runtime[method](f.lease);await entered.promise;
 assert.equal((await f.runtime.drainNativeWorkers()).worker_cleanup_confirmed,true);
 let done=false;const joined=f.runtime.drainClosedWork().then(v=>{done=true;return v;});
 assert.equal((await f.runtime.close()).shutdown_state,'DRAIN_TIMEOUT');assert.equal(done,false);
 ack.resolve();assert.equal((await callback).state,'READBACK_REQUIRED');assert.equal((await joined).shutdown_state,'DRAINED');
 assert.equal(f.calls.filter(x=>x==='complete').length,1);assert.equal(f.runtime.snapshot().execution_outcomes_reconciled,false);
});
test('full runtime close retains provider refresh separately from caller deadline and worker proof',async()=>{
 const ack=lifetimeGate(),entered=lifetimeGate();const f=fixture({closeTimeoutMs:10,beforeRegisterAck:async()=>{entered.resolve();await ack.promise;}});
 await f.runtime.observeProviders();await entered.promise;assert.equal((await f.runtime.drainNativeWorkers()).worker_cleanup_confirmed,true);
 let done=false;const joined=f.runtime.drainClosedWork().then(v=>{done=true;return v;});
 assert.equal((await f.runtime.close()).shutdown_state,'DRAIN_TIMEOUT');assert.equal(done,false);
 ack.resolve();assert.equal((await joined).shutdown_state,'DRAINED');assert.equal(f.runtime.snapshot().provider_refresh_running,false);
 assert.equal((await f.runtime.observeProviders()).providers.length,0);assert.equal(f.calls.filter(x=>x==='register-provider').length,1);
});

for(const failed of [false,true])test(`late bridge factory after runtime fence remains owned through separate callback join (${failed?'failed HOLD':'joined'})`,async()=>{
 const base=fixture();await base.runtime.close();const factory=Promise.withResolvers(),entered=Promise.withResolvers(),callbacks=Promise.withResolvers();let closes=0,joins=0,binds=0;
 const runtime=createNativeCodingRuntime({...base.args,closeTimeoutMs:10,
  observers:{...base.args.observers,readAgentMcpLaunchPins:async()=>({fixture_pins:true})},
  agentBridgeFactory:async()=>{entered.resolve();await factory.promise;return {launch:{fixture_only:true},bindRun:async()=>{binds++;},
   close:async()=>{closes++;},drainCallbacks:()=>{joins++;return callbacks.promise;}};},
  runnerFactory:({authorizeLease,prepareAgentBridge})=>({async run(request){
   const authorization=await authorizeLease({phase:'BEFORE_ATTEMPT',binding:request.lease});
   await prepareAgentBridge({runId:ids.run,binding:request.lease,authorization,deadlineAt:authorization.expires_at});throw Error('no late run allowed');
  }})});
 runtime.dispatchLease(base.lease);await entered.promise;
 assert.equal((await runtime.drainNativeWorkers()).worker_cleanup_confirmed,true,'closed admission does not await Host-dependent bridge preparation');
 let done=false;const full=runtime.drainClosedWork().then(value=>{done=true;return value;});
 assert.equal((await runtime.close()).shutdown_state,'DRAIN_TIMEOUT');assert.equal(closes,0);assert.equal(done,false);
 factory.resolve();for(let i=0;i<10&&joins===0;i++)await lifetimeTurn();
 assert.equal(closes,1);assert.equal(joins,1);assert.equal(binds,0);assert.equal(done,false,'transport close is not callback join');
 if(failed)callbacks.reject(Error('generated_callback_join_failed'));else callbacks.resolve({state:'HOLD',lineage:'LINEAGE_UNBOUND',fixture_only:true});
 assert.equal((await full).shutdown_state,failed?'DRAIN_FAILED':'DRAINED');await runtime.close();assert.equal(closes,1);assert.equal(joins,1);
});

test('actual runtime default bridge remains blocked by directory publication before custody claim or bind',async()=>{
 const base=fixture();await base.runtime.close();let custody=0,reason=null;
 const runtime=createNativeCodingRuntime({...base.args,
  ownPostgres:{...base.args.ownPostgres,openAgentRunCustody:async()=>{custody++;throw Error('must not claim');}},
  observers:{...base.args.observers,readAgentMcpLaunchPins:async()=>({})},
  // No agentBridgeFactory override: execute the actual default producer path.
  runnerFactory:({authorizeLease,prepareAgentBridge})=>({async run(request){
   const authorization=await authorizeLease({phase:'BEFORE_ATTEMPT',binding:request.lease});
   try{await prepareAgentBridge({runId:ids.run,binding:request.lease,authorization,deadlineAt:authorization.expires_at});}
   catch(error){reason=error.message;throw error;}
   throw Error('unqualified bridge must never be returned');
  }})});
 runtime.dispatchLease(base.lease);await settled({runtime});
 assert.equal(reason,'native_run_callback_directory_durability_unqualified');assert.equal(custody,0);
 assert.equal(base.calls.includes('mark-running'),false);assert.equal(base.calls.includes('resume'),false);
 assert.equal((await runtime.close()).shutdown_state,'DRAINED');
});

test('generated runtime resource refusal still prevents a physical start',async t=>{
 const f=fixture({readResourceAdmission:()=>readAgentResourceAdmission({freeMemory:0,totalMemory:8*1024*1024*1024,parallelism:2})});
 t.after(()=>f.runtime.close());
 assert.equal(f.runtime.dispatchLease(f.lease).state,'PHYSICAL_POOL_BUSY');
 assert.equal(f.runCount,0);assert.equal(f.calls.includes('reserve'),false);
});
