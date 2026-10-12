import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { createServer } from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DevFleetOperator, SCHEMA } from './operator-core.mjs';
import { ChatSurface } from './chat-surface.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_NAME = 'METAENGINE DevFleet';
const RPC_SCHEMA = 'metaengine.devfleet.loopback.v1';
const dataDir = path.join(app.getPath('appData'), 'METAENGINE DevFleet');
app.setName(APP_NAME);
app.setPath('userData', dataDir);
app.commandLine.appendSwitch('disable-features','Translate');
let mainWindow, surface, operator, httpServer, rpcToken, rpcManifest;
let shuttingDown = false;
function safeError(error) {
  const msg = String(error?.message || 'operation_refused');
  return /^[a-zA-Z0-9_:-]{1,100}$/.test(msg) ? msg : 'operation_refused';
}
async function atomicPrivateWrite(file,content) {
  const tmp = file + '.tmp-' + crypto.randomUUID();
  await fs.writeFile(tmp,content,{encoding:'utf8',mode:0o600,flag:'wx'});
  try { await fs.rename(tmp,file); } catch(error) { await fs.rm(tmp,{force:true}).catch(()=>{}); throw error; }
}
const disk = {
  async load() {
    try {return JSON.parse(await fs.readFile(path.join(dataDir,'operator-state.json'),'utf8'));}
    catch(error) {if(error.code==='ENOENT') return null;throw error;}
  },
  save(data) {return atomicPrivateWrite(path.join(dataDir,'operator-state.json'),JSON.stringify(data,null,2)+'\n');}
};
function uiSender(event) {
  const w=BrowserWindow.fromWebContents(event.sender);
  if (w!==mainWindow || event.senderFrame!==event.sender.mainFrame
    || !event.sender.getURL().startsWith('file://'))
    throw new Error('devfleet_ui_origin_denied');
}
function listenLocal() {
  rpcToken = crypto.randomBytes(32).toString('hex');
  const checkToken = value => {
    if (typeof value !== 'string' || value.length !== rpcToken.length) return false;
    return crypto.timingSafeEqual(Buffer.from(value),Buffer.from(rpcToken));
  };
  httpServer=createServer(async(req,res)=>{
    const respond=(code,body)=>{if(res.headersSent)return;res.writeHead(code,{
      'Content-Type':'application/json; charset=utf-8',
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
      'Connection':'close'
    });res.end(JSON.stringify(body));};
    if (req.method!=='POST' || req.url!=='/rpc') return respond(404,{ok:false,error:'route_not_found'});
    if (req.headers.origin || req.headers.referer) return respond(403,{ok:false,error:'browser_origin_denied'});
    const bound=httpServer.address();
    const host='127.0.0.1:'+bound.port;
    if (req.headers.host!==host) return respond(403,{ok:false,error:'host_mismatch'});
    if (!checkToken(String(req.headers.authorization||'').replace(/^Bearer /,'')))
      return respond(401,{ok:false,error:'authentication_required'});
    if (req.headers['content-type']?.split(';')[0].trim()!=='application/json')
      return respond(415,{ok:false,error:'json_required'});
    let raw='';
    try {for await(const piece of req) {raw+=piece;if(raw.length>64000)throw Error('body_too_large');}}
    catch {return respond(413,{ok:false,error:'body_limit_exceeded'});}
    let envelope;
    try {envelope=JSON.parse(raw);}
    catch {return respond(400,{ok:false,error:'json_invalid'});}
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
      || Object.keys(envelope).some(k=>!['method','params'].includes(k)))
      return respond(400,{ok:false,error:'envelope_invalid'});
    const routes={
      'chat.create': p=>operator.create(p),
      'chat.read': p=>operator.read(p),
      'chat.assign': p=>operator.assign(p),
      'chat.list': ()=>operator.snapshot(),
    };
    if (!Object.hasOwn(routes,envelope.method))
      return respond(400,{ok:false,error:'method_unknown'});
    try {
      if (envelope.method==='chat.list' && Object.keys(envelope.params||{}).length)
        throw Error('params_invalid');
      const result=await routes[envelope.method](envelope.params||{});
      return respond(200,{ok:true,schema:RPC_SCHEMA,result});
    } catch(error) {return respond(409,{ok:false,schema:RPC_SCHEMA,error:safeError(error),automatic_retry_allowed:false});}
  });
  httpServer.on('clientError',(_err,socket)=>socket.destroy());
  return new Promise((resolve,reject)=>{
    httpServer.once('error',reject);
    httpServer.listen(0,'127.0.0.1',async()=>{
      try {
        rpcManifest=path.join(dataDir,'operator-rpc.json');
        const address='http://127.0.0.1:'+httpServer.address().port+'/rpc';
        await atomicPrivateWrite(rpcManifest,JSON.stringify({
          schema:RPC_SCHEMA,app:APP_NAME,pid:process.pid,
          url:address,token:rpcToken,version:app.getVersion()
        })+'\n');
        resolve();
      }catch(error){reject(error);}
    });
  });
}
async function start() {
  await fs.mkdir(dataDir,{recursive:true});
  if (process.argv.includes('--devfleet-smoke')) {
    console.log(JSON.stringify({schema:'metaengine.devfleet.smoke.v1',
      appId:'com.metaengine.devfleet.standalone',
      productName:APP_NAME,package_version:app.getVersion(),
      separate_user_data:true,primary_browser_effect:false}));
    app.quit();return;
  }
  mainWindow=new BrowserWindow({
    title:APP_NAME,width:1450,height:900,minWidth:900,minHeight:600,
    backgroundColor:'#111827',
    webPreferences:{
      preload:path.join(__dirname,'preload.cjs'),
      nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true
    }
  });
  mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  await mainWindow.loadFile(path.join(__dirname,'index.html'));
  surface=new ChatSurface(mainWindow);
  operator=new DevFleetOperator({adapter:surface,store:disk});
  await operator.init();
  ipcMain.handle('devfleet:list',async e=>{uiSender(e);return operator.snapshot();});
  ipcMain.handle('devfleet:create',async(e,p)=>{uiSender(e);return operator.create(p);});
  ipcMain.handle('devfleet:read',async(e,p)=>{uiSender(e);return operator.read(p);});
  ipcMain.handle('devfleet:assign',async(e,p)=>{uiSender(e);return operator.assign(p);});
  ipcMain.handle('devfleet:select',async(e,tabId)=>{uiSender(e);return surface.select(tabId);});
  await listenLocal();
  mainWindow.webContents.send('devfleet:ready');
  mainWindow.on('closed',()=>{mainWindow=null;});
}
app.on('second-instance',()=>{if(mainWindow){mainWindow.show();mainWindow.focus();}});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{
  if(shuttingDown)return;
  shuttingDown=true;
  surface?.close();
  httpServer?.close();
  if(rpcManifest)fs.rm(rpcManifest,{force:true}).catch(()=>{});
});
if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(start).catch(error=>{
  dialog.showErrorBox('METAENGINE DevFleet startup blocked',safeError(error));
  app.quit();
});
