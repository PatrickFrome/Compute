// Website-only smoke. Uses a disposable Chrome profile, never the desktop app.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),dist=path.join(root,'dist');
const folder=await fs.mkdtemp(path.join(os.tmpdir(),'education-site-light-'));
const pause=ms=>new Promise(r=>setTimeout(r,ms));let server,chrome,ws,stopped=false;
const events=[],pending=new Map();let serial=0;
const mime={'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const chromePath=process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(Error('cdp_timeout_'+method));},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});}
async function js(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;}
async function until(expression,name){for(let i=0;i<120;i++){if(await js(expression))return;await pause(50);}throw Error('wait_'+name);}
async function shot(name){await pause(120);const data=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});const file=path.join(folder,name+'.png');await fs.writeFile(file,Buffer.from(data.data,'base64'));return file;}
const click=id=>js(`document.getElementById(${JSON.stringify(id)}).click()`);
const fill=(id,value)=>js(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
async function main(){
 server=http.createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=path.resolve(dist,pathname==='/'?'index.html':pathname.slice(1));if(!file.startsWith(dist+path.sep))throw Error('outside');const bytes=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(bytes);}catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 chrome=spawn(chromePath,['--headless=new','--remote-debugging-port=0','--user-data-dir='+folder,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore'});
 let port;for(let i=0;i<100;i++){try{port=(await fs.readFile(path.join(folder,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await pause(80);}}if(!port)throw Error('chrome_not_started');
 const tabs=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());const page=tabs.find(t=>t.type==='page');if(!page)throw Error('page_missing');ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')events.push(m.params.exceptionDetails.text);};
 await call('Page.enable');await call('Runtime.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:940,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:origin});await until(`document.getElementById('lesson-title')?.textContent==='Что такое напряжение'`,'initial');
 const background=await js('getComputedStyle(document.body).backgroundColor');if(background!=='rgb(250, 250, 248)')throw Error('not_light');
 if(!await js(`document.getElementById('drawer').hidden`))throw Error('drawer_default');
 if(await js(`document.querySelectorAll('#read-count,#mark-read,.quiz-option,#progress-summary').length`))throw Error('removed_controls_present');
 const desktop=await shot('light-desktop');
 await click('open-notebook');await fill('note-title','Главное');await fill('note-body','PRIVATE_LIGHT_NOTE — разность потенциалов');await js(`document.getElementById('note-form').requestSubmit()`);
 await until(`document.getElementById('notes-list').textContent.includes('PRIVATE_LIGHT_NOTE')`,'notebook_save');const notebook=await shot('light-notebook');await click('close-drawer');
 await fill('question','DRAFT_VOLTAGE');await pause(450);
 await js(`document.querySelector('[data-topic-id="material-03-02"]').click()`);await until(`document.getElementById('lesson-title').textContent==='Электрический ток'`,'topic2');
 if(await js(`document.getElementById('question').value`)!=='')throw Error('draft_leak');await click('open-notebook');
 if(await js(`document.getElementById('notes-list').textContent.includes('PRIVATE_LIGHT_NOTE')`))throw Error('note_leak');await fill('note-body','UNSAVED_SECOND_NOTE');await click('close-drawer');
 await js(`document.querySelector('[data-topic-id="material-03-01"]').click()`);await until(`document.getElementById('question').value==='DRAFT_VOLTAGE'`,'draft_restore');
 await js(`document.querySelector('.chat-header .action-menu').open=true`);await click('preview-context');
 if(await js(`document.querySelector('#modal textarea').value.includes('PRIVATE_LIGHT_NOTE')`))throw Error('notes_without_consent');await click('close-modal');
 await js(`document.getElementById('share-notes').checked=true;document.getElementById('share-notes').dispatchEvent(new Event('change'))`);await click('preview-context');
 if(!await js(`document.querySelector('#modal textarea').value.includes('PRIVATE_LIGHT_NOTE')`))throw Error('optin_missing');await click('close-modal');
 // Verify E11 legacy quiz/progress records are retained, not rendered or erased.
 await js(`(async()=>{const {mutate}=await import('/src/storage.mjs');await mutate(s=>{s.read=['material-03-01'];return s;});})()`);
 const sizes=[];for(const [width,height] of [[1440,940],[1024,768],[390,844],[320,740]]){
  await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await pause(220);
  const v=await js(`(()=>{const r=document.getElementById('lesson-reader').getBoundingClientRect(),c=document.getElementById('chat-panel').getBoundingClientRect();return {width:innerWidth,scroll:document.documentElement.scrollWidth,reader:r.height,chat:c.height,stacked:c.top>=r.bottom};})()`);
  if(v.width!==width||v.scroll>width+1||!v.stacked||v.reader<100||v.chat<150)throw Error('layout_'+JSON.stringify(v));sizes.push(v);
 }
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await pause(180);const mobile=await shot('light-mobile');
 await click('menu-toggle');if(!await js(`document.getElementById('sidebar').classList.contains('open')`))throw Error('mobile_nav');await click('nav-backdrop');
 await click('open-notebook');const mobileNotebook=await shot('light-mobile-notebook');await click('close-drawer');
 // Clear test-only unsaved draft by saving it, then verify durable reload without app involvement.
 await js(`document.getElementById('menu-toggle').click();document.querySelector('[data-topic-id="material-03-02"]').click()`);await until(`document.getElementById('lesson-title').textContent==='Электрический ток'`,'restore_second');await click('open-notebook');
 if(await js(`document.getElementById('note-body').value`)!=='UNSAVED_SECOND_NOTE')throw Error('note_draft_lost');await js(`document.getElementById('note-form').requestSubmit()`);await until(`document.getElementById('notes-list').textContent.includes('UNSAVED_SECOND_NOTE')`,'second_saved');await click('close-drawer');
 await js(`document.getElementById('menu-toggle').click();document.querySelector('[data-topic-id="material-03-01"]').click()`);await until(`document.getElementById('lesson-title').textContent==='Что такое напряжение'`,'first_restored');
 await call('Page.reload');await until(`document.getElementById('question')?.value==='DRAFT_VOLTAGE'`,'reload');if(!await js(`document.getElementById('drawer').hidden`))throw Error('drawer_reload');
 await click('open-notebook');if(!await js(`document.getElementById('notes-list').textContent.includes('PRIVATE_LIGHT_NOTE')`))throw Error('notebook_reload');await click('close-drawer');
 const legacy=await js(`import('/src/storage.mjs').then(m=>m.loadState()).then(s=>s.read.includes('material-03-01'))`);if(!legacy)throw Error('legacy_loss');
 await until('!!navigator.serviceWorker.controller','offline_ready');await new Promise(r=>{server.closeAllConnections();server.close(r);});stopped=true;
 await call('Page.reload');await until(`document.getElementById('lesson-title')?.textContent==='Что такое напряжение'`,'offline');
 if(events.length)throw Error('page_errors_'+JSON.stringify(events));
 return {state:'PASS',website_only:true,desktop_app_touched:false,browser:'Chrome',light_background:background,layouts:sizes,notebooks_preserved:true,drafts_isolated:true,notebook_opt_in:true,legacy_data_preserved:true,no_quiz_progress_ui:true,offline:true,real_gpt_calls:0,screenshots:[desktop,notebook,mobile,mobileNotebook],profile:folder};
}
let result;try{result=await main();}catch(e){result={state:'FAIL',error:String(e.stack).slice(0,5000),events,profile:folder};}finally{if(ws?.readyState===1)await call('Browser.close').catch(()=>{});ws?.close();if(chrome&&chrome.exitCode===null)chrome.kill();if(server&&!stopped){server.closeAllConnections?.();server.close();}}
await fs.writeFile(path.join(os.tmpdir(),'education-light-smoke.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exit(result.state==='PASS'?0:1);
