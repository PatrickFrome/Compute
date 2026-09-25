/**
 * METAENGINE Desktop — main entry (PID-1 of the ME2 OS client plane).
 * Boot order: instance guard → lifecycle journal → ME2 plane (daemon → UI →
 * gateway) → window shell (MAIN = Mission Control) → update channel (staged).
 * Smoke mode (--me2-smoke): bring the plane up headless-ish, print the snapshot,
 * exit 0 — the honest machine-checkable probe for CI/operator.
 */
import { app } from 'electron';
import { join, dirname } from 'node:path';
import { LifecycleJournal } from './core/journal.mjs';
import { Me2Plane } from './me2/plane.mjs';
import { createWindowShell } from './core/window-shell.mjs';
import { StagedUpdater } from './update/staged-updater.mjs';
import { resolveInstanceAction, UPDATE } from './shared/me2-constants.mjs';

const SMOKE = process.argv.includes('--me2-smoke');

// R77 lesson: composition must be explicit and journaled — no silent module swaps.
let plane = null;
let shell = null;
let journal = null;
let updater = null;

async function boot() {
  const userDataDir = app.getPath('userData');
  journal = new LifecycleJournal({ userDataDir });
  journal.record('boot', { version: app.getVersion(), smoke: SMOKE, electron: process.versions.electron });

  const lockAcquired = app.requestSingleInstanceLock();
  const action = resolveInstanceAction({ lockAcquired, hasResurrectionSignal: false });
  journal.record('instance_guard', { action });
  if (action !== 'primary') {
    if (SMOKE) console.log(JSON.stringify({ smoke: 'instance_guard', action }));
    app.exit(0);
    return;
  }

  const rootDir = app.getAppPath();
  plane = new Me2Plane({
    daemonDir: process.env.ME2_DAEMON_DIR ?? join(rootDir, '..', 'me2-daemon'),
    uiDistDir: process.env.ME2_UI_DIST_DIR ?? join(process.resourcesPath ?? rootDir, 'me2-ui'),
    electronExecPath: process.execPath,
    userDataDir,
    log: (r) => journal.record('plane', r),
    updater: new StagedUpdater({
      userDataDir,
      currentVersion: app.getVersion(),
      manifestUrl: process.env.ME2_UPDATE_MANIFEST_URL ?? '',
      log: (r) => journal.record('update', r),
    }),
  });

  const status = await plane.bringUp();
  journal.record('plane_up', { status });

  if (!SMOKE) {
    shell = createWindowShell({ BrowserWindow, journal, log: (r) => journal.record('shell', r) });
    const uiUrl = status.ui.ok ? `http://127.0.0.1:3000/` : null;
    shell.addView({ role: 'MAIN', url: uiUrl ?? undefined });
    shell.activate('MAIN');
    shell.win.webContents.loadURL('data:text/html,<title>METAENGINE Desktop</title><body style="background:#09090b;color:#a1a1aa;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0"><div>Mission Control недоступен — честный DEGRADED. Журнал: userData/me2-desktop-lifecycle.jsonl</div></body>');
  }

  journal.record('ready', { smoke: SMOKE });
  if (SMOKE) {
    console.log(JSON.stringify({ smoke: 'plane', status: plane.snapshot() }, null, 2));
    app.exit(0);
  }
}

// IPC surface (preload contract)
import { ipcMain } from 'electron';
ipcMain.handle('me2:status', () => (plane ? plane.snapshot() : { error: 'plane_not_up' }));
ipcMain.handle('me2:open-agent', (_e, session) => {
  if (!shell) return { ok: false, reason: 'shell_absent' };
  journal?.record('open_agent', { session: session?.id ?? null });
  return { ok: true, role: 'FLEET' };
});

app.whenReady().then(boot).catch((err) => {
  journal?.record('boot_failed', { error: String(err?.stack ?? err).slice(0, 600) });
  console.error('[me2-desktop] boot failed:', err);
  app.exit(13); // exit-13 = cooperative failure (ME2 convention)
});

app.on('window-all-closed', () => {
  journal?.record('window_all_closed', {});
  app.quit();
});
app.on('before-quit', () => {
  journal?.record('exit', {});
  plane?.shutdown();
});
app.on('second-instance', () => {
  journal?.record('second_instance', { resurrect: true });
  if (shell?.win) {
    if (shell.win.isMinimized()) shell.win.restore();
    shell.win.focus();
  }
});

export { UPDATE };
