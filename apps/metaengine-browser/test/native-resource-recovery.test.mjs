import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import {createNativeCodingExecutionPool} from '../src/native-coding-execution-pool.mjs';
const lease=i=>({task_id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,lease_generation:1,agent_id:'agent_generated123',agent_generation_epoch:1});
test('default pool holds under memory pressure and recovers parallel capacity without reconstruction',async()=>{
 const originals={freemem:os.freemem,totalmem:os.totalmem,availableParallelism:os.availableParallelism};let free=0,pool;
 os.freemem=()=>free;os.totalmem=()=>8*1024**3;os.availableParallelism=()=>8;
 try{
  pool=createNativeCodingExecutionPool({prepareRequest:async row=>({lease:row}),readPriorExecution:async()=>null,executor:{execute:async()=>({state:'RESULT_READY',result:{result_sha256:'a'.repeat(64)}})}});
  assert.equal(pool.dispatch(lease(1)).state,'PHYSICAL_POOL_BUSY');assert.equal(pool.snapshot().occupied_slots,0);
  free=4*1024**3;assert.equal(pool.dispatch(lease(1)).state,'PREPARING');assert.equal(pool.dispatch(lease(2)).state,'PREPARING');
  assert.equal(pool.snapshot().physical_slot_budget,8);assert.equal(pool.snapshot().logical_agent_limit,null);
  free=0;assert.equal(pool.dispatch(lease(3)).state,'PHYSICAL_POOL_BUSY');assert.equal(pool.snapshot().occupied_slots,2);
 }finally{if(pool)await pool.stop();Object.assign(os,originals);}
});
