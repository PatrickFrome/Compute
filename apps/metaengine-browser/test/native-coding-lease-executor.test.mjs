import {preparedRunnerTestAdapter} from './fixtures/prepared-runner-test-adapter.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createNativeCodingLeaseExecutor } from '../src/native-coding-lease-executor.mjs';
import { nativeCodingEnvelopeSha256 } from '../src/native-coding-transport-proof.mjs';

const task='11111111-1111-4111-8111-111111111111',provider='22222222-2222-4222-8222-222222222222';
const agent='agent_11111111-1111-4111-8111-111111111111';
const processProof={process_incarnation_id:'pid:124:created_100ns:134054310000000000',job_id:provider};
const request={lease:{task_id:task,agent_id:agent,lease_generation:1,agent_generation_epoch:1,base_sha:'a'.repeat(40)},
  role:'IMPLEMENTER',worktreePath:'C:/qa/project',prompt:'Implement a useful leased change.'};
function fixture(overrides={}) {
  const calls=[], scope={workspace_id:task,task_id:task,lease_generation:1,agent_id:agent,
    target_id:`codex-cli:${provider}`,agent_generation_epoch:1,
    host_incarnation:'pid:123:created_100ns:134054310000000000',scope_sha256:'b'.repeat(64)};
  const reserved={...scope,reservation_id:provider};
  let phase='RESERVED';
  const ledger={reserve:async()=>{calls.push('reserve');return{state:'RESERVED',scope:reserved};},
    advance:async(_scope,event)=>{calls.push(event.to);phase=event.to;return{state:phase};},
    read:async()=>{calls.push('read');return{state:phase};},...overrides.ledger};
  const expiry=new Date(Date.now()+300000).toISOString();
  const permit={authorized:true,permit_id:provider,project_id:task,worktree_path:request.worktreePath,
    expires_at:new Date(Date.now()+3600000).toISOString()};
  const readBoundLease=overrides.readBoundLease || (async()=>({scope,provider_id:provider,permit,lease_expires_at:expiry}));
  const issuer={issueJob:async row=>{calls.push('sign-job');return{signature:'UNIT_TEST_ONLY',payload:{...row,
    schema:'metaengine.codex-cli.job-proof.v1',trust_namespace:'LOCAL_OPERATOR_QA',production_qualified:false,
    target_id:scope.target_id,agent_generation_epoch:1,role:'IMPLEMENTER',workspace_id:scope.workspace_id,
    project_id:task,permit_id:provider,host_process:{process_incarnation_id:scope.host_incarnation},
    worker_process:processProof,job_id:provider,prompt_sha256:createHash('sha256').update(request.prompt).digest('hex'),
    worktree:{path:request.worktreePath,base_sha:request.lease.base_sha},expires_at:expiry}};}};
  const legacyFixture=overrides.createRunner || (({authorizeLease})=>({run:async req=>{
    calls.push('runner');
    await authorizeLease({phase:'BEFORE_ATTEMPT',binding:req.lease});
    await authorizeLease({phase:'BEFORE_RESUME',binding:req.lease,run_id:provider,process:processProof});
    calls.push('resume');
    await authorizeLease({phase:'AFTER_EXECUTION',binding:req.lease});
    return{state:'RESULT_READY',task_id:task,lease_generation:1,agent_id:agent,run_id:provider,role:'IMPLEMENTER',result_sha256:'c'.repeat(64)};
  }}));
  const createRunner=overrides.preparedRunner || (args=>preparedRunnerTestAdapter(legacyFixture(args),{runId:provider,
    onPrepare:async req=>{calls.push('prepare');await args.authorizeLease({phase:'BEFORE_ATTEMPT',binding:req.lease});},onFence:()=>{calls.push('fence');}}));
  return{calls,scope,expiry,ledger,issuer,createRunner,readBoundLease,
    executor:createNativeCodingLeaseExecutor({ledger,issuer,createRunner,readBoundLease,...overrides.executor})};
}
test('the own-PG ATTEMPTED commit precedes resume and the result remains unverified',async()=>{
  const f=fixture(),result=await f.executor.execute(request);
  assert.deepEqual(f.calls,['prepare','reserve','runner','sign-job','ATTEMPTED','resume','RESULT_READY']);
  assert.equal(result.state,'RESULT_READY');
  assert.equal(result.useful_work_verified,false);
  assert.equal(result.production_qualified,false);
});
test('a prior reservation after restart only returns readback; no runner/signature/spawn',async()=>{
  const f=fixture({ledger:{reserve:async()=>({state:'READBACK_ONLY',execution:{state:'ATTEMPTED'}})}});
  const result=await f.executor.execute(request);
  assert.equal(result.state,'READBACK_ONLY');assert.deepEqual(f.calls,['prepare','fence']);
});
test('an unconfirmed own-PG barrier prevents resume and only reads the prior receipt',async()=>{
  const f=fixture({ledger:{advance:async()=>{throw new Error('commit_ack_lost');}}});
  await assert.rejects(f.executor.execute(request),error=>error.automatic_retry_allowed===false&&error.execution.state==='RESERVED');
  assert.equal(f.calls.includes('resume'),false);
  assert.equal(f.calls.at(-1),'read');
});
test('native scope drift before resume cannot issue a job or launch',async()=>{
  let f;
  f=fixture({readBoundLease:async observation=>({scope:{...f.scope,
    scope_sha256:observation.phase==='BEFORE_RESUME'?'d'.repeat(64):f.scope.scope_sha256},provider_id:provider,permit:{}})});
  await assert.rejects(f.executor.execute(request),/execution_requires_readback/);
  assert.equal(f.calls.includes('sign-job'),false);assert.equal(f.calls.includes('resume'),false);
});
test('duplicate ticks join one running lease and other logical work respects a finite physical pool',async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const f=fixture({executor:{physicalSlotBudget:1},createRunner:({authorizeLease})=>({run:async()=>{
    f.calls.push('runner');await gate;
    await authorizeLease({phase:'BEFORE_RESUME',run_id:provider,process:processProof});
    return{state:'RESULT_READY',task_id:task,lease_generation:1,agent_id:agent,run_id:provider,role:'IMPLEMENTER',result_sha256:'c'.repeat(64)};
  }})});
  const first=f.executor.execute(request),second=f.executor.execute(request);
  const other=await f.executor.execute({...request,lease:{...request.lease,task_id:provider}});
  assert.equal(other.state,'PHYSICAL_POOL_BUSY');
  release();const results=await Promise.all([first,second]);
  assert.deepEqual(results[0],results[1]);assert.equal(f.calls.filter(x=>x==='runner').length,1);
});
test('a worker result with the wrong lease stays ambiguous and cannot become useful-work proof',async()=>{
  const f=fixture({createRunner:({authorizeLease})=>({run:async()=>{
    await authorizeLease({phase:'BEFORE_RESUME',run_id:provider,process:processProof});
    return{state:'RESULT_READY',task_id:task,lease_generation:2,agent_id:agent,result_sha256:'c'.repeat(64)};
  }})});
  const result=await f.executor.execute(request);
  assert.equal(result.state,'AMBIGUOUS');assert.equal(result.useful_work_verified,false);
  assert.equal(f.calls.at(-1),'AMBIGUOUS');
});
test('a receipt without a durable attempt cannot be accepted',async()=>{
  const f=fixture({createRunner:()=>({run:async()=>({state:'RESULT_READY',result_sha256:'c'.repeat(64)})})});
  await assert.rejects(f.executor.execute(request),/execution_requires_readback/);
  assert.equal(f.calls.at(-1),'read');
});
test('cancellation before reservation cannot mutate own-PG or spawn a worker',async()=>{
  const f=fixture(),controller=new AbortController();controller.abort();
  await assert.rejects(f.executor.execute(request,{signal:controller.signal}),/cancelled_before_reservation/);
  assert.deepEqual(f.calls,[]);
});
test('a long operator permit cannot extend the actual W30 execution deadline',async()=>{
  const permits=[];
  const f=fixture({createRunner:({authorizeLease})=>({run:async()=>{
    permits.push(await authorizeLease({phase:'BEFORE_ATTEMPT'}));
    permits.push(await authorizeLease({phase:'BEFORE_RESUME',run_id:provider,process:processProof}));
    return{state:'RESULT_READY',task_id:task,lease_generation:1,agent_id:agent,run_id:provider,role:'IMPLEMENTER',result_sha256:'c'.repeat(64)};
  }})});
  await f.executor.execute(request);
  assert.equal(permits[0].expires_at,f.expiry);
  assert.equal(permits[1].expires_at,f.expiry);
});

