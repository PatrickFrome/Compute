import { app, BrowserWindow, WebContentsView, ipcMain, dialog, Menu } from 'electron';
import { createServer } from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DevFleetOperator, SCHEMA } from './operator-core.mjs';
import { ChatSurface } from './chat-surface.mjs';
import { LiveUiSlots } from './live-ui-slots.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_NAME = 'METAENGINE DevFleet';
const RPC_SCHEMA = 'metaengine.devfleet.loopback.v1';
const dataDir = process.argv.includes('--devfleet-live-ui-smoke')
  ? path.join(os.tmpdir(),'metaengine-devfleet-live-ui-smoke-'+process.pid)
  : path.join(app.getPath('appData'), 'METAENGINE DevFleet');
app.setName(APP_NAME);
app.setPath('userData', dataDir);
app.commandLine.appendSwitch('disable-features','Translate');
let mainWindow, surface, operator, httpServer, rpcToken, rpcManifest;
let liveUiSlots, devConsoleWindow, developerToken, developerManifest;
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
function devConsoleSender(event) {
  if (!devConsoleWindow || BrowserWindow.fromWebContents(event.sender)!==devConsoleWindow
    || event.senderFrame!==event.sender.mainFrame
    || event.sender.getURL()!==pathToFileURL(path.join(__dirname,'dev-console.html')).href)
    throw new Error('devconsole_trusted_window_required');
}
async function applyLiveUi(file) {
  if (!mainWindow || mainWindow.isDestroyed() || operator?.isBusy())
    throw new Error('devconsole_runtime_busy');
  // The existing ChatGPT WebContentsViews are separate children of the
  // BrowserWindow and are never destroyed, recreated or assigned commands.
  await mainWindow.loadFile(file);
}
async function openDevConsole() {
  if (devConsoleWindow && !devConsoleWindow.isDestroyed()) {
    devConsoleWindow.show(); devConsoleWindow.focus(); return;
  }
  devConsoleWindow = new BrowserWindow({
    parent:mainWindow,width:730,height:665,backgroundColor:'#0b1220',
    title:'METAENGINE Dev Console',autoHideMenuBar:true,
    webPreferences:{
      preload:path.join(__dirname,'dev-console-preload.cjs'),
      nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,
    },
  });
  devConsoleWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  devConsoleWindow.webContents.on('will-navigate', (event,url)=>{
    if(url!==pathToFileURL(path.join(__dirname,'dev-console.html')).href)event.preventDefault();
  });
  devConsoleWindow.on('closed',()=>{devConsoleWindow=null;});
  await devConsoleWindow.loadFile(path.join(__dirname,'dev-console.html'));
}
async function publishDeveloperManifest() {
  if (!liveUiSlots?.configured || !httpServer?.listening || !developerToken) return;
  developerManifest=path.join(dataDir,'developer-rpc.json');
  const address='http://127.0.0.1:'+httpServer.address().port+'/rpc';
  await atomicPrivateWrite(developerManifest,JSON.stringify({
    schema:'metaengine.devfleet.developer-rpc.v1',
    app:APP_NAME,pid:process.pid,url:address,token:developerToken,
    version:app.getVersion(),workspace_pinned:true,
  })+'\n');
}
function registerDevConsole() {
  ipcMain.handle('devconsole:status',async event=>{
    devConsoleSender(event);return liveUiSlots.status();
  });
  ipcMain.handle('devconsole:choose',async event=>{
    devConsoleSender(event);
    const picked=await dialog.showOpenDialog(devConsoleWindow,{
      title:'Select trusted METAENGINE DevFleet source package',
      properties:['openDirectory'],
    });
    if(picked.canceled || picked.filePaths.length!==1)return liveUiSlots.status();
    const result=await liveUiSlots.attach(picked.filePaths[0]);
    await publishDeveloperManifest();
    return result;
  });
  ipcMain.handle('devconsole:stage',async event=>{
    devConsoleSender(event);
    if(operator?.isBusy())throw new Error('devconsole_operator_busy');
    return liveUiSlots.stage();
  });
  ipcMain.handle('devconsole:activate',async event=>{
    devConsoleSender(event);
    return liveUiSlots.activate(applyLiveUi);
  });
  ipcMain.handle('devconsole:rollback',async event=>{
    devConsoleSender(event);
    return liveUiSlots.rollback(applyLiveUi);
  });
  ipcMain.handle('devconsole:reconcile',async event=>{
    devConsoleSender(event);
    return liveUiSlots.reconcile(async file=>{
      await applyLiveUi(file);return mainWindow.webContents.getURL();
    });
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'DevFleet',submenu:[
      {label:'Live Development Console',accelerator:'Ctrl+Shift+D',click:()=>{void openDevConsole();}},
      {label:'Refresh Chat Status',click:()=>{void mainWindow?.webContents.send('devfleet:ready');}},
      {role:'quit'},
    ]},
  ]));
}
function listenLocal() {
  rpcToken = crypto.randomBytes(32).toString('hex');
  developerToken = crypto.randomBytes(32).toString('hex');
  const checkToken = (value,expected) => {
    if (typeof value !== 'string' || value.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(value),Buffer.from(expected));
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
    const presented=String(req.headers.authorization||'').replace(/^Bearer /,'');
    const chatAuthorized=checkToken(presented,rpcToken);
    const devAuthorized=checkToken(presented,developerToken);
    if (!chatAuthorized && !devAuthorized)
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
    if (typeof envelope.method === 'string' && envelope.method.startsWith('dev.')) {
      if (!devAuthorized || !liveUiSlots?.configured)
        return respond(403,{ok:false,error:'developer_workspace_authorization_required'});
      if (!envelope.params || typeof envelope.params!=='object'
        || Array.isArray(envelope.params) || Object.keys(envelope.params).length)
        return respond(400,{ok:false,error:'developer_params_denied'});
      const devRoutes={
        'dev.status':()=>liveUiSlots.status(),
        'dev.stage':()=>{
          if (operator?.isBusy())throw new Error('devconsole_operator_busy');
          return liveUiSlots.stage();
        },
        'dev.activate':()=>liveUiSlots.activate(applyLiveUi),
        'dev.rollback':()=>liveUiSlots.rollback(applyLiveUi),
        'dev.reconcile':()=>liveUiSlots.reconcile(async file=>{
          await applyLiveUi(file);return mainWindow.webContents.getURL();
        }),
      };
      if(!Object.hasOwn(devRoutes,envelope.method))
        return respond(400,{ok:false,error:'developer_method_unknown'});
      try {
        const result=await devRoutes[envelope.method]();
        return respond(200,{ok:true,schema:'metaengine.devfleet.developer-rpc.v1',result});
      } catch(error) {
        return respond(409,{ok:false,error:safeError(error),automatic_retry_allowed:false});
      }
    }
    if (!chatAuthorized) return respond(403,{ok:false,error:'chat_capability_token_required'});
    const routes={
      'chat.create': p=>operator.create(p),
      'chat.close': p=>operator.closeTab(p),
      'chat.read': p=>operator.read(p),
      'chat.assign': p=>operator.assign(p),
      'chat.batch_assign': p=>operator.batchAssign(p),
      'chat.inspect': p=>operator.inspect(p),
      'chat.model_probe': p=>operator.modelProbe(p),
      'chat.input_probe': p=>operator.inputProbe(p),
      'chat.recover': p=>operator.recover(p),
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
        await publishDeveloperManifest();
        resolve();
      }catch(error){reject(error);}
    });
  });
}
async function liveUiSmoke() {
  const root=path.join(dataDir,'qualification-workspace');
  await fs.mkdir(path.join(root,'src'),{recursive:true});
  const builtin=path.join(__dirname,'index.html');
  const changed=(await fs.readFile(builtin,'utf8'))+'\n<!-- qualified live-ui candidate -->\n';
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({name:'metaengine-devfleet'}));
  await fs.writeFile(path.join(root,'src','index.html'),changed);
  const slots=new LiveUiSlots({dataDir,builtinHtml:builtin});
  await slots.init();
  await slots.attach(root);
  const staged=await slots.stage();
  const browser=new BrowserWindow({show:false,width:920,height:720,
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,
      contextIsolation:true,sandbox:true,webSecurity:true}});
  const cell=new WebContentsView({webPreferences:{
    nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  browser.contentView.addChildView(cell);
  const id=cell.webContents.id;
  try {
    await browser.loadFile(builtin);
    const active=await slots.activate(file=>browser.loadFile(file));
    if(active.state!=='ACTIVE_CONFIRMED'||cell.webContents.isDestroyed()
      ||cell.webContents.id!==id||!browser.webContents.getURL().endsWith('.html'))
      throw Error('live_ui_activation_or_browser_cell_integrity_failed');
    const rolled=await slots.rollback(file=>browser.loadFile(file));
    if(rolled.state!=='ACTIVE_CONFIRMED'||cell.webContents.isDestroyed()
      ||cell.webContents.id!==id) throw Error('live_ui_rollback_or_cell_integrity_failed');
    console.log(JSON.stringify({schema:'metaengine.devfleet.live-ui-physical-smoke.v1',
      state:'PASS',candidate_sha256:staged.staged_sha256,
      staged_generation:1,final_generation:2,browser_cell_survived:true,
      native_app_reinstalled:false,hosted_database:false}));
  } finally {
    browser.contentView.removeChildView(cell);
    cell.webContents.close();
    browser.destroy();
    await fs.rm(dataDir,{recursive:true,force:true});
  }
}
async function start() {
  await fs.mkdir(dataDir,{recursive:true});
  if (process.argv.includes('--devfleet-live-ui-smoke')) {
    await liveUiSmoke();app.quit();return;
  }
  if (process.argv.includes('--devfleet-smoke')) {
    console.log(JSON.stringify({schema:'metaengine.devfleet.smoke.v1',
      appId:'com.metaengine.devfleet.standalone',
      productName:APP_NAME,package_version:app.getVersion(),
      separate_user_data:true,primary_browser_effect:false}));
    app.quit();return;
  }
  liveUiSlots=new LiveUiSlots({dataDir,builtinHtml:path.join(__dirname,'index.html')});
  const activeUiFile=await liveUiSlots.init();
  mainWindow=new BrowserWindow({
    title:APP_NAME,width:1450,height:900,minWidth:900,minHeight:600,
    backgroundColor:'#111827',
    webPreferences:{
      preload:path.join(__dirname,'preload.cjs'),
      nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true
    }
  });
  mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  await mainWindow.loadFile(activeUiFile);
  surface=new ChatSurface(mainWindow);
  operator=new DevFleetOperator({adapter:surface,store:disk});
  await operator.init();
  ipcMain.handle('devfleet:list',async e=>{uiSender(e);return operator.snapshot();});
  ipcMain.handle('devfleet:create',async(e,p)=>{uiSender(e);return operator.create(p);});
  ipcMain.handle('devfleet:read',async(e,p)=>{uiSender(e);return operator.read(p);});
  ipcMain.handle('devfleet:inspect',async(e,p)=>{uiSender(e);return operator.inspect(p);});
  ipcMain.handle('devfleet:model-probe',async(e,p)=>{uiSender(e);return operator.modelProbe(p);});
  ipcMain.handle('devfleet:input-probe',async(e,p)=>{uiSender(e);return operator.inputProbe(p);});
  ipcMain.handle('devfleet:recover',async(e,p)=>{uiSender(e);return operator.recover(p);});
  ipcMain.handle('devfleet:close',async(e,p)=>{uiSender(e);return operator.closeTab(p);});
  ipcMain.handle('devfleet:assign',async(e,p)=>{uiSender(e);return operator.assign(p);});
  ipcMain.handle('devfleet:select',async(e,tabId)=>{uiSender(e);return surface.select(tabId);});
  registerDevConsole();
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
  if(developerManifest)fs.rm(developerManifest,{force:true}).catch(()=>{});
});
if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(start).catch(error=>{
  dialog.showErrorBox('METAENGINE DevFleet startup blocked',safeError(error));
  app.quit();
});
