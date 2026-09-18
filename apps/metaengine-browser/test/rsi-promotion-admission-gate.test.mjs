import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { RSI_HARD_INVARIANTS, RSI_SHADOW_STATES } from '../src/rsi-shadow-core.mjs';
import { RSI_EVALUATOR_MESH_RESULT_SCHEMA } from '../src/rsi-evaluator-mesh.mjs';
import { RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA } from '../src/rsi-isolated-candidate-builder.mjs';
import {
  createRsiShadowTournamentPlan,
  createRsiTournamentPairReceipt,
  evaluateRsiShadowTournament,
} from '../src/rsi-shadow-tournament.mjs';
import { RsiVerifiedEvolutionArchive } from '../src/rsi-verified-evolution-archive.mjs';
import {
  RSI_EXTERNAL_PROMOTION_QUALIFICATION_SCHEMA,
  RSI_PROMOTION_ADMISSION_GATE_RESULT_SCHEMA,
  evaluateRsiPromotionAdmission,
  rsiPromotionGateTrustRootSnapshot,
  verifyRsiExternalPromotionQualification,
} from '../src/rsi-promotion-admission-gate.mjs';

const PARENT = 'a'.repeat(40);
const CANDIDATE = 'b'.repeat(40);
const CANDIDATE_ID = `candidate_sha256_${'c'.repeat(64)}`;
const HANDOFF_DIGEST = `sha256:${'d'.repeat(64)}`;
const SUITE_DIGEST = `sha256:${'e'.repeat(64)}`;
const HOLDOUT_DIGEST = `sha256:${'f'.repeat(64)}`;
const ARTIFACT_DIGEST = `sha256:${'1'.repeat(64)}`;
const PROVENANCE_DIGEST = `sha256:${'2'.repeat(64)}`;
const ROLLBACK_ARTIFACT_DIGEST = `sha256:${'3'.repeat(64)}`;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}

function handoff(componentPath = 'apps/metaengine-browser/src/browser-brain-routing-v2.mjs') {
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
      components: [{ path: componentPath }],
    },
    shadow_archive_proposal: {
      candidate_id: CANDIDATE_ID,
      parent_sha: PARENT,
      candidate_sha: CANDIDATE,
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
  };
}

