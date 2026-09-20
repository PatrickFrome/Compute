import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyRsiEvaluatorMesh,
  createRsiEvaluatorMeshPlan,
  createRsiEvaluatorReceipt,
  rsiEvaluatorRootSnapshot,
  verifyRsiEvaluatorMeshPlan,
  verifyRsiEvaluatorReceipt,
} from '../src/rsi-evaluator-mesh.mjs';
import { RsiShadowArchive, RSI_SHADOW_STATES } from '../src/rsi-shadow-core.mjs';
import { RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA } from '../src/rsi-isolated-candidate-builder.mjs';

const PARENT = 'a'.repeat(40);
const CANDIDATE = 'b'.repeat(40);
const HANDOFF_DIGEST = `sha256:${'c'.repeat(64)}`;
const CANDIDATE_ID = `candidate_sha256_${'d'.repeat(64)}`;

function handoff(overrides = {}) {
  return {
    schema: RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA,
    version: 1,
    experiment_id: 'rsi_exp_0123456789abcdef01234567',
    mutation_surface: 'AGENT_ORCHESTRATION',
    parent_sha: PARENT,
    candidate_sha: CANDIDATE,
    target_branch: 'work/rsi/reliability-aaaaaaaa-01234567',
    handoff_digest: HANDOFF_DIGEST,
    candidate_capsule: {
      candidate_id: CANDIDATE_ID,
      source: { head: CANDIDATE },
    },
    candidate_verification: {
      ok: true,
      executable: false,
      promotion_authorized: false,
    },
    sandbox_plan: { mode: 'PREPARE_ONLY' },
    sandbox_plan_verification: { execution_authorized: false },
    shadow_archive_proposal: {
      candidate_id: CANDIDATE_ID,
      parent_sha: PARENT,
      candidate_sha: CANDIDATE,
      mutation_surface: 'AGENT_ORCHESTRATION',
      hypothesis: 'Improve orchestration without changing authority.',
    },
    eligible_for_evaluation: true,
    eligible_for_promotion: false,
    materialization_replay_authorized: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
    ...overrides,
  };
}

function archiveFor(candidateHandoff = handoff()) {
  const archive = new RsiShadowArchive({ clock: () => Date.parse('2026-09-17T04:00:00.000Z') });
  archive.propose(candidateHandoff.shadow_archive_proposal);
  return archive;
}

function fullPassingReceipts(plan, objective = { baseline: 120, candidate: 90 }) {
  const invariantReceipts = plan.evaluator_root.invariants.map((entry, index) => createRsiEvaluatorReceipt({
    plan,
    evaluator_id: entry.evaluator_id,
    result: 'PASS',
    evidence_refs: [`github:run:${1000 + index}`],
  }));
  const objectiveReceipt = createRsiEvaluatorReceipt({
    plan,
    evaluator_id: 'rsi.objective.latency.v1',
    objective,
    evidence_refs: ['github:run:2000'],
  });
  return [...invariantReceipts, objectiveReceipt];
}

test('mesh plan is deterministic and candidate cannot select evaluator root', () => {
  const candidateHandoff = handoff();
  const first = createRsiEvaluatorMeshPlan({ candidate_handoff: candidateHandoff });
  const second = createRsiEvaluatorMeshPlan({ candidate_handoff: candidateHandoff });
  assert.deepEqual(first, second);
  assert.equal(first.evaluator_root.candidate_selectable, false);
  assert.equal(first.evaluator_root.candidate_mutable, false);
  assert.equal(first.evaluator_root.invariants.length, 6);
  assert.deepEqual([...first.required_invariants].sort(), [
    'EXACT_SOURCE_IDENTITY',
    'NO_AMBIGUOUS_EFFECT_RETRY',
    'NO_AUTHORITY_VIOLATION',
    'NO_DUPLICATE_IRREVERSIBLE_EFFECT',
    'NO_SECURITY_REGRESSION',
    'NO_WORKSPACE_ESCAPE',
  ].sort());
  assert.equal(first.execution_authority, false);
  assert.equal(first.promotion_authority, false);
  assert.equal(verifyRsiEvaluatorMeshPlan(first).ok, true);
});

test('plan tampering cannot drop a hard evaluator or substitute its runner', () => {
  const plan = createRsiEvaluatorMeshPlan({ candidate_handoff: handoff() });
  const missing = structuredClone(plan);
  missing.evaluator_root.invariants.pop();
  assert.throws(() => verifyRsiEvaluatorMeshPlan(missing), /plan_digest_mismatch|root_tampered/);

  const runnerSwap = structuredClone(plan);
  runnerSwap.evaluator_root.invariants[0].runner = 'candidate/controlled-runner';
  assert.throws(() => verifyRsiEvaluatorMeshPlan(runnerSwap), /plan_digest_mismatch|root_tampered/);
});

