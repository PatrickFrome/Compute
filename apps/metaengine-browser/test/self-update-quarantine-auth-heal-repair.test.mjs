import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EventEmitter } from 'node:events';

import {
  PersistentBrowserCdpSessionPool,
} from '../src/browser-persistent-cdp-session.mjs';
import { captureSemanticFrame } from '../src/native-browser-control.mjs';
import {
  readSelfUpdateTransaction,
  beginSelfUpdateTransaction,
  quarantineSelfUpdateTransaction,
  reopenQuarantinedSelfUpdateTransactionForRequalification,
  transitionSelfUpdateTransaction,
} from '../src/self-update-transaction-journal.mjs';
import {
  buildSelfUpdateRecoveryDiagnostic,
  recordSelfUpdateRecoveryQuarantineReopenResult,
  selfUpdateRecoveryDiagnosticSnapshot,
  shouldResumeSuccessorQualification,
} from '../src/self-update-successor-recovery.mjs';
import {
  recordAcceptedSignedSupervisorHeartbeat,
} from '../src/self-update-successor-qualification.mjs';
import { applyQuarantineAuthHealToContinuityStatus } from '../src/native-supervisor-client-base.mjs';
import { persistPreInstallReceipt, persistUpdatedSuccessorReceipt } from '../src/self-update-handoff.mjs';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

async function successorBootedAppFixture() {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-quarantine-heal-'));
  let version = '0.7.0-dev.35290878836.0';
  const app = {
    isPackaged: true,
    getPath: (name) => { assert.equal(name, 'userData'); return userData; },
    getVersion: () => version,
    hasSingleInstanceLock: () => true,
  };
  const target = '0.7.0-dev.35290878836.1';
  await persistPreInstallReceipt(app, {
    schema: 'metaengine.self-update.pre-install-receipt.v1',
    version: target,
    available_version: target,
    metadata_verified: true,
    publisher_verified: true,
    restart_gate_safe: true,
    restart_gate_since: new Date().toISOString(),
    recorded_at: new Date().toISOString(),
    authority_effect: false,
  });
  version = target;
  await persistUpdatedSuccessorReceipt(app, { argv: ['browser', '--updated'], primaryInstance: true });
  return { app, version: target };
}

async function quarantinedAppFixture({ quarantineReason = 'session_continuity_auth_required' } = {}) {
  const fixture = await successorBootedAppFixture();
  await quarantineSelfUpdateTransaction(fixture.app, quarantineReason);
  return fixture;
}

// Quarantine through the PRODUCTION heartbeat path so both the journal and
// the recovery diagnostic reflect the real transition chain.
async function quarantineThroughHeartbeat({ app, version }) {
  return recordAcceptedSignedSupervisorHeartbeat({
    app,
    state: heartbeatState(version, {
      state: 'AUTH_REQUIRED',
      user_session_continuity: 'LOST',
      authority_effect: false,
    }),
  });
}

function seedPendingQualificationDiagnostic(app, { transaction } = {}) {
  const inspection = {
    schema: 'metaengine.self-update.startup-inspection.v1',
    authority_effect: false,
    state: 'TARGET_INSTALLED',
    transaction_state: 'SUCCESSOR_BOOTED',
    transaction_id: transaction.transaction_id,
    target_git_sha: transaction.resolved_git_sha,
    current_version: transaction.target_version,
    target_version: transaction.target_version,
    automatic_retry_allowed: false,
  };
  // Production seeds the diagnostic through the resume decision; mirror it.
  const resume = shouldResumeSuccessorQualification({ updatedLaunch: false, startupInspection: inspection });
  assert.equal(resume, true, 'fixture must seed a pending-qualification diagnostic');
  assert.equal(buildSelfUpdateRecoveryDiagnostic(inspection).state, 'TARGET_INSTALLED_PENDING_QUALIFICATION');
}

