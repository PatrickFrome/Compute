/**
 * METAENGINE Desktop — main entry (PID-1 of the ME2 OS client plane).
 * Boot order: instance guard → lifecycle journal → ME2 plane (daemon → UI →
 * gateway) → window shell (MAIN = Mission Control) → update channel (staged).
 * Smoke mode (--me2-smoke): bring the plane up headless-ish, print the snapshot,
 * exit 0 — the honest machine-checkable probe for CI/operator.
 */
import { app, BrowserWindow, WebContentsView, Menu } from 'electron';
import { FleetTabs, conversationUrl } from './me2/fleet-tabs.mjs';
import { join } from 'node:path';
import { LifecycleJournal } from './core/journal.mjs';
import { Me2Plane } from './me2/plane.mjs';
import { createWindowShell } from './core/window-shell.mjs';
import { StagedUpdater } from './update/staged-updater.mjs';
import { resolveInstanceAction, UPDATE } from './shared/me2-constants.mjs';
import { createNonce, verifyResurrectionData, resolveSecondaryHandoff } from './me2/instance-nonce.mjs';

const SMOKE = process.argv.includes('--me2-smoke');

// R77 lesson: composition must be explicit and journaled — no silent module swaps.
let plane = null;
let shell = null;
let journal = null;
let fleet = null;

async function boot() {
  const userDataDir = app.getPath('userData');
  journal = new LifecycleJournal({ userDataDir });
  journal.record('boot', { version: app.getVersion(), smoke: SMOKE, electron: process.versions.electron });

  const lockAcquired = app.requestSingleInstanceLock(createNonce()); // payload → primary's second-instance
  const action = resolveInstanceAction({ lockAcquired, hasResurrectionSignal: false });
  journal.record('instance_guard', { action, handoff: resolveSecondaryHandoff({ lockAcquired, data: null }).action });
  if (action !== 'primary') {
    if (SMOKE) console.log(JSON.stringify({ smoke: 'instance_guard', action }));
    app.exit(0);
    return;
  }

  const rootDir = app.getAppPath();
  plane = new Me2Plane({
    daemonDir: process.env.ME2_DAEMON_DIR ?? (app.isPackaged ? join(process.resourcesPath, 'me2-daemon') : join(rootDir, '..', 'me2-daemon')),
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
  plane.startKeepalive(); // R79: epoch-fenced keepalive (no-ops in tests — not called there)

  if (!SMOKE) {
    shell = createWindowShell({ BrowserWindow, WebContentsView, journal, log: (r) => journal.record('shell', r) });
    const uiUrl = status.ui.ok && status.gateway.ok ? `http://127.0.0.1:${status.gateway.port}/` : null;
    if (uiUrl) {
      const main = shell.addView({ role: 'MAIN', url: uiUrl });
      try {
        await main.view.webContents.loadURL(uiUrl);
        shell.activate('MAIN');
      } catch (error) {
        journal.record('ui_load_failed', { error: String(error?.message ?? error).slice(0, 160) });
        shell.removeView('MAIN');
        main.view.webContents.close();
      }
    }
    fleet = new FleetTabs({
      viewFactory: ({ id, role }) => {
        const result = shell.addView({ id, role });
        if (!result.ok) throw new Error(result.reason);
        return result.view;
      },
      activate: id => shell.activate(id), remove: id => shell.removeView(id),
      log: row => journal.record('fleet', row),
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'METAENGINE', submenu: [
      { label: 'Mission Control', accelerator: 'CmdOrCtrl+1', click: () => shell.activate('MAIN') },
      { label: 'New web conversation', accelerator: 'CmdOrCtrl+N', click: () => void fleet.createConversation() },
      { role: 'quit' },
    ] }]));
    shell.win.webContents.loadURL('data:text/html,<title>METAENGINE Desktop</title><body style="background:#09090b;color:#a1a1aa;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0"><div>Mission Control недоступен — честный DEGRADED. Журнал: userData/me2-desktop-lifecycle.jsonl</div></body>');
  }

  journal.record('ready', { smoke: SMOKE });
  if (SMOKE) {
    console.log(JSON.stringify({ smoke: 'plane', status: plane.snapshot() }, null, 2));
    await plane.shutdown();
    app.exit(status.daemon.ok && status.ui.ok && status.gateway.ok ? 0 : 13);
  }
}

// IPC surface (preload contract)
import { ipcMain } from 'electron';
function handleTrusted(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!shell?.trustedSender(event)) return { ok: false, reason: 'untrusted_sender' };
    return handler(...args);
  });
}
handleTrusted('me2:status', () => ({ ok: Boolean(plane), ...(plane?.snapshot() ?? {}), web_conversations: fleet?.list() ?? [] }));
handleTrusted('me2:list-conversations', () => ({ ok: Boolean(fleet), conversations: fleet?.list() ?? [] }));
handleTrusted('me2:focus-conversation', id => {
  if (!fleet?.list().some(row => row.tab_id === id && row.state !== 'INVALIDATED')) return { ok: false, reason: 'conversation_unavailable' };
  return shell.activate(id);
});
handleTrusted('me2:open-agent', session => fleet?.openAgent(session) ?? { ok: false, reason: 'fleet_unavailable' });
handleTrusted('me2:new-conversation', () => fleet?.createConversation() ?? { ok: false, reason: 'fleet_unavailable' });
handleTrusted('me2:open-site', url => {
  if (!conversationUrl(url)) return { ok: false, reason: 'web_conversation_url_required' };
  return fleet?.openAgent({ conversation_url: url }) ?? { ok: false, reason: 'fleet_unavailable' };
});
handleTrusted('me2:activate-panel', () => shell.activate('MAIN'));
handleTrusted('me2:restart', () => ({ ok: false, reason: 'restart_not_integrated' }));
handleTrusted('me2:update-check', () => ({ ok: false, current: app.getVersion(), latest: null, updateAvailable: false, error: 'qualified_update_channel_not_integrated' }));
handleTrusted('me2:update-apply', () => ({ ok: false, reason: 'qualified_update_channel_not_integrated' }));

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
app.on('second-instance', (_event, argv, _workingDirectory, additionalData) => {
  const ack = verifyResurrectionData(additionalData, { now: Date.now() });
  journal?.record('second_instance', { resurrect: true, ackOk: ack.ok, reason: ack.reason, argvCount: Array.isArray(argv) ? argv.length : 0 });
  if (shell?.win) {
    if (shell.win.isMinimized()) shell.win.restore();
    shell.win.focus();
  }
});

export { UPDATE };
