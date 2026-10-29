import {randomUUID} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeCodingHostAuthority} from './native-coding-host-authority.mjs';
import {admissionFixture} from '../../apps/metaengine-browser/test/fixtures/native-coding-admission-fixture.mjs';
import {nativeCodingCanonicalSha256} from './native-coding-task-context.mjs';

async function fixture({role='state_owner',nativeChange=null,seedOperations=null}={}) {
  const f=admissionFixture(),calls=[];
  const native={artifact:f.permit.artifact,postgres:f.permit.postgres,worktree:f.permit.worktree,
    host_process:f.provider.payload.host_process,user_sid:f.permit.user_sid,sandbox:f.provider.payload.sandbox};
  if(nativeChange)nativeChange(native);
  const sql={unsafe:async(text,values=[])=>{
    calls.push({text,values});
    if(text.startsWith('select current_user'))return[{current_user:role,session_user:role}];
    if(text.includes('native_coding_admission_context_v1'))return[{context:f.context()}];
    if(text.startsWith('insert into destruktion_meta.native_coding_provider_registration'))return[{envelope_sha256:values[2]}];
    throw Error('unexpected_fixture_query');
  },begin:async(_mode,callback)=>callback({unsafe:async(text,values)=>{
    if(text.startsWith('set local synchronous_commit')){calls.push({text});return[];}
    return sql.unsafe(text,values);
  }})};
  const authority=await createNativeCodingHostAuthority({sql,seedOperations,readNativeScope:async()=>structuredClone(native),
    readNativeWorker:async()=>{throw Error('worker_not_observed');},readProtectedReceipt:async()=>{throw Error('receipt_not_observed');}});
  return {f,calls,sql,authority};
}

test('private authority requires the actual state_owner login and session identity',async()=>{
  await assert.rejects(fixture({role:'service_role'}),/state_owner_required/);
});

test('scope discovery prepares image bytes before the fresh native observation and stays closed during prepare',async()=>{
  const f=admissionFixture(),events=[];
  let hold=false,release;
  const readNativeScope=async()=>{events.push('fresh');return {postgres:f.permit.postgres,user_sid:f.permit.user_sid};};
  readNativeScope.prepare=async()=>{events.push('prepare');if(hold)await new Promise(resolve=>{release=resolve;});};
  const sql={unsafe:async text=>text.startsWith('select current_user')?[{current_user:'state_owner',session_user:'state_owner'}]:[],
    begin:async()=>{throw Error('readonly_only');}};
  const authority=await createNativeCodingHostAuthority({sql,readNativeScope,readNativeWorker:async()=>{},readProtectedReceipt:async()=>{}});
  assert.deepEqual((await authority.READ_SCOPE()).bindings,[]);
  assert.deepEqual(events,['prepare','fresh']);
  hold=true;const pending=authority.READ_SCOPE();await Promise.resolve();
  authority.close();release();
  await assert.rejects(pending,/native_coding_host_closed/);
  assert.deepEqual(events,['prepare','fresh','prepare']);
});

test('valid enrolled signature registers only after independent native scope and a synchronous transaction',async()=>{
  const {f,calls,authority}=await fixture();
  const ack=await authority.REGISTER_PROVIDER({descriptor:f.provider});
  assert.equal(ack.registered,true);assert.equal(ack.envelope_sha256,nativeCodingCanonicalSha256(f.provider));
  const insert=calls.find(row=>row.text.startsWith('insert'));
  assert.equal(nativeCodingCanonicalSha256(JSON.parse(insert.values[1])),insert.values[2]);
  assert.ok(calls.findIndex(row=>row.text==='set local synchronous_commit=on')<calls.indexOf(insert));
});

test('a correctly signed provider cannot override independently observed image or process scope',async()=>{
  for(const nativeChange of [n=>{n.artifact={...n.artifact,installed_asar_sha256:'f'.repeat(64)};},
    n=>{n.host_process={...n.host_process,pid:n.host_process.pid+1};},n=>{n.sandbox={...n.sandbox,evidence_sha256:'f'.repeat(64)};}]) {
    const {f,calls,authority}=await fixture({nativeChange});
    await assert.rejects(authority.REGISTER_PROVIDER({descriptor:f.provider}),error=>error.automatic_retry_allowed===false&&error.effect_outcome==='UNKNOWN');
    assert.equal(calls.some(row=>row.text.startsWith('insert')),false);
  }
});

