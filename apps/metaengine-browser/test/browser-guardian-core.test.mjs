import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateBrowserGuardianPlan } from '../src/browser-guardian-core.mjs';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const NOW = 1_000_000;

function desired(overrides = {}) {
  return {
    state: 'RUNNING',
    external_stop_requested: false,
    release: {
      release_id: 'release-8', artifact_sha256: SHA_A, version_epoch: 8,
      min_protocol_generation: 3, required_capabilities: ['guardian_health_v1', 'sentinel_v1'],
      metadata_expires_at_ms: NOW + 100_000,
    },
    restart_policy: {
      window_ms: 60_000, max_restarts_in_window: 3, startup_grace_ms: 10_000,
      liveness_timeout_ms: 5_000, progress_timeout_ms: 20_000,
    },
    ...overrides,
  };
}

function child(overrides = {}) {
  return {
    pid: 1234, process_incarnation_id: 'inc-8-a', release_id: 'release-8',
    artifact_sha256: SHA_A, started_at_ms: NOW - 2_000, ...overrides,
  };
}

function heartbeat(overrides = {}) {
  return {
    pid: 1234, process_incarnation_id: 'inc-8-a', release_id: 'release-8', artifact_sha256: SHA_A,
    observed_at_ms: NOW - 500, progress_at_ms: NOW - 1_000, ready: true, protocol_generation: 3,
    capabilities: ['guardian_health_v1', 'sentinel_v1'], arbitrary_eval: false,
    page_model_text_authority: false, automatic_retry_allowed: false, second_scheduler_loop: false,
    ...overrides,
  };
}

function healthyObserved(overrides = {}) {
  return {
    active_release_id: 'release-8', active_release_version_epoch: 8,
    child: child(), heartbeat: heartbeat(), restart_history_ms: [],
    effect_journal: { state: 'CLEAR' }, ...overrides,
  };
}

function assertZeroAuthority(plan) {
  assert.equal(plan.actuation_eligible, false);
  assert.equal(plan.automatic_retry_allowed, false);
  assert.equal(plan.browser_authority, false);
  assert.equal(plan.task_authority, false);
  assert.equal(plan.scheduler_authority, false);
  assert.equal(plan.page_model_text_authority, false);
  assert.equal(plan.release_authority, false);
  assert.equal(plan.authority_effect, false);
}

test('external stop is terminal for guardian restart planning', () => {
  const plan = evaluateBrowserGuardianPlan({ desired: desired({ external_stop_requested: true }), observed: {}, now_ms: NOW });
  assert.equal(plan.action, 'NOOP');
  assert.equal(plan.reason, 'EXTERNAL_STOP_RECORDED');
  assertZeroAuthority(plan);
});

test('positively proven absence plans one external child start candidate', () => {
  const plan = evaluateBrowserGuardianPlan({ desired: desired(), observed: { process_absence_proven: true, restart_history_ms: [], effect_journal: { state: 'CLEAR' } }, now_ms: NOW });
  assert.equal(plan.action, 'START_CHILD');
  assert.equal(plan.reason, 'EXACT_CHILD_ABSENCE_PROVEN');
  assert.equal(plan.process_effect_candidate, true);
  assert.equal(plan.requires_external_executor, true);
  assertZeroAuthority(plan);
});

test('unproven absence never permits a start', () => {
  const plan = evaluateBrowserGuardianPlan({ desired: desired(), observed: { process_absence_proven: false, effect_journal: { state: 'CLEAR' } }, now_ms: NOW });
  assert.equal(plan.action, 'NOOP');
  assert.equal(plan.reason, 'CHILD_ABSENCE_UNPROVEN');
  assert.equal(plan.process_effect_candidate, false);
});

test('ambiguous prior process effect suppresses all automatic replay', () => {
  const plan = evaluateBrowserGuardianPlan({ desired: desired(), observed: { process_absence_proven: true, effect_journal: { state: 'AMBIGUOUS', effect_id: 'spawn-42' } }, now_ms: NOW });
  assert.equal(plan.action, 'NOOP');
  assert.equal(plan.reason, 'PROCESS_EFFECT_AMBIGUOUS');
  assert.equal(plan.unresolved_effect_id, 'spawn-42');
  assertZeroAuthority(plan);
});

test('restart storm escalates to SCM instead of spinning locally', () => {
  const plan = evaluateBrowserGuardianPlan({
    desired: desired(),
    observed: { process_absence_proven: true, restart_history_ms: [NOW - 100, NOW - 200, NOW - 300], effect_journal: { state: 'CLEAR' } },
    now_ms: NOW,
  });
  assert.equal(plan.action, 'ESCALATE_TO_SCM');
  assert.equal(plan.restart_count_in_window, 3);
  assert.equal(plan.process_effect_candidate, false);
});

test('startup grace holds an exact child while heartbeat is not yet present', () => {
  const plan = evaluateBrowserGuardianPlan({ desired: desired(), observed: { ...healthyObserved(), heartbeat: null, active_release_id: 'release-7', active_release_version_epoch: 7 }, now_ms: NOW });
  assert.equal(plan.action, 'HOLD_STARTUP');
  assert.equal(plan.reason, 'STARTUP_HEARTBEAT_PENDING');
});

