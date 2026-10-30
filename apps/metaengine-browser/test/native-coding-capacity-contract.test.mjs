import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {nativeCodingCanonicalSha256 as sha} from '../src/native-coding-task-context.mjs';
import {NATIVE_CAPACITY_CENSUS_SCHEMA,nativeCapacityOwnedTasks,validateNativeCapacityReadInput,validateNativeCapacityCensus,
 nativeCapacityProjection,validateNativeCapacityProjection} from '../src/native-coding-capacity-contract.mjs';
const now=1793358000000;
function fixture(){const owned=[{task_id:randomUUID(),lease_generation:1}],binding={instance_id:randomUUID(),host_pid:222};return{owned,binding,
 value:{schema:NATIVE_CAPACITY_CENSUS_SCHEMA,host_instance_id:binding.instance_id,host_pid:binding.host_pid,
 principal_sha256:'a'.repeat(64),postgres_scope_sha256:'b'.repeat(64),generation:1,owned_tasks_sha256:sha(owned),
 observed_at:new Date(now).toISOString(),expires_at:new Date(now+10000).toISOString(),census_sha256:'c'.repeat(64),complete:true,state:'CURRENT',
 counts:{task_slots:1,setup_slots:0,unrepresented_claims:0,represented_tasks:1,unresolved_slots:0},automatic_retry_allowed:false,authority_effect:false}};}
test('capacity input is a canonical selector set, not commands, paths or a logical roster ceiling',()=>{
 const rows=Array.from({length:1000},()=>({task_id:randomUUID(),lease_generation:1}));assert.equal(nativeCapacityOwnedTasks(rows).length,1000);
 assert.deepEqual(nativeCapacityOwnedTasks(rows),nativeCapacityOwnedTasks(rows.toReversed()));
 for(const v of [null,{}, {owned_tasks:[],command:'run'},{owned_tasks:[rows[0],rows[0]]},{owned_tasks:[{...rows[0],path:'/private'}]}])assert.throws(()=>validateNativeCapacityReadInput(v));
});
test('fresh exact Host census validates without revealing foreign task or path data',()=>{
 const f=fixture();assert.deepEqual(validateNativeCapacityCensus(f.value,{binding:f.binding,ownedTasks:f.owned,now}),f.value);
 assert.ok(!JSON.stringify(f.value).includes(f.owned[0].task_id));
});
for(const change of [v=>v.complete=false,v=>v.counts.unresolved_slots=1,v=>v.counts.represented_tasks=2,v=>v.host_pid=0,
 v=>v.foreign_task_id=randomUUID(),v=>v.expires_at=new Date(now+10001).toISOString(),v=>v.counts.task_slots=-1,
 v=>v.authority_effect=true,v=>v.generation=0])test(`census rejects malformed/partial CURRENT mutation ${change}`,()=>{
 const f=fixture();change(f.value);assert.throws(()=>validateNativeCapacityCensus(f.value,{binding:f.binding,ownedTasks:f.owned,now}));
});
test('wrong child, selected tasks, old generation, stale/rollback observation are never absence',()=>{
 const f=fixture();for(const options of [{binding:{...f.binding,instance_id:randomUUID()}},{ownedTasks:[]},{minimumGeneration:1},{now:now+10000},{now:now-1}])
 assert.throws(()=>validateNativeCapacityCensus(f.value,{binding:f.binding,ownedTasks:f.owned,now,...options}));
});
test('partial or unresolved census may report HOLD but cannot advertise one free slot',()=>{
 const f=fixture();f.value.complete=false;f.value.state='HOLD';f.value.counts.unresolved_slots=1;
 const census=validateNativeCapacityCensus(f.value,{now}),projection=nativeCapacityProjection({census,configuredCeiling:8,resourceCeiling:8,localTaskCount:1,localRevision:2});
 assert.equal(projection.free_slots,0);validateNativeCapacityProjection(projection);assert.throws(()=>validateNativeCapacityProjection({...projection,free_slots:1}));
});
test('typed setup occupancy and exact task intersection share the fixed ceiling without fake execution jobs',()=>{
 const f=fixture();f.value.counts.setup_slots=1;const census=validateNativeCapacityCensus(f.value,{now});
 const p=nativeCapacityProjection({census,configuredCeiling:3,resourceCeiling:3,localTaskCount:2,localRevision:4});
 assert.equal(p.occupied_task_slots,2);assert.equal(p.occupied_setup_slots,1);assert.equal(p.free_slots,0);assert.equal(p.configured_ceiling,3);
 assert.equal(nativeCapacityProjection({census,configuredCeiling:5,resourceCeiling:4,localTaskCount:2,localRevision:4}).free_slots,1);
});
test('empty Main maps start RECOVERY_REQUIRED, not optimistic capacity after restart',()=>{
 const p=nativeCapacityProjection({configuredCeiling:16,resourceCeiling:16,localTaskCount:0,localRevision:0});assert.equal(p.state,'RECOVERY_REQUIRED');assert.equal(p.free_slots,0);validateNativeCapacityProjection(p);
});
