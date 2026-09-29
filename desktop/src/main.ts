/**
 * MetaEngine Desktop — единая система ME2 в Electron-оболочке (R46).
 *
 * Умное слияние: прежний Electron-браузер и ME2 больше не развиваются отдельно.
 * Этот главный процесс — PID-1 всей системы:
 *   1) встроенный gateway (замена Caddy на машине оператора: XTransformPort-прокси http+ws);
 *   2) вечный супервизор процессов: me2-daemon (bun) + Next UI (bun) — backoff-рестарты,
 *      кооперация со стражем инкарнации (exit 13 → присоединение);
 *   3) окно Mission Control v5 — тот же UI, что в браузере (панели БРАУЗЕР/ФЛОТ/…);
 *   4) TabRegistry (R41): панели как вкладки + нативные WEB-вкладки (браузер сам
 *      открывает чат-агентов/сайт);
 *   5) самообновление из GitHub (PatrickFrome/Compute) изнутри приложения.
 */
import { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, shell, dialog } from "electron";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { ProcessSupervisor, type ProcKind } from "./daemon-supervisor";
import { TabRegistry } from "./tab-registry";
import { startGateway, GATEWAY_PORT } from "./gateway";
import { checkUpdate, downloadUpdate } from "./updater";

const DEV = process.argv.includes("--me2-dev") || process.env.ME2_DEV === "1";
const REPO_ROOT = process.env.ME2_ROOT ? path.resolve(process.env.ME2_ROOT) : path.resolve(__dirname, "..", "..");
const UI_PORT = 3000;
const DAEMON_PORT = 3041;
const UI_URL = process.env.ME2_UI_URL ?? `http://127.0.0.1:${GATEWAY_PORT}`;
const BUN = process.env.ME2_BUN ?? "bun";
const GITHUB_TOKEN = process.env.ME2_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? undefined;

const PANELS: Array<{ key: string; label: string }> = [
  { key: "browser", label: "Браузер" },
  { key: "fleet", label: "Флот" },
  { key: "mission", label: "Миссия" },
  { key: "telemetry", label: "Телеметрия" },
  { key: "log", label: "Журнал" },
];

// ── журнал оболочки: stdout + кольцо последних строк + файл ─────────
const RING: string[] = [];
let logFile: string | null = null;
function log(line: string): void {
  const row = `${new Date().toISOString()} ${line}`;
  RING.push(row);
  if (RING.length > 600) RING.shift();
  try { if (logFile) fs.appendFileSync(logFile, row + "\n"); } catch { /* диск недоступен */ }
  console.log(row);
}
const procLog = (kind: ProcKind, line: string): void => log(`[${kind}] ${line}`);

// ── single instance: вторая копия оболочки фокусирует первую ────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  main();
}