test('the private Host receives the signed job and receipt before W30 resume acknowledgement',async()=>{
  const events=[];
  const f=fixture({ledger:{advance:async(_scope,event)=>{events.push(event);f.calls.push(event.to);}},
    executor:{onJobAttempted:async value=>{
      f.calls.push('mark-running');
      assert.equal(events[0].job_proof,value.job_proof);
      assert.equal(events[0].evidence_sha256,nativeCodingEnvelopeSha256(value.job_proof));
    }}});
  const result=await f.executor.execute(request);
  assert.deepEqual(f.calls,['prepare','reserve','runner','sign-job','ATTEMPTED','mark-running','resume','RESULT_READY']);
  assert.equal(events[1].result_receipt,result.result);
});

test('a failed W30 acknowledgement leaves the durable attempt and cannot resume or retry',async()=>{
  const f=fixture({executor:{onJobAttempted:async()=>{throw new Error('w30_ack_unknown');}}});
  await assert.rejects(f.executor.execute(request),e=>e.automatic_retry_allowed===false&&e.execution.state==='ATTEMPTED');
  assert.equal(f.calls.includes('resume'),false);
  assert.equal(f.calls.filter(x=>x==='ATTEMPTED').length,1);
  assert.equal(f.calls.at(-1),'read');
});

