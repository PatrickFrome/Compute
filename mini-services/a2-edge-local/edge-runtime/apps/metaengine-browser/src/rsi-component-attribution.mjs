import crypto from 'node:crypto';
import candidateCapsule from './candidate-capsule.cjs';
import { RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA } from './rsi-isolated-candidate-builder.mjs';

const { verifyCandidateCapsule } = candidateCapsule;

export const RSI_COMPONENT_ATTRIBUTION_PLAN_SCHEMA = 'metaengine.rsi.component-attribution-plan.v1';
export const RSI_COMPONENT_ABLATION_RECEIPT_SCHEMA = 'metaengine.rsi.component-ablation-receipt.v1';
export const RSI_COMPONENT_ATTRIBUTION_RESULT_SCHEMA = 'metaengine.rsi.component-attribution-result.v1';
export const RSI_COMPONENT_ATTRIBUTION_RECORD_SCHEMA = 'metaengine.rsi.component-attribution-record.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const CANDIDATE_ID_RE = /^candidate_sha256_[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_COMPONENTS = 32;
const MAX_OBJECTIVES = 8;
const MAX_EVIDENCE_REFS = 32;
const HARD_INVARIANTS = Object.freeze([
  'NO_DUPLICATE_IRREVERSIBLE_EFFECT',
  'NO_AUTHORITY_VIOLATION',
  'NO_WORKSPACE_ESCAPE',
  'EXACT_SOURCE_IDENTITY',
  'NO_SECURITY_REGRESSION',
  'NO_AMBIGUOUS_EFFECT_RETRY',
]);
const OBJECTIVE_DIRECTIONS = new Set(['MAXIMIZE', 'MINIMIZE']);

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
  if (!SHA256_RE.test(out)) throw new Error(`rsi_attribution_${label}_digest_invalid`);
  return out;
}

function exactSha(value, label) {
  const out = String(value || '').toLowerCase();
  if (!SHA40_RE.test(out)) throw new Error(`rsi_attribution_${label}_sha_invalid`);
  return out;
}