function heartbeatState(version, sessionContinuity, selfUpdateOverrides = {}) {
  return {
    shell_version: version,
    self_update_session_continuity: sessionContinuity,
    self_update: {
      state: 'CURRENT',
      current_version: version,
      last_error: null,
      host_resilience: {
        state: 'ACTIVE',
        sentinel_worker_healthy: true,
        sentinel: { lifecycle: 'ARMED', worker_ready: true, worker_heartbeat_age_ms: 250 },
      },
      ...selfUpdateOverrides,
    },
  };
}

// ---------------------------------------------------------------------------
// D-Q1 — journal reopen contract
// ---------------------------------------------------------------------------

test('journal reopen transitions QUARANTINED -> SUCCESSOR_BOOTED with heal evidence', async () => {
  const { app } = await quarantinedAppFixture();
  const before = await readSelfUpdateTransaction(app);
  assert.equal(before.state, 'QUARANTINED');
  assert.equal(before.quarantined, true);

  const reopened = await reopenQuarantinedSelfUpdateTransactionForRequalification(app, {
    reason: 'session_continuity_auth_required_healed',
    healedEvidence: { auth_readback_state: 'AUTHENTICATED', metadata_only: true },
  });
  assert.equal(reopened.state, 'SUCCESSOR_BOOTED');
  assert.equal(reopened.quarantined, false);
  assert.equal(reopened.qualified, false);
  assert.equal(reopened.automatic_retry_allowed, false);
  assert.equal(reopened.authority_effect, false);
  assert.equal(reopened.evidence.quarantine_reopened, true);
  assert.equal(reopened.evidence.quarantine_reason, 'session_continuity_auth_required');
  assert.equal(reopened.evidence.quarantine_reopen_reason, 'session_continuity_auth_required_healed');
  assert.equal(reopened.evidence.auth_readback_state, 'AUTHENTICATED');
  assert.equal(reopened.target_version, before.target_version);
  assert.equal(reopened.transaction_id, before.transaction_id);
});

test('journal reopen enforces target binding and QUARANTINED-only entry', async () => {
  const { app, version } = await quarantinedAppFixture();
  await assert.rejects(
    reopenQuarantinedSelfUpdateTransactionForRequalification(app, { requireTargetVersion: '0.0.0-other' }),
    /self_update_transaction_target_binding_mismatch/,
  );

  // Non-quarantined state refuses reopen (fail-closed).
  const { app: fresh } = await quarantinedAppFixture();
  await reopenQuarantinedSelfUpdateTransactionForRequalification(fresh, {});
  await assert.rejects(
    reopenQuarantinedSelfUpdateTransactionForRequalification(fresh, {}),
    /self_update_transaction_reopen_state_invalid:SUCCESSOR_BOOTED/,
  );
  assert.equal(version.length > 0, true);
});

test('generic transition from QUARANTINED to QUALIFIED is still rejected (fail-closed intact)', async () => {
  const { app } = await quarantinedAppFixture();
  await assert.rejects(
    transitionSelfUpdateTransaction(app, 'QUALIFIED'),
    /self_update_transaction_transition_invalid:QUARANTINED:QUALIFIED/,
  );
  await assert.rejects(
    transitionSelfUpdateTransaction(app, 'PREPARED'),
    /self_update_transaction_transition_invalid:QUARANTINED:PREPARED/,
  );
});

// ---------------------------------------------------------------------------
// D-Q1 — recovery diagnostic reopen recording
// ---------------------------------------------------------------------------

