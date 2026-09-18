import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  RSI_FIXED_META_OPERATION_DIGEST,
  verifyRsiRuntimeMetaSkillRecord,
} from './rsi-runtime-meta-skill-archive.mjs';
import {
  rsiRiskAllocationForConfirmation,
  verifyRsiRecursiveRiskBudget,
} from './rsi-recursive-risk-budget.mjs';

export const RSI_META_PROFILE_TOURNAMENT_PLAN_SCHEMA = 'metaengine.rsi.meta-profile-tournament-plan.v1';
export const RSI_META_PROFILE_PAIR_RECEIPT_SCHEMA = 'metaengine.rsi.meta-profile-pair-receipt.v1';
export const RSI_META_PROFILE_TOURNAMENT_RESULT_SCHEMA = 'metaengine.rsi.meta-profile-tournament-result.v1';
export const RSI_META_PROFILE_RISK_CERTIFICATE_SCHEMA = 'metaengine.rsi.meta-profile-risk-certificate.v1';
export const RSI_META_PROFILE_SHADOW_ADMISSION_SCHEMA = 'metaengine.rsi.meta-profile-shadow-admission.v1';
export const RSI_META_PROFILE_ADMISSION_STORE_SCHEMA = 'metaengine.rsi.meta-profile-admission-store.v1';

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MIN_PAIRS = 3;
const MAX_PAIRS = 21;
const DEFAULT_PAIRS = 5;
const MAX_RECORDS = 1024;
const MAX_EVIDENCE_REFS = 32;
const EPSILON = 1e-12;
const CERTIFICATE_METHODS = new Set([
  'E_VALUE_EXTERNAL_V1',
  'HOEFFDING_EXTERNAL_V1',
  'PAIRED_CONFIDENCE_SEQUENCE_EXTERNAL_V1',
]);

