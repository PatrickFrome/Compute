import crypto from 'node:crypto';

export const RSI_RECURSIVE_RISK_BUDGET_SCHEMA = 'metaengine.rsi.recursive-risk-budget.v1';
export const RSI_STATISTICAL_CERTIFICATE_SCHEMA = 'metaengine.rsi.statistical-certificate.v1';
export const RSI_RISK_CONFIRMATION_SCHEMA = 'metaengine.rsi.risk-confirmation.v1';
export const RSI_RISK_LEDGER_SNAPSHOT_SCHEMA = 'metaengine.rsi.risk-ledger-snapshot.v1';
export const RSI_RISK_CONTROLLED_PROMOTION_REVIEW_SCHEMA = 'metaengine.rsi.risk-controlled-promotion-review.v1';

export const RSI_RISK_SPENDING_POLICIES = Object.freeze({
  CTHS_FINITE: 'CTHS_FINITE_V1',
  TELESCOPING_ANYTIME: 'TELESCOPING_ANYTIME_V1',
});

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const CERTIFICATE_METHODS = new Set([
  'E_VALUE_EXTERNAL_V1',
  'HOEFFDING_EXTERNAL_V1',
  'PAIRED_CONFIDENCE_SEQUENCE_EXTERNAL_V1',
]);
const MAX_CONFIRMATIONS = 100_000;
const MAX_EVIDENCE_REFS = 32;
const EPSILON = 1e-12;

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}

function exactDigest(value, label) {
  const out = String(value || '').toLowerCase();
  if (!SHA256_RE.test(out)) throw new Error(`rsi_risk_${label}_digest_invalid`);
  return out;
}

