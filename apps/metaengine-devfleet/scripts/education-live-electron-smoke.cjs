'use strict';
// Real Electron + production IPC/store/transport, deterministic fake API only.
// No real credentials, ChatGPT login, internet request, or installed profile.
const {app,BrowserWindow,ipcMain,safeStorage}=require('electron');
const fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
const dir=sync.mkdtempSync(path.join(os.tmpdir(),'education-e8-live-smoke-'));
const receipt=path.join(os.tmpdir(),'education-e8-live-smoke-receipt.json');
app.setPath('userData',dir);
let win;let completed=false;
const watchdog=setTimeout(()=>finishError(Error('smoke_timeout')),45000);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function atomic(file,data){const tmp=file+'.tmp-'+crypto.randomUUID();await fs.writeFile(tmp,data,{mode:0o600});await fs.rename(tmp,file);}
async function run(){
 await app.whenReady();
 const {EducationStore}=await import('../src/education-core.mjs');
 const {installLiveEducation}=await import('../src/education-live-electron.mjs');
 const {LiveLessonStore}=await import('../src/education-live-core.mjs');
 const {buildEducationHandoff}=await import('../src/education-handoff.mjs');
 let edState=null;
 const education=new EducationStore({load:async()=>edState,save:async s=>{edState=structuredClone(s);}});await education.init();
 if(!safeStorage.isEncryptionAvailable())throw Error('smoke_secure_storage_unavailable');
 const fake='sk-'+('fake_noncredential_smoke_').repeat(2);
 await atomic(path.join(dir,'education-openai-key.bin'),safeStorage.encryptString(fake));
 await atomic(path.join(dir,'education-openai-config.json'),JSON.stringify({model:'mock-model',accept_billing:true}));
 const url=pathToFileURL(path.join(root,'src','education.html')).href;
 const authorize=e=>{if(!win||e.sender!==win.webContents||e.senderFrame!==e.sender.mainFrame||e.sender.getURL()!==url)throw Error('live_origin_denied');};
 let calls=[],releaseFirst;
 const gate=new Promise(r=>{releaseFirst=r;});
 const live=await installLiveEducation({ipcMain,authorize,education,dataDir:dir,writeAtomic:atomic,window:()=>win,
  fetchImpl:async(endpoint,options)=>{
   if(endpoint!=='https://api.openai.com/v1/responses')throw Error('smoke_wrong_endpoint');
   const body=JSON.parse(options.body),input=JSON.parse(body.input[0].content);calls.push(input);
   if(calls.length===1)await gate;
   const answer={reply:'Тестовый ответ о напряжении. Это имитация поставщика, не генерация GPT.',
    change_summary:'Добавлен пример из теста',edits:[{field:'example',text:calls.length===1?'E8_UPDATED_EXAMPLE: 9 В / 1000 Ом = 9 мА.':'<script>window.__injected=true</script> E8_PLAIN_TEXT'}]};
   return new Response(JSON.stringify({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(answer)}]}]}));
  }});
 const on=(name,fn)=>ipcMain.handle(name,(e,...a)=>{authorize(e);return fn(...a);});
 on('education:snapshot',()=>({...education.snapshot(),materials:live.store.materials()}));
 on('devfleet:list',()=>({sessions:[]}));on('education:show-material',()=>({mode:'study_material'}));
 on('education:preview-handoff',(id,opts)=>buildEducationHandoff(id,education.snapshot().study_contexts,
  education.snapshot().notebook_entries,opts||{},live.store.material(id)));
 on('education:notebook-add',p=>education.addNotebookEntry(p));
 win=new BrowserWindow({show:false,width:1480,height:960,webPreferences:{
  preload:path.join(root,'src','education-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}});
 const js=s=>win.webContents.executeJavaScript(s);
 async function until(check,label){for(let i=0;i<150;i++){if(await check())return;await pause(20);}throw Error('smoke_wait_'+label);}
 await win.loadFile(path.join(root,'src','education.html'));
 await until(()=>js("document.getElementById('live-topic').textContent.includes('напряжение')&&!document.getElementById('live-send').disabled"),'initial_topic');
 if(calls.length)throw Error('smoke_automatic_generation');
 const initial=await js("document.getElementById('material-example').textContent");
 const beforeB=live.store.material('material-11-05').example;
 await js("document.getElementById('live-input').value='Упрости и обнови пример';document.getElementById('live-send').click()");
 await until(()=>calls.length===1,'first_api');
 if(calls[0].context.material_id!=='material-03-01'||calls[0].context.notes.length)throw Error('smoke_wrong_context');
 await js("document.querySelectorAll('#tree .material-chat')[92].click()");
 await until(()=>js("document.getElementById('live-topic').textContent.includes('Принцип OTDR')"),'switch_topic');
 const bDraft='Мой вопрос о рефлектометрии';
 await js("document.getElementById('live-input').value="+JSON.stringify(bDraft)+";document.getElementById('live-input').dispatchEvent(new Event('input'))");
 releaseFirst();
 await until(()=>live.store.topic('material-03-01').version===1,'first_update');await pause(100);
 if(live.store.material('material-11-05').example!==beforeB)throw Error('smoke_cross_topic_edit');
 if(await js("document.getElementById('live-input').value")!==bDraft)throw Error('smoke_other_topic_draft_lost');
 if(!(await js("document.getElementById('material-title').textContent")).includes('Принцип OTDR'))throw Error('smoke_focus_stolen');
 await js("document.querySelectorAll('#tree .material-chat')[24].click()");
 await until(()=>js("document.getElementById('live-messages').textContent.includes('Тестовый ответ')"),'return_a');
 if(!(await js("document.getElementById('material-example').textContent")).includes('E8_UPDATED_EXAMPLE'))throw Error('smoke_page_not_updated');
 await js("document.getElementById('live-undo').click()");
 await until(()=>live.store.topic('material-03-01').version===2,'undo');
 await until(()=>js("document.getElementById('material-example').textContent") .then(v=>v===initial),'undo_dom');
 if(live.store.topic('material-03-01').turns.length!==2)throw Error('smoke_undo_deleted_history');
 await until(()=>js("document.getElementById('live-version').textContent.includes('Редакция 2')&&!document.getElementById('live-send').disabled"),'undo_ui_ready');
 await education.addNotebookEntry({notebook_key:'material-03-01',title:'Моя заметка',body:'ONLY_A_NOTE'});
 await education.addNotebookEntry({notebook_key:'material-11-05',title:'Другая заметка',body:'FOREIGN_NOTE'});
 await js("document.getElementById('notebook-include-gpt').checked=true;document.getElementById('live-input').value='Обнови текст и учти конспект';document.getElementById('live-send').click()");
 await until(()=>calls.length===2&&live.store.topic('material-03-01').version===3,'second_update');
 await until(()=>js("document.getElementById('material-example').textContent.includes('E8_PLAIN_TEXT')"),'literal_dom');
 if(await js('window.__injected!==undefined'))throw Error('smoke_executable_model_text');
 const context=JSON.stringify(calls[1].context);if(!context.includes('ONLY_A_NOTE')||context.includes('FOREIGN_NOTE'))throw Error('smoke_notes_leak');
 const reopened=new LiveLessonStore({load:async()=>JSON.parse(await fs.readFile(path.join(dir,'education-live-state.json'),'utf8')),save:async v=>atomic(path.join(dir,'education-live-state.json'),JSON.stringify(v))});await reopened.init();
 if(reopened.topic('material-03-01').turns.length!==4||reopened.topic('material-11-05').turns.length!==0)throw Error('smoke_restart_history');
 await until(()=>js("document.getElementById('live-version').textContent.includes('Редакция 3')&&!document.getElementById('live-send').disabled"),'final_ui_ready');
 win.showInactive();await pause(250);
 const screenshot=path.join(dir,'live-lesson-ui.png');await fs.writeFile(screenshot,(await win.webContents.capturePage()).toPNG());
 await js('window.devfleet.education.liveDisconnect()');
 const status=await js('window.devfleet.education.liveStatus()');if(status.ready)throw Error('smoke_disconnect');
 if(sync.existsSync(path.join(dir,'education-openai-key.bin')))throw Error('smoke_key_not_deleted');
 const result={state:'PASS',schema:'education.live.smoke.v1',real_electron:process.versions.electron,
  provider:'deterministic_mock',real_api_calls:0,simulated_responses:calls.length,
  production_ipc:true,production_transport:true,topic_switch:true,history_restart:true,
  dynamic_page_update:true,undo:true,notebook_opt_in:true,cross_topic_isolation:true,
  html_text_not_executed:true,disconnect:true,screenshot,profile:dir};
 await fs.writeFile(receipt,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 completed=true;clearTimeout(watchdog);win.destroy();app.quit();
}
async function finishError(e){if(completed)return;completed=true;clearTimeout(watchdog);
 const result={state:'FAIL',error:String(e?.stack||e).slice(0,3500),real_api_calls:0,profile:dir};
 await fs.writeFile(receipt,JSON.stringify(result,null,2)).catch(()=>{});console.error(JSON.stringify(result));app.exit(1);}
run().catch(finishError);
