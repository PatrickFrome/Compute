'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// The renderer receives no filesystem, shell, SQL or arbitrary IPC access.
contextBridge.exposeInMainWorld('metaengineRestore', Object.freeze({
  choose: kind => ipcRenderer.invoke('metaengine:local-postgres-setup:choose',kind),
  connect: pin => ipcRenderer.invoke('metaengine:local-postgres-setup:connect',pin),
}));
