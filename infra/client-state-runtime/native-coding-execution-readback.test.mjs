import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createNativeCodingHostAuthority} from './native-coding-host-authority.mjs';
import {buildNativeCodingExecutionScope} from './native-coding-task-context.mjs';
import {createNativeCodingRuntime} from '../../apps/metaengine-browser/src/native-coding-runtime.mjs';
import {checkpointFixture} from './test/native-coding-checkpoint-fixture.mjs';

// Generated keys, tasks, SQL readback and protected-file readers exercise the
// actual Host authority and Browser runtime; none are installed execution proof.
async function fixture(role='IMPLEMENTER',{saturatePool=false,checkpointUnavailable=false,historicalAuthorized=true,editHistoricalContext=null,onExecutionRead=null}={}){
  const f=checkpointFixture(),b=role==='CRITIC'?f.critic:f.writer,calls=[];
  f.native.postgres=structuredClone(b.permit.postgres);
  const selector={workspace_id:b.permit.workspace_id,project_id:b.permit.project_id,task_id:b.task.task_id,
    lease_generation:Number(b.task.lease_generation),agent_id:b.permit.agent_id,provider_id:b.permit.provider_id,
    agent_generation_epoch:b.permit.agent_generation_epoch};
  const context=()=>({...f.f.context(),permit:b.permit,device:b.device});
  let activeTransactions=0,bothEntered,physicalReads=0,receiptReads=0;
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
    if(text.includes('protected historical own-PG context')){
      if(!historicalAuthorized||args[0]!==b.permit.permit_id)return[];
      const value=context();editHistoricalContext?.(value);return[{context:value}];
    }
    if(text.includes('native_coding_admission_context_v1'))return args[0]===b.permit.permit_id?[{context:context()}]:[];
    if(text.startsWith('select 1 from destruktion_meta.devos_fleet_claim'))return[{one:1}];
    if(text.startsWith('select 1 from destruktion_meta.project_task'))return[{one:1}];
    if(text.startsWith('select to_jsonb(e)')){
      await onExecutionRead?.();return[{execution:structuredClone(b.execution),registration:structuredClone(b.registration)}];
    }
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
      physicalReads++;if(checkpointUnavailable)throw Error('generated_current_tools_missing');
      if(saturatePool){await bothTransactions;await reader.unsafe('select fixture_identity');}
      return structuredClone(f.native);
    },readProtectedReceipt:async options=>{receiptReads++;return f.readProtectedReceipt(options);},
    readNativeWorker:async()=>{throw Error('worker_read_forbidden');}});
  return {f,b,calls,selector,authority,get activeTransactions(){return activeTransactions;},get physicalReads(){return physicalReads;},get receiptReads(){return receiptReads;}};
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

