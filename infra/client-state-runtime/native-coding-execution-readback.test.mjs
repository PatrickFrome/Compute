import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createNativeCodingHostAuthority} from './native-coding-host-authority.mjs';
import {buildNativeCodingExecutionScope} from './native-coding-task-context.mjs';
import {createNativeCodingRuntime} from '../../apps/metaengine-browser/src/native-coding-runtime.mjs';
import {checkpointFixture} from './test/native-coding-checkpoint-fixture.mjs';

// Generated keys, tasks, SQL readback and protected-file readers exercise the
// actual Host authority and Browser runtime; none are installed execution proof.
async function fixture(role='IMPLEMENTER',{saturatePool=false}={}){
  const f=checkpointFixture(),b=role==='CRITIC'?f.critic:f.writer,calls=[];
  f.native.postgres=structuredClone(b.permit.postgres);
  const selector={workspace_id:b.permit.workspace_id,project_id:b.permit.project_id,task_id:b.task.task_id,
    lease_generation:Number(b.task.lease_generation),agent_id:b.permit.agent_id,provider_id:b.permit.provider_id,
    agent_generation_epoch:b.permit.agent_generation_epoch};
  const context=()=>({...f.f.context(),permit:b.permit,device:b.device});
  let activeTransactions=0,bothEntered;
  const bothTransactions=new Promise(resolve=>{bothEntered=resolve;});
  const unsafe=async(text,args=[],route='base')=>{
    calls.push({text,args,route});
    if(text==='select fixture_identity'){
      if(route!=='transaction')throw Error('EXTRA_BASE_POOL_BORROW');
      return[];
    }
    if(text.startsWith('select current_user'))return[{current_user:'state_owner',session_user:'state_owner'}];
    if(text.startsWith('select to_jsonb(t)'))return args[0]===b.task.task_id&&args[1]===b.task.workspace_id
      &&Number(args[2])===Number(b.task.lease_generation)?[{task:structuredClone(b.task)}]:[];
    if(text.includes('native_coding_admission_context_v1'))return args[0]===b.permit.permit_id?[{context:context()}]:[];
    if(text.startsWith('select 1 from destruktion_meta.devos_fleet_claim'))return[{one:1}];
    if(text.startsWith('select 1 from destruktion_meta.project_task'))return[{one:1}];
    if(text.startsWith('select to_jsonb(e)'))return[{execution:structuredClone(b.execution),registration:structuredClone(b.registration)}];
    if(text.includes('native_coding_read_v1'))return[{value:structuredClone(b.execution)}];
    throw Error('unexpected_fixture_query');
  };
  const sql={unsafe,async begin(mode,run){
    calls.push({transaction:mode});assert.match(mode,/read only/);
    if(++activeTransactions>2)throw Error('fixture_pool_capacity_exceeded');
    if(activeTransactions===2)bothEntered();
    try{return await run({unsafe:(text,args)=>unsafe(text,args,'transaction')});}
    finally{activeTransactions--;}
  }};
  const authority=await createNativeCodingHostAuthority({sql,readNativeScope:async()=>structuredClone(f.native),
    readCheckpointScope:async(_permit,reader=sql)=>{
      if(saturatePool){await bothTransactions;await reader.unsafe('select fixture_identity');}
      return structuredClone(f.native);
    },readProtectedReceipt:f.readProtectedReceipt,
    readNativeWorker:async()=>{throw Error('worker_read_forbidden');}});
  return {f,b,calls,selector,authority,get activeTransactions(){return activeTransactions;}};
}

test('two saturated Host transactions route both physical identity reads through their active transaction without borrowing a third connection',async()=>{
  const x=await fixture('IMPLEMENTER',{saturatePool:true});
  const results=await Promise.all([x.authority.READ_PRIOR_EXECUTION({selector:x.selector}),x.authority.READ_PRIOR_EXECUTION({selector:x.selector})]);
  assert.equal(results.every(value=>value.state==='READBACK_ONLY'),true);
  const identity=x.calls.filter(row=>row.text==='select fixture_identity');
  assert.equal(identity.length,4);assert.equal(identity.every(row=>row.route==='transaction'),true);
  assert.equal(x.activeTransactions,0);x.authority.close();
});

test('real Host selects the protected original scope after Browser incarnation changes; strict scoped read still rejects drift',async()=>{
  for(const role of ['IMPLEMENTER','CRITIC']){
    const x=await fixture(role),{b,authority,selector,f}=x;
    const lease={...selector,target_id:b.task.lease_target_id,role:b.permit.role,base_sha:b.permit.worktree.base_sha};
    const current=buildNativeCodingExecutionScope(b.permit,lease,f.native.host_process);
    assert.notEqual(current.host_incarnation,b.execution.host_incarnation);
    await assert.rejects(authority.READ_EXECUTION({scope:current}),/execution_readback_scope_mismatch/);
    for(let n=0;n<2;n++){
      const result=await authority.READ_PRIOR_EXECUTION({selector});
      assert.equal(result.state,'READBACK_ONLY');assert.equal(result.reason,'PROTECTED_RESULT_VERIFIED');
      assert.equal(result.execution_scope.host_incarnation,b.execution.host_incarnation);
      assert.equal(result.execution_scope.scope_sha256,b.execution.scope_sha256);
      assert.equal(result.receipt_sha256,b.registration.result_receipt_sha256);
      assert.equal(result.physical_effect_replayed,false);assert.equal(result.authority_effect,false);
    }
    assert.equal(x.calls.some(row=>/^(?:insert|update|delete|select destruktion_meta.native_coding_(?:reserve|advance))/i.test(row.text||'')),false);
    authority.close();
  }
});

