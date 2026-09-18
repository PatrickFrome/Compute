import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  RSI_RECURSIVE_RISK_BUDGET_SCHEMA,
  RSI_RISK_SPENDING_POLICIES,
  RsiRecursiveRiskLedger,
  createRsiExternalStatisticalCertificate,
  createRsiRecursiveRiskBudget,
  evaluateRsiRiskControlledPromotionReview,
  rsiRecursiveRiskTrustRootSnapshot,
  rsiRiskAllocationForConfirmation,
  verifyRsiExternalStatisticalCertificate,
  verifyRsiRecursiveRiskBudget,
  verifyRsiRiskConfirmation,
} from '../src/rsi-recursive-risk-budget.mjs';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}

const sha = (char) => char.repeat(40);
const d = (char) => `sha256:${char.repeat(64)}`;
const candidateId = (char) => `candidate_sha256_${char.repeat(64)}`;

function finiteBudget(overrides = {}) {
  return createRsiRecursiveRiskBudget({
    budget_id: 'rsi-risk-epoch-1',
    global_alpha: 0.1,
    spending_policy: RSI_RISK_SPENDING_POLICIES.CTHS_FINITE,
    max_confirmations: 8,
    evidence_family: 'RSI_RECURSIVE_MODIFICATIONS',
    ...overrides,
  });
}

function anytimeBudget(overrides = {}) {
  return createRsiRecursiveRiskBudget({
    budget_id: 'rsi-risk-anytime-1',
    global_alpha: 0.05,
    spending_policy: RSI_RISK_SPENDING_POLICIES.TELESCOPING_ANYTIME,
    evidence_family: 'RSI_RECURSIVE_MODIFICATIONS',
    ...overrides,
  });
}

function certificate({
  budget = finiteBudget(),
  index = 1,
  char = '1',
  superiority = true,
  alpha = null,
  holdout = d('6'),
  external = true,
  authored = false,
  method = 'HOEFFDING_EXTERNAL_V1',
} = {}) {
  return createRsiExternalStatisticalCertificate({
    certificate_id: `stat-cert-${char}-${index}`,
    budget,
    confirmation_index: index,
    candidate_id: candidateId(char),
    candidate_sha: sha(char),
    parent_sha: sha('0'),
    tournament_plan_digest: d('4'),
    holdout_digest: holdout,
    evaluator_root_digest: d('5'),
    method,
    alpha_used: alpha ?? rsiRiskAllocationForConfirmation(budget, index),
    superiority_certified: superiority,
    paired_evaluation: true,
    independent_holdout: true,
    stopping_rule_precommitted: true,
    optional_stopping_used: false,
    familywise_valid: true,
    screening_spent_alpha: false,
    confirmation_triggered: true,
    sample_count: 30,
    evidence_refs: [`GITHUB_RUN_${index}`, `HOLDOUT_RECEIPT_${index}`],
    external_verifier: external,
    authored_by_candidate: authored,
  });
}

function promotionGate(char = '1', overrides = {}) {
  const core = {
    schema: 'metaengine.rsi.promotion-admission-gate-result.v1',
    version: 1,
    state: 'READY_FOR_EXTERNAL_PROMOTION_REVIEW',
    blockers: [],
    candidate_id: candidateId(char),
    candidate_sha: sha(char),
    parent_sha: sha('0'),
    handoff_digest: d('1'),
    tournament_plan_digest: d('4'),
    tournament_result_digest: d('2'),
    archive_admission_digest: d('3'),
    qualification_digest: d('7'),
    artifact_digest: d('8'),
    provenance_digest: d('9'),
    ready_for_external_promotion_review: true,
    existing_self_update_handoff_authorized: false,
    direct_install_authorized: false,
    promotion_token: null,
    scalar_winner: null,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
    ...overrides,
  };
  return Object.freeze({ ...core, gate_digest: digest(core) });
}

function binding(char = '1', holdout = d('6')) {
  return {
    candidate_id: candidateId(char),
    candidate_sha: sha(char),
    parent_sha: sha('0'),
    tournament_plan_digest: d('4'),
    holdout_digest: holdout,
    evaluator_root_digest: d('5'),
  };
}

