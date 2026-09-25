/** This bridge is installed ONLY in the trusted Mission Control WebContents. */
const { contextBridge, ipcRenderer } = require('electron');
const subscribe = channel => cb => {
  if (typeof cb !== 'function') return () => {};
  const listener = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
const status = () => ipcRenderer.invoke('me2:status');
contextBridge.exposeInMainWorld('me2Desktop', {
  version: 'me2-desktop-bridge.v2', status,
  openAgent: session => ipcRenderer.invoke('me2:open-agent', session),
  onPlaneEvent: subscribe('me2:plane-event'),
});
contextBridge.exposeInMainWorld('me2', {
  env: 'electron', version: 'me2-desktop-bridge.v2', platform: process.platform, panels: [],
  tabs: {
    setActive: (kind, key) => { void ipcRenderer.invoke('me2:activate-panel', { kind, key }); },
    openSite: url => ipcRenderer.invoke('me2:open-site', url),
  },
  daemon: { status, restart: which => ipcRenderer.invoke('me2:restart', which) },
  update: { check: () => ipcRenderer.invoke('me2:update-check'), apply: () => ipcRenderer.invoke('me2:update-apply') },
  chats: { create: () => ipcRenderer.invoke('me2:new-conversation') },
  onTabActivated: subscribe('me2:tab-activated'),
  onProcStatus: subscribe('me2:proc-status'),
  onNativeEvent: subscribe('me2:native-event'),
});