function evaluatorResult() {
  const core = {
    schema: RSI_EVALUATOR_MESH_RESULT_SCHEMA,
    version: 1,
    plan_id: 'rsi_eval_0123456789abcdef',
    candidate_id: CANDIDATE_ID,
    candidate_sha: CANDIDATE,
    state: RSI_SHADOW_STATES.SHADOW_QUALIFIED,
    final_digest: '4'.repeat(64),
    receipt_digests: Array.from({ length: RSI_HARD_INVARIANTS.length + 1 }, (_, index) => `sha256:${String(index + 5).repeat(64).slice(0, 64)}`),
    hard_invariants: Object.fromEntries(RSI_HARD_INVARIANTS.map((name) => [name, 'PASS'])),
    objectives: [{ name: 'p95_latency_ms', baseline: 100, candidate: 88 }],
    eligible_for_promotion: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return { ...core, result_digest: digest(core) };
}

function tournamentFixture(candidateHandoff = handoff()) {
  const plan = createRsiShadowTournamentPlan({
    candidate_handoff: candidateHandoff,
    evaluator_result: evaluatorResult(),
    workload: {
      task_class: 'browser-routing-shadow',
      environment_fingerprint: 'windows-2025-node24-browsercell-v1',
      suite_digest: SUITE_DIGEST,
      holdout_digest: HOLDOUT_DIGEST,
    },
    pair_count: 5,
  });
  const hard = Object.fromEntries(RSI_HARD_INVARIANTS.map((name) => [name, 'PASS']));
  const receipts = Array.from({ length: plan.pair_policy.pair_count }, (_, index) => createRsiTournamentPairReceipt({
    plan,
    pair_index: index + 1,
    order: plan.pair_policy.precommitted_order_schedule[index],
    seed: plan.pair_policy.precommitted_seed_schedule[index],
    incumbent_metrics: {
      task_success_rate: 0.90,
      p95_latency_ms: 100 + index,
      peak_rss_bytes: 1000 + index,
      recovery_p95_ms: 50 + index,
    },
    candidate_metrics: {
      task_success_rate: 0.93,
      p95_latency_ms: 88 + index,
      peak_rss_bytes: 880 + index,
      recovery_p95_ms: 44 + index,
    },
    hard_invariants: hard,
    evidence_refs: [`github:run:pair-${index + 1}`],
  }));
  const result = evaluateRsiShadowTournament({ plan, receipts });
  const archive = new RsiVerifiedEvolutionArchive();
  const admission = archive.admit({ plan, result, receipts });
  return { plan, receipts, result, admission };
}

function qualificationCore({ ciConclusion = 'SUCCESS', canaryResult = 'PASS', rollbackReady = true } = {}) {
  const workflows = rsiPromotionGateTrustRootSnapshot().required_workflows;
  return {
    schema: RSI_EXTERNAL_PROMOTION_QUALIFICATION_SCHEMA,
    version: 1,
    candidate_id: CANDIDATE_ID,
    candidate_sha: CANDIDATE,
    parent_sha: PARENT,
    artifact: {
      digest: ARTIFACT_DIGEST,
      signed: true,
      signature_verified: true,
    },
    provenance: {
      digest: PROVENANCE_DIGEST,
      predicate_type: 'https://slsa.dev/provenance/v1',
      builder_id: 'github-actions:metaengine-browser-release-v1',
      source_repository: 'PatrickFrome/Compute',
      source_sha: CANDIDATE,
      verified: true,
    },
    ci_checks: workflows.map((workflow, index) => ({
      workflow,
      run_id: 1000 + index,
      head_sha: CANDIDATE,
      conclusion: index === 0 ? ciConclusion : 'SUCCESS',
      evidence_ref: `github:actions/run/${1000 + index}`,
    })),
    canary: {
      mode: 'SHADOW_CANARY',
      candidate_sha: CANDIDATE,
      artifact_digest: ARTIFACT_DIGEST,
      result: canaryResult,
      duplicate_irreversible_effects: 0,
      ambiguous_effect_retries: 0,
      authority_violations: 0,
      workspace_escapes: 0,
      evidence_refs: ['github:artifact:shadow-canary'],
    },
    rollback: {
      predecessor_sha: PARENT,
      artifact_digest: ROLLBACK_ARTIFACT_DIGEST,
      ready: rollbackReady,
      ambiguous_effect_replay_allowed: false,
      evidence_refs: ['github:artifact:rollback-proof'],
    },
    evidence_refs: ['github:release-qualification:exact-head'],
    external_verifier: true,
    authored_by_candidate: false,
    direct_install_authorized: false,
    self_update_invocation_authorized: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

function qualification(options = {}) {
  const core = qualificationCore(options);
  return { ...core, qualification_digest: digest(core) };
}

test('promotion admission can become review-ready but never gains promotion or self-update authority', () => {
  const candidateHandoff = handoff();
  const { plan, result, admission } = tournamentFixture(candidateHandoff);
  const receipt = qualification();
  assert.equal(verifyRsiExternalPromotionQualification(receipt, {
    candidate_id: CANDIDATE_ID,
    candidate_sha: CANDIDATE,
    parent_sha: PARENT,
  }).qualification_digest, receipt.qualification_digest);

  const gate = evaluateRsiPromotionAdmission({
    candidate_handoff: candidateHandoff,
    tournament_plan: plan,
    tournament_result: result,
    archive_admission: admission,
    qualification: receipt,
  });

  assert.equal(gate.schema, RSI_PROMOTION_ADMISSION_GATE_RESULT_SCHEMA);
  assert.equal(gate.state, 'READY_FOR_EXTERNAL_PROMOTION_REVIEW');
  assert.equal(gate.ready_for_external_promotion_review, true);
  assert.deepEqual(gate.blockers, []);
  assert.equal(gate.existing_self_update_handoff_authorized, false);
  assert.equal(gate.direct_install_authorized, false);
  assert.equal(gate.promotion_token, null);
  assert.equal(gate.promotion_authority, false);
  assert.equal(gate.self_update_authority, false);
  assert.equal(gate.automatic_retry_allowed, false);
  assert.match(gate.gate_digest, /^sha256:[0-9a-f]{64}$/);
});

test('promotion gate independently rejects candidate mutation of promotion and self-update trust roots', () => {
  for (const path of [
    'apps/metaengine-browser/src/rsi-promotion-admission-gate.mjs',
    'apps/metaengine-browser/src/rsi-external-promotion-review.mjs',
    'apps/metaengine-browser/src/rsi-release-authority-handoff.mjs',
    'apps/metaengine-browser/src/rsi-release-executor-admission.mjs',
    'apps/metaengine-browser/src/rsi-release-effect-reconciliation.mjs',
    'apps/metaengine-browser/src/rsi-verified-evolution-archive.mjs',
    'apps/metaengine-browser/src/rsi-shadow-tournament.mjs',
    'apps/metaengine-browser/src/self-update-runtime.mjs',
  ]) {
    const candidateHandoff = handoff(path);
    const { plan, result, admission } = tournamentFixture(handoff());
    assert.throws(() => evaluateRsiPromotionAdmission({
      candidate_handoff: candidateHandoff,
      tournament_plan: plan,
      tournament_result: result,
      archive_admission: admission,
      qualification: qualification(),
    }), /candidate_mutates_promotion_root|tournament_candidate_mismatch/);
  }
});

test('valid but failed CI or canary evidence blocks review without creating authority', () => {
  const candidateHandoff = handoff();
  const { plan, result, admission } = tournamentFixture(candidateHandoff);
  for (const receipt of [
    qualification({ ciConclusion: 'FAILURE' }),
    qualification({ canaryResult: 'FAIL' }),
    qualification({ rollbackReady: false }),
  ]) {
    const gate = evaluateRsiPromotionAdmission({
      candidate_handoff: candidateHandoff,
      tournament_plan: plan,
      tournament_result: result,
      archive_admission: admission,
      qualification: receipt,
    });
    assert.equal(gate.state, 'BLOCKED');
    assert.equal(gate.ready_for_external_promotion_review, false);
    assert.ok(gate.blockers.length >= 1);
    assert.equal(gate.promotion_authority, false);
    assert.equal(gate.self_update_authority, false);
  }
});

test('qualification tampering is rejected rather than converted into a promotion blocker', () => {
  const receipt = qualification();
  const tampered = structuredClone(receipt);
  tampered.artifact.signature_verified = false;
  assert.throws(() => verifyRsiExternalPromotionQualification(tampered, {
    candidate_id: CANDIDATE_ID,
    candidate_sha: CANDIDATE,
    parent_sha: PARENT,
  }), /qualification_digest_mismatch/);
});

test('promotion root is fixed, supply-chain aware and candidate-non-authoritative', () => {
  const root = rsiPromotionGateTrustRootSnapshot();
  assert.equal(root.provenance_predicate_type, 'https://slsa.dev/provenance/v1');
  assert.equal(root.required_workflows.length, 7);
  assert.equal(root.candidate_can_promote, false);
  assert.equal(root.candidate_can_invoke_self_update, false);
  assert.equal(root.scalar_winner_authoritative, false);
  assert.ok(root.immutable_component_paths.includes('apps/metaengine-browser/src/rsi-promotion-admission-gate.mjs'));
  assert.match(root.promotion_gate_root_digest, /^sha256:[0-9a-f]{64}$/);
});
