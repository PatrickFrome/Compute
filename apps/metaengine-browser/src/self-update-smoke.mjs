import fs from 'node:fs/promises';
import path from 'node:path';
import { SelfUpdateRuntime } from './self-update-runtime.mjs';

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
  const runtime = new SelfUpdateRuntime({
    packaged: true,
    hostResilience: false,
    restartGraceMs: 3000,
    intervalMs: 60_000,
    canRestart: async () => true,
    beforeInstall: async (receipt) => {
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
        receipt_schema: receipt.schema,
        last_error: null,
        authority_effect: false,
      });
      if (!app.hasSingleInstanceLock()) throw new Error('self_update_smoke_primary_lock_missing');
      // Match production handoff: release the primary lock only after durable pre-install evidence.
      // N is already quiescent in this smoke; N+1 must be able to acquire the same stable app lock.
      app.releaseSingleInstanceLock();
    },
  });
  let lastState = null;
  const startedAt = Date.now();
  const record = async (label) => {
    const snapshot = runtime.snapshot();
    if (snapshot.state !== lastState || label !== 'POLL') {
      lastState = snapshot.state;
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
