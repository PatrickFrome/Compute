import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createNativeCodingLeaseExecutor } from '../src/native-coding-lease-executor.mjs';

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
  const createRunner=overrides.createRunner || (({authorizeLease})=>({run:async req=>{
    calls.push('runner');
    await authorizeLease({phase:'BEFORE_ATTEMPT',binding:req.lease});
    await authorizeLease({phase:'BEFORE_RESUME',binding:req.lease,run_id:provider,process:processProof});
    calls.push('resume');
    await authorizeLease({phase:'AFTER_EXECUTION',binding:req.lease});
    return{state:'RESULT_READY',task_id:task,lease_generation:1,agent_id:agent,run_id:provider,role:'IMPLEMENTER',result_sha256:'c'.repeat(64)};
  }}));
  return{calls,scope,expiry,ledger,issuer,createRunner,readBoundLease,
    executor:createNativeCodingLeaseExecutor({ledger,issuer,createRunner,readBoundLease,...overrides.executor})};
}
test('the own-PG ATTEMPTED commit precedes resume and the result remains unverified',async()=>{
  const f=fixture(),result=await f.executor.execute(request);
  assert.deepEqual(f.calls,['reserve','runner','sign-job','ATTEMPTED','resume','RESULT_READY']);
  assert.equal(result.state,'RESULT_READY');
  assert.equal(result.useful_work_verified,false);
  assert.equal(result.production_qualified,false);
});
test('a prior reservation after restart only returns readback; no runner/signature/spawn',async()=>{
  const f=fixture({ledger:{reserve:async()=>({state:'READBACK_ONLY',execution:{state:'ATTEMPTED'}})}});
  const result=await f.executor.execute(request);
  assert.equal(result.state,'READBACK_ONLY');assert.deepEqual(f.calls,[]);
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
