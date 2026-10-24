import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { LESSONS, CURRICULUM_VERSION, subjectForFolder } from '../src/curriculum.mjs';
import { EducationStore, SUBJECTS, EDUCATION_SCHEMA } from '../src/education-core.mjs';

function disk(initial=null) {
  let value=initial;
  return {load:async()=>value===null?null:structuredClone(value),
    save:async next=>{value=structuredClone(next);},get:()=>structuredClone(value)};
}
test('curriculum has 30 distinct lessons covering fifteen disciplines with valid prerequisites',()=>{
  assert.equal(LESSONS.length,30);
  assert.match(CURRICULUM_VERSION,/2026/);
  const all=new Set(LESSONS.map(x=>x.id));
  assert.equal(all.size,LESSONS.length);
  for(let subject=0;subject<SUBJECTS.length;subject++)
    assert.equal(LESSONS.filter(l=>l.subject===subject).length,2);
  for(const lesson of LESSONS){
    assert.ok(lesson.prerequisites.every(p=>all.has(p)));
    assert.ok(!lesson.prerequisites.includes(lesson.id));
  }
});
test('nested folders resolve to the right discipline',()=>{
  const folders=[{id:'subject-3',parent_id:null},
    {id:'custom1',parent_id:'subject-3'},{id:'custom2',parent_id:'custom1'}];
  assert.equal(subjectForFolder('custom2',folders),3);
  assert.equal(subjectForFolder('nonexistent',folders),null);
});
test('notes persist but do not independently mark mastery',async()=>{
  const d=disk(),a=new EducationStore(d);await a.init();
  const added=await a.addNote({lesson_id:'s3-1',text:'Я понял разницу между током и напряжением.'});
  assert.equal(added.lesson_id,'s3-1');
  assert.deepEqual(a.snapshot().mastered,[]);
  const restarted=new EducationStore(d);await restarted.init();
  assert.equal(restarted.snapshot().notes[0].text,added.text);
});
test('unknown lessons and oversized notes fail without modifying persisted state',async()=>{
  const d=disk(),a=new EducationStore(d);await a.init();
  const original=JSON.stringify(d.get());
  await assert.rejects(a.addNote({lesson_id:'fake',text:'hello'}),/education_note_invalid/);
  await assert.rejects(a.addNote({lesson_id:'s3-1',text:'x'.repeat(4001)}),/education_note_invalid/);
  assert.equal(JSON.stringify(d.get()),original);
});
test('persisted duplicate GPT tabs are rejected',async()=>{
  const d=disk(),a=new EducationStore(d);await a.init();
  const value=d.get();
  value.chats=[
    {id:'first',folder_id:'subject-3',tab_id:'tab_00000000-0000-4000-8000-000000000001',title:'One'},
    {id:'second',folder_id:'subject-3',tab_id:'tab_00000000-0000-4000-8000-000000000001',title:'Two'}
  ];
  await assert.rejects(new EducationStore(disk(value)).init(),/education_chat_invalid/);
});
test('Education HTML uses a parseable renderer and only allowed IPC capabilities',async()=>{
  const path=new URL('../src/',import.meta.url);
  const html=await readFile(new URL('education.html',path),'utf8');
  const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);new vm.Script(script);
  const preload=await readFile(new URL('education-preload.cjs',path),'utf8');
  for(const prohibited of ['devfleet:assign','devfleet:read','devconsole:'])
    assert.ok(!preload.includes("'"+prohibited+"'")&&!preload.includes('"'+prohibited+'"'));

  for(const prohibited of ['child_process','eval('])assert.ok(!preload.includes(prohibited));
  for(const required of ['education:snapshot','education:add-note','devfleet:create','devfleet:select'])
    assert.ok(preload.includes(required));
  const main=await readFile(new URL('main.mjs',path),'utf8');
  assert.match(main,/educationMode\?'education-preload\.cjs':'preload\.cjs'/);
  assert.match(main,/if\(!educationMode\)await listenLocal\(\)/);
  assert.match(main,/education-state\.json/);
});
