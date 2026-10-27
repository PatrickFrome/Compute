'use strict';
// Production Electron/IPC/store/transport. Deterministic provider; zero paid calls.
const {app,BrowserWindow,ipcMain,safeStorage,nativeImage}=require('electron');
const fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),dir=sync.mkdtempSync(path.join(os.tmpdir(),'education-e9-workspace-'));
const receipt=path.join(os.tmpdir(),'education-e9-workspace-receipt.json');app.setPath('userData',dir);
let win,complete=false;const pause=ms=>new Promise(r=>setTimeout(r,ms));
const watchdog=setTimeout(()=>failed(Error('workspace_timeout')),60000);
async function atomic(file,data){const t=file+'.tmp-'+crypto.randomUUID();await fs.writeFile(t,data,{mode:0o600});await fs.rename(t,file);}
async function run(){
 await app.whenReady();
 const {EducationStore}=await import('../src/education-core.mjs');
 const {installLiveEducation}=await import('../src/education-live-electron.mjs');
 const {LiveLessonStore}=await import('../src/education-live-core.mjs');
 const {buildEducationHandoff}=await import('../src/education-handoff.mjs');
 let state=null;const education=new EducationStore({load:async()=>state,save:async v=>{state=structuredClone(v);}});await education.init();
 if(!safeStorage.isEncryptionAvailable())throw Error('secure_storage_missing');
 await atomic(path.join(dir,'education-openai-key.bin'),safeStorage.encryptString('sk-'+('fake_test_noncredential_').repeat(2)));
 await atomic(path.join(dir,'education-openai-config.json'),JSON.stringify({model:'mock-model',accept_billing:true}));
 const trustedURL=pathToFileURL(path.join(root,'src','education.html')).href;
 const authorize=e=>{if(!win||e.sender!==win.webContents||e.senderFrame!==e.sender.mainFrame||e.sender.getURL()!==trustedURL)throw Error('live_origin_denied');};
 let calls=[],asset,release;const gate=new Promise(r=>release=r);
 const modules=()=>[
  {id:'concept',kind:'diagram',title:'От источника к электрическому току',nodes:[{id:'battery',label:'Источник: 9 В'},{id:'resistor',label:'Резистор: 1000 Ом'},{id:'current',label:'Ток: 9 мА'}],edges:[{from:'battery',to:'resistor',label:'напряжение'},{from:'resistor',to:'current',label:'I = U / R'}],caption:'Учебная идеальная модель. Схема сформирована тестовым поставщиком.'},
  {id:'lab',kind:'ohm_lab',title:'Попробуй изменить напряжение',voltage:9,resistance:1000},
  {id:'table',kind:'table',title:'Сравнение трёх режимов',columns:['Напряжение','Сопротивление','Ток'],rows:[['3 В','1000 Ом','3 мА'],['6 В','1000 Ом','6 мА'],['9 В','1000 Ом','9 мА']]},
  {id:'quiz',kind:'quiz',title:'Проверь понимание',question:'Сопротивление выросло вдвое при прежнем напряжении. Что станет с током?',choices:['Увеличится вдвое','Уменьшится вдвое','Не изменится'],correct_index:1,explanation:'В идеальной омической модели I = U / R. Это тестовый ключ, не аттестация.'},
  {id:'picture',kind:'image',title:'Локальная иллюстрация',asset_id:asset.id,alt:'Цветной образец для проверки загрузки изображения',caption:'Тестовое изображение из локального хранилища этой темы.'}
 ];
 const live=await installLiveEducation({ipcMain,authorize,education,dataDir:dir,writeAtomic:atomic,window:()=>win,fetchImpl:async(endpoint,options)=>{
  if(endpoint!=='https://api.openai.com/v1/responses')throw Error('wrong_endpoint');const input=JSON.parse(JSON.parse(options.body).input[0].content);calls.push(input);if(calls.length===1)await gate;
  const answer={reply:'Добавил схему, виртуальный калькулятор, таблицу, мини-тест и локальное изображение. Это тестовый ответ, не настоящая генерация GPT.',change_summary:'Созданы пять проверяемых типов учебных модулей',edits:[{field:'example',text:'При 9 В и сопротивлении 1000 Ом ток равен 9 мА. Меняй значения в виртуальном модуле ниже.'}],block_ops:modules().map((block,position)=>({op:'upsert',id:block.id,position,block}))};
  return new Response(JSON.stringify({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(answer)}]}]}));
 }});
 const pixels=Buffer.alloc(160*80*4);for(let i=0;i<pixels.length;i+=4){pixels[i]=145;pixels[i+1]=185;pixels[i+2]=65;pixels[i+3]=255;}
 asset=await live.assets.addNormalized('material-03-01',nativeImage.createFromBitmap(pixels,{width:160,height:80}).toPNG(),'Учебный образец PNG');
 const on=(name,fn)=>ipcMain.handle(name,(e,...args)=>{authorize(e);return fn(...args);});
 on('education:snapshot',()=>({...education.snapshot(),materials:live.store.materials()}));on('devfleet:list',()=>({sessions:[]}));on('education:show-material',()=>({mode:'material'}));on('education:viewport',b=>b);
 on('education:preview-handoff',(id,opts)=>buildEducationHandoff(id,education.snapshot().study_contexts,education.snapshot().notebook_entries,opts||{},live.store.material(id)));
 on('education:notebook-add',p=>education.addNotebookEntry(p));
 win=new BrowserWindow({show:false,width:1480,height:960,webPreferences:{preload:path.join(root,'src','education-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}});win.setMenuBarVisibility(false);
 const js=code=>win.webContents.executeJavaScript(code);async function until(fn,label){for(let i=0;i<180;i++){if(await fn())return;await pause(20);}throw Error('wait_'+label);}
 await win.loadFile(path.join(root,'src','education.html'));
 await until(()=>js("document.getElementById('live-topic').textContent.includes('напряжение')&&!document.getElementById('live-send').disabled"),'initial');
 if(calls.length)throw Error('automatic_request');
 const geometry=()=>js(`(()=>{const r=id=>{const x=document.getElementById(id).getBoundingClientRect();return {x:x.x,y:x.y,width:x.width,height:x.height,bottom:x.bottom,right:x.right};};return {reader:r('lesson-reader'),chat:r('live-tutor'),input:r('live-input'),send:r('live-send'),hidden:document.getElementById('study-drawer').hidden,overflow:document.documentElement.scrollWidth>innerWidth+1,viewport:innerHeight};})()`);
 const initial=await geometry();if(!initial.hidden||initial.reader.bottom>initial.chat.y+1||initial.chat.height<230||initial.input.height<40||initial.send.bottom>initial.viewport+1||initial.overflow)throw Error('initial_layout_'+JSON.stringify(initial));
 await js("document.getElementById('toggle-notebook').click()");if(await js("document.getElementById('study-drawer').hidden||document.getElementById('drawer-notebook').hidden"))throw Error('drawer_notebook');
 await js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");if(!await js("document.getElementById('study-drawer').hidden"))throw Error('escape_drawer');
 await js("document.getElementById('lesson-splitter').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}))");await pause(80);if((await geometry()).chat.height<=initial.chat.height+15)throw Error('splitter_keyboard');
 await js("document.getElementById('lesson-splitter').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}))");
 const dimensions=[];for(const size of [[980,760],[1366,768],[1480,960]]){win.setSize(...size);await pause(120);const g=await geometry();dimensions.push({...g,size});if(g.overflow||g.reader.height<150||g.input.height<38||g.send.bottom>g.viewport+1||g.reader.bottom>g.chat.y+1)throw Error('responsive_layout_'+JSON.stringify(g));}
 await js("document.getElementById('topic-search').value='рефлект';document.getElementById('topic-search').dispatchEvent(new Event('input'))");const filtered=await js("[...document.querySelectorAll('#tree .material-chat')].filter(x=>!x.hidden).length");if(filtered<1||filtered>=120)throw Error('topic_filter');await js("document.getElementById('topic-search').value='';document.getElementById('topic-search').dispatchEvent(new Event('input'))");
 const base=live.store.material('material-03-01').example;
 await js("document.getElementById('live-input').value='Добавь схему и интерактивные модули';document.getElementById('live-send').click()");await until(()=>calls.length===1,'first_request');
 if(calls[0].context.available_images.length!==1||calls[0].context.available_images[0].id!==asset.id||calls[0].context.image_pixels_included!==false)throw Error('image_metadata_context');
 await js("document.querySelector('[data-material-id=\"material-11-05\"]').click()");await until(()=>js("document.getElementById('live-topic').textContent.includes('OTDR')"),'switch');
 await js("document.getElementById('live-input').value='Черновик рефлектометрии';document.getElementById('live-input').dispatchEvent(new Event('input'))");release();await until(()=>live.store.topic('material-03-01').version===1,'first_update');await pause(100);
 if(live.store.material('material-11-05').blocks.length||await js("document.getElementById('live-input').value")!=='Черновик рефлектометрии')throw Error('cross_topic');
 await js("document.querySelector('[data-material-id=\"material-03-01\"]').click()");await until(()=>js("document.querySelectorAll('#lesson-blocks .module-card').length===5"),'modules_rendered');
 await js("document.querySelector('[data-block-id=picture]').scrollIntoView({block:'center'})");await until(()=>js("document.querySelector('[data-block-id=picture] img')?.naturalWidth>0"),'image_decoded');
 if(!await js("document.querySelector('[data-block-id=concept] svg')!==null"))throw Error('diagram_missing');
 await js("const input=document.querySelector('[data-block-id=lab] input');input.value='12';input.dispatchEvent(new Event('input'))");if(!await js("document.querySelector('[data-block-id=lab] output').textContent.includes('12 мА')"))throw Error('calculator');
 await js("document.querySelectorAll('[data-block-id=quiz] button')[1].click()");if(!await js("document.querySelector('[data-block-id=quiz] [role=status]').textContent.includes('совпадает')"))throw Error('quiz');
 await until(()=>js("!document.getElementById('live-undo').disabled"),'undo_ready');await js("document.getElementById('live-undo').click()");await until(()=>js("document.querySelectorAll('#lesson-blocks .module-card').length===0&&document.getElementById('live-version').textContent.includes('Редакция 2')&&!document.getElementById('live-send').disabled"),'undo_modules');if(live.store.material('material-03-01').example!==base)throw Error('undo_text');
 await js("document.getElementById('live-input').value='Верни модули на страницу';document.getElementById('live-send').click()");await until(()=>js("document.querySelectorAll('#lesson-blocks .module-card').length===5&&document.getElementById('live-version').textContent.includes('Редакция 3')&&!document.getElementById('live-send').disabled"),'second_modules');
 const reopened=new LiveLessonStore({load:async()=>JSON.parse(await fs.readFile(path.join(dir,'education-live-state.json'),'utf8')),save:async v=>atomic(path.join(dir,'education-live-state.json'),JSON.stringify(v))});await reopened.init();if(reopened.material('material-03-01').blocks.length!==5||reopened.material('material-11-05').blocks.length)throw Error('restart_blocks');
 win.showInactive();await js("document.getElementById('lesson-reader').style.scrollBehavior='auto';document.getElementById('lesson-reader').scrollTo({top:0,behavior:'instant'})");await pause(400);const overview=path.join(dir,'workspace-overview.png');await fs.writeFile(overview,(await win.webContents.capturePage()).toPNG());
 await js("document.querySelector('[data-block-id=concept]').scrollIntoView({block:'start'})");await pause(250);const modulesShot=path.join(dir,'workspace-modules.png');await fs.writeFile(modulesShot,(await win.webContents.capturePage()).toPNG());
 await js("document.getElementById('toggle-notebook').click()");if(await js("document.getElementById('study-drawer').hidden"))throw Error('drawer_final');await js("document.getElementById('close-drawer').click()");
 await js('window.devfleet.education.liveDisconnect()');const disconnected=await js('window.devfleet.education.liveStatus()');if(disconnected.ready)throw Error('disconnect');
 await win.reload();await until(()=>js("document.getElementById('live-topic').textContent.includes('напряжение')"),'reload');if(!await js("document.getElementById('study-drawer').hidden"))throw Error('drawer_not_closed_restart');
 const result={state:'PASS',schema:'education.workspace.smoke.v1',provider:'deterministic_mock',real_api_calls:0,simulated_responses:calls.length,layout:'material_above_chat',drawer_closed_default:true,responsive_sizes:dimensions.map(x=>x.size),resizable_splitter:true,topic_filter:true,module_types:['diagram','ohm_lab','table','quiz','image'],local_image_decoded:true,images_metadata_only:true,dynamic_modules:true,undo_text_and_modules:true,cross_topic_isolation:true,restart:true,screenshots:[overview,modulesShot],profile:dir};
 await fs.writeFile(receipt,JSON.stringify(result,null,2));console.log(JSON.stringify(result));complete=true;clearTimeout(watchdog);win.destroy();app.quit();
}
async function failed(e){if(complete)return;complete=true;clearTimeout(watchdog);const result={state:'FAIL',error:String(e?.stack||e).slice(0,5000),real_api_calls:0,profile:dir};await fs.writeFile(receipt,JSON.stringify(result,null,2)).catch(()=>{});console.error(JSON.stringify(result));app.exit(1);}run().catch(failed);
