import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createNativeCodingCapacityOwner} from '../src/native-coding-capacity-owner.mjs';
import {createNativeCodingExecutionPool} from '../src/native-coding-execution-pool.mjs';
import {nativeCodingCanonicalSha256 as sha} from '../src/native-coding-task-context.mjs';
const turn=()=>new Promise(r=>setImmediate(r)),gate=()=>{let release;return {promise:new Promise(r=>{release=r;}),release:()=>release()};};
function fixture({budget=1,prepare,execute}={}){
 let wall=Date.now(),mono=0,generation=0,resource=budget,starts=0,prepares=0,control=1;
 const owner=createNativeCodingCapacityOwner({now:()=>wall,monotonic:()=>mono}),host={instance_id:randomUUID(),host_pid:44,closed:false};
 const binding=()=>({...host,control_generation:control}),pool=createNativeCodingExecutionPool({capacityOwner:owner,physicalSlotBudget:budget,
  readResourceAdmission:()=>({physical_start_allowed:resource>0,physical_parallelism:resource}),readExecutionBinding:binding,
  prepareRequest:async lease=>{prepares++;await prepare?.();return {lease};},executor:{execute:async request=>{starts++;return execute?execute(request):{state:'READBACK_REQUIRED'};}},
  readPriorExecution:async()=>({state:'HOLD'})});
 owner.bind({capability:{},...host,principal_sha256:'a'.repeat(64),readBinding:()=>host,readPrincipal:()=>'a'.repeat(64),poolToken:pool.capacityPoolToken});
 const census=async({setup=0,unknown=0,represented,taskSlots}={})=>owner.collect(owned=>({schema:'metaengine.native-coding.capacity-census.v1',host_instance_id:host.instance_id,host_pid:host.host_pid,
  principal_sha256:'a'.repeat(64),postgres_scope_sha256:'b'.repeat(64),generation:++generation,owned_tasks_sha256:sha(owned),observed_at:new Date(wall).toISOString(),expires_at:new Date(wall+10000).toISOString(),
  census_sha256:'c'.repeat(64),complete:true,state:unknown?'HOLD':'CURRENT',counts:{task_slots:taskSlots??owned.length,setup_slots:setup,represented_tasks:represented??owned.length,unrepresented_claims:0,unresolved_slots:unknown},automatic_retry_allowed:false,authority_effect:false}));
 const lease=()=>({task_id:randomUUID(),lease_generation:1,agent_id:'agent_fixture111',agent_generation_epoch:1,target_id:'codex-cli:'+randomUUID(),tab_id:'native-coding:'+randomUUID(),role:'IMPLEMENTER',base_sha:'d'.repeat(40)});
 return {owner,pool,host,census,lease,get starts(){return starts;},get prepares(){return prepares;},lower:n=>{resource=n;},rotate:()=>{control++;},expire:()=>{mono+=10000;},limits:{configuredCeiling:budget,resourceCeiling:budget}};
}
test('issued budget-one lease remains retained through busy setup; generic reads cannot dispatch; first tick does not double count',async()=>{
 const f=fixture(),lease=f.lease();assert.equal(f.pool.dispatch(lease).reason,'WAITING_CAPACITY');await f.census({setup:1});
 f.pool.advanceUnattemptedLease(lease);await f.pool.observe(lease);f.pool.snapshot();assert.equal(f.starts,0);assert.equal(f.pool.snapshot().occupied_slots,1);
 await f.census();assert.equal(f.owner.projection(f.limits).free_slots,0,'real lease already owns this slot');
 await f.pool.observe(lease);assert.equal(f.starts,0);assert.equal(f.prepares,0);
 assert.equal(f.pool.advanceUnattemptedLease(lease).state,'PREPARING');await turn();assert.equal(f.starts,1);
 await f.census();f.pool.advanceUnattemptedLease(lease);await turn();assert.equal(f.starts,1,'UNKNOWN is never retried');await f.pool.stop();
});
test('budget greater than one counts setup and real claims once, keeping both leases when resources shrink',async()=>{
 const f=fixture({budget:3}),a=f.lease(),b=f.lease();f.pool.dispatch(a);f.pool.dispatch(b);await f.census({setup:1});f.lower(2);
 f.pool.advanceUnattemptedLease(a);f.pool.advanceUnattemptedLease(b);assert.equal(f.starts,0);assert.equal(f.pool.snapshot().occupied_slots,2);
 f.lower(3);f.pool.advanceUnattemptedLease(a);await turn();assert.equal(f.starts,1);
 await f.census({setup:1});f.pool.advanceUnattemptedLease(b);await turn();assert.equal(f.starts,2);await f.pool.stop();
});
for(const kind of ['lease-generation','agent','target','control','host','expired','unrepresented','unknown'])test('retained first dispatch refuses '+kind,async()=>{
 const f=fixture(),lease=f.lease();f.pool.dispatch(lease);await f.census(kind==='unrepresented'?{represented:0}:kind==='unknown'?{unknown:1}:{});const current={...lease};
 if(kind==='lease-generation')current.lease_generation++;if(kind==='agent')current.agent_id='agent_other111';if(kind==='target')current.target_id='codex-cli:'+randomUUID();
 if(kind==='control')f.rotate();if(kind==='host')f.host.instance_id=randomUUID();if(kind==='expired')f.expire();
 f.pool.advanceUnattemptedLease(current);await turn();assert.equal(f.starts,0);assert.equal(f.pool.snapshot().occupied_slots,1);await f.pool.stop();
});
test('changed admission during a held preparation remains never-attempted; only a fresh explicit tick may start',async()=>{
 const hold=gate(),f=fixture({prepare:()=>hold.promise}),lease=f.lease();f.pool.dispatch(lease);await f.census();f.pool.advanceUnattemptedLease(lease);await turn();
 f.lower(0);hold.release();await turn();assert.equal(f.starts,0);assert.equal(f.pool.snapshot().jobs[0].state,'PHYSICAL_POOL_BUSY');
 f.lower(1);await f.census();await f.pool.observe(lease);assert.equal(f.starts,0);f.pool.advanceUnattemptedLease(lease);await turn();assert.equal(f.starts,1);await f.pool.stop();
});
test('shutdown during held preparation joins it, never starts, and retains its real lease',async()=>{
 const hold=gate(),f=fixture({prepare:()=>hold.promise}),lease=f.lease();f.pool.dispatch(lease);await f.census();f.pool.advanceUnattemptedLease(lease);await turn();let done=false;
 const closing=f.pool.stop().then(()=>{done=true;});await turn();assert.equal(done,false);hold.release();await closing;assert.equal(f.starts,0);assert.equal(f.pool.snapshot().occupied_slots,1);
});
test('fresh authorization/expiry/cancel failure in preparation cannot fall through or automatically retry',async()=>{
 const f=fixture({prepare:()=>{throw Error('current_lease_cancelled_or_expired');}}),lease=f.lease();f.pool.dispatch(lease);await f.census();f.pool.advanceUnattemptedLease(lease);await turn();
 assert.equal(f.starts,0);assert.equal(f.pool.snapshot().jobs[0].state,'READBACK_REQUIRED');await f.census();f.pool.advanceUnattemptedLease(lease);assert.equal(f.prepares,1);await f.pool.stop();
});

test('duplicate dispatch and forged completion cannot release a retained never-attempted or UNKNOWN slot',async()=>{
 const f=fixture(),lease=f.lease();f.pool.dispatch(lease);f.pool.dispatch({...lease,agent_id:'agent_wrong111'});
 assert.equal(f.pool.snapshot().occupied_slots,1);assert.throws(()=>f.pool.acknowledge(lease,{state:'COMPLETED',lease_generation:1,result_sha256:'e'.repeat(64)}),/ack_unproven/);
 await f.census();f.pool.advanceUnattemptedLease(lease);await turn();assert.equal(f.starts,1);
 assert.throws(()=>f.pool.acknowledge(lease,{state:'RESULT_READY',lease_generation:1,result_sha256:'e'.repeat(64)}),/ack_unproven/);
 f.pool.dispatch(lease);await f.census();f.pool.advanceUnattemptedLease(lease);await turn();assert.equal(f.starts,1);assert.equal(f.pool.snapshot().occupied_slots,1);await f.pool.stop();
});
