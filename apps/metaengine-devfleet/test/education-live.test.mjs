import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {LiveLessonStore,LiveLessonCoordinator,validateLessonAnswer,buildLiveContext} from '../src/education-live-core.mjs';
import {EducationStore} from '../src/education-core.mjs';
import {MATERIALS} from '../src/education-library.mjs';
const A='material-03-01',B='material-11-05';
function disk(initial=null){let data=initial,fail=false;return {
 load:async()=>data===null?null:structuredClone(data),
 save:async value=>{if(fail)throw Error('disk_unavailable');data=structuredClone(value);},
 get:()=>structuredClone(data),setFail:v=>{fail=v;}
};}
const answer=(text='Новый пример',field='example')=>({reply:'Объяснение для ученика',change_summary:'Уточнён пример',edits:[{field,text}]});
async function setup(complete=async()=>answer()){
 const d=disk(),store=new LiveLessonStore(d),ed=new EducationStore(disk());await store.init();await ed.init();
 const calls=[];const transport={status:()=>({ready:true}),complete:async p=>{calls.push(p);return complete(p);}};
 return {d,store,ed,calls,transport,c:new LiveLessonCoordinator({store,education:ed,transport})};
}
function request(store,id=A,extras={}){return {material_id:id,request_id:crypto.randomUUID(),text:'Добавь понятный пример и обнови урок',expected_revision:store.topic(id).revision,allow_edits:true,...extras};}