test('diagnostic reopen recording returns QUARANTINED to pending qualification', async () => {
  const { app, version } = await successorBootedAppFixture();
  const transaction = await readSelfUpdateTransaction(app);
  seedPendingQualificationDiagnostic(app, { transaction });

  // Quarantine through the production heartbeat path.
  const quarantinedResult = await quarantineThroughHeartbeat({ app, version });
  assert.equal(quarantinedResult.state, 'QUARANTINED');
  assert.equal(quarantinedResult.reason, 'session_continuity_auth_required');
  assert.equal(selfUpdateRecoveryDiagnosticSnapshot().state, 'QUARANTINED');

  const reopened = await reopenQuarantinedSelfUpdateTransactionForRequalification(app, {
    reason: 'session_continuity_auth_required_healed',
    healedEvidence: { auth_readback_state: 'AUTHENTICATED', metadata_only: true },
  });
  const diagnosticAfterReopen = recordSelfUpdateRecoveryQuarantineReopenResult(reopened);
  assert.equal(diagnosticAfterReopen.state, 'TARGET_INSTALLED_PENDING_QUALIFICATION');
  assert.equal(diagnosticAfterReopen.transaction_state, 'SUCCESSOR_BOOTED');
  assert.equal(diagnosticAfterReopen.qualification_resume_allowed, true);
  assert.equal(diagnosticAfterReopen.recovery_installer_effect_allowed, false);
  assert.equal(diagnosticAfterReopen.automatic_retry_allowed, false);
});

test('diagnostic reopen recording ignores wrong-shape transactions', async () => {
  const { app, version } = await successorBootedAppFixture();
  const transaction = await readSelfUpdateTransaction(app);
  seedPendingQualificationDiagnostic(app, { transaction });
  await quarantineThroughHeartbeat({ app, version });
  assert.equal(selfUpdateRecoveryDiagnosticSnapshot().state, 'QUARANTINED');

  const before = selfUpdateRecoveryDiagnosticSnapshot();
  const ignored = recordSelfUpdateRecoveryQuarantineReopenResult({
    schema: 'metaengine.self-update.transaction.v1',
    state: 'SUCCESSOR_BOOTED',
    quarantined: false,
    qualified: false,
    automatic_retry_allowed: false,
    authority_effect: false,
    transaction_id: transaction.transaction_id,
    resolved_git_sha: transaction.resolved_git_sha,
    target_version: transaction.target_version,
    evidence: {}, // missing quarantine_reopened => must be ignored
  });
  assert.equal(ignored.state, before.state);
  assert.equal(ignored.state, 'QUARANTINED');
});

// ---------------------------------------------------------------------------
// D-Q1 — heartbeat heal (core end-to-end)
// ---------------------------------------------------------------------------

test('heartbeat with healed auth evidence reopens the quarantined transaction', async () => {
  const { app, version } = await successorBootedAppFixture();
  const transaction = await readSelfUpdateTransaction(app);
  seedPendingQualificationDiagnostic(app, { transaction });
  await quarantineThroughHeartbeat({ app, version });
  assert.equal(selfUpdateRecoveryDiagnosticSnapshot().state, 'QUARANTINED');
  assert.equal((await readSelfUpdateTransaction(app)).state, 'QUARANTINED');

  // The maintenance lane refreshes the continuity projection after the user
  // logs back in; the next heartbeat carries the healed evidence.
  const healed = await recordAcceptedSignedSupervisorHeartbeat({
    app,
    state: heartbeatState(version, {
      state: 'RESTORED',
      auth_readback_state: 'AUTHENTICATED',
      user_session_continuity: 'CONTINUED',
      tab_cardinality_continuity: 'CONTINUOUS',
      authority_effect: false,
    }),
  });
  assert.equal(healed.state, 'QUARANTINE_HEALED_REOPENED');
  assert.equal(healed.authority_effect, false);

  const journal = await readSelfUpdateTransaction(app);
  assert.equal(journal.state, 'SUCCESSOR_BOOTED');
  assert.equal(journal.evidence.quarantine_reopened, true);
  assert.equal(journal.evidence.auth_readback_state, 'AUTHENTICATED');

  const diagnostic = selfUpdateRecoveryDiagnosticSnapshot();
  assert.equal(diagnostic.state, 'TARGET_INSTALLED_PENDING_QUALIFICATION');
  assert.equal(diagnostic.qualification_resume_allowed, true);

  // Cleanup any re-probe loop the heal path may have started.
  globalThis.__METAENGINE_SELF_UPDATE_QUALIFICATION_REPROBE__?.cancel?.();
  delete globalThis.__METAENGINE_SELF_UPDATE_QUALIFICATION_REPROBE__;
});

