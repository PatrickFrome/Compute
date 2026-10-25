import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const CAPTURE_FIXTURE_TITLE = 'METAENGINE Computer Capture Fixture';
export const CAPTURE_FIXTURE_READY_SCHEMA = 'metaengine.test.capture-window-ready.v1';
// Two independent production observations each include a 120s private-ACL
// prerequisite, THEN a 15s native-operation budget. 45s never covered that
// composition (serial STATUS alone took 27.8s). No production deadline changes.
export const CAPTURE_FIXTURE_TIMEOUT_MS = 30000 + 2 * (120000 + 15000 + 5000) + 10000;
export const CAPTURE_FIXTURE_FILE_POLL_INTERVAL_MS = 50;

// Electron 44's Windows GUI main process does not support Node child-process
// IPC, and its stdin is EOF-only. Keep the atomic nonce-bound file channel,
// but read only its two owned paths: Windows directory notifications can abort
// Node inside libuv before JavaScript can catch an error. These bounded file
// reads never repeat a native OBSERVE or CAPTURE operation.
export const captureFixtureSource = [
  "const { app, BrowserWindow } = require('electron');",
  "const fs = require('node:fs'), path = require('node:path');",
  'const fixtureRoot = fs.realpathSync(__dirname);',
  "for (const name of ['userData', 'sessionData']) {",
  '  const profilePath = path.join(fixtureRoot, name);',
  '  fs.mkdirSync(profilePath, { mode:0o700 });',
  "  if (!fs.lstatSync(profilePath).isDirectory() || fs.realpathSync(profilePath) !== profilePath) throw new Error('capture_fixture_profile_path_invalid');",
  '  app.setPath(name, profilePath);',
  '}',
  'const readyPath = process.env.METAENGINE_CAPTURE_READY_PATH, stopPath = process.env.METAENGINE_CAPTURE_STOP_PATH;',
  'const nonce = process.env.METAENGINE_CAPTURE_NONCE;',
  "app.commandLine.appendSwitch('disable-gpu');",
  'let win, stopTimer, stopping = false;',
  'function checkStop() {',
  '  if (stopping) return;',
  '  try {',
  '    const stat = fs.lstatSync(stopPath);',
  "    if (stat.isFile() && stat.size === nonce.length && fs.readFileSync(stopPath, 'utf8') === nonce) {",
  '      stopping = true; if (win) win.destroy(); app.quit(); return;',
  '    }',
  '  } catch {}',
  `  stopTimer = setTimeout(checkStop, ${CAPTURE_FIXTURE_FILE_POLL_INTERVAL_MS}); stopTimer.unref();`,
  '}',
  `const lifetimeTimer = setTimeout(() => app.quit(), ${CAPTURE_FIXTURE_TIMEOUT_MS}); lifetimeTimer.unref();`,
  "app.on('before-quit', () => { stopping = true; clearTimeout(stopTimer); clearTimeout(lifetimeTimer); });",
  'checkStop();',
  'app.whenReady().then(async () => {',
  '  if (stopping) return;',
  `  const title = ${JSON.stringify(CAPTURE_FIXTURE_TITLE)};`,
  '  win = new BrowserWindow({ width:360, height:240, x:80, y:80, show:false, frame:true, title });',
  "  const painted = new Promise(resolve => win.once('ready-to-show', resolve));",
  '  await win.loadURL(\'data:text/html,<html><head><title>METAENGINE%20Computer%20Capture%20Fixture</title></head><body><div style="font:18px sans-serif;padding:24px">stable-pixel-fixture</div></body></html>\');',
  '  await painted;',
  '  if (stopping) return;',
  '  win.setTitle(title); win.show(); win.focus();',
  '  const handle = win.getNativeWindowHandle();',
  "  const hwnd = '0x' + (handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())).toString(16);",
  `  const ready = { schema:${JSON.stringify(CAPTURE_FIXTURE_READY_SCHEMA)}, nonce, process_id:process.pid, window_handle:hwnd, title };`,
  "  fs.writeFileSync(readyPath + '.pending', JSON.stringify(ready), { flag:'wx' });",
  "  fs.renameSync(readyPath + '.pending', readyPath);",
  "}).catch(error => { console.error(error); app.exit(1); });",
  "app.on('window-all-closed', () => app.quit());",
].join('\n');

