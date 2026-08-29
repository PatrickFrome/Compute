const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('metaengineShell', Object.freeze({
  snapshot: () => ipcRenderer.invoke('metaengine:shell:snapshot'),
  command: (command, payload) => ipcRenderer.invoke('metaengine:shell:command', { command, payload }),
  c5Status: () => ipcRenderer.invoke('metaengine:c5:status'),
  c5Command: (command, payload) => ipcRenderer.invoke('metaengine:c5:command', { command, payload }),
  onSnapshot: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const wrapped = (_event, value) => listener(value);
    ipcRenderer.on('metaengine:shell:snapshot', wrapped);
    return () => ipcRenderer.removeListener('metaengine:shell:snapshot', wrapped);
  },
}));
