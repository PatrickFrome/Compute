import test from 'node:test';
import assert from 'node:assert/strict';
import {drainManagedRuntimeBindings} from '../src/managed-runtime-drain.mjs';
const proof={schema:'metaengine.native-coding.runtime.v1',shutdown_state:'DRAINED',worker_cleanup_confirmed:true};
test('journal and Host close only after a positive native worker-tree drain',async()=>{
  const calls=[];let release;
  const pending=drainManagedRuntimeBindings({coding:{close:()=>new Promise(resolve=>{calls.push('workers');release=resolve;})},
    codingHost:{close:()=>calls.push('capability')},projectRuntime:{close:async()=>calls.push('project')},host:{close:async()=>calls.push('host')}});
  assert.deepEqual(calls,['workers']);release(proof);const result=await pending;
  assert.deepEqual(calls,['workers','capability','project','host']);assert.equal(result.cleanup_confirmed,true);
  assert.equal(result.interrupted_effects_reconciled,false);assert.equal(result.automatic_retry_allowed,false);
});
test('fulfilled but missing, failed, timed-out or unconfirmed cleanup retains the journals and capability',async()=>{
  for(const result of [undefined,{}, {...proof,worker_cleanup_confirmed:false},
    ...['DRAINING','DRAIN_TIMEOUT','DRAIN_FAILED','DRAIN_UNCONFIRMED'].map(shutdown_state=>({...proof,shutdown_state}))]){
    const calls=[];
    await assert.rejects(drainManagedRuntimeBindings({coding:{close:async()=>result},codingHost:{close:()=>calls.push('capability')},
      projectRuntime:{close:async()=>calls.push('project')},host:{close:async()=>calls.push('host')}}),/cleanup_unconfirmed/);
    assert.deepEqual(calls,[]);
  }
});
test('failed project journal close cannot authorize host retirement or a success receipt',async()=>{
  let retired=false;
  await assert.rejects(drainManagedRuntimeBindings({coding:{close:async()=>proof},projectRuntime:{close:async()=>{throw Error('fixture');}},
    host:{close:async()=>{retired=true;}}}),/fixture/);assert.equal(retired,false);
});