test('old owned installation without current tools retains original result history without resolving capacity',async()=>{
 const x=await fixture('IMPLEMENTER',{checkpointUnavailable:true}),before=structuredClone(x.b);
 const result=await x.authority.READ_PRIOR_EXECUTION({selector:x.selector});
 assert.equal(result.state,'HOLD');assert.equal(result.reason,'HISTORICAL_RESULT_RECORDED');assert.equal(result.receipt_sha256,null);
 assert.equal(result.execution_scope.scope_sha256,before.execution.scope_sha256);assert.deepEqual(result.execution,before.execution);
 assert.equal(result.automatic_retry_allowed,false);assert.equal(result.authority_effect,false);assert.equal(result.physical_effect_replayed,false);
 assert.equal(x.receiptReads,1);assert.deepEqual(x.b,before);
 assert.equal(x.calls.some(row=>/^(?:insert|update|delete|select destruktion_meta.native_coding_(?:reserve|advance))/i.test(row.text||'')),false);
 x.authority.close();
});
test('changed installed artifact leaves authenticated original history readable without accepting a current result',async()=>{
 const x=await fixture();x.f.native.artifact.installed_asar_sha256='f'.repeat(64);
 const result=await x.authority.READ_PRIOR_EXECUTION({selector:x.selector});
 assert.equal(result.state,'HOLD');assert.equal(result.reason,'HISTORICAL_RESULT_RECORDED');assert.equal(result.receipt_sha256,null);
 assert.equal(x.receiptReads,1);assert.equal(result.execution.state,'RESULT_READY');x.authority.close();
});
test('retained UNKNOWN is readable before every current tool or physical scope read',async()=>{
 const x=await fixture('IMPLEMENTER',{checkpointUnavailable:true});x.b.execution.state='ATTEMPTED';x.b.registration=null;x.f.receipts.clear();
 const before=structuredClone(x.b.execution),result=await x.authority.READ_PRIOR_EXECUTION({selector:x.selector});
 assert.equal(result.state,'HOLD');assert.equal(result.reason,'PRIOR_EXECUTION_INCOMPLETE');assert.equal(result.receipt_sha256,null);
 assert.deepEqual(result.execution,before);assert.deepEqual(x.b.execution,before);assert.equal(x.physicalReads,0);assert.equal(x.receiptReads,0);
 x.authority.close();
});
test('expired original permit is readable only through protected historical context, never renewed for a live lease',async t=>{
 const x=await fixture('IMPLEMENTER',{checkpointUnavailable:true});t.mock.method(Date,'now',()=>x.f.f.now+3600000);
 const before=structuredClone(x.b.permit),result=await x.authority.READ_PRIOR_EXECUTION({selector:x.selector});
 assert.equal(result.state,'HOLD');assert.equal(result.reason,'HISTORICAL_RESULT_RECORDED');assert.equal(result.receipt_sha256,null);
 assert.deepEqual(x.b.permit,before);await assert.rejects(x.authority.READ_LEASE(x.selector),/protected_context_invalid/);
 x.authority.close();
});
test('missing historical authority cannot turn original SQL rows into trusted history or invoke a physical reader',async()=>{
 const x=await fixture('IMPLEMENTER',{historicalAuthorized:false});
 await assert.rejects(x.authority.READ_PRIOR_EXECUTION({selector:x.selector}),/historical_authority_unavailable/);
 assert.equal(x.physicalReads,0);assert.equal(x.receiptReads,0);x.authority.close();
});
for(const field of ['cluster','device','key','permit-revoked'])test('historical '+field+' mismatch cannot use missing-tool fallback',async()=>{
 const x=await fixture('IMPLEMENTER',{checkpointUnavailable:true,editHistoricalContext:c=>{
  if(field==='cluster')c.postgres_system_identifier='9999999999999999999';
  if(field==='device')c.device={...c.device,device_id:randomUUID()};
  if(field==='key')c.device={...c.device,key_fingerprint_sha256:'0'.repeat(64)};
  if(field==='permit-revoked')c.permit={...c.permit,revoked:true};
 }});
 await assert.rejects(x.authority.READ_PRIOR_EXECUTION({selector:x.selector}),/protected_context_invalid/);
 assert.equal(x.physicalReads,0);assert.equal(x.receiptReads,0);x.authority.close();
});
test('historical context uses existing protected joins and actual cluster inside the original read-only transaction without row locks',async()=>{
 const x=await fixture('IMPLEMENTER',{checkpointUnavailable:true});await x.authority.READ_PRIOR_EXECUTION({selector:x.selector});
 const row=x.calls.find(c=>c.text?.includes('protected historical own-PG context'));
 assert.equal(row.route,'transaction');assert.match(x.calls.find(c=>c.transaction).transaction,/repeatable read read only/);
 for(const rule of ['p.revoked_at is null','d.active','d.revoked_at is null',"d.access_tier='ADMIN'",'d.admin_revoked_at is null',
  'd.admin_grant_epoch=p.admin_grant_epoch',"d.profile='A2_DEVICE_HTTP_SIGNATURE_V1'",'d.key_fingerprint_sha256=',
  "d.admin_scopes @> '[\"CONTROL_PLANE\",\"DEVOS\"]'::jsonb",'pg_catalog.pg_control_system()',
  'r.workspace_id=p.workspace_id','r.device_id=p.device_id','r.client_id=p.client_id','r.admin_grant_epoch=p.admin_grant_epoch'])assert.ok(row.text.includes(rule),rule);
 assert.doesNotMatch(row.text,/for (?:share|update)|\b(?:insert|update|delete|alter|create)\b/i);x.authority.close();
});
test('corrupt original signature is rejected before absent current tools can mask it',async()=>{
 const x=await fixture('IMPLEMENTER',{checkpointUnavailable:true});x.b.registration.job_envelope.signature='A'.repeat(86);
 await assert.rejects(x.authority.READ_PRIOR_EXECUTION({selector:x.selector}),/prior_registered_job_changed/);
 assert.equal(x.physicalReads,0);x.authority.close();
});
test('coherently rehashed invalid original signature cannot become recorded history when tools are absent',async()=>{
 const x=await fixture('IMPLEMENTER',{checkpointUnavailable:true});x.b.registration.job_envelope.signature='A'.repeat(86);
 x.f.refresh(x.b,{resign:false});
 await assert.rejects(x.authority.READ_PRIOR_EXECUTION({selector:x.selector}),/signature/);
 assert.equal(x.physicalReads,0);assert.equal(x.receiptReads,1);x.authority.close();
});
test('cancelled historical request cannot acquire registry data or read files',async()=>{
 const x=await fixture();const abort=new AbortController();abort.abort();const before=x.calls.length;
 await assert.rejects(x.authority.READ_PRIOR_EXECUTION({selector:x.selector},{signal:abort.signal}),/request_cancelled/);
 assert.equal(x.calls.length,before);assert.equal(x.physicalReads,0);assert.equal(x.receiptReads,0);x.authority.close();
});

test('abort while original execution SQL is held rejects before an incomplete-history reply or file read',async()=>{
 let entered,release;const waiting=new Promise(resolve=>{entered=resolve;}),held=new Promise(resolve=>{release=resolve;});
 const x=await fixture('IMPLEMENTER',{onExecutionRead:async()=>{entered();await held;}});
 x.b.execution.state='ATTEMPTED';x.b.registration=null;
 const abort=new AbortController(),pending=x.authority.READ_PRIOR_EXECUTION({selector:x.selector},{signal:abort.signal});
 await waiting;abort.abort();release();
 await assert.rejects(pending,/request_cancelled/);
 assert.equal(x.physicalReads,0);assert.equal(x.receiptReads,0);assert.equal(x.activeTransactions,0);x.authority.close();
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

test('durable scope, registered signature, device and permit drift are denied before historical fallback',async()=>{
  for(const change of [x=>x.b.execution.scope_sha256='f'.repeat(64),x=>x.b.execution.agent_id='agent_other-fixture',
    x=>x.b.registration.job_envelope.signature='A'.repeat(86),x=>x.b.registration.permit_id=randomUUID(),
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
      prepareAgentRunCustody:deny('prepared-claim'),reservePreparedExecution:deny('prepared-reserve'),
      takePreparedAgentRunCustody:deny('prepared-take'),abandonPreparedAgentRunCustody:deny('prepared-abandon'),
      readPriorExecution:selector=>x.authority.READ_PRIOR_EXECUTION({selector})},
    readPreparedRunOwner:deny('original-owner'),
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