test('finite CTHS spends only across a precommitted confirmation horizon and sums to the global alpha', () => {
  const budget = finiteBudget({ max_confirmations: 32 });
  assert.equal(budget.schema, RSI_RECURSIVE_RISK_BUDGET_SCHEMA);
  assert.equal(budget.spend_trigger, 'CONFIRMATION_EVENT_ONLY');
  assert.equal(budget.proposal_round_spends_alpha, false);
  assert.equal(budget.screening_spends_alpha, false);
  assert.equal(budget.candidate_can_choose_confirmation_index, false);
  verifyRsiRecursiveRiskBudget(budget);

  let sum = 0;
  for (let k = 1; k <= 32; k += 1) sum += rsiRiskAllocationForConfirmation(budget, k);
  assert.ok(Math.abs(sum - budget.global_alpha) < 1e-12);
  assert.throws(() => rsiRiskAllocationForConfirmation(budget, 33), /horizon_exhausted/);
});

test('open-ended telescoping spending has a finite global risk bound without pretending a future horizon is known', () => {
  const budget = anytimeBudget({ global_alpha: 0.1 });
  let sum = 0;
  const count = 20_000;
  for (let k = 1; k <= count; k += 1) sum += rsiRiskAllocationForConfirmation(budget, k);
  const expected = budget.global_alpha * (1 - 1 / (count + 1));
  assert.ok(Math.abs(sum - expected) < 1e-12);
  assert.ok(sum < budget.global_alpha);
  assert.throws(() => createRsiRecursiveRiskBudget({
    budget_id: 'bad-anytime',
    global_alpha: 0.1,
    spending_policy: RSI_RISK_SPENDING_POLICIES.TELESCOPING_ANYTIME,
    max_confirmations: 100,
  }), /anytime_max_confirmations_forbidden/);
});

test('certificate is external statistical evidence and cannot spend more than its confirmation allocation', () => {
  const budget = finiteBudget();
  const allocated = rsiRiskAllocationForConfirmation(budget, 1);
  const row = certificate({ budget, alpha: allocated });
  assert.equal(row.external_verifier, true);
  assert.equal(row.authored_by_candidate, false);
  assert.equal(row.familywise_valid, true);
  assert.equal(row.optional_stopping_used, false);
  assert.equal(row.screening_spent_alpha, false);
  assert.equal(row.confirmation_triggered, true);
  assert.equal(row.certificate_is_promotion_authority, false);
  assert.equal(row.authority_effect, false);

  assert.throws(() => certificate({ budget, alpha: allocated + 0.001 }), /alpha_over_budget/);
  assert.throws(() => certificate({ budget, external: false, authored: true }), /external_origin_required/);
});

test('candidate cannot smuggle optional stopping, non-independent holdout or unsupported test method into the certificate', () => {
  const budget = finiteBudget();
  const common = {
    certificate_id: 'stat-cert-invalid',
    budget,
    confirmation_index: 1,
    candidate_id: candidateId('1'),
    candidate_sha: sha('1'),
    parent_sha: sha('0'),
    tournament_plan_digest: d('4'),
    holdout_digest: d('6'),
    evaluator_root_digest: d('5'),
    alpha_used: rsiRiskAllocationForConfirmation(budget, 1),
    superiority_certified: true,
    paired_evaluation: true,
    independent_holdout: true,
    stopping_rule_precommitted: true,
    optional_stopping_used: false,
    familywise_valid: true,
    screening_spent_alpha: false,
    confirmation_triggered: true,
    sample_count: 30,
    evidence_refs: ['RUN_1'],
    external_verifier: true,
    authored_by_candidate: false,
  };

  assert.throws(() => createRsiExternalStatisticalCertificate({
    ...common,
    method: 'CANDIDATE_ASSERTED_PVALUE',
  }), /method_invalid/);

  assert.throws(() => createRsiExternalStatisticalCertificate({
    ...common,
    method: 'E_VALUE_EXTERNAL_V1',
    optional_stopping_used: true,
  }), /statistical_policy_invalid/);

  assert.throws(() => createRsiExternalStatisticalCertificate({
    ...common,
    method: 'E_VALUE_EXTERNAL_V1',
    independent_holdout: false,
  }), /statistical_policy_invalid/);

  assert.throws(() => createRsiExternalStatisticalCertificate({
    ...common,
    method: 'E_VALUE_EXTERNAL_V1',
    screening_spent_alpha: true,
  }), /statistical_policy_invalid/);
});

