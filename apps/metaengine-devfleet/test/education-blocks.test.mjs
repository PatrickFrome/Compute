import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {validateBlock,validateBlocks,validateBlockOperations,applyBlockOperations,LESSON_BLOCK_SCHEMA} from '../src/education-blocks.mjs';
import {LiveLessonStore,LiveLessonCoordinator} from '../src/education-live-core.mjs';
import {EducationStore} from '../src/education-core.mjs';
import {inspectRaster,LessonAssetStore} from '../src/education-assets.mjs';
const A='material-03-01',B='material-11-05',ASSET='img_'+'a'.repeat(64);
const blocks=[
 {id:'explain',kind:'text',title:'Объяснение',text:'Текст урока'},
 {id:'warning',kind:'callout',title:'Условие',text:'Только симуляция'},
 {id:'formula',kind:'formula',title:'Закон Ома',text:'I = U / R'},
 {id:'list',kind:'checklist',title:'План',items:['Определи напряжение','Рассчитай ток']},
 {id:'table',kind:'table',title:'Сравнение',columns:['U','I'],rows:[['5 В','5 мА'],['10 В','10 мА']]},
 {id:'quiz',kind:'quiz',title:'Проверка',question:'5 В / 1000 Ом = ?',choices:['5 мА','5 А'],correct_index:0,explanation:'Делим 5 на 1000.'},
 {id:'diagram',kind:'diagram',title:'Связь',nodes:[{id:'a',label:'Источник'},{id:'b',label:'Нагрузка'}],edges:[{from:'a',to:'b',label:'Подача энергии'}],caption:'Упрощённая схема'},
 {id:'image',kind:'image',title:'Иллюстрация',asset_id:ASSET,alt:'Учебный рисунок',caption:'Из файла ученика'},
 {id:'lab',kind:'ohm_lab',title:'Рассчитай ток',voltage:9,resistance:1000}
];
const op=b=>({op:'upsert',id:b.id,position:0,block:b});
function disk(initial=null){let value=initial;return {load:async()=>structuredClone(value),save:async v=>{value=structuredClone(v);},get:()=>structuredClone(value)};}
async function setup(answer,assets=async()=>[]){const d=disk(),store=new LiveLessonStore(d),education=new EducationStore(disk());await store.init();await education.init();const c=new LiveLessonCoordinator({store,education,assets,transport:{status:()=>({ready:true}),complete:async()=>answer}});return {d,store,c};}
const request=s=>({material_id:A,request_id:crypto.randomUUID(),text:'Добавь модули',expected_revision:s.topic(A).revision,allow_edits:true});
const answer=ops=>({reply:'Модули добавлены',change_summary:'Обновление страницы',edits:[],block_ops:ops});

