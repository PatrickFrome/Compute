/**
 * ME2 · TabRegistry (R41) — реестр вкладок браузера единой системы.
 *
 * Умное слияние: механика вкладок старого Electron-браузера объединена с панелями ME2.
 *   • роль MAIN — единственная живая вкладка-UI (Mission Control v5 с панелями
 *     БРАУЗЕР/ФЛОТ/МИССИЯ/ТЕЛЕМЕТРИЯ/ЖУРНАЛ);
 *   • роли панелей (SUPERVISOR/FLEET/…) — синтетические вкладки: создаются/активируются
 *     реестром, а переключение доставляется в UI (один и тот же интерфейс в web и Electron);
 *   • роль WEB — настоящий сайт в WebContentsView поверх UI (браузер сам открывает сайт).
 *
 * `TabRegistry.create({ role: "SUPERVISOR" })` — контракт R41: оболочка сама открывает
 * Mission Control; `create({ role: "WEB", url })` — нативная вкладка-сайт (G10 изнутри Electron).
 */
import { BrowserWindow, WebContentsView } from "electron";

export type Me2TabRole = "MAIN" | "SUPERVISOR" | "FLEET" | "MISSION" | "TELEMETRY" | "LOG" | "WEB";

export interface Me2TabDef {
  id: string;
  title: string;
  role: Me2TabRole;
  /** Для WEB — внешний URL; для панельных ролей — ключ панели UI. */
  url?: string;
  panel?: string;
  createdAt: number;
}

export const PANEL_ROLE_BY_KEY: Record<string, Me2TabRole> = {
  browser: "MAIN",
  fleet: "FLEET",
  mission: "SUPERVISOR",
  telemetry: "TELEMETRY",
  log: "LOG",
};

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(++seq).toString(36)}`;

export class TabRegistry {
  private tabs = new Map<string, Me2TabDef & { view?: WebContentsView }>();
  private activeWebId: string | null = null;

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly broadcast: (channel: string, payload: unknown) => void,
    private readonly log: (line: string) => void,
  ) {
    this.tabs.set("main", {
      id: "main", title: "Mission Control", role: "MAIN", panel: "browser", createdAt: 0,
    });
  }

  list(): Me2TabDef[] {
    return [...this.tabs.values()].map(({ id, title, role, url, panel, createdAt }) => ({ id, title, role, url, panel, createdAt }));
  }

  /** Создание вкладки. WEB — нативный WebContentsView; остальные — панель в UI. */
  create(def: { role?: Me2TabRole; url?: string; title?: string; panel?: string }): Me2TabDef {
    const role: Me2TabRole = def.role ?? (def.url ? "WEB" : "MAIN");
    if (role === "WEB") {
      const url = def.url ?? "";
      if (!/^https?:\/\//i.test(url)) {
        throw new Error(`WEB-вкладка требует http(s) URL, получено: ${url.slice(0, 80)}`);
      }
      const tab: Me2TabDef & { view?: WebContentsView } = {
        id: nextId("web"), title: def.title?.slice(0, 60) || new URL(url).hostname, role, url, createdAt: Date.now(),
      };
      const view = new WebContentsView({
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      void view.webContents.loadURL(url);
      view.webContents.on("page-title-updated", (_e, title) => { tab.title = title.slice(0, 60); });
      view.webContents.setWindowOpenHandler(({ url: target }) => {
        void view.webContents.loadURL(target); // навигация внутри вкладки, как в старом браузере
        return { action: "deny" };
      });
      tab.view = view;
      this.tabs.set(tab.id, tab);
      this.showWeb(tab.id);
      this.log(`TabRegistry.create(WEB) id=${tab.id} url=${url}`);
      return this.public_(tab);
    }
    // панельная вкладка: регистрируем и доставляем в UI
    const key = def.panel ?? (role === "SUPERVISOR" ? "mission" : role === "FLEET" ? "fleet" : role === "TELEMETRY" ? "telemetry" : role === "LOG" ? "log" : "browser");
    const tab: Me2TabDef = {
      id: nextId("tab"), title: def.title ?? `панель · ${key}`, role, panel: key, createdAt: Date.now(),
    };
    this.tabs.set(tab.id, tab);
    this.activatePanel(key);
    this.log(`TabRegistry.create(${role}) id=${tab.id} panel=${key} — браузер сам открыл панель`);
    return this.public_(tab);
  }

  /** G10 изнутри оболочки: активировать панель (deliver в UI). */
  activatePanel(key: string): void {
    this.hideWebView();
    this.broadcast("me2:tab-activated", { kind: "panel", key });
  }

  /** Показ WEB-вкладки поверх UI. */
  showWeb(id: string): void {
    const tab = this.tabs.get(id);
    const win = this.getWindow();
    if (!tab?.view || !win) return;
    const { width, height } = win.getContentBounds();
    tab.view.setBounds({ x: 0, y: 0, width, height });
    if (this.activeWebId && this.activeWebId !== id) this.tabs.get(this.activeWebId)?.view?.setVisible(false);
    tab.view.setVisible(true);
    if (!win.contentView.children.includes(tab.view)) win.contentView.addChildView(tab.view);
    this.activeWebId = id;
    this.broadcast("me2:tab-activated", { kind: "web", url: tab.url });
    this.log(`вкладка WEB активна: ${tab.title} (${tab.url})`);
  }

  private hideWebView(): void {
    if (!this.activeWebId) return;
    const cur = this.tabs.get(this.activeWebId);
    if (cur?.view) {
      cur.view.setVisible(false);
      try { this.getWindow()?.contentView.removeChildView(cur.view); } catch { /* уже снята */ }
    }
    this.activeWebId = null;
  }

  activate(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab) return;
    if (tab.role === "WEB") this.showWeb(id);
    else if (tab.panel) this.activatePanel(tab.panel);
  }

  close(id: string): void {
    if (id === "main") return; // MAIN неотменяема — это вся система
    const tab = this.tabs.get(id);
    if (!tab) return;
    if (tab.view) {
      try { this.getWindow()?.contentView.removeChildView(tab.view); } catch { /* noop */ }
      try { tab.view.webContents.close(); } catch { /* noop */ }
    }
    if (this.activeWebId === id) this.activeWebId = null;
    this.tabs.delete(id);
    this.log(`вкладка закрыта: ${tab.title}`);
  }

  /** Геометрия активной WEB-вкладки следует за окном. */
  resize(): void {
    if (!this.activeWebId) return;
    const tab = this.tabs.get(this.activeWebId);
    const win = this.getWindow();
    if (tab?.view && win) {
      const { width, height } = win.getContentBounds();
      tab.view.setBounds({ x: 0, y: 0, width, height });
    }
  }

  activeWeb(): Me2TabDef | null {
    return this.activeWebId ? this.public_(this.tabs.get(this.activeWebId)!) : null;
  }

  private public_(t: Me2TabDef & { view?: WebContentsView }): Me2TabDef {
    const { id, title, role, url, panel, createdAt } = t;
    return { id, title, role, url, panel, createdAt };
  }
}
