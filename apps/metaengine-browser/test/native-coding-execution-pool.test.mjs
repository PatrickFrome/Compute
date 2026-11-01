import {readAgentResourceAdmission} from '../src/agent-resource-admission.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeCodingExecutionPool} from '../src/native-coding-execution-pool.mjs';
const lease={task_id:'11111111-1111-4111-8111-111111111111',lease_generation:1,
  agent_id:'agent_11111111-1111-4111-8111-111111111111',agent_generation_epoch:1};
const other={...lease,task_id:'22222222-2222-4222-8222-222222222222'};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const generatedResources=()=>readAgentResourceAdmission({freeMemory:2*1024*1024*1024,totalMemory:8*1024*1024*1024,parallelism:2});
function fixture(budget=2,readResourceAdmission=generatedResources) {
  const calls=[];let finish;
  const pending=new Promise(resolve=>{finish=resolve;});
  const pool=createNativeCodingExecutionPool({physicalSlotBudget:budget,readResourceAdmission,
    prepareRequest:async row=>({lease:row}),
    executor:{execute:async(_request,{signal})=>{
      calls.push('execute');
      return Promise.race([pending,new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}))]);
    }},
    readPriorExecution:async()=>{calls.push('read');return{state:'ATTEMPTED'};}});
  return{pool,calls,finish};
}
test('dispatch does not await the model and the existing heartbeat can keep observing',async()=>{
  const f=fixture();assert.equal(f.pool.dispatch(lease).state,'PREPARING');
  await turn();assert.equal((await f.pool.observe(lease)).state,'RUNNING');
  assert.equal(f.pool.dispatch(lease).state,'RUNNING');assert.equal(f.calls.length,1);
  f.finish({state:'RESULT_READY',result:{result_sha256:'a'.repeat(64)}});await turn();
  assert.equal((await f.pool.observe(lease)).state,'RESULT_READY');
});
test('result stays in its bounded slot until an exact W30 completion readback',async()=>{
  const f=fixture(1);f.pool.dispatch(lease);await turn();
  f.finish({state:'RESULT_READY',result:{result_sha256:'a'.repeat(64)}});await turn();
  assert.equal(f.pool.dispatch(other).state,'PHYSICAL_POOL_BUSY');
  assert.throws(()=>f.pool.acknowledge(lease,{state:'RESULT_READY',lease_generation:2,result_sha256:'a'.repeat(64)}),/ack_unproven/);
  f.pool.acknowledge(lease,{state:'RESULT_READY',lease_generation:1,result_sha256:'a'.repeat(64)});
  assert.equal(f.pool.snapshot().occupied_slots,0);
});
test('restart observes durable state without invoking an executor',async()=>{
  const f=fixture(),result=await f.pool.observe(lease);
  assert.equal(result.state,'READBACK_ONLY');assert.deepEqual(f.calls,['read']);
  assert.equal(f.pool.snapshot().occupied_slots,0);
});
test('stop cancels jobs, retains unknown outcomes, and closes new dispatch',async()=>{
  const f=fixture();f.pool.dispatch(lease);await turn();
  const snapshot=await f.pool.stop();assert.equal(snapshot.closed,true);
  assert.equal(snapshot.jobs[0].state,'READBACK_REQUIRED');
  assert.throws(()=>f.pool.dispatch(other),/closed/);
});
test('a private request builder cannot switch the assigned agent',async()=>{
  let called=false;
  const pool=createNativeCodingExecutionPool({readResourceAdmission:generatedResources,prepareRequest:async row=>({lease:{...row,agent_id:'agent_different'}}),
    executor:{execute:async()=>{called=true;}},readPriorExecution:async()=>null});
  pool.dispatch(lease);await turn();
  assert.equal((await pool.observe(lease)).reason,'NATIVE_REQUEST_BINDING_CHANGED');assert.equal(called,false);
});

test('one native slot admits child work after exact parent result ACK, never from a waiting hint', async () => {
  const f = fixture(1);
  try {
    f.pool.dispatch(lease); await turn();
    assert.equal((await f.pool.observe(lease)).state, 'RUNNING');
    assert.equal(f.pool.dispatch(other).state, 'PHYSICAL_POOL_BUSY');
    assert.throws(() => f.pool.acknowledge(lease, {
      state: 'WAIT_CHILDREN', lease_generation: 1, result_sha256: 'a'.repeat(64),
    }), /ack_unproven/);
    assert.equal(f.pool.snapshot().occupied_slots, 1);
    // Native jobs are not browser parent conversations. A real terminal result
    // followed by W30's exact acknowledgement releases compute, even if the
    // enclosing project graph still has descendants to execute or verify.
    f.finish({ state: 'RESULT_READY', result: { result_sha256: 'a'.repeat(64) } });
    await turn();
    assert.equal(f.pool.dispatch(other).state, 'PHYSICAL_POOL_BUSY', 'pending ACK retains receipt custody');
    f.pool.acknowledge(lease, { state: 'RESULT_READY', lease_generation: 1, result_sha256: 'a'.repeat(64) });
    assert.equal(f.pool.dispatch(other).state, 'PREPARING');
    await turn();
    assert.equal(f.calls.filter(call => call === 'execute').length, 2);
  } finally { await f.pool.stop(); }
});

test('resource refusal prevents generated pool start without weakening the physical budget',async()=>{
 const f=fixture(2,()=>readAgentResourceAdmission({freeMemory:0,totalMemory:8*1024*1024*1024,parallelism:2}));
 try{assert.equal(f.pool.dispatch(lease).state,'PHYSICAL_POOL_BUSY');assert.equal(f.pool.snapshot().occupied_slots,0);assert.equal(f.calls.length,0);}
 finally{await f.pool.stop();}
});
