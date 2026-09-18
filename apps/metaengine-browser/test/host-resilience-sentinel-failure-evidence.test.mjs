import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { buildSentinelWorkerFailureEvidence } from '../src/host-resilience-runtime.mjs';

const observedAt = Date.parse('2026-09-08T20:00:00.000Z');
const sentinel = {
  worker_recovery_generation: 17,
  worker_recovery_candidate_pid: 44117,
  worker_recovery_result: 'exact_failure_evidence',
};

const failureStates = [
  'UNBOUND',
  'WORKER_PID_MISSING_AMBIGUOUS',
  'STALE_WORKER_PID_ALIVE',
  'BINDING_DRIFT',
  'RECOVERY_INTENT_NOT_EXACT',
  'SPAWN_FAILED_NO_EFFECT',
  'SPAWN_AMBIGUOUS',
  'CANDIDATE_UNBOUND_TRANSITION',
  'CANDIDATE_UNBOUND_BINDING_DRIFT',
  'CANDIDATE_BIND_NOT_EXACT',
  'CANDIDATE_ALIVE_HEARTBEAT_AMBIGUOUS',
  'CANDIDATE_CONFIRMED_ABSENT',
];

test('every non-transition Sentinel recovery failure produces structured evidence', () => {
  for (const state of failureStates) {
    const evidence = buildSentinelWorkerFailureEvidence({
      state,
      worker_pid: 44117,
      recovered: false,
      automatic_retry_allowed: ['SPAWN_FAILED_NO_EFFECT', 'CANDIDATE_CONFIRMED_ABSENT'].includes(state),
      authority_effect: false,
    }, { sentinel, clock: () => observedAt });
    assert.equal(evidence.schema, 'metaengine.host-resilience.sentinel-worker-failure.v1');
    assert.equal(evidence.state, 'RECOVERY_FAILED');
    assert.equal(evidence.recovery_state, state);
    assert.equal(evidence.recovery_generation, 17);
    assert.equal(evidence.worker_pid, 44117);
    assert.equal(evidence.worker_recovery_result, 'exact_failure_evidence');
    assert.equal(evidence.observed_at, '2026-09-08T20:00:00.000Z');
    assert.equal(evidence.authority_effect, false);
  }
});

test('healthy and expected-transition outcomes do not manufacture failure evidence', () => {
  for (const state of ['HEALTHY', 'RECOVERED', 'SUPPRESSED_TRANSITION']) {
    assert.equal(buildSentinelWorkerFailureEvidence({ state, authority_effect: false }, { sentinel }), null);
  }
});

test('recovery exception is explicit and never grants retry authority', () => {
  const evidence = buildSentinelWorkerFailureEvidence(null, {
    sentinel,
    error: new Error('sentinel_readback_failed'),
    clock: () => observedAt,
  });
  assert.equal(evidence.state, 'RECOVERY_EXCEPTION');
  assert.equal(evidence.recovery_state, null);
  assert.equal(evidence.error, 'sentinel_readback_failed');
  assert.equal(evidence.automatic_retry_allowed, false);
  assert.equal(evidence.authority_effect, false);
});

test('host runtime degrades every unsuppressed non-healthy recovery state through the common evidence path', async () => {
  const source = await fs.readFile(new URL('../src/host-resilience-runtime.mjs', import.meta.url), 'utf8');
  assert.match(source, /else if \(recovery\?\.state !== 'SUPPRESSED_TRANSITION'\)/);
  assert.match(source, /sentinel_worker_failure = buildSentinelWorkerFailureEvidence\(recovery, \{ sentinel \}\)/);
  assert.match(source, /sentinel_worker_failure = buildSentinelWorkerFailureEvidence\(null, \{ sentinel, error \}\)/);
  assert.doesNotMatch(source, /\['STALE_WORKER_PID_ALIVE','WORKER_PID_MISSING_AMBIGUOUS','SPAWN_AMBIGUOUS','CANDIDATE_ALIVE_HEARTBEAT_AMBIGUOUS'\]/);
});
