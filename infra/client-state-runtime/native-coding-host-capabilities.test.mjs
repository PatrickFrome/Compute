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
  await assert.rejects(a.FINISH_CHECKPOINT({...selector(),receipt:{}}),/selector_invalid/);
  a.close();await assert.rejects(a.READ_FINISH_CHECKPOINT(selector()),/closed/);
});
test('Host close reaches the actual commit capability and fences a late successful response',async()=>{
  let release,closes=0;const pending=new Promise(resolve=>release=resolve);
  const a=await fixture({commitService:{FINISH_CHECKPOINT:async()=>pending,READ_FINISH_CHECKPOINT:async()=>({state:'PENDING_COMMIT'}),close:()=>{closes++;}}});
  const promise=a.FINISH_CHECKPOINT(selector());a.close();release({state:'COMMITTED_NO_SUCCESSOR'});
  await assert.rejects(promise,/closed/);assert.equal(closes,1);
});
