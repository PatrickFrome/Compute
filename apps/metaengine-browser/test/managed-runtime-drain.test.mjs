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

test('positive workers do not retire Host or journals before independent remote physical settlement',async()=>{
 const calls=[];let ready=false;
 const options={coding:{close:async()=>proof},codingHost:{drainPhysical:async()=>{calls.push('physical');if(!ready)throw Error('remote physical HOLD');return{schema:'metaengine.native-coding.physical-drain.v1',cleanup_confirmed:true};},close:()=>calls.push('capability')},
  projectRuntime:{close:async()=>calls.push('project')},host:{close:async()=>calls.push('host')}};
 await assert.rejects(drainManagedRuntimeBindings(options),/native_host_scope_cleanup_unconfirmed/);assert.deepEqual(calls,['physical']);
 ready=true;assert.equal((await drainManagedRuntimeBindings(options)).cleanup_confirmed,true);assert.deepEqual(calls,['physical','physical','capability','project','host']);
});

test('staged worker proof cannot stand in for missing or unconfirmed full runtime join',async()=>{
 const stage={schema:'metaengine.native-coding.runtime-worker-drain.v1',admission_fenced:true,worker_cleanup_confirmed:true,authority_effect:false};
 for(const bad of [null,{}, {...proof,shutdown_state:'DRAIN_TIMEOUT'}, {...proof,worker_cleanup_confirmed:false}]){
  let retired=0;const coding={drainNativeWorkers:async()=>stage,...(bad===null?{}:{drainClosedWork:async()=>bad})};
  await assert.rejects(drainManagedRuntimeBindings({coding,codingHost:{close:()=>{retired++;}}}),/full_cleanup/);assert.equal(retired,0);
 }
});
test('staged admission fence and tree proof are both required before journals or capability may retire',async()=>{
 const stage={schema:'metaengine.native-coding.runtime-worker-drain.v1',admission_fenced:true,worker_cleanup_confirmed:true,authority_effect:false};
 for(const bad of [{}, {...stage,schema:'foreign'}, {...stage,admission_fenced:false}, {...stage,worker_cleanup_confirmed:false}, {...stage,authority_effect:true}]){
  let joins=0,retired=0;await assert.rejects(drainManagedRuntimeBindings({coding:{drainNativeWorkers:async()=>bad,drainClosedWork:async()=>{joins++;return proof;}},
   codingHost:{close:()=>{retired++;}}}),/worker_cleanup_unconfirmed/);assert.equal(joins,0);assert.equal(retired,0);
 }
});
test('staged full close keeps its original pending work after worker proof; rejection never closes journals',async()=>{
 let reject;const pending=new Promise((_,r)=>{reject=r;});const calls=[];
 const closing=drainManagedRuntimeBindings({coding:{drainNativeWorkers:async()=>({schema:'metaengine.native-coding.runtime-worker-drain.v1',admission_fenced:true,worker_cleanup_confirmed:true,authority_effect:false}),
  drainClosedWork:()=>pending},codingHost:{close:()=>calls.push('capability')},projectRuntime:{close:()=>calls.push('project')}});
 const refused=assert.rejects(closing,/generated local close failed/);await new Promise(r=>setImmediate(r));assert.deepEqual(calls,[]);
 reject(Error('generated local close failed'));await refused;assert.deepEqual(calls,[]);
});
