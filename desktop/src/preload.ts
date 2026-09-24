/**
 * ME2 · preload мост (R46, унификация Electron ⇄ ME2).
 * Единый контракт `window.me2` (типизирован в src/lib/me2-desktop.ts основного приложения):
 * панели UI ⇄ TabRegistry, телеметрия вечного супервизора, самообновление из GitHub.
 */
import { contextBridge, ipcRenderer } from "electron";

const on = (channel: string, cb: (payload: unknown) => void): (() => void) => {
  const h = (_e: unknown, p: unknown): void => cb(p);
  ipcRenderer.on(channel, h as never);
  return () => { ipcRenderer.removeListener(channel, h as never); };
};

contextBridge.exposeInMainWorld("me2", {
  env: "electron",
  version: process.env.ME2_VERSION ?? "0.0.0",
  platform: process.platform,
  panels: ["browser", "fleet", "mission", "telemetry", "log"],
  tabs: {
    setActive: (kind: string, key: string) => { ipcRenderer.send("me2:tab-active", { kind, key }); },
    openSite: (url: string, title?: string) => ipcRenderer.invoke("me2:tab-create-web", { url, title }),
  },
  daemon: {
    status: () => ipcRenderer.invoke("me2:daemon-status"),
    restart: (which: string) => ipcRenderer.invoke("me2:daemon-restart", { which }),
  },
  update: {
    check: () => ipcRenderer.invoke("me2:update-check"),
    apply: () => ipcRenderer.invoke("me2:update-apply"),
  },
  chats: {
    create: () => ipcRenderer.send("me2:chat-create"),
  },
  onTabActivated: (cb: (p: unknown) => void) => on("me2:tab-activated", cb),
  onProcStatus: (cb: (s: unknown) => void) => on("me2:proc-status", cb),
  onNativeEvent: (cb: (p: unknown) => void) => on("me2:native", cb),
});
