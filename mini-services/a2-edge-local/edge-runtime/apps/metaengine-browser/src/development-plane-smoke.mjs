import { app, utilityProcess } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DevelopmentPlane } from './development-plane.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const repoRoot = path.resolve(APP_ROOT, '../..');
const tracePath = process.env.METAENGINE_SMOKE_TRACE ? path.resolve(process.env.METAENGINE_SMOKE_TRACE) : null;

async function trace(stage, detail = {}) {
  if (!tracePath) return;
  const row = {
    schema: 'metaengine.development-plane.stage-trace.v1',
    stage: String(stage),
    pid: process.pid,
    platform: process.platform,
    at: new Date().toISOString(),
    detail,
    authority_effect: false,
  };
  try {
    await fs.mkdir(path.dirname(tracePath), { recursive: true });
    await fs.appendFile(tracePath, `${JSON.stringify(row)}\n`, 'utf8');
  } catch {}
}

app.enableSandbox();
await trace('MODULE_LOADED', { electron: process.versions.electron || null, chromium: process.versions.chrome || null });

let plane = null;
let exitCode = 1;
try {
  await app.whenReady();
  await trace('APP_READY');
  plane = new DevelopmentPlane({
    spawnWorker: () => utilityProcess.fork(path.join(__dirname, 'development-plane-worker.cjs'), [], {
      cwd: repoRoot,
      env: { METAENGINE_REPO_ROOT: repoRoot },
      stdio: 'inherit',
      serviceName: 'METAENGINE Development Plane Smoke',
    }),
  });
  await trace('DP_STARTING');
  const state = await plane.start();
  await trace('DP_READY', { version: state.version, state: state.state, pid_present: Number.isInteger(state.pid) });
  const health = await plane.request('HEALTH');
  const capabilities = await plane.request('CAPABILITIES');
  const repo = await plane.request('REPO_HEAD_READ');
  await trace('DP_REQUESTS_COMPLETE', {
    health_ok: health?.ok === true,
    capabilities_version: capabilities?.version || null,
    repository_present: repo?.repository_present === true,
  });
  const shutdown = await plane.stopAndWait(4000);
  await trace('DP_STOPPED', { shutdown });
  const ok = state.state === 'READY'
    && health?.ok === true
    && capabilities?.version === state.version
    && capabilities?.direct_promote_current === false
    && repo?.repository_present === true
    && shutdown?.ok === true
    && shutdown?.state === 'STOPPED'
    && shutdown?.cooperative_shutdown_ack === true;
  const receipt = {
    schema: 'metaengine.development-plane.physical-smoke.v1',
    ok,
    state,
    health,
    capabilities,
    repo,
    shutdown,
    authority_effect: false,
  };
  try { process.stdout.write(`${JSON.stringify(receipt)}\n`); } catch {}
  await trace('COMPLETE', { ok, shutdown_state: shutdown?.state || null, cooperative_shutdown_ack: shutdown?.cooperative_shutdown_ack === true });
  exitCode = ok ? 0 : 1;
} catch (error) {
  await trace('FAILED', { error: String(error?.message || error).slice(0, 240), state: plane?.snapshot()?.state || null });
  try { await plane?.stopAndWait?.(2000); } catch {}
  exitCode = 1;
}

app.exit(exitCode);