function main(): void {
  app.setAppUserModelId("me.metaengine.desktop");
  process.env.ME2_VERSION = app.getVersion();
  try {
    const dir = app.getPath("userData");
    fs.mkdirSync(path.join(dir, "logs"), { recursive: true });
    logFile = path.join(dir, "logs", "me2-desktop.log");
  } catch { /* журнал только в stdout */ }

  let win: BrowserWindow | null = null;
  let tray: Tray | null = null;
  let quitting = false;

  // ── gateway: единая точка входа UI (замена Caddy) ─────────────────
  const gateway = startGateway(GATEWAY_PORT);
  log(`gateway :${GATEWAY_PORT} → UI :${UI_PORT} / XTransformPort:* (root ${REPO_ROOT})`);

  // ── вечный супервизор: daemon + UI ────────────────────────────────
  const sup = new ProcessSupervisor(procLog);
  sup.register("daemon", {
    cmd: BUN, args: [DEV ? "run" : "run", DEV ? "dev" : "start"], cwd: path.join(REPO_ROOT, "mini-services", "me2-daemon"),
  });
  sup.register("ui", {
    cmd: BUN, args: [DEV ? "run" : "run", DEV ? "dev" : "start"], cwd: REPO_ROOT,
  });
  sup.on("status", (s: unknown) => { try { win?.webContents.send("me2:proc-status", s); } catch { /* окно закрыто */ } });

  const fetchTimeout = async (url: string, ms = 2500): Promise<boolean> => {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), ms);
      const r = await fetch(url, { signal: ac.signal, cache: "no-store" });
      clearTimeout(t);
      return r.ok;
    } catch { return false; }
  };

  const health = setInterval(() => {
    void (async () => {
      const dOk = await fetchTimeout(`http://127.0.0.1:${DAEMON_PORT}/`);
      const uOk = await fetchTimeout(`http://127.0.0.1:${UI_PORT}/`);
      sup.reportHealth("daemon", dOk);
      sup.reportHealth("ui", uOk);
      const st = { ...sup.statusAll(), daemonOk: dOk, uiOk: uOk, at: Date.now() };
      try { win?.webContents.send("me2:proc-status", st); } catch { /* окно закрыто */ }
    })();
  }, 4_000);

  // ── TabRegistry (R41) ─────────────────────────────────────────────
  const registry = new TabRegistry(
    () => (win && !win.isDestroyed() ? win : null),
    (channel, payload) => { try { win?.webContents.send(channel, payload); } catch { /* окно закрыто */ } },
    (line) => log(`[tabs] ${line}`),
  );

  const loadWhenReady = async (target: BrowserWindow): Promise<void> => {
    for (let i = 0; i < 60; i++) {
      if (target.isDestroyed()) return;
      if (await fetchTimeout(`http://127.0.0.1:${UI_PORT}/`, 1500)) break;
      log(`ожидание UI :${UI_PORT} (${i + 1}/60)…`);
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (target.isDestroyed()) return;
    await target.loadURL(UI_URL);
    log(`UI загружен: ${UI_URL}`);
  };

  const createWindow = (): void => {
    win = new BrowserWindow({
      width: 1500, height: 940,
      minWidth: 1080, minHeight: 680,
      backgroundColor: "#09090b",
      title: "MetaEngine — Mission Control",
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false, // preload требует require("electron")
      },
    });
    win.once("ready-to-show", () => { win?.show(); });
    win.on("close", (e) => {
      if (!quitting) {
        e.preventDefault();
        win?.hide(); // сворачиваем в трей — daemon и флот продолжают жить
      }
    });
    win.on("resize", () => registry.resize());
    win.on("closed", () => { win = null; });
    void loadWhenReady(win);
  };

  // ── меню: панели, флот, система ───────────────────────────────────
  const buildMenu = (): void => {
    const sendNative = (payload: unknown): void => { try { win?.webContents.send("me2:native", payload); } catch { /* окно закрыто */ } };
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: "Панели",
        submenu: [
          ...PANELS.map((p, i) => ({
            label: p.label,
            accelerator: `CmdOrCtrl+${i + 1}`,
            click: () => registry.activatePanel(p.key),
          })),
          { type: "separator" as const },
          { label: "Создать чат-агента (Флот)", accelerator: "CmdOrCtrl+T", click: () => { registry.activatePanel("browser"); sendNative({ type: "chat-create" }); } },
          { label: "Открыть сайт вкладкой…", click: () => sendNative({ type: "open-site-prompt" }) },
        ],
      },
      {
        label: "Система",
        submenu: [
          { label: "Статус процессов", click: () => sendNative({ type: "proc-status", payload: { ...sup.statusAll() } }) },
          { label: "Рестарт daemon", click: () => sup.restart("daemon") },
          { label: "Рестарт UI", click: () => sup.restart("ui") },
          { type: "separator" as const },
          { label: "Проверить обновления", accelerator: "CmdOrCtrl+U", click: () => sendNative({ type: "update-check" }) },
          { label: "Журнал оболочки…", click: () => dialog.showMessageBox({ type: "info", title: "Журнал оболочки", message: RING.slice(-30).join("\n") || "пусто" }) },
        ],
      },
      { label: "Вид", submenu: [
        { role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" },
        { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" }, { role: "togglefullscreen" },
      ] },
      { label: "Выход", click: () => { quitting = true; app.quit(); } },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  };

  // ── трей: система живёт в фоне ────────────────────────────────────
  const trayIcon = (): Electron.NativeImage => {
    const w = 16, h = 16;
    const buf = Buffer.alloc(w * h * 4);
    // emerald-500 #10b981 → BGRA
    for (let i = 0; i < w * h; i++) {
      buf[i * 4] = 0x81; buf[i * 4 + 1] = 0xb9; buf[i * 4 + 2] = 0x10; buf[i * 4 + 3] = 0xff;
    }
    return nativeImage.createFromBitmap(buf, { width: w, height: h });
  };
  const buildTray = (): void => {
    try {
      tray = new Tray(trayIcon());
      tray.setToolTip("MetaEngine — флот живёт");
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: "Показать Mission Control", click: () => { if (win) { win.show(); win.focus(); } } },
        ...PANELS.map((p) => ({ label: `Панель · ${p.label}`, click: () => registry.activatePanel(p.key) })),
        { type: "separator" },
        { label: "Рестарт daemon", click: () => sup.restart("daemon") },
        { label: "Выход (остановить систему)", click: () => { quitting = true; app.quit(); } },
      ]));
      tray.on("click", () => { if (win) { win.show(); win.focus(); } });
    } catch (e) {
      log(`трей недоступен: ${String(e).slice(0, 100)}`); // честная деградация
    }
  };

  // ── IPC: мост UI ⇄ оболочка (контракт window.me2) ─────────────────
  ipcMain.on("me2:tab-active", (_e, p: { kind?: string; key?: string } = {}) => {
    if (p.kind === "panel" && p.key) log(`UI панель: ${p.key}`);
  });
  ipcMain.handle("me2:tab-create-web", (_e, p: { url?: string; title?: string } = {}) => {
    try {
      const t = registry.create({ role: "WEB", url: String(p.url ?? ""), title: p.title });
      return { ok: true, id: t.id };
    } catch (err) {
      return { ok: false, error: String((err as Error).message ?? err).slice(0, 160) };
    }
  });
  ipcMain.handle("me2:daemon-status", () => ({ ok: true, procs: { ...sup.statusAll(), gateway: GATEWAY_PORT, root: REPO_ROOT, dev: DEV } }));
  ipcMain.handle("me2:daemon-restart", (_e, p: { which?: string } = {}) => {
    const which = p.which === "ui" ? "ui" : p.which === "daemon" ? "daemon" : null;
    if (!which) return { ok: false, error: "which=daemon|ui" };
    sup.restart(which);
    return { ok: true };
  });
  ipcMain.handle("me2:update-check", async () => checkUpdate(app.getVersion(), GITHUB_TOKEN));
  ipcMain.handle("me2:update-apply", async () => {
    const info = await checkUpdate(app.getVersion(), GITHUB_TOKEN);
    if (!info.ok) return { ok: false, error: info.error ?? "проверка не удалась" };
    if (!info.updateAvailable || !info.asset) return { ok: true, note: `актуальная версия (${info.current})` };
    try {
      const dir = path.join(app.getPath("userData"), "updates");
      const file = await downloadUpdate(info.asset, dir, GITHUB_TOKEN);
      log(`обновление скачано: ${file}`);
      if (file.endsWith(".AppImage")) {
        const child = spawn(file, [], { detached: true, stdio: "ignore" });
        child.unref();
        quitting = true;
        setTimeout(() => app.quit(), 300);
        return { ok: true, note: "новая версия запускается…" };
      }
      void shell.openPath(file);
      return { ok: true, note: `установщик готов: ${path.basename(file)}` };
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 160) };
    }
  });

  app.on("second-instance", () => { if (win) { win.show(); win.focus(); } });
  app.on("before-quit", () => {
    quitting = true;
    clearInterval(health);
    sup.stopAll(); // грациозная остановка daemon и UI — оболочка уходит последней
    void gateway.close();
  });
  app.on("window-all-closed", () => { /* живём в трее — флот не спит */ });
  app.on("activate", () => { if (!win) createWindow(); else win.show(); });

  app.whenReady().then(() => {
    log(`MetaEngine Desktop v${app.getVersion()} dev=${DEV} — единая система запускается`);
    buildMenu();
    createWindow();
    buildTray();
    sup.start("daemon");
    sup.start("ui");
  });
}
