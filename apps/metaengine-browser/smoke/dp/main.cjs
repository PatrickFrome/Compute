'use strict';

const { app, utilityProcess } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_ROOT = path.resolve(__dirname, '../..');
const SRC_ROOT = path.join(APP_ROOT, 'src');
const repoRoot = path.resolve(APP_ROOT, '../..');
const tracePath = process.env.METAENGINE_SMOKE_TRACE ? path.resolve(process.env.METAENGINE_SMOKE_TRACE) : null;

function trace(stage, detail = {}) {
  if (!tracePath) return;
  const row = {
    schema: 'metaengine.development-plane.stage-trace.v2',
    stage: String(stage),
    pid: process.pid,
    platform: process.platform,
    at: new Date().toISOString(),
    detail,
    authority_effect: false,
  };
  try {
    fs.mkdirSync(path.dirname(tracePath), { recursive: true });
    fs.appendFileSync(tracePath, `${JSON.stringify(row)}\n`, 'utf8');
  } catch {}
}

app.enableSandbox();
trace('MODULE_LOADED', {
  electron: process.versions.electron || null,
  chromium: process.versions.chrome || null,
  cjs_ready_listener: true,
});

let plane = null;
let finished = false;

function finish(code) {
  if (finished) return;
  finished = true;
  trace('APP_EXIT', { code });
  app.exit(code);
}

async function runAfterReady() {
  trace('APP_READY', { is_ready: app.isReady() });
  const moduleUrl = pathToFileURL(path.join(SRC_ROOT, 'development-plane.mjs')).href;
  const { DevelopmentPlane } = await import(moduleUrl);
  trace('DP_MODULE_IMPORTED');

  plane = new DevelopmentPlane({
    spawnWorker: () => utilityProcess.fork(path.join(SRC_ROOT, 'development-plane-worker.cjs'), [], {
      cwd: repoRoot,
      env: { METAENGINE_REPO_ROOT: repoRoot },
      stdio: 'inherit',
      serviceName: 'METAENGINE Development Plane Smoke',
    }),
  });

  trace('DP_STARTING');
  const state = await plane.start();
  trace('DP_READY', { version: state.version, state: state.state, pid_present: Number.isInteger(state.pid) });

  const health = await plane.request('HEALTH');
  const capabilities = await plane.request('CAPABILITIES');
  const repo = await plane.request('REPO_HEAD_READ');
  trace('DP_REQUESTS_COMPLETE', {
    health_ok: health?.ok === true,
    capabilities_version: capabilities?.version || null,
    repository_present: repo?.repository_present === true,
  });

  const shutdown = await plane.stopAndWait(4000);
  trace('DP_STOPPED', { shutdown });

  const ok = state.state === 'READY'
    && health?.ok === true
    && capabilities?.version === state.version
    && capabilities?.direct_promote_current === false
    && repo?.repository_present === true
    && shutdown?.ok === true
    && shutdown?.state === 'STOPPED'
    && shutdown?.cooperative_shutdown_ack === true;

  const receipt = {
    schema: 'metaengine.development-plane.physical-smoke.v2',
    ok,
    state,
    health,
    capabilities,
    repo,
    shutdown,
    cjs_ready_listener: true,
    authority_effect: false,
  };
  try { process.stdout.write(`${JSON.stringify(receipt)}\n`); } catch {}
  trace('COMPLETE', {
    ok,
    shutdown_state: shutdown?.state || null,
    cooperative_shutdown_ack: shutdown?.cooperative_shutdown_ack === true,
  });
  finish(ok ? 0 : 1);
}

const readyWatchdog = setTimeout(() => {
  trace('READY_TIMEOUT', { is_ready: app.isReady() });
  finish(70);
}, 12000);
readyWatchdog.unref?.();

app.once('ready', () => {
  clearTimeout(readyWatchdog);
  runAfterReady().catch(async (error) => {
    trace('FAILED', { error: String(error?.message || error).slice(0, 240), state: plane?.snapshot?.()?.state || null });
    try { await plane?.stopAndWait?.(2000); } catch {}
    finish(1);
  });
});
