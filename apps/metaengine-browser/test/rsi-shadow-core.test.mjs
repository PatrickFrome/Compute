import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RSI_HARD_INVARIANTS,
  RsiShadowArchive,
} from '../src/rsi-shadow-core.mjs';

const PARENT = 'a0af13c0640fffb4b6d5da1645220e32786b5ec0';
const CANDIDATE = '1111111111111111111111111111111111111111';
const EVALUATOR_DIGEST = 'a'.repeat(64);

function archive() {
  return new RsiShadowArchive({ clock: () => 1_800_000_000_000 });
}

function propose(subject, overrides = {}) {
  return subject.propose({
    candidate_id: 'candidate:rsi-shadow-1',
    parent_sha: PARENT,
    candidate_sha: CANDIDATE,
    mutation_surface: 'AGENT_ORCHESTRATION',
    hypothesis: 'Reduce coordination latency without changing effect authority.',
    created_at: '2027-01-15T08:00:00.000Z',
    ...overrides,
  });
}

function passAllInvariants(subject, candidateId = 'candidate:rsi-shadow-1') {
  for (const invariant of RSI_HARD_INVARIANTS) {
    subject.recordInvariant(candidateId, {
      invariant,
      result: 'PASS',
      evaluator_id: `eval:${invariant.toLowerCase()}`,
      evaluator_digest: EVALUATOR_DIGEST,
      evidence_refs: [`test://${invariant.toLowerCase()}`],
      recorded_at: '2027-01-15T08:01:00.000Z',
    });
  }
}

test('shadow candidate never receives execution, self-update, promotion, or retry authority', () => {
  const subject = archive();
  const row = propose(subject);
  assert.equal(row.shadow_only, true);
  assert.equal(row.execution_authority, false);
  assert.equal(row.production_mutation_authority, false);
  assert.equal(row.promotion_authority, false);
  assert.equal(row.self_update_authority, false);
  assert.equal(row.automatic_retry_allowed, false);

  const snapshot = subject.snapshot();
  assert.equal(snapshot.shadow_only, true);
  assert.equal(snapshot.execution_authority, false);
  assert.equal(snapshot.production_mutation_authority, false);
  assert.equal(snapshot.promotion_authority, false);
  assert.equal(snapshot.self_update_authority, false);
  assert.equal(snapshot.automatic_retry_allowed, false);
});

test('candidate is blocked when any hard invariant remains unverified', () => {
  const subject = archive();
  propose(subject);
  subject.beginEvaluation('candidate:rsi-shadow-1', { started_at: '2027-01-15T08:00:30.000Z' });
  subject.recordObjective('candidate:rsi-shadow-1', {
    objective: { name: 'task_success', direction: 'MAXIMIZE', baseline: 0.80, candidate: 0.90 },
    evaluator_id: 'eval:task-success',
    evaluator_digest: EVALUATOR_DIGEST,
    evidence_refs: ['benchmark://task-success/run-1'],
    recorded_at: '2027-01-15T08:01:00.000Z',
  });
  const result = subject.finalize('candidate:rsi-shadow-1', { finalized_at: '2027-01-15T08:02:00.000Z' });
  assert.equal(result.state, 'BLOCKED');
  assert.ok(Object.values(result.hard_invariants).includes('UNVERIFIED'));
});

