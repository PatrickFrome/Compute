/**
 * Preload — the ONLY bridge between Mission Control and the desktop.
 * Context-isolated, sandboxed: a small honest surface (status, openAgent,
 * lifecycle events). No nodeIntegration, no remote, no ipcRenderer leak.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('me2Desktop', {
  version: 'me2-desktop-bridge.v1',
  status: () => ipcRenderer.invoke('me2:status'),
  openAgent: (session) => ipcRenderer.invoke('me2:open-agent', session),
  onPlaneEvent: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('me2:plane-event', listener);
    return () => ipcRenderer.removeListener('me2:plane-event', listener);
  },
});
