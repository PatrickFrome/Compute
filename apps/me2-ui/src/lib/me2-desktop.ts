"use client";
/**
 * ME2 · мост UI ⇄ Electron-оболочка (R46, унификация Electron + ME2 в одну систему).
 *
 * Единая система MetaEngine имеет два рантайма одного и того же UI:
 *  • браузер (gateway :81) — панели живут сами, `window.me2` отсутствует;
 *  • Electron (desktop/) — preload экспонирует `window.me2`: нативные вкладки
 *    TabRegistry (R41), вечный супервизор daemon+UI, самообновление из GitHub.
 *
 * Мост необязателен: в чистом вебе все функции деградируют в no-op — это тот же UI.
 */

export interface Me2ProcStatus {
  daemon: boolean;
  ui: boolean;
  restarts_daemon: number;
  restarts_ui: number;
  pid_daemon: number | null;
  pid_ui: number | null;
}

export interface Me2UpdateInfo {
  ok: boolean;
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  error?: string;
}

/** Реестр вкладок браузера ME2 (R41 TabRegistry): панельные + нативные WEB-вкладки. */
export interface Me2DesktopBridge {
  env: "electron";
  version: string;
  platform: string;
  panels: string[];
  tabs: {
    /** UI сменил панель — уведомить нативную оболочку (синхронизация TabRegistry). */
    setActive(kind: "panel" | "page", key: string): void;
    /** Открыть сайт нативной вкладкой-браузером (G10: браузер сам открывает сайт). */
    openSite(url: string, title?: string): Promise<{ ok: boolean; id?: string; error?: string }>;
  };
  daemon: {
    status(): Promise<{ ok: boolean; procs?: Me2ProcStatus }>;
    restart(which: "daemon" | "ui"): Promise<{ ok: boolean; error?: string }>;
  };
  update: {
    check(): Promise<Me2UpdateInfo>;
    apply(): Promise<{ ok: boolean; note?: string; error?: string }>;
  };
  /** Нативное меню/трей выбрал панель — UI обязан переключиться. Возвращает отписку. */
  onTabActivated(cb: (p: { kind: string; key?: string; url?: string }) => void): () => void;
  /** Телеметрия вечного супервизора процессов (daemon/ui рестарты, pid). */
  onProcStatus(cb: (s: Me2ProcStatus) => void): () => void;
  /** Нативные события оболочки (меню Флот → создать чат и т.п.). */
  onNativeEvent(cb: (p: { type: string; payload?: unknown }) => void): () => void;
  /** Запросить у оболочки создание нового чат-агента (браузер сам открывает чат). */
  chats: { create(): void };
}

type Me2Window = Window & { me2?: Me2DesktopBridge };

/** Мост оболочки или null (чистый веб/SSR). */
export function me2Desktop(): Me2DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return (window as Me2Window).me2 ?? null;
}

/** true, если UI живёт внутри нативной оболочки MetaEngine. */
export function isDesktop(): boolean {
  return me2Desktop() !== null;
}