test('heartbeat without healed evidence leaves the quarantine latched', async () => {
  const { app, version } = await successorBootedAppFixture();
  const transaction = await readSelfUpdateTransaction(app);
  seedPendingQualificationDiagnostic(app, { transaction });
  await quarantineThroughHeartbeat({ app, version });

  const stillAuthRequired = await recordAcceptedSignedSupervisorHeartbeat({
    app,
    state: heartbeatState(version, {
      state: 'AUTH_REQUIRED',
      auth_readback_state: 'AUTH_REQUIRED',
      user_session_continuity: 'LOST',
      authority_effect: false,
    }),
  });
  assert.equal(stillAuthRequired.state, 'NOT_PENDING');
  assert.equal((await readSelfUpdateTransaction(app)).state, 'QUARANTINED');

  const lostSession = await recordAcceptedSignedSupervisorHeartbeat({
    app,
    state: heartbeatState(version, {
      state: 'RESTORED',
      auth_readback_state: 'AUTHENTICATED',
      user_session_continuity: 'LOST', // contradicts heal
      authority_effect: false,
    }),
  });
  assert.equal(lostSession.state, 'NOT_PENDING');
  assert.equal((await readSelfUpdateTransaction(app)).state, 'QUARANTINED');
});

test('only session_continuity_auth_required quarantine reasons are healable', async () => {
  const { app, version } = await successorBootedAppFixture();
  const transaction = await readSelfUpdateTransaction(app);
  seedPendingQualificationDiagnostic(app, { transaction });
  // Quarantine for a NON-auth reason through the production path.
  const result = await recordAcceptedSignedSupervisorHeartbeat({
    app,
    state: heartbeatState(version, {
      state: 'RESTORED',
      user_session_continuity: 'LOST',
      authority_effect: false,
    }),
  });
  assert.equal(result.state, 'QUARANTINED');
  assert.equal(result.reason, 'session_continuity_user_session_lost');
  assert.equal((await readSelfUpdateTransaction(app)).state, 'QUARANTINED');

  const healAttempt = await recordAcceptedSignedSupervisorHeartbeat({
    app,
    state: heartbeatState(version, {
      state: 'RESTORED',
      auth_readback_state: 'AUTHENTICATED',
      user_session_continuity: 'CONTINUED',
      authority_effect: false,
    }),
  });
  assert.equal(healAttempt.state, 'NOT_PENDING');
  assert.equal((await readSelfUpdateTransaction(app)).state, 'QUARANTINED');
});

test('after heal the next heartbeat qualifies the transaction normally', async () => {
  const { app, version } = await successorBootedAppFixture();
  const transaction = await readSelfUpdateTransaction(app);
  seedPendingQualificationDiagnostic(app, { transaction });
  await quarantineThroughHeartbeat({ app, version });
  assert.equal(selfUpdateRecoveryDiagnosticSnapshot().state, 'QUARANTINED');

  await recordAcceptedSignedSupervisorHeartbeat({
    app,
    state: heartbeatState(version, {
      state: 'RESTORED',
      auth_readback_state: 'AUTHENTICATED',
      user_session_continuity: 'CONTINUED',
      tab_cardinality_continuity: 'CONTINUOUS',
      authority_effect: false,
    }),
  });
  globalThis.__METAENGINE_SELF_UPDATE_QUALIFICATION_REPROBE__?.cancel?.();
  delete globalThis.__METAENGINE_SELF_UPDATE_QUALIFICATION_REPROBE__;

  // The updater legitimately reports unresolved_prior:SUCCESSOR_BOOTED while
  // this transaction is the pending one — the healed pipeline tolerates it.
  const healthy = await recordAcceptedSignedSupervisorHeartbeat({
    app,
    state: heartbeatState(version, {
      state: 'RESTORED',
      auth_readback_state: 'AUTHENTICATED',
      user_session_continuity: 'CONTINUED',
      tab_cardinality_continuity: 'CONTINUOUS',
      authority_effect: false,
    }, {
      state: 'ERROR',
      last_error: 'self_update_transaction_unresolved_prior:SUCCESSOR_BOOTED',
    }),
  });
  assert.equal(healthy.state, 'HEARTBEAT_HEALTHY');

  const journal = await readSelfUpdateTransaction(app);
  assert.equal(journal.state, 'SUCCESSOR_BOOTED');
});

