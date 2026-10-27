import {inspectRaster} from './raster.mjs';
import {icon,decorate} from './icons.mjs';
import {openStore,loadState,mutate,replaceState} from './storage.mjs';
import {SCHEMA,topicId,clone,emptyState,validateState,canonicalChat,safeSource,currentLesson,pageFields,changePage,undoPage,parsePatch,buildContext,migrateDesktop,importSummary,MAX_BYTES} from './core.mjs';
import {renderModules,basicOhmBlock} from './modules.mjs';
const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;};
let catalog,state,current='material-03-01',expanded=new Set([3]),editingNote=null,share=false,toastTimer,draftTimer,opener=null,patchRequested=false,contextReady=false,navGeneration=0;
const channel='BroadcastChannel' in window?new BroadcastChannel('devfleet-education-journal'):null;
const $modal=$('modal');
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6000);}
function failure(e){toast(e?.message||'Не удалось завершить действие');console.error('Education action failed:',e?.name||'Error');}
function base(id=current){const m=catalog.materials.find(m=>m.id===id);if(!m)throw Error('Тема не найдена');return m;}
function lesson(){return currentLesson(base(),state);}
async function save(fn,{render=true}={}){state=await mutate(fn);channel?.postMessage({seq:state.seq});if(render)renderAll();return state;}
function action(fn){return async e=>{try{await fn(e);}catch(err){failure(err);}};}
function bind(id,fn){$(id).addEventListener('click',action(fn));}
function button(text,fn,cls='quiet',iconName){const b=el('button',undefined,cls);if(iconName)b.append(icon(iconName));b.append(el('span',text));b.onclick=action(fn);return b;}
function renderTree(){
 const tree=$('course-tree'),q=$('topic-search').value.trim().toLocaleLowerCase('ru-RU'),subject=base().subject;tree.replaceChildren();
 for(const s of catalog.subjects){const all=catalog.materials.filter(m=>m.subject===s.id),matches=q?all.filter(m=>(m.title+' '+s.title).toLocaleLowerCase('ru-RU').includes(q)):all;if(q&&!matches.length)continue;
  const group=el('div',undefined,'subject'+(s.id===subject?' active':'')),toggle=el('button',undefined,'subject-toggle'),title=s.title.replace(/^\d+\s*/,''),open=!!q||expanded.has(s.id);
  toggle.append(el('span',String(s.id).padStart(2,'0'),'subject-no'),el('span',title,'subject-label'),icon('chevron'));toggle.setAttribute('aria-expanded',String(open));toggle.onclick=()=>{expanded.has(s.id)?expanded.delete(s.id):expanded.add(s.id);renderTree();};group.append(toggle);
  if(open){const items=el('div',undefined,'subject-topics');for(const m of matches){const b=el('button',undefined,'topic-link'+(current===m.id?' active':'')+(state.read.includes(m.id)?' read':''));b.dataset.topicId=m.id;b.append(el('span',undefined,'dot'),el('span',m.title,'label'));if(current===m.id)b.setAttribute('aria-current','page');b.onclick=action(()=>go(m.id));items.append(b);}group.append(items);}tree.append(group);
 }
 if(!tree.childElementCount)tree.append(el('p','Темы не найдены. Попробуй другое слово.','empty-state'));
 $('read-count').textContent=`${state.read.length} / ${catalog.materials.length}`;$('read-bar').style.width=`${state.read.length/catalog.materials.length*100}%`;
}
function section(label,text,cls){const s=el('section',undefined,cls);s.append(el('h2',label,'section-label'),el('p',text,cls?'':'theory-text'));return s;}
function details(title,content){const d=el('details',undefined,'lesson-details'),sum=el('summary');sum.append(icon('chevron'),el('span',title));d.append(sum);const body=el('div');typeof content==='string'?body.textContent=content:body.append(content);d.append(body);return d;}
function renderLesson(){
 const m=lesson(),s=catalog.subjects[m.subject];$('subject-name').textContent=s.title.replace(/^\d+\s*/,'');$('lesson-level').textContent=`ОСНОВЫ · УРОК ${String(m.position).padStart(2,'0')} ИЗ 08`;
 $('lesson-title').textContent=m.title;document.title=m.title+' · DevFleet Education';$('lesson-goal').textContent=m.depth.objective;
 $('mark-read').setAttribute('aria-pressed',String(state.read.includes(m.id)));$('mark-read').title=state.read.includes(m.id)?'Убрать отметку прочитано':'Отметить прочитанным';
 $('revision-status').hidden=!m.revision;$('revision-status').textContent=`Редакция ${m.revision} · ${m.origin==='manual_gpt'?'Вручную применённая правка GPT — не проверена независимо':m.origin==='undo'?'Восстановленная редакция':'Твоя редакция материала'}`;
 $('undo-lesson').disabled=!state.pages[m.id]?.history.length;
 const body=$('lesson-body');body.replaceChildren(section('Объяснение с нуля',m.theory));
 const example=section('Пример из практики',m.example,'example-card');
 if(m.subject===3&&m.position<=4){const strip=el('div',undefined,'concept-strip');for(const [i,[label,value]] of [['Источник','9 В'],['Сопротивление','1 кОм'],['Расчётный ток','9 мА']].entries()){if(i)strip.append(icon('arrow-right'));const c=el('div',undefined,'concept-cell');c.append(el('small',label),el('b',value));strip.append(c);}example.append(strip,el('small','Учебная идеальная цепь: I = U / R.','module-note'));}
 body.append(example);const grid=el('div',undefined,'practice-grid');grid.append(section('Попробуй самостоятельно',m.exercise,'practice-card'),section('Проверь понимание',m.check,'practice-card'));body.append(grid);
 const glossary=el('div',undefined,'glossary');m.depth.glossary.forEach(g=>{const n=el('div');n.append(el('b',g.term),el('span',g.meaning));glossary.append(n);});body.append(details('Словарь технических терминов',glossary),details('Углублённый разбор',m.depth.extension));
 if(m.depth.spotlight)body.append(details(m.depth.spotlight.title,m.depth.spotlight.text));
 body.append(details('Распространённая ошибка',m.depth.commonMistake),details('Вопрос для размышления',m.depth.reflection));
 const sources=el('div',undefined,'sources');for(const r of m.depth.references){const u=safeSource(r.url);if(!u)continue;const a=el('a');a.href=u;a.target='_blank';a.rel='noopener noreferrer';a.append(icon('external'),el('span',r.title));sources.append(a);}sources.append(el('small','Источники для сверки. Это не подтверждение актуальности всех нормативов и не аттестация материала.'));body.append(details('Источники и дальнейшее изучение',sources));
 renderModules($('lesson-modules'),m.blocks);renderImages();
 $('chat-topic').textContent=m.title;
 const bound=!!state.bindings[m.id];$('bind-chat').querySelector('span:last-child').textContent=bound?'Беседа привязана':'Привязать беседу';
 const n=state.notes.filter(n=>n.topic===m.id).length;$('note-badge').hidden=!n;$('note-badge').textContent=n;
}
function renderImages(){const host=$('lesson-images');host.replaceChildren();for(const im of state.images.filter(i=>i.topic===current)){const card=el('figure',undefined,'image-card');const image=el('img');image.src=im.data;image.alt=im.title;image.loading='lazy';image.width=im.width;image.height=im.height;const cap=el('figcaption',undefined,'image-caption');cap.append(el('span',im.title),button('Удалить',()=>confirm('Удалить изображение?', 'Оно исчезнет из этого урока. Резервная копия, если она есть, останется прежней.',()=>save(s=>{s.images=s.images.filter(x=>x.id!==im.id);return s;})),'quiet'));card.append(image,cap);host.append(card);}}
function renderNotebook(){
 $('notebook-topic').textContent=base().title;const list=$('notes-list');list.replaceChildren();const notes=state.notes.filter(n=>n.topic===current).sort((a,b)=>b.at.localeCompare(a.at));
 if(!notes.length)list.append(el('p','Здесь появится твой первый конспект. Попробуй объяснить главное своими словами.','empty-state'));
 for(const n of notes){const card=el('article',undefined,'note-card');card.append(el('h4',n.title||'Без заголовка'),el('p',n.body));const meta=el('div',undefined,'note-meta');meta.append(el('small',new Date(n.updated_at||n.at).toLocaleDateString('ru-RU')+(n.source==='manual_gpt'?' · перенесено из GPT':'')));const actions=el('div',undefined,'note-actions');actions.append(button('Изменить',()=>{editingNote={id:n.id,body:n.body};$('note-title').value=n.title;$('note-body').value=n.body;$('save-note').textContent='Сохранить изменения';$('cancel-note').hidden=false;$('note-body').focus();}),button('Удалить',()=>confirm('Удалить запись?','Это действие удалит выбранную запись из тетради.',()=>save(s=>{s.notes=s.notes.filter(x=>x.id!==n.id);return s;}))));meta.append(actions);card.append(meta);list.append(card);}
}
function renderProgress(){const box=$('progress-summary');box.replaceChildren(el('div',`${state.read.length} / 120`,'progress-stat'),el('p','Тем отмечено прочитанными. Это твоя отметка, а не результат экзамена.','muted'));const recent=$('recent-lessons');recent.replaceChildren(el('h3','Последние темы'));for(const id of state.visited.slice(0,8)){const m=base(id);recent.append(button(m.title,()=>{closeDrawer();go(id);},'recent-link'));}}
function renderAll(){if(!contextReady)return;renderTree();renderLesson();renderNotebook();renderProgress();$('storage-status').textContent=`Локальная версия данных: ${state.seq}. Архивных записей: ${state.unassigned.length}. Экспортируй копию перед очисткой браузера.`;}
async function go(id,{replace=false}={}){
 if(!topicId(id)||!catalog.materials.some(m=>m.id===id))id='material-03-01';
 await flushDraft();current=id;navGeneration++;patchRequested=false;editingNote=null;share=false;$('share-notes').checked=false;expanded.add(base().subject);$('question').value=state.drafts[id]||'';resetNote();
 const h='#/'+id;if(location.hash!==h){replace?history.replaceState(null,'',h):history.pushState(null,'',h);}
 state=await mutate(s=>{s.visited=[id,...s.visited.filter(x=>x!==id)].slice(0,120);return s;});channel?.postMessage({seq:state.seq});renderAll();$('lesson-reader').scrollTo({top:0,behavior:'instant'});$('sidebar').classList.remove('open');$('menu-toggle').setAttribute('aria-expanded','false');
}
let pendingDraft=null;
function queueDraft(){pendingDraft={id:current,text:$('question').value};$('draft-status').textContent='Сохраняю черновик…';clearTimeout(draftTimer);draftTimer=setTimeout(()=>flushDraft().catch(failure),350);}
async function flushDraft(){clearTimeout(draftTimer);const d=pendingDraft;if(!d)return;pendingDraft=null;try{await save(s=>{s.drafts[d.id]=d.text;return s;},{render:false});$('draft-status').textContent='Черновик сохранён локально';}catch(e){pendingDraft=d;$('draft-status').textContent='Черновик не сохранён';throw e;}}
function resetNote(){editingNote=null;$('note-form').reset();$('cancel-note').hidden=true;$('save-note').textContent='Сохранить запись';}
function openDrawer(tab='notebook'){
 opener=document.activeElement;$('drawer').hidden=false;$('drawer-backdrop').hidden=false;document.querySelectorAll('[data-tab]').forEach(n=>n.setAttribute('aria-selected',String(n.dataset.tab===tab)));for(const id of ['notebook','progress','settings'])$('panel-'+id).hidden=id!==tab;$('drawer-title').textContent={notebook:'Твоя тетрадь',progress:'Учебный прогресс',settings:'Настройки и данные'}[tab];renderNotebook();renderProgress();$('close-drawer').focus();
}
function closeDrawer(){$('drawer').hidden=true;$('drawer-backdrop').hidden=true;opener?.focus?.();}
function showModal(title,node){$('modal-title').textContent=title;$('modal-body').replaceChildren(node);if(!$modal.open)$modal.showModal();}
function closeModal(){$modal.close();}
function confirm(title,text,fn){const box=el('div',undefined,'modal-stack');box.append(el('p',text));const actions=el('div',undefined,'actions');actions.append(button('Отмена',closeModal,'quiet'),button('Подтвердить',async()=>{await fn();closeModal();toast('Готово');},'primary'));box.append(actions);showModal(title,box);}
function context(){return buildContext(lesson(),state,{question:$('question').value,shareNotes:share,patch:patchRequested});}
async function copyText(text){if(!navigator.clipboard?.writeText)throw Error('Браузер не разрешил буфер обмена. Открой «Что передаётся» и скопируй текст вручную.');await navigator.clipboard.writeText(text);}
function contextDialog(){const box=el('div',undefined,'modal-stack');box.append(el('p',share?'Включены выбранный урок, вопрос и записи тетради этой темы.':'Включены выбранный урок и вопрос. Личная тетрадь исключена.'));const pre=el('textarea');pre.value=context();pre.readOnly=true;pre.setAttribute('aria-label','Подготовленный контекст');box.append(pre,button('Скопировать',async()=>{await copyText(pre.value);toast('Контекст скопирован. Сообщение не отправлено.');},'primary'));showModal('Что будет передано в ChatGPT',box);}
function bindDialog(){const id=current,box=el('div',undefined,'modal-stack'),input=el('input');input.type='url';input.placeholder='https://chatgpt.com/c/…';input.value=state.bindings[id]||'';input.setAttribute('aria-label','Ссылка на беседу ChatGPT');box.append(el('p','Открой свою беседу в ChatGPT, скопируй адрес и сохрани здесь. Один чат — одна тема. Выбор модели сайт не проверяет.'),input,button('Сохранить привязку',async()=>{const url=canonicalChat(input.value.trim());await save(s=>{if(Object.entries(s.bindings).some(([topic,u])=>topic!==id&&u===url))throw Error('Эта беседа уже привязана к другой теме');s.bindings[id]=url;return s;});closeModal();toast('Беседа привязана к теме');},'primary'));
 if(state.bindings[id])box.append(button('Убрать привязку',async()=>{await save(s=>{delete s.bindings[id];return s;});closeModal();},'quiet'));showModal('Беседа для этой темы',box);}
