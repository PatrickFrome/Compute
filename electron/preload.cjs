/**
 * ME2 OS preload — единственный мост renderer→main.
 * В renderer НЕ попадает ничего, кроме этого узкого API (contextBridge).
 */
const { contextBridge, ipcRenderer } = require("node:electron");

contextBridge.exposeInMainWorld("me2", {
  /** daemon /health (прокинут через main) */
  health: () => ipcRenderer.invoke("me2:health"),
  /** версия shell-окружения */
  shell: () => ipcRenderer.invoke("me2:shell"),
  /** ручной рестарт sidecar (баннер смерти daemon) */
  restartSidecar: () => ipcRenderer.invoke("me2:sidecar-restart"),
  /** события жизненного цикла daemon */
  onDaemonDown: (cb) => ipcRenderer.on("me2:daemon-down", () => cb()),
  onDaemonUp: (cb) => ipcRenderer.on("me2:daemon-up", (e, h) => cb(h)),
});
