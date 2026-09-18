import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiEpisodeEvaluationEvidenceBundle,
  verifyRsiEpisodeEvaluationEvidenceBundle,
  rsiEpisodeEvaluationIngestTrustRootSnapshot,
} from '../src/rsi-episode-evaluation-ingest.mjs';
import {
  createRsiEvaluatorMeshPlan,
  createRsiEvaluatorReceipt,
  applyRsiEvaluatorMesh,
} from '../src/rsi-evaluator-mesh.mjs';
import { RsiShadowArchive, RSI_HARD_INVARIANTS } from '../src/rsi-shadow-core.mjs';
import {
  createRsiShadowTournamentPlan,
  createRsiTournamentPairReceipt,
  evaluateRsiShadowTournament,
} from '../src/rsi-shadow-tournament.mjs';
import {
  createRsiMasteryAnchor,
  createRsiMasteryLedger,
  createRsiRetentionReplayPlan,
  createRsiRetentionReplayReceipt,
  finalizeRsiRetentionGate,
} from '../src/rsi-regression-replay.mjs';
import {
  createRsiEvaluationIntegrityPolicy,
  createRsiEvaluationIntegrityReceipt,
  assessRsiEvaluationIntegrity,
} from '../src/rsi-evaluation-integrity-guard.mjs';
import { RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA } from '../src/rsi-isolated-candidate-builder.mjs';

