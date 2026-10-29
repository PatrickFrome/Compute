import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readAgentResourceAdmission} from '../src/agent-resource-admission.mjs';
import {createNativeCodingExecutionPool} from '../src/native-coding-execution-pool.mjs';
import {TabRegistry} from '../src/tab-registry.mjs';
import {FleetProvisioner} from '../src/fleet-provisioner.mjs';
import {planElasticFleetCapacity} from '../src/fleet-elastic-governor.mjs';

const available=()=>({physical_start_allowed:true,memory_headroom:1000});
const turn=()=>new Promise(resolve=>setImmediate(resolve));
test('a resource-controlled pool accepts more than 64 physical jobs without the old 2/16 ceilings',async()=>{
 const pool=createNativeCodingExecutionPool({physicalSlotBudget:130,readResourceAdmission:available,
  prepareRequest:async lease=>({lease}),executor:{execute:async()=>({state:'RESULT_READY',result:{result_sha256:'a'.repeat(64)}})},readPriorExecution:async()=>null});
 const leases=Array.from({length:130},()=>({task_id:randomUUID(),lease_generation:1,agent_id:'agent_'+randomUUID(),agent_generation_epoch:1}));
 for(const lease of leases)assert.equal(pool.dispatch(lease).state,'PREPARING');
 await turn();assert.equal(pool.snapshot().occupied_slots,130);assert.equal(pool.snapshot().logical_agent_limit,null);
 for(const lease of leases)pool.acknowledge(lease,{state:'RESULT_READY',lease_generation:1,result_sha256:'a'.repeat(64)});
 assert.equal(pool.snapshot().occupied_slots,0);await pool.stop();
});
test('low memory delays a physical start and recovery admits the same never-attempted lease',async()=>{
 let allowed=false,calls=0;
 const pool=createNativeCodingExecutionPool({physicalSlotBudget:130,
  readResourceAdmission:()=>({physical_start_allowed:allowed}),prepareRequest:async lease=>({lease}),
  executor:{execute:async()=>{calls++;return {state:'RESULT_READY',result:{result_sha256:'a'.repeat(64)}};}},readPriorExecution:async()=>null});
 const lease={task_id:randomUUID(),lease_generation:1,agent_id:'agent_'+randomUUID(),agent_generation_epoch:1};
 assert.equal(pool.dispatch(lease).state,'PHYSICAL_POOL_BUSY');assert.equal(pool.snapshot().occupied_slots,0);
 allowed=true;pool.dispatch(lease);await turn();assert.equal(calls,1);
 pool.dispatch(lease);assert.equal(calls,1);await pool.stop();
});
test('physical admission derives from observed memory and CPUs without an agent-count quota',()=>{
 const large=readAgentResourceAdmission({freeMemory:200*1024**3,totalMemory:256*1024**3,parallelism:256});
 assert.equal(large.agent_count_limit,null);assert(large.physical_parallelism>64);
 assert.equal(readAgentResourceAdmission({freeMemory:0,totalMemory:1024**3,parallelism:8}).physical_start_allowed,false);
});
test('browser fleet grows beyond 128, retains its operator target and survives a restart',async()=>{
 const registry=new TabRegistry({readResources:available});let saved=null;
 const make=()=>new FleetProvisioner({policy:{warm_agents:0,desired_agents:0,elastic_max_target_agents:2},
  loadState:async()=>saved,saveState:async value=>{saved=structuredClone(value);},
  createTab:async()=>registry.create({url:'https://chatgpt.com/',role:'FLEET'}),loadTab:async()=>{},tabExists:id=>Boolean(registry.get(id)),census:()=>registry.census()});
 const fleet=make();await fleet.init();await fleet.setOperatorFleetTarget(140);
 for(let i=0;i<18;i++)await fleet.reconcile({active:true,target_agents:140});
 assert.equal(fleet.snapshot().agents.length,140);assert.equal(registry.census().by_role.FLEET,140);
 assert.equal(fleet.snapshot().policy.elastic_max_target_agents,null);
 const restored=make();await restored.init();assert.equal(restored.snapshot().policy.boot_fleet_target,140);
 const plan=planElasticFleetCapacity({backlog:{ready:500,running:140},fleetSnapshot:fleet.snapshot(),maxTargetAgents:2});
 assert(plan.target_agents>140);assert.equal(plan.max_target_agents,null);
});

test('native pool honors changing physical parallelism without dropping existing jobs or replaying them',async()=>{
 let parallelism=2,calls=0;
 const pool=createNativeCodingExecutionPool({physicalSlotBudget:8,
  readResourceAdmission:()=>({physical_start_allowed:true,physical_parallelism:parallelism}),
  prepareRequest:async lease=>({lease}),executor:{execute:async()=>{calls++;return {state:'RESULT_READY',result:{result_sha256:'b'.repeat(64)}};}},readPriorExecution:async()=>null});
 const leases=Array.from({length:4},()=>({task_id:randomUUID(),lease_generation:1,agent_id:'agent_'+randomUUID(),agent_generation_epoch:1}));
 try{
  assert.equal(pool.dispatch(leases[0]).state,'PREPARING');
  assert.equal(pool.dispatch(leases[1]).state,'PREPARING');
  assert.equal(pool.dispatch(leases[2]).state,'PHYSICAL_POOL_BUSY');
  await turn();assert.equal(calls,2);
  parallelism=0;
  assert.equal(pool.dispatch(leases[0]).state,'RESULT_READY');
  assert.equal(pool.dispatch(leases[2]).state,'PHYSICAL_POOL_BUSY');
  assert.equal(pool.snapshot().occupied_slots,2);
  parallelism=3;
  assert.equal(pool.dispatch(leases[2]).state,'PREPARING');
  assert.equal(pool.dispatch(leases[3]).state,'PHYSICAL_POOL_BUSY');
  await turn();assert.equal(calls,3);
  for(const lease of leases.slice(0,3))pool.acknowledge(lease,{state:'RESULT_READY',lease_generation:1,result_sha256:'b'.repeat(64)});
  assert.equal(pool.snapshot().occupied_slots,0);
 }finally{await pool.stop();}
});
test('malformed dynamic physical budgets never start a worker',async()=>{
 for(const physical_parallelism of [-1,NaN,Infinity,1.5,'2',null]){
  let calls=0;
  const pool=createNativeCodingExecutionPool({physicalSlotBudget:8,readResourceAdmission:()=>({physical_start_allowed:true,physical_parallelism}),
   prepareRequest:async lease=>({lease}),executor:{execute:async()=>{calls++;}},readPriorExecution:async()=>null});
  try{assert.equal(pool.dispatch({task_id:randomUUID(),lease_generation:1}).state,'PHYSICAL_POOL_BUSY');await turn();assert.equal(calls,0);}
  finally{await pool.stop();}
 }
});