test('Nine reviewed module types pass schema validation without executable properties',()=>{
 for(const b of blocks)assert.deepEqual(validateBlock(b),b);
 assert.equal(LESSON_BLOCK_SCHEMA.anyOf.length,9);
});
test('Unknown kinds, markup properties, remote URLs, fake assets and prototype IDs fail',()=>{
 for(const b of [{...blocks[0],kind:'iframe'},{...blocks[0],html:'<script/>'},{...blocks[7],asset_id:'https://example.com/pixel.png'},
  {...blocks[7],asset_id:'file:///secret'},{...blocks[0],id:'__proto__'},{...blocks[0],style:'position:fixed'}])assert.throws(()=>validateBlock(b),/live_block_invalid/);
});
test('Table geometry, quiz key, finite calculator inputs and diagram references are validated',()=>{
 for(const b of [{...blocks[4],rows:[['one']]},{...blocks[5],correct_index:2},{...blocks[8],resistance:0},
  {...blocks[8],voltage:NaN},{...blocks[8],voltage:230},{...blocks[6],edges:[{from:'a',to:'missing',label:''}]}])assert.throws(()=>validateBlock(b),/live_block_invalid/);
});
test('Block operations are bounded, atomic, ordered and never fetch arbitrary assets',()=>{
 const ops=[op(blocks[0]),{...op(blocks[8]),position:1}];const result=applyBlockOperations([],ops);
 assert.deepEqual(result.map(b=>b.id),['explain','lab']);assert.throws(()=>applyBlockOperations(result,[op(blocks[7])]),/live_image_not_authorized/);
 assert.deepEqual(applyBlockOperations([], [op(blocks[7])],[ASSET]),[blocks[7]]);
 assert.throws(()=>validateBlockOperations([op(blocks[0]),op(blocks[0])]),/live_block_invalid/);
 assert.throws(()=>applyBlockOperations(result,[{op:'remove',id:'missing',position:0,block:null}]),/live_block_not_found/);
});
test('GPT can add/change/delete modules to exactly one lesson; Undo restores text and modules together',async()=>{
 const s=await setup(answer([op(blocks[8])]));const beforeB=s.store.material(B);
 await s.c.send(request(s.store));assert.equal(s.store.material(A).blocks[0].kind,'ohm_lab');assert.deepEqual(s.store.material(B),beforeB);
 const restart=new LiveLessonStore(s.d);await restart.init();assert.equal(restart.material(A).blocks.length,1);
 await restart.undo({material_id:A,expected_revision:restart.topic(A).revision});assert.deepEqual(restart.material(A).blocks,[]);assert.equal(restart.topic(A).turns.length,2);
});
test('Unauthorized image rejects the whole response including text edits',async()=>{
 const a={...answer([op(blocks[7])]),edits:[{field:'theory',text:'Must not commit'}]},s=await setup(a),before=s.store.material(A);
 await assert.rejects(s.c.send(request(s.store)),/live_image_not_authorized/);assert.deepEqual(s.store.material(A),before);
});
test('Image insertion sees only selected topic metadata, never pixel bytes or other-topic files',async()=>{
 const s=await setup(answer([op(blocks[7])]),async id=>id===A?[{id:ASSET,title:'photo.png',width:5,height:5}]:[]);
 await s.c.send(request(s.store));assert.equal(s.store.material(A).blocks[0].asset_id,ASSET);
});
test('Discussion-only mode cannot alter modules even with a model edit proposal',async()=>{
 const s=await setup(answer([op(blocks[8])]));const r=await s.c.send({...request(s.store),allow_edits:false});assert.equal(r.applied,false);assert.deepEqual(s.store.material(A).blocks,[]);
});
test('E8 disk journals migrate without deleting messages or original field versions',async()=>{
 const s=await setup({reply:'Ответ',change_summary:'пример',edits:[{field:'example',text:'Сохранённая правка'}]});await s.c.send(request(s.store));
 const old=s.d.get();delete old.topics[A].blocks;for(const r of old.topics[A].revisions)delete r.before_blocks;
 const restored=new LiveLessonStore(disk(old));await restored.init();assert.equal(restored.material(A).example,'Сохранённая правка');assert.equal(restored.topic(A).turns.length,2);assert.deepEqual(restored.material(A).blocks,[]);
});
test('Foreign blocks, duplicate IDs and excess block count do not enter persistent state',()=>{
 assert.throws(()=>validateBlocks([blocks[0],blocks[0]]),/live_block_invalid/);
 assert.throws(()=>validateBlocks(Array.from({length:21},(_,i)=>({...blocks[0],id:'n'+i}))),/live_block_invalid/);
});
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6h8AAAAASUVORK5CYII=','base64');
test('Raster gate rejects SVG/HTML and large pre-decode dimensions',()=>{
 assert.equal(inspectRaster(PNG).format,'png');assert.throws(()=>inspectRaster(Buffer.from('<svg><script>alert(1)</script></svg>')),/live_image_invalid/);
 const huge=Buffer.from(PNG);huge.writeUInt32BE(90000,16);assert.throws(()=>inspectRaster(huge),/live_image_dimensions/);
});
test('Imported asset is hash-verified, topic-scoped, durable and has no renderer-selected path',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'education-image-test-'));
 try{const writeAtomic=async(f,b)=>fs.writeFile(f,b);const assets=new LessonAssetStore({dataDir:dir,writeAtomic});await assets.init();
  const a=await assets.addNormalized(A,PNG,'one.png');assert.equal(assets.list(A).length,1);assert.equal(assets.list(B).length,0);
  assert.match((await assets.read(A,a.id)).data_url,/^data:image\/png;base64,/);
  await assert.rejects(assets.read(B,a.id),/live_image_not_authorized/);await assert.rejects(assets.read(A,'../../secrets'),/live_image_not_authorized/);
  const second=new LessonAssetStore({dataDir:dir,writeAtomic});await second.init();assert.equal(second.list(A)[0].id,a.id);
  await fs.writeFile(path.join(dir,'education-images',a.id+'.png'),'tampered');await assert.rejects(second.read(A,a.id),/live_image_integrity/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