const generatedResult=()=>({state:'RESULT_READY',task_id:task,lease_generation:1,agent_id:agent,run_id:provider,role:'IMPLEMENTER',result_sha256:'c'.repeat(64)});
const gate=()=>Promise.withResolvers();

test('prepare failure and run-only factories cannot write a reservation or execute a fallback',async()=>{
 for(const mode of ['prepare-failure','run-only']){
  let runs=0;
  const f=fixture({preparedRunner:()=>mode==='run-only'?{run:async()=>{runs++;}}:
   preparedRunnerTestAdapter({run:async()=>{runs++;}},{runId:provider,onPrepare:async()=>{throw Error('fixture_prepare_failed');}})});
  await assert.rejects(f.executor.execute(request),e=>e.message==='native_coding_executor_execution_requires_readback'&&e.automatic_retry_allowed===false);
  assert.equal(f.calls.includes('reserve'),false);assert.equal(f.calls.includes('sign-job'),false);assert.equal(runs,0);
 }
});

test('preparation returns before exact original descriptor is privately passed to actual reservation',async()=>{
 const events=[];let descriptor,runHandle,reserved;
 const f=fixture({preparedRunner:({authorizeLease})=>{
  const adapter=preparedRunnerTestAdapter({run:async()=>{
   assert.equal(reserved,true);events.push('runPrepared');await authorizeLease({phase:'BEFORE_RESUME',run_id:provider,process:processProof});return generatedResult();
  }},{runId:provider,onPrepare:async()=>{events.push('prepare');}});
  return {...adapter,describePrepared(handle){runHandle=handle;descriptor=adapter.describePrepared(handle);events.push('describe');return descriptor;},
   runPrepared(handle){assert.equal(handle,runHandle);return adapter.runPrepared(handle);}};
 },ledger:{reserve:async(scope,options)=>{
  events.push('reserve');assert.equal(options.prepared,descriptor);assert.equal(options.prepared.sql_reservation,'NOT_ATTESTED');reserved=true;
  return {state:'RESERVED',scope:{...scope,reservation_id:provider}};
 }}});
 assert.equal((await f.executor.execute(request)).state,'RESULT_READY');assert.deepEqual(events,['prepare','describe','reserve','runPrepared']);
});

test('a forged resume from inside inert preparation cannot acquire a reservation or sign a job',async()=>{
 const f=fixture({preparedRunner:({authorizeLease})=>preparedRunnerTestAdapter({run:async()=>{throw Error('forbidden');}},
  {runId:provider,onPrepare:async()=>{await authorizeLease({phase:'BEFORE_RESUME',run_id:provider,process:processProof});}})});
 await assert.rejects(f.executor.execute(request),e=>/prepared_reservation_binding_denied/.test(e.cause?.message));
 assert.equal(f.calls.includes('reserve'),false);assert.equal(f.calls.includes('sign-job'),false);
});

