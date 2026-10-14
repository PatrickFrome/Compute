import test from 'node:test';
import assert from 'node:assert/strict';
import {proposeCodingWave} from '../src/pipeline-wave-plan.mjs';
const sha='4c867e7d4c2c7b05fa02dff39409747f4124d7a3';
const tab=i=>'tab_00000000-0000-4000-8000-'+String(i).padStart(12,'0');
const task=(i,role='implementer',state='PENDING')=>({
 task_id:'mass-wave-task-'+String(i).padStart(3,'0'),
 request_id:'mass-wave-request-'+String(i).padStart(3,'0'),
 role,state,depends_on:[],source_sha:sha,priority:50-i,created_seq:i,effect_scope:'CODE_ONLY'});
const base=()=>({source_sha:sha,tasks:[task(1),task(2,'critic'),task(3,'researcher'),task(4)],
 open_tab_ids:[tab(1),tab(2),tab(3),tab(4)],
 retiring_tab_ids:[tab(2),tab(3)],free_ram_mb:1800});
test('reclaimed hot slots admit bounded independent coding work with no effects',()=>{
 const x=proposeCodingWave(base());
 assert.equal(x.state,'PROPOSED_ONLY');assert.equal(x.capacity,2);
 assert.equal(x.selected.length,2);assert.equal(x.authority_effect,false);
 assert.equal(x.dispatch_performed,false);assert.equal(x.projected_hot_tabs,2);
});
test('4 hot tabs and no retirements imply no extra admissions',()=>{
 const x=proposeCodingWave({...base(),retiring_tab_ids:[]});
 assert.equal(x.capacity,0);assert.equal(x.selected.length,0);
});
test('low memory fences growth even when there are free slots',()=>{
 const x=proposeCodingWave({...base(),open_tab_ids:[],retiring_tab_ids:[],free_ram_mb:600});
 assert.equal(x.capacity,0);
});
test('old unknown requests, unsafe effects and unproven deps cannot be selected',()=>{
 const t1=task(1),t2=task(2),t3=task(3),t4=task(4);
 t2.effect_scope='EXTERNAL_EFFECT';t3.depends_on=[t4.task_id];t4.state='UNKNOWN';
 const x=proposeCodingWave({...base(),open_tab_ids:[],retiring_tab_ids:[],
  tasks:[t1,t2,t3,t4],historical_request_ids:[t1.request_id]});
 assert.equal(x.selected.length,0);
 assert.equal(x.blocked.find(y=>y.task_id===t1.task_id).reason,'REQUEST_ID_ALREADY_USED');
 assert.equal(x.blocked.find(y=>y.task_id===t2.task_id).reason,'EXTERNAL_EFFECT_FORBIDDEN');
 assert.equal(x.blocked.find(y=>y.task_id===t3.task_id).reason,'DEPENDENCY_NOT_PROVEN_DONE');
});
test('mismatched source and duplicate identity fail closed',()=>{
 const t1=task(1);const t2=task(2);t1.source_sha='a'.repeat(40);
 assert.equal(proposeCodingWave({...base(),tasks:[t1,t2]}).blocked[0].reason,'SOURCE_SHA_MISMATCH');
 assert.throws(()=>proposeCodingWave({...base(),tasks:[t2,t2]}),/identity_conflict/);
 assert.throws(()=>proposeCodingWave({...base(),retiring_tab_ids:[tab(8)]}),/retiring_tab_ids_invalid/);
});
