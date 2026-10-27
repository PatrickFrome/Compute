import {inspectRaster} from './raster.mjs';
import {createPairing,pairMessage} from './pairing.mjs';
import {icon,decorate} from './icons.mjs';
import {openStore,loadState,mutate,replaceState} from './storage.mjs';
import {topicId,currentLesson,changePage,undoPage,canonicalChat,safeSource,parsePatch,buildContext,migrateDesktop,importSummary,MAX_BYTES} from './core.mjs';
import {renderModules} from './modules.mjs';

const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;};
let catalog,state,current='material-03-01',ready=false,expanded=new Set([3]),share=false,patchRequested=false;
let editingNote=null,opener=null,navGeneration=0,pendingDraft=null,draftTimer,toastTimer;
const noteDrafts=new Map();let pairView=null;
const pairing=createPairing({onState:updatePair,onHelp:()=>pairDialog()});
const channel='BroadcastChannel' in window?new BroadcastChannel('devfleet-education-journal'):null;
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4200);}
function failure(e){toast(e?.message||'Не удалось сохранить изменение');}
function action(fn){return async e=>{try{await fn(e);}catch(err){failure(err);}};}
function bind(id,fn){$(id).addEventListener('click',action(fn));}
function button(text,fn,cls='quiet',name){const b=el('button',undefined,cls);b.type='button';if(name)b.append(icon(name));b.append(el('span',text));b.onclick=action(fn);return b;}
function base(id=current){const m=catalog.materials.find(x=>x.id===id);if(!m)throw Error('Урок не найден');return m;}
function lesson(){return currentLesson(base(),state);}
const subjectTitle=s=>s.title.replace(/^\d+\s*/,'').replace(/\s*и экзамены$/i,'');
async function save(fn,{render=true}={}){state=await mutate(fn);channel?.postMessage({seq:state.seq});if(render)renderAll();return state;}

