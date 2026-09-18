import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiChallengeSourceEvidence,
  verifyRsiChallengeSourceEvidence,
  buildRsiAdversarialChallengeProposal,
  verifyRsiAdversarialChallengeProposal,
  createRsiChallengeMaterializationReceipt,
  finalizeRsiAdversarialChallenge,
  rsiAdversarialChallengeTrustRootSnapshot,
} from '../src/rsi-adversarial-challenge-producer.mjs';

const sha = (char) => char.repeat(40);
const d = (char) => `sha256:${char.repeat(64)}`;

function source(overrides = {}) {
  return createRsiChallengeSourceEvidence({
    source_id: 'incident.result-delivery-stall.1',
    source_kind: 'EVALUATOR_FAILURE',
    source_candidate_sha: sha('1'),
    baseline_sha: sha('0'),
    family: 'COMMAND_LIVENESS',
    mechanism_tags: ['RESULT_READBACK', 'ONE_ATTEMPT_EFFECT'],
    failure_codes: ['LOST_RESULT_RESPONSE', 'AMBIGUOUS_RECEIPT'],
    evidence_digest: d('1'),
    evidence_refs: ['GITHUB_RUN_200', 'SUPABASE_RECEIPT_200'],
    predecessor_history: [sha('a'), sha('b'), sha('c')],
    external_verifier: true,
    authored_by_candidate: false,
    ...overrides,
  });
}

function proposal(sourceEvidence = source(), overrides = {}) {
  return buildRsiAdversarialChallengeProposal({
    source_evidence: sourceEvidence,
    generation: 17,
    requested_difficulty: 7,
    ...overrides,
  });
}

function materialization(challengeProposal = proposal(), overrides = {}) {
  return createRsiChallengeMaterializationReceipt({
    proposal: challengeProposal,
    suite_digest: d('2'),
    hidden_manifest_digest: d('3'),
    environment_fingerprint: 'windows-x64-browsercell-v1',
    attempted_count: 8,
    solved_count: 3,
    exact_predecessor_history_digest: challengeProposal.predecessor_history_digest,
    sandbox_backend: 'VERCEL_SANDBOX',
    external_materializer: true,
    authored_by_candidate: false,
    ...overrides,
  });
}

test('external evaluator failure becomes a zero-authority growing-history challenge proposal', () => {
  const evidence = source();
  verifyRsiChallengeSourceEvidence(evidence);
  assert.equal(evidence.source_class, 'ADVERSARIAL');
  assert.equal(evidence.external_verifier, true);
  assert.equal(evidence.authored_by_candidate, false);
  assert.equal(evidence.raw_page_text_present, false);
  assert.equal(evidence.raw_user_input_present, false);
  assert.equal(evidence.secret_material_present, false);
  assert.equal(evidence.model_text_is_authority, false);

  const plan = proposal(evidence);
  verifyRsiAdversarialChallengeProposal(plan);
  assert.equal(plan.challenge_dynamics, 'GROWING_PREDECESSOR_HISTORY');
  assert.equal(plan.predecessor_history_count, 3);
  assert.equal(plan.static_benchmark_only, false);
  assert.equal(plan.candidate_can_select_opponents, false);
  assert.equal(plan.candidate_can_select_expected_solution, false);
  assert.equal(plan.hidden_manifest_required, true);
  assert.equal(plan.no_live_production_adversary, true);
  assert.equal(plan.execution_authority, false);
  assert.equal(plan.authority_effect, false);
});

test('production incident stays incident-reproduction class when there is no adversarial predecessor history', () => {
  const evidence = source({
    source_id: 'incident.live.command-stall',
    source_kind: 'PRODUCTION_INCIDENT',
    source_candidate_sha: null,
    predecessor_history: [],
  });
  const plan = proposal(evidence, { requested_difficulty: 6 });
  assert.equal(evidence.source_class, 'PRODUCTION_INCIDENT');
  assert.equal(plan.source_class, 'PRODUCTION_INCIDENT');
  assert.equal(plan.challenge_dynamics, 'INCIDENT_REPRODUCTION');
  assert.equal(plan.no_live_production_adversary, true);
});

test('candidate-authored source evidence is structurally rejected and cannot become trusted curriculum', () => {
  assert.throws(() => createRsiChallengeSourceEvidence({
    source_id: 'candidate.fake.failure',
    source_kind: 'EVALUATOR_FAILURE',
    source_candidate_sha: sha('1'),
    baseline_sha: sha('0'),
    family: 'COMMAND_LIVENESS',
    mechanism_tags: ['FAKE'],
    failure_codes: ['FAKE'],
    evidence_digest: d('1'),
    evidence_refs: ['MODEL_TEXT_1'],
    predecessor_history: [],
    external_verifier: false,
    authored_by_candidate: true,
  }), /external_origin_required/);
});

