// Native Chrome Split View integration. Disposable profile and fixture chats only.
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import http from 'node:http';import {spawn} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'education-pair-smoke-')),ext=path.join(dir,'extension');let chrome,server,closed=false;const pending=new Map();let serial=0,buffer='';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function call(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('cdp_timeout_'+method));},15000);pending.set(id,{resolve,reject,timer});chrome.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');});}
async function main(){
 server=http.createServer(async(req,res)=>{try{if(req.url.startsWith('/fixture-chat')){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Fixture chat — not ChatGPT</title><h1>Test chat, no account</h1><textarea id="draft">Unsent fixture draft</textarea>');return;}const u=new URL(req.url,'http://localhost'),f=path.resolve(root,'dist',u.pathname==='/'?'index.html':u.pathname.slice(1));if(!f.startsWith(path.join(root,'dist')+path.sep))throw Error('outside');const data=await fs.readFile(f);const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};res.setHeader('Content-Type',mime[path.extname(f)]||'application/octet-stream');res.end(data);}catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 await fs.cp(path.join(root,'browser-link'),ext,{recursive:true});const manifest=JSON.parse(await fs.readFile(path.join(ext,'manifest.json'),'utf8'));manifest.host_permissions.push(origin+'/*');await fs.writeFile(path.join(ext,'manifest.json'),JSON.stringify(manifest));
 await fs.writeFile(path.join(ext,'probe.html'),'<!doctype html><meta charset="utf-8"><title>Pair test only</title><script type="module" src="probe.mjs"></script>');
 const probe=`import {PairController} from './engine.mjs';
const origin=${JSON.stringify(origin)},calls=[];let created=0;
const real=chrome.tabs,adapter={get:async id=>{const t=await real.get(id);return {...t,url:t.url?.startsWith(origin+'/fixture-chat')?'https://chatgpt.com/':t.url};},create:async p=>{created++;calls.push(p);return real.create({...p,url:origin+'/fixture-chat/'+created});},update:async(id,p)=>{if(p.url)throw Error('unexpected_navigation');return real.update(id,p);},move:(...a)=>real.move(...a),createSplit:(...a)=>real.createSplit(...a),unsplit:(...a)=>real.unsplit(...a),group:(...a)=>real.group(...a),ungroup:(...a)=>real.ungroup(...a)};
async function run(){
 const c=new PairController({tabs:adapter,local:chrome.storage.local,session:chrome.storage.session,origin});await c.init();
 if(!c.available())throw Error('native_split_api_unavailable');
 const source=await real.create({url:origin+'/#/material-03-01',active:true});const sender={frameId:0,tab:source,url:source.url||origin};sender.tab.url=origin;
 const request=p=>c.request(sender,p);await request({action:'open',topic:'material-03-01'});
 const first=c.workspaces[source.id].tabs['material-03-01'].id;
 let a=await real.get(source.id),b=await real.get(first);if(a.splitViewId<0||a.splitViewId!==b.splitViewId)throw Error('first_native_split_missing');
 await c.observe(first,'https://chatgpt.com/c/fixture-11111111');
 await request({action:'select',topic:'material-03-02'});const second=c.workspaces[source.id].tabs['material-03-02'].id;
 a=await real.get(source.id);b=await real.get(second);if(first===second||a.splitViewId<0||a.splitViewId!==b.splitViewId||(await real.get(first)).splitViewId>=0)throw Error('second_native_split_wrong');
 await c.observe(second,'https://chatgpt.com/c/fixture-22222222');
 await request({action:'select',topic:'material-03-01'});a=await real.get(source.id);b=await real.get(first);
 if(a.splitViewId<0||a.splitViewId!==b.splitViewId||created!==2)throw Error('reuse_failed');
 const reopened=new PairController({tabs:adapter,local:chrome.storage.local,session:chrome.storage.session,origin});await reopened.init();
 if(reopened.status(source.id,'material-03-01').url!=='https://chatgpt.com/c/fixture-11111111')throw Error('binding_not_durable');
 await request({action:'disconnect',topic:'material-03-01'});if((await real.get(source.id)).splitViewId>=0)throw Error('disconnect_failed');
 await real.get(first);await real.get(second);
 return {state:'PASS',native_split:true,two_separate_topics:true,reused_existing_chat:true,bindings_persisted:true,no_tabs_closed:true,fixture_chats:true,real_chatgpt_calls:0,model_verified:false,source_tab:source.id,first_tab:first,second_tab:second};
}globalThis.pairTest=run().catch(e=>({state:'FAIL',error:String(e.stack)}));`;
 await fs.writeFile(path.join(ext,'probe.mjs'),probe);
 const exe=process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
 chrome=spawn(exe,['--headless=new','--user-data-dir='+path.join(dir,'profile'),'--no-first-run','--no-default-browser-check','--remote-debugging-pipe','--enable-unsafe-extension-debugging','about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe']});
 chrome.stdio[4].on('data',b=>{buffer+=b.toString();for(let n;(n=buffer.indexOf('\0'))>=0;){const raw=buffer.slice(0,n);buffer=buffer.slice(n+1);if(!raw)continue;let m;try{m=JSON.parse(raw);}catch{continue;}const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}}});
 const installed=await call('Extensions.loadUnpacked',{path:ext});
 const t=await call('Target.createTarget',{url:'chrome-extension://'+installed.id+'/probe.html'});const session=(await call('Target.attachToTarget',{targetId:t.targetId,flatten:true})).sessionId;
 await call('Runtime.enable',{},session);let result;
 for(let i=0;i<100;i++){const r=await call('Runtime.evaluate',{expression:'globalThis.pairTest||null',awaitPromise:true,returnByValue:true},session);if(r.result?.value){result=r.result.value;break;}await pause(50);}
 if(!result)throw Error('no_result');return {...result,chrome_version:(await call('Browser.getVersion')).product,profile:dir,production_credentials_used:false};
}
let result;try{result=await main();}catch(e){result={state:'FAIL',error:String(e.stack).slice(0,4000),profile:dir};}finally{if(chrome){await call('Browser.close').catch(()=>{});chrome.kill();}if(server){server.closeAllConnections?.();server.close();}for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('closed'));}}
await fs.writeFile(path.join(os.tmpdir(),'education-pair-smoke.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exit(result.state==='PASS'?0:1);