test('caller checkpoint digests cannot enable completion before an independent verifier is connected',async()=>{
  const {authority,calls}=await fixture();const prior=calls.length;
  await assert.rejects(authority.ADVANCE_EXECUTION({scope:{},transition:{to:'CHECKPOINTED',critic_proof_sha256:'a'.repeat(64),checkpoint_sha256:'b'.repeat(64)}}),/verifier_unbound/);
  assert.equal(calls.length,prior);
});

test('a closed authority cannot open or replay a private registration transaction',async()=>{
  const {authority,f,calls}=await fixture();authority.close();const before=calls.length;
  await assert.rejects(authority.REGISTER_PROVIDER({descriptor:f.provider}),/host_closed/);
  assert.equal(calls.length,before);
});


test('seed authority forwards the private request lifetime and blocks an expired invocation',async()=>{
 let received,calls=0;
 const seedOperations={...Object.fromEntries(['SEED_GOAL','READ_SEED','LIST_SEEDS'].map(action=>[action,async(_request,context)=>{calls++;received=context;return {action};}])),close(){}};
 const {authority}=await fixture({seedOperations});
 const context=Object.freeze({signal:new AbortController().signal,deadlineAt:Date.now()+30000});
 await authority.SEED_GOAL({},context);assert.equal(received,context);assert.equal(calls,1);
 await assert.rejects(authority.SEED_GOAL({},{deadlineAt:Date.now()-1}),/request_deadline_exceeded/);
 assert.equal(calls,1);authority.close();
});

test('private rejection read verifies exact protected pair without any task/ledger mutation or path disclosure',async()=>{
 const {checkpointFixture}=await import('./test/native-coding-checkpoint-fixture.mjs');
 const f=checkpointFixture();f.critic.registration.result_receipt.result.verdict='REJECT';f.refresh(f.critic);
 const birth=pid=>{const ms=Date.now()-10000;return {pid,created_at:new Date(ms).toISOString(),process_incarnation_id:`pid:${pid}:created_100ns:${BigInt(ms)*10000n+116444736000000000n}`};};
 f.native.host_process=birth(20000);f.native.postgres.postmaster=birth(20001);
 const selector={project_id:f.project.project_id,writer_task_id:f.writer.task.task_id,writer_lease_generation:1,
  critic_task_id:f.critic.task.task_id,critic_lease_generation:1,result_sha256:f.writer.registration.result_receipt.result_sha256};
 const queries=[];
 const sql={unsafe:async(q,a=[])=>{
  queries.push(q);
  if(q.startsWith('select current_user'))return [{current_user:'state_owner',session_user:'state_owner'}];
  if(q.startsWith('select task_id'))return [{task_id:selector.writer_task_id},{task_id:selector.critic_task_id}];
  if(q.startsWith('select to_jsonb(r)'))return [{project:f.project}];
  if(q.includes('native_coding_review_rejection_v1'))return [{value:{...selector,verdict:'REJECT'}}];
  if(q.includes('from destruktion_meta.native_coding_job_registration'))return [a[0]===selector.writer_task_id?f.writer:f.critic];
  throw Error('unexpected read query');
 },begin:async(mode,cb)=>{assert.equal(mode,'isolation level serializable');return cb(sql);}};
 const authority=await createNativeCodingHostAuthority({sql,readNativeScope:async()=>structuredClone(f.native),readNativeWorker:async()=>{},
  readProtectedReceipt:f.readProtectedReceipt,readCheckpointScope:f.readCheckpointScope});
 try{
  const value=await authority.READ_PROJECT_REJECTION(selector);
  assert.equal(value.state,'VERIFIED_REJECTION');assert.equal(value.repair_authorized,false);assert.equal(value.checkpoint_created,false);
  assert.equal(value.worktree,undefined);assert.equal(value.writer_execution_scope,undefined);
  assert(!queries.some(q=>/\b(insert|update|delete|alter|create)\b/i.test(q)));
  await assert.rejects(authority.READ_PROJECT_REJECTION({...selector,repair_authorized:true}),/selector_invalid/);
 }finally{authority.close();}
});

test('expired or cancelled private rejection requests perform no database or physical read',async()=>{
 const x=await fixture();const selector={project_id:randomUUID(),writer_task_id:randomUUID(),writer_lease_generation:1,
  critic_task_id:randomUUID(),critic_lease_generation:1,result_sha256:'a'.repeat(64)};
 const controller=new AbortController();controller.abort();const before=x.calls.length;
 await assert.rejects(x.authority.READ_PROJECT_REJECTION(selector,{signal:controller.signal}),/request_cancelled/);
 await assert.rejects(x.authority.READ_PROJECT_REJECTION(selector,{deadlineAt:Date.now()-1}),/deadline_exceeded/);
 assert.equal(x.calls.length,before);x.authority.close();
});