function exactSha(value, label) {
  const out = String(value || '').toLowerCase();
  if (!SHA40_RE.test(out)) throw new Error(`rsi_risk_${label}_sha_invalid`);
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_risk_${label}_invalid`);
  return out;
}

function exactProbability(value, label, { allowOne = false } = {}) {
  const out = Number(value);
  if (!Number.isFinite(out) || out <= 0 || (allowOne ? out > 1 : out >= 1)) throw new Error(`rsi_risk_${label}_invalid`);
  return out;
}

function positiveInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > max) throw new Error(`rsi_risk_${label}_invalid`);
  return out;
}

function nonNegativeInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 0 || out > max) throw new Error(`rsi_risk_${label}_invalid`);
  return out;
}

function assertZeroAuthority(value, label) {
  for (const field of ['execution_authority', 'production_mutation_authority', 'promotion_authority', 'self_update_authority', 'authority_effect']) {
    if (value?.[field] !== false) throw new Error(`rsi_risk_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_risk_${label}_automatic_retry_invalid`);
}

function zeroAuthority(extra = {}) {
  return Object.freeze({
    ...extra,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function evidenceRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EVIDENCE_REFS) throw new Error('rsi_risk_evidence_refs_invalid');
  const seen = new Set();
  return value.map((raw) => {
    const ref = boundedId(raw, 'evidence_ref');
    if (seen.has(ref)) throw new Error('rsi_risk_evidence_ref_duplicate');
    seen.add(ref);
    return ref;
  }).sort();
}

function harmonicNumber(count) {
  let total = 0;
  for (let index = 1; index <= count; index += 1) total += 1 / index;
  return total;
}

/**
 * SGM's finite-horizon CTHS spends alpha only when a proposal escalates to
 * confirmation, not on every proposal/screening round:
 *   alpha_k = alpha_total / (k * H_T)
 * where T is a precommitted confirmation horizon and H_T is the T-th harmonic
 * number.
 *
 * For METAENGINE's genuinely open-ended mode, TELESCOPING_ANYTIME_V1 is a
 * deliberately more conservative extension:
 *   alpha_k = alpha_total / (k * (k + 1))
 * whose infinite sum is exactly alpha_total. This is not presented as SGM's
 * CTHS formula; it preserves the same confirmation-triggered risk-budget idea
 * without pretending an infinite future horizon is known.
 */
export function rsiRiskAllocationForConfirmation(budget, confirmationIndex) {
  const checked = verifyRsiRecursiveRiskBudget(budget);
  const k = positiveInt(confirmationIndex, 'confirmation_index', MAX_CONFIRMATIONS);
  if (checked.spending_policy === RSI_RISK_SPENDING_POLICIES.CTHS_FINITE) {
    if (k > checked.max_confirmations) throw new Error('rsi_risk_confirmation_horizon_exhausted');
    return checked.global_alpha / (k * checked.harmonic_normalizer);
  }
  return checked.global_alpha / (k * (k + 1));
}

export function createRsiRecursiveRiskBudget({
  budget_id,
  global_alpha = 0.05,
  spending_policy = RSI_RISK_SPENDING_POLICIES.TELESCOPING_ANYTIME,
  max_confirmations = null,
  evidence_family = 'RSI_RECURSIVE_MODIFICATIONS',
} = {}) {
  const policy = String(spending_policy || '').toUpperCase();
  if (!Object.values(RSI_RISK_SPENDING_POLICIES).includes(policy)) throw new Error('rsi_risk_spending_policy_invalid');
  const alpha = exactProbability(global_alpha, 'global_alpha');
  let maxConfirmations = null;
  let harmonicNormalizer = null;
  if (policy === RSI_RISK_SPENDING_POLICIES.CTHS_FINITE) {
    maxConfirmations = positiveInt(max_confirmations, 'max_confirmations', MAX_CONFIRMATIONS);
    harmonicNormalizer = harmonicNumber(maxConfirmations);
  } else if (max_confirmations != null) {
    throw new Error('rsi_risk_anytime_max_confirmations_forbidden');
  }
  const core = {
    schema: RSI_RECURSIVE_RISK_BUDGET_SCHEMA,
    version: 1,
    budget_id: boundedId(budget_id, 'budget_id'),
    evidence_family: boundedId(evidence_family, 'evidence_family'),
    global_alpha: alpha,
    spending_policy: policy,
    max_confirmations: maxConfirmations,
    harmonic_normalizer: harmonicNormalizer,
    spend_trigger: 'CONFIRMATION_EVENT_ONLY',
    proposal_round_spends_alpha: false,
    screening_spends_alpha: false,
    candidate_can_change_budget: false,
    candidate_can_choose_confirmation_index: false,
    candidate_can_choose_alpha: false,
    external_statistical_certificate_required: true,
    hard_invariants_remain_required: true,
    scalar_reward_authoritative: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, budget_digest: digest(core) });
}

export function verifyRsiRecursiveRiskBudget(budget) {
  if (!plainObject(budget) || budget.schema !== RSI_RECURSIVE_RISK_BUDGET_SCHEMA || budget.version !== 1) throw new Error('rsi_risk_budget_invalid');
  assertZeroAuthority(budget, 'budget');
  if (
    budget.spend_trigger !== 'CONFIRMATION_EVENT_ONLY'
    || budget.proposal_round_spends_alpha !== false
    || budget.screening_spends_alpha !== false
    || budget.candidate_can_change_budget !== false
    || budget.candidate_can_choose_confirmation_index !== false
    || budget.candidate_can_choose_alpha !== false
    || budget.external_statistical_certificate_required !== true
    || budget.hard_invariants_remain_required !== true
    || budget.scalar_reward_authoritative !== false
  ) throw new Error('rsi_risk_budget_policy_invalid');
  const canonical = createRsiRecursiveRiskBudget({
    budget_id: budget.budget_id,
    global_alpha: budget.global_alpha,
    spending_policy: budget.spending_policy,
    max_confirmations: budget.max_confirmations,
    evidence_family: budget.evidence_family,
  });
  if (canonical.budget_digest !== exactDigest(budget.budget_digest, 'budget')) throw new Error('rsi_risk_budget_digest_mismatch');
  return canonical;
}

export function createRsiExternalStatisticalCertificate({
  certificate_id,
  budget,
  confirmation_index,
  candidate_id,
  candidate_sha,
  parent_sha,
  tournament_plan_digest,
  holdout_digest,
  evaluator_root_digest,
  method,
  alpha_used,
  superiority_certified,
  paired_evaluation,
  independent_holdout,
  stopping_rule_precommitted,
  optional_stopping_used,
  familywise_valid,
  screening_spent_alpha,
  confirmation_triggered,
  sample_count,
  evidence_refs,
  external_verifier = false,
  authored_by_candidate = true,
} = {}) {
  const checkedBudget = verifyRsiRecursiveRiskBudget(budget);
  if (external_verifier !== true || authored_by_candidate !== false) throw new Error('rsi_risk_certificate_external_origin_required');
  const index = positiveInt(confirmation_index, 'certificate_confirmation_index', MAX_CONFIRMATIONS);
  const allocatedAlpha = rsiRiskAllocationForConfirmation(checkedBudget, index);
  const alphaUsed = exactProbability(alpha_used, 'certificate_alpha_used');
  if (alphaUsed - allocatedAlpha > EPSILON) throw new Error('rsi_risk_certificate_alpha_over_budget');
  const normalizedMethod = String(method || '').toUpperCase();
  if (!CERTIFICATE_METHODS.has(normalizedMethod)) throw new Error('rsi_risk_certificate_method_invalid');
  if (
    paired_evaluation !== true
    || independent_holdout !== true
    || stopping_rule_precommitted !== true
    || optional_stopping_used !== false
    || familywise_valid !== true
    || screening_spent_alpha !== false
    || confirmation_triggered !== true
  ) throw new Error('rsi_risk_certificate_statistical_policy_invalid');

  const candidateId = boundedId(candidate_id, 'certificate_candidate_id');
  const candidateSha = exactSha(candidate_sha, 'certificate_candidate');
  const parentSha = exactSha(parent_sha, 'certificate_parent');
  if (candidateSha === parentSha) throw new Error('rsi_risk_certificate_noop_candidate');

  const core = {
    schema: RSI_STATISTICAL_CERTIFICATE_SCHEMA,
    version: 1,
    certificate_id: boundedId(certificate_id, 'certificate_id'),
    budget_id: checkedBudget.budget_id,
    budget_digest: checkedBudget.budget_digest,
    confirmation_index: index,
    allocated_alpha: allocatedAlpha,
    alpha_used: alphaUsed,
    candidate_id: candidateId,
    candidate_sha: candidateSha,
    parent_sha: parentSha,
    tournament_plan_digest: exactDigest(tournament_plan_digest, 'certificate_tournament_plan'),
    holdout_digest: exactDigest(holdout_digest, 'certificate_holdout'),
    evaluator_root_digest: exactDigest(evaluator_root_digest, 'certificate_evaluator_root'),
    method: normalizedMethod,
    superiority_certified: superiority_certified === true,
    paired_evaluation: true,
    independent_holdout: true,
    stopping_rule_precommitted: true,
    optional_stopping_used: false,
    familywise_valid: true,
    screening_spent_alpha: false,
    confirmation_triggered: true,
    sample_count: positiveInt(sample_count, 'certificate_sample_count', 10_000_000),
    evidence_refs: evidenceRefs(evidence_refs),
    external_verifier: true,
    authored_by_candidate: false,
    statistical_result_recomputed_locally: false,
    candidate_can_author_certificate: false,
    certificate_is_promotion_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, certificate_digest: digest(core) });
}

export function verifyRsiExternalStatisticalCertificate(certificate, {
  budget,
  expected_confirmation_index,
  candidate_id,
  candidate_sha,
  parent_sha,
  tournament_plan_digest,
  holdout_digest,
  evaluator_root_digest,
} = {}) {
  if (!plainObject(certificate) || certificate.schema !== RSI_STATISTICAL_CERTIFICATE_SCHEMA || certificate.version !== 1) {
    throw new Error('rsi_risk_certificate_invalid');
  }
  assertZeroAuthority(certificate, 'certificate');
  const checkedBudget = verifyRsiRecursiveRiskBudget(budget);
  if (
    certificate.external_verifier !== true
    || certificate.authored_by_candidate !== false
    || certificate.statistical_result_recomputed_locally !== false
    || certificate.candidate_can_author_certificate !== false
    || certificate.certificate_is_promotion_authority !== false
  ) throw new Error('rsi_risk_certificate_origin_policy_invalid');

  const canonical = createRsiExternalStatisticalCertificate({
    certificate_id: certificate.certificate_id,
    budget: checkedBudget,
    confirmation_index: certificate.confirmation_index,
    candidate_id: certificate.candidate_id,
    candidate_sha: certificate.candidate_sha,
    parent_sha: certificate.parent_sha,
    tournament_plan_digest: certificate.tournament_plan_digest,
    holdout_digest: certificate.holdout_digest,
    evaluator_root_digest: certificate.evaluator_root_digest,
    method: certificate.method,
    alpha_used: certificate.alpha_used,
    superiority_certified: certificate.superiority_certified,
    paired_evaluation: certificate.paired_evaluation,
    independent_holdout: certificate.independent_holdout,
    stopping_rule_precommitted: certificate.stopping_rule_precommitted,
    optional_stopping_used: certificate.optional_stopping_used,
    familywise_valid: certificate.familywise_valid,
    screening_spent_alpha: certificate.screening_spent_alpha,
    confirmation_triggered: certificate.confirmation_triggered,
    sample_count: certificate.sample_count,
    evidence_refs: certificate.evidence_refs,
    external_verifier: true,
    authored_by_candidate: false,
  });
  if (canonical.certificate_digest !== exactDigest(certificate.certificate_digest, 'certificate')) throw new Error('rsi_risk_certificate_digest_mismatch');
  if (canonical.budget_digest !== checkedBudget.budget_digest) throw new Error('rsi_risk_certificate_budget_mismatch');
  if (canonical.confirmation_index !== positiveInt(expected_confirmation_index, 'expected_confirmation_index', MAX_CONFIRMATIONS)) {
    throw new Error('rsi_risk_certificate_confirmation_index_mismatch');
  }
  if (canonical.candidate_id !== boundedId(candidate_id, 'expected_candidate_id')) throw new Error('rsi_risk_certificate_candidate_id_mismatch');
  if (canonical.candidate_sha !== exactSha(candidate_sha, 'expected_candidate')) throw new Error('rsi_risk_certificate_candidate_sha_mismatch');
  if (canonical.parent_sha !== exactSha(parent_sha, 'expected_parent')) throw new Error('rsi_risk_certificate_parent_sha_mismatch');
  if (canonical.tournament_plan_digest !== exactDigest(tournament_plan_digest, 'expected_tournament_plan')) throw new Error('rsi_risk_certificate_tournament_mismatch');
  if (canonical.holdout_digest !== exactDigest(holdout_digest, 'expected_holdout')) throw new Error('rsi_risk_certificate_holdout_mismatch');
  if (canonical.evaluator_root_digest !== exactDigest(evaluator_root_digest, 'expected_evaluator_root')) throw new Error('rsi_risk_certificate_evaluator_root_mismatch');
  return canonical;
}

export function verifyRsiRiskConfirmation(row) {
  if (!plainObject(row) || row.schema !== RSI_RISK_CONFIRMATION_SCHEMA || row.version !== 1) throw new Error('rsi_risk_confirmation_invalid');
  assertZeroAuthority(row, 'confirmation');
  const state = String(row.state || '');
  if (!['STATISTICAL_GATE_PASS_FOR_EXTERNAL_REVIEW', 'STATISTICAL_GATE_REJECTED'].includes(state)) {
    throw new Error('rsi_risk_confirmation_state_invalid');
  }
  if (
    row.direct_promotion_authorized !== false
    || row.existing_self_update_handoff_authorized !== false
    || row.statistical_gate_replaces_hard_invariants !== false
  ) throw new Error('rsi_risk_confirmation_policy_invalid');
  if (state === 'STATISTICAL_GATE_PASS_FOR_EXTERNAL_REVIEW') {
    if (row.superiority_certified !== true || row.external_promotion_review_required !== true) throw new Error('rsi_risk_confirmation_pass_invalid');
  } else if (row.superiority_certified !== false || row.external_promotion_review_required !== false) {
    throw new Error('rsi_risk_confirmation_reject_invalid');
  }
  const cumulative = Number(row.cumulative_alpha_spent);
  const global = Number(row.global_alpha);
  const used = Number(row.alpha_used);
  const allocated = Number(row.allocated_alpha);
  if (![cumulative, global, used, allocated].every(Number.isFinite) || cumulative < 0 || global <= 0 || used <= 0 || allocated <= 0) {
    throw new Error('rsi_risk_confirmation_alpha_invalid');
  }
  if (used - allocated > EPSILON || cumulative - global > EPSILON) throw new Error('rsi_risk_confirmation_budget_invalid');
  exactDigest(row.budget_digest, 'confirmation_budget');
  exactDigest(row.certificate_digest, 'confirmation_certificate');
  exactDigest(row.tournament_plan_digest, 'confirmation_tournament');
  exactDigest(row.holdout_digest, 'confirmation_holdout');
  exactDigest(row.evaluator_root_digest, 'confirmation_evaluator_root');
  exactSha(row.candidate_sha, 'confirmation_candidate');
  exactSha(row.parent_sha, 'confirmation_parent');
  boundedId(row.candidate_id, 'confirmation_candidate_id');
  const clone = structuredClone(row);
  delete clone.confirmation_digest;
  if (exactDigest(row.confirmation_digest, 'confirmation') !== digest(clone)) throw new Error('rsi_risk_confirmation_digest_mismatch');
  return row;
}

export function evaluateRsiRiskControlledPromotionReview({ promotion_gate_result, risk_confirmation } = {}) {
  if (!plainObject(promotion_gate_result) || promotion_gate_result.schema !== 'metaengine.rsi.promotion-admission-gate-result.v1' || promotion_gate_result.version !== 1) {
    throw new Error('rsi_risk_promotion_gate_invalid');
  }
  assertZeroAuthority(promotion_gate_result, 'promotion_gate');
  const gateClone = structuredClone(promotion_gate_result);
  delete gateClone.gate_digest;
  if (exactDigest(promotion_gate_result.gate_digest, 'promotion_gate') !== digest(gateClone)) {
    throw new Error('rsi_risk_promotion_gate_digest_mismatch');
  }
  if (
    promotion_gate_result.state !== 'READY_FOR_EXTERNAL_PROMOTION_REVIEW'
    || promotion_gate_result.ready_for_external_promotion_review !== true
    || promotion_gate_result.existing_self_update_handoff_authorized !== false
    || promotion_gate_result.direct_install_authorized !== false
    || promotion_gate_result.promotion_token !== null
  ) throw new Error('rsi_risk_promotion_gate_not_ready');

  const confirmation = verifyRsiRiskConfirmation(risk_confirmation);
  if (confirmation.state !== 'STATISTICAL_GATE_PASS_FOR_EXTERNAL_REVIEW') throw new Error('rsi_risk_statistical_gate_not_pass');
  if (
    String(promotion_gate_result.candidate_id || '') !== confirmation.candidate_id
    || exactSha(promotion_gate_result.candidate_sha, 'promotion_candidate') !== confirmation.candidate_sha
    || exactSha(promotion_gate_result.parent_sha, 'promotion_parent') !== confirmation.parent_sha
    || exactDigest(promotion_gate_result.tournament_plan_digest, 'promotion_tournament') !== confirmation.tournament_plan_digest
  ) throw new Error('rsi_risk_promotion_statistical_binding_mismatch');

  const core = {
    schema: RSI_RISK_CONTROLLED_PROMOTION_REVIEW_SCHEMA,
    version: 1,
    state: 'READY_FOR_RISK_CONTROLLED_EXTERNAL_PROMOTION_REVIEW',
    candidate_id: confirmation.candidate_id,
    candidate_sha: confirmation.candidate_sha,
    parent_sha: confirmation.parent_sha,
    promotion_gate_digest: promotion_gate_result.gate_digest,
    risk_confirmation_digest: confirmation.confirmation_digest,
    budget_digest: confirmation.budget_digest,
    certificate_digest: confirmation.certificate_digest,
    tournament_plan_digest: confirmation.tournament_plan_digest,
    holdout_digest: confirmation.holdout_digest,
    evaluator_root_digest: confirmation.evaluator_root_digest,
    cumulative_alpha_spent: confirmation.cumulative_alpha_spent,
    global_alpha: confirmation.global_alpha,
    hard_invariants_already_required_by_promotion_gate: true,
    statistical_confirmation_required: true,
    statistical_gate_is_promotion_authority: false,
    external_promotion_review_required: true,
    direct_promotion_authorized: false,
    direct_install_authorized: false,
    existing_self_update_handoff_authorized: false,
    promotion_token: null,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, review_digest: digest(core) });
}

export class RsiRecursiveRiskLedger {
  #budget;
  #confirmations = [];

  constructor({ budget } = {}) {
    this.#budget = verifyRsiRecursiveRiskBudget(budget);
  }

  confirm({
    certificate,
    candidate_id,
    candidate_sha,
    parent_sha,
    tournament_plan_digest,
    holdout_digest,
    evaluator_root_digest,
  } = {}) {
    const confirmationIndex = this.#confirmations.length + 1;
    const checked = verifyRsiExternalStatisticalCertificate(certificate, {
      budget: this.#budget,
      expected_confirmation_index: confirmationIndex,
      candidate_id,
      candidate_sha,
      parent_sha,
      tournament_plan_digest,
      holdout_digest,
      evaluator_root_digest,
    });
    if (this.#confirmations.some((row) => row.certificate_digest === checked.certificate_digest || row.candidate_sha === checked.candidate_sha)) {
      throw new Error('rsi_risk_confirmation_duplicate');
    }
    const spentBefore = this.#confirmations.reduce((sum, row) => sum + row.alpha_used, 0);
    const spentAfter = spentBefore + checked.alpha_used;
    if (spentAfter - this.#budget.global_alpha > EPSILON) throw new Error('rsi_risk_global_budget_exhausted');

    const state = checked.superiority_certified === true
      ? 'STATISTICAL_GATE_PASS_FOR_EXTERNAL_REVIEW'
      : 'STATISTICAL_GATE_REJECTED';
    const core = {
      schema: RSI_RISK_CONFIRMATION_SCHEMA,
      version: 1,
      confirmation_index: confirmationIndex,
      budget_id: this.#budget.budget_id,
      budget_digest: this.#budget.budget_digest,
      certificate_id: checked.certificate_id,
      certificate_digest: checked.certificate_digest,
      candidate_id: checked.candidate_id,
      candidate_sha: checked.candidate_sha,
      parent_sha: checked.parent_sha,
      tournament_plan_digest: checked.tournament_plan_digest,
      holdout_digest: checked.holdout_digest,
      evaluator_root_digest: checked.evaluator_root_digest,
      allocated_alpha: checked.allocated_alpha,
      alpha_used: checked.alpha_used,
      cumulative_alpha_spent: spentAfter,
      global_alpha: this.#budget.global_alpha,
      state,
      superiority_certified: checked.superiority_certified,
      external_promotion_review_required: checked.superiority_certified === true,
      direct_promotion_authorized: false,
      existing_self_update_handoff_authorized: false,
      statistical_gate_replaces_hard_invariants: false,
      execution_authority: false,
      production_mutation_authority: false,
      promotion_authority: false,
      self_update_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    };
    const row = Object.freeze({ ...core, confirmation_digest: digest(core) });
    this.#confirmations.push(row);
    return row;
  }

  snapshot() {
    const rows = this.#confirmations.map((row) => structuredClone(row));
    const cumulativeAlpha = rows.reduce((sum, row) => sum + row.alpha_used, 0);
    const nextIndex = rows.length + 1;
    let nextAllocation = null;
    try { nextAllocation = rsiRiskAllocationForConfirmation(this.#budget, nextIndex); } catch {}
    const core = {
      schema: RSI_RISK_LEDGER_SNAPSHOT_SCHEMA,
      version: 1,
      budget: this.#budget,
      confirmations: rows,
      confirmation_count: rows.length,
      cumulative_alpha_spent: cumulativeAlpha,
      global_alpha: this.#budget.global_alpha,
      remaining_alpha_upper_bound: Math.max(0, this.#budget.global_alpha - cumulativeAlpha),
      next_confirmation_index: nextIndex,
      next_confirmation_alpha_allocation: nextAllocation,
      spend_trigger: 'CONFIRMATION_EVENT_ONLY',
      screening_spends_alpha: false,
      proposal_round_spends_alpha: false,
      append_only: true,
      execution_authority: false,
      production_mutation_authority: false,
      promotion_authority: false,
      self_update_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    };
    return Object.freeze({ ...core, ledger_digest: digest(core) });
  }
}

export function rsiRecursiveRiskTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.recursive-risk-root.v1',
    version: 1,
    policy_path: 'apps/metaengine-browser/src/rsi-recursive-risk-budget.mjs',
    certificate_methods: [...CERTIFICATE_METHODS].sort(),
    spending_policies: Object.values(RSI_RISK_SPENDING_POLICIES).sort(),
    spending_is_confirmation_triggered: true,
    screening_spends_alpha: false,
    proposal_round_spends_alpha: false,
    external_statistical_certificate_required: true,
    candidate_can_author_certificate: false,
    candidate_can_choose_confirmation_index: false,
    candidate_can_choose_alpha: false,
    statistical_gate_replaces_hard_invariants: false,
    statistical_gate_is_promotion_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, risk_root_digest: digest(root) });
}
