'use strict';
const {contextBridge,ipcRenderer}=require('electron');
// Education has no Send/read/Dev Console bridge. User interacts with GPT directly.
contextBridge.exposeInMainWorld('devfleet',Object.freeze({
  list:()=>ipcRenderer.invoke('devfleet:list'),
  create:params=>ipcRenderer.invoke('devfleet:create',params),
  select:tabId=>ipcRenderer.invoke('devfleet:select',tabId),
  education:Object.freeze({
    snapshot:()=>ipcRenderer.invoke('education:snapshot'),
    showMaterial:()=>ipcRenderer.invoke('education:show-material'),
    setViewport:b=>ipcRenderer.invoke('education:viewport',b),
    chatHealth:()=>ipcRenderer.invoke('education:chat-health'),
    liveAssets:id=>ipcRenderer.invoke('education:live-assets',id),
    liveAssetRead:p=>ipcRenderer.invoke('education:live-asset-read',p),
    liveImportImage:id=>ipcRenderer.invoke('education:live-import-image',id),
    webTopic:id=>ipcRenderer.invoke('education:web-topic',id),
    webOpen:p=>ipcRenderer.invoke('education:web-open',p),
    webBind:p=>ipcRenderer.invoke('education:web-bind',p),
    webCapture:id=>ipcRenderer.invoke('education:web-capture',id),
    webCopy:p=>ipcRenderer.invoke('education:web-copy',p),
    liveStatus:()=>ipcRenderer.invoke('education:live-status'),
    liveTopic:id=>ipcRenderer.invoke('education:live-topic',id),
    liveSend:p=>ipcRenderer.invoke('education:live-send',p),
    liveUndo:p=>ipcRenderer.invoke('education:live-undo',p),
    liveConfigure:p=>ipcRenderer.invoke('education:live-configure',p),
    liveDisconnect:()=>ipcRenderer.invoke('education:live-disconnect'),
    previewHandoff:(id,options)=>ipcRenderer.invoke('education:preview-handoff',id,options),
    copyHandoff:(id,options)=>ipcRenderer.invoke('education:copy-handoff',id,options),
    launchExternalGPT:(id,options)=>ipcRenderer.invoke('education:launch-external-gpt',id,options),
    openReference:url=>ipcRenderer.invoke('education:open-reference',url),
    addFolder:params=>ipcRenderer.invoke('education:add-folder',params),
    renameFolder:params=>ipcRenderer.invoke('education:rename-folder',params),
    bindChat:params=>ipcRenderer.invoke('education:bind-chat',params),
    submitAnswer:params=>ipcRenderer.invoke('education:submit-answer',params),
    addNote:params=>ipcRenderer.invoke('education:add-note',params),
    addNotebookEntry:params=>ipcRenderer.invoke('education:notebook-add',params),
    editNotebookEntry:params=>ipcRenderer.invoke('education:notebook-edit',params),
    deleteNotebookEntry:params=>ipcRenderer.invoke('education:notebook-delete',params),
    addLabReport:params=>ipcRenderer.invoke('education:add-lab',params)
  }),
  onExternalAuthRequired:callback=>{
    if(typeof callback==='function')ipcRenderer.on('education:external-auth-required',(_e,payload)=>callback(payload));
  },
  onReady:callback=>{if(typeof callback==='function')ipcRenderer.once('devfleet:ready',callback);}
}));