function plain(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]));
}
function dg(v) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)), 'utf8').digest('hex')}`;
}
function exactSha(v, label) {
  const out = String(v || '').trim().toLowerCase();
  if (!SHA40.test(out)) throw new Error(`rsi_meta_profile_${label}_sha_invalid`);
  return out;
}
function exactDigest(v, label) {
  const out = String(v || '').trim().toLowerCase();
  if (!SHA256.test(out)) throw new Error(`rsi_meta_profile_${label}_digest_invalid`);
  return out;
}
function boundedId(v, label) {
  const out = String(v || '').trim();
  if (!SAFE.test(out)) throw new Error(`rsi_meta_profile_${label}_invalid`);
  return out;
}
function positiveInt(v, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(v);
  if (!Number.isSafeInteger(out) || out < 1 || out > max) throw new Error(`rsi_meta_profile_${label}_invalid`);
  return out;
}
function exactProbability(v, label) {
  const out = Number(v);
  if (!Number.isFinite(out) || out <= 0 || out >= 1) throw new Error(`rsi_meta_profile_${label}_invalid`);
  return out;
}
function zero(extra = {}) {
  return Object.freeze({
    ...extra,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
function assertZero(v, label) {
  for (const field of [
    'execution_authority',
    'production_mutation_authority',
    'promotion_authority',
    'self_update_authority',
    'scheduler_authority',
    'signing_authority',
    'authority_effect',
  ]) {
    if (v?.[field] !== false) throw new Error(`rsi_meta_profile_${label}_${field}_invalid`);
  }
  if (v?.automatic_retry_allowed !== false) throw new Error(`rsi_meta_profile_${label}_retry_invalid`);
}
function evidenceRefs(v) {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_EVIDENCE_REFS) throw new Error('rsi_meta_profile_evidence_refs_invalid');
  const seen = new Set();
  return v.map((raw) => {
    const ref = boundedId(raw, 'evidence_ref');
    if (seen.has(ref)) throw new Error('rsi_meta_profile_evidence_ref_duplicate');
    seen.add(ref);
    return ref;
  }).sort();
}
function pairCount(v) {
  const n = v == null ? DEFAULT_PAIRS : Number(v);
  if (!Number.isSafeInteger(n) || n < MIN_PAIRS || n > MAX_PAIRS || n % 2 === 0) throw new Error('rsi_meta_profile_pair_count_invalid');
  return n;
}
function normalizeRecord(record) {
  const checked = verifyRsiRuntimeMetaSkillRecord(record);
  if (checked.fixed_meta_operation_digest !== RSI_FIXED_META_OPERATION_DIGEST) throw new Error('rsi_meta_profile_fixed_operation_mismatch');
  if (checked.eligible_for_meta_archive !== true) throw new Error('rsi_meta_profile_record_not_archive_eligible');
  if (checked.successor_profile_activation_authorized !== false || checked.archive_admission_is_profile_activation !== false) {
    throw new Error('rsi_meta_profile_record_activation_policy_invalid');
  }
  return checked;
}
function objectiveSpec(record) {
  const rows = record?.evaluation?.objective_spec;
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 32) throw new Error('rsi_meta_profile_objective_spec_invalid');
  const seen = new Set();
  return Object.freeze(rows.map((row) => {
    const metric = boundedId(row?.metric, 'metric');
    if (seen.has(metric)) throw new Error('rsi_meta_profile_objective_duplicate');
    seen.add(metric);
    const direction = String(row?.direction || '').toUpperCase();
    if (!['MAXIMIZE', 'MINIMIZE'].includes(direction)) throw new Error('rsi_meta_profile_objective_direction_invalid');
    const threshold = Number(row?.materiality_threshold);
    if (!Number.isFinite(threshold) || threshold < 0) throw new Error('rsi_meta_profile_objective_threshold_invalid');
    return Object.freeze({ metric, direction, materiality_threshold: threshold });
  }));
}
function scheduleFor(core, count) {
  const seed = dg(core).slice('sha256:'.length);
  const candidateFirst = parseInt(seed.slice(0, 2), 16) % 2 === 1;
  const seeds = [];
  for (let i = 0; i < count; i += 1) {
    const offset = (i * 8) % (seed.length - 8);
    seeds.push(parseInt(seed.slice(offset, offset + 8), 16) >>> 0);
  }
  return Object.freeze({
    seeds,
    order: Array.from({ length: count }, (_, i) => ((i % 2 === 0) === candidateFirst ? 'SUCCESSOR_FIRST' : 'PARENT_FIRST')),
  });
}

export function createRsiMetaProfileTournamentPlan({
  record,
  evaluator_root_digest,
  admission_holdout_digest,
  pair_count = DEFAULT_PAIRS,
  external_tournament_owner = false,
  authored_by_candidate = true,
} = {}) {
  if (external_tournament_owner !== true || authored_by_candidate !== false) throw new Error('rsi_meta_profile_external_tournament_owner_required');
  const checked = normalizeRecord(record);
  const holdout = exactDigest(admission_holdout_digest, 'admission_holdout');
  const evaluatorRoot = exactDigest(evaluator_root_digest, 'evaluator_root');
  const fastHoldout = exactDigest(checked.fast_loop_summary.fast_holdout_digest, 'fast_holdout');
  const metaHoldout = exactDigest(checked.plan.meta_holdout_digest, 'meta_holdout');
  if (holdout === fastHoldout || holdout === metaHoldout) throw new Error('rsi_meta_profile_admission_holdout_must_be_independent');
  const count = pairCount(pair_count);
  const core = {
    schema: RSI_META_PROFILE_TOURNAMENT_PLAN_SCHEMA,
    version: 1,
    source_sha: exactSha(checked.source_sha, 'source'),
    record_id: checked.record_id,
    record_digest: checked.record_digest,
    fixed_meta_operation_digest: checked.fixed_meta_operation_digest,
    library_digest: checked.library_digest,
    parent_profile_digest: checked.parent_profile_digest,
    successor_profile_digest: checked.successor_profile_digest,
    evaluator_root_digest: evaluatorRoot,
    fast_holdout_digest: fastHoldout,
    meta_holdout_digest: metaHoldout,
    admission_holdout_digest: holdout,
    objective_spec: objectiveSpec(checked),
    pair_count: count,
    same_hidden_workload_required: true,
    precommitted_pair_count: true,
    early_stop_allowed: false,
    candidate_can_choose_holdout: false,
    candidate_can_choose_evaluator: false,
    candidate_can_choose_pair_count: false,
    candidate_can_author_receipts: false,
    external_tournament_owner: true,
    authored_by_candidate: false,
    scalar_winner_authoritative: false,
    pareto_relation_only: true,
    tradeoff_is_shadow_admission: false,
    existing_recursive_risk_gate_required: true,
    production_profile_activation_authorized: false,
    bounded_canary_required_after_shadow_admission: true,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  const schedule = scheduleFor(core, count);
  const withSchedule = {
    ...core,
    precommitted_seed_schedule: schedule.seeds,
    precommitted_order_schedule: schedule.order,
  };
  const planDigest = dg(withSchedule);
  return Object.freeze({ ...withSchedule, plan_id: `rsi_meta_profile_tournament_${planDigest.slice('sha256:'.length)}`, plan_digest: planDigest });
}

export function verifyRsiMetaProfileTournamentPlan(plan, { record = null } = {}) {
  if (!plain(plan) || plan.schema !== RSI_META_PROFILE_TOURNAMENT_PLAN_SCHEMA || plan.version !== 1) throw new Error('rsi_meta_profile_plan_invalid');
  assertZero(plan, 'plan');
  const clone = structuredClone(plan);
  delete clone.plan_id;
  delete clone.plan_digest;
  const expected = dg(clone);
  if (plan.plan_digest !== expected || plan.plan_id !== `rsi_meta_profile_tournament_${expected.slice('sha256:'.length)}`) throw new Error('rsi_meta_profile_plan_digest_mismatch');
  const count = pairCount(plan.pair_count);
  if (!Array.isArray(plan.precommitted_seed_schedule) || plan.precommitted_seed_schedule.length !== count) throw new Error('rsi_meta_profile_seed_schedule_invalid');
  if (!Array.isArray(plan.precommitted_order_schedule) || plan.precommitted_order_schedule.length !== count) throw new Error('rsi_meta_profile_order_schedule_invalid');
  if (plan.fixed_meta_operation_digest !== RSI_FIXED_META_OPERATION_DIGEST) throw new Error('rsi_meta_profile_plan_fixed_operation_mismatch');
  exactSha(plan.source_sha, 'plan_source');
  exactDigest(plan.record_digest, 'plan_record');
  exactDigest(plan.library_digest, 'plan_library');
  exactDigest(plan.parent_profile_digest, 'plan_parent_profile');
  exactDigest(plan.successor_profile_digest, 'plan_successor_profile');
  exactDigest(plan.evaluator_root_digest, 'plan_evaluator_root');
  exactDigest(plan.fast_holdout_digest, 'plan_fast_holdout');
  exactDigest(plan.meta_holdout_digest, 'plan_meta_holdout');
  exactDigest(plan.admission_holdout_digest, 'plan_admission_holdout');
  if (plan.admission_holdout_digest === plan.fast_holdout_digest || plan.admission_holdout_digest === plan.meta_holdout_digest) {
    throw new Error('rsi_meta_profile_plan_holdout_overlap');
  }
  if (
    plan.external_tournament_owner !== true
    || plan.authored_by_candidate !== false
    || plan.early_stop_allowed !== false
    || plan.candidate_can_choose_holdout !== false
    || plan.candidate_can_choose_evaluator !== false
    || plan.candidate_can_choose_pair_count !== false
    || plan.candidate_can_author_receipts !== false
    || plan.scalar_winner_authoritative !== false
    || plan.pareto_relation_only !== true
    || plan.tradeoff_is_shadow_admission !== false
    || plan.existing_recursive_risk_gate_required !== true
    || plan.production_profile_activation_authorized !== false
    || plan.bounded_canary_required_after_shadow_admission !== true
  ) throw new Error('rsi_meta_profile_plan_policy_invalid');
  if (record) {
    const checked = normalizeRecord(record);
    if (
      plan.source_sha !== checked.source_sha
      || plan.record_id !== checked.record_id
      || plan.record_digest !== checked.record_digest
      || plan.library_digest !== checked.library_digest
      || plan.parent_profile_digest !== checked.parent_profile_digest
      || plan.successor_profile_digest !== checked.successor_profile_digest
    ) throw new Error('rsi_meta_profile_plan_record_binding_mismatch');
  }
  return plan;
}

function normalizeMetrics(value, plan, label) {
  if (!plain(value)) throw new Error(`rsi_meta_profile_${label}_metrics_invalid`);
  const out = {};
  const expected = new Set(plan.objective_spec.map((row) => row.metric));
  if (Object.keys(value).length !== expected.size) throw new Error(`rsi_meta_profile_${label}_metric_count_invalid`);
  for (const spec of plan.objective_spec) {
    if (!Object.hasOwn(value, spec.metric)) throw new Error(`rsi_meta_profile_${label}_metric_missing:${spec.metric}`);
    const number = Number(value[spec.metric]);
    if (!Number.isFinite(number)) throw new Error(`rsi_meta_profile_${label}_metric_invalid:${spec.metric}`);
    out[spec.metric] = number;
  }
  return Object.freeze(out);
}

export function createRsiMetaProfilePairReceipt({
  plan,
  pair_index,
  parent_metrics,
  successor_metrics,
  hard_invariants_pass,
  evidence_refs,
  external_evaluator = false,
  authored_by_candidate = true,
} = {}) {
  verifyRsiMetaProfileTournamentPlan(plan);
  if (external_evaluator !== true || authored_by_candidate !== false) throw new Error('rsi_meta_profile_external_pair_evaluator_required');
  const index = positiveInt(pair_index, 'pair_index', plan.pair_count);
  const refs = evidenceRefs(evidence_refs);
  const core = {
    schema: RSI_META_PROFILE_PAIR_RECEIPT_SCHEMA,
    version: 1,
    plan_id: plan.plan_id,
    plan_digest: plan.plan_digest,
    pair_index: index,
    seed: plan.precommitted_seed_schedule[index - 1],
    order: plan.precommitted_order_schedule[index - 1],
    record_digest: plan.record_digest,
    library_digest: plan.library_digest,
    parent_profile_digest: plan.parent_profile_digest,
    successor_profile_digest: plan.successor_profile_digest,
    admission_holdout_digest: plan.admission_holdout_digest,
    evaluator_root_digest: plan.evaluator_root_digest,
    parent_metrics: normalizeMetrics(parent_metrics, plan, 'parent'),
    successor_metrics: normalizeMetrics(successor_metrics, plan, 'successor'),
    hard_invariants_pass: hard_invariants_pass === true,
    evidence_refs: refs,
    external_evaluator: true,
    authored_by_candidate: false,
    receipt_is_activation_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, receipt_digest: dg(core) });
}

export function verifyRsiMetaProfilePairReceipt({ plan, receipt } = {}) {
  verifyRsiMetaProfileTournamentPlan(plan);
  if (!plain(receipt) || receipt.schema !== RSI_META_PROFILE_PAIR_RECEIPT_SCHEMA || receipt.version !== 1) throw new Error('rsi_meta_profile_pair_receipt_invalid');
  assertZero(receipt, 'pair_receipt');
  const canonical = createRsiMetaProfilePairReceipt({
    plan,
    pair_index: receipt.pair_index,
    parent_metrics: receipt.parent_metrics,
    successor_metrics: receipt.successor_metrics,
    hard_invariants_pass: receipt.hard_invariants_pass,
    evidence_refs: receipt.evidence_refs,
    external_evaluator: true,
    authored_by_candidate: false,
  });
  if (canonical.receipt_digest !== exactDigest(receipt.receipt_digest, 'pair_receipt')) throw new Error('rsi_meta_profile_pair_receipt_digest_mismatch');
  return canonical;
}

function median(values) {
  const rows = [...values].sort((a, b) => a - b);
  const mid = Math.floor(rows.length / 2);
  return rows.length % 2 === 1 ? rows[mid] : (rows[mid - 1] + rows[mid]) / 2;
}
function classifyObjective(spec, receipts) {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const receipt of receipts) {
    const parent = receipt.parent_metrics[spec.metric];
    const successor = receipt.successor_metrics[spec.metric];
    const raw = spec.direction === 'MAXIMIZE' ? successor - parent : parent - successor;
    if (raw > spec.materiality_threshold) wins += 1;
    else if (raw < -spec.materiality_threshold) losses += 1;
    else ties += 1;
  }
  const parentMedian = median(receipts.map((row) => row.parent_metrics[spec.metric]));
  const successorMedian = median(receipts.map((row) => row.successor_metrics[spec.metric]));
  const medianDelta = spec.direction === 'MAXIMIZE' ? successorMedian - parentMedian : parentMedian - successorMedian;
  let status = 'UNCHANGED';
  if (medianDelta > spec.materiality_threshold && wins > losses) status = 'IMPROVED';
  else if (medianDelta < -spec.materiality_threshold && losses > wins) status = 'REGRESSED';
  return Object.freeze({
    metric: spec.metric,
    direction: spec.direction,
    materiality_threshold: spec.materiality_threshold,
    parent_median: parentMedian,
    successor_median: successorMedian,
    median_delta: medianDelta,
    wins,
    losses,
    ties,
    status,
  });
}

export function evaluateRsiMetaProfileTournament({ plan, receipts } = {}) {
  verifyRsiMetaProfileTournamentPlan(plan);
  if (!Array.isArray(receipts) || receipts.length !== plan.pair_count) throw new Error('rsi_meta_profile_exact_pair_count_required');
  const checked = receipts.map((receipt) => verifyRsiMetaProfilePairReceipt({ plan, receipt })).sort((a, b) => a.pair_index - b.pair_index);
  const seen = new Set();
  for (let i = 0; i < checked.length; i += 1) {
    if (seen.has(checked[i].pair_index)) throw new Error('rsi_meta_profile_pair_duplicate');
    seen.add(checked[i].pair_index);
    if (checked[i].pair_index !== i + 1) throw new Error('rsi_meta_profile_pair_sequence_gap');
  }
  const hardFailures = checked.filter((row) => row.hard_invariants_pass !== true).map((row) => row.pair_index);
  const objectives = plan.objective_spec.map((spec) => classifyObjective(spec, checked));
  const improved = objectives.filter((row) => row.status === 'IMPROVED').map((row) => row.metric);
  const regressed = objectives.filter((row) => row.status === 'REGRESSED').map((row) => row.metric);
  let relation = 'NO_MEASURED_ADVANCE';
  if (hardFailures.length) relation = 'REJECTED_HARD_INVARIANT';
  else if (improved.length > 0 && regressed.length === 0) relation = 'PARETO_ADVANCE';
  else if (improved.length > 0 && regressed.length > 0) relation = 'TRADEOFF_STEPPING_STONE';
  const core = {
    schema: RSI_META_PROFILE_TOURNAMENT_RESULT_SCHEMA,
    version: 1,
    plan_id: plan.plan_id,
    plan_digest: plan.plan_digest,
    record_digest: plan.record_digest,
    library_digest: plan.library_digest,
    parent_profile_digest: plan.parent_profile_digest,
    successor_profile_digest: plan.successor_profile_digest,
    admission_holdout_digest: plan.admission_holdout_digest,
    evaluator_root_digest: plan.evaluator_root_digest,
    pair_count: checked.length,
    receipt_digests: checked.map((row) => row.receipt_digest),
    hard_failure_pairs: hardFailures,
    objectives,
    relation,
    eligible_for_shadow_admission: relation === 'PARETO_ADVANCE',
    tradeoff_archive_only: relation === 'TRADEOFF_STEPPING_STONE',
    scalar_winner: null,
    production_profile_activation_authorized: false,
    bounded_canary_required_after_shadow_admission: true,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, result_digest: dg(core) });
}

export function verifyRsiMetaProfileTournamentResult({ plan, result } = {}) {
  verifyRsiMetaProfileTournamentPlan(plan);
  if (!plain(result) || result.schema !== RSI_META_PROFILE_TOURNAMENT_RESULT_SCHEMA || result.version !== 1) throw new Error('rsi_meta_profile_tournament_result_invalid');
  assertZero(result, 'tournament_result');
  const clone = structuredClone(result);
  delete clone.result_digest;
  if (dg(clone) !== exactDigest(result.result_digest, 'tournament_result')) throw new Error('rsi_meta_profile_tournament_result_digest_mismatch');
  if (
    result.plan_digest !== plan.plan_digest
    || result.record_digest !== plan.record_digest
    || result.successor_profile_digest !== plan.successor_profile_digest
    || result.parent_profile_digest !== plan.parent_profile_digest
  ) throw new Error('rsi_meta_profile_tournament_result_binding_mismatch');
  if (!['PARETO_ADVANCE', 'TRADEOFF_STEPPING_STONE', 'NO_MEASURED_ADVANCE', 'REJECTED_HARD_INVARIANT'].includes(result.relation)) {
    throw new Error('rsi_meta_profile_tournament_relation_invalid');
  }
  if (result.eligible_for_shadow_admission !== (result.relation === 'PARETO_ADVANCE')) throw new Error('rsi_meta_profile_tournament_admission_flag_invalid');
  return result;
}

export function createRsiMetaProfileRiskCertificate({
  certificate_id,
  budget,
  confirmation_index,
  plan,
  result,
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
  verifyRsiMetaProfileTournamentResult({ plan, result });
  if (external_verifier !== true || authored_by_candidate !== false) throw new Error('rsi_meta_profile_external_risk_verifier_required');
  const index = positiveInt(confirmation_index, 'confirmation_index', 100000);
  const allocated = rsiRiskAllocationForConfirmation(checkedBudget, index);
  const alpha = exactProbability(alpha_used, 'alpha_used');
  if (alpha - allocated > EPSILON) throw new Error('rsi_meta_profile_alpha_over_budget');
  const normalizedMethod = String(method || '').toUpperCase();
  if (!CERTIFICATE_METHODS.has(normalizedMethod)) throw new Error('rsi_meta_profile_certificate_method_invalid');
  if (
    paired_evaluation !== true
    || independent_holdout !== true
    || stopping_rule_precommitted !== true
    || optional_stopping_used !== false
    || familywise_valid !== true
    || screening_spent_alpha !== false
    || confirmation_triggered !== true
  ) throw new Error('rsi_meta_profile_certificate_statistical_policy_invalid');
  if (superiority_certified === true && result.relation !== 'PARETO_ADVANCE') throw new Error('rsi_meta_profile_certificate_superiority_without_pareto_advance');
  const core = {
    schema: RSI_META_PROFILE_RISK_CERTIFICATE_SCHEMA,
    version: 1,
    certificate_id: boundedId(certificate_id, 'certificate_id'),
    budget_id: checkedBudget.budget_id,
    budget_digest: checkedBudget.budget_digest,
    confirmation_index: index,
    allocated_alpha: allocated,
    alpha_used: alpha,
    record_digest: result.record_digest,
    library_digest: result.library_digest,
    parent_profile_digest: result.parent_profile_digest,
    successor_profile_digest: result.successor_profile_digest,
    tournament_plan_digest: result.plan_digest,
    tournament_result_digest: result.result_digest,
    admission_holdout_digest: result.admission_holdout_digest,
    evaluator_root_digest: result.evaluator_root_digest,
    method: normalizedMethod,
    superiority_certified: superiority_certified === true,
    paired_evaluation: true,
    independent_holdout: true,
    stopping_rule_precommitted: true,
    optional_stopping_used: false,
    familywise_valid: true,
    screening_spent_alpha: false,
    confirmation_triggered: true,
    sample_count: positiveInt(sample_count, 'sample_count', 10000000),
    evidence_refs: evidenceRefs(evidence_refs),
    external_verifier: true,
    authored_by_candidate: false,
    certificate_is_activation_authority: false,
    production_profile_activation_authorized: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, certificate_digest: dg(core) });
}

export function verifyRsiMetaProfileRiskCertificate(certificate, { budget, plan, result } = {}) {
  if (!plain(certificate) || certificate.schema !== RSI_META_PROFILE_RISK_CERTIFICATE_SCHEMA || certificate.version !== 1) throw new Error('rsi_meta_profile_risk_certificate_invalid');
  assertZero(certificate, 'risk_certificate');
  const canonical = createRsiMetaProfileRiskCertificate({
    certificate_id: certificate.certificate_id,
    budget,
    confirmation_index: certificate.confirmation_index,
    plan,
    result,
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
  if (canonical.certificate_digest !== exactDigest(certificate.certificate_digest, 'risk_certificate')) throw new Error('rsi_meta_profile_risk_certificate_digest_mismatch');
  return canonical;
}

export function createRsiMetaProfileShadowAdmission({
  record,
  plan,
  result,
  budget,
  risk_certificate,
  admission_id,
  external_admission_owner = false,
  authored_by_candidate = true,
} = {}) {
  if (external_admission_owner !== true || authored_by_candidate !== false) throw new Error('rsi_meta_profile_external_admission_owner_required');
  const checked = normalizeRecord(record);
  verifyRsiMetaProfileTournamentPlan(plan, { record: checked });
  verifyRsiMetaProfileTournamentResult({ plan, result });
  const certificate = verifyRsiMetaProfileRiskCertificate(risk_certificate, { budget, plan, result });
  const blockers = [];
  if (result.relation !== 'PARETO_ADVANCE') blockers.push('TOURNAMENT_NOT_PARETO_ADVANCE');
  if (result.eligible_for_shadow_admission !== true) blockers.push('TOURNAMENT_NOT_SHADOW_ELIGIBLE');
  if (certificate.superiority_certified !== true) blockers.push('RECURSIVE_RISK_NOT_CERTIFIED');
  if (plan.admission_holdout_digest === checked.fast_loop_summary.fast_holdout_digest || plan.admission_holdout_digest === checked.plan.meta_holdout_digest) blockers.push('ADMISSION_HOLDOUT_OVERLAP');
  if (
    certificate.record_digest !== checked.record_digest
    || certificate.library_digest !== checked.library_digest
    || certificate.parent_profile_digest !== checked.parent_profile_digest
    || certificate.successor_profile_digest !== checked.successor_profile_digest
  ) blockers.push('RISK_BINDING_MISMATCH');
  const state = blockers.length === 0 ? 'SHADOW_PROFILE_ADMITTED' : 'BLOCKED';
  const core = {
    schema: RSI_META_PROFILE_SHADOW_ADMISSION_SCHEMA,
    version: 1,
    admission_id: boundedId(admission_id, 'admission_id'),
    source_sha: checked.source_sha,
    record_id: checked.record_id,
    record_digest: checked.record_digest,
    fixed_meta_operation_digest: checked.fixed_meta_operation_digest,
    library_digest: checked.library_digest,
    parent_profile_digest: checked.parent_profile_digest,
    successor_profile_digest: checked.successor_profile_digest,
    tournament_plan_digest: plan.plan_digest,
    tournament_result_digest: result.result_digest,
    risk_budget_digest: certificate.budget_digest,
    risk_certificate_digest: certificate.certificate_digest,
    admission_holdout_digest: plan.admission_holdout_digest,
    evaluator_root_digest: plan.evaluator_root_digest,
    state,
    blockers: blockers.sort(),
    shadow_profile_admitted: blockers.length === 0,
    eligible_for_bounded_shadow_canary: blockers.length === 0,
    bounded_shadow_canary_required: true,
    direct_production_activation_authorized: false,
    direct_self_update_authorized: false,
    admission_is_execution_authority: false,
    candidate_can_self_admit: false,
    candidate_can_activate_profile: false,
    external_admission_owner: true,
    authored_by_candidate: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, admission_digest: dg(core) });
}

export function verifyRsiMetaProfileShadowAdmission(admission) {
  if (!plain(admission) || admission.schema !== RSI_META_PROFILE_SHADOW_ADMISSION_SCHEMA || admission.version !== 1) throw new Error('rsi_meta_profile_shadow_admission_invalid');
  assertZero(admission, 'shadow_admission');
  const clone = structuredClone(admission);
  delete clone.admission_digest;
  if (dg(clone) !== exactDigest(admission.admission_digest, 'shadow_admission')) throw new Error('rsi_meta_profile_shadow_admission_digest_mismatch');
  if (
    admission.bounded_shadow_canary_required !== true
    || admission.direct_production_activation_authorized !== false
    || admission.direct_self_update_authorized !== false
    || admission.admission_is_execution_authority !== false
    || admission.candidate_can_self_admit !== false
    || admission.candidate_can_activate_profile !== false
    || admission.external_admission_owner !== true
    || admission.authored_by_candidate !== false
  ) throw new Error('rsi_meta_profile_shadow_admission_policy_invalid');
  if (admission.state === 'SHADOW_PROFILE_ADMITTED') {
    if (admission.blockers.length !== 0 || admission.shadow_profile_admitted !== true || admission.eligible_for_bounded_shadow_canary !== true) {
      throw new Error('rsi_meta_profile_shadow_admission_state_invalid');
    }
  } else if (admission.state === 'BLOCKED') {
    if (!Array.isArray(admission.blockers) || admission.blockers.length < 1 || admission.shadow_profile_admitted !== false || admission.eligible_for_bounded_shadow_canary !== false) {
      throw new Error('rsi_meta_profile_shadow_admission_blocked_invalid');
    }
  } else {
    throw new Error('rsi_meta_profile_shadow_admission_state_unknown');
  }
  return admission;
}

function stateCore(source, rows) {
  const core = {
    schema: RSI_META_PROFILE_ADMISSION_STORE_SCHEMA,
    version: 1,
    source_sha: source,
    fixed_meta_operation_digest: RSI_FIXED_META_OPERATION_DIGEST,
    admissions: rows,
    admission_count: rows.length,
    shadow_admitted_count: rows.filter((row) => row.state === 'SHADOW_PROFILE_ADMITTED').length,
    blocked_count: rows.filter((row) => row.state === 'BLOCKED').length,
    max_records: MAX_RECORDS,
    append_only: true,
    active_profile_digest: null,
    store_can_activate_profile: false,
    bounded_shadow_canary_required: true,
    production_activation_authorized: false,
    candidate_can_delete_records: false,
    candidate_can_rewrite_records: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return { ...core, state_digest: dg(core) };
}

export class RsiRuntimeMetaProfileAdmissionStore {
  #path;
  #source;
  #rows = [];
  #initialized = false;

  constructor({ statePath, source_sha } = {}) {
    if (!statePath) throw new Error('rsi_meta_profile_state_path_required');
    this.#path = path.resolve(statePath);
    this.#source = exactSha(source_sha, 'store_source');
  }

  async init() {
    if (this.#initialized) return this.snapshot();
    await fs.mkdir(path.dirname(this.#path), { recursive: true });
    try {
      const parsed = JSON.parse(await fs.readFile(this.#path, 'utf8'));
      assertZero(parsed, 'store');
      if (
        parsed.schema !== RSI_META_PROFILE_ADMISSION_STORE_SCHEMA
        || parsed.version !== 1
        || parsed.source_sha !== this.#source
        || parsed.fixed_meta_operation_digest !== RSI_FIXED_META_OPERATION_DIGEST
        || parsed.append_only !== true
        || parsed.active_profile_digest !== null
        || parsed.store_can_activate_profile !== false
        || parsed.bounded_shadow_canary_required !== true
        || parsed.production_activation_authorized !== false
        || parsed.candidate_can_delete_records !== false
        || parsed.candidate_can_rewrite_records !== false
      ) throw new Error('rsi_meta_profile_store_invalid');
      const clone = structuredClone(parsed);
      delete clone.state_digest;
      if (dg(clone) !== exactDigest(parsed.state_digest, 'store_state')) throw new Error('rsi_meta_profile_store_digest_mismatch');
      if (!Array.isArray(parsed.admissions) || parsed.admissions.length > MAX_RECORDS) throw new Error('rsi_meta_profile_store_rows_invalid');
      const ids = new Set();
      const digests = new Set();
      this.#rows = parsed.admissions.map((row) => {
        const checked = verifyRsiMetaProfileShadowAdmission(row);
        if (checked.source_sha !== this.#source) throw new Error('rsi_meta_profile_store_source_mismatch');
        if (ids.has(checked.admission_id) || digests.has(checked.admission_digest)) throw new Error('rsi_meta_profile_store_duplicate');
        ids.add(checked.admission_id);
        digests.add(checked.admission_digest);
        return checked;
      });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    this.#initialized = true;
    return this.snapshot();
  }

  async #persist() {
    const state = stateCore(this.#source, this.#rows);
    const temp = `${this.#path}.tmp`;
    const handle = await fs.open(temp, 'w', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(state)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temp, this.#path);
    return state;
  }

  async add(admission) {
    if (!this.#initialized) throw new Error('rsi_meta_profile_store_not_initialized');
    const checked = verifyRsiMetaProfileShadowAdmission(admission);
    if (checked.source_sha !== this.#source) throw new Error('rsi_meta_profile_store_source_mismatch');
    const existing = this.#rows.find((row) => row.admission_id === checked.admission_id || row.admission_digest === checked.admission_digest);
    if (existing) {
      if (existing.admission_digest !== checked.admission_digest) throw new Error('rsi_meta_profile_store_identity_conflict');
      return zero({ state: 'IDEMPOTENT', admission_digest: checked.admission_digest });
    }
    if (this.#rows.length >= MAX_RECORDS) throw new Error('rsi_meta_profile_store_capacity_exceeded');
    this.#rows.push(checked);
    await this.#persist();
    return zero({ state: checked.state, admission_digest: checked.admission_digest });
  }

  admitted() {
    if (!this.#initialized) throw new Error('rsi_meta_profile_store_not_initialized');
    return Object.freeze(this.#rows.filter((row) => row.state === 'SHADOW_PROFILE_ADMITTED').map((row) => Object.freeze(structuredClone(row))));
  }

  snapshot() {
    const state = stateCore(this.#source, this.#rows);
    return Object.freeze({
      schema: state.schema,
      version: state.version,
      source_sha: state.source_sha,
      initialized: this.#initialized,
      fixed_meta_operation_digest: state.fixed_meta_operation_digest,
      admission_count: state.admission_count,
      shadow_admitted_count: state.shadow_admitted_count,
      blocked_count: state.blocked_count,
      max_records: state.max_records,
      append_only: true,
      active_profile_digest: null,
      store_can_activate_profile: false,
      bounded_shadow_canary_required: true,
      production_activation_authorized: false,
      execution_authority: false,
      production_mutation_authority: false,
      promotion_authority: false,
      self_update_authority: false,
      scheduler_authority: false,
      signing_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  }
}

export function rsiMetaProfileAdmissionTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.meta-profile-admission-root.v1',
    version: 1,
    fixed_meta_operation_digest: RSI_FIXED_META_OPERATION_DIGEST,
    fixed_meta_operation_self_rewrite_allowed: false,
    exact_meta_record_binding_required: true,
    exact_library_snapshot_binding_required: true,
    independent_admission_holdout_required: true,
    paired_tournament_required: true,
    pareto_advance_required_for_shadow_admission: true,
    tradeoff_is_archive_only: true,
    recursive_risk_budget_required: true,
    external_statistical_certificate_required: true,
    candidate_can_author_tournament_receipts: false,
    candidate_can_author_risk_certificate: false,
    candidate_can_self_admit: false,
    shadow_admission_is_production_activation: false,
    bounded_shadow_canary_required: true,
    production_activation_authorized: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, meta_profile_admission_root_digest: dg(root) });
}
