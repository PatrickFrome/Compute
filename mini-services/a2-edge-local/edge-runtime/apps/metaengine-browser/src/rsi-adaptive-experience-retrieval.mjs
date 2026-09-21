import crypto from 'node:crypto';

import {
  verifyRsiGroupExperiencePool,
  verifyRsiGroupTransferPlan,
  verifyRsiGroupTransferResult,
} from './rsi-group-experience-exchange.mjs';

export const RSI_RETRIEVAL_POLICY_STATE_SCHEMA = 'metaengine.rsi.retrieval-policy-state.v1';
export const RSI_MEMORY_DIAGNOSTIC_SCHEMA = 'metaengine.rsi.memory-diagnostic.v1';
export const RSI_ADAPTIVE_RETRIEVAL_PLAN_SCHEMA = 'metaengine.rsi.adaptive-retrieval-plan.v1';
export const RSI_RETRIEVAL_FEEDBACK_SCHEMA = 'metaengine.rsi.retrieval-feedback.v1';

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE = /^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const MAX_ARMS = 8;
const MAX_DIAGNOSTICS = 16;
const MAX_ITEMS = 8;
const MAX_PER_SOURCE = 2;
const MAX_EVIDENCE_REFS = 32;

const POLICY_IDS = Object.freeze([
  'FAILURE_FIRST',
  'ATTRIBUTION_FIRST',
  'CROSS_MODEL_TRANSFER',
  'SAME_CONTEXT',
  'DIVERSITY_BALANCED',
]);

const DIAGNOSTIC_CODES = Object.freeze([
  'FAILURE_RECURRENCE',
  'CREDIT_ASSIGNMENT_UNCERTAIN',
  'CROSS_MODEL_SUCCESS',
  'NEGATIVE_TRANSFER_CLUSTER',
  'DIVERSE_SOURCES_HELPED',
  'STALE_MEMORY_RISK',
]);

