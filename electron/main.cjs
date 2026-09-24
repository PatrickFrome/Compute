/**
 * ME2 OS — Electron client shell (R21, P0 Foundation).
 *
 * Ровно один привилегированный процесс: main. Renderer — Mission Control UI
 * (загружается с gateway :81), связь только через preload contextBridge.
 * Sidecar me2-daemon спавнится здесь же (как в Tauri-варианте R17), но смерть
 * daemon НЕ порождает автоцикл рестартов (урок M15 «13.5h тупик»): баннер +
 * ручная кнопка перезапуска через me2:sidecar-restart.
 *
 * Безопасность: contextIsolation, nodeIntegration:false, sandbox:true,
 * webSecurity:true (официальная модель Electron; re-verify R22 после истечения
 * поисковой квоты — research/2026/R21-ELECTRON-CLIENT-RESEARCH.md §5).
 */
const { app, BrowserWindow, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const UI_URL = process.env.ME2_UI_URL || "http://127.0.0.1:81";
const DAEMON_HEALTH = process.env.ME2_HEALTH_URL || "http://127.0.0.1:3041/health";
const SIDECAR_ENV = process.env.ME2_SIDECAR || "";

const SIDECAR_BY_PLATFORM = {
  darwin: "me2-daemon-aarch64-apple-darwin",
  linux: "me2-daemon-x86_64-unknown-linux-gnu",
  win32: "me2-daemon-x86_64-pc-windows-msvc.exe",
};

let mainWindow = null;
let sidecar = null;
let sidecarLogStream = null;
let daemonDown = false;
let pollTimer = null;

function resolveSidecar() {
  if (SIDECAR_ENV) return SIDECAR_ENV;
  const name = SIDECAR_BY_PLATFORM[process.platform];
  if (!name) return "";
  // packaged: resources/sidecar/<bin>; dev: ../../mini-services/me2-daemon/me2-daemon-<triple>
  const packaged = path.join(process.resourcesPath || "", "sidecar", name);
  if (fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, "..", "mini-services", "me2-daemon", name);
}

function sidecarLogLine(msg) {
  try {
    if (!sidecarLogStream) {
      const dir = app.getPath("userData");
      fs.mkdirSync(dir, { recursive: true });
      sidecarLogStream = fs.createWriteStream(path.join(dir, "sidecar.log"), { flags: "a" });
    }
    sidecarLogStream.write(`[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    /* журнал — best effort */
  }
}

function startSidecar() {
  const bin = resolveSidecar();
  if (!bin || !fs.existsSync(bin)) {
    sidecarLogLine(`sidecar не найден (${bin || "unset"}); ожидаем внешний daemon на :3040/:3041`);
    return false;
  }
  if (sidecar && !sidecar.killed) return true;
  sidecar = spawn(bin, [], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ME2_CLIENT: "electron" },
  });
  sidecarLogLine(`spawn ${bin} pid=${sidecar.pid}`);
  sidecar.stdout.on("data", (d) => sidecarLogLine(`out: ${String(d).trim()}`));
  sidecar.stderr.on("data", (d) => sidecarLogLine(`err: ${String(d).trim()}`));
  sidecar.on("exit", (code) => {
    sidecarLogLine(`sidecar exit code=${code}`);
    if (!daemonDown) broadcastDaemonDown();
  });
  return true;
}

async function daemonHealth() {
  try {
    const r = await fetch(DAEMON_HEALTH, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return { ok: true, ...(await r.json()) };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

function broadcastDaemonDown() {
  daemonDown = true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("me2:daemon-down", { ts: Date.now() });
  }
}

async function pollLoop() {
  const h = await daemonHealth();
  if (h.ok) {
    if (daemonDown && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("me2:daemon-up", h);
    }
    daemonDown = false;
  } else if (!daemonDown) {
    broadcastDaemonDown();
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: "ME2 OS",
    backgroundColor: "#09090b",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    sidecarLogLine(`did-fail-load ${code} ${desc} ${url} → fallback`);
    // Fallback-страница с авто-поллингом (урок R17: надёжнее remote-URL при мёртвом daemon)
    mainWindow.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(
          `<!doctype html><meta charset=utf-8><title>ME2 OS</title>
           <body style="background:#09090b;color:#a1a1aa;font:14px ui-monospace;display:grid;place-items:center;height:100vh;margin:0">
           <div style="text-align:center"><div id=s>ME2 daemon недоступен · ожидание :3041…</div>
           <small style="color:#52525b">окно переподключится автоматически</small></div>
           <script>let n=0;setInterval(()=>{n++;document.getElementById('s').textContent='ME2 daemon недоступен · ожидание :3041… ('+n+')';},1000)</script>
           </body>`,
        ),
    );
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(UI_URL);
    }, 5000);
  });

  mainWindow.loadURL(UI_URL);

  clearInterval(pollTimer);
  pollTimer = setInterval(() => void pollLoop(), 5000);
  void pollLoop();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    startSidecar();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  clearInterval(pollTimer);
  if (sidecar && !sidecar.killed) {
    sidecarLogLine("kill sidecar on quit");
    sidecar.kill();
  }
  if (sidecarLogStream) sidecarLogStream.end();
});

// ---- preload API (единственный мост renderer → main) ----
ipcMain.handle("me2:health", () => daemonHealth());
ipcMain.handle("me2:shell", () => ({
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  platform: process.platform,
  sidecarRunning: !!(sidecar && !sidecar.killed),
  daemonDown,
}));
ipcMain.handle("me2:sidecar-restart", () => {
  sidecarLogLine("sidecar restart по запросу оператора");
  if (sidecar && !sidecar.killed) sidecar.kill();
  sidecar = null;
  const ok = startSidecar();
  return { started: ok };
});
