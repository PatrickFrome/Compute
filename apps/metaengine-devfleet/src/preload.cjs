'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const api=Object.freeze({
  list: ()=>ipcRenderer.invoke('devfleet:list'),
  create: p=>ipcRenderer.invoke('devfleet:create',p),
  read: p=>ipcRenderer.invoke('devfleet:read',p),
  assign: p=>ipcRenderer.invoke('devfleet:assign',p),
  select: id=>ipcRenderer.invoke('devfleet:select',id),
  onReady: cb=>{if(typeof cb==='function')ipcRenderer.once('devfleet:ready',cb);}
});
contextBridge.exposeInMainWorld('devfleet',api);
