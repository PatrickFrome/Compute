import {inspectStoredPng} from './raster.mjs';
export const SCHEMA='devfleet.education.web.v1';
export const EDITABLE=['theory','example','exercise','check','extension'];
export const MAX_BYTES=24*1024*1024;
export function fail(code){throw Error(code);}
export function topicId(id){return typeof id==='string'&&/^material-(0[0-9]|1[0-4])-0[1-8]$/.test(id);}
const str=(s,max,min=0)=>typeof s==='string'&&s.length>=min&&s.length<=max;
const obj=o=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&Object.getPrototypeOf(o)===Object.prototype;
export const clone=v=>structuredClone(v);
export function emptyState(){return {schema:SCHEMA,seq:0,notes:[],drafts:{},bindings:{},read:[],visited:[],pages:{},images:[],legacy:{},unassigned:[]};}
export function canonicalChat(value){if(!str(value,200,1))fail('Неверная ссылка на ChatGPT');let u;try{u=new URL(value);}catch{fail('Неверная ссылка на ChatGPT');}if(u.protocol!=='https:'||u.hostname!=='chatgpt.com'||u.port||u.username||u.password||u.search||u.hash||!/^\/c\/[a-zA-Z0-9-]{8,100}\/?$/.test(u.pathname))fail('Нужна ссылка https://chatgpt.com/c/… без параметров');return u.origin+u.pathname.replace(/\/$/,'');}
export function safeSource(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
function exactKeys(o,keys){return obj(o)&&Object.keys(o).every(k=>keys.includes(k));}
export function validateBlocks(blocks){
 if(!Array.isArray(blocks)||blocks.length>20)fail('Не более 20 модулей в уроке');const ids=new Set();
 for(const b of blocks){
  if(!obj(b)||!str(b.id,64,1)||!/^[a-zA-Z0-9_-]+$/.test(b.id)||ids.has(b.id)||!str(b.title,160))fail('Неверный модуль');ids.add(b.id);
  const base=['id','type','title'];
  if(['text','callout','formula'].includes(b.type)){if(!exactKeys(b,[...base,'text'])||!str(b.text,8000,1))fail('Неверный текст модуля');}
  else if(b.type==='checklist'){if(!exactKeys(b,[...base,'items'])||!Array.isArray(b.items)||b.items.length>30||!b.items.every(x=>str(x,500,1)))fail('Неверный список');}
  else if(b.type==='table'){if(!exactKeys(b,[...base,'headers','rows'])||!Array.isArray(b.headers)||b.headers.length<1||b.headers.length>6||!b.headers.every(x=>str(x,160))||!Array.isArray(b.rows)||b.rows.length>30||!b.rows.every(r=>Array.isArray(r)&&r.length===b.headers.length&&r.every(x=>str(x,500))))fail('Неверная таблица');}
  else if(b.type==='quiz'){if(!exactKeys(b,[...base,'question','choices','correct','explanation'])||!str(b.question,1500,1)||!Array.isArray(b.choices)||b.choices.length<2||b.choices.length>6||!b.choices.every(x=>str(x,600,1))||!Number.isInteger(b.correct)||b.correct<0||b.correct>=b.choices.length||!str(b.explanation,2000))fail('Неверный тест');}
  else if(b.type==='ohm_lab'){if(!exactKeys(b,[...base,'voltage','resistance'])||!Number.isFinite(b.voltage)||b.voltage<0||b.voltage>24||!Number.isFinite(b.resistance)||b.resistance<1||b.resistance>1000000)fail('Параметры лаборатории вне границ');}
  else if(b.type==='diagram'){if(!exactKeys(b,[...base,'nodes','edges'])||!Array.isArray(b.nodes)||!b.nodes.length||b.nodes.length>8||!b.nodes.every(n=>exactKeys(n,['id','label'])&&str(n.id,40,1)&&str(n.label,160,1))||new Set(b.nodes.map(n=>n.id)).size!==b.nodes.length||!Array.isArray(b.edges)||b.edges.length>12||!b.edges.every(e=>exactKeys(e,['from','to'])&&b.nodes.some(n=>n.id===e.from)&&b.nodes.some(n=>n.id===e.to)))fail('Неверная схема');}
  else fail('Этот тип модуля не поддерживается');
 }
 return blocks;
}
function fieldsOK(fields){return exactKeys(fields,EDITABLE)&&EDITABLE.every(k=>str(fields[k],8000,1));}
export function validateState(s){
 if(!exactKeys(s,['schema','seq','notes','drafts','bindings','read','visited','pages','images','legacy','unassigned'])||s.schema!==SCHEMA||!Number.isSafeInteger(s.seq)||s.seq<0)fail('Неподдерживаемый формат резервной копии');
 for(const k of ['notes','read','visited','images','unassigned'])if(!Array.isArray(s[k]))fail('Повреждённые данные: '+k);
 for(const k of ['drafts','bindings','pages','legacy'])if(!obj(s[k]))fail('Повреждённые данные: '+k);
 if(s.notes.length>2500||s.images.length>120||s.unassigned.length>2500||s.read.length>120||s.visited.length>120)fail('Слишком большой журнал');
 const noteIds=new Set();
 for(const n of s.notes){if(!exactKeys(n,['id','topic','title','body','source','at','updated_at'])||!str(n.id,100,1)||noteIds.has(n.id)||!topicId(n.topic)||!str(n.title,100)||!str(n.body,5000,1)||!str(n.at,40,1)||!['student','manual_gpt','legacy'].includes(n.source))fail('Повреждённая запись тетради');noteIds.add(n.id);}
 for(const [id,v] of Object.entries(s.drafts))if(!topicId(id)||!str(v,4000))fail('Повреждённый черновик');
 const urls=new Set();for(const [id,v] of Object.entries(s.bindings)){if(!topicId(id)||canonicalChat(v)!==v||urls.has(v))fail('Повреждённая привязка беседы');urls.add(v);}
 if(!s.read.every(topicId)||!s.visited.every(topicId)||new Set(s.read).size!==s.read.length||new Set(s.visited).size!==s.visited.length)fail('Повреждённый прогресс');
 for(const [id,p] of Object.entries(s.pages)){
  if(!topicId(id)||!exactKeys(p,['revision','fields','blocks','history','origin'])||!Number.isSafeInteger(p.revision)||p.revision<1||!fieldsOK(p.fields)||!Array.isArray(p.history)||p.history.length>25||!['student','manual_gpt','undo'].includes(p.origin))fail('Повреждённая редакция');
  validateBlocks(p.blocks);
  for(const h of p.history){if(!exactKeys(h,['fields','blocks','origin','at'])||!fieldsOK(h.fields)||!str(h.at,40)||!['base','student','manual_gpt','undo'].includes(h.origin))fail('Повреждённая история');validateBlocks(h.blocks);}
 }
 const imageIds=new Set();for(const im of s.images){if(!exactKeys(im,['id','topic','title','data','width','height'])||!str(im.id,100,1)||imageIds.has(im.id)||!topicId(im.topic)||!str(im.title,160)||!str(im.data,2000000,20)||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(im.data)||!Number.isInteger(im.width)||!Number.isInteger(im.height)||im.width<1||im.height<1||im.width>1600||im.height>1600)fail('Повреждённое изображение');inspectStoredPng(im.data,im.width,im.height);imageIds.add(im.id);}
 if(JSON.stringify(s).length>MAX_BYTES)fail('Резервная копия слишком велика');return s;
}
export function currentLesson(base,s){const p=s.pages[base.id];return {...clone(base),...(p?{theory:p.fields.theory,example:p.fields.example,exercise:p.fields.exercise,check:p.fields.check,depth:{...clone(base.depth),extension:p.fields.extension}}:{}),blocks:clone(p?.blocks||[]),revision:p?.revision||0,origin:p?.origin||'base'};}
export function pageFields(m){return Object.fromEntries(EDITABLE.map(k=>[k,k==='extension'?m.depth.extension:m[k]]));}
export function changePage(s,base,changes,{origin='student',expectedRevision,blocks}={}){
 const m=currentLesson(base,s);if(expectedRevision!==m.revision)fail('Урок уже изменён. Открой редактор заново.');
 if(!exactKeys(changes,EDITABLE)||Object.values(changes).some(v=>!str(v,8000,1)))fail('В правке есть недопустимые поля');
 const fields={...pageFields(m),...changes};const nextBlocks=blocks===undefined?m.blocks:validateBlocks(clone(blocks));
 const history=[...(s.pages[base.id]?.history||[]),{fields:pageFields(m),blocks:clone(m.blocks),origin:m.origin,at:new Date().toISOString()}].slice(-25);
 s.pages[base.id]={revision:m.revision+1,fields,blocks:nextBlocks,origin,history};return s;
}
export function undoPage(s,base){const p=s.pages[base.id];if(!p?.history.length)fail('Нет предыдущей редакции');const h=p.history.pop();s.pages[base.id]={...p,revision:p.revision+1,fields:h.fields,blocks:h.blocks,origin:'undo'};return s;}
export function parsePatch(text,topic,revision){if(!str(text,100000,1))fail('Правка слишком велика');let p;try{p=JSON.parse(text.trim().replace(/^```(?:json)?\s*\n?/,'').replace(/\n?```$/,''));}catch{fail('Нужен корректный JSON, без текста вокруг');}
 if(!exactKeys(p,['schema','material_id','base_revision','changes','blocks'])||p.schema!=='devfleet.lesson.patch.v1'||p.material_id!==topic||p.base_revision!==revision||!exactKeys(p.changes,EDITABLE)||Object.values(p.changes).some(v=>!str(v,8000,1)))fail('Правка относится к другой теме/редакции или содержит недопустимые поля');
 if(p.blocks!==undefined)validateBlocks(p.blocks);return clone(p);
}
export function buildContext(m,s,{question='',shareNotes=false,patch=false}={}){
 const notes=shareNotes?s.notes.filter(n=>n.topic===m.id).slice(-8).map(n=>`${n.title}: ${n.body.slice(0,1200)}`).join('\n'):'';
 return ['Ты мой преподаватель электроники, телекоммуникаций и ВОЛС. Объясняй по-русски с абсолютного нуля.',`Тема: ${m.title}. Идентификатор: ${m.id}. Редакция: ${m.revision}.`,
 `Материал (независимо перепроверяй факты):\n${m.theory}`,`Пример:\n${m.example}`,`Углубление:\n${m.depth.extension}`,`Упражнение:\n${m.exercise}`,`Вопрос:\n${m.check}`,
 `Источники для сверки:\n${m.depth.references.map(r=>r.title+' — '+r.url).join('\n')}`,
 shareNotes?'Мои добровольно переданные записи (только этой темы):\n'+(notes||'Записей пока нет.'):'Моя тетрадь не передаётся.',
 question?'Мой запрос: '+question:'Проверь исходные знания, затем задавай вопросы по одному.',
 'Не раскрывай готовое решение до моей попытки. Не объявляй практическую квалификацию на основании переписки. Для опасных опытов предложи симуляцию или работу под наставником.',
 patch?`Подготовь структурированную правку, не выполняй код. Ответ — один JSON-объект: {"schema":"devfleet.lesson.patch.v1","material_id":"${m.id}","base_revision":${m.revision},"changes":{"theory":"полный новый текст, если меняешь","example":"..."}}. В changes включай только изменяемые поля из theory, example, exercise, check, extension. Каждое поле — непустая строка до 8000 символов. Не меняй тему, источники и тетрадь. Я вручную проверю и применю правку на сайте.`:'',
 'Обычная беседа ChatGPT не имеет автоматического доступа к сайту и не может сама сохранить там изменения.'
 ].filter(Boolean).join('\n\n');
}
export function migrateDesktop(input){
 if(input?.schema===SCHEMA)return {state:validateState(clone(input)),kind:'web'};
 if(!obj(input)||input.schema!=='metaengine.devfleet.education.v1'||!Array.isArray(input.notebook_entries||[])||!Array.isArray(input.chats||[]))fail('Не найден журнал Education. Ключи API сюда импортировать нельзя.');
 const s=emptyState(),map=new Map((input.chats||[]).filter(c=>topicId(c.material_id)).map(c=>[c.tab_id,c.material_id]));
 for(const e of input.notebook_entries||[]){const id=topicId(e.notebook_key)?e.notebook_key:map.get(e.notebook_key);if(!str(e.body,5000,1)||!str(e.title,100))fail('Неверная запись в журнале');const n={id:String(e.id||crypto.randomUUID()),topic:id,title:e.title,body:e.body,source:e.source==='student'?'student':'manual_gpt',at:e.at||new Date().toISOString()};if(id)s.notes.push(n);else s.unassigned.push({title:e.title,body:e.body,legacy_key:String(e.notebook_key).slice(0,100)});}
 for(const n of input.notes||[]){if(!str(n.text,5000,1))continue;s.unassigned.push({title:'Конспект модуля '+String(n.lesson_id).slice(0,30),body:n.text,legacy_key:String(n.lesson_id).slice(0,100)});}
 // Keep reviewed learning records for export, not credentials or arbitrary fields.
 for(const k of ['attempts','reviews','labs'])if(Array.isArray(input[k]))s.legacy[k]=clone(input[k]);
 validateState(s);return {state:s,kind:'desktop'};
}
export function importSummary(s){return `${s.notes.length} записей в тетрадях, ${s.unassigned.length} архивных записей, ${Object.keys(s.pages).length} редакций, ${s.images.length} изображений, ${Object.keys(s.bindings).length} бесед`;}
