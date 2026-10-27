const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const dir=require('node:fs').mkdtempSync(path.join(os.tmpdir(),'education-e10-web-'));
app.setPath('userData',dir);let win,done=false;
const receipt=path.join(os.tmpdir(),'education-webchat-smoke.json');
const watchdog=setTimeout(()=>finish({state:'FAIL',error:'timeout'}),30000);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function finish(result){if(done)return;done=true;clearTimeout(watchdog);await fs.writeFile(receipt,JSON.stringify(result,null,2));console.log(JSON.stringify(result));win?.destroy();app.exit(result.state==='PASS'?0:1);}
async function run(){await app.whenReady();
 const root=path.resolve(__dirname,'..');
 const {EducationStore}=await import('../src/education-core.mjs');
 const {installLiveEducation}=await import('../src/education-live-electron.mjs');
 const {installWebChats}=await import('../src/education-webchat-electron.mjs');
 const {buildEducationHandoff}=await import('../src/education-handoff.mjs');
 let saved=null,calls=0,opened=[],copied=[],sessions=[],visible=null,bounds=null;
 const education=new EducationStore({load:async()=>saved,save:async s=>{saved=structuredClone(s);}});await education.init();
 const atomic=async(p,s)=>{await fs.writeFile(p+'.tmp',s);await fs.rename(p+'.tmp',p);};
 await atomic(path.join(dir,'education-openai-config.json'),JSON.stringify({model:'should-not-run',accept_billing:true}));
 await fs.writeFile(path.join(dir,'education-openai-key.bin'),'test-fixture-not-a-real-key');
 const authorize=e=>{if(!win||e.sender!==win.webContents||e.senderFrame!==win.webContents.mainFrame||e.sender.getURL()!==pathToFileURL(path.join(root,'src/education.html')).href)throw Error('origin');};
 const live=await installLiveEducation({ipcMain,authorize,education,dataDir:dir,writeAtomic:atomic,window:()=>win,apiDisabled:true,
   fetchImpl:async()=>{calls++;throw Error('network_not_allowed');}});
 const operator={snapshot:()=>({sessions}),create:async()=>{const s={tab_id:'tab_'+require('node:crypto').randomUUID(),state:'OPEN'};sessions.push(s);return {state:'CREATED',sessions:[s]};}};
 const surface={select:id=>{visible=id;return {selected:true};},list:()=>sessions.map(s=>({...s,url:'https://chatgpt.com/'}))};
 // External opener/clipboard are injected test adapters: no browser/account is used.
 const web=await installWebChats({ipcMain,authorize,live:live.store,education,operator,surface,dataDir:dir,writeAtomic:atomic,
   openExternal:async url=>opened.push(url),copyText:text=>copied.push(text)});
 const wrap=(name,fn)=>ipcMain.handle(name,(e,...a)=>{authorize(e);return fn(...a);});
 wrap('education:snapshot',()=>({...education.snapshot(),materials:live.store.materials()}));
 wrap('devfleet:list',()=>operator.snapshot());wrap('devfleet:create',p=>operator.create(p));wrap('devfleet:select',id=>surface.select(id));
 wrap('education:show-material',()=>{visible=null;return {hidden:true};});
 wrap('education:viewport',b=>{bounds=b;return {updated:true};});
 wrap('education:preview-handoff',id=>buildEducationHandoff(id));
 win=new BrowserWindow({width:1366,height:768,show:false,webPreferences:{preload:path.join(root,'src/education-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
 await win.loadFile(path.join(root,'src/education.html'));const js=s=>win.webContents.executeJavaScript(s);
 async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await wait(30);}throw Error('ui_timeout');}
 await until(()=>js("document.getElementById('live-send').textContent.includes('Скопировать')&&!document.getElementById('live-send').disabled"));
 if(!await js("document.getElementById('study-drawer').hidden"))throw Error('drawer');
 const st=await js('window.devfleet.education.liveStatus()');if(st.ready||!st.api_disabled)throw Error('api_still_enabled');
 try{await js("window.devfleet.education.liveSend({material_id:'material-03-01',text:'never send'})");throw Error('api_allowed');}catch(e){if(!String(e).includes('live_api_disabled'))throw e;}
 await js("document.getElementById('live-input').value='Объясни напряжение';document.getElementById('live-send').click()");
 await until(()=>opened.length===1);if(opened[0]!=='https://chatgpt.com/'||!copied[0].includes('Объясни напряжение'))throw Error('ordinary_chat_open');
 await js("document.getElementById('web-conversation-url').value='https://chatgpt.com/c/11111111-abcd';document.getElementById('web-conversation-url').nextSibling.click()");
 await until(()=>web.bindings.topic('material-03-01').url!==null);
 await js("document.querySelector('[data-material-id=\"material-11-05\"]').click()");
 await until(()=>js("document.getElementById('live-topic').textContent.includes('OTDR')"));
 if(await js("document.getElementById('web-conversation-url').value")!=='')throw Error('cross_topic');
 const nativeResult=await js("window.devfleet.education.webOpen({material_id:'material-11-05',target:'embedded'})");
 if(!nativeResult.tab_id||sessions.length!==1||nativeResult.model_verified!==false)throw Error('native_binding');
 await js("window.devfleet.education.webOpen({material_id:'material-11-05',target:'embedded'})");if(sessions.length!==1)throw Error('duplicate_native');
 if(calls!==0)throw Error('unexpected_api');
 if(await fs.readFile(path.join(dir,'education-openai-key.bin'),'utf8')!=='test-fixture-not-a-real-key')throw Error('key_modified');
 win.showInactive();await wait(250);const screenshot=path.join(dir,'subscription-ui.png');await fs.writeFile(screenshot,(await win.webContents.capturePage()).toPNG());
 await finish({state:'PASS',schema:'education.webchat.smoke.v1',api_calls:calls,old_key_untouched:true,chat_opened:opened.length,model_verified:false,
   normal_browser:true,topic_binding:true,native_reuse:true,drawer_hidden:true,screenshot,profile:dir});
}
run().catch(e=>finish({state:'FAIL',error:String(e.stack).slice(0,3000),api_calls:'not_claimed'}));
