import crypto from 'node:crypto';

import {
  createRsiExperienceGraphQuery,
  retrieveRsiExperienceGraph,
  verifyRsiExperienceGraphSnapshot,
  verifyRsiExperienceGraphRetrieval,
} from './rsi-experience-graph.mjs';
import {
  createRsiBoundedMemoryUtilityState,
  verifyRsiBoundedMemoryUtilityState,
  rsiBoundedMemoryUtilityTrustRootSnapshot,
} from './rsi-bounded-memory-utility-state.mjs';

export const RSI_EXPERIENCE_CONTEXT_PLAN_SCHEMA = 'metaengine.rsi.experience-context-plan.v1';
export const RSI_EXPERIENCE_CONTEXT_ROOT_SCHEMA = 'metaengine.rsi.experience-context-root.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_PREFIXED_RE = /^sha256:[0-9a-f]{64}$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE = /^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const MAX_BRIDGE_CASES = 16;
const MAX_SELECTED_CASES = 12;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function hexDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}

function digest(value) {
  return `sha256:${hexDigest(value)}`;
}

function zeroAuthority(extra = {}) {
  return Object.freeze({
    ...extra,
    execution_authority: false,
    browser_authority: false,
    scheduler_authority: false,
    task_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function assertZeroAuthority(value, label) {
  for (const key of [
    'execution_authority',
    'browser_authority',
    'scheduler_authority',
    'task_authority',
    'production_mutation_authority',
    'promotion_authority',
    'self_update_authority',
    'authority_effect',
  ]) {
    if (Object.hasOwn(value || {}, key) && value[key] !== false) {
      throw new Error(`rsi_context_${label}_${key}_invalid`);
    }
  }
  if (Object.hasOwn(value || {}, 'automatic_retry_allowed') && value.automatic_retry_allowed !== false) {
    throw new Error(`rsi_context_${label}_retry_invalid`);
  }
}

function exactSha(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA40_RE.test(out)) throw new Error(`rsi_context_${label}_sha_invalid`);
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_context_${label}_invalid`);
  return out;
}

function token(value, label) {
  const out = String(value || '').trim().toUpperCase();
  if (!SAFE_TOKEN_RE.test(out)) throw new Error(`rsi_context_${label}_invalid`);
  return out;
}

function prefixedDigest(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (SHA256_PREFIXED_RE.test(out)) return out;
  if (SHA256_HEX_RE.test(out)) return `sha256:${out}`;
  throw new Error(`rsi_context_${label}_digest_invalid`);
}

function hexOnlyDigest(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (SHA256_HEX_RE.test(out)) return out;
  if (SHA256_PREFIXED_RE.test(out)) return out.slice(7);
  throw new Error(`rsi_context_${label}_digest_invalid`);
}

function normalizeBridgeCases(value) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > MAX_BRIDGE_CASES) throw new Error('rsi_context_bridge_case_ids_invalid');
  const out = value.map((row) => boundedId(row, 'bridge_case_id')).sort();
  if (new Set(out).size !== out.length) throw new Error('rsi_context_bridge_case_id_duplicate');
  return Object.freeze(out);
}

function verifyFrontierEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('rsi_context_frontier_entry_invalid');
  assertZeroAuthority(entry, 'frontier_entry');
  const opportunityId = boundedId(entry.opportunity_id, 'opportunity_id');
  const signal = token(entry.signal, 'signal');
  const priority = token(entry.priority, 'priority');
  const mutationSurface = token(entry.mutation_surface, 'mutation_surface');
  const observationDigest = hexOnlyDigest(entry.observation_digest, 'observation');
  const hypothesis = entry.hypothesis;
  const plan = entry.plan;
  if (!hypothesis || typeof hypothesis !== 'object' || Array.isArray(hypothesis)) throw new Error('rsi_context_hypothesis_invalid');
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('rsi_context_plan_invalid');
  assertZeroAuthority(hypothesis, 'hypothesis');
  assertZeroAuthority(plan, 'experiment_plan');
  if (hypothesis.opportunity_id !== opportunityId) throw new Error('rsi_context_hypothesis_opportunity_mismatch');
  if (String(hypothesis.signal || '').toUpperCase() !== signal) throw new Error('rsi_context_hypothesis_signal_mismatch');
  if (String(hypothesis.mutation_surface || '').toUpperCase() !== mutationSurface) throw new Error('rsi_context_hypothesis_surface_mismatch');
  if (String(plan?.task_spec?.rsi?.opportunity_id || '') !== opportunityId) throw new Error('rsi_context_experiment_opportunity_mismatch');
  if (String(plan?.task_spec?.rsi?.mutation_surface || '').toUpperCase() !== mutationSurface) throw new Error('rsi_context_experiment_surface_mismatch');
  const sourceSha = exactSha(hypothesis.source_sha, 'hypothesis_source');
  if (exactSha(plan.source_sha, 'experiment_source') !== sourceSha) throw new Error('rsi_context_source_mismatch');
  const hypothesisDigest = prefixedDigest(hypothesis.hypothesis_digest, 'hypothesis');
  const planDigest = prefixedDigest(plan.plan_digest, 'experiment_plan');
  return Object.freeze({
    source_sha: sourceSha,
    opportunity_id: opportunityId,
    signal,
    priority,
    mutation_surface: mutationSurface,
    observation_digest: observationDigest,
    hypothesis_digest: hypothesisDigest,
    plan_digest: planDigest,
    experiment_id: boundedId(plan.experiment_id, 'experiment_id'),
    target_branch: boundedId(plan.target_branch, 'target_branch'),
  });
}

function selectedCaseSummary(item) {
  return Object.freeze({
    rank: item.rank,
    case_id: item.case_id,
    case_digest: item.case_digest,
    task_signature_digest: item.task_signature_digest,
    outcome: item.outcome,
    candidate_id: item.candidate_id,
    candidate_sha: item.candidate_sha,
    failure_codes: Object.freeze([...(item.failure_codes || [])]),
    mechanism_tags: Object.freeze([...(item.mechanism_tags || [])]),
    lesson_digests: Object.freeze([...(item.lesson_digests || [])]),
    exact_task_match: item.exact_task_match === true,
    corrective_trace_target: item.corrective_trace_target === true,
    graph_diffusion_score: item.graph_diffusion_score,
    contextual_utility: item.contextual_utility,
    ranking_score: item.ranking_score,
    source_context_truth_is_portable: false,
    external_transfer_validation_required: true,
    authority_effect: false,
  });
}

export function createRsiExperienceContextPlan({
  frontier_entry,
  experience_graph_snapshot = null,
  environment_fingerprint = 'metaengine.browser.runtime',
  model_family = 'METAENGINE_RSI',
  bridge_case_ids = [],
} = {}) {
  const frontier = verifyFrontierEntry(frontier_entry);
  const bridges = normalizeBridgeCases(bridge_case_ids);
  const environmentFingerprint = boundedId(environment_fingerprint, 'environment_fingerprint');
  const modelFamily = token(model_family, 'model_family');
  const targetContextDigest = digest({
    source_sha: frontier.source_sha,
    observation_digest: frontier.observation_digest,
    opportunity_id: frontier.opportunity_id,
    signal: frontier.signal,
    mutation_surface: frontier.mutation_surface,
    hypothesis_digest: frontier.hypothesis_digest,
    experiment_plan_digest: frontier.plan_digest,
    environment_fingerprint: environmentFingerprint,
    model_family: modelFamily,
  });
  const query = createRsiExperienceGraphQuery({
    query_id: `rsi_context_query_${targetContextDigest.slice(7, 31)}`,
    target_context_digest: targetContextDigest,
    task_signature_digest: frontier.plan_digest,
    challenge_family: frontier.mutation_surface,
    environment_fingerprint: environmentFingerprint,
    model_family: modelFamily,
    failure_codes: frontier.signal.includes('FAIL') || frontier.signal.includes('AMBIGUOUS')
      ? [frontier.signal]
      : [],
    mechanism_tags: [frontier.signal, frontier.mutation_surface].sort(),
    bridge_case_ids: bridges,
    external_query_context: true,
    authored_by_candidate: false,
  });

  let mode = 'NO_VERIFIED_EXPERIENCE';
  let graphSnapshotDigest = null;
  let retrievalDigest = null;
  let selectedCases = [];
  let boundedUtilityState = null;
  if (experience_graph_snapshot != null) {
    const snapshot = verifyRsiExperienceGraphSnapshot(experience_graph_snapshot);
    const retrieval = retrieveRsiExperienceGraph({ snapshot, query });
    verifyRsiExperienceGraphRetrieval(retrieval, snapshot, query);
    boundedUtilityState = createRsiBoundedMemoryUtilityState({
      experience_graph_snapshot: snapshot,
      query,
      retrieval,
    });
    verifyRsiBoundedMemoryUtilityState(boundedUtilityState, {
      experience_graph_snapshot: snapshot,
      query,
      retrieval,
    });
    mode = retrieval.item_count > 0 ? 'VERIFIED_EXPERIENCE_RETRIEVAL' : 'VERIFIED_GRAPH_NO_MATCH';
    graphSnapshotDigest = snapshot.snapshot_digest;
    retrievalDigest = retrieval.retrieval_digest;
    const boundedCaseCap = Math.min(MAX_SELECTED_CASES, boundedUtilityState.recommended_case_cap);
    selectedCases = retrieval.items.slice(0, boundedCaseCap).map(selectedCaseSummary);
  } else if (bridges.length > 0) {
    throw new Error('rsi_context_bridge_cases_require_experience_graph');
  }

  const core = zeroAuthority({
    schema: RSI_EXPERIENCE_CONTEXT_PLAN_SCHEMA,
    version: 1,
    mode,
    source_sha: frontier.source_sha,
    opportunity_id: frontier.opportunity_id,
    signal: frontier.signal,
    priority: frontier.priority,
    mutation_surface: frontier.mutation_surface,
    observation_digest: frontier.observation_digest,
    hypothesis_digest: frontier.hypothesis_digest,
    experiment_plan_digest: frontier.plan_digest,
    experiment_id: frontier.experiment_id,
    target_branch: frontier.target_branch,
    target_context_digest: targetContextDigest,
    query_digest: query.query_digest,
    graph_snapshot_digest: graphSnapshotDigest,
    retrieval_digest: retrievalDigest,
    bounded_memory_utility_state: boundedUtilityState,
    bounded_memory_utility_state_digest: boundedUtilityState?.state_digest || null,
    bounded_memory_utility_mode: boundedUtilityState?.mode || 'NO_GRAPH',
    selected_cases: Object.freeze(selectedCases),
    selected_case_count: selectedCases.length,
    max_selected_cases: MAX_SELECTED_CASES,
    bounded_memory_utility_root: rsiBoundedMemoryUtilityTrustRootSnapshot(),
    utility_state_controls_case_cap: true,
    harmful_dominant_case_cap: 4,
    evidence_sparse_case_cap: 6,
    utility_bounded_case_cap: boundedUtilityState?.recommended_case_cap || 0,
    utility_state_controls_case_cap: true,
    environment_fingerprint: environmentFingerprint,
    model_family: modelFamily,
    source_context_truth_is_portable: false,
    external_transfer_validation_required: true,
    retrieval_is_advisory_only: true,
    candidate_can_write_graph: false,
    candidate_can_select_retrieval_thresholds: false,
    candidate_can_mark_memory_portable: false,
    candidate_can_mutate_context_plan: false,
    no_verified_experience_is_explicit: true,
    raw_trajectory_exposed: false,
    raw_page_text_exposed: false,
    raw_user_input_exposed: false,
    secret_material_exposed: false,
    second_scheduler: false,
  });
  const contextPlanDigest = digest(core);
  return Object.freeze({
    ...core,
    context_plan_digest: contextPlanDigest,
    search_context_digest: contextPlanDigest.slice(7),
  });
}

export function verifyRsiExperienceContextPlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || plan.schema !== RSI_EXPERIENCE_CONTEXT_PLAN_SCHEMA || plan.version !== 1) {
    throw new Error('rsi_context_plan_schema_invalid');
  }
  assertZeroAuthority(plan, 'context_plan');
  if (
    plan.source_context_truth_is_portable !== false
    || plan.external_transfer_validation_required !== true
    || plan.retrieval_is_advisory_only !== true
    || plan.candidate_can_write_graph !== false
    || plan.candidate_can_select_retrieval_thresholds !== false
    || plan.candidate_can_mark_memory_portable !== false
    || plan.candidate_can_mutate_context_plan !== false
    || plan.utility_state_controls_case_cap !== true
    || plan.no_verified_experience_is_explicit !== true
    || plan.raw_trajectory_exposed !== false
    || plan.raw_page_text_exposed !== false
    || plan.raw_user_input_exposed !== false
    || plan.secret_material_exposed !== false
    || plan.second_scheduler !== false
  ) throw new Error('rsi_context_plan_policy_invalid');
  if (!['NO_VERIFIED_EXPERIENCE','VERIFIED_EXPERIENCE_RETRIEVAL','VERIFIED_GRAPH_NO_MATCH'].includes(plan.mode)) {
    throw new Error('rsi_context_plan_mode_invalid');
  }
  if (!Array.isArray(plan.selected_cases) || plan.selected_cases.length > MAX_SELECTED_CASES || plan.selected_case_count !== plan.selected_cases.length) {
    throw new Error('rsi_context_plan_selected_cases_invalid');
  }
  if (plan.graph_snapshot_digest == null) {
    if (
      plan.bounded_memory_utility_state !== null
      || plan.bounded_memory_utility_state_digest !== null
      || plan.bounded_memory_utility_mode !== 'NO_GRAPH'
      || plan.utility_bounded_case_cap !== 0
    ) throw new Error('rsi_context_bounded_utility_state_without_graph');
  } else {
    if (!plan.bounded_memory_utility_state) throw new Error('rsi_context_bounded_utility_state_missing');
    const state = verifyRsiBoundedMemoryUtilityState(plan.bounded_memory_utility_state);
    if (
      state.state_digest !== plan.bounded_memory_utility_state_digest
      || state.mode !== plan.bounded_memory_utility_mode
      || state.recommended_case_cap !== plan.utility_bounded_case_cap
      || plan.selected_case_count > state.recommended_case_cap
      || state.graph_snapshot_digest !== plan.graph_snapshot_digest
      || state.retrieval_digest !== plan.retrieval_digest
      || state.query_digest !== plan.query_digest
      || state.target_context_digest !== plan.target_context_digest
    ) throw new Error('rsi_context_bounded_utility_state_mismatch');
  }
  const material = { ...plan };
  delete material.context_plan_digest;
  delete material.search_context_digest;
  const expected = digest(material);
  if (expected !== prefixedDigest(plan.context_plan_digest, 'context_plan')) throw new Error('rsi_context_plan_digest_mismatch');
  if (expected.slice(7) !== hexOnlyDigest(plan.search_context_digest, 'search_context')) throw new Error('rsi_context_search_digest_mismatch');
  return plan;
}

export function rsiExperienceContextTrustRootSnapshot() {
  const root = zeroAuthority({
    schema: RSI_EXPERIENCE_CONTEXT_ROOT_SCHEMA,
    version: 1,
    policy_path: 'apps/metaengine-browser/src/rsi-experience-context-planner.mjs',
    verified_experience_graph_only: true,
    no_verified_experience_is_explicit: true,
    source_context_truth_is_portable: false,
    external_transfer_validation_required: true,
    retrieval_is_advisory_only: true,
    candidate_can_write_graph: false,
    candidate_can_select_retrieval_thresholds: false,
    candidate_can_mark_memory_portable: false,
    candidate_can_mutate_context_plan: false,
    max_bridge_cases: MAX_BRIDGE_CASES,
    max_selected_cases: MAX_SELECTED_CASES,
    raw_trajectory_exposed: false,
    page_model_text_authority: false,
    second_scheduler: false,
  });
  return Object.freeze({ ...root, context_root_digest: digest(root) });
}
