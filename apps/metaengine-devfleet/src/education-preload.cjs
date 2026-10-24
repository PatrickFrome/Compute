'use strict';
const {contextBridge,ipcRenderer}=require('electron');
// Education has no Send/read/Dev Console bridge. User interacts with GPT directly.
contextBridge.exposeInMainWorld('devfleet',Object.freeze({
  list:()=>ipcRenderer.invoke('devfleet:list'),
  create:params=>ipcRenderer.invoke('devfleet:create',params),
  select:tabId=>ipcRenderer.invoke('devfleet:select',tabId),
  education:Object.freeze({
    snapshot:()=>ipcRenderer.invoke('education:snapshot'),
    addFolder:params=>ipcRenderer.invoke('education:add-folder',params),
    renameFolder:params=>ipcRenderer.invoke('education:rename-folder',params),
    bindChat:params=>ipcRenderer.invoke('education:bind-chat',params),
    submitAnswer:params=>ipcRenderer.invoke('education:submit-answer',params),
    addNote:params=>ipcRenderer.invoke('education:add-note',params),
    addLabReport:params=>ipcRenderer.invoke('education:add-lab',params)
  }),
  onReady:callback=>{if(typeof callback==='function')ipcRenderer.once('devfleet:ready',callback);}
}));
