import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {buildContext,emptyState,validateState} from '../src/core.mjs';
const read=f=>fs.readFile(new URL('../'+f,import.meta.url),'utf8');
test('Minimal light shell exposes only topics, lesson, notebook and chat',async()=>{
 const html=await read('public/index.html'),css=await read('public/style.css');
 for(const id of ['course-tree','lesson-reader','drawer','chat-panel'])assert.ok(html.includes('id="'+id+'"'));
 for(const id of ['mark-read','read-count','progress-summary','open-settings'])assert.ok(!html.includes('id="'+id+'"'));
 assert.match(html,/id="drawer"[^>]*hidden/);assert.match(css,/color-scheme:light/);
 assert.ok(!html.includes('Проверь меня'));assert.ok(!html.includes('БЕЗ API'));
});
test('Legacy quiz and progress data are retained but not rendered',async()=>{
 const modules=await read('src/modules.mjs'),app=await read('src/app.mjs');
 assert.match(modules,/b\.type==='quiz'\)continue/);
 assert.ok(!app.includes('read-count'));assert.ok(!app.includes('mark-read'));
 const state=emptyState();state.read=['material-03-01'];const accepted=validateState(state);assert.deepEqual(accepted.read,['material-03-01']);
});
test('Ordinary learning context no longer includes a forced exam/check task',async()=>{
 const catalog=JSON.parse(await read('public/data/course.json'));const m=catalog.materials.find(x=>x.id==='material-03-01');
 const text=buildContext(m,emptyState(),{question:'Объясни подробнее'});
 assert.ok(!text.includes(m.check));assert.ok(!text.includes(m.exercise));
});
test('Service-worker version changes without a browser journal rename or deletion',async()=>{
 const sw=await read('public/sw.js'),store=await read('src/storage.mjs');
 assert.match(sw,/light-e12/);assert.match(store,/devfleet-education-web-v1/);
 assert.ok(!sw.includes('indexedDB.deleteDatabase'));assert.ok(!store.includes('deleteDatabase'));
});
