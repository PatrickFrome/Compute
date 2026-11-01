import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {normalizeClientProjectSnapshot} from '../src/client-project-continuity.mjs';

function snapshot(){
  const project_id=randomUUID(),root_task_id=randomUUID();
  const task={task_id:root_task_id,parent_task_id:null,depth:0,state:'RUNNING',role:'IMPLEMENTER'};
  return {schema:'metaengine.devos.project-snapshot.v1',found:true,project_id,root_task_id,request_id:randomUUID(),
    state:'ACTIVE',goal:'Retain authoritative project control',last_seq:1,total_tasks:1,tasks:[task],selected_task:task,
    immediate_children:[],task_cursor:{after_seq:0,next_seq:1,has_more:false},authority_effect:false};
}

for(const state of ['ACTIVE','WAITING_CHILDREN','BLOCKED'])test(`PAUSED control survives ${state} execution aggregate and repeated normalization`,()=>{
  const raw={...snapshot(),state,control_state:'PAUSED'};
  const value=normalizeClientProjectSnapshot(raw,{project_id:raw.project_id});
  assert.equal(value.state,state);assert.equal(value.control_state,'PAUSED');assert.equal(value.selected_task.state,'RUNNING');
  assert.deepEqual(normalizeClientProjectSnapshot(value,{project_id:raw.project_id}),value);
});

for(const control_state of ['ACTIVE','COMPLETED'])test(`stored ${control_state} control is independent of task execution`,()=>{
  const value=normalizeClientProjectSnapshot({...snapshot(),control_state});
  assert.equal(value.control_state,control_state);assert.equal(value.state,'ACTIVE');assert.equal(value.selected_task.state,'RUNNING');
});

test('an older project producer leaves control unknown through repeated normalization',()=>{
  const value=normalizeClientProjectSnapshot(snapshot());assert.equal(value.control_state,null);
  assert.equal(normalizeClientProjectSnapshot(value).control_state,null);
});

for(const control_state of ['STOPPED','FENCED','paused','',false,0,{},[],undefined])test(`malformed supplied project control is rejected: ${JSON.stringify(control_state)}`,()=>{
  assert.throws(()=>normalizeClientProjectSnapshot({...snapshot(),control_state}),/client_project_snapshot_control_state_invalid/);
});

test('not-found snapshot does not gain inferred project control',()=>{
  const raw={schema:'metaengine.devos.project-snapshot.v1',found:false,control_state:'FENCED',authority_effect:false};
  assert.deepEqual(normalizeClientProjectSnapshot(raw),{schema:raw.schema,found:false,automatic_retry_allowed:false,authority_effect:false});
});
