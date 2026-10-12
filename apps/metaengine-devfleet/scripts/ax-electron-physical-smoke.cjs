#!/usr/bin/env node
// Synthetic, isolated Electron/CDP AX event smoke. Never opens ChatGPT,
// uses user auth, alters installed DevFleet, or sends a model message.
const {app,BrowserWindow,WebContentsView}=require('electron');
const crypto=require('node:crypto');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const token=crypto.randomUUID();
const spec='data:text/html;charset=utf-8,'+encodeURIComponent(
'<!doctype html><html><body><main><button id="status" aria-label="Before change">Ready</button></main></body></html>');
app.whenReady().then(async()=>{
  let host,cell;const messages=[];
  try {
    host=new BrowserWindow({show:false,width:640,height:400,
      webPreferences:{nodeIntegration:false,sandbox:true}});
    cell=new WebContentsView({webPreferences:{
      nodeIntegration:false,contextIsolation:true,sandbox:true,
      webSecurity:true,backgroundThrottling:false}});
    host.contentView.addChildView(cell);
    cell.setBounds({x:0,y:0,width:600,height:350});
    await cell.webContents.loadURL(spec);
    const dbg=cell.webContents.debugger;
    dbg.on('message',(_e,method)=>{
      if(method==='Accessibility.nodesUpdated'||method==='Accessibility.loadComplete')
        messages.push(method);
    });
    dbg.attach('1.3');
    await dbg.sendCommand('Accessibility.enable');
    const before=await dbg.sendCommand('Accessibility.getFullAXTree');
    if(!Array.isArray(before?.nodes)||before.nodes.length===0)
      throw Error('synthetic_initial_ax_absent');
    await dbg.sendCommand('DOM.enable');
    const root=await dbg.sendCommand('DOM.getDocument',{depth:-1});
    const item=await dbg.sendCommand('DOM.querySelector',{
      nodeId:root.root.nodeId,selector:'#status'});
    if(!item.nodeId)throw Error('synthetic_button_missing');
    await dbg.sendCommand('DOM.setAttributeValue',{
      nodeId:item.nodeId,name:'aria-label',value:'After change'});
    await delay(700);
    const after=await dbg.sendCommand('Accessibility.getFullAXTree');
    const names=after.nodes.filter(n=>!n.ignored).map(n=>String(n?.name?.value||''));
    const changed=names.some(n=>n.includes('After change'));
    if(!changed)throw Error('synthetic_ax_change_not_observed');
    const sawEvent=messages.includes('Accessibility.nodesUpdated')||
      messages.includes('Accessibility.loadComplete');
    if(!sawEvent)throw Error('synthetic_ax_change_event_missing');
    console.log(JSON.stringify({schema:'metaengine.devfleet.ax-electron-smoke.v1',
      state:'PASS',initial_nodes:before.nodes.length,updated_nodes:after.nodes.length,
      changed_ax_name:true,nodesUpdated:messages.includes('Accessibility.nodesUpdated'),
      loadComplete:messages.includes('Accessibility.loadComplete'),
      synthetic_only:true,chatgpt_effect:false,token_in_output:false}));
  } catch(error) {
    console.error(JSON.stringify({schema:'metaengine.devfleet.ax-electron-smoke.v1',
      state:'FAIL',code:String(error?.message||'ax_smoke_failed').slice(0,90),
      synthetic_only:true,chatgpt_effect:false}));
    process.exitCode=1;
  } finally {
    try{if(cell&&!cell.webContents.isDestroyed())cell.webContents.close();}catch{}
    try{host?.destroy();}catch{}
    app.quit();
  }
}).catch(()=>{process.exitCode=1;app.quit();});
