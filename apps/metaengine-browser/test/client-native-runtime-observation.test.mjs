import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {projectNativeRuntimeObservation as project} from '../src/client-native-runtime-observation.mjs';
import {projectOwnPostgresClientConnection} from '../src/client-native-trust-boundary.mjs';
const task='11111111-1111-4111-8111-111111111111';
const snapshot=()=>({schema:'metaengine.native-coding.runtime.v1',authority_effect:false,scheduler_authority:false,automatic_retry_allowed:false,
 production_qualified:false,useful_work_verified:false,logical_agent_limit:null,logical_work_owned_by:'W30',closed:false,
 physical_slot_budget:8,occupied_slots:2,jobs:[{task_id:task,lease_generation:1,state:'RUNNING'},{task_id:task,lease_generation:2,state:'READBACK_REQUIRED'}],
 secret:'never-expose-private',project_commits:{private_path:'/private/key'}});
const options={localProviderAttested:true,now:Date.parse('2026-10-29T00:00:00Z')};
test('native observation exposes only retained record counts and no execution authority or private identities',()=>{
 const value=project(snapshot(),options);assert.equal(value.state,'OBSERVED');assert.equal(value.retained_records,2);
 assert.deepEqual(value.counts,{preparing:0,running:1,result_ready:0,readback_required:1,other:0});
 assert.equal(value.physical_execution_proven,false);assert.equal(value.authority_effect,false);assert.equal(value.logical_agent_limit,null);
 assert.doesNotMatch(JSON.stringify(value),/never-expose|private_path|11111111|task_id/);assert.ok(Object.isFrozen(value.counts));
});
test('unbound, unavailable, malformed and untrusted runtime observations never become zero or ready',()=>{
 assert.equal(project(null,options).state,'UNBOUND');assert.equal(project(undefined,options).state,'UNAVAILABLE');
 assert.equal(project(snapshot(),{...options,localProviderAttested:false}).state,'UNAVAILABLE');
 for(const change of [{authority_effect:true},{occupied_slots:3},{physical_slot_budget:0},{jobs:[snapshot().jobs[0],snapshot().jobs[0]]}])assert.equal(project({...snapshot(),...change},options).state,'UNAVAILABLE');
 assert.equal(project(snapshot(),{...options,now:Infinity}).state,'UNAVAILABLE');
});
test('unknown record states remain counted without becoming accepted work',()=>{
 const s=snapshot();s.jobs[0].state='REFUSED';s.closed=true;const v=project(s,options);
 assert.equal(v.closed,true);assert.equal(v.counts.other,1);assert.equal(v.useful_work_verified,false);
});
test('actual main connection-status reader uses its owned native runtime and isolates snapshot failure',async()=>{
 const source=await fs.readFile(new URL('../src/main.mjs',import.meta.url),'utf8');
 const start=source.indexOf('function readClientConnectionStatus() {'),end=source.indexOf("ipcMain.handle('metaengine:client:connection-status'",start);assert.ok(start>0&&end>start);
 const context={nativeSupervisor:{connectionStatus:()=>({local_runtime_ready:true,access_tier:'ADMIN',admin_ready:true})},
  explicitLocalSupervisorBase:()=> 'http://127.0.0.1:9999',nativeCodingRuntime:{snapshot},projectOwnPostgresClientConnection};
 const read=vm.runInNewContext(source.slice(start,end)+'\nreadClientConnectionStatus',context);
 assert.equal(read().native_runtime.retained_records,2);assert.equal(read().admin_ready,true);
 context.nativeCodingRuntime={snapshot:()=>{throw Error('secret');}};const failed=read();assert.equal(failed.native_runtime.state,'UNAVAILABLE');assert.equal(failed.admin_ready,true);
 context.nativeCodingRuntime=null;assert.equal(read().native_runtime.state,'UNBOUND');
 context.explicitLocalSupervisorBase=()=>null;assert.equal(read().native_runtime.state,'UNAVAILABLE');
});

test('supervisor-supplied native observations cannot substitute for owned runtime memory',()=>{
 const raw={local_runtime_ready:true,admin_ready:true,native_runtime:snapshot()};
 const value=projectOwnPostgresClientConnection(raw,{localProviderAttested:true});
 assert.equal(value.native_runtime.state,'UNAVAILABLE');
 assert.equal(value.native_runtime.observed_at,null);
 assert.equal(value.native_runtime.retained_records,null);
});