const DIAGNOSTIC_POLICY_BIAS = Object.freeze({
  FAILURE_RECURRENCE: 'FAILURE_FIRST',
  CREDIT_ASSIGNMENT_UNCERTAIN: 'ATTRIBUTION_FIRST',
  CROSS_MODEL_SUCCESS: 'CROSS_MODEL_TRANSFER',
  NEGATIVE_TRANSFER_CLUSTER: 'SAME_CONTEXT',
  DIVERSE_SOURCES_HELPED: 'DIVERSITY_BALANCED',
  STALE_MEMORY_RISK: 'DIVERSITY_BALANCED',
});

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
  if (!SHA256_RE.test(out)) throw new Error(`rsi_retrieval_${label}_digest_invalid`);
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_retrieval_${label}_invalid`);
  return out;
}

function boundedToken(value, label) {
  const out = String(value || '').trim().toUpperCase();
  if (!SAFE_TOKEN_RE.test(out)) throw new Error(`rsi_retrieval_${label}_invalid`);
  return out;
}

function nonNegativeInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 0 || out > max) throw new Error(`rsi_retrieval_${label}_invalid`);
  return out;
}

function positiveInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > max) throw new Error(`rsi_retrieval_${label}_invalid`);
  return out;
}

function normalizeTags(value, label) {
  if (!Array.isArray(value) || value.length > 24) throw new Error(`rsi_retrieval_${label}_invalid`);
  const seen = new Set();
  for (const raw of value) {
    const token = boundedToken(raw, label);
    if (seen.has(token)) throw new Error(`rsi_retrieval_${label}_duplicate`);
    seen.add(token);
  }
  return [...seen].sort();
}

function evidenceRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EVIDENCE_REFS) throw new Error('rsi_retrieval_evidence_refs_invalid');
  const seen = new Set();
  return value.map((raw) => {
    const ref = boundedId(raw, 'evidence_ref');
    if (seen.has(ref)) throw new Error('rsi_retrieval_evidence_ref_duplicate');
    seen.add(ref);
    return ref;
  }).sort();
}

function assertZeroAuthority(value, label) {
  for (const field of ['execution_authority', 'production_mutation_authority', 'promotion_authority', 'self_update_authority', 'authority_effect']) {
    if (value?.[field] !== false) throw new Error(`rsi_retrieval_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_retrieval_${label}_automatic_retry_invalid`);
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

function normalizePolicyId(value) {
  const out = boundedToken(value, 'policy_id');
  if (!POLICY_IDS.includes(out)) throw new Error('rsi_retrieval_policy_id_invalid');
  return out;
}

function normalizeArm(row) {
  if (!plainObject(row) || row.external_metrics_verified !== true || row.authored_by_candidate !== false) {
    throw new Error('rsi_retrieval_arm_external_metrics_required');
  }
  const policyId = normalizePolicyId(row.policy_id);
  const attempts = nonNegativeInt(row.attempts, 'arm_attempts', 1_000_000);
  const useful = nonNegativeInt(row.useful_episodes, 'arm_useful', attempts);
  const harmful = nonNegativeInt(row.harmful_episodes, 'arm_harmful', attempts);
  if (useful + harmful > attempts) throw new Error('rsi_retrieval_arm_counts_invalid');
  const neutral = attempts - useful - harmful;
  return Object.freeze({
    policy_id: policyId,
    attempts,
    useful_episodes: useful,
    harmful_episodes: harmful,
    neutral_episodes: neutral,
    posterior_alpha: 1 + useful,
    posterior_beta: 1 + harmful + 0.25 * neutral,
    external_metrics_verified: true,
    authored_by_candidate: false,
  });
}

export function createRsiRetrievalPolicyState({
  state_id,
  arms,
  update_seq = 1,
} = {}) {
  if (!Array.isArray(arms) || arms.length < 1 || arms.length > MAX_ARMS) throw new Error('rsi_retrieval_arms_invalid');
  const normalized = arms.map(normalizeArm);
  const ids = new Set();
  for (const arm of normalized) {
    if (ids.has(arm.policy_id)) throw new Error('rsi_retrieval_arm_duplicate');
    ids.add(arm.policy_id);
  }
  const core = {
    schema: RSI_RETRIEVAL_POLICY_STATE_SCHEMA,
    version: 1,
    state_id: boundedId(state_id, 'state_id'),
    update_seq: positiveInt(update_seq, 'update_seq', 1_000_000),
    arms: normalized.sort((a, b) => a.policy_id.localeCompare(b.policy_id)),
    posterior_family: 'BETA_BERNOULLI_WITH_NEUTRAL_QUARTER_FAILURE',
    selection_rule: 'SEEDED_THOMPSON_SAMPLING',
    exact_replay_seed_required: true,
    external_metrics_only: true,
    candidate_can_edit_statistics: false,
    candidate_can_select_policy: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, state_digest: digest(core) });
}

export function verifyRsiRetrievalPolicyState(state) {
  if (!plainObject(state) || state.schema !== RSI_RETRIEVAL_POLICY_STATE_SCHEMA || state.version !== 1) throw new Error('rsi_retrieval_state_invalid');
  assertZeroAuthority(state, 'state');
  if (
    state.posterior_family !== 'BETA_BERNOULLI_WITH_NEUTRAL_QUARTER_FAILURE'
    || state.selection_rule !== 'SEEDED_THOMPSON_SAMPLING'
    || state.exact_replay_seed_required !== true
    || state.external_metrics_only !== true
    || state.candidate_can_edit_statistics !== false
    || state.candidate_can_select_policy !== false
  ) throw new Error('rsi_retrieval_state_policy_invalid');
  const canonical = createRsiRetrievalPolicyState({
    state_id: state.state_id,
    arms: state.arms,
    update_seq: state.update_seq,
  });
  if (canonical.state_digest !== exactDigest(state.state_digest, 'state')) throw new Error('rsi_retrieval_state_digest_mismatch');
  return canonical;
}

export function createRsiMemoryDiagnostic({
  diagnostic_id,
  code,
  context_tags = [],
  evidence_digest,
  evidence_refs,
  external_diagnostician = false,
  authored_by_candidate = true,
} = {}) {
  if (external_diagnostician !== true || authored_by_candidate !== false) throw new Error('rsi_retrieval_diagnostic_external_origin_required');
  const normalizedCode = boundedToken(code, 'diagnostic_code');
  if (!DIAGNOSTIC_CODES.includes(normalizedCode)) throw new Error('rsi_retrieval_diagnostic_code_invalid');
  const core = {
    schema: RSI_MEMORY_DIAGNOSTIC_SCHEMA,
    version: 1,
    diagnostic_id: boundedId(diagnostic_id, 'diagnostic_id'),
    code: normalizedCode,
    context_tags: normalizeTags(context_tags, 'diagnostic_tag'),
    evidence_digest: exactDigest(evidence_digest, 'diagnostic_evidence'),
    evidence_refs: evidenceRefs(evidence_refs),
    external_diagnostician: true,
    authored_by_candidate: false,
    freeform_reflection_trusted: false,
    raw_model_transcript_present: false,
    diagnostic_is_routing_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, diagnostic_digest: digest(core) });
}

export function verifyRsiMemoryDiagnostic(row) {
  if (!plainObject(row) || row.schema !== RSI_MEMORY_DIAGNOSTIC_SCHEMA || row.version !== 1) throw new Error('rsi_retrieval_diagnostic_invalid');
  assertZeroAuthority(row, 'diagnostic');
  if (
    row.external_diagnostician !== true
    || row.authored_by_candidate !== false
    || row.freeform_reflection_trusted !== false
    || row.raw_model_transcript_present !== false
    || row.diagnostic_is_routing_authority !== false
  ) throw new Error('rsi_retrieval_diagnostic_policy_invalid');
  const canonical = createRsiMemoryDiagnostic({
    diagnostic_id: row.diagnostic_id,
    code: row.code,
    context_tags: row.context_tags,
    evidence_digest: row.evidence_digest,
    evidence_refs: row.evidence_refs,
    external_diagnostician: true,
    authored_by_candidate: false,
  });
  if (canonical.diagnostic_digest !== exactDigest(row.diagnostic_digest, 'diagnostic')) throw new Error('rsi_retrieval_diagnostic_digest_mismatch');
  return canonical;
}

function seededRng(seedText) {
  const hex = crypto.createHash('sha256').update(seedText, 'utf8').digest('hex');
  let state = Number.parseInt(hex.slice(0, 8), 16) >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return (state + 1) / 4294967297;
  };
}

function sampleNormal(rng) {
  const u1 = Math.max(1e-12, rng());
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function sampleGamma(shape, rng) {
  if (!(shape > 0)) throw new Error('rsi_retrieval_gamma_shape_invalid');
  if (shape < 1) return sampleGamma(shape + 1, rng) * Math.pow(rng(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const x = sampleNormal(rng);
    let v = 1 + c * x;
    if (v <= 0) continue;
    v *= v * v;
    const u = rng();
    if (u < 1 - 0.0331 * (x ** 4)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
  throw new Error('rsi_retrieval_gamma_sampling_failed');
}

function sampleBeta(alpha, beta, seed) {
  const rng = seededRng(seed);
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  return x / (x + y);
}

function diagnosticBias(policyId, diagnostics) {
  let bias = 0;
  for (const row of diagnostics) {
    if (DIAGNOSTIC_POLICY_BIAS[row.code] === policyId) bias += 0.03;
  }
  return Math.min(0.12, bias);
}

function resolvePortableItems(pool, transferResult) {
  const itemById = new Map(pool.items.map((item) => [item.item_id, item]));
  return transferResult.records
    .filter((record) => record.portable_for_target_search === true)
    .map((record) => {
      const item = itemById.get(record.item_id);
      if (!item || item.item_digest !== record.item_digest) throw new Error('rsi_retrieval_transfer_item_binding_mismatch');
      return Object.freeze({ record, item });
    });
}

function policyRank(policyId, row, targetTags) {
  const { record, item } = row;
  let score = 0;
  switch (policyId) {
    case 'FAILURE_FIRST':
      score += item.kind === 'FAILURE_LESSON' ? 20 : 0;
      break;
    case 'ATTRIBUTION_FIRST':
      score += item.kind === 'COMPONENT_ATTRIBUTION' ? 20 : 0;
      break;
    case 'CROSS_MODEL_TRANSFER':
      score += record.cross_model_transfer === true ? 20 : 0;
      break;
    case 'SAME_CONTEXT':
      score += record.cross_model_transfer === false ? 10 : 0;
      score += record.cross_environment_transfer === false ? 10 : 0;
      break;
    case 'DIVERSITY_BALANCED':
      score += 5;
      break;
    default:
      break;
  }
  for (const tag of item.mechanism_tags || []) if (targetTags.has(tag)) score += 4;
  for (const family of item.challenge_families || []) if (targetTags.has(family)) score += 4;
  if (item.classification === 'SAFETY_CRITICAL') score += 6;
  if (item.classification === 'CONTRIBUTING') score += 5;
  if (item.classification === 'HARMFUL') score += 4;
  return score;
}

function tie(seed, itemId) {
  return crypto.createHash('sha256').update(`${seed}:${itemId}`, 'utf8').digest('hex');
}

export function createRsiAdaptiveRetrievalPlan({
  policy_state,
  pool,
  transfer_plan,
  transfer_result,
  diagnostics = [],
  episode_id,
  max_items = 4,
} = {}) {
  const state = verifyRsiRetrievalPolicyState(policy_state);
  const checkedPool = verifyRsiGroupExperiencePool(pool);
  const checkedTransferPlan = verifyRsiGroupTransferPlan(transfer_plan, checkedPool);
  const checkedTransferResult = verifyRsiGroupTransferResult(transfer_result, checkedTransferPlan, checkedPool);
  if (!Array.isArray(diagnostics) || diagnostics.length > MAX_DIAGNOSTICS) throw new Error('rsi_retrieval_diagnostics_invalid');
  const checkedDiagnostics = diagnostics.map(verifyRsiMemoryDiagnostic);
  const episodeId = boundedId(episode_id, 'episode_id');
  const limit = positiveInt(max_items, 'max_items', MAX_ITEMS);

  const seed = digest({
    state_digest: state.state_digest,
    transfer_result_digest: checkedTransferResult.result_digest,
    episode_id: episodeId,
    diagnostics: checkedDiagnostics.map((row) => row.diagnostic_digest),
  });
  const sampledArms = state.arms.map((arm) => {
    const sampled = sampleBeta(
      arm.posterior_alpha,
      arm.posterior_beta,
      `${seed}:${arm.policy_id}`,
    );
    const bias = diagnosticBias(arm.policy_id, checkedDiagnostics);
    return Object.freeze({
      policy_id: arm.policy_id,
      posterior_sample: sampled,
      diagnostic_bias: bias,
      selection_score: sampled + bias,
      attempts: arm.attempts,
    });
  }).sort((a, b) => b.selection_score - a.selection_score || a.policy_id.localeCompare(b.policy_id));

  const selectedArm = sampledArms[0];
  if (!selectedArm) throw new Error('rsi_retrieval_policy_selection_failed');
  const portable = resolvePortableItems(checkedPool, checkedTransferResult);
  if (portable.length < 1) throw new Error('rsi_retrieval_no_verified_transfer_memory');

  const targetTags = new Set([
    ...(checkedTransferPlan.target.context_tags || []),
    ...checkedDiagnostics.flatMap((row) => row.context_tags),
  ]);
  const ranked = portable
    .map((row) => ({
      ...row,
      score: policyRank(selectedArm.policy_id, row, targetTags),
    }))
    .sort((a, b) => b.score - a.score || tie(seed, a.item.item_id).localeCompare(tie(seed, b.item.item_id)));

  const selected = [];
  const perSource = new Map();
  if (selectedArm.policy_id === 'DIVERSITY_BALANCED') {
    for (const sourceId of [...new Set(ranked.map((row) => row.item.source_member_id))]) {
      if (selected.length >= limit) break;
      const row = ranked.find((candidate) => candidate.item.source_member_id === sourceId);
      if (!row) continue;
      selected.push(row);
      perSource.set(sourceId, 1);
    }
  }
  for (const row of ranked) {
    if (selected.length >= limit) break;
    if (selected.some((existing) => existing.item.item_id === row.item.item_id)) continue;
    const count = perSource.get(row.item.source_member_id) || 0;
    if (count >= MAX_PER_SOURCE) continue;
    selected.push(row);
    perSource.set(row.item.source_member_id, count + 1);
  }

  const selectedItems = selected.map((row) => Object.freeze({
    item_id: row.item.item_id,
    item_digest: row.item.item_digest,
    source_member_id: row.item.source_member_id,
    kind: row.item.kind,
    classification: row.item.classification,
    source_model_family: row.item.source_model_family,
    source_environment_family: row.item.source_environment_family,
    cross_model_transfer: row.record.cross_model_transfer,
    cross_environment_transfer: row.record.cross_environment_transfer,
    transfer_receipt_digest: row.record.receipt_digest,
    target_holdout_digest: row.record.target_holdout_digest,
    relevance_score: row.score,
    retrieval_state: 'VERIFIED_TRANSFER_ONLY',
    candidate_can_promote_memory: false,
    candidate_can_include_unverified_memory: false,
  }));

  const core = {
    schema: RSI_ADAPTIVE_RETRIEVAL_PLAN_SCHEMA,
    version: 1,
    episode_id: episodeId,
    state_id: state.state_id,
    state_digest: state.state_digest,
    state_update_seq: state.update_seq,
    pool_digest: checkedPool.pool_digest,
    transfer_plan_digest: checkedTransferPlan.plan_digest,
    transfer_result_digest: checkedTransferResult.result_digest,
    selected_policy_id: selectedArm.policy_id,
    sampled_arms: sampledArms,
    diagnostics: checkedDiagnostics.map((row) => Object.freeze({
      diagnostic_id: row.diagnostic_id,
      diagnostic_digest: row.diagnostic_digest,
      code: row.code,
      context_tags: [...row.context_tags],
    })),
    selected_items: selectedItems,
    selected_item_count: selectedItems.length,
    max_items: limit,
    max_items_per_source: MAX_PER_SOURCE,
    fast_timescale_policy_learning: true,
    slow_timescale_structured_diagnostics: true,
    thompson_sampling_seed_digest: seed,
    verified_transfer_memory_only: true,
    negative_transfer_memory_not_injected_as_positive_context: true,
    freeform_reflection_trusted: false,
    candidate_can_select_policy: false,
    candidate_can_override_retrieval: false,
    candidate_can_include_unverified_memory: false,
    retrieval_is_evaluation_authority: false,
    retrieval_is_promotion_authority: false,
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
    plan_id: `rsi_retrieval_${planDigest.slice('sha256:'.length, 'sha256:'.length + 24)}`,
    plan_digest: planDigest,
  });
}

export function verifyRsiAdaptiveRetrievalPlan(plan) {
  if (!plainObject(plan) || plan.schema !== RSI_ADAPTIVE_RETRIEVAL_PLAN_SCHEMA || plan.version !== 1) throw new Error('rsi_retrieval_plan_invalid');
  assertZeroAuthority(plan, 'plan');
  if (
    plan.fast_timescale_policy_learning !== true
    || plan.slow_timescale_structured_diagnostics !== true
    || plan.verified_transfer_memory_only !== true
    || plan.negative_transfer_memory_not_injected_as_positive_context !== true
    || plan.freeform_reflection_trusted !== false
    || plan.candidate_can_select_policy !== false
    || plan.candidate_can_override_retrieval !== false
    || plan.candidate_can_include_unverified_memory !== false
    || plan.retrieval_is_evaluation_authority !== false
    || plan.retrieval_is_promotion_authority !== false
  ) throw new Error('rsi_retrieval_plan_policy_invalid');
  normalizePolicyId(plan.selected_policy_id);
  exactDigest(plan.state_digest, 'plan_state');
  exactDigest(plan.pool_digest, 'plan_pool');
  exactDigest(plan.transfer_plan_digest, 'plan_transfer');
  exactDigest(plan.transfer_result_digest, 'plan_transfer_result');
  exactDigest(plan.thompson_sampling_seed_digest, 'plan_seed');
  if (!Array.isArray(plan.selected_items) || plan.selected_items.length < 1 || plan.selected_items.length > MAX_ITEMS) throw new Error('rsi_retrieval_plan_items_invalid');
  for (const row of plan.selected_items) {
    if (
      row.retrieval_state !== 'VERIFIED_TRANSFER_ONLY'
      || row.candidate_can_promote_memory !== false
      || row.candidate_can_include_unverified_memory !== false
    ) throw new Error('rsi_retrieval_plan_item_policy_invalid');
    exactDigest(row.item_digest, 'plan_item');
    exactDigest(row.transfer_receipt_digest, 'plan_item_receipt');
    exactDigest(row.target_holdout_digest, 'plan_item_holdout');
  }
  const clone = structuredClone(plan);
  delete clone.plan_id;
  delete clone.plan_digest;
  const expected = digest(clone);
  if (plan.plan_digest !== expected || plan.plan_id !== `rsi_retrieval_${expected.slice('sha256:'.length, 'sha256:'.length + 24)}`) throw new Error('rsi_retrieval_plan_digest_mismatch');
  return plan;
}

export function createRsiRetrievalFeedback({
  plan,
  useful_retrieval,
  harmful_regression,
  evidence_digest,
  evidence_refs,
  external_evaluator = false,
  authored_by_candidate = true,
} = {}) {
  const checked = verifyRsiAdaptiveRetrievalPlan(plan);
  if (external_evaluator !== true || authored_by_candidate !== false) throw new Error('rsi_retrieval_feedback_external_origin_required');
  const useful = useful_retrieval === true;
  const harmful = harmful_regression === true;
  if (useful && harmful) throw new Error('rsi_retrieval_feedback_contradictory');
  const core = {
    schema: RSI_RETRIEVAL_FEEDBACK_SCHEMA,
    version: 1,
    plan_id: checked.plan_id,
    plan_digest: checked.plan_digest,
    state_id: checked.state_id,
    state_digest: checked.state_digest,
    state_update_seq: checked.state_update_seq,
    selected_policy_id: checked.selected_policy_id,
    useful_retrieval: useful,
    harmful_regression: harmful,
    neutral_episode: !useful && !harmful,
    evidence_digest: exactDigest(evidence_digest, 'feedback_evidence'),
    evidence_refs: evidenceRefs(evidence_refs),
    external_evaluator: true,
    authored_by_candidate: false,
    candidate_can_edit_bandit_state: false,
    feedback_is_evaluation_authority: false,
    feedback_is_promotion_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, feedback_digest: digest(core) });
}

export function applyRsiRetrievalFeedback({ state, feedback } = {}) {
  const checkedState = verifyRsiRetrievalPolicyState(state);
  if (!plainObject(feedback) || feedback.schema !== RSI_RETRIEVAL_FEEDBACK_SCHEMA || feedback.version !== 1) throw new Error('rsi_retrieval_feedback_invalid');
  assertZeroAuthority(feedback, 'feedback');
  if (
    feedback.state_id !== checkedState.state_id
    || feedback.state_digest !== checkedState.state_digest
    || feedback.state_update_seq !== checkedState.update_seq
    || feedback.external_evaluator !== true
    || feedback.authored_by_candidate !== false
    || feedback.candidate_can_edit_bandit_state !== false
    || feedback.feedback_is_evaluation_authority !== false
    || feedback.feedback_is_promotion_authority !== false
  ) throw new Error('rsi_retrieval_feedback_policy_invalid');
  const clone = structuredClone(feedback);
  delete clone.feedback_digest;
  if (exactDigest(feedback.feedback_digest, 'feedback') !== digest(clone)) throw new Error('rsi_retrieval_feedback_digest_mismatch');
  const selectedPolicy = normalizePolicyId(feedback.selected_policy_id);
  if (!checkedState.arms.some((arm) => arm.policy_id === selectedPolicy)) throw new Error('rsi_retrieval_feedback_policy_missing');

  const arms = checkedState.arms.map((arm) => {
    if (arm.policy_id !== selectedPolicy) return {
      policy_id: arm.policy_id,
      attempts: arm.attempts,
      useful_episodes: arm.useful_episodes,
      harmful_episodes: arm.harmful_episodes,
      external_metrics_verified: true,
      authored_by_candidate: false,
    };
    return {
      policy_id: arm.policy_id,
      attempts: arm.attempts + 1,
      useful_episodes: arm.useful_episodes + (feedback.useful_retrieval === true ? 1 : 0),
      harmful_episodes: arm.harmful_episodes + (feedback.harmful_regression === true ? 1 : 0),
      external_metrics_verified: true,
      authored_by_candidate: false,
    };
  });
  return createRsiRetrievalPolicyState({
    state_id: checkedState.state_id,
    arms,
    update_seq: checkedState.update_seq + 1,
  });
}

export function rsiAdaptiveRetrievalTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.adaptive-retrieval-root.v1',
    version: 1,
    policy_path: 'apps/metaengine-browser/src/rsi-adaptive-experience-retrieval.mjs',
    policy_ids: [...POLICY_IDS],
    diagnostic_codes: [...DIAGNOSTIC_CODES],
    fast_timescale_policy_learning: true,
    slow_timescale_structured_diagnostics: true,
    selection_rule: 'SEEDED_THOMPSON_SAMPLING',
    exact_replay_seed_required: true,
    verified_transfer_memory_only: true,
    external_metrics_only: true,
    candidate_can_edit_statistics: false,
    candidate_can_select_policy: false,
    candidate_can_author_diagnostics: false,
    candidate_can_include_unverified_memory: false,
    freeform_reflection_trusted: false,
    retrieval_is_evaluation_authority: false,
    retrieval_is_promotion_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, retrieval_root_digest: digest(root) });
}