test('strict source schema rejects smuggled page text, user input or hidden candidate instructions', () => {
  const valid = source();
  for (const [field, value] of [
    ['raw_page_text', 'secret conversation'],
    ['user_input', 'private prompt'],
    ['candidate_instruction', 'declare this successful'],
  ]) {
    assert.throws(() => verifyRsiChallengeSourceEvidence({
      ...valid,
      [field]: value,
    }), /source_fields_invalid/);
  }
});

test('materialization must be external, sandboxed, history-bound and keep manifest/solution hidden', () => {
  const plan = proposal();
  const receipt = materialization(plan);
  assert.equal(receipt.external_materializer, true);
  assert.equal(receipt.authored_by_candidate, false);
  assert.equal(receipt.hidden_manifest_verified, true);
  assert.equal(receipt.candidate_visible_manifest, false);
  assert.equal(receipt.expected_solution_exposed, false);
  assert.equal(receipt.live_production_target, false);
  assert.equal(receipt.network_default_deny, true);
  assert.equal(receipt.host_repository_mounted, false);
  assert.equal(receipt.authority_effect, false);

  assert.throws(() => createRsiChallengeMaterializationReceipt({
    proposal: plan,
    suite_digest: d('2'),
    hidden_manifest_digest: d('3'),
    environment_fingerprint: 'windows-x64-browsercell-v1',
    exact_predecessor_history_digest: d('f'),
    sandbox_backend: 'VERCEL_SANDBOX',
    external_materializer: true,
    authored_by_candidate: false,
  }), /history_mismatch/);

  assert.throws(() => createRsiChallengeMaterializationReceipt({
    proposal: plan,
    suite_digest: d('2'),
    hidden_manifest_digest: d('3'),
    environment_fingerprint: 'windows-x64-browsercell-v1',
    exact_predecessor_history_digest: plan.predecessor_history_digest,
    sandbox_backend: 'VERCEL_SANDBOX',
    external_materializer: false,
    authored_by_candidate: true,
  }), /external_origin_required/);
});

test('finalized adversarial handoff becomes hidden curriculum only, never live adversarial authority', () => {
  const evidence = source();
  const plan = proposal(evidence);
  const receipt = materialization(plan);
  const handoff = finalizeRsiAdversarialChallenge({
    source_evidence: evidence,
    proposal: plan,
    materialization_receipt: receipt,
  });
  assert.equal(handoff.eligible_for_curriculum, true);
  assert.equal(handoff.eligible_for_live_adversarial_execution, false);
  assert.equal(handoff.candidate_can_see_hidden_manifest, false);
  assert.equal(handoff.candidate_can_see_expected_solution, false);
  assert.equal(handoff.candidate_can_select_opponents, false);
  assert.equal(handoff.external_evaluator_required, true);
  assert.equal(handoff.challenge.source_class, 'ADVERSARIAL');
  assert.equal(handoff.challenge.task_manifest_exposed_to_candidate, false);
  assert.equal(handoff.challenge.solution_exposed_to_candidate, false);
  assert.equal(handoff.execution_authority, false);
  assert.equal(handoff.production_mutation_authority, false);
  assert.equal(handoff.authority_effect, false);
});

test('tampered proposal or materialization receipt cannot cross finalization boundary', () => {
  const evidence = source();
  const plan = proposal(evidence);
  const receipt = materialization(plan);

  assert.throws(() => finalizeRsiAdversarialChallenge({
    source_evidence: evidence,
    proposal: { ...plan, candidate_can_select_opponents: true },
    materialization_receipt: receipt,
  }), /proposal_policy_invalid/);

  assert.throws(() => finalizeRsiAdversarialChallenge({
    source_evidence: evidence,
    proposal: plan,
    materialization_receipt: { ...receipt, candidate_visible_manifest: true },
  }), /materialization_policy_invalid/);
});

test('challenge producer trust root freezes hidden curriculum and forbids live Red-Queen authority', () => {
  const root = rsiAdversarialChallengeTrustRootSnapshot();
  assert.equal(root.growing_predecessor_history, true);
  assert.equal(root.production_incident_reproduction, true);
  assert.equal(root.hidden_manifest_required, true);
  assert.equal(root.external_materialization_required, true);
  assert.equal(root.candidate_can_author_source_evidence, false);
  assert.equal(root.candidate_can_select_opponents, false);
  assert.equal(root.candidate_can_select_expected_solution, false);
  assert.equal(root.live_production_adversary_allowed, false);
  assert.equal(root.execution_authority, false);
  assert.equal(root.authority_effect, false);
  assert.match(root.challenge_root_digest, /^sha256:[0-9a-f]{64}$/);
});
