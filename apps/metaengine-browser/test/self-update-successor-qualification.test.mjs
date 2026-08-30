import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { persistSelfUpdateSessionContinuity } from '../src/self-update-session-continuity.mjs';
import { persistPreInstallReceipt, persistUpdatedSuccessorReceipt } from '../src/self-update-handoff.mjs';
import { probeUpdatedSuccessorQualification } from '../src/self-update-successor-qualification.mjs';
import { readSelfUpdateTransaction } from '../src/self-update-transaction-journal.mjs';

async function fixture() {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-qualification-'));
  let version = '0.6.3-dev.150.0';
  let locked = true;
  const app = {
    isPackaged: true,
    getPath: (name) => { assert.equal(name, 'userData'); return userData; },
    getVersion: () => version,
    hasSingleInstanceLock: () => locked,
    setVersion: (value) => { version = String(value); },
    setLocked: (value) => { locked = value === true; },
  };
  return { app, userData };
}

function receipt(target) {
  return {
    schema: 'metaengine.self-update.pre-install-receipt.v1',
    version: target,
    available_version: target,
    metadata_verified: true,
    publisher_verified: true,
    restart_gate_safe: true,
    restart_gate_since: new Date().toISOString(),
    recorded_at: new Date().toISOString(),
    authority_effect: false,
  };
}

test('successor is not qualified while restored-session capsule still exists', async () => {
  const { app, userData } = await fixture();
  await persistPreInstallReceipt(app, receipt('0.6.3-dev.150.1'));
  app.setVersion('0.6.3-dev.150.1');
  await persistUpdatedSuccessorReceipt(app, { argv: ['browser','--updated'], primaryInstance: true });
  await persistSelfUpdateSessionContinuity(userData, {
    schema: 'metaengine.self-update-session-continuity.v1',
    current_version: '0.6.3-dev.150.0',
    target_version: '0.6.3-dev.150.1',
    created_at: new Date().toISOString(),
    tabs: [], lifecycle: null,
    persisted_chat_text: false, persisted_tab_titles: false, persisted_credentials: false,
    authority_effect: false,
  });
  const result = await probeUpdatedSuccessorQualification({ app, uptimeMs: () => 5000 });
  assert.equal(result.state, 'PENDING_CONTINUITY');
  assert.equal((await readSelfUpdateTransaction(app)).state, 'SUCCESSOR_BOOTED');
});

test('exact successor qualifies only after primary lock, uptime and continuity restoration', async () => {
  const { app } = await fixture();
  await persistPreInstallReceipt(app, receipt('0.6.3-dev.150.1'));
  app.setVersion('0.6.3-dev.150.1');
  await persistUpdatedSuccessorReceipt(app, { argv: ['browser','--updated'], primaryInstance: true });
  app.setLocked(false);
  assert.equal((await probeUpdatedSuccessorQualification({ app, uptimeMs: () => 5000 })).state, 'PENDING_SINGLETON');
  app.setLocked(true);
  assert.equal((await probeUpdatedSuccessorQualification({ app, uptimeMs: () => 1000, minUptimeMs: 3000 })).state, 'PENDING_UPTIME');
  const result = await probeUpdatedSuccessorQualification({ app, uptimeMs: () => 5000, minUptimeMs: 3000 });
  assert.equal(result.state, 'QUALIFIED');
  const journal = await readSelfUpdateTransaction(app);
  assert.equal(journal.state, 'QUALIFIED');
  assert.equal(journal.qualified, true);
  assert.equal(journal.swapping, false);
  assert.equal(journal.evidence.primary_instance, true);
  assert.equal(journal.evidence.session_continuity_cleared, true);
});

test('qualification refuses wrong target version', async () => {
  const { app } = await fixture();
  await persistPreInstallReceipt(app, receipt('0.6.3-dev.150.1'));
  app.setVersion('0.6.3-dev.150.1');
  await persistUpdatedSuccessorReceipt(app, { argv: ['browser','--updated'], primaryInstance: true });
  app.setVersion('0.6.3-dev.999.1');
  await assert.rejects(() => probeUpdatedSuccessorQualification({ app, uptimeMs: () => 5000 }), /target_mismatch/);
});

test('production entry schedules qualification only on --updated launches', async () => {
  const source = await fs.readFile(new URL('../src/main-entry.mjs', import.meta.url), 'utf8');
  assert.match(source, /qualifyUpdatedSuccessorWhenHealthy/);
  assert.match(source, /if \(updatedLaunch\)/);
  assert.match(source, /SELF_UPDATE_AUTOMATIC_RETRY_HELD/);
});

test('proof-only successor releases singleton only after durable successor receipt path', async () => {
  const source = await fs.readFile(new URL('../src/main-entry.mjs', import.meta.url), 'utf8');
  const persistIndex = source.indexOf('persistUpdatedSuccessorReceipt');
  const probeOnlyIndex = source.indexOf('updateHandoff?.successor_startup === SUCCESSOR_STARTUP_PROBE_ONLY');
  const releaseIndex = source.indexOf('app.releaseSingleInstanceLock()');
  const exitIndex = source.indexOf('app.exit(0)', releaseIndex);
  assert.ok(persistIndex >= 0 && probeOnlyIndex > persistIndex, 'successor receipt must be persisted before proof-only branch');
  assert.ok(releaseIndex > probeOnlyIndex, 'proof-only release must stay scoped to successor evidence path');
  assert.ok(exitIndex > releaseIndex, 'proof-only process must release singleton before exit');
  assert.match(source, /app\.hasSingleInstanceLock\(\) === true/);
  assert.match(source, /typeof app\.releaseSingleInstanceLock === 'function'/);
});
