'use strict';
const {contextBridge,ipcRenderer}=require('electron');
// Only developer-console renderer gets activation controls.
// ChatGPT tabs and hot UI pages never receive these methods.
contextBridge.exposeInMainWorld('devfleetConsole',Object.freeze({
 status:()=>ipcRenderer.invoke('devconsole:status'),
 choose:()=>ipcRenderer.invoke('devconsole:choose'),
 stage:()=>ipcRenderer.invoke('devconsole:stage'),
 activate:()=>ipcRenderer.invoke('devconsole:activate'),
 rollback:()=>ipcRenderer.invoke('devconsole:rollback'),
 reconcile:()=>ipcRenderer.invoke('devconsole:reconcile')
}));
