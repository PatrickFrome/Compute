import test from 'node:test';
import assert from 'node:assert/strict';
import { MATERIALS, MATERIAL_SCHEMA,discussionPrompt } from '../src/education-library.mjs';
import { EducationStore, SUBJECTS } from '../src/education-core.mjs';
const memory=()=>{let store=null;return {
  load:async()=>store===null?null:structuredClone(store),
  save:async value=>{store=structuredClone(value);}
};};
test('120 distinct seeded study chats: exactly eight per each of 15 disciplines',()=>{
  assert.equal(MATERIALS.length,120);
  assert.equal(new Set(MATERIALS.map(x=>x.id)).size,120);
  for(let i=0;i<SUBJECTS.length;i++){
    assert.equal(MATERIALS.filter(m=>m.subject===i).length,8);
    assert.equal(MATERIALS.filter(m=>m.subject===i)[0].position,1);
  }
  assert.equal(MATERIAL_SCHEMA,'devfleet.education.materials.v1');
});
test('every authored chat has an original explanation, example, exercise, question and non-GPT provenance',()=>{
  for(const m of MATERIALS){
    for(const field of ['title','theory','example','exercise','check'])
      assert.ok(typeof m[field]==='string'&&m[field].length>=10,field+' '+m.id);
    assert.equal(m.assistant_status,'curated_study_material_not_gpt');
    assert.equal(m.read_only,true);
  }
});
test('study prompts require independent verification and safe practices',()=>{
  const m=MATERIALS.find(x=>x.id==='material-10-06');
  assert.match(m.title,/аппарат/i);
  const prompt=discussionPrompt(m);
  assert.match(prompt,/термин/);
  assert.match(prompt,/перепровер/);
  assert.match(prompt,/безопасн/);
  assert.ok(prompt.includes(m.theory));
  assert.throws(()=>discussionPrompt({id:'fabricated'}),/education_material_unknown/);
});
test('seeded chat catalog survives new store without creating native GPT tabs or fake attempts',async()=>{
  const s=new EducationStore(memory());const initial=await s.init();
  assert.equal(initial.materials.length,120);
  assert.equal(initial.chats.length,0);
  assert.equal(initial.attempts.length,0);
  assert.equal(initial.materials_schema,MATERIAL_SCHEMA);
});
test('bind a material to one genuine owned native tab in a matching subject',async()=>{
  const s=new EducationStore(memory());await s.init();
  const tab='tab_00000000-0000-4000-8000-000000000001';
  const p={folder_id:'subject-10',tab_id:tab,title:'Вопросы по сварке',material_id:'material-10-06'};
  await assert.rejects(s.bindChat(p,[]),/education_chat_binding_invalid/);
  const bound=await s.bindChat(p,[tab]);
  assert.equal(bound.material_id,p.material_id);
  assert.equal(s.snapshot().chats.length,1);
  const tab2='tab_00000000-0000-4000-8000-000000000002';
  await assert.rejects(s.bindChat({...p,tab_id:tab2},[tab2]),/education_tab_already_bound/);
  assert.equal(s.snapshot().chats.length,1);
});
test('wrong-discipline / forged material cannot be linked to GPT tab',async()=>{
  const s=new EducationStore(memory());await s.init();
  const tab='tab_00000000-0000-4000-8000-000000000003';
  await assert.rejects(s.bindChat({folder_id:'subject-2',tab_id:tab,
    title:'Wrong',material_id:'material-10-06'},[tab]),/education_chat_binding_invalid/);
  await assert.rejects(s.bindChat({folder_id:'subject-10',tab_id:tab,
    title:'Fake',material_id:'material-10-99'},[tab]),/education_chat_binding_invalid/);
});
test('catalog read-only remains independent from changing quizzes and student notes',async()=>{
  const s=new EducationStore(memory());await s.init();
  await s.addNote({lesson_id:'s10-1',text:'Личный учебный конспект'});
  await s.submitAnswer({question_id:'splice',choice:0});
  const state=s.snapshot();
  assert.equal(state.materials.length,120);
  assert.ok(!JSON.stringify(state.materials).includes('Личный учебный конспект'));
  assert.ok(!JSON.stringify(state.materials).includes('tab_'));
});