for(const stage of ['read-bound','prepare','describe','reserve'])test(`cancellation during ${stage} cannot cross the next effect boundary`,async()=>{
 const abort=new AbortController(),entered=gate(),release=gate();let fences=0,runs=0,f;
 f=fixture({readBoundLease:async()=>{
  if(stage==='read-bound'){entered.resolve();await release.promise;}
  return {scope:f.scope,provider_id:provider,permit:{permit_id:provider,project_id:task,worktree_path:request.worktreePath,expires_at:f.expiry},lease_expires_at:f.expiry};
 },preparedRunner:()=>{
  const adapter=preparedRunnerTestAdapter({run:async()=>{runs++;}},{runId:provider,onPrepare:async()=>{
   if(stage==='prepare'){entered.resolve();await release.promise;}
  },onFence:()=>{fences++;}});
  return {...adapter,describePrepared(handle){const result=adapter.describePrepared(handle);if(stage==='describe')abort.abort();return result;}};
 },ledger:{reserve:async scope=>{f.calls.push('reserve');if(stage==='reserve')abort.abort();return {state:'RESERVED',scope:{...scope,reservation_id:provider}};}}});
 const pending=f.executor.execute(request,{signal:abort.signal});
 if(['read-bound','prepare'].includes(stage)){await entered.promise;abort.abort();release.resolve();}
 await assert.rejects(pending);assert.equal(runs,0);assert.equal(f.calls.includes('sign-job'),false);
 assert.equal(f.calls.filter(x=>x==='reserve').length,stage==='reserve'?1:0);assert.equal(fences,stage==='read-bound'?0:1);
});

for(const mode of ['lost-ack','unknown-result','readback'])test(`reservation ${mode} fences prepared identity without launch or automatic retry`,async()=>{
 let fences=0,runs=0;const retained={state:'ATTEMPTED',fixture_original:true};
 const f=fixture({preparedRunner:()=>preparedRunnerTestAdapter({run:async()=>{runs++;}},{runId:provider,onFence:()=>{fences++;}}),
  ledger:{reserve:async()=>{if(mode==='lost-ack')throw Error('fixture_original_commit_ack_unknown');return {state:mode==='readback'?'READBACK_ONLY':'UNKNOWN',execution:retained};},read:async()=>retained}});
 if(mode==='lost-ack')await assert.rejects(f.executor.execute(request),error=>error.execution===retained&&error.cause.message==='fixture_original_commit_ack_unknown'&&error.automatic_retry_allowed===false);
 else {const result=await f.executor.execute(request);assert.equal(result.state,'READBACK_ONLY');assert.equal(result.execution,retained);}
 assert.equal(fences,1);assert.equal(runs,0);assert.equal(f.calls.includes('sign-job'),false);
});

test('prior local preparation performs SQL readback only and never resubmits reservation',async()=>{
 let fences=0,runs=0,reads=0;const retained={state:'UNKNOWN',fixture_original:true};
 const f=fixture({preparedRunner:()=>preparedRunnerTestAdapter({run:async()=>{runs++;}},{runId:provider,prior:true,onFence:()=>{fences++;}}),
  ledger:{read:async()=>{reads++;return retained;}}});
 const result=await f.executor.execute(request);assert.equal(result.state,'READBACK_ONLY');assert.equal(result.execution,retained);
 assert.equal(result.local_preparation_state,'READBACK_ONLY');assert.equal(result.authority_effect,false);
 assert.equal(reads,1);assert.equal(fences,1);assert.equal(runs,0);assert.equal(f.calls.includes('reserve'),false);
});

for(const mode of ['observation','signed-job','reservation-scope'])test(`prepared run identity refuses mismatched ${mode} before resume`,async()=>{
 const f=fixture({preparedRunner:({authorizeLease})=>preparedRunnerTestAdapter({run:async()=>{
  await authorizeLease({phase:'BEFORE_RESUME',run_id:mode==='observation'?task:provider,process:processProof});f.calls.push('resume');return generatedResult();
 }},{runId:provider}),...(mode==='reservation-scope'?{ledger:{reserve:async scope=>({state:'RESERVED',scope:{...scope,task_id:provider,reservation_id:provider}})}}:{})});
 if(mode==='signed-job'){const original=f.issuer.issueJob;f.issuer.issueJob=async value=>{const job=await original(value);return {...job,payload:{...job.payload,run_id:task}};};}
 await assert.rejects(f.executor.execute(request),/execution_requires_readback/);assert.equal(f.calls.includes('resume'),false);assert.equal(f.calls.includes('ATTEMPTED'),false);
});

test('mutating the caller request during preparation cannot change original reservation or signed prompt',async()=>{
 const original=structuredClone(request),mutable=structuredClone(request),entered=gate(),release=gate();let signedPrompt;
 const f=fixture({preparedRunner:({authorizeLease})=>preparedRunnerTestAdapter({run:async value=>{
  assert.deepEqual(value,original);await authorizeLease({phase:'BEFORE_RESUME',run_id:provider,process:processProof});return generatedResult();
 }},{runId:provider,onPrepare:async()=>{entered.resolve();await release.promise;}})});
 const issue=f.issuer.issueJob;f.issuer.issueJob=async value=>{signedPrompt=value.prompt_sha256;return issue(value);};
 const pending=f.executor.execute(mutable);await entered.promise;mutable.prompt='changed';mutable.lease.task_id=provider;release.resolve();
 assert.equal((await pending).state,'RESULT_READY');assert.equal(signedPrompt,createHash('sha256').update(original.prompt).digest('hex'));
});

