import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createNativeCodingHostAuthority} from './native-coding-host-authority.mjs';

const fixture=async options=>createNativeCodingHostAuthority({sql:{unsafe:async()=>[{current_user:'state_owner',session_user:'state_owner'}],begin:async()=>{}},
  readNativeScope:async()=>{},readNativeWorker:async()=>{},readProtectedReceipt:async()=>{},...options});
const selector=()=>({project_id:randomUUID(),checkpoint_sha256:'a'.repeat(64)});
test('private authority mounts fixed agent and commit operations while absent commit capability remains HOLD',async()=>{
  const a=await fixture();
  for(const name of ['AGENT_OPERATION','FINISH_CHECKPOINT','READ_FINISH_CHECKPOINT'])assert.equal(typeof a[name],'function');
  assert.equal((await a.FINISH_CHECKPOINT(selector())).state,'COMMIT_CAPABILITY_HOLD');
  assert.equal((await a.READ_FINISH_CHECKPOINT(selector())).authority_effect,false);
  assert.equal(Object.hasOwn(a,'RECONCILE_FINISH_CHECKPOINT'),false);
  await assert.rejects(a.FINISH_CHECKPOINT({...selector(),receipt:{}}),/selector_invalid/);
  a.close();await assert.rejects(a.READ_FINISH_CHECKPOINT(selector()),/closed/);
});
test('Host close reaches the actual commit capability and fences a late successful response',async()=>{
  let release,closes=0;const pending=new Promise(resolve=>release=resolve);
  const a=await fixture({commitService:{FINISH_CHECKPOINT:async()=>pending,READ_FINISH_CHECKPOINT:async()=>({state:'PENDING_COMMIT'}),close:()=>{closes++;}}});
  const promise=a.FINISH_CHECKPOINT(selector());a.close();release({state:'COMMITTED_NO_SUCCESSOR'});
  await assert.rejects(promise,/closed/);assert.equal(closes,1);
});

test('optional first-SQL reconciliation delegates only exact selectors and keeps legacy services compatible',async()=>{
  let calls=0,last;
  const service={FINISH_CHECKPOINT:async()=>({state:'PENDING_COMMIT'}),READ_FINISH_CHECKPOINT:async()=>({state:'PENDING_COMMIT'}),close:()=>{}};
  const legacy=await fixture({commitService:service});
  assert.equal(Object.hasOwn(legacy,'RECONCILE_FINISH_CHECKPOINT'),false);legacy.close();
  const a=await fixture({commitService:{...service,RECONCILE_FINISH_CHECKPOINT:async query=>{
    calls++;last=query;return {...query,state:'COMMITTED_NO_SUCCESSOR',automatic_retry_allowed:false};
  }}});
  const query=selector(),reply=await a.RECONCILE_FINISH_CHECKPOINT(query);
  assert.deepEqual(last,query);assert.equal(reply.state,'COMMITTED_NO_SUCCESSOR');
  for(const extra of [{path:'C:/caller.json'},{receipt:{}},{git_head:'a'.repeat(40)},{sql_intent_absent:true}]){
    await assert.rejects(a.RECONCILE_FINISH_CHECKPOINT({...query,...extra}),/selector_invalid/);
  }
  assert.equal(calls,1);a.close();
  await assert.rejects(a.RECONCILE_FINISH_CHECKPOINT(query),/closed/);assert.equal(calls,1);
});

test('Host close cannot expose a late reconciliation success or invoke reconciliation again',async()=>{
  let release,calls=0,closes=0;const pending=new Promise(resolve=>release=resolve);
  const a=await fixture({commitService:{FINISH_CHECKPOINT:async()=>({state:'PENDING_COMMIT'}),
    READ_FINISH_CHECKPOINT:async()=>({state:'PENDING_COMMIT'}),RECONCILE_FINISH_CHECKPOINT:async()=>{calls++;return pending;},
    close:()=>{closes++;}}});
  const query=selector(),promise=a.RECONCILE_FINISH_CHECKPOINT(query);
  a.close();release({state:'COMMITTED_NO_SUCCESSOR'});
  await assert.rejects(promise,/closed/);await assert.rejects(a.RECONCILE_FINISH_CHECKPOINT(query),/closed/);
  assert.equal(calls,1);assert.equal(closes,1);
});