// ---------------------------------------------------------------------------
// D-Q1 — maintenance-lane continuity projection refresh
// ---------------------------------------------------------------------------

test('applyQuarantineAuthHealToContinuityStatus heals only on positive evidence', () => {
  const prior = {
    state: 'AUTH_REQUIRED',
    auth_readback_state: 'AUTH_REQUIRED',
    auth_redirect_tab_count: 7,
    user_session_continuity: 'LOST',
    tab_cardinality_continuity: 'CONTINUOUS',
    authority_effect: false,
  };

  const healed = applyQuarantineAuthHealToContinuityStatus(prior, {
    auth_state: 'AUTHENTICATED',
    chatgpt_tab_count: 7,
    auth_redirect_tab_count: 0,
    authenticated_tab_count: 7,
  }, '2026-09-18T01:00:00.000Z');
  assert.equal(healed.state, 'RESTORED');
  assert.equal(healed.auth_readback_state, 'AUTHENTICATED');
  assert.equal(healed.user_session_continuity, 'CONTINUED');
  assert.equal(healed.auth_redirect_tab_count, 0);
  assert.equal(healed.auth_heal_chatgpt_tab_count, 7);
  assert.equal(healed.auth_heal_authenticated_tab_count, 7);
  assert.equal(healed.auth_heal_observed_at, '2026-09-18T01:00:00.000Z');
  assert.equal(healed.tab_cardinality_continuity, 'CONTINUOUS');
  assert.equal(healed.authority_effect, false);

  // No heal without positive evidence.
  assert.equal(applyQuarantineAuthHealToContinuityStatus(prior, { auth_state: 'AUTH_REQUIRED' }), prior);
  assert.equal(applyQuarantineAuthHealToContinuityStatus(prior, null), prior);
  assert.equal(applyQuarantineAuthHealToContinuityStatus(prior, { auth_state: 'UNKNOWN' }), prior);

  // Non-auth-required priors are untouched.
  const settled = { state: 'RESTORED', user_session_continuity: 'CONTINUED', authority_effect: false };
  assert.equal(applyQuarantineAuthHealToContinuityStatus(settled, { auth_state: 'AUTHENTICATED' }), settled);
});

// ---------------------------------------------------------------------------
// D-L4 v2 — execution-context recovery (toggle semantics)
// ---------------------------------------------------------------------------

class ToggleFakeDebugger extends EventEmitter {
  constructor({ frameId = 'frame-main-1', contextUniqueId = 'ctx-unique-1', deliverOnEnable = true } = {}) {
    super();
    this.attached = false;
    this.calls = [];
    this.runtimeEnabled = false;
    this.frameId = frameId;
    this.contextUniqueId = contextUniqueId;
    this.deliverOnEnable = deliverOnEnable;
  }
  isAttached() { return this.attached; }
  attach() { this.attached = true; }

