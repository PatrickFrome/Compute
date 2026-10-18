'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const api=Object.freeze({
  list: ()=>ipcRenderer.invoke('devfleet:list'),
  create: p=>ipcRenderer.invoke('devfleet:create',p),
  read: p=>ipcRenderer.invoke('devfleet:read',p),
  inspect: p=>ipcRenderer.invoke('devfleet:inspect',p),
  modelProbe: p=>ipcRenderer.invoke('devfleet:model-probe',p),
  inputProbe: p=>ipcRenderer.invoke('devfleet:input-probe',p),
  recover: p=>ipcRenderer.invoke('devfleet:recover',p),
  close: p=>ipcRenderer.invoke('devfleet:close',p),
  assign: p=>ipcRenderer.invoke('devfleet:assign',p),
  conveyorStatus: ()=>ipcRenderer.invoke('devfleet:conveyor-status'),
  conveyorStart: p=>ipcRenderer.invoke('devfleet:conveyor-start',p),
  conveyorStop: ()=>ipcRenderer.invoke('devfleet:conveyor-stop'),
  conveyorEnqueueBatch: p=>ipcRenderer.invoke('devfleet:conveyor-enqueue-batch',p),
  select: id=>ipcRenderer.invoke('devfleet:select',id),
  onReady: cb=>{if(typeof cb==='function')ipcRenderer.once('devfleet:ready',cb);}
});
contextBridge.exposeInMainWorld('devfleet',api);