const PARENT = 'a'.repeat(40);
const CANDIDATE = 'b'.repeat(40);
const CID = \`candidate_sha256_\${'d'.repeat(64)}\`;
const HANDOFF_DIGEST = \`sha256:\${'c'.repeat(64)}\`;
const d = (c) => \`sha256:\${c.repeat(64)}\`;

function handoff() {
  return {
    schema: RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA,
    version: 1,
    experiment_id: 'rsi_exp_0123456789abcdef01234567',
    mutation_surface: 'BROWSER_RUNTIME',
    parent_sha: PARENT,
    candidate_sha: CANDIDATE,
    target_branch: 'work/rsi/eval-test-aaaaaaaa-01234567',
    handoff_digest: HANDOFF_DIGEST,
    candidate_capsule: {
      candidate_id: CID,
      source: { head: CANDIDATE },
      components: [{
        path: 'apps/metaengine-browser/src/browser-brain-routing-v2.mjs',
        change: 'MODIFY',
        digest: d('1'),
      }],
    },
    candidate_verification: { ok: true, executable: false, promotion_authorized: false },
    sandbox_plan: { mode: 'PREPARE_ONLY' },
    sandbox_plan_verification: { execution_authorized: false },
    shadow_archive_proposal: {
      candidate_id: CID,
      parent_sha: PARENT,
      candidate_sha: CANDIDATE,
      mutation_surface: 'BROWSER_RUNTIME',
      hypothesis: 'Reduce latency without authority changes.',
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

function evaluator() {
  const h = handoff();
  const plan = createRsiEvaluatorMeshPlan({ candidate_handoff: h });
  const receipts = [
    ...plan.evaluator_root.invariants.map((entry, index) => createRsiEvaluatorReceipt({
      plan,
      evaluator_id: entry.evaluator_id,
      result: 'PASS',
      evidence_refs: [\`github:run:hard:\${index}\`],
    })),
    createRsiEvaluatorReceipt({
      plan,
      evaluator_id: 'rsi.objective.latency.v1',
      objective: { baseline: 120, candidate: 80 },
      evidence_refs: ['github:run:objective:latency'],
    }),
  ];
  const archive = new RsiShadowArchive({ clock: () => Date.parse('2026-09-18T16:00:00Z') });
  archive.propose(h.shadow_archive_proposal);
  const result = applyRsiEvaluatorMesh({ archive, candidate_handoff: h, plan, receipts });
  return { h, plan, receipts, result };
}

function tournament(h, evaluatorResult) {
  const plan = createRsiShadowTournamentPlan({
    candidate_handoff: h,
    evaluator_result: evaluatorResult,
    workload: {
      task_class: 'browser-rsi-evaluation',
      environment_fingerprint: 'windows-x64-electron44-rsi-v1',
      suite_digest: d('2'),
      holdout_digest: d('3'),
    },
    pair_count: 5,
  });
  const baseMetrics = {
    task_success_rate: 0.95,
    p95_latency_ms: 120,
    peak_rss_bytes: 1000,
    recovery_p95_ms: 100,
  };
  const candidateMetrics = {
    task_success_rate: 0.96,
    p95_latency_ms: 85,
    peak_rss_bytes: 1000,
    recovery_p95_ms: 100,
  };
  const hard = Object.fromEntries(RSI_HARD_INVARIANTS.map((name) => [name, 'PASS']));
  const receipts = Array.from({ length: plan.pair_policy.pair_count }, (_, index) => createRsiTournamentPairReceipt({
    plan,
    pair_index: index + 1,
    order: plan.pair_policy.precommitted_order_schedule[index],
    seed: plan.pair_policy.precommitted_seed_schedule[index],
    incumbent_metrics: baseMetrics,
    candidate_metrics: candidateMetrics,
    hard_invariants: hard,
    evidence_refs: [\`artifact:tournament:\${index + 1}\`],
  }));
  const result = evaluateRsiShadowTournament({ plan, receipts });
  return { plan, receipts, result };
}

function retention() {
  const anchor = createRsiMasteryAnchor({
    anchor_id: 'mastery.browser.rsi',
    capability_family: 'BROWSER_RSI',
    challenge_digest: d('4'),
    benchmark_admission_digest: d('5'),
    baseline_candidate_id: \`candidate_sha256_\${'9'.repeat(64)}\`,
    baseline_candidate_sha: '9'.repeat(40),
    mastered_generation: 1,
    mastered_at: '2026-09-18T00:00:00Z',
    baseline_success_rate: 0.95,
    minimum_retained_success_rate: 0.80,
    historical_regression_count: 0,
    safety_critical: true,
    external_mastery_verifier: true,
    authored_by_candidate: false,
    contamination_resistant_evidence: true,
    hidden_holdout: true,
    evidence_refs: ['mastery:browser:rsi'],
  });
  const ledger = createRsiMasteryLedger({
    ledger_id: 'rsi.mastery.episode.eval',
    anchors: [anchor],
  });
  const plan = createRsiRetentionReplayPlan({
    ledger,
    current_candidate_id: CID,
    current_candidate_sha: CANDIDATE,
    current_generation: 2,
    max_replay_tasks: 1,
  });
  const receipts = plan.tasks.map((task) => createRsiRetentionReplayReceipt({
    plan,
    ledger,
    anchor_id: task.anchor_id,
    replay_attempts: 20,
    replay_successes: 19,
    hard_invariants_pass: true,
    evaluator_root_digest: d('6'),
    environment_fingerprint: 'windows-x64-electron44-rsi-v1',
    external_replay_evaluator: true,
    authored_by_candidate: false,
    evidence_refs: ['retention:episode:eval'],
  }));
  const gate = finalizeRsiRetentionGate({ plan, ledger, receipts });
  return { plan, ledger, receipts, gate };
}

function integrity(overrides = {}) {
  const policy = createRsiEvaluationIntegrityPolicy({
    policy_id: 'integrity.episode.eval',
    visible_suite_digest: d('7'),
    compositional_holdout_digest: d('8'),
    evaluator_root_digest: d('9'),
    workspace_baseline_digest: d('a'),
    max_visible_holdout_gap: 0.15,
    min_holdout_pass_rate: 0.8,
    external_policy_owner: true,
    authored_by_candidate: false,
  });
  const receipt = createRsiEvaluationIntegrityReceipt({
    policy,
    receipt_id: 'integrity.episode.eval.receipt',
    candidate_id: CID,
    candidate_sha: CANDIDATE,
    visible_pass_rate: 0.95,
    holdout_pass_rate: 0.92,
    evaluator_root_digest: policy.evaluator_root_digest,
    workspace_before_digest: policy.workspace_baseline_digest,
    workspace_after_digest: d('b'),
    patch_audit_digest: d('c'),
    file_access_audit_digest: d('d'),
    network_audit_digest: d('e'),
    evaluator_files_modified: false,
    hidden_tests_read: false,
    reference_solution_retrieved: false,
    expected_outputs_retrieved: false,
    contamination_canary_retrieved: false,
    evaluation_metric_tampered: false,
    validation_bypass_detected: false,
    external_integrity_monitor: true,
    authored_by_candidate: false,
    evidence_refs: ['integrity:episode:eval'],
    ...overrides,
  });
  const assessment = assessRsiEvaluationIntegrity({ policy, receipt });
  return { policy, receipt, assessment };
}

function episode() {
  return {
    schema: 'metaengine.rsi.episode-snapshot.v1',
    version: 1,
    episode_id: 'episode:evaluation:1',
    source_sha: PARENT,
    trust_root_set_digest: 'f'.repeat(64),
    hypothesis_digest: '1'.repeat(64),
    mutation_surface: 'BROWSER_RUNTIME',
    max_candidates: 4,
    candidates: {
      [CID]: {
        candidate_id: CID,
        candidate_sha: CANDIDATE,
        parent_sha: PARENT,
        build_plan_digest: '2'.repeat(64),
        mutation_surface: 'BROWSER_RUNTIME',
        evidence: {},
        authority_effect: false,
        automatic_retry_allowed: false,
      },
    },
    authority_effect: false,
    automatic_retry_allowed: false,
  };
}

function passingBundleArgs(integrityOverrides = {}) {
  const evalSet = evaluator();
  const tourn = tournament(evalSet.h, evalSet.result);
  const retain = retention();
  const integ = integrity(integrityOverrides);
  return {
    episode: episode(),
    candidate_id: CID,
    candidate_handoff: evalSet.h,
    evaluator_plan: evalSet.plan,
    evaluator_receipts: evalSet.receipts,
    evaluator_result: evalSet.result,
    tournament_plan: tourn.plan,
    tournament_receipts: tourn.receipts,
    tournament_result: tourn.result,
    retention_plan: retain.plan,
    retention_ledger: retain.ledger,
    retention_receipts: retain.receipts,
    retention_gate: retain.gate,
    integrity_policy: integ.policy,
    integrity_receipt: integ.receipt,
    integrity_assessment: integ.assessment,
  };
}

test('independent evaluation bundle requires all six evidence classes and keeps promotion external', () => {
  const bundle = createRsiEpisodeEvaluationEvidenceBundle(passingBundleArgs());
  verifyRsiEpisodeEvaluationEvidenceBundle(bundle);
  assert.deepEqual(bundle.evidence.map((row) => row.evidence_kind), [
    'HARD_INVARIANTS',
    'OBJECTIVES',
    'HOLDOUT',
    'REGRESSION_REPLAY',
    'EVALUATION_INTEGRITY',
    'TOURNAMENT',
  ]);
  assert.deepEqual([...new Set(bundle.evidence.map((row) => row.result))], ['PASS']);
  assert.equal(bundle.complete_evidence_set, true);
  assert.equal(bundle.external_promotion_gate_still_required, true);
  assert.equal(bundle.direct_promotion_enabled, false);
  assert.equal(bundle.execution_authority, false);
  assert.equal(bundle.self_update_authority, false);
});

test('reward-hacking evidence is terminal FAIL and cannot be averaged away by strong scores', () => {
  const bundle = createRsiEpisodeEvaluationEvidenceBundle(passingBundleArgs({
    evaluator_files_modified: true,
    visible_pass_rate: 1,
    holdout_pass_rate: 1,
  }));
  const integrityEvidence = bundle.evidence.find((row) => row.evidence_kind === 'EVALUATION_INTEGRITY');
  assert.equal(integrityEvidence.result, 'FAIL');
  assert.equal(integrityEvidence.authored_by_candidate, false);
  assert.equal(bundle.scalar_reward_authoritative, false);
});

test('weak integrity evidence is AMBIGUOUS, never silently converted into PASS', () => {
  const bundle = createRsiEpisodeEvaluationEvidenceBundle(passingBundleArgs({
    visible_pass_rate: 0.7,
    holdout_pass_rate: 0.7,
  }));
  const integrityEvidence = bundle.evidence.find((row) => row.evidence_kind === 'EVALUATION_INTEGRITY');
  assert.equal(integrityEvidence.result, 'AMBIGUOUS');
  assert.equal(integrityEvidence.ambiguous_effect, true);
  assert.equal(integrityEvidence.physical_effect_replay_allowed, false);
  assert.equal(integrityEvidence.automatic_retry_allowed, false);
});

test('bundle digest is tamper-evident', () => {
  const bundle = createRsiEpisodeEvaluationEvidenceBundle(passingBundleArgs());
  const copy = structuredClone(bundle);
  copy.evidence[0].result = 'FAIL';
  assert.throws(() => verifyRsiEpisodeEvaluationEvidenceBundle(copy), /bundle_digest_mismatch/);
});

test('evaluation ingest trust root makes validity instrumentation candidate-immutable', () => {
  const root = rsiEpisodeEvaluationIngestTrustRootSnapshot();
  assert.equal(root.external_evaluator_required, true);
  assert.equal(root.candidate_authored_evidence_allowed, false);
  assert.equal(root.reward_hacking_blocks_nomination, true);
  assert.equal(root.visible_suite_alone_sufficient, false);
  assert.equal(root.scalar_reward_authoritative, false);
  assert.equal(root.direct_promotion_enabled, false);
  assert.equal(root.physical_effect_replay_allowed, false);
  assert.ok(root.immutable_component_paths.includes('apps/metaengine-browser/src/rsi-evaluation-integrity-guard.mjs'));
});