test('one failed hard invariant rejects candidate even when objective improves', () => {
  const subject = archive();
  propose(subject);
  subject.beginEvaluation('candidate:rsi-shadow-1', { started_at: '2027-01-15T08:00:30.000Z' });

  for (const invariant of RSI_HARD_INVARIANTS) {
    subject.recordInvariant('candidate:rsi-shadow-1', {
      invariant,
      result: invariant === 'NO_AMBIGUOUS_EFFECT_RETRY' ? 'FAIL' : 'PASS',
      evaluator_id: `eval:${invariant.toLowerCase()}`,
      evaluator_digest: EVALUATOR_DIGEST,
      evidence_refs: [`test://${invariant.toLowerCase()}`],
      recorded_at: '2027-01-15T08:01:00.000Z',
    });
  }

  subject.recordObjective('candidate:rsi-shadow-1', {
    objective: { name: 'latency_ms', direction: 'MINIMIZE', baseline: 500, candidate: 100 },
    evaluator_id: 'eval:latency',
    evaluator_digest: EVALUATOR_DIGEST,
    evidence_refs: ['benchmark://latency/run-1'],
    recorded_at: '2027-01-15T08:01:10.000Z',
  });

  const result = subject.finalize('candidate:rsi-shadow-1', { finalized_at: '2027-01-15T08:02:00.000Z' });
  assert.equal(result.state, 'REJECTED');
  assert.equal(result.hard_invariants.NO_AMBIGUOUS_EFFECT_RETRY, 'FAIL');
  assert.equal(result.promotion_authority, false);
});

test('candidate becomes SHADOW_QUALIFIED only after all hard invariants pass and an objective improves', () => {
  const subject = archive();
  propose(subject);
  subject.beginEvaluation('candidate:rsi-shadow-1', { started_at: '2027-01-15T08:00:30.000Z' });
  passAllInvariants(subject);
  subject.recordObjective('candidate:rsi-shadow-1', {
    objective: { name: 'coordination_latency_ms', direction: 'MINIMIZE', baseline: 240, candidate: 180 },
    evaluator_id: 'eval:coordination-latency',
    evaluator_digest: EVALUATOR_DIGEST,
    evidence_refs: ['benchmark://coordination/run-42'],
    recorded_at: '2027-01-15T08:01:30.000Z',
  });

  const result = subject.finalize('candidate:rsi-shadow-1', { finalized_at: '2027-01-15T08:02:00.000Z' });
  assert.equal(result.state, 'SHADOW_QUALIFIED');
  assert.equal(result.objectives[0].improved, true);
  assert.equal(result.shadow_only, true);
  assert.equal(result.self_update_authority, false);
  assert.match(result.final_digest, /^[0-9a-f]{64}$/);
});

test('immutable trust-root surfaces are not legal RSI mutation surfaces', () => {
  const subject = archive();
  assert.throws(() => propose(subject, { mutation_surface: 'EVALUATOR_ROOT' }), /rsi_immutable_trust_surface_forbidden/);
  assert.throws(() => propose(subject, { mutation_surface: 'SIGNING_KEYS' }), /rsi_immutable_trust_surface_forbidden/);
});

test('candidate lineage requires exact 40-hex source identities', () => {
  const subject = archive();
  assert.throws(() => propose(subject, { parent_sha: 'main' }), /rsi_parent_exact_sha_required/);
  assert.throws(() => propose(subject, { candidate_sha: 'deadbeef' }), /rsi_candidate_exact_sha_required/);
});

test('evidence is append-only by invariant identity and candidate ids cannot be reused', () => {
  const subject = archive();
  propose(subject);
  assert.throws(() => propose(subject), /rsi_candidate_already_exists/);
  subject.beginEvaluation('candidate:rsi-shadow-1', { started_at: '2027-01-15T08:00:30.000Z' });
  subject.recordInvariant('candidate:rsi-shadow-1', {
    invariant: 'EXACT_SOURCE_IDENTITY',
    result: 'PASS',
    evaluator_id: 'eval:source-identity',
    evaluator_digest: EVALUATOR_DIGEST,
    evidence_refs: ['git://candidate/exact-sha'],
    recorded_at: '2027-01-15T08:01:00.000Z',
  });
  assert.throws(() => subject.recordInvariant('candidate:rsi-shadow-1', {
    invariant: 'EXACT_SOURCE_IDENTITY',
    result: 'FAIL',
    evaluator_id: 'eval:source-identity-2',
    evaluator_digest: 'b'.repeat(64),
  }), /rsi_invariant_already_recorded/);
});
