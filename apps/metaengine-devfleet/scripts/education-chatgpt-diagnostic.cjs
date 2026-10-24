'use strict';
// Read-only diagnostic: no typing, no login automation, no anti-bot circumvention.
// Only navigates to https://chatgpt.com/ in an isolated disposable Electron profile.
const {app,BrowserWindow,WebContentsView,session}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const base=path.join(os.tmpdir(),'devfleet-education-chatgpt-diagnostic-'+process.pid);
const resultPath=path.join(os.tmpdir(),'devfleet-education-chatgpt-diagnostic-result.json');
let win,view;
async function run(){
  await fs.mkdir(base,{recursive:true});
  app.setPath('userData',base);
  await app.whenReady();
  const diag={schema:'devfleet.education.chatgpt-diagnostic.v1',app_version:process.versions.electron,
    chromium:process.versions.chrome,js_local:null,js_after_chatgpt:null,
    network:[],events:[],safe_url:'',isolation:true};
  const part='persist:metaengine-devfleet-auth-v1';
  const s=session.fromPartition(part);
  s.setPermissionRequestHandler((_wc,_perm,cb)=>cb(false));
  s.webRequest.onCompleted({urls:['https://chatgpt.com/*','https://*.chatgpt.com/*','https://*.oaistatic.com/*']},details=>{
    if(diag.network.length>=90)return;
    const resource=details.resourceType;
    const host=new URL(details.url).hostname;
    diag.network.push({resource,host,status:details.statusCode,method:details.method});
  });
  s.webRequest.onErrorOccurred({urls:['https://chatgpt.com/*','https://*.chatgpt.com/*','https://*.oaistatic.com/*']},details=>{
    if(diag.network.length<90)diag.network.push({resource:details.resourceType,host:new URL(details.url).hostname,error:details.error});
  });
  win=new BrowserWindow({show:false,width:1200,height:800,
    webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  view=new WebContentsView({webPreferences:{partition:part,javascript:true,
    nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  win.contentView.addChildView(view);view.setBounds({x:0,y:0,width:1200,height:800});
  const wc=view.webContents;
  wc.on('did-fail-load',(_e,code,desc,valid)=>diag.events.push({type:'did-fail-load',code,desc,main:valid}));
  wc.on('did-finish-load',()=>diag.events.push({type:'did-finish-load'}));
  wc.on('render-process-gone',(_e,p)=>diag.events.push({type:'render-process-gone',reason:p.reason}));
  wc.on('console-message',(_e,m)=>{if(diag.events.length<30)diag.events.push({type:'console',level:m.level,message:String(m.message).slice(0,120)});});
  await wc.loadURL('data:text/html,<title>JSCHECK</title><script>window.__probeJS=123;</script>');
  diag.js_local=await wc.executeJavaScript('window.__probeJS===123',{userGesture:false});
  const timeout=60000;
  try{await Promise.race([wc.loadURL('https://chatgpt.com/'),new Promise((_,reject)=>setTimeout(()=>reject(Error('load_timeout_60s')),timeout))]);}
  catch(e){diag.load_error=String(e.message).slice(0,100);}
  await new Promise(resolve=>setTimeout(resolve,8000));
  try{
    const v=await wc.executeJavaScript(`({
      js_live: 5+7===12,
      title: document.title?.slice(0,120),
      ready:document.readyState,
      script_count:document.scripts.length,
      noscript_count:document.querySelectorAll('noscript').length,
      body_text_length:document.body?.innerText?.length??0,
      user_agent_kind:navigator.userAgent.includes('Electron')?'Electron':'Other'
    })`,{userGesture:false});
    diag.js_after_chatgpt=v;
  }catch(e){diag.page_script_error=String(e.message).slice(0,200);}
  try{const u=new URL(wc.getURL());diag.safe_url=u.origin+u.pathname.slice(0,60);}catch{}
  await fs.writeFile(resultPath,JSON.stringify(diag,null,2));
  console.log('DIAG_WRITTEN '+resultPath);
  wc.close();win.destroy();app.quit();
}
run().catch(async e=>{
  await fs.writeFile(resultPath,JSON.stringify({state:'error',message:String(e.stack).slice(0,500)},null,2));
  app.exit(1);
});