  async sendCommand(method, params = {}, sessionId = undefined) {
    this.calls.push({ method, params, sessionId: sessionId || null });
    if (method === 'Page.getFrameTree') {
      return { frameTree: { frame: { id: this.frameId, loaderId: 'loader-1', url: 'https://chatgpt.com/' } } };
    }
    if (method === 'Runtime.disable') {
      // Chromium semantics: disabling stops context reporting.
      this.runtimeEnabled = false;
      return {};
    }
    if (method === 'Runtime.enable') {
      const wasEnabled = this.runtimeEnabled;
      this.runtimeEnabled = true;
      // Chromium semantics: enable() re-delivers executionContextCreated ONLY
      // when the domain was previously disabled. An idempotent second enable
      // (the pre-fix bug) delivers nothing — which is exactly what made refs
      // die forever after a navigation.
      if (!wasEnabled && this.deliverOnEnable) {
        this.emit('message', {}, 'Runtime.executionContextCreated', {
          context: {
            id: 1,
            uniqueId: this.contextUniqueId,
            auxData: { frameId: this.frameId, isDefault: true },
          },
        });
      }
      return {};
    }
    if (method === 'Accessibility.getFullAXTree') {
      return {
        nodes: [
          { nodeId: 'n1', backendDOMNodeId: 11, role: { type: 'role', value: 'button' }, name: { type: 'computedString', value: 'Далее' }, frameId: this.frameId, ignored: false },
          { nodeId: 'n2', backendDOMNodeId: 12, role: { type: 'role', value: 'textbox' }, name: { type: 'computedString', value: 'Email' }, frameId: this.frameId, ignored: false },
        ],
      };
    }
    if (method === 'Page.getLayoutMetrics') {
      return { cssVisualViewport: { clientWidth: 1280, clientHeight: 720, pageX: 0, pageY: 0, scale: 1 } };
    }
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    return {};
  }
}

class ToggleFakeWebContents extends EventEmitter {
  constructor(id, debuggerInstance) {
    super();
    this.id = id;
    this.debugger = debuggerInstance;
  }
  isDestroyed() { return false; }
  getOSProcessId() { return 2401; }
  getOrCreateDevToolsTargetId() { return `root-target-${this.id}`; }
  getURL() { return 'https://chatgpt.com/auth/login'; }
  getTitle() { return 'ChatGPT'; }
}

test('recoverExecutionContextBinding re-acquires the context via disable -> enable toggle', async () => {
  const dbg = new ToggleFakeDebugger();
  const wc = new ToggleFakeWebContents(1201, dbg);
  const pool = new PersistentBrowserCdpSessionPool();
  await pool.ensure(wc);
  await new Promise((resolve) => setImmediate(resolve));

  // Simulate a post-attach navigation: contexts cleared, never re-delivered.
  dbg.emit('message', {}, 'Page.frameNavigated', { frame: { id: dbg.frameId, parentId: null } });
  dbg.emit('message', {}, 'Runtime.executionContextsCleared', {});
  await new Promise((resolve) => setImmediate(resolve));
  let identity = pool.identity(wc);
  assert.equal(identity.main_execution_context_unique_id, null);

  const recovered = await pool.recoverExecutionContextBinding(wc);
  assert.ok(recovered, 'recovery returns a projection');
  assert.equal(recovered.main_execution_context_unique_id, 'ctx-unique-1');

  // The toggle order is enforced: disable precedes enable.
  const methods = dbg.calls.map((call) => call.method);
  const lastDisable = methods.lastIndexOf('Runtime.disable');
  const lastEnable = methods.lastIndexOf('Runtime.enable');
  assert.ok(lastDisable >= 0, 'Runtime.disable issued');
  assert.ok(lastEnable > lastDisable, 'Runtime.enable follows disable');

  identity = pool.identity(wc);
  assert.equal(identity.main_execution_context_unique_id, 'ctx-unique-1');
  assert.equal(identity.runtime_context_recovery_count, 1);

  await pool.release(wc);
});