test('historical RESERVED and ATTEMPTED execution remains HOLD and never asks for a result or a new worker',async()=>{
  for(const state of ['RESERVED','ATTEMPTED','AMBIGUOUS','FAILED']){
    const x=await fixture();x.b.execution.state=state;x.f.receipts.clear();x.b.registration=null;
    const result=await x.authority.READ_PRIOR_EXECUTION({selector:x.selector});
    assert.equal(result.state,'HOLD');assert.equal(result.reason,'PRIOR_EXECUTION_INCOMPLETE');
    assert.equal(result.receipt_sha256,null);assert.equal(result.automatic_retry_allowed,false);x.authority.close();
  }
});

test('missing or corrupt protected result cannot turn a durable RESULT_READY row into verified evidence',async()=>{
  for(const change of [x=>x.f.receipts.clear(),x=>x.f.receipts.get(x.b.task.task_id).result.summary='changed file bytes',
    x=>x.b.registration.result_receipt_sha256='0'.repeat(64)]){
    const x=await fixture();change(x);
    const result=await x.authority.READ_PRIOR_EXECUTION({selector:x.selector});
    assert.equal(result.state,'HOLD');assert.equal(result.receipt_sha256,null);x.authority.close();
  }
});

test('typed selector forbids old scope/hash and rejects task, provider, lease and project substitutions',async()=>{
  for(const change of [s=>s.scope_sha256='f'.repeat(64),s=>s.host_incarnation='pid:1:created_100ns:134000000000000000',
    s=>s.task_id=randomUUID(),s=>s.project_id=randomUUID(),s=>s.provider_id=randomUUID(),s=>s.lease_generation++,
    s=>s.agent_generation_epoch++,s=>s.agent_id='agent_other-fixture']){
    const x=await fixture(),selector=structuredClone(x.selector);change(selector);
    await assert.rejects(x.authority.READ_PRIOR_EXECUTION({selector}),/native_coding_host_/);x.authority.close();
  }
});

test('durable scope, registered signature and current artifact, device, permit or PG drift are denied',async()=>{
  for(const change of [x=>x.b.execution.scope_sha256='f'.repeat(64),x=>x.b.execution.agent_id='agent_other-fixture',
    x=>x.b.registration.job_envelope.signature='A'.repeat(86),x=>x.b.registration.permit_id=randomUUID(),
    x=>x.f.native.artifact.installed_asar_sha256='f'.repeat(64),x=>x.f.native.postgres.postmaster.process_incarnation_id+='1',
    x=>x.b.device.key_fingerprint_sha256='f'.repeat(64),x=>x.b.permit.goal_sha256='f'.repeat(64)]){
    const x=await fixture();change(x);
    await assert.rejects(x.authority.READ_PRIOR_EXECUTION({selector:x.selector}),/native_coding_/);x.authority.close();
  }
});

test('fresh Browser runtime joins actual Host historical readback without new scope, runner, reservation or completion',async t=>{
  const x=await fixture(),{b}=x,effects=[];b.task.state='RUNNING';
  let strictReads=0,currentHostReads=0;
  const deny=name=>()=>{effects.push(name);throw Error('unexpected_effect:'+name);};
  const runtime=createNativeCodingRuntime({identity:{snapshot:()=>({})},
    ownPostgres:{ledger:{read:scope=>{strictReads++;return x.authority.READ_EXECUTION({scope});},reserve:deny('reserve'),advance:deny('advance')},
      readScope:deny('scope'),readLease:query=>x.authority.READ_LEASE(query),registerProvider:deny('register'),agentOperation:deny('agent'),
      readPriorExecution:selector=>x.authority.READ_PRIOR_EXECUTION({selector})},
    signedRequest:deny('completion'),runnerOptions:{expectedExecutableSha256:b.permit.artifact.cli_executable_sha256},
    permitRegistry:{readProvider:async()=>b.permit,listProviderSelectors:async()=>[]},resultStore:{publish:deny('result-publish')},
    observers:{readNativeHost:async()=>{currentHostReads++;return {value:x.f.native};}},issuer:{close(){},issueProvider:deny('issue'),issueJob:deny('job')},
    workerRegistry:{close:async()=>({schema:'metaengine.native-coding.workers-close.v1',cleanup_confirmed:true})},runnerFactory:deny('runner')});
  t.after(async()=>{await runtime.close();x.authority.close();});
  const lease={task_id:b.task.task_id,lease_generation:Number(b.task.lease_generation),agent_id:b.permit.agent_id,
    agent_generation_epoch:b.permit.agent_generation_epoch,target_id:b.task.lease_target_id};
  for(let n=0;n<2;n++){
    const result=await runtime.observeLease(lease);assert.equal(result.state,'READBACK_ONLY');
    assert.equal(result.result.state,'READBACK_ONLY');assert.equal(result.result.execution_scope.host_incarnation,b.execution.host_incarnation);
    assert.equal(result.physical_effect_replayed,false);
  }
  assert.deepEqual(effects,[]);assert.equal(strictReads,0);assert.equal(currentHostReads,0);assert.equal(runtime.snapshot().occupied_slots,0);
});
