import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeCodingHostAuthority} from './native-coding-host-authority.mjs';
import {checkpointFixture} from './test/native-coding-checkpoint-fixture.mjs';

async function fixture() {
  const f=checkpointFixture(),calls=[],controls={candidate:true,failCas:0,failFinalize:false,reader:null};
  f.native.host_process=structuredClone(f.writer.registration.job_envelope.payload.host_process);
  f.native.postgres=structuredClone(f.writer.permit.postgres);
  const committed={checkpoint:null,finalized:false,executions:Object.fromEntries([f.writer,f.critic].map(b=>[b.task.task_id,structuredClone(b.execution)]))};
  const selectors={writer_task_id:f.writer.task.task_id,writer_lease_generation:1,critic_task_id:f.critic.task.task_id,critic_lease_generation:1};
  async function query(store,sql,args=[]) {
    calls.push({sql,args});
    if(sql.startsWith('select current_user'))return[{current_user:'state_owner',session_user:'state_owner'}];
    if(sql.startsWith('set local '))return[];
    if(sql.includes('native_coding_checkpoint_candidate_v1'))return[{value:controls.candidate&&!store.checkpoint?selectors:null}];
    if(sql.startsWith('select to_jsonb(k)'))return store.checkpoint?[{checkpoint:store.checkpoint,finalized:store.finalized}]:[];
    if(sql.startsWith('select task_id from destruktion_meta.devos_fleet_task'))return[{task_id:selectors.writer_task_id},{task_id:selectors.critic_task_id}];
    if(sql.startsWith('select to_jsonb(r)'))return[{project:structuredClone(f.project)}];
    if(sql.startsWith('select p.permit,'))return[structuredClone(args[0]===f.writer.task.task_id?f.writer:f.critic)];
    if(sql.startsWith('insert into destruktion_meta.native_coding_checkpoint')) {
      const record=JSON.parse(args[15]);store.checkpoint={...record,checkpoint:record,canonical_checkpoint:args[15],checkpoint_sha256:args[16]};
      return[{checkpoint_sha256:args[16]}];
    }
    if(sql.includes('native_coding_advance_v1')) {
      const row=store.executions[args[0]],index=row.task_id===f.critic.task.task_id?1:2;
      if(controls.failCas===index||row.state!==args[5]||row.reservation_id!==args[2])throw Error('generated_cas_failed');
      Object.assign(row,{state:args[6],critic_proof_sha256:args[8],checkpoint_sha256:args[9]});return[{value:structuredClone(row)}];
    }
    if(sql.includes('native_coding_finalize_checkpoint_v1')) {
      if(controls.failFinalize)throw Error('generated_finalize_failed');
      assert.ok(Object.values(store.executions).every(e=>e.state==='CHECKPOINTED'&&e.checkpoint_sha256===store.checkpoint.checkpoint_sha256));
      store.finalized=true;return[{value:{state:'CHECKPOINTED_PENDING_COMMIT',...selectors,checkpoint_sha256:store.checkpoint.checkpoint_sha256,successor_admitted:false}}];
    }
    throw Error('unexpected_checkpoint_query');
  }
  const sql={unsafe:(text,args)=>query(committed,text,args),begin:async(mode,fn)=>{
    calls.push({mode});const staged=structuredClone(committed),result=await fn({unsafe:(text,args)=>query(staged,text,args)});
    Object.assign(committed,staged);return result;
  }};
  const authority=await createNativeCodingHostAuthority({sql,readNativeScope:async()=>{throw Error('launch_reader_must_not_be_used');},
    readNativeWorker:async()=>{throw Error('historical_worker_must_not_be_polled');},readProtectedReceipt:f.readProtectedReceipt,
    readCheckpointScope:async(...args)=>controls.reader?controls.reader(...args):f.readCheckpointScope(...args)});
  return {f,calls,controls,committed,selectors,authority,request:{project_id:f.project.project_id}};
}
const unknown=e=>e.effect_outcome==='UNKNOWN'&&e.automatic_retry_allowed===false;

