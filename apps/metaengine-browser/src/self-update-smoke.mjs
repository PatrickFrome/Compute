import fs from 'node:fs/promises';
import path from 'node:path';
import { SelfUpdateRuntime } from './self-update-runtime.mjs';
import { persistPreInstallReceipt, SUCCESSOR_STARTUP_PROBE_ONLY } from './self-update-handoff.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function appendTrace(tracePath, row) {
  if (!tracePath) return;
  await fs.mkdir(path.dirname(tracePath), { recursive: true });
  const handle = await fs.open(tracePath, 'a', 0o600);
  try {
    await handle.write(`${JSON.stringify(row)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function runSelfUpdateSmoke({ app, timeoutMs = 120_000 } = {}) {
  if (!app) throw new Error('self_update_smoke_app_required');
  const tracePath = process.env.METAENGINE_SELF_UPDATE_SMOKE_TRACE || null;

  // Physical update proof must exercise the exact installed crash sentinel. Earlier
  // E2E disabled it and therefore could not reproduce Windows install-directory locks.
  delete process.env.METAENGINE_DISABLE_CRASH_SENTINEL;

  let runtime = null;
  runtime = new SelfUpdateRuntime({
    packaged: true,
    restartGraceMs: 3000,
    intervalMs: 60_000,
    canRestart: async () => true,
    beforeInstall: async (receipt) => {
      const persisted = {
        ...receipt,
        successor_startup: SUCCESSOR_STARTUP_PROBE_ONLY,
      };
      await persistPreInstallReceipt(app, persisted);
      await appendTrace(tracePath, {
        schema: 'metaengine.self-update-smoke.trace.v1',
        label: 'PRE_INSTALL_INTENT',
        at: new Date().toISOString(),
        app_version: app.getVersion(),
        state: 'RESTARTING',
        available_version: receipt.available_version,
        downloaded_version: receipt.version,
        metadata_verified: receipt.metadata_verified === true,
        restart_gate_safe: receipt.restart_gate_safe === true,
        ci_test_feed_active: process.env.METAENGINE_SELF_UPDATE_TEST_MODE === '1' && process.env.GITHUB_ACTIONS === 'true',
        pre_install_receipt_persisted: true,
        successor_startup: SUCCESSOR_STARTUP_PROBE_ONLY,
        receipt_schema: receipt.schema,
        last_error: null,
        authority_effect: false,
      });
    },
    beforeInstallerLaunch: async (receipt) => {
      const sentinel = runtime?.snapshot()?.host_resilience?.sentinel || null;
      if (!sentinel || sentinel.installer_handoff !== true || sentinel.worker_released !== true) {
        throw new Error('self_update_smoke_sentinel_not_released');
      }
      // Keep historical E2E singleton semantics for the probe successor; production
      // runtime is separately fenced by the primary-instance guard.
      if (!app.hasSingleInstanceLock()) throw new Error('self_update_smoke_primary_lock_missing');
      app.releaseSingleInstanceLock();
      const released = !app.hasSingleInstanceLock();
      if (!released) throw new Error('self_update_smoke_singleton_release_failed');
      await appendTrace(tracePath, {
        schema: 'metaengine.self-update-smoke.trace.v1',
        label: 'INSTALLER_HANDOFF_PREPARED',
        at: new Date().toISOString(),
        app_version: app.getVersion(),
        state: 'RESTARTING',
        available_version: receipt.available_version,
        downloaded_version: receipt.version,
        metadata_verified: receipt.metadata_verified === true,
        restart_gate_safe: receipt.restart_gate_safe === true,
        singleton_lock_released: true,
        sentinel_worker_released: true,
        sentinel_worker_pid: sentinel.worker_pid || null,
        authority_effect: false,
      });
    },
  });
  let lastState = null;
  const startedAt = Date.now();
  const record = async (label) => {
    const snapshot = runtime.snapshot();
    if (snapshot.state !== lastState || label !== 'POLL') {
      lastState = snapshot.state;
      const sentinel = snapshot.host_resilience?.sentinel || null;
      const row = {
        schema: 'metaengine.self-update-smoke.trace.v1',
        label,
        at: new Date().toISOString(),
        app_version: app.getVersion(),
        state: snapshot.state,
        available_version: snapshot.available_version,
        downloaded_version: snapshot.downloaded_version,
        metadata_verified: snapshot.metadata_verified,
        restart_gate_safe: snapshot.restart_gate_safe,
        ci_test_feed_active: snapshot.ci_test_feed_active,
        pre_install_receipt_persisted: snapshot.pre_install_receipt_persisted,
        installer_handoff_prepared: snapshot.installer_handoff_prepared,
        sentinel_lifecycle: sentinel?.lifecycle || null,
        sentinel_worker_pid: sentinel?.worker_pid || null,
        sentinel_worker_released: sentinel?.worker_released === true,
        last_error: snapshot.last_error,
        authority_effect: false,
      };
      console.log(JSON.stringify(row));
      await appendTrace(tracePath, row);
    }
    return snapshot;
  };

  await runtime.start();
  await record('STARTED');
  let snapshot = await runtime.cycle({ force: true });
  await record('FORCED_CHECK');
  while (Date.now() - startedAt < timeoutMs) {
    if (snapshot.state === 'ERROR' || snapshot.state === 'REJECTED_METADATA') {
      await record('FAILED');
      app.exit(2);
      return snapshot;
    }
    if (snapshot.state === 'RESTARTING') {
      await record('RESTARTING');
      return snapshot;
    }
    await sleep(500);
    snapshot = await runtime.cycle();
    await record('POLL');
  }
  await record('TIMEOUT');
  app.exit(3);
  return runtime.snapshot();
}
