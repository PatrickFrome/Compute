import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {MATERIALS} from '../src/education-library.mjs';
import {lessonDepth,SUBJECT_DEPTH,ALLOWED_RESOURCE_URLS} from '../src/education-lesson-depth.mjs';
import {buildEducationHandoff,HANDOFF_SCHEMA} from '../src/education-handoff.mjs';

test('all 120 lessons have technical goal, four explained terms, domain extension, pitfalls, and sources',()=>{
  assert.equal(SUBJECT_DEPTH.length,15);
  for(const material of MATERIALS){
    const d=lessonDepth(material);
    assert.equal(d.glossary.length,4);
    assert.ok(d.glossary.every(g=>g.term.length>1&&g.meaning.length>30));
    assert.ok(d.objective.length>35);
    assert.ok(d.extension.length>145);
    assert.ok(d.commonMistake.length>40);
    assert.ok(d.reflection.length>30);
    assert.ok(d.references.length>=1);
    assert.ok(d.references.every(r=>ALLOWED_RESOURCE_URLS.includes(r.url)&&r.url.startsWith('https://')));
  }
});
test('in-depth worked physical concept for voltage, OTDR, splicing and link budget',()=>{
  for(const id of ['material-03-01','material-10-06','material-11-05','material-06-08']){
    const m=MATERIALS.find(x=>x.id===id);
    assert.ok(m.depth.spotlight?.text.length>450,id);
    assert.ok(m.depth.spotlight.title.length>12);
  }
});
test('official GPT handoff is bounded, educational, only checked counts, and requires user Send',()=>{
  const m=MATERIALS.find(x=>x.id==='material-10-06');
  const h=buildEducationHandoff(m.id,[{
    subject:m.subject,distinct_correct_answers:2,practice_questions:2,
    attempts:6,self_reported_labs:1,private_notes:'SECRET_UNTRUSTED'
  }]);
  assert.equal(h.schema,HANDOFF_SCHEMA);
  assert.equal(h.material_id,m.id);
  assert.equal(h.includes_private_notes,false);
  assert.equal(h.sends_automatically,false);
  assert.ok(h.character_count>=1800&&h.character_count<=12000);
  assert.match(h.text,/СЛОВАРЬ ТЕРМИНОВ/);
  assert.match(h.text,/Локальные результаты/);
  assert.match(h.text,/вставляю и отправляю/);
  assert.ok(!h.text.includes('SECRET_UNTRUSTED'));
});
test('handoff rejects forged materials and does not infer certification from attempts',()=>{
  assert.throws(()=>buildEducationHandoff('material-999999'),/education_material_unknown/);
  const result=buildEducationHandoff('material-03-01');
  assert.match(result.text,/никогда не объявляй навык освоенным/i);
});
test('Education native preload grants explicit user-choice integrations, not page scraping or Send',async()=>{
  const root=new URL('../src/',import.meta.url);
  const preload=await fs.readFile(new URL('education-preload.cjs',root),'utf8');
  const main=await fs.readFile(new URL('main.mjs',root),'utf8');
  const surface=await fs.readFile(new URL('chat-surface.mjs',root),'utf8');
  assert.ok(preload.includes('launchExternalGPT')&&preload.includes('copyHandoff'));
  assert.ok(preload.includes('chatHealth'));
  assert.ok(!preload.includes("ipcRenderer.invoke('devfleet:read'")&&
    !preload.includes("ipcRenderer.invoke('devfleet:assign'"));
  assert.match(main,/await shell\.openExternal\('https:\/\/chatgpt\.com\/'\)/);
  assert.match(main,/ALLOWED_RESOURCE_URLS\.includes\(url\)/);
  assert.match(surface,/javascript:true/);
  assert.match(surface,/webSecurity:true/);
});