test('Live topics open locally without a network call or phantom message',async()=>{
 const s=await setup();for(const m of MATERIALS){const t=s.store.topic(m.id);assert.equal(t.turns.length,0);assert.equal(t.version,0);}
 assert.equal(s.calls.length,0);assert.equal(s.d.get(),null);
});
test('One response updates only requested page; base, citations and notebooks remain unchanged',async()=>{
 const s=await setup();const base=structuredClone(MATERIALS),beforeB=s.store.material(B);
 const r=await s.c.send(request(s.store));assert.equal(r.applied,true);
 assert.equal(s.store.material(A).example,'Новый пример');assert.equal(s.store.topic(A).version,1);
 assert.deepEqual(s.store.material(B),beforeB);assert.deepEqual(MATERIALS,base);
 assert.deepEqual(s.ed.snapshot().notebook_entries,[]);assert.equal(s.store.topic(A).turns.length,2);
 assert.equal(s.store.material(A).dynamic.source_claims_verified,false);
});
test('History and changed pages survive restart and remain isolated by topic',async()=>{
 const s=await setup();await s.c.send(request(s.store));await s.c.send(request(s.store,B,{text:'Поясни OTDR'}));
 const reboot=new LiveLessonStore(s.d);await reboot.init();assert.equal(reboot.topic(A).turns.length,2);
 assert.equal(reboot.topic(B).turns.length,2);assert.equal(reboot.topic(A).turns[0].text,'Добавь понятный пример и обнови урок');
 assert.equal(reboot.topic(B).turns[0].text,'Поясни OTDR');assert.equal(reboot.material(A).example,'Новый пример');
});
test('Repeated Undo restores successive page versions but keeps all conversations',async()=>{
 let n=0;const s=await setup(async()=>answer('Версия '+(++n))),base=s.store.material(A).example;
 await s.c.send(request(s.store));await s.c.send(request(s.store));
 await s.store.undo({material_id:A,expected_revision:s.store.topic(A).revision});assert.equal(s.store.material(A).example,'Версия 1');
 await s.store.undo({material_id:A,expected_revision:s.store.topic(A).revision});assert.equal(s.store.material(A).example,base);
 assert.equal(s.store.topic(A).turns.length,4);assert.equal(s.store.topic(A).can_undo,false);
});
test('Stale revision rejected before provider invocation; replay is never sent twice',async()=>{
 const s=await setup(),p=request(s.store);await s.c.send(p);
 await assert.rejects(s.c.send(p),/live_request_seen/);assert.equal(s.calls.length,1);
 await assert.rejects(s.c.send({...p,request_id:crypto.randomUUID()}),/live_stale_revision/);assert.equal(s.calls.length,1);
});
test('Without configured key/billing no outbound request and no user turn is saved',async()=>{
 const s=await setup();s.transport.status=()=>({ready:false});
 await assert.rejects(s.c.send(request(s.store)),/live_not_connected/);
 assert.equal(s.calls.length,0);assert.equal(s.store.topic(A).turns.length,0);assert.equal(s.d.get(),null);
});
test('Discussion-only mode keeps page unchanged even when model suggests an edit',async()=>{
 const s=await setup(),before=s.store.material(A);const r=await s.c.send(request(s.store,A,{allow_edits:false}));
 assert.equal(r.applied,false);assert.deepEqual(s.store.material(A),before);assert.equal(s.store.topic(A).turns.length,2);
});
test('Wrong edit fields, duplicates, oversized text and extra properties are rejected atomically',async()=>{
 for(const bad of [answer('bad','sources'),{...answer(),extra:'x'},
   {...answer(),edits:[{field:'example',text:'x'},{field:'example',text:'y'}]},answer('x'.repeat(8001))]){
  assert.throws(()=>validateLessonAnswer(bad),/live_answer_invalid/);
  const s=await setup(async()=>bad),before=s.store.material(A);
  await assert.rejects(s.c.send(request(s.store)),/live_answer_invalid/);assert.deepEqual(s.store.material(A),before);
  assert.equal(s.store.topic(A).requests.at(-1).state,'UNKNOWN');
 }
});
test('HTML-like model output remains plain text and cannot become executable authority',async()=>{
 const payload='<img src=x onerror=alert(1)><script>window.bad=true</script>';
 const s=await setup(async()=>answer(payload));await s.c.send(request(s.store));assert.equal(s.store.material(A).example,payload);
 assert.equal(s.store.topic(A).revisions.at(-1).origin,'gpt_unverified');
});
test('Slow topic A response cannot write B, and duplicate A call is fenced while pending',async()=>{
 let resolve;const wait=new Promise(r=>{resolve=r;});const s=await setup(async({context})=>context.material_id===A?wait:answer('OTDR пример'));
 const first=s.c.send(request(s.store));await new Promise(r=>setTimeout(r,10));
 await assert.rejects(s.c.send(request(s.store)),/live_topic_busy/);
 await s.c.send(request(s.store,B));resolve(answer('Напряжение пример'));await first;
 assert.equal(s.store.material(A).example,'Напряжение пример');assert.equal(s.store.material(B).example,'OTDR пример');
});
test('Interrupted PENDING requests become UNKNOWN on restart without provider invocation',async()=>{
 const s=await setup(),p=request(s.store);await s.store.begin(p);
 const reboot=new LiveLessonStore(s.d);await reboot.init();assert.equal(reboot.topic(A).requests[0].state,'UNKNOWN');
 assert.equal(s.calls.length,0);await assert.rejects(reboot.begin(p),/live_request_seen/);
});
test('Network error is redacted, cannot change page, and is not retried',async()=>{
 const s=await setup(async()=>{throw Error('secret-header-or-credential');}),before=s.store.material(A);
 await assert.rejects(s.c.send(request(s.store)),e=>e.message==='live_request_failed');
 assert.deepEqual(s.store.material(A),before);assert.equal(s.calls.length,1);
 assert.ok(!JSON.stringify(s.d.get()).includes('secret-header-or-credential'));
});
test('Pre-request disk error prevents outbound effects and fences further writes until restart',async()=>{
 const s=await setup();s.d.setFail(true);await assert.rejects(s.c.send(request(s.store)));
 assert.equal(s.calls.length,0);s.d.setFail(false);
 await assert.rejects(s.c.send(request(s.store)),/live_persistence_fenced/);assert.equal(s.calls.length,0);
});
test('Context includes only current page/history and explicitly selected current/linked notes',async()=>{
 const s=await setup();await s.ed.addNotebookEntry({notebook_key:A,title:'Моя запись',body:'PRIVATE_A'});
 await s.ed.addNotebookEntry({notebook_key:B,title:'Чужая тема',body:'PRIVATE_B'});
 const tab='tab_00000000-0000-4000-8000-000000000001';
 await s.ed.bindChat({folder_id:'subject-3',tab_id:tab,title:'GPT A',material_id:A},[tab]);
 await s.ed.addNotebookEntry({notebook_key:tab,title:'GPT-конспект',body:'LINKED_A'});
 const clean=buildLiveContext(s.store.topic(A),s.ed.snapshot());assert.equal(clean.notes.length,0);
 const shared=buildLiveContext(s.store.topic(A),s.ed.snapshot(),{includeNotebook:true});
 assert.equal(shared.notes.length,2);assert.ok(JSON.stringify(shared).includes('LINKED_A'));
 assert.ok(!JSON.stringify(shared).includes('PRIVATE_B'));
});
test('Unknown/prototype topic IDs and malformed envelopes cannot mutate durable state',async()=>{
 const s=await setup();for(const id of ['__proto__','constructor','material-99-99']){
  assert.throws(()=>s.store.topic(id),/live_topic_unknown/);
  await assert.rejects(s.store.begin({...request(s.store),material_id:id}),/live_topic_unknown/);
 }
 assert.equal(s.d.get(),null);
});