test('prepared adapter handles are test-only, opaque, foreign-proof and single-use',async()=>{
 const first=preparedRunnerTestAdapter({run:async()=>generatedResult()},{runId:provider}),second=preparedRunnerTestAdapter({run:async()=>generatedResult()},{runId:provider});
 const handle=await first.prepare(request);assert.throws(()=>JSON.stringify(handle),/not_serializable/);assert.throws(()=>structuredClone(handle),{name:'DataCloneError'});
 await assert.rejects(second.runPrepared(handle),/handle_invalid/);await first.runPrepared(handle);await assert.rejects(first.runPrepared(handle),/handle_consumed/);
});

test('duplicate ticks share one inert preparation and keep the existing physical pool occupied',async()=>{
 const entered=gate(),release=gate();let prepares=0;
 const f=fixture({executor:{physicalSlotBudget:1},preparedRunner:({authorizeLease})=>preparedRunnerTestAdapter({run:async()=>{
  await authorizeLease({phase:'BEFORE_RESUME',run_id:provider,process:processProof});return generatedResult();
 }},{runId:provider,onPrepare:async()=>{prepares++;entered.resolve();await release.promise;}})});
 const first=f.executor.execute(request);await entered.promise;const second=f.executor.execute(request);
 assert.equal((await f.executor.execute({...request,lease:{...request.lease,task_id:provider}})).state,'PHYSICAL_POOL_BUSY');
 assert.equal(f.calls.includes('reserve'),false);release.resolve();const results=await Promise.all([first,second]);
 assert.deepEqual(results[0],results[1]);assert.equal(prepares,1);assert.equal(f.calls.filter(x=>x==='reserve').length,1);
});

for(const prior of [false,true])test(`failed prepared fence remains explicit and is never retried (${prior?'prior local':'unknown reserve'})`,async()=>{
 let fences=0;
 const f=fixture({preparedRunner:()=>preparedRunnerTestAdapter({run:async()=>{throw Error('forbidden');}},
  {runId:provider,prior,onFence:()=>{fences++;throw Error('fixture_fence_unconfirmed');}}),
  ledger:{reserve:async()=>{throw Error('fixture_reserve_unknown');}}});
 await assert.rejects(f.executor.execute(request),error=>error.preparation_cleanup_unconfirmed===true&&error.automatic_retry_allowed===false
  &&error.cause.message===(prior?'fixture_fence_unconfirmed':'fixture_reserve_unknown'));
 assert.equal(fences,1);assert.equal(f.calls.includes('sign-job'),false);
});

for(const stage of ['issueJob','ATTEMPTED-commit','W30-ACK'])test(`cancellation while ${stage} is pending prevents every later authority transition and resume`,async()=>{
 const abort=new AbortController(),entered=gate(),release=gate();let runningAcknowledgments=0;
 const f=fixture({executor:{onJobAttempted:async()=>{
  runningAcknowledgments++;f.calls.push('mark-running');
  if(stage==='W30-ACK'){entered.resolve();await release.promise;}
 }}});
 if(stage==='issueJob'){
  const original=f.issuer.issueJob;f.issuer.issueJob=async value=>{const proof=await original(value);entered.resolve();await release.promise;return proof;};
 }
 if(stage==='ATTEMPTED-commit'){
  const original=f.ledger.advance;f.ledger.advance=async(scope,event)=>{
   const committed=await original(scope,event);if(event.to==='ATTEMPTED'){entered.resolve();await release.promise;}return committed;
  };
 }
 const pending=f.executor.execute(request,{signal:abort.signal});await entered.promise;abort.abort();release.resolve();
 await assert.rejects(pending,error=>error.automatic_retry_allowed===false&&error.physical_effect_replayed===false
  &&error.execution.state===(stage==='issueJob'?'RESERVED':'ATTEMPTED'));
 assert.equal(f.calls.filter(value=>value==='ATTEMPTED').length,stage==='issueJob'?0:1);
 assert.equal(runningAcknowledgments,stage==='W30-ACK'?1:0);assert.equal(f.calls.includes('resume'),false);
 assert.equal(f.calls.filter(value=>value==='reserve').length,1);assert.equal(f.calls.filter(value=>value==='sign-job').length,1);
 assert.equal(f.calls.filter(value=>value==='fence').length,1);assert.equal(f.calls.at(-1),'read');
});
