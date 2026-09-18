import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateBrowserGuardianHealthAdmission } from '../src/browser-guardian-health-admission.mjs';

const NOW = 1_000_000;
const SHA = 'a'.repeat(64);

function desired() {
  return {
    state: 'RUNNING',
    external_stop_requested: false,
    release: {
      release_id: 'release-8', artifact_sha256: SHA, version_epoch: 8,
      min_protocol_generation: 3, required_capabilities: ['guardian_health_v1'],
      metadata_expires_at_ms: NOW + 100_000,
    },
    restart_policy: {
      window_ms: 60_000, max_restarts_in_window: 3, startup_grace_ms: 10_000,
      liveness_timeout_ms: 5_000, progress_timeout_ms: 20_000,
    },
  };
}

function child() {
  return { pid: 1234, process_incarnation_id: 'inc-8-a', started_at_ms: NOW - 30_000 };
}

function signal(sequence, overrides = {}) {
  return {
    pid: 1234,
    process_incarnation_id: 'inc-8-a',
    release_id: 'release-8',
    artifact_sha256: SHA,
    sequence,
    observed_at_ms: NOW - 100,
    ...overrides,
  };
}

function readiness(sequence = 4, overrides = {}) {
  return signal(sequence, {
    ready: true,
    protocol_generation: 3,
    capabilities: ['guardian_health_v1'],
    arbitrary_eval: false,
    page_model_text_authority: false,
    automatic_retry_allowed: false,
    second_scheduler_loop: false,
    ...overrides,
  });
}

function observed(overrides = {}) {
  return {
    active_release_id: 'release-8',
    active_release_version_epoch: 8,
    child: child(),
    heartbeats: {
      startup: signal(1),
      liveness: signal(9),
      readiness: readiness(),
      progress: signal(7),
    },
    restart_history_ms: [],
    effect_journal: { state: 'CLEAR' },
    ...overrides,
  };
}

function assertZeroAuthority(plan) {
  assert.equal(plan.actuation_eligible, false);
  assert.equal(plan.automatic_retry_allowed, false);
  assert.equal(plan.browser_authority, false);
  assert.equal(plan.task_authority, false);
  assert.equal(plan.scheduler_authority, false);
  assert.equal(plan.release_authority, false);
  assert.equal(plan.authority_effect, false);
}

test('four exact split channels admit a healthy release', () => {
  const plan = evaluateBrowserGuardianHealthAdmission({
    desired: desired(),
    observed: observed(),
    sequence_fence: { startup: 1, liveness: 8, readiness: 4, progress: 6 },
    now_ms: NOW,
  });
  assert.equal(plan.action, 'NOOP');
  assert.equal(plan.reason, 'EXACT_READY_RELEASE_HEALTHY');
  assertZeroAuthority(plan);
});

test('fresh liveness cannot mask stale useful progress', () => {
  const value = observed();
  value.heartbeats.progress = signal(8, { observed_at_ms: NOW - 30_000 });
  const plan = evaluateBrowserGuardianHealthAdmission({ desired: desired(), observed: value, now_ms: NOW });
  assert.equal(plan.action, 'RESTART_EXACT_CHILD');
  assert.equal(plan.reason, 'USEFUL_PROGRESS_TIMEOUT');
  assert.equal(plan.exact_process_incarnation_id, 'inc-8-a');
  assertZeroAuthority(plan);
});

test('readiness cannot be inferred from fresh startup liveness or progress', () => {
  const value = observed();
  value.heartbeats.readiness = readiness(5, { ready: false });
  const plan = evaluateBrowserGuardianHealthAdmission({ desired: desired(), observed: value, now_ms: NOW });
  assert.equal(plan.action, 'HOLD_UNREADY');
  assert.equal(plan.reason, 'READINESS_NOT_PROVEN');
  assertZeroAuthority(plan);
});

test('sequence regression quarantines planning without a process effect', () => {
  const plan = evaluateBrowserGuardianHealthAdmission({
    desired: desired(),
    observed: observed(),
    sequence_fence: { progress: 8 },
    now_ms: NOW,
  });
  assert.equal(plan.action, 'NOOP');
  assert.equal(plan.reason, 'SPLIT_HEARTBEAT_FENCE_REJECTED');
  assert.equal(plan.heartbeat_fence.reason, 'HEARTBEAT_SEQUENCE_REGRESSION');
  assert.equal(plan.heartbeat_fence.channel, 'progress');
  assert.equal(plan.process_effect_candidate, false);
  assertZeroAuthority(plan);
});

test('cross-incarnation readiness is quarantined rather than converted into restart authority', () => {
  const value = observed();
  value.heartbeats.readiness = readiness(5, { process_incarnation_id: 'inc-other' });
  const plan = evaluateBrowserGuardianHealthAdmission({ desired: desired(), observed: value, now_ms: NOW });
  assert.equal(plan.action, 'NOOP');
  assert.equal(plan.reason, 'SPLIT_HEARTBEAT_FENCE_REJECTED');
  assert.equal(plan.heartbeat_fence.reason, 'HEARTBEAT_BINDING_MISMATCH');
  assert.equal(plan.heartbeat_fence.channel, 'readiness');
  assertZeroAuthority(plan);
});

test('child absence path remains exact and does not manufacture heartbeat authority', () => {
  const plan = evaluateBrowserGuardianHealthAdmission({
    desired: desired(),
    observed: { process_absence_proven: true, restart_history_ms: [], effect_journal: { state: 'CLEAR' } },
    now_ms: NOW,
  });
  assert.equal(plan.action, 'START_CHILD');
  assert.equal(plan.reason, 'EXACT_CHILD_ABSENCE_PROVEN');
  assert.equal(plan.requires_external_executor, true);
  assertZeroAuthority(plan);
});