function renderTree(){
 const tree=$('course-tree'),q=$('topic-search').value.trim().toLocaleLowerCase('ru-RU'),subject=base().subject;tree.replaceChildren();
 for(const s of catalog.subjects){
  const title=subjectTitle(s),all=catalog.materials.filter(m=>m.subject===s.id);
  const matches=q?all.filter(m=>(m.title+' '+title).toLocaleLowerCase('ru-RU').includes(q)):all;
  if(q&&!matches.length)continue;
  const group=el('div',undefined,'subject'+(s.id===subject?' active':'')),toggle=el('button',undefined,'subject-toggle');
  const open=!!q||expanded.has(s.id);toggle.append(el('span',title,'subject-label'),icon('chevron'));toggle.setAttribute('aria-expanded',String(open));
  toggle.onclick=()=>{expanded.has(s.id)?expanded.delete(s.id):expanded.add(s.id);renderTree();};group.append(toggle);
  if(open){const items=el('div',undefined,'subject-topics');for(const m of matches){
    const b=el('button',undefined,'topic-link'+(current===m.id?' active':''));b.dataset.topicId=m.id;
    b.append(el('span',undefined,'dot'),el('span',m.title,'label'));if(current===m.id)b.setAttribute('aria-current','page');
    b.onclick=action(()=>go(m.id));items.append(b);
  }group.append(items);}tree.append(group);
 }
 if(!tree.childElementCount)tree.append(el('p','Ничего не найдено','empty-state'));
}
function details(title,content){
 const d=el('details',undefined,'lesson-details'),summary=el('summary');summary.append(icon('chevron'),el('span',title));d.append(summary);
 const body=el('div');typeof content==='string'?body.textContent=content:body.append(content);d.append(body);return d;
}
function renderLesson(){
 const m=lesson(),subject=catalog.subjects.find(s=>s.id===m.subject),body=$('lesson-body');
 $('subject-name').textContent=subjectTitle(subject);$('lesson-level').textContent='Урок '+String(m.position).padStart(2,'0');
 $('lesson-title').textContent=m.title;document.title=m.title+' · Education';$('undo-lesson').disabled=!state.pages[m.id]?.history.length;
 body.replaceChildren(el('p',m.theory,'theory-text'));
 const example=el('section',undefined,'example-card');example.append(el('h2','Пример','section-label'),el('p',m.example));body.append(example);
 // Self-assessment, exercises, quizzes and progress are intentionally absent from this reading workspace.
 body.append(details('Подробнее',m.depth.extension));
 if(m.depth.spotlight)body.append(details(m.depth.spotlight.title.replace(/^Углубление:\s*/,''),m.depth.spotlight.text));
 const glossary=el('div',undefined,'glossary');for(const g of m.depth.glossary){const row=el('div');row.append(el('b',g.term),el('span',g.meaning));glossary.append(row);}body.append(details('Термины',glossary));
 const sources=el('div',undefined,'sources');for(const r of m.depth.references){const url=safeSource(r.url);if(!url)continue;const a=el('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.append(icon('external'),el('span',r.title));sources.append(a);}body.append(details('Источники',sources));
 renderModules($('lesson-modules'),m.blocks);renderImages();
 $('chat-topic').textContent=m.title;$('bind-chat').textContent=state.bindings[m.id]?'Изменить беседу':'Привязать беседу';
 $('chat-destination').textContent=state.bindings[m.id]?'Беседа урока в ChatGPT':'ChatGPT';
}
function renderImages(){
 const host=$('lesson-images');host.replaceChildren();
 for(const im of state.images.filter(i=>i.topic===current)){
  const card=el('figure',undefined,'image-card'),img=el('img');img.src=im.data;img.alt=im.title;img.loading='lazy';img.width=im.width;img.height=im.height;
  const caption=el('figcaption',undefined,'image-caption');caption.append(el('span',im.title),button('Удалить',()=>confirm('Удалить изображение?','Остальные материалы урока сохранятся.',()=>save(s=>{s.images=s.images.filter(x=>x.id!==im.id);return s;}))));card.append(img,caption);host.append(card);
 }
}
function renderNotebook(){
 $('notebook-topic').textContent=base().title;const list=$('notes-list');list.replaceChildren();
 for(const n of state.notes.filter(n=>n.topic===current).sort((a,b)=>b.at.localeCompare(a.at))){
  const card=el('article',undefined,'note-card');card.append(el('h4',n.title||'Заметка'),el('p',n.body));
  const meta=el('div',undefined,'note-meta'),controls=el('div',undefined,'note-actions');
  meta.append(el('small',new Date(n.updated_at||n.at).toLocaleDateString('ru-RU')));
  controls.append(button('Изменить',()=>{
    editingNote={id:n.id,body:n.body};$('note-title').value=n.title;$('note-body').value=n.body;
    $('cancel-note').hidden=false;$('save-note').textContent='Сохранить';$('note-body').focus();
  }),button('Удалить',()=>confirm('Удалить запись?','Удалится только эта запись.',async()=>{
    await save(s=>{s.notes=s.notes.filter(x=>x.id!==n.id);return s;});if(editingNote?.id===n.id)resetNote();
  })));meta.append(controls);card.append(meta);list.append(card);
 }
}
function renderAll(){if(!ready)return;renderTree();renderLesson();renderNotebook();renderPair();}
function renderPair(){
 if(!ready)return;const p=pairView?.topic===current?pairView:null,active=!!p?.enabled;
 $('pair-chat').textContent=active?'Чат рядом':'Подключить рядом';$('pair-chat').setAttribute('aria-pressed',String(active));$('pair-disconnect').hidden=!active;
 $('chat-location').textContent=active?(p.url?'Беседа закреплена за этим уроком.':'Отправь первое сообщение в ChatGPT для сохранения беседы.'):'Обычный ChatGPT в твоём аккаунте.';
 $('open-chatgpt').textContent=active?'Скопировать вопрос':'В ChatGPT';$('open-chatgpt').title=active?'Скопировать материал и вопрос для открытой беседы':'Скопировать и открыть обычный ChatGPT';
}
async function updatePair(p){
 if(!ready||p.topic!==current)return;pairView=p;renderPair();
 if(p.url){let url;try{url=canonicalChat(p.url);}catch{return;}if(!state.bindings[p.topic])try{await save(s=>{if(!s.bindings[p.topic]&&!Object.entries(s.bindings).some(([id,u])=>id!==p.topic&&u===url))s.bindings[p.topic]=url;return s;});}catch(e){failure(e);}}
 if(p.event==='different_chat')toast(pairMessage('pair_chat_changed_manually'));
 if(p.error&&p.error!=='pair_extension_unavailable')toast(pairMessage(p.error));
}
function pairDialog(){
 const box=el('div',undefined,'modal-stack');
 box.append(el('p','Урок и настоящий ChatGPT рядом в одном окне Chrome. Для переключения бесед нужно небольшое расширение Education; это не расширение OpenAI.'));
 const a=el('a','Скачать расширение');a.href='/downloads/education-chat-link.zip';a.download='education-chat-link.zip';a.className='primary';box.append(a);
 box.append(el('p','Распакуй архив. В Chrome 155+ открой chrome://extensions, включи «Режим разработчика», выбери «Загрузить распакованное расширение» и папку с manifest.json. Затем обнови эту страницу.'));
 box.append(el('p','Нажми «Подключить рядом», авторизуйся самостоятельно и выбери модель в ChatGPT. После первого сообщения адрес беседы сохранится за темой. При переключении урока рядом будет открываться его отдельный чат.'));
 box.append(el('small','Расширение видит только адреса связанных вкладок. Оно не читает переписку, пароли или cookies, не отправляет сообщения и не выбирает модель. Автоматические правки урока не подключены.'));
 const d=el('a','Официальная боковая панель ChatGPT');d.href='https://learn.chatgpt.com/docs/chrome-extension';d.target='_blank';d.rel='noopener noreferrer';box.append(d);showModal('Беседы рядом',box);
}
async function openPair(){const id=current;if(!pairing.info){try{await pairing.probe(id);}catch{pairDialog();return;}}if(current!==id)return;try{await pairing.open(id,state.bindings[id]);}catch(e){toast(pairMessage(e.message));}}

function captureNoteDraft(){if(!ready)return;noteDrafts.set(current,{title:$('note-title').value,body:$('note-body').value,edit:editingNote});}
function restoreNoteDraft(){const draft=noteDrafts.get(current);editingNote=draft?.edit||null;$('note-title').value=draft?.title||'';$('note-body').value=draft?.body||'';$('cancel-note').hidden=!draft?.edit;$('save-note').textContent='Сохранить';}
async function go(id,{replace=false}={}){
 if(!topicId(id)||!catalog.materials.some(m=>m.id===id))id='material-03-01';
 const generation=++navGeneration;await flushDraft();if(generation!==navGeneration)return;
 captureNoteDraft();current=id;share=false;patchRequested=false;$('share-notes').checked=false;$('question').value=state.drafts[id]||'';$('draft-status').textContent='';
 expanded=new Set([base().subject]);restoreNoteDraft();const hash='#/'+id;
 if(location.hash!==hash)replace?history.replaceState(null,'',hash):history.pushState(null,'',hash);
 renderAll();$('lesson-reader').scrollTo({top:0,behavior:'instant'});closeNav();closeMenus();
 void pairing.select(id,state.bindings[id]);
}
function queueDraft(){pendingDraft={id:current,text:$('question').value};$('draft-status').textContent='';clearTimeout(draftTimer);draftTimer=setTimeout(()=>flushDraft().catch(failure),300);}
async function flushDraft(){
 clearTimeout(draftTimer);const d=pendingDraft;if(!d)return;
 try{await save(s=>{s.drafts[d.id]=d.text;return s;},{render:false});if(pendingDraft===d)pendingDraft=null;}
 catch(e){$('draft-status').textContent='Не сохранено';throw e;}
}
function resetNote(){editingNote=null;noteDrafts.delete(current);$('note-form').reset();$('cancel-note').hidden=true;$('save-note').textContent='Сохранить';}
function openNotebook(){
 if(!$('drawer').hidden){closeNotebook();return;}
 opener=document.activeElement;$('drawer').hidden=false;$('app').classList.add('notebook-open');$('open-notebook').setAttribute('aria-expanded','true');
 $('drawer-backdrop').hidden=false;renderNotebook();$('note-body').focus();
}
function closeNotebook(){captureNoteDraft();$('drawer').hidden=true;$('app').classList.remove('notebook-open');$('open-notebook').setAttribute('aria-expanded','false');$('drawer-backdrop').hidden=true;if(opener?.isConnected)opener.focus();}
function closeNav(){$('sidebar').classList.remove('open');$('menu-toggle').setAttribute('aria-expanded','false');$('nav-backdrop').hidden=true;}
function closeMenus(){document.querySelectorAll('.action-menu[open]').forEach(n=>n.open=false);}
function showModal(title,node){closeMenus();$('modal-title').textContent=title;$('modal-body').replaceChildren(node);if(!$('modal').open)$('modal').showModal();}
function closeModal(){$('modal').close();}
function confirm(title,text,fn){const box=el('div',undefined,'modal-stack');box.append(el('p',text));const controls=el('div',undefined,'actions');controls.append(button('Отмена',closeModal),button('Продолжить',async()=>{await fn();closeModal();},'primary'));box.append(controls);showModal(title,box);}
function context(){return buildContext(lesson(),state,{question:$('question').value,shareNotes:share,patch:patchRequested});}
async function copyText(text){if(!navigator.clipboard?.writeText)throw Error('Открой контекст и скопируй текст вручную');await navigator.clipboard.writeText(text);}
function contextDialog(){const box=el('div',undefined,'modal-stack'),text=el('textarea');text.value=context();text.readOnly=true;text.setAttribute('aria-label','Контекст урока');box.append(el('p',share?'Урок, вопрос и тетрадь этой темы.':'Урок и вопрос. Тетрадь не включена.'),text,button('Скопировать',async()=>{await copyText(text.value);toast('Скопировано');},'primary'));showModal('Контекст чата',box);}
function bindDialog(){
 const id=current,box=el('div',undefined,'modal-stack'),input=el('input');input.type='url';input.placeholder='https://chatgpt.com/c/…';input.value=state.bindings[id]||'';input.setAttribute('aria-label','Ссылка на чат');
 box.append(el('p','Ссылка на беседу для этого урока.'),input,button('Сохранить',async()=>{
  const url=canonicalChat(input.value.trim());if(pairing.info)await pairing.bind(id,url);await save(s=>{if(Object.entries(s.bindings).some(([topic,u])=>topic!==id&&u===url))throw Error('Эта беседа уже связана с другой темой');s.bindings[id]=url;return s;});closeModal();
 },'primary'));
 if(state.bindings[id])box.append(button('Отвязать беседу',async()=>{await save(s=>{delete s.bindings[id];return s;});closeModal();}));showModal('Чат урока',box);
}
function editDialog(){
 const m=lesson(),id=current,box=el('div',undefined,'modal-stack'),fields={};
 for(const [key,title] of [['theory','Материал'],['example','Пример'],['extension','Подробнее']]){const label=el('label',title),input=el('textarea');input.value=key==='extension'?m.depth.extension:m[key];input.maxLength=8000;fields[key]=input;label.append(input);box.append(label);}
 box.append(button('Сохранить',async()=>{const changes=Object.fromEntries(Object.entries(fields).map(([key,n])=>[key,n.value]));await save(s=>changePage(s,base(id),changes,{origin:'student',expectedRevision:m.revision}));closeModal();toast('Урок обновлён');},'primary'));showModal('Редактировать урок',box);
}
function patchDialog(){
 const id=current,m=lesson(),box=el('div',undefined,'modal-stack'),input=el('textarea');input.placeholder='Вставь правку из ChatGPT';input.maxLength=100000;input.setAttribute('aria-label','Правка урока');
 box.append(el('p','Изменения сохранятся только после твоего подтверждения.'),input,button('Посмотреть изменения',()=>{
  const p=parsePatch(input.value,id,m.revision);
  if(Object.hasOwn(p.changes,'check')||Object.hasOwn(p.changes,'exercise')||p.blocks?.some(b=>b.type==='quiz'))throw Error('Тесты и контрольные задания убраны из уроков');
  const preview=el('div',undefined,'modal-stack');const labels={theory:'Материал',example:'Пример',extension:'Подробнее'};
  for(const [key,value] of Object.entries(p.changes)){const row=el('div',undefined,'diff-item');row.append(el('b',labels[key]||key),el('p',value));preview.append(row);}
  if(p.blocks)preview.append(el('p',`Модулей в новой редакции: ${p.blocks.length}`));
  preview.append(button('Сохранить в урок',async()=>{await save(s=>changePage(s,base(id),p.changes,{origin:'manual_gpt',expectedRevision:p.base_revision,blocks:p.blocks}));closeModal();toast('Урок обновлён');},'primary'));
  showModal('Изменения урока',preview);
 },'primary'));showModal('Ответ в урок',box);
}
function download(name,text){const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function exportData(){await flushDraft();state=await loadState();download(`education-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(state,null,2));}
async function importFile(file){
 if(!file)return;if(file.size>MAX_BYTES)throw Error('Файл больше 24 МБ');const {state:incoming}=migrateDesktop(JSON.parse(await file.text()));
 confirm('Импортировать копию?',`${importSummary(incoming)}. Текущие данные будут заменены; сначала скачается их резервная копия.`,async()=>{
  await exportData();state=await replaceState(incoming);channel?.postMessage({seq:state.seq});noteDrafts.clear();resetNote();$('question').value=state.drafts[current]||'';renderAll();
 });
}
async function importImage(file,id){
 if(!file)return;if(!['image/png','image/jpeg'].includes(file.type)||file.size>8*1024*1024)throw Error('Выбери PNG или JPEG до 8 МБ');inspectRaster(new Uint8Array(await file.arrayBuffer()));
 const bmp=await createImageBitmap(file);try{
  if(bmp.width*bmp.height>16000000)throw Error('Изображение слишком большое');const scale=Math.min(1,1600/Math.max(bmp.width,bmp.height)),canvas=el('canvas');canvas.width=Math.max(1,Math.round(bmp.width*scale));canvas.height=Math.max(1,Math.round(bmp.height*scale));canvas.getContext('2d').drawImage(bmp,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/png');if(data.length>2000000)throw Error('Уменьши размер изображения');
  await save(s=>{if(s.images.filter(i=>i.topic===id).length>=12)throw Error('В уроке уже 12 изображений');s.images.push({id:crypto.randomUUID(),topic:id,title:file.name.slice(0,160),data,width:canvas.width,height:canvas.height});return s;});
 }finally{bmp.close();}
}
function wire(){
 decorate();$('topic-search').oninput=renderTree;
 bind('menu-toggle',()=>{const open=$('sidebar').classList.toggle('open');$('menu-toggle').setAttribute('aria-expanded',String(open));$('nav-backdrop').hidden=!open;});bind('nav-backdrop',closeNav);
 bind('open-notebook',openNotebook);bind('close-drawer',closeNotebook);bind('drawer-backdrop',closeNotebook);
 bind('next-lesson',()=>go(catalog.materials[(catalog.materials.findIndex(m=>m.id===current)+1)%catalog.materials.length].id));
 bind('close-modal',closeModal);$('modal').addEventListener('click',e=>{if(e.target===$('modal')){const r=$('modal').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeModal();}});
 document.addEventListener('click',e=>{document.querySelectorAll('.action-menu[open]').forEach(n=>{if(!n.contains(e.target)||e.target.closest('.menu-items button'))n.open=false;});});
 $('note-form').onsubmit=action(async e=>{
  e.preventDefault();const id=current,title=$('note-title').value.trim(),body=$('note-body').value.trim(),edit=editingNote;
  if(!body)throw Error('Запиши текст заметки');await save(s=>{
   if(edit){const n=s.notes.find(n=>n.id===edit.id&&n.topic===id);if(!n||n.body!==edit.body)throw Error('Запись уже изменена. Открой её заново.');n.title=title;n.body=body;n.updated_at=new Date().toISOString();}
   else s.notes.push({id:crypto.randomUUID(),topic:id,title,body,source:'student',at:new Date().toISOString()});return s;
  });if(current===id)resetNote();noteDrafts.delete(id);toast('Сохранено');
 });bind('cancel-note',resetNote);$('note-title').oninput=$('note-body').oninput=captureNoteDraft;
 $('question').oninput=queueDraft;$('share-notes').onchange=()=>{share=$('share-notes').checked;};
 bind('preview-context',contextDialog);bind('bind-chat',bindDialog);bind('edit-lesson',editDialog);bind('apply-reply',patchDialog);
 bind('pair-chat',openPair);bind('pair-help',pairDialog);bind('pair-disconnect',async()=>{try{await pairing.disconnect(current);}catch(e){toast(pairMessage(e.message));}});
 bind('undo-lesson',()=>{const id=current;return save(s=>undoPage(s,base(id)));});
 bind('request-patch',()=>{patchRequested=true;$('question').value='Улучши объяснение и пример урока. Подготовь правку для сохранения на сайте.';queueDraft();$('question').focus();});
 bind('open-chatgpt',async()=>{
  const text=context(),url=state.bindings[current]||'https://chatgpt.com/';
  if(pairView?.enabled&&pairView.topic===current){await copyText(text);toast('Скопировано. Вставь в ChatGPT рядом — сообщение не отправлено.');await flushDraft();return;}
  window.open(url,'_blank','noopener,noreferrer');
  try{await copyText(text);toast('Скопировано. Вставь в ChatGPT.');}catch(e){contextDialog();throw e;}await flushDraft();
 });
 let excerpt='';$('lesson-reader').addEventListener('mouseup',()=>{const s=getSelection();excerpt=s?.anchorNode&&$('lesson-reader').contains(s.anchorNode)?s.toString().trim().slice(0,1800):'';});
 bind('ask-selection',()=>{$('question').value=excerpt?'Объясни подробнее: «'+excerpt+'»':'Объясни этот урок простыми словами.';queueDraft();$('question').focus();});
 bind('export-data',exportData);bind('import-data',()=>{$('data-file').value='';$('data-file').click();});$('data-file').onchange=action(()=>importFile($('data-file').files[0]));
 let imageTopic;bind('add-image',()=>{imageTopic=current;$('image-file').value='';$('image-file').click();});$('image-file').onchange=action(()=>importImage($('image-file').files[0],imageTopic));
 const splitter=$('splitter');let dragging=false;
 const resize=y=>{const box=$('workspace').getBoundingClientRect(),h=Math.max(175,Math.min(box.height-200,box.bottom-y));$('workspace').style.setProperty('--chat-height',h+'px');splitter.setAttribute('aria-valuenow',String(Math.round(h/box.height*100)));};
 splitter.onpointerdown=e=>{dragging=true;splitter.setPointerCapture(e.pointerId);resize(e.clientY);e.preventDefault();};splitter.onpointermove=e=>{if(dragging)resize(e.clientY);};splitter.onpointerup=e=>{dragging=false;splitter.releasePointerCapture(e.pointerId);};splitter.onpointercancel=()=>dragging=false;
 splitter.onkeydown=e=>{if(e.key==='Home'){$('workspace').style.removeProperty('--chat-height');e.preventDefault();}else if(['ArrowUp','ArrowDown'].includes(e.key)){resize(splitter.getBoundingClientRect().top+(e.key==='ArrowUp'?-24:24));e.preventDefault();}};
 document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){if(!$('drawer').hidden)closeNotebook();closeNav();closeMenus();}
  if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();if(innerWidth<=720){$('sidebar').classList.add('open');$('nav-backdrop').hidden=false;$('menu-toggle').setAttribute('aria-expanded','true');}$('topic-search').focus();}
  if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&document.activeElement===$('question')&&!e.isComposing){e.preventDefault();$('open-chatgpt').click();}
  if(e.key==='Tab'&&!$('drawer').hidden&&innerWidth<=1100){const nodes=[...$('drawer').querySelectorAll('button,input,textarea,summary')].filter(n=>!n.disabled&&n.getClientRects().length);if(e.shiftKey&&document.activeElement===nodes[0]){e.preventDefault();nodes.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0]?.focus();}}
 });
 window.addEventListener('popstate',()=>go(location.hash.slice(2),{replace:true}).catch(failure));
 document.addEventListener('visibilitychange',()=>{if(document.hidden)flushDraft().catch(()=>{});});
 window.addEventListener('beforeunload',e=>{if(pendingDraft||[...noteDrafts.values()].some(d=>d.body.trim())){e.preventDefault();e.returnValue='';}});
 if(channel)channel.onmessage=async()=>{try{const next=await loadState();if(next.seq>state.seq){state=next;renderAll();if(!pendingDraft&&document.activeElement!==$('question'))$('question').value=state.drafts[current]||'';}}catch(e){failure(e);}};
}
async function start(){
 const res=await fetch('/data/course.json');if(!res.ok)throw Error('Уроки пока недоступны');catalog=await res.json();if(catalog.materials.length!==120||catalog.subjects.length!==15)throw Error('Не удалось загрузить темы');
 state=await openStore();wire();ready=true;current=topicId(location.hash.slice(2))?location.hash.slice(2):'material-03-01';await go(current,{replace:true});
 // Updating the public shell does not touch IndexedDB notebooks or lesson revisions.
 if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(r=>r.update()).catch(()=>{});
}
start().catch(e=>{const box=el('div',undefined,'fatal');box.append(el('h2','Не удалось открыть урок'),el('p',e.message),button('Обновить страницу',()=>location.reload(),'primary'));document.body.append(box);});
