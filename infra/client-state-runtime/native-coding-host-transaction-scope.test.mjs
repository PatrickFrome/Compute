import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeCodingHostAuthority} from './native-coding-host-authority.mjs';
import {createNativeCodingCheckpointVerifier} from './native-coding-checkpoint-verifier.mjs';
import {checkpointFixture} from './test/native-coding-checkpoint-fixture.mjs';
import {createSingleConnectionPool,createPhysicalScopeReaders} from './test/native-coding-single-connection-fixture.mjs';

// Actual authority/verifier modules and exact production OS-reader functions,
// with generated signatures and mocked OS observations. This is a SQL resource
// ownership regression, not installed Windows/PG execution evidence.
async function fixture({checkpoint=false,historical=false}={}) {
  const f=checkpointFixture(),b=f.writer,p=b.permit,job=b.registration.job_envelope;
  const controls={role:'state_owner',session:'state_owner',live:true};
  if(!checkpoint&&!historical){b.task.state='RUNNING';b.execution.state='RESERVED';}
  const host=structuredClone(job.payload.host_process);
  const worktree=structuredClone(checkpoint||historical?f.native.worktree:p.worktree);
  const selectors={writer_task_id:b.task.task_id,writer_lease_generation:1,
    critic_task_id:f.critic.task.task_id,critic_lease_generation:1};
  const committed={checkpoint:null,finalized:false};
  let physical;
  const pool=createSingleConnectionPool(async(text,args=[])=>{
    if(text.startsWith('select current_user'))return[{current_user:controls.role,session_user:controls.session}];
    if(text.startsWith('set local '))return[];
    if(text.includes('pg_control_system'))return[physical.pgRow];
    if(text.includes('native_coding_admission_context_v1'))return[{context:{...f.f.context(),permit:p,device:b.device}}];
    if(text.startsWith('select to_jsonb(t)'))return[{task:structuredClone(b.task)}];
    if(text.startsWith('select 1 from destruktion_meta.devos_fleet_claim'))return controls.live?[{one:1}]:[];
    if(text.startsWith('select 1 from destruktion_meta.project_task'))return[{one:1}];
    if(text.startsWith('insert into destruktion_meta.native_coding_provider_registration'))return[{envelope_sha256:args[2]}];
    if(text.includes('native_coding_reserve_v1'))return[{value:{inserted:false,execution:structuredClone(b.execution)}}];
    if(text.includes('native_coding_agent_context_v1'))return[{value:{run_id:job.payload.run_id,project_id:p.project_id,permit:p,task:b.task}}];
    if(text.startsWith('select j.job_envelope,j.canonical_job_envelope'))return[{...structuredClone(b.registration),permit:p,execution:b.execution}];
    if(text.startsWith('select to_jsonb(e)'))return[{execution:structuredClone(b.execution),registration:structuredClone(b.registration)}];
    if(text.includes('native_coding_checkpoint_candidate_v1'))return[{value:selectors}];
    if(text.startsWith('select task_id from destruktion_meta.devos_fleet_task'))return[{task_id:b.task.task_id},{task_id:f.critic.task.task_id}];
    if(text.startsWith('select to_jsonb(r)'))return[{project:structuredClone(f.project)}];
    if(text.startsWith('select p.permit,'))return[structuredClone(args[0]===b.task.task_id?b:f.critic)];
    if(text.startsWith('insert into destruktion_meta.native_coding_checkpoint')){
      committed.checkpoint=JSON.parse(args[15]);return[{checkpoint_sha256:args[16]}];
    }
    if(text.includes('native_coding_advance_v1')){
      const bundle=args[0]===b.task.task_id?b:f.critic;
      bundle.execution={...bundle.execution,state:args[6],critic_proof_sha256:args[8],checkpoint_sha256:args[9]};
      return[{value:structuredClone(bundle.execution)}];
    }
    if(text.includes('native_coding_finalize_checkpoint_v1')){
      committed.finalized=true;return[{value:{state:'CHECKPOINTED_PENDING_COMMIT',...selectors,
        checkpoint_sha256:b.execution.checkpoint_sha256,successor_admitted:false}}];
    }
    throw Error('unexpected_single_connection_query:'+text);
  });
  physical=await createPhysicalScopeReaders({sql:pool.sql,permit:p,host,worktree,
    git:f.native.git,sandbox:f.f.provider.payload.sandbox});
  const worker={...job.payload.worker_process,user_sid:p.user_sid,job_id:job.payload.job_id,
    run_id:job.payload.run_id,prompt_sha256:job.payload.prompt_sha256};
  const authority=await createNativeCodingHostAuthority({sql:pool.sql,...physical,
    readProtectedReceipt:f.readProtectedReceipt,readNativeWorker:async()=>structuredClone(worker)});
  const scope={...b.execution};
  const binding={run_id:job.payload.run_id,workspace_id:p.workspace_id,project_id:p.project_id,task_id:b.task.task_id,
    lease_generation:1,agent_id:p.agent_id,agent_generation_epoch:1,provider_id:p.provider_id,role:p.role};
  const agentRequest={binding,job_binding:{job_id:worker.job_id,pid:worker.pid,process_incarnation_id:worker.process_incarnation_id,
    executable_sha256:p.artifact.cli_executable_sha256},operation:'CHECK',args:{}};
  const selector={workspace_id:p.workspace_id,project_id:p.project_id,task_id:b.task.task_id,lease_generation:1,
    agent_id:p.agent_id,provider_id:p.provider_id,agent_generation_epoch:1};
  return {f,b,p,host,worktree,controls,pool,physical,authority,scope,agentRequest,selector,committed};
}