test('receipt is exact-bound to candidate, handoff and immutable evaluator digest', () => {
  const plan = createRsiEvaluatorMeshPlan({ candidate_handoff: handoff() });
  const receipt = createRsiEvaluatorReceipt({
    plan,
    evaluator_id: 'rsi.source-identity.v1',
    result: 'PASS',
    evidence_refs: ['github:run:3000'],
  });
  assert.equal(verifyRsiEvaluatorReceipt({ plan, receipt }).result, 'PASS');

  for (const mutate of [
    (copy) => { copy.candidate_sha = 'e'.repeat(40); },
    (copy) => { copy.handoff_digest = `sha256:${'f'.repeat(64)}`; },
    (copy) => { copy.evaluator_digest = `sha256:${'1'.repeat(64)}`; },
    (copy) => { copy.runner = 'candidate/runner'; },
    (copy) => { copy.authored_by_candidate = true; },
  ]) {
    const copy = structuredClone(receipt);
    mutate(copy);
    assert.throws(() => verifyRsiEvaluatorReceipt({ plan, receipt: copy }), /receipt_/);
  }
});

test('mesh refuses incomplete or duplicate evaluator evidence before archive mutation', () => {
  const candidateHandoff = handoff();
  const plan = createRsiEvaluatorMeshPlan({ candidate_handoff: candidateHandoff });
  const complete = fullPassingReceipts(plan);

  const missing = complete.filter((entry) => entry.evaluator_id !== 'rsi.security-regression.v1');
  assert.throws(() => applyRsiEvaluatorMesh({ archive: archiveFor(candidateHandoff), candidate_handoff: candidateHandoff, plan, receipts: missing }), /required_receipt_missing|receipts_invalid/);

  const duplicate = [...complete, complete[0]];
  assert.throws(() => applyRsiEvaluatorMesh({ archive: archiveFor(candidateHandoff), candidate_handoff: candidateHandoff, plan, receipts: duplicate }), /duplicate_receipt/);
});

test('all hard PASS plus improved objective yields SHADOW_QUALIFIED only', () => {
  const candidateHandoff = handoff();
  const plan = createRsiEvaluatorMeshPlan({ candidate_handoff: candidateHandoff });
  const archive = archiveFor(candidateHandoff);
  const result = applyRsiEvaluatorMesh({
    archive,
    candidate_handoff: candidateHandoff,
    plan,
    receipts: fullPassingReceipts(plan, { baseline: 120, candidate: 90 }),
  });
  assert.equal(result.state, RSI_SHADOW_STATES.SHADOW_QUALIFIED);
  assert.equal(result.eligible_for_promotion, false);
  assert.equal(result.execution_authority, false);
  assert.equal(result.self_update_authority, false);
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(archive.get(CANDIDATE_ID).state, RSI_SHADOW_STATES.SHADOW_QUALIFIED);
});

test('hard FAIL overrides objective gain and candidate is REJECTED', () => {
  const candidateHandoff = handoff();
  const plan = createRsiEvaluatorMeshPlan({ candidate_handoff: candidateHandoff });
  const receipts = fullPassingReceipts(plan, { baseline: 120, candidate: 1 });
  const index = receipts.findIndex((entry) => entry.evaluator_id === 'rsi.authority-boundary.v1');
  receipts[index] = createRsiEvaluatorReceipt({
    plan,
    evaluator_id: 'rsi.authority-boundary.v1',
    result: 'FAIL',
    evidence_refs: ['github:run:4000'],
  });
  const result = applyRsiEvaluatorMesh({ archive: archiveFor(candidateHandoff), candidate_handoff: candidateHandoff, plan, receipts });
  assert.equal(result.state, RSI_SHADOW_STATES.REJECTED);
  assert.equal(result.hard_invariants.NO_AUTHORITY_VIOLATION, 'FAIL');
  assert.equal(result.eligible_for_promotion, false);
});

test('no objective improvement leaves candidate BLOCKED even when every invariant passes', () => {
  const candidateHandoff = handoff();
  const plan = createRsiEvaluatorMeshPlan({ candidate_handoff: candidateHandoff });
  const result = applyRsiEvaluatorMesh({
    archive: archiveFor(candidateHandoff),
    candidate_handoff: candidateHandoff,
    plan,
    receipts: fullPassingReceipts(plan, { baseline: 90, candidate: 120 }),
  });
  assert.equal(result.state, RSI_SHADOW_STATES.BLOCKED);
  assert.equal(result.eligible_for_promotion, false);
});

test('root snapshot is stable, digest-bound and zero candidate authority by construction', () => {
  const root = rsiEvaluatorRootSnapshot();
  assert.match(root.evaluator_root_digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(root.candidate_selectable, false);
  assert.equal(root.candidate_mutable, false);
  assert.equal(root.invariants.length, 6);
  assert.equal(root.objectives.length, 5);
});
