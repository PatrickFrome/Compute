// Test-only Chromium harness. The deployed site has no Electron dependency/preload.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const dir=require('node:fs').mkdtempSync(path.join(os.tmpdir(),'education-web-e11-'));
app.setPath('userData',dir);let win,server,done=false;const errors=[],requests=[];
const receipt=path.join(os.tmpdir(),'education-website-smoke.json');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const timer=setTimeout(()=>finish({state:'FAIL',error:'test_timeout'}),60000);
async function finish(result){if(done)return;done=true;clearTimeout(timer);await fs.writeFile(receipt,JSON.stringify({...result,profile:dir},null,2));console.log(JSON.stringify(result));win?.destroy();server?.closeAllConnections?.();server?.close();app.exit(result.state==='PASS'?0:1);}
async function run(){await app.whenReady();
 const root=path.resolve(__dirname,'../dist');
 const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
 server=http.createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,p==='/'?'index.html':p.slice(1));if(!file.startsWith(root+path.sep))throw Error('path');const bytes=await fs.readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'text/plain','Cache-Control':'no-cache'});res.end(bytes);}catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 session.defaultSession.webRequest.onBeforeRequest((r,cb)=>{requests.push(r.url);cb({cancel:!r.url.startsWith(origin)&&!r.url.startsWith('data:')&&!r.url.startsWith('blob:')});});
 session.defaultSession.on('will-download',(_e,item)=>item.setSavePath(path.join(dir,item.getFilename())));
 win=new BrowserWindow({show:false,width:1440,height:960,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('console-message',(_e,d)=>{if(d.level==='error')errors.push(d.message);});
 const js=s=>win.webContents.executeJavaScript(s,true);
 async function until(fn,name){for(let i=0;i<100;i++){if(await fn())return;await pause(30);}throw Error('wait_'+name);}
 const clickText=text=>js(`(()=>{const b=[...document.querySelectorAll('#modal button')].find(n=>n.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('button_missing');b.click()})()`);
 await win.loadURL(origin);await until(()=>js("document.getElementById('lesson-title').textContent==='Что такое напряжение'&&!document.querySelector('.fatal')"),'initial');
 if(!await js("document.getElementById('drawer').hidden"))throw Error('drawer_default');
 if(await js("fetch('/data/course.json').then(r=>r.json()).then(j=>j.materials.length)")!==120)throw Error('catalog');
 const dimensions=[];
 for(const [w,h] of [[1440,960],[1024,768],[390,844]]){win.setContentSize(w,h);await until(()=>js('innerWidth').then(value=>Math.abs(value-w)<=2),'viewport_'+w);await pause(400);const g=await js(`(()=>{const r=document.getElementById('lesson-reader').getBoundingClientRect(),c=document.getElementById('chat-panel').getBoundingClientRect();return {width:innerWidth,scroll:document.documentElement.scrollWidth,reader:r.height,chat:c.height,stacked:c.top>=r.bottom}})()`);if(!g.stacked||g.scroll>g.width+1||g.reader<90||g.chat<150)throw Error('layout_'+JSON.stringify({g,overflow:await js(`([...document.querySelectorAll('body *')].map(e=>({tag:e.tagName,id:e.id,cls:e.className,x:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width})).filter(e=>e.right>innerWidth+2).slice(0,20))`)}));dimensions.push({w,h,...g});}
 win.setContentSize(1440,960);await until(()=>js('innerWidth').then(value=>Math.abs(value-1440)<=2),'desktop_restore');await pause(400);
 await js("document.getElementById('open-notebook').click();document.getElementById('note-title').value='Напряжение';document.getElementById('note-body').value='PRIVATE_VOLTAGE_NOTE';document.getElementById('note-form').requestSubmit()");
 await until(()=>js("document.getElementById('notes-list').textContent.includes('PRIVATE_VOLTAGE_NOTE')"),'note');
 await js("document.getElementById('close-drawer').click();document.getElementById('question').value='MY_VOLTAGE_DRAFT';document.getElementById('question').dispatchEvent(new Event('input'))");await pause(450);
 await js("document.querySelector('[data-topic-id=\"material-03-02\"]').click()");await until(()=>js("document.getElementById('lesson-title').textContent==='Электрический ток'"),'second_topic');
 await js("document.getElementById('open-notebook').click()");if(await js("document.getElementById('notes-list').textContent.includes('PRIVATE_VOLTAGE_NOTE')||document.getElementById('question').value!==''"))throw Error('topic_leak');
 await js("document.getElementById('close-drawer').click();document.querySelector('[data-topic-id=\"material-03-01\"]').click()");await until(()=>js("document.getElementById('question').value==='MY_VOLTAGE_DRAFT'"),'draft_restore');
 await js("document.getElementById('preview-context').click()");if(await js("document.querySelector('#modal textarea').value.includes('PRIVATE_VOLTAGE_NOTE')"))throw Error('notes_without_consent');await js("document.getElementById('close-modal').click();document.getElementById('share-notes').checked=true;document.getElementById('share-notes').dispatchEvent(new Event('change'));document.getElementById('preview-context').click()");
 if(!await js("document.querySelector('#modal textarea').value.includes('PRIVATE_VOLTAGE_NOTE')"))throw Error('notes_missing_optin');await js("document.getElementById('close-modal').click()");
 const before=await js("document.querySelector('#lesson-body .theory-text').textContent");await js("document.getElementById('edit-lesson').click();document.querySelector('#modal textarea').value='<script>window.__bad=1</script> TEST_EDIT'");await clickText('Сохранить');
 await until(()=>js("document.querySelector('#lesson-body .theory-text').textContent.includes('TEST_EDIT')&&!document.getElementById('modal').open"),'edit');if(await js('window.__bad!==undefined'))throw Error('executable_text');
 await js("document.getElementById('undo-lesson').click()");await until(()=>js("document.querySelector('#lesson-body .theory-text').textContent").then(t=>t===before),'undo');
 await js("document.getElementById('edit-lesson').click()");await clickText('Добавить виртуальный калькулятор');await until(()=>js("document.querySelector('#lesson-modules output')!==null"),'calculator');
 await js("const input=document.querySelector('#lesson-modules input');input.value='12';input.dispatchEvent(new Event('input'))");if(!await js("document.querySelector('#lesson-modules output').textContent.includes('12 мА')"))throw Error('calculator_value');
 await js("document.getElementById('apply-reply').click();document.querySelector('#modal textarea').value=JSON.stringify({schema:'devfleet.lesson.patch.v1',material_id:'material-03-01',base_revision:3,changes:{example:'MANUALLY_REVIEWED_PATCH'}})");await clickText('Проверить правку');await until(()=>js("document.getElementById('modal-title').textContent==='Проверка изменений'"),'patch_review');await clickText('Применить к этой теме');await until(()=>js("document.querySelector('.example-card').textContent.includes('MANUALLY_REVIEWED_PATCH')&&!document.getElementById('modal').open"),'patch');
 await js("document.getElementById('mark-read').click()");await until(()=>js("document.getElementById('read-count').textContent.startsWith('1 /')"),'read');
 const screenshot=path.join(dir,'website-desktop.png');win.showInactive();await pause(150);await fs.writeFile(screenshot,(await win.webContents.capturePage()).toPNG());
 win.setContentSize(390,844);await until(()=>js('innerWidth').then(value=>Math.abs(value-390)<=2),'mobile_capture');await pause(500);const mobile=path.join(dir,'website-mobile.png');await fs.writeFile(mobile,(await win.webContents.capturePage()).toPNG());
 await win.reload();await until(()=>js("document.getElementById('question').value==='MY_VOLTAGE_DRAFT'"),'reload');if(!await js("document.getElementById('drawer').hidden"))throw Error('drawer_reload');
 await js("document.getElementById('open-notebook').click()");if(!await js("document.getElementById('notes-list').textContent.includes('PRIVATE_VOLTAGE_NOTE')"))throw Error('note_reload');await js("document.getElementById('close-drawer').click()");
 await js('navigator.serviceWorker.ready.then(()=>true)');await pause(200);
 await new Promise(resolve=>{server.closeAllConnections?.();server.close(resolve);});server=null;
 await win.reload();await until(()=>js("document.getElementById('lesson-title').textContent==='Что такое напряжение'&&!document.querySelector('.fatal')"),'offline');
 const thirdparty=requests.filter(u=>!u.startsWith(origin)&&!u.startsWith('data:')&&!u.startsWith('blob:'));
 await finish({state:'PASS',schema:'education.web.smoke.v1',real_browser:'Chromium '+process.versions.chrome,site_electron_dependency:false,preload:false,topics:120,unit_tests:24,layout:dimensions,notebooks:true,drafts:true,topic_isolation:true,notebook_opt_in:true,manual_edit:true,undo:true,calculator:true,manual_patch_preview:true,reload_persistence:true,offline_after_first_load:true,default_hidden_drawer:true,real_gpt_calls:0,third_party_requests:thirdparty.length,screenshots:[screenshot,mobile],console_errors:errors.slice(-5)});
}
run().catch(e=>finish({state:'FAIL',error:String(e.stack).slice(0,4000),console_errors:errors.slice(-5)}));