test('recoverExecutionContextBinding is single-flight and rate-limited', async () => {
  // A debugger whose Runtime.enable never (re-)delivers a context: recovery
  // cannot heal and must decline a second immediate attempt without issuing
  // another toggle.
  const dbg = new ToggleFakeDebugger({ deliverOnEnable: false });
  const wc = new ToggleFakeWebContents(1202, dbg);
  const pool = new PersistentBrowserCdpSessionPool();
  await pool.ensure(wc);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pool.identity(wc).main_execution_context_unique_id, null);

  const enableCallsBefore = dbg.calls.filter((c) => c.method === 'Runtime.enable').length;
  const first = await pool.recoverExecutionContextBinding(wc);
  assert.equal(first, null, 'unhealed recovery returns null');
  const immediate = await pool.recoverExecutionContextBinding(wc);
  assert.equal(immediate, null, 'rate-limited second attempt declined');
  const enableCallsAfter = dbg.calls.filter((c) => c.method === 'Runtime.enable').length;
  assert.equal(enableCallsAfter, enableCallsBefore + 1, 'no extra toggle within the min interval');

  await pool.release(wc);
});

test('documentUpdated reseed now toggles Runtime.disable before Runtime.enable', async () => {
  const dbg = new ToggleFakeDebugger();
  const wc = new ToggleFakeWebContents(1203, dbg);
  const pool = new PersistentBrowserCdpSessionPool();
  await pool.ensure(wc);
  await new Promise((resolve) => setImmediate(resolve));

  dbg.emit('message', {}, 'DOM.documentUpdated', {});
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 50));

  const methods = dbg.calls.map((call) => call.method);
  const disableIdx = methods.lastIndexOf('Runtime.disable');
  const enableIdx = methods.lastIndexOf('Runtime.enable');
  assert.ok(disableIdx >= 0, 'reseed issues Runtime.disable');
  assert.ok(enableIdx > disableIdx, 'reseed re-enables after disable');
  assert.equal(methods.some((m) => /Page\.(reload|navigate)/i.test(m)), false, 'no navigation-class recovery');

  // The reseed re-acquires the context for the new document.
  const identity = pool.identity(wc);
  assert.equal(identity.main_execution_context_unique_id, 'ctx-unique-1');

  await pool.release(wc);
});

test('captureSemanticFrame self-heals semantic refs after context death', async () => {
  const dbg = new ToggleFakeDebugger();
  const wc = new ToggleFakeWebContents(1204, dbg);
  const pool = new PersistentBrowserCdpSessionPool();
  // Warm the pool via capture (also asserts baseline refs are issued).
  const before = await captureSemanticFrame(wc);
  assert.equal(before.semantic_refs_issued, 2);
  assert.equal(before.semantic_ref_context_complete, true);
  pool.release(wc);

  // Re-attach through a fresh pool instance to simulate a post-navigation
  // state where the context is gone: first enable re-delivers, then the
  // navigation clears it. CAPTURE must heal it via the toggle.
  const dbg2 = new ToggleFakeDebugger({ contextUniqueId: 'ctx-unique-2' });
  const wc2 = new ToggleFakeWebContents(1205, dbg2);
  const pool2 = new PersistentBrowserCdpSessionPool();
  await pool2.ensure(wc2);
  await new Promise((resolve) => setImmediate(resolve));
  dbg2.emit('message', {}, 'Runtime.executionContextsCleared', {});
  await new Promise((resolve) => setImmediate(resolve));

  const healed = await captureSemanticFrame(wc2);
  assert.equal(healed.semantic_refs_issued, 2, 'refs issued after in-capture recovery');
  assert.equal(healed.semantic_ref_context_complete, true);
  assert.ok(healed.semantic_targets.every((row) => row.semantic_ref));
  assert.equal(healed.runtime_execution_context_unique_id, 'ctx-unique-2');

  await pool2.release(wc2);
});
