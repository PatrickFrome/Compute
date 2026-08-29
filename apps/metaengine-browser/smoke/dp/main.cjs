'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, utilityProcess } = require('electron/main');

const APP_ROOT = path.resolve(__dirname, '../..');
const SRC_ROOT = path.join(APP_ROOT, 'src');
const REPO_ROOT = path.resolve(APP_ROOT, '../..');
const TRACE_PATH = process.env.METAENGINE_SMOKE_TRACE ? path.resolve(process.env.METAENGINE_SMOKE_TRACE) : null;
let plane = null;
let completed = false;
let readyTimer = null;

function trace(stage, detail = {}) {
  if (!TRACE_PATH) return;
  const row = {
    schema: 'metaengine.development-plane.stage-trace.v3',
    stage: String(stage),
    pid: process.pid,
    platform: process.platform,
    at: new Date().toISOString(),
    detail,
    authority_effect: false,
  };
  try {
    fs.mkdirSync(path.dirname(TRACE_PATH), { recursive: true });
    fs.appendFileSync(TRACE_PATH, `${JSON.stringify(row)}\n`, 'utf8');
  } catch {}
}

async function fail(error, stage = 'FAILED') {
  if (completed) return;
  completed = true;
  if (readyTimer) clearTimeout(readyTimer);
  trace(stage, { error: String(error?.message || error).slice(0, 240), state: plane?.snapshot?.().state || null });
  try { await plane?.stopAndWait?.(2000); } catch {}
  app.exit(1);
}

async function run() {
  if (completed) return;
  if (readyTimer) clearTimeout(readyTimer);
  trace('APP_READY', { is_ready: app.isReady() });
  const { DevelopmentPlane } = await import(pathToFileURL(path.join(SRC_ROOT, 'development-plane.mjs')).href);
  plane = new DevelopmentPlane({
    spawnWorker: () => utilityProcess.fork(path.join(SRC_ROOT, 'development-plane-worker.cjs'), [], {
      cwd: REPO_ROOT,
      env: {
        METAENGINE_REPO_ROOT: REPO_ROOT,
        METAENGINE_GIT_REPOSITORY: 'PatrickFrome/Compute',
        SYSTEMROOT: process.env.SYSTEMROOT || '',
        WINDIR: process.env.WINDIR || '',
        TEMP: process.env.TEMP || process.env.TMP || '',
        TMP: process.env.TMP || process.env.TEMP || '',
      },
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
  const candidate = await plane.request('CANDIDATE_CAPSULE_CREATE', {
    source_head: repo.head,
    sequence: 1,
    intent: 'Physical DP1 candidate capsule provenance smoke',
    components: [{
      path: 'apps/metaengine-browser/src/development-plane.mjs',
      change: 'MODIFY',
      digest: `sha256:${'1'.repeat(64)}`,
    }],
    verification_plan: [
      { id: 'PARSE_GATE', required: true },
      { id: 'UNIT_TESTS', required: true },
      { id: 'PHYSICAL_DP_SMOKE', required: true },
    ],
    evidence: [],
  });
  const candidateVerification = await plane.request('CANDIDATE_CAPSULE_VERIFY', { capsule: candidate });
  trace('DP_CANDIDATE_VERIFIED', {
    ok: candidateVerification?.ok === true,
    candidate_id: candidate?.candidate_id || null,
    candidate_only: candidate?.policy?.candidate_only === true,
    executable: candidate?.policy?.executable === true,
    promotion_authorized: candidateVerification?.promotion_authorized === true,
  });
  const shutdown = await plane.stopAndWait(4000);
  trace('DP_STOPPED', { shutdown });
  const ok = state.state === 'READY'
    && health?.ok === true
    && capabilities?.version === state.version
    && capabilities?.candidate_capsules === true
    && capabilities?.candidate_capsules_executable === false
    && capabilities?.direct_promote_current === false
    && repo?.repository_present === true
    && candidate?.source?.head === repo.head
    && candidate?.policy?.candidate_only === true
    && candidate?.policy?.executable === false
    && candidate?.policy?.direct_promote_current === false
    && candidateVerification?.ok === true
    && candidateVerification?.source_current === true
    && candidateVerification?.promotion_authorized === false
    && shutdown?.ok === true
    && shutdown?.state === 'STOPPED'
    && shutdown?.cooperative_shutdown_ack === true;
  const receipt = {
    schema: 'metaengine.development-plane.physical-smoke.v3',
    ok,
    state,
    health,
    capabilities,
    repo,
    candidate,
    candidate_verification: candidateVerification,
    shutdown,
    authority_effect: false,
  };
  try { process.stdout.write(`${JSON.stringify(receipt)}\n`); } catch {}
  trace('COMPLETE', {
    ok,
    candidate_verified: candidateVerification?.ok === true,
    candidate_executable: candidate?.policy?.executable === true,
    promotion_authorized: candidateVerification?.promotion_authorized === true,
    shutdown_state: shutdown?.state || null,
    cooperative_shutdown_ack: shutdown?.cooperative_shutdown_ack === true,
  });
  completed = true;
  app.exit(ok ? 0 : 1);
}

app.enableSandbox();
trace('MODULE_LOADED', {
  electron: process.versions.electron || null,
  chromium: process.versions.chrome || null,
  app_ready_initial: app.isReady(),
});

readyTimer = setTimeout(() => {
  fail(new Error('development_plane_smoke_app_ready_timeout'), 'APP_READY_TIMEOUT').catch(() => app.exit(1));
}, 10000);

if (app.isReady()) {
  queueMicrotask(() => run().catch((error) => fail(error)));
} else {
  app.once('ready', () => {
    run().catch((error) => fail(error));
  });
}
