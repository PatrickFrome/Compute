import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createNativeCodingCapacityOwner} from '../src/native-coding-capacity-owner.mjs';
import {createNativeCodingExecutionPool} from '../src/native-coding-execution-pool.mjs';
import {nativeCodingCanonicalSha256 as sha} from '../src/native-coding-task-context.mjs';
const limits={configuredCeiling:3,resourceCeiling:3},turn=()=>new Promise(r=>setImmediate(r));
const gate=()=>{let release;return{promise:new Promise(r=>{release=r;}),release:v=>release(v)};};
function fixture(){
 let wall=1793358000000,mono=0,generation=0,principal='a'.repeat(64);
 const owner=createNativeCodingCapacityOwner({now:()=>wall,monotonic:()=>mono}),view=owner.openPool(),capability={};
 const binding={instance_id:randomUUID(),host_pid:42,closed:false};
 const bind=()=>owner.bind({capability,...binding,principal_sha256:principal,readBinding:()=>binding,readPrincipal:()=>principal,poolToken:view.token});bind();
 const value=(owned=[],change={})=>({schema:'metaengine.native-coding.capacity-census.v1',host_instance_id:binding.instance_id,host_pid:binding.host_pid,
  principal_sha256:principal,postgres_scope_sha256:'b'.repeat(64),generation:++generation,owned_tasks_sha256:sha(owned),observed_at:new Date(wall).toISOString(),
  expires_at:new Date(wall+10000).toISOString(),census_sha256:'c'.repeat(64),complete:true,state:'CURRENT',counts:{task_slots:owned.length,setup_slots:0,unrepresented_claims:0,represented_tasks:owned.length,unresolved_slots:0},
  automatic_retry_allowed:false,authority_effect:false,...change});
 return {owner,view,binding,bind,value,advance:(w,m=w)=>{wall+=w;mono+=m;},rotate:()=>{principal='d'.repeat(64);},snap:()=>owner.snapshot(limits)};
}
test('initial default custody owner and replacement Main advertise free zero until genuine census',async()=>{
 const f=fixture();assert.equal(f.snap().projection.free_slots,0);assert.equal(f.snap().projection.state,'RECOVERY_REQUIRED');
 await f.owner.collect(f.value);assert.equal(f.snap().projection.free_slots,3);
 const next=fixture();assert.equal(next.snap().projection.free_slots,0);
});
test('collection is singleflight, keeps reservation, and a local revision change rejects even identical later digest',async()=>{
 const f=fixture(),wait=gate();let calls=0;
 const a=f.owner.collect(async owned=>{calls++;await wait.promise;return f.value(owned);});
 assert.equal(a,f.owner.collect(()=>{assert.fail('overlap');}));await turn();
 const row={lease:{task_id:randomUUID(),lease_generation:1}};f.view.set('one',row);f.view.delete('one');
 wait.release();assert.equal(await a,null);assert.equal(calls,1);assert.equal(f.snap().projection.free_slots,0);
});
test('task reservation stays owned during a withheld collection and read APIs do not start execution',async()=>{
 const f=fixture(),wait=gate(),row={lease:{task_id:randomUUID(),lease_generation:1}};f.view.set('one',row);
 const pending=f.owner.collect(async owned=>{await wait.promise;return f.value(owned);});await turn();
 assert.equal(f.snap().retained_task_slots,1);assert.equal(f.view.get('one'),row);assert.equal(f.snap().projection.free_slots,0);
 wait.release();await pending;assert.equal(f.snap().projection.free_slots,2);assert.equal(f.view.get('one'),row);
});
for(const mutation of ['partial','unknown','wrong-host','wrong-principal','wrong-tasks','invalid'])test(`census ${mutation} cannot advertise capacity`,async()=>{
 const f=fixture();await f.owner.collect(owned=>{const v=f.value(owned);if(mutation==='partial'){v.complete=false;v.state='HOLD';}
  if(mutation==='unknown'){v.counts.unresolved_slots=1;v.state='HOLD';}
  if(mutation==='wrong-host')v.host_instance_id=randomUUID();if(mutation==='wrong-principal')v.principal_sha256='d'.repeat(64);
  if(mutation==='wrong-tasks')v.owned_tasks_sha256='d'.repeat(64);return mutation==='invalid'?null:v;});
 assert.equal(f.snap().projection.free_slots,0);
});
for(const mutation of ['monotonic','wall','rollback','closed','host','identity'])test(`accepted observation is fenced on ${mutation}`,async()=>{
 const f=fixture();await f.owner.collect(f.value);assert.equal(f.snap().projection.free_slots,3);
 if(mutation==='monotonic')f.advance(0,10000);if(mutation==='wall')f.advance(10000,0);if(mutation==='rollback')f.advance(-1,1);
 if(mutation==='closed')f.binding.closed=true;if(mutation==='host')f.binding.instance_id=randomUUID();if(mutation==='identity')f.rotate();
 assert.equal(f.snap().projection.free_slots,0);
});
test('late reply after Main close cannot revive capacity; drain joins exact collection without deleting jobs',async()=>{
 const f=fixture(),wait=gate();f.view.set('one',{lease:{task_id:randomUUID(),lease_generation:1}});
 const read=f.owner.collect(async owned=>{await wait.promise;return f.value(owned);});await turn();f.owner.close();
 let drained=false;const drain=f.owner.drain().then(()=>{drained=true;});await turn();assert.equal(drained,false);assert.equal(f.snap().retained_task_slots,1);
 wait.release();assert.equal(await read,null);await drain;assert.equal(f.snap().projection.free_slots,0);assert.equal(f.snap().retained_task_slots,1);
});
test('generation replay and changed same-Host PostgreSQL incarnation remain fenced even after invalidation',async()=>{
 const f=fixture();const first=await f.owner.collect(f.value);await f.owner.collect(()=>first);assert.equal(f.snap().projection.free_slots,0);
 await f.owner.collect(owned=>f.value(owned,{postgres_scope_sha256:'d'.repeat(64)}));assert.equal(f.snap().projection.free_slots,0);
});
test('same lifetime custody owner prevents replacement pool adoption and keeps legacy status observation pure',async()=>{
 const owner=createNativeCodingCapacityOwner(),wait=gate();let executed=0,reads=0;
 const lease={task_id:randomUUID(),lease_generation:1,agent_id:'agent_fixture1',agent_generation_epoch:1};
 const options={capacityOwner:owner,physicalSlotBudget:1,readResourceAdmission:()=>({physical_start_allowed:true,physical_parallelism:1}),
  prepareRequest:async lease=>({lease}),executor:{execute:async()=>{executed++;await wait.promise;throw Error('fixture_unknown');}},readPriorExecution:async()=>{reads++;return {state:'HOLD'};}};
 const first=createNativeCodingExecutionPool(options);first.dispatch(lease);await turn();
 const second=createNativeCodingExecutionPool(options);assert.equal(second.dispatch(lease).state,'PHYSICAL_POOL_BUSY');
 assert.equal((await second.observe(lease)).state,'READBACK_ONLY');assert.equal(executed,0,'unbound census cannot start even the original pool');assert.equal(reads,1);
 assert.equal(second.snapshot().occupied_slots,0);assert.equal(owner.snapshot(limits).retained_task_slots,1);
 wait.release();await first.stop();await second.stop();assert.equal(owner.snapshot(limits).retained_task_slots,1);
});
test('task/setup capacity shares fixed ceiling without fabricating v1 jobs or changing immutable budget',async()=>{
 const f=fixture();f.view.set('one',{lease:{task_id:randomUUID(),lease_generation:1}});
 await f.owner.collect(owned=>f.value(owned,{counts:{task_slots:1,setup_slots:1,unrepresented_claims:0,represented_tasks:1,unresolved_slots:0}}));
 assert.equal(f.snap().projection.free_slots,1);assert.equal(f.snap().projection.configured_ceiling,3);assert.equal([...f.view.values()].length,1);
 assert.equal(f.owner.projection({...limits,resourceCeiling:1}).free_slots,0);
});