test('certificate verification binds exact candidate, parent, tournament, holdout, evaluator root and confirmation index', () => {
  const budget = finiteBudget();
  const row = certificate({ budget, index: 1, char: '1' });
  const checked = verifyRsiExternalStatisticalCertificate(row, {
    budget,
    expected_confirmation_index: 1,
    ...binding('1'),
  });
  assert.equal(checked.certificate_digest, row.certificate_digest);

  assert.throws(() => verifyRsiExternalStatisticalCertificate(row, {
    budget,
    expected_confirmation_index: 2,
    ...binding('1'),
  }), /confirmation_index_mismatch/);

  assert.throws(() => verifyRsiExternalStatisticalCertificate(row, {
    budget,
    expected_confirmation_index: 1,
    ...binding('1', d('7')),
  }), /holdout_mismatch/);
});

test('ledger spends alpha only when an externally certified candidate reaches confirmation', () => {
  const budget = finiteBudget();
  const ledger = new RsiRecursiveRiskLedger({ budget });
  const before = ledger.snapshot();
  assert.equal(before.confirmation_count, 0);
  assert.equal(before.cumulative_alpha_spent, 0);
  assert.equal(before.screening_spends_alpha, false);
  assert.equal(before.proposal_round_spends_alpha, false);

  const firstCertificate = certificate({ budget, index: 1, char: '1', superiority: true });
  const accepted = ledger.confirm({ certificate: firstCertificate, ...binding('1') });
  assert.equal(accepted.state, 'STATISTICAL_GATE_PASS_FOR_EXTERNAL_REVIEW');
  assert.equal(accepted.external_promotion_review_required, true);
  assert.equal(accepted.direct_promotion_authorized, false);
  assert.equal(accepted.existing_self_update_handoff_authorized, false);
  assert.equal(accepted.statistical_gate_replaces_hard_invariants, false);
  assert.equal(accepted.promotion_authority, false);

  const secondCertificate = certificate({ budget, index: 2, char: '2', superiority: false });
  const rejected = ledger.confirm({ certificate: secondCertificate, ...binding('2') });
  assert.equal(rejected.state, 'STATISTICAL_GATE_REJECTED');
  assert.equal(rejected.external_promotion_review_required, false);

  const snapshot = ledger.snapshot();
  assert.equal(snapshot.confirmation_count, 2);
  assert.equal(
    snapshot.cumulative_alpha_spent,
    firstCertificate.alpha_used + secondCertificate.alpha_used,
  );
  assert.ok(snapshot.cumulative_alpha_spent <= budget.global_alpha);
  assert.equal(snapshot.append_only, true);
  assert.equal(snapshot.authority_effect, false);
});

test('ledger rejects duplicate candidate confirmation even when a fresh statistical certificate is supplied', () => {
  const budget = finiteBudget();
  const ledger = new RsiRecursiveRiskLedger({ budget });
  ledger.confirm({ certificate: certificate({ budget, index: 1, char: '1' }), ...binding('1') });

  const secondForSameCandidate = certificate({ budget, index: 2, char: '1' });
  assert.throws(() => ledger.confirm({
    certificate: secondForSameCandidate,
    ...binding('1'),
  }), /confirmation_duplicate/);
});