async function withoutNestedBorrow(x,operation,identityReads=1) {
  let result,error;
  try{result=await operation();}catch(cause){error=cause;}
  assert.equal(x.pool.stats.nestedRootAcquisitions,0,
    'physical identity must not borrow the max:1 root pool while its transaction owns the sole connection');
  if(error)throw error;
  const identity=x.pool.calls.filter(call=>call.text?.includes('pg_control_system'));
  assert.equal(identity.length,identityReads);
  assert.ok(identity.every(call=>call.route==='transaction'));
  x.pool.assertIdle();
  return result;
}

function changeHostBirth(host) {
  host.created_at=new Date(Date.parse(host.created_at)+1).toISOString();
  host.process_incarnation_id=host.process_incarnation_id.replace(/created_100ns:([0-9]+)$/,
    (_match,birth)=>'created_100ns:'+(BigInt(birth)+10000n));
}

test('registration observes physical PG through its serializable transaction with max:1',async t=>{
  const x=await fixture();t.after(()=>x.authority.close());
  const result=await withoutNestedBorrow(x,()=>x.authority.REGISTER_PROVIDER({descriptor:x.f.f.provider}));
  assert.equal(result.registered,true);
  assert.equal(x.pool.calls.find(call=>call.mode).mode,'isolation level serializable');
});

for(const action of ['RESERVE_EXECUTION','ADVANCE_EXECUTION'])
  test(action+' keeps physical identity on the same max:1 transaction',async t=>{
    const x=await fixture();t.after(()=>x.authority.close());
    const request={scope:x.scope,transition:{from:'RESERVED',to:'AMBIGUOUS',evidence_sha256:'e'.repeat(64)}};
    const result=await withoutNestedBorrow(x,()=>x.authority[action](request));
    assert.equal(result.state,action==='RESERVE_EXECUTION'?'READBACK_ONLY':'AMBIGUOUS');
    assert.equal(result.automatic_retry_allowed,false);
});

test('agent CHECK uses its own max:1 transaction for physical identity',async t=>{
  const x=await fixture();t.after(()=>x.authority.close());x.b.execution.state='ATTEMPTED';
  const result=await withoutNestedBorrow(x,()=>x.authority.AGENT_OPERATION(x.agentRequest));
  assert.equal(result.authorized,true);assert.equal(result.authority_effect,false);
});

test('checkpoint reconciliation passes its max:1 transaction through both verifier physical reads',async t=>{
  const x=await fixture({checkpoint:true});t.after(()=>x.authority.close());
  const result=await withoutNestedBorrow(x,()=>x.authority.RECONCILE_PROJECT({project_id:x.p.project_id}),2);
  assert.equal(result.state,'CHECKPOINTED_PENDING_COMMIT');assert.equal(x.committed.finalized,true);
  assert.equal(x.committed.checkpoint.writer_execution_scope.host_incarnation,x.scope.host_incarnation);
  assert.ok([x.b,x.f.critic].every(bundle=>bundle.execution.state==='CHECKPOINTED'));
});

