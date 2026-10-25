import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import {fork} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createNativeCodingRuntime} from '../src/native-coding-runtime.mjs';
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
  const ownPostgres={ledger,readScope:async()=>{},readLease:async()=>({schema:'metaengine.native-coding.own-pg-lease.v1',
      source:'PRIVATE_RUNTIME_HOST_OWN_PG',observed_at:new Date().toISOString(),value:{...lease},task_prompt:options.badPrompt?'changed in transit':prompt}),
    onUnavailable:options.onUnavailable||((listener)=>{hostListeners.add(listener);return()=>hostListeners.delete(listener);}),
    registerProvider:async envelope=>{calls.push('register-provider');if(options.unknownRegistration)throw Error('fixture_registration_ack_lost');
      await options.beforeRegisterAck?.();return {registered:true,provider_id:envelope.payload.provider_id,envelope_sha256:nativeCodingEnvelopeSha256(envelope)};}};
  const issuer={issueProvider:async selector=>{assert(prepared);providerIssues++;calls.push('issue-provider');
      await options.beforeIssueProvider?.(selector,providerIssues);
      return {signature:'FIXTURE_ONLY',payload:{...selector,expires_at:options.providerExpiry?.()||expiry}};},
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
  const args={identity:{snapshot:()=>({})},ownPostgres,signedRequest,observers,issuer,
    runnerOptions:{expectedExecutableSha256:permit.artifact.cli_executable_sha256},resultStore:store,workerRegistry:workers,
    permitRegistry:{listProviderSelectors:async()=>[{provider_id:ids.provider,agent_id:agent}],readProvider:async()=>permit},runnerFactory,
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
    if(!f.runtime.snapshot().provider_refresh_running)return;
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
  assert.equal(f.runCount,0);assert.equal(f.calls.includes('complete'),false);assert.equal(f.calls.includes('reserve'),false);assert.equal(f.readCount,1);
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
  let release;const gate=new Promise(r=>{release=r;}),f=fixture({beforeIssueProvider:async()=>gate});
  await f.runtime.observeProviders();for(let i=0;i<100&&!f.providerIssues;i++)await new Promise(r=>setImmediate(r));
  assert.equal(f.providerIssues,1);await f.runtime.close();release();await providerRefreshDone(f);
  assert.equal(f.calls.filter(x=>x==='register-provider').length,0);assert.equal((await f.runtime.observeProviders()).providers.length,0);
});

test('missing private ledger capability is rejected at composition, not after a task starts',async t=>{
  const f=fixture();t.after(()=>f.runtime.close());const ownPostgres={...f.args.ownPostgres};delete ownPostgres.ledger;
  assert.throws(()=>createNativeCodingRuntime({...f.args,ownPostgres}),/private_ledger_required/);
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
  let release;const gate=new Promise(resolve=>{release=resolve;}),f=fixture({beforeIssueProvider:async()=>gate});
  await f.runtime.observeProviders();
  for(let i=0;i<100&&!f.providerIssues;i++)await new Promise(resolve=>setImmediate(resolve));
  f.loseHost();await f.runtime.close();release();await providerRefreshDone(f);
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