test('statistical PASS remains only an external-review gate and can never replace hard invariants or promotion authority', () => {
  const budget = anytimeBudget();
  const ledger = new RsiRecursiveRiskLedger({ budget });
  const row = ledger.confirm({
    certificate: certificate({ budget, index: 1, char: '2', method: 'E_VALUE_EXTERNAL_V1' }),
    ...binding('2'),
  });
  assert.equal(row.state, 'STATISTICAL_GATE_PASS_FOR_EXTERNAL_REVIEW');
  assert.equal(row.statistical_gate_replaces_hard_invariants, false);
  assert.equal(row.direct_promotion_authorized, false);
  assert.equal(row.execution_authority, false);
  assert.equal(row.production_mutation_authority, false);
  assert.equal(row.promotion_authority, false);
  assert.equal(row.self_update_authority, false);
  assert.equal(row.automatic_retry_allowed, false);
  assert.equal(row.authority_effect, false);
});

test('risk trust root freezes budget/certificate control outside the candidate mutation domain', () => {
  const root = rsiRecursiveRiskTrustRootSnapshot();
  assert.equal(root.spending_is_confirmation_triggered, true);
  assert.equal(root.screening_spends_alpha, false);
  assert.equal(root.proposal_round_spends_alpha, false);
  assert.equal(root.external_statistical_certificate_required, true);
  assert.equal(root.candidate_can_author_certificate, false);
  assert.equal(root.candidate_can_choose_confirmation_index, false);
  assert.equal(root.candidate_can_choose_alpha, false);
  assert.equal(root.statistical_gate_replaces_hard_invariants, false);
  assert.equal(root.statistical_gate_is_promotion_authority, false);
  assert.equal(root.authority_effect, false);
  assert.match(root.risk_root_digest, /^sha256:[0-9a-f]{64}$/);
});


test('risk-controlled promotion review requires both ordinary promotion readiness and statistical confirmation for the same exact candidate', () => {
  const budget = finiteBudget();
  const ledger = new RsiRecursiveRiskLedger({ budget });
  const confirmation = ledger.confirm({
    certificate: certificate({ budget, index: 1, char: '1', superiority: true }),
    ...binding('1'),
  });
  verifyRsiRiskConfirmation(confirmation);

  const review = evaluateRsiRiskControlledPromotionReview({
    promotion_gate_result: promotionGate('1'),
    risk_confirmation: confirmation,
  });
  assert.equal(review.state, 'READY_FOR_RISK_CONTROLLED_EXTERNAL_PROMOTION_REVIEW');
  assert.equal(review.hard_invariants_already_required_by_promotion_gate, true);
  assert.equal(review.statistical_confirmation_required, true);
  assert.equal(review.statistical_gate_is_promotion_authority, false);
  assert.equal(review.external_promotion_review_required, true);
  assert.equal(review.direct_promotion_authorized, false);
  assert.equal(review.existing_self_update_handoff_authorized, false);
  assert.equal(review.promotion_token, null);
  assert.equal(review.authority_effect, false);
  assert.match(review.review_digest, /^sha256:[0-9a-f]{64}$/);
});

test('risk-controlled promotion review fails closed on rejected statistics, candidate mismatch or tampered ordinary gate', () => {
  const budget = finiteBudget();
  const rejectedLedger = new RsiRecursiveRiskLedger({ budget });
  const rejected = rejectedLedger.confirm({
    certificate: certificate({ budget, index: 1, char: '2', superiority: false }),
    ...binding('2'),
  });
  assert.throws(() => evaluateRsiRiskControlledPromotionReview({
    promotion_gate_result: promotionGate('2'),
    risk_confirmation: rejected,
  }), /statistical_gate_not_pass/);

  const acceptedLedger = new RsiRecursiveRiskLedger({ budget });
  const accepted = acceptedLedger.confirm({
    certificate: certificate({ budget, index: 1, char: '1', superiority: true }),
    ...binding('1'),
  });
  assert.throws(() => evaluateRsiRiskControlledPromotionReview({
    promotion_gate_result: promotionGate('2'),
    risk_confirmation: accepted,
  }), /binding_mismatch/);

  const tampered = { ...promotionGate('1'), ready_for_external_promotion_review: false };
  assert.throws(() => evaluateRsiRiskControlledPromotionReview({
    promotion_gate_result: tampered,
    risk_confirmation: accepted,
  }), /digest_mismatch/);
});