test('prior execution readback remains repeatable-read-only with max:1 and performs no writes',async t=>{
  const x=await fixture({historical:true});t.after(()=>x.authority.close());changeHostBirth(x.host);
  const result=await withoutNestedBorrow(x,()=>x.authority.READ_PRIOR_EXECUTION({selector:x.selector}),2);
  assert.equal(result.state,'READBACK_ONLY');assert.equal(result.physical_effect_replayed,false);
  assert.equal(result.automatic_retry_allowed,false);assert.equal(result.authority_effect,false);
  assert.equal(result.execution_scope.host_incarnation,x.scope.host_incarnation);
  assert.notEqual(result.execution_scope.host_incarnation,x.host.process_incarnation_id);
  assert.equal(x.pool.calls.find(call=>call.mode).mode,'isolation level repeatable read read only');
  assert.equal(x.pool.calls.some(call=>/^(?:insert|update|delete)|native_coding_(?:reserve|advance)_v1/i.test(call.text||'')),false);
});

test('outside-transaction physical readers and standalone checkpoint verification retain the root-pool default',async t=>{
  const x=await fixture({checkpoint:true});t.after(()=>x.authority.close());
  const verifier=createNativeCodingCheckpointVerifier({readProtectedReceipt:x.f.readProtectedReceipt,
    readCheckpointScope:x.physical.readCheckpointScope});t.after(()=>verifier.close());
  const result=await verifier.verify({project:x.f.project,writer:x.f.writer,critic:x.f.critic});
  assert.ok(result.checkpoint_sha256);
  const identity=x.pool.calls.filter(call=>call.text?.includes('pg_control_system'));
  assert.equal(identity.length,2);assert.ok(identity.every(call=>call.route==='root'));
  assert.equal(x.pool.stats.nestedRootAcquisitions,0);
});

test('a historical Host scope never becomes a reserve or advance write capability',async t=>{
  for(const action of ['RESERVE_EXECUTION','ADVANCE_EXECUTION']){
    const x=await fixture();t.after(()=>x.authority.close());
    changeHostBirth(x.host);
    await assert.rejects(x.authority[action]({scope:x.scope,transition:{from:'RESERVED',to:'AMBIGUOUS',evidence_sha256:'e'.repeat(64)}}),
      error=>error.effect_outcome==='UNKNOWN'&&error.automatic_retry_allowed===false);
    assert.equal(x.pool.stats.nestedRootAcquisitions,0);
    assert.equal(x.pool.calls.some(call=>/native_coding_(?:reserve|advance)_v1/.test(call.text||'')),false);
  }
});

test('owner and live-lease refusals precede physical identity and ledger effects on max:1',async t=>{
  for(const change of [x=>x.controls.session='service_role',x=>x.controls.live=false]){
    const x=await fixture();t.after(()=>x.authority.close());change(x);
    await assert.rejects(x.authority.RESERVE_EXECUTION({scope:x.scope}),
      error=>error.effect_outcome==='UNKNOWN'&&error.automatic_retry_allowed===false);
    assert.equal(x.pool.stats.nestedRootAcquisitions,0);
    assert.equal(x.pool.calls.some(call=>/pg_control_system|native_coding_reserve_v1/.test(call.text||'')),false);
  }
});

test('physical PG and installed-image drift still fence registration on max:1 before any write',async t=>{
  for(const change of [x=>x.physical.pgRow.system_identifier='different-cluster',
    x=>x.p.artifact.installed_asar_sha256='0'.repeat(64)]){
    const x=await fixture();t.after(()=>x.authority.close());change(x);
    await assert.rejects(x.authority.REGISTER_PROVIDER({descriptor:x.f.f.provider}),
      error=>error.effect_outcome==='UNKNOWN'&&error.automatic_retry_allowed===false);
    assert.equal(x.pool.stats.nestedRootAcquisitions,0);x.pool.assertIdle();
    assert.equal(x.pool.calls.some(call=>call.text?.startsWith('insert ')),false);
  }
});
