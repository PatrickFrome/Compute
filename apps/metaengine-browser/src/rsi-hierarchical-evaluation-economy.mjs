import crypto from 'node:crypto';

import {
  verifyRsiArchitectureSearchDecision,
} from './rsi-agent-architecture-search.mjs';

export const RSI_HIERARCHICAL_EVALUATION_PLAN_SCHEMA = 'metaengine.rsi.hierarchical-evaluation-plan.v1';
export const RSI_EVALUATION_STAGE_RECEIPT_SCHEMA = 'metaengine.rsi.evaluation-stage-receipt.v1';
export const RSI_EVALUATION_STAGE_RESULT_SCHEMA = 'metaengine.rsi.evaluation-stage-result.v1';
export const RSI_EVALUATION_CASCADE_SNAPSHOT_SCHEMA = 'metaengine.rsi.evaluation-cascade-snapshot.v1';

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_CANDIDATES = 64;
const MAX_EVIDENCE_REFS = 32;
const MAX_STAGE_COUNT = 8;

const DEFAULT_STAGE_TEMPLATE = Object.freeze([
  Object.freeze({
    stage_id: 'MICRO_CONTRACTS',
    fidelity_class: 'DETERMINISTIC_MICRO_CONTRACTS',
    resource_units: 1,
    survivor_fraction: 0.5,
    minimum_survivors: 4,
    uncertainty_rescue_slots: 1,
    novelty_rescue_slots: 1,
    full_holdout: false,
  }),
  Object.freeze({
    stage_id: 'TARGETED_SHARD',
    fidelity_class: 'TARGETED_BENCHMARK_SHARD',
    resource_units: 4,
    survivor_fraction: 0.5,
    minimum_survivors: 2,
    uncertainty_rescue_slots: 1,
    novelty_rescue_slots: 1,
    full_holdout: false,
  }),
  Object.freeze({
    stage_id: 'DEEP_SHARD',
    fidelity_class: 'DEEP_BENCHMARK_SHARD',
    resource_units: 12,
    survivor_fraction: 0.5,
    minimum_survivors: 1,
    uncertainty_rescue_slots: 1,
    novelty_rescue_slots: 0,
    full_holdout: false,
  }),
  Object.freeze({
    stage_id: 'FULL_HOLDOUT',
    fidelity_class: 'FULL_HIDDEN_HOLDOUT',
    resource_units: 32,
    survivor_fraction: 1,
    minimum_survivors: 1,
    uncertainty_rescue_slots: 0,
    novelty_rescue_slots: 0,
    full_holdout: true,
  }),
]);

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
  if (!SHA256_RE.test(out)) throw new Error(`rsi_eval_${label}_digest_invalid`);
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_eval_${label}_invalid`);
  return out;
}

function positiveInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > max) throw new Error(`rsi_eval_${label}_invalid`);
  return out;
}

function nonNegativeInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 0 || out > max) throw new Error(`rsi_eval_${label}_invalid`);
  return out;
}

function unitInterval(value, label) {
  const out = Number(value);
  if (!Number.isFinite(out) || out < 0 || out > 1) throw new Error(`rsi_eval_${label}_invalid`);
  return out;
}

function assertZeroAuthority(value, label) {
  for (const field of ['execution_authority', 'production_mutation_authority', 'promotion_authority', 'self_update_authority', 'authority_effect']) {
    if (value?.[field] !== false) throw new Error(`rsi_eval_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_eval_${label}_automatic_retry_invalid`);
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
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EVIDENCE_REFS) throw new Error('rsi_eval_evidence_refs_invalid');
  const seen = new Set();
  return value.map((raw) => {
    const ref = boundedId(raw, 'evidence_ref');
    if (seen.has(ref)) throw new Error('rsi_eval_evidence_ref_duplicate');
    seen.add(ref);
    return ref;
  }).sort();
}

function deterministicTie(seed, candidateDigest) {
  return crypto.createHash('sha256').update(`${seed}:${candidateDigest}`, 'utf8').digest('hex');
}

function survivorCap(currentCount, stage, finalCandidateCap) {
  if (stage.full_holdout) return Math.min(currentCount, finalCandidateCap);
  const fractionTarget = Math.ceil(currentCount * stage.survivor_fraction);
  return Math.min(
    currentCount,
    Math.max(
      finalCandidateCap,
      Math.min(currentCount, Math.max(stage.minimum_survivors, fractionTarget)),
    ),
  );
}

function normalizeEntrants(searchDecision) {
  const checked = verifyRsiArchitectureSearchDecision(searchDecision);
  const entrants = checked.decisions
    .filter((row) => row.eligible_for_full_external_evaluation === true)
    .map((row) => Object.freeze({
      genome_id: boundedId(row.genome_id, 'genome_id'),
      genome_digest: exactDigest(row.genome_digest, 'genome'),
      triage_digest: exactDigest(row.triage_digest, 'triage'),
      pareto_front: row.pareto_front === true,
      exploration_slot: row.exploration_slot === true,
    }));
  if (entrants.length < 1 || entrants.length > MAX_CANDIDATES) throw new Error('rsi_eval_entrant_count_invalid');
  const seen = new Set();
  for (const row of entrants) {
    if (seen.has(row.genome_digest)) throw new Error('rsi_eval_entrant_duplicate');
    seen.add(row.genome_digest);
  }
  return Object.freeze({
    search_decision_digest: exactDigest(checked.decision_digest, 'search_decision'),
    search_round_id: boundedId(checked.search_round_id, 'search_round_id'),
    entrants,
  });
}

function normalizeStageTemplate(stage) {
  if (!plainObject(stage)) throw new Error('rsi_eval_stage_invalid');
  const id = String(stage.stage_id || '').toUpperCase();
  const fidelity = String(stage.fidelity_class || '').toUpperCase();
  if (!/^[A-Z0-9_]{3,64}$/.test(id) || !/^[A-Z0-9_]{3,96}$/.test(fidelity)) throw new Error('rsi_eval_stage_identity_invalid');
  const resource = positiveInt(stage.resource_units, 'stage_resource_units', 1_000_000);
  const fraction = unitInterval(stage.survivor_fraction, 'stage_survivor_fraction');
  if (fraction <= 0) throw new Error('rsi_eval_stage_survivor_fraction_invalid');
  return Object.freeze({
    stage_id: id,
    fidelity_class: fidelity,
    resource_units: resource,
    survivor_fraction: fraction,
    minimum_survivors: positiveInt(stage.minimum_survivors, 'stage_minimum_survivors', MAX_CANDIDATES),
    uncertainty_rescue_slots: nonNegativeInt(stage.uncertainty_rescue_slots, 'stage_uncertainty_slots', 4),
    novelty_rescue_slots: nonNegativeInt(stage.novelty_rescue_slots, 'stage_novelty_slots', 4),
    full_holdout: stage.full_holdout === true,
  });
}

export function createRsiHierarchicalEvaluationPlan({
  architecture_search_decision,
  evaluator_root_digest,
  workload_root_digest,
  hidden_holdout_digest,
  final_candidate_cap = 2,
  stage_template = DEFAULT_STAGE_TEMPLATE,
} = {}) {
  const source = normalizeEntrants(architecture_search_decision);
  const finalCap = positiveInt(final_candidate_cap, 'final_candidate_cap', Math.min(8, source.entrants.length));
  if (!Array.isArray(stage_template) || stage_template.length < 2 || stage_template.length > MAX_STAGE_COUNT) throw new Error('rsi_eval_stage_template_invalid');
  const stages = stage_template.map(normalizeStageTemplate);
  const ids = new Set();
  let fullHoldoutCount = 0;
  for (const stage of stages) {
    if (ids.has(stage.stage_id)) throw new Error('rsi_eval_stage_duplicate');
    ids.add(stage.stage_id);
    if (stage.full_holdout) fullHoldoutCount += 1;
  }
  if (fullHoldoutCount !== 1 || stages.at(-1)?.full_holdout !== true) throw new Error('rsi_eval_full_holdout_terminal_required');

  let active = source.entrants.length;
  const plannedStages = stages.map((stage, index) => {
    const cap = survivorCap(active, stage, finalCap);
    const rescueSlots = Math.min(Math.max(0, cap - 1), stage.uncertainty_rescue_slots + stage.novelty_rescue_slots);
    const row = Object.freeze({
      ...stage,
      ordinal: index + 1,
      entrant_cap: active,
      survivor_cap: cap,
      exploitation_slots: Math.max(0, cap - rescueSlots),
      rescue_slots: rescueSlots,
      exact_resource_per_candidate_required: true,
      same_stage_workload_required: true,
      stage_order_precommitted: true,
    });
    active = cap;
    return row;
  });

  const core = {
    schema: RSI_HIERARCHICAL_EVALUATION_PLAN_SCHEMA,
    version: 1,
    search_round_id: source.search_round_id,
    architecture_search_decision_digest: source.search_decision_digest,
    evaluator_root_digest: exactDigest(evaluator_root_digest, 'evaluator_root'),
    workload_root_digest: exactDigest(workload_root_digest, 'workload_root'),
    hidden_holdout_digest: exactDigest(hidden_holdout_digest, 'hidden_holdout'),
    entrants: source.entrants,
    entrant_count: source.entrants.length,
    final_candidate_cap: finalCap,
    stages: plannedStages,
    scheduling_policy: 'PRECOMMITTED_SUCCESSIVE_HALVING_WITH_BOUNDED_RESCUE_V1',
    fidelity_policy: 'LOW_TO_HIGH_EXTERNAL_EVIDENCE',
    optional_stopping_allowed: false,
    adaptive_stage_budget_after_results_allowed: false,
    candidate_can_choose_stage: false,
    candidate_can_choose_budget: false,
    candidate_can_choose_workload: false,
    candidate_can_choose_rescue: false,
    hard_invariant_failure_is_terminal: true,
    cheap_stage_is_promotion_authority: false,
    full_hidden_holdout_required_before_archive_admission: true,
    full_hidden_holdout_required_before_promotion_review: true,
    statistical_confirmation_required_for_promotion_review: true,
    statistical_risk_spent_before_confirmation: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  const planDigest = digest(core);
  return Object.freeze({
    ...core,
    plan_id: `rsi_eval_${planDigest.slice('sha256:'.length, 'sha256:'.length + 24)}`,
    plan_digest: planDigest,
  });
}

export function verifyRsiHierarchicalEvaluationPlan(plan) {
  if (!plainObject(plan) || plan.schema !== RSI_HIERARCHICAL_EVALUATION_PLAN_SCHEMA || plan.version !== 1) throw new Error('rsi_eval_plan_invalid');
  assertZeroAuthority(plan, 'plan');
  if (
    plan.scheduling_policy !== 'PRECOMMITTED_SUCCESSIVE_HALVING_WITH_BOUNDED_RESCUE_V1'
    || plan.fidelity_policy !== 'LOW_TO_HIGH_EXTERNAL_EVIDENCE'
    || plan.optional_stopping_allowed !== false
    || plan.adaptive_stage_budget_after_results_allowed !== false
    || plan.candidate_can_choose_stage !== false
    || plan.candidate_can_choose_budget !== false
    || plan.candidate_can_choose_workload !== false
    || plan.candidate_can_choose_rescue !== false
    || plan.hard_invariant_failure_is_terminal !== true
    || plan.cheap_stage_is_promotion_authority !== false
    || plan.full_hidden_holdout_required_before_archive_admission !== true
    || plan.full_hidden_holdout_required_before_promotion_review !== true
    || plan.statistical_confirmation_required_for_promotion_review !== true
    || plan.statistical_risk_spent_before_confirmation !== false
  ) throw new Error('rsi_eval_plan_policy_invalid');
  exactDigest(plan.architecture_search_decision_digest, 'plan_search_decision');
  exactDigest(plan.evaluator_root_digest, 'plan_evaluator_root');
  exactDigest(plan.workload_root_digest, 'plan_workload_root');
  exactDigest(plan.hidden_holdout_digest, 'plan_holdout');
  if (!Array.isArray(plan.entrants) || plan.entrants.length !== plan.entrant_count || plan.entrant_count < 1 || plan.entrant_count > MAX_CANDIDATES) {
    throw new Error('rsi_eval_plan_entrants_invalid');
  }
  const entrantDigests = new Set();
  for (const entrant of plan.entrants) {
    boundedId(entrant.genome_id, 'plan_genome_id');
    exactDigest(entrant.genome_digest, 'plan_genome');
    exactDigest(entrant.triage_digest, 'plan_triage');
    if (entrantDigests.has(entrant.genome_digest)) throw new Error('rsi_eval_plan_entrant_duplicate');
    entrantDigests.add(entrant.genome_digest);
  }
  if (!Array.isArray(plan.stages) || plan.stages.length < 2 || plan.stages.length > MAX_STAGE_COUNT) throw new Error('rsi_eval_plan_stages_invalid');
  if (plan.stages.filter((stage) => stage.full_holdout === true).length !== 1 || plan.stages.at(-1)?.full_holdout !== true) {
    throw new Error('rsi_eval_plan_terminal_holdout_invalid');
  }
  let previousCap = plan.entrant_count;
  for (const [index, stage] of plan.stages.entries()) {
    const normalized = normalizeStageTemplate(stage);
    if (
      stage.ordinal !== index + 1
      || stage.entrant_cap !== previousCap
      || !Number.isSafeInteger(stage.survivor_cap)
      || stage.survivor_cap < 1
      || stage.survivor_cap > stage.entrant_cap
      || stage.exploitation_slots + stage.rescue_slots !== stage.survivor_cap
      || stage.exact_resource_per_candidate_required !== true
      || stage.same_stage_workload_required !== true
      || stage.stage_order_precommitted !== true
    ) throw new Error('rsi_eval_plan_stage_binding_invalid');
    if (
      normalized.stage_id !== stage.stage_id
      || normalized.fidelity_class !== stage.fidelity_class
      || normalized.resource_units !== stage.resource_units
      || normalized.full_holdout !== stage.full_holdout
    ) throw new Error('rsi_eval_plan_stage_normalization_invalid');
    previousCap = stage.survivor_cap;
  }
  const clone = structuredClone(plan);
  delete clone.plan_id;
  delete clone.plan_digest;
  const expected = digest(clone);
  if (plan.plan_digest !== expected || plan.plan_id !== `rsi_eval_${expected.slice('sha256:'.length, 'sha256:'.length + 24)}`) {
    throw new Error('rsi_eval_plan_digest_mismatch');
  }
  return plan;
}

export function createRsiEvaluationStageReceipt({
  plan,
  stage_id,
  genome_id,
  genome_digest,
  performance_score,
  uncertainty_radius,
  novelty_score,
  hard_invariants_pass,
  resource_units_consumed,
  stage_workload_digest,
  evidence_digest,
  evidence_refs,
  external_evaluator = false,
  authored_by_candidate = true,
} = {}) {
  const checked = verifyRsiHierarchicalEvaluationPlan(plan);
  if (external_evaluator !== true || authored_by_candidate !== false) throw new Error('rsi_eval_receipt_external_origin_required');
  const stage = checked.stages.find((row) => row.stage_id === String(stage_id || '').toUpperCase());
  if (!stage) throw new Error('rsi_eval_receipt_stage_invalid');
  const digestValue = exactDigest(genome_digest, 'receipt_genome');
  const entrant = checked.entrants.find((row) => row.genome_digest === digestValue);
  if (!entrant || entrant.genome_id !== boundedId(genome_id, 'receipt_genome_id')) throw new Error('rsi_eval_receipt_entrant_mismatch');
  const consumed = positiveInt(resource_units_consumed, 'receipt_resource_units', 1_000_000);
  if (consumed !== stage.resource_units) throw new Error('rsi_eval_receipt_resource_mismatch');
  const core = {
    schema: RSI_EVALUATION_STAGE_RECEIPT_SCHEMA,
    version: 1,
    plan_id: checked.plan_id,
    plan_digest: checked.plan_digest,
    stage_id: stage.stage_id,
    stage_ordinal: stage.ordinal,
    fidelity_class: stage.fidelity_class,
    genome_id: entrant.genome_id,
    genome_digest: entrant.genome_digest,
    performance_score: unitInterval(performance_score, 'receipt_performance_score'),
    uncertainty_radius: unitInterval(uncertainty_radius, 'receipt_uncertainty_radius'),
    novelty_score: unitInterval(novelty_score, 'receipt_novelty_score'),
    hard_invariants_pass: hard_invariants_pass === true,
    resource_units_consumed: consumed,
    stage_workload_digest: exactDigest(stage_workload_digest, 'receipt_stage_workload'),
    evaluator_root_digest: checked.evaluator_root_digest,
    hidden_holdout_digest: checked.hidden_holdout_digest,
    evidence_digest: exactDigest(evidence_digest, 'receipt_evidence'),
    evidence_refs: evidenceRefs(evidence_refs),
    external_evaluator: true,
    authored_by_candidate: false,
    same_stage_workload_required: true,
    candidate_can_choose_score: false,
    candidate_can_choose_uncertainty: false,
    candidate_can_choose_novelty: false,
    cheap_stage_is_final_verdict: false,
    full_holdout_stage: stage.full_holdout,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, receipt_digest: digest(core) });
}

export function verifyRsiEvaluationStageReceipt(receipt, plan) {
  const checked = verifyRsiHierarchicalEvaluationPlan(plan);
  if (!plainObject(receipt) || receipt.schema !== RSI_EVALUATION_STAGE_RECEIPT_SCHEMA || receipt.version !== 1) throw new Error('rsi_eval_receipt_invalid');
  assertZeroAuthority(receipt, 'receipt');
  if (
    receipt.plan_id !== checked.plan_id
    || receipt.plan_digest !== checked.plan_digest
    || receipt.external_evaluator !== true
    || receipt.authored_by_candidate !== false
    || receipt.same_stage_workload_required !== true
    || receipt.candidate_can_choose_score !== false
    || receipt.candidate_can_choose_uncertainty !== false
    || receipt.candidate_can_choose_novelty !== false
    || receipt.cheap_stage_is_final_verdict !== false
  ) throw new Error('rsi_eval_receipt_policy_invalid');
  const canonical = createRsiEvaluationStageReceipt({
    plan: checked,
    stage_id: receipt.stage_id,
    genome_id: receipt.genome_id,
    genome_digest: receipt.genome_digest,
    performance_score: receipt.performance_score,
    uncertainty_radius: receipt.uncertainty_radius,
    novelty_score: receipt.novelty_score,
    hard_invariants_pass: receipt.hard_invariants_pass,
    resource_units_consumed: receipt.resource_units_consumed,
    stage_workload_digest: receipt.stage_workload_digest,
    evidence_digest: receipt.evidence_digest,
    evidence_refs: receipt.evidence_refs,
    external_evaluator: true,
    authored_by_candidate: false,
  });
  if (canonical.receipt_digest !== exactDigest(receipt.receipt_digest, 'receipt')) throw new Error('rsi_eval_receipt_digest_mismatch');
  return canonical;
}

function chooseSurvivors({ plan, stage, receipts, seed }) {
  const pass = receipts.filter((row) => row.hard_invariants_pass === true);
  if (stage.full_holdout) {
    return Object.freeze({
      survivors: pass,
      exploit: pass,
      uncertaintyRescue: [],
      noveltyRescue: [],
    });
  }
  const cap = Math.min(stage.survivor_cap, pass.length);
  if (cap === pass.length) {
    return Object.freeze({
      survivors: pass,
      exploit: pass,
      uncertaintyRescue: [],
      noveltyRescue: [],
    });
  }

  const byLower = [...pass].sort((a, b) => (
    (b.performance_score - b.uncertainty_radius) - (a.performance_score - a.uncertainty_radius)
    || b.performance_score - a.performance_score
    || deterministicTie(seed, a.genome_digest).localeCompare(deterministicTie(seed, b.genome_digest))
  ));

  const exploitCount = Math.min(stage.exploitation_slots, cap);
  const exploit = byLower.slice(0, exploitCount);
  const selected = new Set(exploit.map((row) => row.genome_digest));
  const remaining = byLower.filter((row) => !selected.has(row.genome_digest));

  const uncertaintyRescue = [];
  const uncertaintySlots = Math.min(stage.uncertainty_rescue_slots, cap - selected.size);
  if (uncertaintySlots > 0 && remaining.length > 0) {
    const cutoffLower = exploit.length > 0
      ? Math.min(...exploit.map((row) => row.performance_score - row.uncertainty_radius))
      : -Infinity;
    const uncertain = remaining
      .filter((row) => row.performance_score + row.uncertainty_radius >= cutoffLower)
      .sort((a, b) => (
        (b.performance_score + b.uncertainty_radius) - (a.performance_score + a.uncertainty_radius)
        || deterministicTie(seed, a.genome_digest).localeCompare(deterministicTie(seed, b.genome_digest))
      ))
      .slice(0, uncertaintySlots);
    for (const row of uncertain) {
      selected.add(row.genome_digest);
      uncertaintyRescue.push(row);
    }
  }

  const noveltyRescue = [];
  const noveltySlots = Math.min(stage.novelty_rescue_slots, cap - selected.size);
  if (noveltySlots > 0) {
    const novel = pass
      .filter((row) => !selected.has(row.genome_digest))
      .sort((a, b) => (
        b.novelty_score - a.novelty_score
        || a.performance_score - b.performance_score
        || deterministicTie(seed, a.genome_digest).localeCompare(deterministicTie(seed, b.genome_digest))
      ))
      .slice(0, noveltySlots);
    for (const row of novel) {
      selected.add(row.genome_digest);
      noveltyRescue.push(row);
    }
  }

  if (selected.size < cap) {
    for (const row of byLower) {
      if (selected.size >= cap) break;
      selected.add(row.genome_digest);
    }
  }

  const survivors = pass.filter((row) => selected.has(row.genome_digest));
  return Object.freeze({ survivors, exploit, uncertaintyRescue, noveltyRescue });
}

export class RsiHierarchicalEvaluationLedger {
  #plan;
  #stageIndex = 0;
  #active;
  #results = [];
  #cumulativeResourceUnits = 0;

  constructor({ plan } = {}) {
    this.#plan = verifyRsiHierarchicalEvaluationPlan(plan);
    this.#active = new Map(this.#plan.entrants.map((row) => [row.genome_digest, row]));
  }

  evaluateStage({ stage_id, receipts } = {}) {
    if (this.#stageIndex >= this.#plan.stages.length) throw new Error('rsi_eval_cascade_complete');
    const stage = this.#plan.stages[this.#stageIndex];
    if (String(stage_id || '').toUpperCase() !== stage.stage_id) throw new Error('rsi_eval_stage_order_violation');
    if (!Array.isArray(receipts) || receipts.length !== this.#active.size) throw new Error('rsi_eval_stage_receipt_set_incomplete');

    const checked = receipts.map((receipt) => verifyRsiEvaluationStageReceipt(receipt, this.#plan));
    const seen = new Set();
    for (const receipt of checked) {
      if (receipt.stage_id !== stage.stage_id || receipt.stage_ordinal !== stage.ordinal) throw new Error('rsi_eval_stage_receipt_wrong_stage');
      if (!this.#active.has(receipt.genome_digest)) throw new Error('rsi_eval_stage_receipt_inactive_candidate');
      if (seen.has(receipt.genome_digest)) throw new Error('rsi_eval_stage_receipt_duplicate');
      seen.add(receipt.genome_digest);
    }
    for (const digestValue of this.#active.keys()) {
      if (!seen.has(digestValue)) throw new Error('rsi_eval_stage_receipt_missing_candidate');
    }

    const workloadDigests = new Set(checked.map((row) => row.stage_workload_digest));
    if (workloadDigests.size !== 1) throw new Error('rsi_eval_stage_workload_mismatch');

    const stageResource = checked.reduce((sum, row) => sum + row.resource_units_consumed, 0);
    this.#cumulativeResourceUnits += stageResource;
    const seed = digest({
      plan_digest: this.#plan.plan_digest,
      stage_id: stage.stage_id,
      receipts: checked.map((row) => row.receipt_digest).sort(),
    });
    const selection = chooseSurvivors({ plan: this.#plan, stage, receipts: checked, seed });
    const survivorSet = new Set(selection.survivors.map((row) => row.genome_digest));
    const hardFailedSet = new Set(checked.filter((row) => row.hard_invariants_pass !== true).map((row) => row.genome_digest));
    const uncertaintySet = new Set(selection.uncertaintyRescue.map((row) => row.genome_digest));
    const noveltySet = new Set(selection.noveltyRescue.map((row) => row.genome_digest));

    const decisions = checked.map((row) => {
      const survives = survivorSet.has(row.genome_digest);
      const hardFail = hardFailedSet.has(row.genome_digest);
      const state = hardFail
        ? 'REJECT_HARD_INVARIANT'
        : stage.full_holdout
          ? 'FULL_HOLDOUT_COMPLETE'
          : survives
            ? 'ADVANCE_NEXT_FIDELITY'
            : 'STOP_EVALUATION_BUDGET';
      return zeroAuthority({
        genome_id: row.genome_id,
        genome_digest: row.genome_digest,
        receipt_digest: row.receipt_digest,
        state,
        advances: survives && !stage.full_holdout,
        full_holdout_complete: stage.full_holdout && survives,
        hard_invariant_failure: hardFail,
        uncertainty_rescue: uncertaintySet.has(row.genome_digest),
        novelty_rescue: noveltySet.has(row.genome_digest),
        cheap_stage_rejection_is_promotion_rejection: false,
        full_holdout_required_before_archive_admission: true,
        full_holdout_required_before_promotion_review: true,
      });
    });

    const resultCore = {
      schema: RSI_EVALUATION_STAGE_RESULT_SCHEMA,
      version: 1,
      plan_id: this.#plan.plan_id,
      plan_digest: this.#plan.plan_digest,
      stage_id: stage.stage_id,
      stage_ordinal: stage.ordinal,
      fidelity_class: stage.fidelity_class,
      entrant_count: checked.length,
      survivor_count: selection.survivors.length,
      hard_invariant_reject_count: hardFailedSet.size,
      resource_units_spent: stageResource,
      cumulative_resource_units_spent: this.#cumulativeResourceUnits,
      decisions,
      survivor_genome_digests: [...survivorSet].sort(),
      uncertainty_rescue_count: uncertaintySet.size,
      novelty_rescue_count: noveltySet.size,
      same_stage_workload_verified: true,
      precommitted_stage_budget_verified: true,
      hard_invariant_failure_terminal: true,
      cheap_stage_is_final_promotion_verdict: false,
      full_holdout_stage: stage.full_holdout,
      statistical_risk_spent: false,
      execution_authority: false,
      production_mutation_authority: false,
      promotion_authority: false,
      self_update_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    };
    const result = Object.freeze({ ...resultCore, stage_result_digest: digest(resultCore) });
    this.#results.push(result);

    this.#active = new Map(
      this.#plan.entrants
        .filter((row) => survivorSet.has(row.genome_digest))
        .map((row) => [row.genome_digest, row]),
    );
    this.#stageIndex += 1;
    return result;
  }

  snapshot() {
    const completed = this.#stageIndex >= this.#plan.stages.length;
    const fullHoldoutResult = this.#results.find((row) => row.full_holdout_stage === true) || null;
    const finalists = completed && fullHoldoutResult
      ? fullHoldoutResult.decisions.filter((row) => row.full_holdout_complete === true).map((row) => row.genome_digest).sort()
      : [];
    const core = {
      schema: RSI_EVALUATION_CASCADE_SNAPSHOT_SCHEMA,
      version: 1,
      plan_id: this.#plan.plan_id,
      plan_digest: this.#plan.plan_digest,
      next_stage_ordinal: completed ? null : this.#stageIndex + 1,
      next_stage_id: completed ? null : this.#plan.stages[this.#stageIndex].stage_id,
      active_genome_digests: [...this.#active.keys()].sort(),
      completed_stage_results: structuredClone(this.#results),
      completed_stage_count: this.#results.length,
      cumulative_resource_units_spent: this.#cumulativeResourceUnits,
      cascade_complete: completed,
      full_holdout_complete: completed && fullHoldoutResult != null,
      full_holdout_finalists: finalists,
      eligible_for_archive_admission_review: completed && finalists.length > 0,
      eligible_for_statistical_confirmation: completed && finalists.length > 0,
      statistical_confirmation_required_before_promotion_review: true,
      statistical_risk_spent: false,
      cheap_stage_is_promotion_authority: false,
      evaluation_economy_is_promotion_authority: false,
      execution_authority: false,
      production_mutation_authority: false,
      promotion_authority: false,
      self_update_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    };
    return Object.freeze({ ...core, snapshot_digest: digest(core) });
  }
}

export function rsiHierarchicalEvaluationTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.hierarchical-evaluation-root.v1',
    version: 1,
    policy_path: 'apps/metaengine-browser/src/rsi-hierarchical-evaluation-economy.mjs',
    scheduling_policy: 'PRECOMMITTED_SUCCESSIVE_HALVING_WITH_BOUNDED_RESCUE_V1',
    fidelity_policy: 'LOW_TO_HIGH_EXTERNAL_EVIDENCE',
    default_stage_template: DEFAULT_STAGE_TEMPLATE,
    optional_stopping_allowed: false,
    adaptive_stage_budget_after_results_allowed: false,
    candidate_can_choose_stage: false,
    candidate_can_choose_budget: false,
    candidate_can_choose_workload: false,
    uncertainty_rescue_required_when_configured: true,
    novelty_rescue_required_when_configured: true,
    hard_invariant_failure_terminal: true,
    cheap_stage_is_final_promotion_verdict: false,
    full_hidden_holdout_required_before_archive_admission: true,
    full_hidden_holdout_required_before_promotion_review: true,
    statistical_confirmation_required_before_promotion_review: true,
    statistical_risk_spent_before_confirmation: false,
    evaluation_economy_is_promotion_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, evaluation_root_digest: digest(root) });
}
