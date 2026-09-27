/**
 * METAENGINE Desktop — main entry (PID-1 of the ME2 OS client plane).
 * Boot order: instance guard → lifecycle journal → ME2 plane (daemon → UI →
 * gateway) → window shell (MAIN = Mission Control) → update channel (staged).
 * Smoke mode (--me2-smoke): bring the plane up headless-ish, print the snapshot,
 * exit 0 — the honest machine-checkable probe for CI/operator.
 */
import { app, BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { LifecycleJournal } from './core/journal.mjs';
import { writeJsonAtomic } from './shared/durable-file.mjs';
import { Me2Plane } from './me2/plane.mjs';
import { createWindowShell } from './core/window-shell.mjs';
import { StagedUpdater } from './update/staged-updater.mjs';
import { ActivationManager } from './update/activator.mjs';
import { resolveInstanceAction, UPDATE, GUARDIAN } from './shared/me2-constants.mjs';
import { createNonce, verifyResurrectionData, resolveSecondaryHandoff } from './me2/instance-nonce.mjs';
import { makeBeacon } from './me2/guardian-contract.mjs';

const SMOKE = process.argv.includes('--me2-smoke');

// R77 lesson: composition must be explicit and journaled — no silent module swaps.
let plane = null;
let shell = null;
let journal = null;
let updater = null;
let activation = null;
let beaconTimer = null;
let beaconFile = null;
let bootId = null;

// R81 GAP #2: the client beats honestly (atomic beacon into userData) so the
// EXTERNAL guardian can evaluate liveness with the same journal contract.
// Smoke mode never beats — CI is not a watched patient.
function startGuardianBeacon(userDataDir) {
  bootId = randomUUID();
  beaconFile = join(userDataDir, GUARDIAN.BEACON_NAME);
  const beat = () => writeJsonAtomic(beaconFile, makeBeacon({ pid: process.pid, bootId, now: Date.now() }));
  beat();
  beaconTimer = setInterval(beat, GUARDIAN.BEACON_INTERVAL_MS);
  beaconTimer.unref?.();
  journal.record('guardian_beacon', { started: true, boot_id: bootId, interval_ms: GUARDIAN.BEACON_INTERVAL_MS });
}

function stopGuardianBeacon({ clean = false } = {}) {
  if (beaconTimer) { clearInterval(beaconTimer); beaconTimer = null; }
  if (!beaconFile || !bootId) return;
  try {
    writeJsonAtomic(beaconFile, makeBeacon({ pid: process.pid, bootId, now: Date.now(), cleanExit: clean }));
  } catch { /* last write loses nothing — the journal holds the truth */ }
  journal?.record('guardian_beacon', { started: false, clean });
}

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

  // R80 GAP #1a: activation verdict BEFORE the plane — the honest boot answer first.
  activation = new ActivationManager({
    userDataDir,
    currentVersion: app.getVersion(),
    argv: process.argv,
    journal: (r) => journal.record('activation', r),
    spawnImpl: spawn,
  });
  journal.record('activation_boot', activation.resolveBoot());

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
  plane.startKeepalive(); // R79: epoch-fenced keepalive (no-ops in tests — not called there)

  // R81 GAP #2: guardian beacon AFTER the plane is honestly up (a beaten boot
  // before this point would lie to the watchdog about a half-alive client).
  if (!SMOKE) startGuardianBeacon(userDataDir);

  // R80 GAP #1a: a fresh staged update arms the handoff (spawn installer on quit).
  if (status.update.last?.staged && plane.updater) {
    const stagedRec = [...plane.updater.journalHistory().records].reverse().find((r) => r.stage === 'staged');
    if (stagedRec) journal.record('activation_arm', activation.requestFromStaged(stagedRec));
  }

  if (!SMOKE) {
    shell = createWindowShell({ BrowserWindow, journal, log: (r) => journal.record('shell', r) });
    const uiUrl = status.ui.ok ? `http://127.0.0.1:3000/` : null;
    shell.addView({ role: 'MAIN', url: uiUrl ?? undefined });
    shell.activate('MAIN');
    shell.win.webContents.loadURL('data:text/html,<title>METAENGINE Desktop</title><body style="background:#09090b;color:#a1a1aa;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0"><div>Mission Control недоступен — честный DEGRADED. Журнал: userData/me2-desktop-lifecycle.jsonl</div></body>');
  }

  journal.record('ready', { smoke: SMOKE });
  if (SMOKE) {
    const snap = plane.snapshot();
    snap.activation = activation.snapshot(); // R80: machine-readable activation verdict
    console.log(JSON.stringify({ smoke: 'plane', status: snap }, null, 2));
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

// R80 GAP #1a: operator-visible activation surface (no silent execution).
ipcMain.handle('me2:update-apply', () => {
  if (!activation) return { ok: false, reason: 'activation_absent' };
  const stagedRec = [...(plane?.updater?.journalHistory().records ?? [])].reverse().find((r) => r.stage === 'staged');
  if (!stagedRec) return { ok: false, reason: 'nothing_staged' };
  return activation.requestFromStaged(stagedRec);
});
ipcMain.handle('me2:activation-status', () => activation?.snapshot() ?? { error: 'activation_absent' });

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
  stopGuardianBeacon({ clean: true }); // R81: mark the quit — the guardian never fights the operator
  journal?.record('exit', {});
  plane?.shutdown();
  activation?.spawnHandoff(); // R80 GAP #1a: armed → detached installer, survives exit
});
app.on('second-instance', (_event, argv, additionalData) => {
  const ack = verifyResurrectionData(additionalData, { now: Date.now() });
  journal?.record('second_instance', { resurrect: true, ackOk: ack.ok, reason: ack.reason, argvCount: Array.isArray(argv) ? argv.length : 0 });
  if (shell?.win) {
    if (shell.win.isMinimized()) shell.win.restore();
    shell.win.focus();
  }
});

export { UPDATE };
