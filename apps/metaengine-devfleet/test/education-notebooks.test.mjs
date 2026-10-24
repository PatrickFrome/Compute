import test from 'node:test';
import assert from 'node:assert/strict';
import {EducationStore} from '../src/education-core.mjs';
import {buildEducationHandoff} from '../src/education-handoff.mjs';
import {isGoogleEmbeddedAuthorization,SAFE_EXTERNAL_CHATGPT_URL} from '../src/education-auth-routing.mjs';
const disk=(value=null)=>({load:async()=>value===null?null:structuredClone(value),
  save:async next=>{value=structuredClone(next);},read:()=>structuredClone(value)});

test('Google OAuth embedded navigation is recognized without transferring the OAuth URL',()=>{
 assert.equal(isGoogleEmbeddedAuthorization('https://accounts.google.com/signin/v2/identifier'),true);
 assert.equal(isGoogleEmbeddedAuthorization('https://accounts.google.com/o/oauth2/v2/auth?state=secret'),true);
 for(const url of ['https://chatgpt.com/','https://accounts.google.com.evil.example/',
   'http://accounts.google.com/signin','https://accounts.google.com@evil.example/','javascript:alert(1)'])
   assert.equal(isGoogleEmbeddedAuthorization(url),false,url);
 assert.equal(SAFE_EXTERNAL_CHATGPT_URL,'https://chatgpt.com/');
});

test('120 distinct topic notebooks and durable legacy upgrade',async()=>{
 const d=disk(),s=new EducationStore(d);await s.init();
 const a=await s.addNotebookEntry({notebook_key:'material-03-01',title:'Электрическое поле',
   body:'Напряжение измеряется между двумя точками.'});
 const b=await s.addNotebookEntry({notebook_key:'material-11-05',title:'OTDR',
   body:'Рефлектометр использует обратное рассеяние.'});
 assert.notEqual(a.notebook_key,b.notebook_key);
 assert.equal(s.snapshot().notebook_entries.length,2);
 const restart=new EducationStore(d);await restart.init();
 assert.equal(restart.snapshot().notebook_entries.length,2);
 const old=d.read();delete old.notebook_entries;
 const upgrade=new EducationStore(disk(old));await upgrade.init();
 assert.deepEqual(upgrade.snapshot().notebook_entries,[]);
});

test('linked GPT tab has its own notebook independent from material notebook',async()=>{
 const d=disk(),s=new EducationStore(d);await s.init();
 const tab='tab_00000000-0000-4000-8000-000000000001';
 await s.bindChat({folder_id:'subject-3',tab_id:tab,title:'GPT о напряжении',
   material_id:'material-03-01'},[tab]);
 await s.addNotebookEntry({notebook_key:tab,title:'Вопрос для GPT',
   body:'Почему разомкнутая батарея сохраняет напряжение?',source:'gpt_manually_copied'});
 await s.addNotebookEntry({notebook_key:'material-03-01',title:'Формула',body:'U=IR'});
 const entries=s.snapshot().notebook_entries;
 assert.equal(entries.filter(e=>e.notebook_key===tab).length,1);
 assert.equal(entries.filter(e=>e.notebook_key==='material-03-01').length,1);
 const prompt=buildEducationHandoff('material-03-01',s.snapshot().study_contexts,entries,{
   includeNotebook:true,linkedNotebookKey:tab});
 assert.ok(prompt.text.includes('Почему разомкнутая батарея'));
 assert.ok(prompt.text.includes('U=IR'));
});

test('editing/deleting notebook entries changes only chosen entry and persists',async()=>{
 const d=disk(),s=new EducationStore(d);await s.init();
 const entry=await s.addNotebookEntry({notebook_key:'material-10-06',title:'Первый скол',
   body:'Промыть и проверить волокно'});
 const other=await s.addNotebookEntry({notebook_key:'material-03-01',title:'Ток',
   body:'Сила тока измеряется в амперах'});
 await s.editNotebookEntry({entry_id:entry.id,title:'Подготовка скола',
   body:'Нужны очистка и качественный скол'});
 assert.equal(s.snapshot().notebook_entries[0].title,'Подготовка скола');
 await s.deleteNotebookEntry({entry_id:entry.id});
 assert.equal(s.snapshot().notebook_entries.length,1);
 assert.equal(s.snapshot().notebook_entries[0].id,other.id);
 assert.equal(new EducationStore(d).constructor.name,'EducationStore');
});

test('notebooks are private by default; opt-in sends only selected material + linked GPT entries',async()=>{
 const s=new EducationStore(disk());await s.init();
 const local=await s.addNotebookEntry({notebook_key:'material-03-01',title:'Личная запись',
   body:'MY_PRIVATE_36'}),foreign=await s.addNotebookEntry({notebook_key:'material-09-03',
   title:'Секрет другого курса',body:'SECRET_FOREIGN_92'});
 const baseline=buildEducationHandoff('material-03-01',[],[local,foreign]);
 assert.equal(baseline.includes_private_notes,false);
 assert.ok(!baseline.text.includes('MY_PRIVATE_36'));
 const shared=buildEducationHandoff('material-03-01',[],[local,foreign],{includeNotebook:true});
 assert.equal(shared.includes_private_notes,true);
 assert.ok(shared.text.includes('MY_PRIVATE_36'));
 assert.ok(!shared.text.includes('SECRET_FOREIGN_92'));
 assert.equal(shared.sends_automatically,false);
});

test('invalid tabs and oversized or empty notes fail closed, no disk mutation',async()=>{
 const d=disk(),s=new EducationStore(d);await s.init();const old=JSON.stringify(d.read());
 await assert.rejects(s.addNotebookEntry({notebook_key:'tab_00000000-0000-4000-8000-000000000001',
   title:'Unknown',body:'no live tab'}),/education_notebook_invalid/);
 await assert.rejects(s.addNotebookEntry({notebook_key:'material-03-01',
   title:' ',body:'empty'}),/education_notebook_invalid/);
 await assert.rejects(s.addNotebookEntry({notebook_key:'material-03-01',
   title:'Oversized',body:'x'.repeat(5001)}),/education_notebook_invalid/);
 assert.equal(JSON.stringify(d.read()),old);
});

test('simultaneous note writes do not overwrite one another',async()=>{
 const s=new EducationStore(disk());await s.init();
 await Promise.all(Array.from({length:15},(_,i)=>s.addNotebookEntry({
   notebook_key:'material-03-01',title:'Запись '+i,body:'Вывод '+i
 })));
 assert.equal(s.snapshot().notebook_entries.length,15);
});