test('reconcile checkpoints the exact pair with original ledger scopes, then completes it in one transaction',async()=>{
  const x=await fixture();const result=await x.authority.RECONCILE_PROJECT(x.request);
  assert.equal(result.state,'CHECKPOINTED_PENDING_COMMIT');assert.equal(result.successor_admitted,false);
  assert.equal(result.checkpoint_sha256,x.committed.checkpoint.checkpoint_sha256);
  assert.equal(x.committed.finalized,true);assert.ok(Object.values(x.committed.executions).every(e=>e.state==='CHECKPOINTED'));
  const writes=x.calls.filter(c=>c.sql?.includes('native_coding_advance_v1'));
  assert.deepEqual(writes.map(c=>c.args[4]),[x.f.critic.execution.host_incarnation,x.f.writer.execution.host_incarnation]);
  assert.ok(x.calls.findIndex(c=>c.sql?.startsWith('insert into destruktion_meta.native_coding_checkpoint'))<x.calls.findIndex(c=>c.sql?.includes('native_coding_advance_v1')));
  assert.equal(x.calls.filter(c=>c.mode).length,1);assert.equal(x.calls.find(c=>c.mode).mode,'isolation level serializable');
  assert.deepEqual(await x.authority.READ_PROJECT_CHECKPOINT(x.request),result);
});

test('a second execution CAS or finalizer failure rolls back checkpoint and both execution updates',async()=>{
  for(const change of [x=>x.controls.failCas=2,x=>x.controls.failFinalize=true]) {
    const x=await fixture();change(x);await assert.rejects(x.authority.RECONCILE_PROJECT(x.request),unknown);
    assert.equal(x.committed.checkpoint,null);assert.equal(x.committed.finalized,false);
    assert.ok(Object.values(x.committed.executions).every(e=>e.state==='RESULT_READY'));
    assert.equal(x.calls.filter(c=>c.mode).length,1,'no automatic transaction retry');
  }
});

test('readback returns only fixed selectors/state and a committed digest without repeating effects',async()=>{
  const x=await fixture();const pending=await x.authority.READ_PROJECT_CHECKPOINT(x.request);
  assert.equal(pending.state,'PENDING');assert.equal(pending.writer_task_id,x.selectors.writer_task_id);assert.equal(pending.checkpoint_sha256,null);
  assert.equal(x.calls.some(c=>c.mode),false);
  const done=await x.authority.RECONCILE_PROJECT(x.request),writes=x.calls.filter(c=>c.sql?.startsWith('insert ')).length;
  assert.deepEqual(await x.authority.RECONCILE_PROJECT(x.request),done);
  assert.equal(x.calls.filter(c=>c.sql?.startsWith('insert ')).length,writes);
  x.committed.finalized=false;
  assert.equal((await x.authority.READ_PROJECT_CHECKPOINT(x.request)).state,'READBACK_REQUIRED');
});

test('invalid current bytes or missing native checkpoint reader cannot write a checkpoint',async()=>{
  const x=await fixture();x.f.native.git.changed_files[0].sha256='f'.repeat(64);
  await assert.rejects(x.authority.RECONCILE_PROJECT(x.request),unknown);assert.equal(x.committed.checkpoint,null);
  assert.equal(x.calls.some(c=>c.sql?.startsWith('insert ')),false);
});

test('Host close during the native read prevents INSERT, CAS and finalization before commit',async()=>{
  const x=await fixture();let release,entered;const ready=new Promise(resolve=>{entered=resolve;});
  x.controls.reader=async()=>{entered();return new Promise(resolve=>{release=resolve;});};
  const pending=x.authority.RECONCILE_PROJECT(x.request);await ready;x.authority.close();release(structuredClone(x.f.native));
  await assert.rejects(pending,unknown);assert.equal(x.committed.checkpoint,null);
  assert.equal(x.calls.some(c=>c.sql?.startsWith('insert ')),false);
});
