import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EducationStore, EDUCATION_SCHEMA, SUBJECTS } from '../src/education-core.mjs';

function memoryDisk(start=null){
  let data=start;
  return {load:async()=>data===null?null:structuredClone(data),
    save:async value=>{data=structuredClone(value);},get:()=>structuredClone(data)};
}
test('seeds fifteen disciplines and redacts answer keys from renderer',async()=>{
  const disk=memoryDisk(),education=new EducationStore(disk);
  await education.init();
  const state=education.snapshot();
  assert.equal(state.schema,EDUCATION_SCHEMA);
  assert.equal(state.folders.length,SUBJECTS.length);
  assert.equal(state.attempts.length,0);
  assert.equal(state.mastered.length,0);
  assert.ok(state.questions.some(q=>q.id==='ohm'));
  assert.ok(state.questions.every(q=>!Object.hasOwn(q,'correct')&&!Object.hasOwn(q,'explanation')));
});
test('preserves nested subjects, binds only owned live tabs and restores across instances',async()=>{
  const disk=memoryDisk(),education=new EducationStore(disk);await education.init();
  const f=await education.addFolder({parent_id:'subject-3',title:'Практика'});
  assert.equal(f.parent_id,'subject-3');
  await assert.rejects(education.bindChat({folder_id:f.id,tab_id:'tab-1',title:'Lesson'},[]),/education_chat_binding_invalid/);
  const chat=await education.bindChat({folder_id:f.id,tab_id:'tab_00000000-0000-4000-8000-000000000001',title:'Lesson'},['tab_00000000-0000-4000-8000-000000000001']);
  assert.equal(chat.folder_id,f.id);
  await assert.rejects(education.bindChat({folder_id:f.id,tab_id:'tab_00000000-0000-4000-8000-000000000001',title:'Duplicate'},['tab_00000000-0000-4000-8000-000000000001']),/education_tab_already_bound/);
  const restarted=new EducationStore(disk);await restarted.init();
  assert.ok(restarted.snapshot().chats.some(c=>c.id===chat.id));
  assert.ok(restarted.snapshot().folders.some(x=>x.id===f.id));
});
test('assessments mark only correct verified answers and persist attempts',async()=>{
  const disk=memoryDisk(),education=new EducationStore(disk);await education.init();
  const wrong=await education.submitAnswer({question_id:'ohm',choice:0});
  assert.equal(wrong.passed,false);
  assert.deepEqual(education.snapshot().mastered,[]);
  const right=await education.submitAnswer({question_id:'ohm',choice:1});
  assert.equal(right.passed,true);
  assert.deepEqual(education.snapshot().mastered,['ohm']);
  assert.equal(education.snapshot().attempts.length,2);
  const restarted=new EducationStore(disk);await restarted.init();
  assert.deepEqual(restarted.snapshot().mastered,['ohm']);
});
test('rejects invalid actions without mutating saved state',async()=>{
  const disk=memoryDisk(),education=new EducationStore(disk);await education.init();
  const before=JSON.stringify(disk.get());
  await assert.rejects(education.addFolder({parent_id:'absent',title:'A'}),/education_parent_not_found/);
  await assert.rejects(education.addFolder({parent_id:'subject-2',title:' '}),/education_title_invalid/);
  await assert.rejects(education.submitAnswer({question_id:'ohm',choice:99}),/education_assessment_invalid/);
  await assert.rejects(education.submitAnswer({question_id:'untrusted',choice:0}),/education_assessment_invalid/);
  assert.equal(JSON.stringify(disk.get()),before);
});
test('fails closed on malformed or cyclic persisted hierarchy',async()=>{
  const bad={schema:EDUCATION_SCHEMA,folders:[{id:'a',parent_id:'b',title:'A'},{id:'b',parent_id:'a',title:'B'}],chats:[],attempts:[]};
  await assert.rejects(new EducationStore(memoryDisk(bad)).init(),/education_folder_cycle/);
});
test('parallel updates are serialized without losing writes',async()=>{
  const education=new EducationStore(memoryDisk());await education.init();
  await Promise.all(Array.from({length:12},(_,i)=>education.addFolder({parent_id:'subject-3',title:'Модуль '+i})));
  assert.equal(education.snapshot().folders.length,SUBJECTS.length+12);
});