function editDialog(){const m=lesson(),revision=m.revision,id=current,box=el('div',undefined,'modal-stack'),fields={};box.append(el('p','Меняется только твоя локальная редакция этой темы. Исходный материал можно восстановить откатом.'));
 for(const [k,title] of [['theory','Объяснение'],['example','Пример'],['exercise','Упражнение'],['check','Контрольный вопрос']]){const l=el('label',title),t=el('textarea');t.value=m[k];t.maxLength=8000;t.style.minHeight='100px';fields[k]=t;l.append(t);box.append(l);}
 const acts=el('div',undefined,'actions');acts.append(button('Добавить виртуальный калькулятор',async()=>{await save(s=>changePage(s,base(id),{}, {origin:'student',expectedRevision:revision,blocks:[...m.blocks,basicOhmBlock()]}));closeModal();toast('В урок добавлен калькулятор');},'secondary'),button('Сохранить',async()=>{const changes=Object.fromEntries(Object.entries(fields).map(([k,n])=>[k,n.value]));await save(s=>changePage(s,base(id),changes,{origin:'student',expectedRevision:revision}));closeModal();toast('Редакция сохранена');},'primary'));box.append(acts);showModal('Редактировать материал',box);}
function patchDialog(){const id=current,m=lesson(),box=el('div',undefined,'modal-stack'),text=el('textarea');text.placeholder='Вставь JSON-правку из ChatGPT';text.maxLength=100000;text.setAttribute('aria-label','Структурированная правка урока');box.append(el('p','Ответы ChatGPT не загружаются автоматически. Вставь подготовленную правку, проверь изменения и только затем примени.'),text,button('Проверить правку',()=>{const p=parsePatch(text.value,id,m.revision);const review=el('div',undefined,'modal-stack');review.append(el('p','Изменения ещё не сохранены. Проверь формулы, факты и условия безопасности.','warning'));for(const [k,v] of Object.entries(p.changes)){const d=el('div',undefined,'diff-item');d.append(el('b',k),el('p',v));review.append(d);}if(p.blocks)review.append(el('p',`Список модулей будет заменён: ${p.blocks.length} блоков.`));review.append(button('Применить к этой теме',async()=>{await save(s=>changePage(s,base(id),p.changes,{origin:'manual_gpt',expectedRevision:p.base_revision,blocks:p.blocks}));closeModal();toast('Правка применена. Доступен откат.');},'primary'));showModal('Проверка изменений',review);},'primary'));showModal('Применить правку из ChatGPT',box);}
function download(name,text,type='application/json'){const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function exportData(){await flushDraft();state=await loadState();download(`education-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(state,null,2));toast('Резервная копия скачана');}
async function importFile(file){if(!file)return;if(file.size>MAX_BYTES)throw Error('Файл больше 24 МБ');const raw=JSON.parse(await file.text());const {state:incoming,kind}=migrateDesktop(raw);confirm('Импортировать учебные данные?',`${kind==='desktop'?'Настольный журнал':'Резервная копия сайта'}: ${importSummary(incoming)}. Текущие данные этого сайта будут заменены. Сначала будет скачана их резервная копия.`,async()=>{await exportData();state=await replaceState(incoming);channel?.postMessage({seq:state.seq});resetNote();$('question').value=state.drafts[current]||'';renderAll();});}
async function importImage(file,id){if(!file)return;if(!['image/png','image/jpeg'].includes(file.type)||file.size>8*1024*1024)throw Error('Нужны PNG/JPEG до 8 МБ');inspectRaster(new Uint8Array(await file.arrayBuffer()));const bmp=await createImageBitmap(file);try{if(bmp.width*bmp.height>16000000)throw Error('Разрешение больше 16 миллионов пикселей');const ratio=Math.min(1,1600/Math.max(bmp.width,bmp.height)),canvas=el('canvas');canvas.width=Math.max(1,Math.round(bmp.width*ratio));canvas.height=Math.max(1,Math.round(bmp.height*ratio));canvas.getContext('2d').drawImage(bmp,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/png');if(data.length>2000000)throw Error('Изображение после обработки слишком велико; уменьши его');await save(s=>{if(s.images.filter(i=>i.topic===id).length>=12)throw Error('Не более 12 изображений на тему');s.images.push({id:crypto.randomUUID(),topic:id,title:file.name.slice(0,160),data,width:canvas.width,height:canvas.height});return s;});toast('Изображение сохранено только в этом браузере');}finally{bmp.close();}}
function wire(){
 decorate();$('topic-search').oninput=renderTree;
 bind('menu-toggle',()=>{const open=$('sidebar').classList.toggle('open');$('menu-toggle').setAttribute('aria-expanded',String(open));});
 bind('mark-read',()=>{const id=current;return save(s=>{s.read=s.read.includes(id)?s.read.filter(x=>x!==id):[...s.read,id];return s;});});
 bind('next-lesson',()=>{const i=catalog.materials.findIndex(m=>m.id===current);return go(catalog.materials[(i+1)%catalog.materials.length].id);});
 bind('open-notebook',()=>openDrawer('notebook'));bind('open-settings',()=>openDrawer('settings'));bind('data-menu',()=>openDrawer('settings'));bind('close-drawer',closeDrawer);bind('drawer-backdrop',closeDrawer);
 document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>openDrawer(b.dataset.tab));
 bind('close-modal',closeModal);$modal.addEventListener('click',e=>{if(e.target===$modal){const r=$modal.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeModal();}});
 $('note-form').onsubmit=action(async e=>{e.preventDefault();const id=current,title=$('note-title').value.trim(),body=$('note-body').value.trim();if(!body)throw Error('Напиши текст записи');const edit=editingNote;await save(s=>{if(edit){const n=s.notes.find(n=>n.id===edit.id&&n.topic===id);if(!n||n.body!==edit.body)throw Error('Запись изменена в другой вкладке; открой её заново');n.title=title;n.body=body;n.updated_at=new Date().toISOString();}else s.notes.push({id:crypto.randomUUID(),topic:id,title,body,source:'student',at:new Date().toISOString()});return s;});resetNote();toast('Запись сохранена');});
 bind('cancel-note',resetNote);$('question').oninput=queueDraft;document.querySelectorAll('[data-prompt]').forEach(b=>b.onclick=()=>{$('question').value=b.dataset.prompt;patchRequested=false;queueDraft();$('question').focus();});
 bind('request-patch',()=>{patchRequested=true;$('question').value='Улучши объяснение и пример этого урока. Подготовь структурированную правку для ручного применения.';queueDraft();$('question').focus();toast('В контекст будет включена схема правки');});
 $('share-notes').onchange=()=>{share=$('share-notes').checked;};
 bind('preview-context',contextDialog);bind('bind-chat',bindDialog);bind('edit-lesson',editDialog);bind('apply-reply',patchDialog);
 bind('undo-lesson',()=>{const id=current;return save(s=>undoPage(s,base(id)));});
 bind('open-chatgpt',async()=>{
  const text=context(),url=state.bindings[current]||'https://chatgpt.com/';
  // Popup is opened synchronously from the user's gesture, never after hidden work.
  const w=window.open(url,'_blank','noopener,noreferrer');
  try{await copyText(text);toast('Контекст скопирован. Вставь его в ChatGPT и отправь вручную.');}catch(e){contextDialog();throw e;}
  await flushDraft();
 });
 let excerpt='';$('lesson-reader').addEventListener('mouseup',()=>{const s=getSelection();excerpt=s?.anchorNode&&$('lesson-reader').contains(s.anchorNode)?s.toString().trim().slice(0,1800):'';});
 bind('ask-selection',()=>{$('question').value=excerpt?'Объясни этот фрагмент урока подробнее: «'+excerpt+'»':'Объясни мне этот урок по шагам. Проверь мои исходные знания.';queueDraft();$('question').focus();});
 bind('export-data',exportData);bind('import-data',()=>{$('data-file').value='';$('data-file').click();});$('data-file').onchange=action(()=>importFile($('data-file').files[0]));
 bind('persist-storage',async()=>{const granted=await navigator.storage?.persist?.();toast(granted?'Браузер разрешил устойчивое хранение. Резервная копия всё равно полезна.':'Браузер не предоставил устойчивое хранение. Скачивай резервные копии.');});
 let imageTopic;bind('add-image',()=>{imageTopic=current;$('image-file').value='';$('image-file').click();});$('image-file').onchange=action(()=>importImage($('image-file').files[0],imageTopic));
 const splitter=$('splitter');let dragging=false;function resize(y){const r=$('workspace').getBoundingClientRect();const h=Math.max(230,Math.min(r.height-240,r.bottom-y));$('workspace').style.setProperty('--chat-height',h+'px');splitter.setAttribute('aria-valuenow',Math.round(h/r.height*100));}
 splitter.onpointerdown=e=>{dragging=true;splitter.setPointerCapture(e.pointerId);resize(e.clientY);e.preventDefault();};splitter.onpointermove=e=>{if(dragging)resize(e.clientY);};splitter.onpointerup=e=>{dragging=false;splitter.releasePointerCapture(e.pointerId);};splitter.onpointercancel=()=>dragging=false;
 splitter.onkeydown=e=>{if(e.key==='Home'){$('workspace').style.removeProperty('--chat-height');e.preventDefault();}else if(['ArrowUp','ArrowDown'].includes(e.key)){resize(splitter.getBoundingClientRect().top+(e.key==='ArrowUp'?-24:24));e.preventDefault();}};
 document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){closeDrawer();$('sidebar').classList.remove('open');$('menu-toggle').setAttribute('aria-expanded','false');}
  if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();$('topic-search').focus();}
  if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&document.activeElement===$('question')&&!e.isComposing){e.preventDefault();$('open-chatgpt').click();}
  if(e.key==='Tab'&&!$('drawer').hidden){const items=[...$('drawer').querySelectorAll('button,input,textarea,a,select')].filter(n=>!n.disabled&&n.getClientRects().length);if(e.shiftKey&&document.activeElement===items[0]){e.preventDefault();items.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===items.at(-1)){e.preventDefault();items[0]?.focus();}}
 });
 window.addEventListener('popstate',()=>go(location.hash.slice(2),{replace:true}).catch(failure));
 document.addEventListener('visibilitychange',()=>{if(document.hidden)flushDraft().catch(()=>{});});
 window.addEventListener('beforeunload',e=>{if(pendingDraft){e.preventDefault();e.returnValue='';}});
 channel&&(channel.onmessage=async()=>{try{const s=await loadState();if(s.seq>state.seq){state=s;renderAll();}}catch(e){failure(e);}});
 let installEvent;window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installEvent=e;$('install-app').hidden=false;});bind('install-app',async()=>{if(installEvent){await installEvent.prompt();installEvent=null;$('install-app').hidden=true;}});
}
async function start(){
 const res=await fetch('/data/course.json');if(!res.ok)throw Error('Не удалось загрузить программу обучения');catalog=await res.json();if(catalog.materials.length!==120||catalog.subjects.length!==15)throw Error('Учебная программа повреждена');state=await openStore();wire();contextReady=true;current=topicId(location.hash.slice(2))?location.hash.slice(2):'material-03-01';await go(current,{replace:true});
 if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
}
start().catch(e=>{const n=el('div',undefined,'fatal');n.append(el('h2','Не удалось открыть учебный кабинет'),el('p',e.message),button('Перезагрузить',()=>location.reload(),'primary'));document.body.append(n);});
