'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('metaengineGithubChat',Object.freeze({
  connect:({repository,token})=>ipcRenderer.invoke('metaengine:github-chat-setup:connect',{repository,token}),
}));