export function startCaptureFixture(executable, fixturePath, {
  spawnImpl = spawn, environment = process.env, signal, readyTimeoutMs = 30000, stopTimeoutMs = 5000,
} = {}) {
  const readyPath = fixturePath + '.ready.json', stopPath = fixturePath + '.stop';
  const nonce = randomBytes(24).toString('hex');
  const env = { ...environment, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    METAENGINE_CAPTURE_READY_PATH: readyPath, METAENGINE_CAPTURE_STOP_PATH: stopPath, METAENGINE_CAPTURE_NONCE: nonce };
  // Preserve the real main-process/sandbox mode regardless of the parent runner.
  delete env.ELECTRON_RUN_AS_NODE;
  let child, stderr = '', closed = false, terminalError = null, stopping = false, readyValue = null;
  let settleReady, rejectReady, settleClose, readinessTimer;
  const ready = new Promise((resolve, reject) => { settleReady = resolve; rejectReady = reject; });
  ready.catch(() => {}); // No unhandled rejection before the caller awaits readiness.
  const close = new Promise(resolve => { settleClose = resolve; });
  const stopReading = () => { clearTimeout(readinessTimer); readinessTimer = undefined; };
  const fail = error => { terminalError ||= error; stopReading(); clearTimeout(timer); rejectReady(terminalError); };
  const readReady = () => {
    if (readyValue || terminalError || closed || stopping) return;
    try {
      const stat = fs.lstatSync(readyPath);
      if (!stat.isFile() || stat.size > 4096) throw new Error('capture_fixture_ready_file_invalid');
      const message = JSON.parse(fs.readFileSync(readyPath, 'utf8'));
      if (message?.schema !== CAPTURE_FIXTURE_READY_SCHEMA || message.nonce !== nonce
          || message.process_id !== child.pid || message.title !== CAPTURE_FIXTURE_TITLE
          || !/^0x[1-9a-f][0-9a-f]*$/.test(message.window_handle || '')) throw new Error('capture_fixture_ready_identity_invalid');
      readyValue = message; clearTimeout(timer); stopReading(); settleReady(message); return;
    } catch (error) { if (error.code !== 'ENOENT') fail(error); }
    if (!terminalError) readinessTimer = setTimeout(readReady, CAPTURE_FIXTURE_FILE_POLL_INTERVAL_MS);
  };
  const timer = setTimeout(() => fail(new Error('capture_fixture_ready_timeout')), readyTimeoutMs);
  try {
    child = spawnImpl(executable, [fixturePath], {
      windowsHide: false, shell: false, stdio: ['ignore', 'ignore', 'pipe'], env,
    });
  } catch (error) { stopReading(); clearTimeout(timer); throw error; }
  const onAbort = () => {
    fail(signal.reason instanceof Error ? signal.reason : new Error('capture_fixture_aborted'));
    try { child.kill(); } catch {}
  };
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', chunk => { stderr = (stderr + chunk).slice(-8192); });
  child.once('error', error => fail(error));
  child.once('exit', (code, nativeSignal) => {
    if (!stopping) fail(new Error(`capture_fixture_exited:${code}:${nativeSignal || ''}:${stderr.slice(-500)}`));
  });
  child.once('close', (code, nativeSignal) => {
    closed = true; clearTimeout(timer); stopReading(); signal?.removeEventListener('abort', onAbort);
    if (!stopping) fail(new Error(`capture_fixture_closed:${code}:${nativeSignal || ''}`));
    settleClose();
  });
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  readReady();
  const assertRunning = () => {
    if (terminalError) throw terminalError;
    if (closed || child.exitCode !== null || child.signalCode != null) throw new Error('capture_fixture_not_running');
  };
  const waitClose = () => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('capture_fixture_teardown_unconfirmed')), stopTimeoutMs);
    close.then(() => { clearTimeout(timeout); resolve(); });
  });
  return {
    child, ready, assertRunning,
    async stop() {
      stopping = true; clearTimeout(timer); stopReading();
      if (!readyValue && !terminalError) fail(new Error('capture_fixture_stopped_before_ready'));
      if (closed) return;
      try { fs.writeFileSync(stopPath + '.pending', nonce, { flag: 'wx' }); fs.renameSync(stopPath + '.pending', stopPath); }
      catch { try { child.kill(); } catch {} }
      try { await waitClose(); }
      catch {
        try { child.kill(); } catch {}
        await waitClose(); // Refuse fixture-directory deletion without close.
      }
    },
  };
}

export async function captureExactFixtureWindow(fixture, observe, phase = async (_name, run) => run()) {
  const ready = await phase('window-ready', () => fixture.ready);
  fixture.assertRunning();
  const observed = await phase('OBSERVE_WINDOWS', () => observe({ action: 'OBSERVE_WINDOWS', args: { limit: 256 } }));
  fixture.assertRunning();
  const row = observed.result?.windows?.find(candidate => candidate?.identity?.process_id === ready.process_id
    && candidate?.identity?.window_handle === ready.window_handle && candidate?.title === ready.title);
  if (!row?.identity) throw new Error('capture_fixture_exact_window_missing:' + JSON.stringify({
    child_pid: ready.process_id, window_handle: ready.window_handle, count: observed.result?.count,
    total_candidates: observed.result?.total_candidates, rejected: observed.result?.rejected_windows,
  }));
  return phase('CAPTURE_WINDOW', () => observe({ action: 'CAPTURE_WINDOW', target: row.identity }));
}