function exactCandidateId(value, label) {
  const out = String(value || '').toLowerCase();
  if (!CANDIDATE_ID_RE.test(out)) throw new Error(`rsi_attribution_${label}_candidate_id_invalid`);
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_attribution_${label}_invalid`);
  return out;
}

function boundedPath(value, label) {
  const out = String(value || '').trim();
  if (!out || out.length > 240 || out.startsWith('/') || out.includes('\\') || out.includes('\0') || out.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`rsi_attribution_${label}_path_invalid`);
  }
  return out;
}

function positiveInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > max) throw new Error(`rsi_attribution_${label}_invalid`);
  return out;
}

function finiteNumber(value, label) {
  const out = Number(value);
  if (!Number.isFinite(out)) throw new Error(`rsi_attribution_${label}_invalid`);
  return out;
}

function nonNegativeNumber(value, label) {
  const out = finiteNumber(value, label);
  if (out < 0) throw new Error(`rsi_attribution_${label}_invalid`);
  return out;
}

function assertZeroAuthority(value, label) {
  for (const field of ['execution_authority', 'production_mutation_authority', 'promotion_authority', 'self_update_authority', 'authority_effect']) {
    if (value?.[field] !== false) throw new Error(`rsi_attribution_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_attribution_${label}_automatic_retry_invalid`);
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
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EVIDENCE_REFS) throw new Error('rsi_attribution_evidence_refs_invalid');
  const seen = new Set();
  return value.map((raw) => {
    const ref = boundedId(raw, 'evidence_ref');
    if (seen.has(ref)) throw new Error('rsi_attribution_evidence_ref_duplicate');
    seen.add(ref);
    return ref;
  }).sort();
}

function normalizeCandidateHandoff(handoff) {
  if (!plainObject(handoff) || handoff.schema !== RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA || handoff.version !== 1) {
    throw new Error('rsi_attribution_handoff_invalid');
  }
  assertZeroAuthority(handoff, 'handoff');
  if (handoff.eligible_for_evaluation !== true || handoff.eligible_for_promotion !== false || handoff.materialization_replay_authorized !== false) {
    throw new Error('rsi_attribution_handoff_policy_invalid');
  }
  const clone = structuredClone(handoff);
  delete clone.handoff_digest;
  if (exactDigest(handoff.handoff_digest, 'handoff') !== digest(clone)) throw new Error('rsi_attribution_handoff_digest_mismatch');
  const capsule = handoff.candidate_capsule;
  if (!plainObject(capsule)) throw new Error('rsi_attribution_capsule_invalid');
  verifyCandidateCapsule(capsule, capsule.source);
  const candidateSha = exactSha(handoff.candidate_sha, 'candidate');
  const parentSha = exactSha(handoff.parent_sha, 'parent');
  if (candidateSha === parentSha) throw new Error('rsi_attribution_noop_candidate');
  if (String(capsule?.source?.head || '').toLowerCase() !== candidateSha) throw new Error('rsi_attribution_capsule_source_mismatch');
  const candidateId = exactCandidateId(capsule.candidate_id, 'candidate');
  const components = Array.isArray(capsule.components) ? capsule.components : [];
  if (components.length < 1 || components.length > MAX_COMPONENTS) throw new Error('rsi_attribution_component_count_invalid');
  const normalized = components.map((row) => Object.freeze({
    path: boundedPath(row.path, 'component'),
    change: String(row.change || '').toUpperCase(),
    digest: exactDigest(row.digest, 'component'),
  })).sort((a, b) => a.path.localeCompare(b.path) || a.change.localeCompare(b.change) || a.digest.localeCompare(b.digest));
  return Object.freeze({
    candidate_id: candidateId,
    candidate_sha: candidateSha,
    parent_sha: parentSha,
    handoff_digest: handoff.handoff_digest,
    capsule_digest: exactDigest(capsule.digest, 'capsule'),
    mutation_surface: String(handoff.mutation_surface || '').toUpperCase(),
    components: normalized,
  });
}

function normalizeObjectiveSpec(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_OBJECTIVES) throw new Error('rsi_attribution_objective_spec_invalid');
  const seen = new Set();
  return value.map((row) => {
    if (!plainObject(row)) throw new Error('rsi_attribution_objective_invalid');
    const metric = boundedId(row.metric, 'objective_metric');
    if (seen.has(metric)) throw new Error('rsi_attribution_objective_duplicate');
    seen.add(metric);
    const direction = String(row.direction || '').toUpperCase();
    if (!OBJECTIVE_DIRECTIONS.has(direction)) throw new Error('rsi_attribution_objective_direction_invalid');
    return Object.freeze({
      metric,
      direction,
      materiality_threshold: nonNegativeNumber(row.materiality_threshold, 'materiality_threshold'),
    });
  }).sort((a, b) => a.metric.localeCompare(b.metric));
}

function normalizeHardInvariantMap(value, label) {
  if (!plainObject(value)) throw new Error(`rsi_attribution_${label}_hard_invariants_invalid`);
  const keys = Object.keys(value).sort();
  const expected = [...HARD_INVARIANTS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw new Error(`rsi_attribution_${label}_hard_invariants_shape_invalid`);
  return Object.freeze(Object.fromEntries(HARD_INVARIANTS.map((id) => {
    if (value[id] !== true && value[id] !== false) throw new Error(`rsi_attribution_${label}_hard_invariant_result_invalid`);
    return [id, value[id]];
  })));
}

function objectiveEffectsFromReceipt(receipt, objectiveSpec) {
  if (!Array.isArray(receipt.objectives) || receipt.objectives.length !== objectiveSpec.length) throw new Error('rsi_attribution_objective_receipts_invalid');
  const byMetric = new Map();
  for (const row of receipt.objectives) {
    if (!plainObject(row)) throw new Error('rsi_attribution_objective_receipt_invalid');
    const metric = boundedId(row.metric, 'objective_receipt_metric');
    if (byMetric.has(metric)) throw new Error('rsi_attribution_objective_receipt_duplicate');
    byMetric.set(metric, row);
  }
  return Object.freeze(objectiveSpec.map((spec) => {
    const row = byMetric.get(spec.metric);
    if (!row) throw new Error('rsi_attribution_objective_receipt_missing');
    const fullValue = finiteNumber(row.full_candidate_value, 'full_candidate_value');
    const ablatedValue = finiteNumber(row.ablated_candidate_value, 'ablated_candidate_value');
    const signedContribution = spec.direction === 'MAXIMIZE'
      ? fullValue - ablatedValue
      : ablatedValue - fullValue;
    const status = signedContribution > spec.materiality_threshold
      ? 'BENEFICIAL'
      : signedContribution < -spec.materiality_threshold
        ? 'HARMFUL'
        : 'NO_MATERIAL_EFFECT';
    return Object.freeze({
      metric: spec.metric,
      direction: spec.direction,
      materiality_threshold: spec.materiality_threshold,
      full_candidate_value: fullValue,
      ablated_candidate_value: ablatedValue,
      signed_component_contribution: signedContribution,
      status,
    });
  }));
}

function classifyAttribution(fullHard, ablatedHard, objectives) {
  const fullFailures = HARD_INVARIANTS.filter((id) => fullHard[id] !== true);
  if (fullFailures.length > 0) throw new Error('rsi_attribution_full_candidate_hard_invariant_not_pass');
  const ablationFailures = HARD_INVARIANTS.filter((id) => ablatedHard[id] !== true);
  if (ablationFailures.length > 0) return Object.freeze({
    classification: 'SAFETY_CRITICAL',
    safety_critical_invariants: ablationFailures,
    interaction_resolution_required: false,
  });
  const beneficial = objectives.filter((row) => row.status === 'BENEFICIAL').map((row) => row.metric);
  const harmful = objectives.filter((row) => row.status === 'HARMFUL').map((row) => row.metric);
  if (beneficial.length > 0 && harmful.length === 0) return Object.freeze({
    classification: 'CONTRIBUTING',
    safety_critical_invariants: [],
    interaction_resolution_required: false,
  });
  if (harmful.length > 0 && beneficial.length === 0) return Object.freeze({
    classification: 'HARMFUL',
    safety_critical_invariants: [],
    interaction_resolution_required: false,
  });
  if (harmful.length > 0 && beneficial.length > 0) return Object.freeze({
    classification: 'TRADEOFF_INTERACTION',
    safety_critical_invariants: [],
    interaction_resolution_required: true,
  });
  return Object.freeze({
    classification: 'NO_MATERIAL_EFFECT',
    safety_critical_invariants: [],
    interaction_resolution_required: false,
  });
}

export function createRsiComponentAttributionPlan({
  candidate_handoff,
  workload_digest,
  holdout_digest,
  environment_fingerprint,
  paired_seed_schedule_digest,
  objective_spec,
} = {}) {
  const candidate = normalizeCandidateHandoff(candidate_handoff);
  const objectives = normalizeObjectiveSpec(objective_spec);
  const workload = exactDigest(workload_digest, 'workload');
  const holdout = exactDigest(holdout_digest, 'holdout');
  if (workload === holdout) throw new Error('rsi_attribution_holdout_alias');
  const components = candidate.components.map((component, index) => {
    const ablationCore = {
      candidate_id: candidate.candidate_id,
      candidate_sha: candidate.candidate_sha,
      component_path: component.path,
      component_digest: component.digest,
      component_change: component.change,
      ordinal: index + 1,
    };
    return Object.freeze({
      ...component,
      ordinal: index + 1,
      ablation_id: `rsi_ablation_${digest(ablationCore).slice('sha256:'.length, 'sha256:'.length + 24)}`,
      required: true,
    });
  });
  const core = {
    schema: RSI_COMPONENT_ATTRIBUTION_PLAN_SCHEMA,
    version: 1,
    candidate_id: candidate.candidate_id,
    candidate_sha: candidate.candidate_sha,
    parent_sha: candidate.parent_sha,
    handoff_digest: candidate.handoff_digest,
    capsule_digest: candidate.capsule_digest,
    mutation_surface: candidate.mutation_surface,
    workload_digest: workload,
    holdout_digest: holdout,
    environment_fingerprint: boundedId(environment_fingerprint, 'environment_fingerprint'),
    paired_seed_schedule_digest: exactDigest(paired_seed_schedule_digest, 'seed_schedule'),
    objective_spec: objectives,
    components,
    attribution_scope: 'ALL_CHANGED_COMPONENTS',
    component_count: components.length,
    paired_ablation_required: true,
    exact_same_workload_required: true,
    exact_same_holdout_required: true,
    exact_same_seed_schedule_required: true,
    exact_same_environment_required: true,
    early_stop_allowed: false,
    missing_component_receipt_allowed: false,
    candidate_can_select_component: false,
    candidate_can_author_attribution: false,
    llm_narrative_is_attribution_authority: false,
    causal_claim_scope: 'MATCHED_SINGLE_COMPONENT_ABLATION',
    interaction_claims_require_separate_evidence: true,
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
    plan_id: `rsi_attribution_${planDigest.slice('sha256:'.length, 'sha256:'.length + 24)}`,
    plan_digest: planDigest,
  });
}

export function verifyRsiComponentAttributionPlan(plan) {
  if (!plainObject(plan) || plan.schema !== RSI_COMPONENT_ATTRIBUTION_PLAN_SCHEMA || plan.version !== 1) throw new Error('rsi_attribution_plan_invalid');
  assertZeroAuthority(plan, 'plan');
  if (
    plan.attribution_scope !== 'ALL_CHANGED_COMPONENTS'
    || plan.paired_ablation_required !== true
    || plan.exact_same_workload_required !== true
    || plan.exact_same_holdout_required !== true
    || plan.exact_same_seed_schedule_required !== true
    || plan.exact_same_environment_required !== true
    || plan.early_stop_allowed !== false
    || plan.missing_component_receipt_allowed !== false
    || plan.candidate_can_select_component !== false
    || plan.candidate_can_author_attribution !== false
    || plan.llm_narrative_is_attribution_authority !== false
    || plan.causal_claim_scope !== 'MATCHED_SINGLE_COMPONENT_ABLATION'
    || plan.interaction_claims_require_separate_evidence !== true
  ) throw new Error('rsi_attribution_plan_policy_invalid');
  exactCandidateId(plan.candidate_id, 'plan');
  exactSha(plan.candidate_sha, 'plan_candidate');
  exactSha(plan.parent_sha, 'plan_parent');
  exactDigest(plan.handoff_digest, 'plan_handoff');
  exactDigest(plan.capsule_digest, 'plan_capsule');
  exactDigest(plan.workload_digest, 'plan_workload');
  exactDigest(plan.holdout_digest, 'plan_holdout');
  exactDigest(plan.paired_seed_schedule_digest, 'plan_seed_schedule');
  boundedId(plan.environment_fingerprint, 'plan_environment');
  const objectives = normalizeObjectiveSpec(plan.objective_spec);
  if (!Array.isArray(plan.components) || plan.components.length < 1 || plan.components.length > MAX_COMPONENTS || plan.component_count !== plan.components.length) {
    throw new Error('rsi_attribution_plan_components_invalid');
  }
  const seen = new Set();
  for (const [index, row] of plan.components.entries()) {
    if (!plainObject(row)) throw new Error('rsi_attribution_plan_component_invalid');
    const path = boundedPath(row.path, 'plan_component');
    if (seen.has(path)) throw new Error('rsi_attribution_plan_component_duplicate');
    seen.add(path);
    exactDigest(row.digest, 'plan_component');
    positiveInt(row.ordinal, 'plan_component_ordinal', MAX_COMPONENTS);
    if (row.ordinal !== index + 1 || row.required !== true || !/^rsi_ablation_[0-9a-f]{24}$/.test(String(row.ablation_id || ''))) {
      throw new Error('rsi_attribution_plan_component_binding_invalid');
    }
  }
  if (objectives.length !== plan.objective_spec.length) throw new Error('rsi_attribution_plan_objective_mismatch');
  const clone = structuredClone(plan);
  delete clone.plan_id;
  delete clone.plan_digest;
  const expected = digest(clone);
  if (plan.plan_digest !== expected || plan.plan_id !== `rsi_attribution_${expected.slice('sha256:'.length, 'sha256:'.length + 24)}`) {
    throw new Error('rsi_attribution_plan_digest_mismatch');
  }
  return plan;
}

export function createRsiComponentAblationReceipt({
  plan,
  ablation_id,
  ablated_candidate_sha,
  full_candidate_hard_invariants,
  ablated_candidate_hard_invariants,
  objectives,
  evidence_refs,
  external_evaluator = false,
  authored_by_candidate = true,
} = {}) {
  const checked = verifyRsiComponentAttributionPlan(plan);
  if (external_evaluator !== true || authored_by_candidate !== false) throw new Error('rsi_attribution_receipt_external_origin_required');
  const component = checked.components.find((row) => row.ablation_id === String(ablation_id || ''));
  if (!component) throw new Error('rsi_attribution_ablation_id_invalid');
  const ablatedSha = exactSha(ablated_candidate_sha, 'ablated_candidate');
  if (ablatedSha === checked.candidate_sha || ablatedSha === checked.parent_sha) throw new Error('rsi_attribution_ablated_identity_invalid');
  const fullHard = normalizeHardInvariantMap(full_candidate_hard_invariants, 'full');
  const ablatedHard = normalizeHardInvariantMap(ablated_candidate_hard_invariants, 'ablated');
  const effects = objectiveEffectsFromReceipt({ objectives }, checked.objective_spec);
  const classification = classifyAttribution(fullHard, ablatedHard, effects);
  const core = {
    schema: RSI_COMPONENT_ABLATION_RECEIPT_SCHEMA,
    version: 1,
    plan_id: checked.plan_id,
    plan_digest: checked.plan_digest,
    candidate_id: checked.candidate_id,
    candidate_sha: checked.candidate_sha,
    parent_sha: checked.parent_sha,
    ablation_id: component.ablation_id,
    component_path: component.path,
    component_digest: component.digest,
    component_change: component.change,
    ablated_candidate_sha: ablatedSha,
    workload_digest: checked.workload_digest,
    holdout_digest: checked.holdout_digest,
    environment_fingerprint: checked.environment_fingerprint,
    paired_seed_schedule_digest: checked.paired_seed_schedule_digest,
    full_candidate_hard_invariants: fullHard,
    ablated_candidate_hard_invariants: ablatedHard,
    objective_effects: effects,
    classification: classification.classification,
    safety_critical_invariants: classification.safety_critical_invariants,
    interaction_resolution_required: classification.interaction_resolution_required,
    evidence_refs: evidenceRefs(evidence_refs),
    external_evaluator: true,
    authored_by_candidate: false,
    paired_ablation: true,
    same_workload: true,
    same_holdout: true,
    same_seed_schedule: true,
    same_environment: true,
    llm_narrative_is_attribution_authority: false,
    causal_claim_scope: 'MATCHED_SINGLE_COMPONENT_ABLATION',
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, receipt_digest: digest(core) });
}

export function verifyRsiComponentAblationReceipt(receipt, plan) {
  if (!plainObject(receipt) || receipt.schema !== RSI_COMPONENT_ABLATION_RECEIPT_SCHEMA || receipt.version !== 1) throw new Error('rsi_attribution_receipt_invalid');
  assertZeroAuthority(receipt, 'receipt');
  if (
    receipt.external_evaluator !== true
    || receipt.authored_by_candidate !== false
    || receipt.paired_ablation !== true
    || receipt.same_workload !== true
    || receipt.same_holdout !== true
    || receipt.same_seed_schedule !== true
    || receipt.same_environment !== true
    || receipt.llm_narrative_is_attribution_authority !== false
    || receipt.causal_claim_scope !== 'MATCHED_SINGLE_COMPONENT_ABLATION'
  ) throw new Error('rsi_attribution_receipt_policy_invalid');
  const checkedPlan = verifyRsiComponentAttributionPlan(plan);
  const canonical = createRsiComponentAblationReceipt({
    plan: checkedPlan,
    ablation_id: receipt.ablation_id,
    ablated_candidate_sha: receipt.ablated_candidate_sha,
    full_candidate_hard_invariants: receipt.full_candidate_hard_invariants,
    ablated_candidate_hard_invariants: receipt.ablated_candidate_hard_invariants,
    objectives: receipt.objective_effects.map((row) => ({
      metric: row.metric,
      full_candidate_value: row.full_candidate_value,
      ablated_candidate_value: row.ablated_candidate_value,
    })),
    evidence_refs: receipt.evidence_refs,
    external_evaluator: true,
    authored_by_candidate: false,
  });
  if (canonical.receipt_digest !== exactDigest(receipt.receipt_digest, 'receipt')) throw new Error('rsi_attribution_receipt_digest_mismatch');
  return canonical;
}

export function finalizeRsiComponentAttribution({ plan, receipts } = {}) {
  const checked = verifyRsiComponentAttributionPlan(plan);
  if (!Array.isArray(receipts) || receipts.length !== checked.components.length) throw new Error('rsi_attribution_receipt_set_incomplete');
  const byAblation = new Map();
  for (const receipt of receipts) {
    const row = verifyRsiComponentAblationReceipt(receipt, checked);
    if (byAblation.has(row.ablation_id)) throw new Error('rsi_attribution_receipt_duplicate');
    byAblation.set(row.ablation_id, row);
  }
  const records = checked.components.map((component) => {
    const receipt = byAblation.get(component.ablation_id);
    if (!receipt) throw new Error('rsi_attribution_receipt_missing');
    const core = {
      schema: RSI_COMPONENT_ATTRIBUTION_RECORD_SCHEMA,
      version: 1,
      candidate_id: checked.candidate_id,
      candidate_sha: checked.candidate_sha,
      parent_sha: checked.parent_sha,
      mutation_surface: checked.mutation_surface,
      component_path: component.path,
      component_digest: component.digest,
      component_change: component.change,
      ablation_id: component.ablation_id,
      ablated_candidate_sha: receipt.ablated_candidate_sha,
      classification: receipt.classification,
      safety_critical_invariants: [...receipt.safety_critical_invariants],
      objective_effects: structuredClone(receipt.objective_effects),
      interaction_resolution_required: receipt.interaction_resolution_required,
      receipt_digest: receipt.receipt_digest,
      workload_digest: checked.workload_digest,
      holdout_digest: checked.holdout_digest,
      environment_fingerprint: checked.environment_fingerprint,
      paired_seed_schedule_digest: checked.paired_seed_schedule_digest,
      externally_attributed: true,
      authored_by_candidate: false,
      freeform_narrative_in_memory: false,
      causal_claim_scope: 'MATCHED_SINGLE_COMPONENT_ABLATION',
      execution_authority: false,
      production_mutation_authority: false,
      promotion_authority: false,
      self_update_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    };
    return Object.freeze({ ...core, attribution_digest: digest(core) });
  });
  const summary = Object.freeze(Object.fromEntries(
    ['SAFETY_CRITICAL','CONTRIBUTING','HARMFUL','TRADEOFF_INTERACTION','NO_MATERIAL_EFFECT']
      .map((classification) => [classification, records.filter((row) => row.classification === classification).length]),
  ));
  const core = {
    schema: RSI_COMPONENT_ATTRIBUTION_RESULT_SCHEMA,
    version: 1,
    plan_id: checked.plan_id,
    plan_digest: checked.plan_digest,
    candidate_id: checked.candidate_id,
    candidate_sha: checked.candidate_sha,
    parent_sha: checked.parent_sha,
    mutation_surface: checked.mutation_surface,
    records,
    classification_counts: summary,
    all_changed_components_attributed: true,
    candidate_authored_attribution_count: 0,
    interaction_claims_resolved: records.every((row) => row.interaction_resolution_required === false),
    attribution_is_promotion_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, result_digest: digest(core) });
}

export function verifyRsiComponentAttributionRecord(record) {
  if (!plainObject(record) || record.schema !== RSI_COMPONENT_ATTRIBUTION_RECORD_SCHEMA || record.version !== 1) throw new Error('rsi_attribution_record_invalid');
  assertZeroAuthority(record, 'record');
  if (
    record.externally_attributed !== true
    || record.authored_by_candidate !== false
    || record.freeform_narrative_in_memory !== false
    || record.causal_claim_scope !== 'MATCHED_SINGLE_COMPONENT_ABLATION'
  ) throw new Error('rsi_attribution_record_policy_invalid');
  exactCandidateId(record.candidate_id, 'record');
  exactSha(record.candidate_sha, 'record_candidate');
  exactSha(record.parent_sha, 'record_parent');
  boundedPath(record.component_path, 'record_component');
  exactDigest(record.component_digest, 'record_component');
  exactDigest(record.receipt_digest, 'record_receipt');
  exactDigest(record.workload_digest, 'record_workload');
  exactDigest(record.holdout_digest, 'record_holdout');
  exactDigest(record.paired_seed_schedule_digest, 'record_seed_schedule');
  const clone = structuredClone(record);
  delete clone.attribution_digest;
  if (exactDigest(record.attribution_digest, 'record') !== digest(clone)) throw new Error('rsi_attribution_record_digest_mismatch');
  return record;
}

export function rsiComponentAttributionTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.component-attribution-root.v1',
    version: 1,
    policy_path: 'apps/metaengine-browser/src/rsi-component-attribution.mjs',
    attribution_scope: 'ALL_CHANGED_COMPONENTS',
    max_components: MAX_COMPONENTS,
    hard_invariants: [...HARD_INVARIANTS],
    paired_ablation_required: true,
    exact_same_workload_required: true,
    exact_same_holdout_required: true,
    exact_same_seed_schedule_required: true,
    exact_same_environment_required: true,
    candidate_can_select_component: false,
    candidate_can_author_attribution: false,
    llm_narrative_is_attribution_authority: false,
    interaction_claims_require_separate_evidence: true,
    attribution_is_promotion_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, attribution_root_digest: digest(root) });
}
