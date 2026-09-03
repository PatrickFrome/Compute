import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { persistSelfUpdateSessionContinuity } from '../src/self-update-session-continuity.mjs';
import { persistPreInstallReceipt, persistUpdatedSuccessorReceipt } from '../src/self-update-handoff.mjs';
import {
  probeUpdatedSuccessorQualification,
  recordAcceptedSignedSupervisorHeartbeat,
} from '../src/self-update-successor-qualification.mjs';
import {
  recordSelfUpdateRecoveryQualificationResult,
  selfUpdateRecoveryDiagnosticSnapshot,
  shouldResumeSuccessorQualification,
} from '../src/self-update-successor-recovery.mjs';
import { readSelfUpdateTransaction } from '../src/self-update-transaction-journal.mjs';

async function fixture() {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-qualification-'));
  let version = '0.6.3-dev.152.0';
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

function healthyHeartbeat(version, continuityState = 'RESTORED', sentinelHeartbeatAgeMs = 500) {
  return {
    shell_version: version,
    self_update_session_continuity: { state: continuityState, authority_effect: false },
    self_update: {
      state: 'CURRENT',
      current_version: version,
      last_error: null,
      host_resilience: {
        state: 'ACTIVE',
        sentinel_worker_healthy: true,
        sentinel: {
          lifecycle: 'ARMED',
          worker_ready: true,
          worker_heartbeat_age_ms: sentinelHeartbeatAgeMs,
          authority_effect: false,
        },
      },
    },
  };
}

function seedPendingRecovery(target) {
  const resume = shouldResumeSuccessorQualification({
    updatedLaunch: false,
    startupInspection: {
      schema: 'metaengine.self-update.startup-inspection.v1',
      state: 'TARGET_INSTALLED',
      transaction_state: 'SUCCESSOR_BOOTED',
      current_version: target,
      target_version: target,
      automatic_retry_allowed: false,
      authority_effect: false,
    },
  });
  assert.equal(resume, true);
  const pending = selfUpdateRecoveryDiagnosticSnapshot();
  assert.equal(pending.state, 'TARGET_INSTALLED_PENDING_QUALIFICATION');
  assert.equal(pending.qualification_resume_allowed, true);
  assert.equal(pending.recovery_installer_effect_allowed, false);
  assert.equal(pending.automatic_retry_allowed, false);
  return pending;
}

async function bootSuccessor(app, target = '0.6.3-dev.152.1') {
  await persistPreInstallReceipt(app, receipt(target));
  app.setVersion(target);
  await persistUpdatedSuccessorReceipt(app, { argv: ['browser','--updated'], primaryInstance: true });
  return target;
}

test('successor is not qualified while restored-session capsule still exists', async () => {
  const { app, userData } = await fixture();
  const target = await bootSuccessor(app);
  await persistSelfUpdateSessionContinuity(userData, {
    schema: 'metaengine.self-update-session-continuity.v1',
    current_version: '0.6.3-dev.152.0',
    target_version: target,
    created_at: new Date().toISOString(),
    tabs: [], lifecycle: null,
    persisted_chat_text: false, persisted_tab_titles: false, persisted_credentials: false,
    authority_effect: false,
  });
  await recordAcceptedSignedSupervisorHeartbeat({ app, state: healthyHeartbeat(target), acceptedAtMs: 5000 });
  const result = await probeUpdatedSuccessorQualification({ app, uptimeMs: () => 5000, nowMs: () => 5000 });
  assert.equal(result.state, 'PENDING_CONTINUITY');
  assert.equal((await readSelfUpdateTransaction(app)).state, 'SUCCESSOR_BOOTED');
});

test('exact successor requires singleton, uptime, continuity and a fresh signed heartbeat', async () => {
  const { app } = await fixture();
  const target = await bootSuccessor(app);
  seedPendingRecovery(target);

  app.setLocked(false);
  assert.equal((await probeUpdatedSuccessorQualification({ app, uptimeMs: () => 5000 })).state, 'PENDING_SINGLETON');
  app.setLocked(true);
  assert.equal((await probeUpdatedSuccessorQualification({ app, uptimeMs: () => 1000, minUptimeMs: 3000 })).state, 'PENDING_UPTIME');
  assert.equal((await probeUpdatedSuccessorQualification({ app, uptimeMs: () => 5000, minUptimeMs: 3000 })).state, 'PENDING_SIGNED_HEARTBEAT');

  const heartbeat = await recordAcceptedSignedSupervisorHeartbeat({ app, state: healthyHeartbeat(target), acceptedAtMs: 10_000 });
  assert.equal(heartbeat.state, 'HEARTBEAT_HEALTHY');
  assert.equal(heartbeat.sentinel_worker_healthy, true);
  const result = await probeUpdatedSuccessorQualification({
    app,
    uptimeMs: () => 5000,
    minUptimeMs: 3000,
    nowMs: () => 10_500,
  });
  assert.equal(result.state, 'QUALIFIED');
  const journal = await readSelfUpdateTransaction(app);
  assert.equal(journal.state, 'QUALIFIED');
  assert.equal(journal.qualified, true);
  assert.equal(journal.swapping, false);
  assert.equal(journal.evidence.primary_instance, true);
  assert.equal(journal.evidence.session_continuity_cleared, true);
  assert.equal(journal.evidence.signed_heartbeat_accepted, true);
  assert.equal(journal.evidence.self_update_runtime_healthy, true);
  assert.equal(journal.evidence.sentinel_armed, true);
  assert.equal(journal.evidence.sentinel_worker_healthy, true);

  const recovery = selfUpdateRecoveryDiagnosticSnapshot();
  assert.equal(recovery.state, 'QUALIFIED');
  assert.equal(recovery.transaction_state, 'QUALIFIED');
  assert.equal(recovery.qualification_resume_allowed, false);
  assert.equal(recovery.recovery_installer_effect_allowed, false);
  assert.equal(recovery.automatic_retry_allowed, false);
  assert.equal(recovery.authority_effect, false);
});

test('forged or mismatched qualification result cannot clear pending recovery telemetry', () => {
  const target = '0.6.3-dev.152.7';
  const before = seedPendingRecovery(target);
  const forged = recordSelfUpdateRecoveryQualificationResult({
    state: 'QUALIFIED',
    authority_effect: false,
    transaction: {
      schema: 'metaengine.self-update.transaction.v1',
      state: 'QUALIFIED',
      target_version: '0.6.3-dev.999.1',
      qualified: true,
      automatic_retry_allowed: false,
      authority_effect: false,
    },
  });
  assert.deepEqual(forged, before);
  assert.deepEqual(selfUpdateRecoveryDiagnosticSnapshot(), before);

  const effectful = recordSelfUpdateRecoveryQualificationResult({
    state: 'QUALIFIED',
    authority_effect: true,
    transaction: {
      schema: 'metaengine.self-update.transaction.v1',
      state: 'QUALIFIED',
      target_version: target,
      qualified: true,
      automatic_retry_allowed: false,
      authority_effect: false,
    },
  });
  assert.deepEqual(effectful, before);
  assert.equal(effectful.state, 'TARGET_INSTALLED_PENDING_QUALIFICATION');
});

test('signed heartbeat with stale or missing sentinel worker proof cannot qualify successor', async () => {
  const { app } = await fixture();
  const target = await bootSuccessor(app);
  const stale = await recordAcceptedSignedSupervisorHeartbeat({
    app,
    state: healthyHeartbeat(target, 'RESTORED', 20_000),
    acceptedAtMs: 10_000,
  });
  assert.equal(stale.state, 'HEARTBEAT_RESILIENCE_NOT_READY');
  assert.equal((await probeUpdatedSuccessorQualification({ app, uptimeMs: () => 5000, nowMs: () => 10_500 })).state, 'PENDING_SIGNED_HEARTBEAT');
});

test('hard continuity failure in accepted heartbeat quarantines successor', async () => {
  const { app } = await fixture();
  const target = await bootSuccessor(app);
  const result = await recordAcceptedSignedSupervisorHeartbeat({
    app,
    state: healthyHeartbeat(target, 'PARTIAL'),
    acceptedAtMs: 10_000,
  });
  assert.equal(result.state, 'QUARANTINED');
  const journal = await readSelfUpdateTransaction(app);
  assert.equal(journal.state, 'QUARANTINED');
  assert.equal(journal.automatic_retry_allowed, false);
});

test('stale heartbeat cannot qualify a successor', async () => {
  const { app } = await fixture();
  const target = await bootSuccessor(app);
  await recordAcceptedSignedSupervisorHeartbeat({ app, state: healthyHeartbeat(target), acceptedAtMs: 1000 });
  const result = await probeUpdatedSuccessorQualification({
    app,
    uptimeMs: () => 20_000,
    nowMs: () => 20_000,
    maxHeartbeatAgeMs: 10_000,
  });
  assert.equal(result.state, 'PENDING_SIGNED_HEARTBEAT');
});

test('qualification refuses wrong target version', async () => {
  const { app } = await fixture();
  await bootSuccessor(app);
  app.setVersion('0.6.3-dev.999.1');
  await assert.rejects(() => probeUpdatedSuccessorQualification({ app, uptimeMs: () => 5000 }), /target_mismatch/);
});

test('production entry installs signed hook before releasing the host-resilience bootstrap barrier', async () => {
  const source = await fs.readFile(new URL('../src/main-entry.mjs', import.meta.url), 'utf8');
  const barrier = source.indexOf('__METAENGINE_BROWSER_BOOTSTRAP_BARRIER__');
  const earlyImport = source.indexOf("import('./main.mjs')");
  const watchdog = source.indexOf('startSelfUpdateContinuityWatchdog({');
  const signedHook = source.indexOf('globalThis.fetch = installSignedSupervisorHeartbeatQualificationHook');
  const hostStart = source.indexOf('hostResilience.start()');
  const releaseBarrier = source.indexOf('resolveBrowserBootstrap?.(hostSnapshot)');
  const qualification = source.indexOf('if (resumeSuccessorQualification)');
  assert.ok(barrier >= 0 && earlyImport > barrier);
  assert.ok(watchdog > earlyImport && signedHook > watchdog);
  assert.ok(hostStart > signedHook && releaseBarrier > hostStart);
  assert.ok(qualification > releaseBarrier);
  assert.match(source, /qualifyUpdatedSuccessorWhenHealthy/);
  assert.match(source, /SELF_UPDATE_AUTOMATIC_RETRY_HELD/);
});