test('heartbeat from another process incarnation cannot qualify the child', () => {
  const plan = evaluateBrowserGuardianPlan({ desired: desired(), observed: { ...healthyObserved(), heartbeat: heartbeat({ process_incarnation_id: 'inc-other' }) }, now_ms: NOW });
  assert.equal(plan.action, 'HOLD_STARTUP');
  assert.equal(plan.reason, 'HEARTBEAT_BINDING_MISMATCH');
});

test('startup proof timeout plans restart of only the exact observed child', () => {
  const plan = evaluateBrowserGuardianPlan({
    desired: desired(),
    observed: { ...healthyObserved(), child: child({ started_at_ms: NOW - 30_000 }), heartbeat: null, restart_history_ms: [] },
    now_ms: NOW,
  });
  assert.equal(plan.action, 'RESTART_EXACT_CHILD');
  assert.equal(plan.reason, 'STARTUP_PROOF_TIMEOUT');
  assert.equal(plan.exact_process_incarnation_id, 'inc-8-a');
  assert.equal(plan.exact_pid, 1234);
});

test('stale liveness plans exact-child restart without task authority', () => {
  const plan = evaluateBrowserGuardianPlan({ desired: desired(), observed: { ...healthyObserved(), heartbeat: heartbeat({ observed_at_ms: NOW - 10_000 }) }, now_ms: NOW });
  assert.equal(plan.action, 'RESTART_EXACT_CHILD');
  assert.equal(plan.reason, 'LIVENESS_TIMEOUT');
  assertZeroAuthority(plan);
});

test('missing runtime capability holds candidate unready', () => {
  const plan = evaluateBrowserGuardianPlan({ desired: desired(), observed: { ...healthyObserved(), heartbeat: heartbeat({ capabilities: ['guardian_health_v1'] }) }, now_ms: NOW });
  assert.equal(plan.action, 'HOLD_UNREADY');
  assert.equal(plan.reason, 'RUNTIME_CAPABILITY_SKEW');
  assert.deepEqual(plan.compatibility.missing_capabilities, ['sentinel_v1']);
});

test('unsafe runtime capability contract cannot qualify readiness', () => {
  const plan = evaluateBrowserGuardianPlan({ desired: desired(), observed: { ...healthyObserved(), heartbeat: heartbeat({ page_model_text_authority: true }) }, now_ms: NOW });
  assert.equal(plan.action, 'HOLD_UNREADY');
  assert.equal(plan.compatibility.safety_contract_valid, false);
});

test('exact compatible candidate may be proposed for activation only after readiness proof', () => {
  const plan = evaluateBrowserGuardianPlan({ desired: desired(), observed: { ...healthyObserved(), active_release_id: 'release-7', active_release_version_epoch: 7 }, now_ms: NOW });
  assert.equal(plan.action, 'ACTIVATE_CANDIDATE');
  assert.equal(plan.reason, 'EXACT_READY_CANDIDATE_PROVEN');
  assert.equal(plan.target_release.release_id, 'release-8');
  assertZeroAuthority(plan);
});

test('healthy exact active release requires no effect', () => {
  const plan = evaluateBrowserGuardianPlan({ desired: desired(), observed: healthyObserved(), now_ms: NOW });
  assert.equal(plan.action, 'NOOP');
  assert.equal(plan.reason, 'EXACT_READY_RELEASE_HEALTHY');
  assert.equal(plan.process_effect_candidate, false);
});

test('monotonic release epoch rejects unapproved rollback', () => {
  const plan = evaluateBrowserGuardianPlan({ desired: desired({ release: { ...desired().release, version_epoch: 7, release_id: 'release-7', artifact_sha256: SHA_B } }), observed: healthyObserved({ active_release_version_epoch: 8 }), now_ms: NOW });
  assert.equal(plan.action, 'HOLD_UNREADY');
  assert.equal(plan.reason, 'ROLLBACK_NOT_AUTHORIZED');
});

test('candidate rollback requires an explicit proven rollback eligibility bit', () => {
  const previous = { release_id: 'release-7', artifact_sha256: SHA_B, version_epoch: 7, min_protocol_generation: 3, required_capabilities: ['guardian_health_v1'] };
  const denied = evaluateBrowserGuardianPlan({ desired: desired(), observed: healthyObserved({ release_activation: { state: 'CANDIDATE_FAILED', rollback_eligible: false, previous_release: previous } }), now_ms: NOW });
  assert.notEqual(denied.action, 'ROLLBACK_CANDIDATE');

  const allowed = evaluateBrowserGuardianPlan({ desired: desired(), observed: healthyObserved({ release_activation: { state: 'CANDIDATE_FAILED', rollback_eligible: true, previous_release: previous } }), now_ms: NOW });
  assert.equal(allowed.action, 'ROLLBACK_CANDIDATE');
  assert.equal(allowed.target_release.release_id, 'release-7');
  assertZeroAuthority(allowed);
});

test('expired release metadata freezes activation and restart planning', () => {
  const plan = evaluateBrowserGuardianPlan({ desired: desired({ release: { ...desired().release, metadata_expires_at_ms: NOW - 1 } }), observed: { process_absence_proven: true }, now_ms: NOW });
  assert.equal(plan.action, 'HOLD_UNREADY');
  assert.equal(plan.reason, 'RELEASE_METADATA_EXPIRED');
});
