import crypto from 'node:crypto';

export const RSI_RECURSIVE_DEPTH_POLICY_SCHEMA = 'metaengine.rsi.recursive-depth-policy.v1';
export const RSI_RECURSIVE_DEPTH_LAYER_SCHEMA = 'metaengine.rsi.recursive-depth-layer.v1';
export const RSI_RECURSIVE_DEPTH_EVAL_SCHEMA = 'metaengine.rsi.recursive-depth-evaluation.v1';
export const RSI_RECURSIVE_DEPTH_CHAIN_SCHEMA = 'metaengine.rsi.recursive-depth-chain-result.v1';
export const RSI_RECURSIVE_DEPTH_ARCHIVE_SCHEMA = 'metaengine.rsi.recursive-depth-archive.v1';

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE = /^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const MAX_DEPTH = 32;
const MAX_CONTEXT_DIGESTS = 512;
const MAX_HELPERS = 64;
const MAX_EVIDENCE_REFS = 32;

const HELPER_KINDS = new Set([
  'STRATEGY_PREPROCESSOR',
  'VERIFIED_MEMORY_SELECTOR',
  'PLAN_TRANSFORM',
  'TRACE_SUMMARIZER',
  'LOCAL_VERIFIER',
  'PROPOSAL_HELPER',
]);

const FORBIDDEN_HELPER_CAPABILITIES = new Set([
  'DIRECT_TOOL_EXECUTION',
  'SHELL',
  'EVAL',
  'PROCESS',
  'NETWORK_AUTHORITY',
  'SCHEDULER_AUTHORITY',
  'PROMOTION_AUTHORITY',
  'SELF_UPDATE_AUTHORITY',
  'SIGNING_AUTHORITY',
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
  if (!SHA256_RE.test(out)) throw new Error(`rsi_depth_${label}_digest_invalid`);
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_depth_${label}_invalid`);
  return out;
}

function boundedToken(value, label) {
  const out = String(value || '').trim().toUpperCase();
  if (!SAFE_TOKEN_RE.test(out)) throw new Error(`rsi_depth_${label}_invalid`);
  return out;
}

function positiveInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > max) throw new Error(`rsi_depth_${label}_invalid`);
  return out;
}

function nonNegativeInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 0 || out > max) throw new Error(`rsi_depth_${label}_invalid`);
  return out;
}

function boundedScore(value, label) {
  const out = Number(value);
  if (!Number.isFinite(out) || out < 0 || out > 1) throw new Error(`rsi_depth_${label}_invalid`);
  return out;
}

function finiteNonNegative(value, label) {
  const out = Number(value);
  if (!Number.isFinite(out) || out < 0) throw new Error(`rsi_depth_${label}_invalid`);
  return out;
}

function exactKeys(value, required, optional, label) {
  if (!plainObject(value)) throw new Error(`rsi_depth_${label}_invalid`);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) throw new Error(`rsi_depth_${label}_fields_invalid`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`rsi_depth_${label}_fields_invalid`);
  }
}

function zeroAuthority(extra = {}) {
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

function assertZeroAuthority(value, label) {
  for (const field of [
    'execution_authority',
    'production_mutation_authority',
    'promotion_authority',
    'self_update_authority',
    'scheduler_authority',
    'signing_authority',
    'authority_effect',
  ]) {
    if (value?.[field] !== false) throw new Error(`rsi_depth_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_depth_${label}_automatic_retry_invalid`);
}

function normalizeDigestList(value, label, { min = 1, max = MAX_CONTEXT_DIGESTS } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`rsi_depth_${label}_invalid`);
  const seen = new Set();
  const out = value.map((raw) => {
    const d = exactDigest(raw, label);
    if (seen.has(d)) throw new Error(`rsi_depth_${label}_duplicate`);
    seen.add(d);
    return d;
  });
  return Object.freeze(out);
}

function normalizeRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EVIDENCE_REFS) throw new Error('rsi_depth_evidence_refs_invalid');
  const seen = new Set();
  return Object.freeze(value.map((raw) => {
    const ref = boundedId(raw, 'evidence_ref');
    if (seen.has(ref)) throw new Error('rsi_depth_evidence_ref_duplicate');
    seen.add(ref);
    return ref;
  }).sort());
}

function normalizeHelpers(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_HELPERS) throw new Error('rsi_depth_helpers_invalid');
  const ids = new Set();
  return Object.freeze(value.map((row) => {
    exactKeys(row, ['helper_id', 'kind', 'artifact_digest', 'capabilities'], [], 'helper');
    const helperId = boundedId(row.helper_id, 'helper_id');
    if (ids.has(helperId)) throw new Error('rsi_depth_helper_duplicate');
    ids.add(helperId);
    const kind = boundedToken(row.kind, 'helper_kind');
    if (!HELPER_KINDS.has(kind)) throw new Error('rsi_depth_helper_kind_invalid');
    if (!Array.isArray(row.capabilities) || row.capabilities.length > 16) throw new Error('rsi_depth_helper_capabilities_invalid');
    const capabilities = [...new Set(row.capabilities.map((item) => boundedToken(item, 'helper_capability')))].sort();
    for (const capability of capabilities) {
      if (FORBIDDEN_HELPER_CAPABILITIES.has(capability)) throw new Error('rsi_depth_helper_forbidden_capability');
    }
    return Object.freeze({
      helper_id: helperId,
      kind,
      artifact_digest: exactDigest(row.artifact_digest, 'helper_artifact'),
      capabilities: Object.freeze(capabilities),
      direct_tool_execution: false,
      arbitrary_code_execution: false,
      authority_effect: false,
    });
  }));
}

export function createRsiRecursiveDepthPolicy({
  policy_id,
  fixed_meta_operator_digest,
  evaluator_root_digest,
  base_solver_digest,
  max_depth = 8,
  convergence_patience = 2,
  min_marginal_gain = 0.01,
  max_cost_growth_ratio = 2,
  external_policy_owner = false,
  authored_by_candidate = true,
} = {}) {
  if (external_policy_owner !== true || authored_by_candidate !== false) throw new Error('rsi_depth_policy_external_origin_required');
  const maxDepth = positiveInt(max_depth, 'max_depth', MAX_DEPTH);
  const patience = positiveInt(convergence_patience, 'convergence_patience', maxDepth);
  const minGain = boundedScore(min_marginal_gain, 'min_marginal_gain');
  const costRatio = Number(max_cost_growth_ratio);
  if (!Number.isFinite(costRatio) || costRatio < 1 || costRatio > 100) throw new Error('rsi_depth_max_cost_growth_ratio_invalid');

  const core = {
    schema: RSI_RECURSIVE_DEPTH_POLICY_SCHEMA,
    version: 1,
    policy_id: boundedId(policy_id, 'policy_id'),
    fixed_meta_operator_digest: exactDigest(fixed_meta_operator_digest, 'meta_operator'),
    evaluator_root_digest: exactDigest(evaluator_root_digest, 'evaluator_root'),
    base_solver_digest: exactDigest(base_solver_digest, 'base_solver'),
    max_depth: maxDepth,
    convergence_patience: patience,
    min_marginal_gain: minGain,
    max_cost_growth_ratio: costRatio,
    fixed_meta_operation: true,
    meta_operator_mutable_by_candidate: false,
    meta_operator_mutable_by_layer: false,
    strictly_growing_input_required: true,
    prior_layer_products_reused_as_input: true,
    accumulated_trace_evidence_required: true,
    depth_selected_by_external_convergence: true,
    depth_is_not_fixed_in_advance: true,
    archive_search_over_layer_chains_allowed: true,
    candidate_can_choose_depth: false,
    candidate_can_modify_convergence_rule: false,
    helper_direct_tool_execution_allowed: false,
    arbitrary_code_execution_allowed: false,
    external_policy_owner: true,
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
  return Object.freeze({ ...core, policy_digest: digest(core) });
}

export function verifyRsiRecursiveDepthPolicy(policy) {
  if (!plainObject(policy) || policy.schema !== RSI_RECURSIVE_DEPTH_POLICY_SCHEMA || policy.version !== 1) throw new Error('rsi_depth_policy_invalid');
  assertZeroAuthority(policy, 'policy');
  if (
    policy.fixed_meta_operation !== true
    || policy.meta_operator_mutable_by_candidate !== false
    || policy.meta_operator_mutable_by_layer !== false
    || policy.strictly_growing_input_required !== true
    || policy.prior_layer_products_reused_as_input !== true
    || policy.accumulated_trace_evidence_required !== true
    || policy.depth_selected_by_external_convergence !== true
    || policy.depth_is_not_fixed_in_advance !== true
    || policy.archive_search_over_layer_chains_allowed !== true
    || policy.candidate_can_choose_depth !== false
    || policy.candidate_can_modify_convergence_rule !== false
    || policy.helper_direct_tool_execution_allowed !== false
    || policy.arbitrary_code_execution_allowed !== false
    || policy.external_policy_owner !== true
    || policy.authored_by_candidate !== false
  ) throw new Error('rsi_depth_policy_contract_invalid');

  const canonical = createRsiRecursiveDepthPolicy({
    policy_id: policy.policy_id,
    fixed_meta_operator_digest: policy.fixed_meta_operator_digest,
    evaluator_root_digest: policy.evaluator_root_digest,
    base_solver_digest: policy.base_solver_digest,
    max_depth: policy.max_depth,
    convergence_patience: policy.convergence_patience,
    min_marginal_gain: policy.min_marginal_gain,
    max_cost_growth_ratio: policy.max_cost_growth_ratio,
    external_policy_owner: true,
    authored_by_candidate: false,
  });
  if (canonical.policy_digest !== exactDigest(policy.policy_digest, 'policy')) throw new Error('rsi_depth_policy_digest_mismatch');
  return canonical;
}

export function createRsiRecursiveDepthLayer({
  policy,
  chain_id,
  prior_layers = [],
  new_trace_digests,
  strategy_digest,
  helpers,
  external_meta_operator = false,
  authored_by_candidate = true,
} = {}) {
  const checked = verifyRsiRecursiveDepthPolicy(policy);
  if (external_meta_operator !== true || authored_by_candidate !== false) throw new Error('rsi_depth_layer_external_operator_required');
  if (!Array.isArray(prior_layers) || prior_layers.length >= checked.max_depth) throw new Error('rsi_depth_prior_layers_invalid');

  const verifiedPrior = prior_layers.map((row, index) => {
    const verified = verifyRsiRecursiveDepthLayer(row, checked, prior_layers.slice(0, index));
    if (verified.depth !== index + 1) throw new Error('rsi_depth_prior_layer_order_invalid');
    return verified;
  });

  const depth = verifiedPrior.length + 1;
  const traceDigests = normalizeDigestList(new_trace_digests, 'trace', { min: 1, max: 64 });
  const priorLayerDigests = verifiedPrior.map((row) => row.layer_digest);
  const priorContextDigests = verifiedPrior.flatMap((row) => row.accumulated_context_digests);
  const context = [...new Set([
    checked.base_solver_digest,
    ...priorLayerDigests,
    ...priorContextDigests,
    ...traceDigests,
  ])];
  if (context.length > MAX_CONTEXT_DIGESTS) throw new Error('rsi_depth_context_too_large');
  const previousContextCount = verifiedPrior.length === 0
    ? 1
    : verifiedPrior[verifiedPrior.length - 1].accumulated_context_digests.length;
  if (context.length <= previousContextCount) throw new Error('rsi_depth_input_not_strictly_growing');

  const normalizedHelpers = normalizeHelpers(helpers);
  const inputCore = {
    chain_id: boundedId(chain_id, 'chain_id'),
    depth,
    base_solver_digest: checked.base_solver_digest,
    previous_layer_digest: verifiedPrior.at(-1)?.layer_digest || null,
    accumulated_context_digests: context,
    new_trace_digests: traceDigests,
  };

  const core = {
    schema: RSI_RECURSIVE_DEPTH_LAYER_SCHEMA,
    version: 1,
    policy_id: checked.policy_id,
    policy_digest: checked.policy_digest,
    fixed_meta_operator_digest: checked.fixed_meta_operator_digest,
    evaluator_root_digest: checked.evaluator_root_digest,
    chain_id: inputCore.chain_id,
    depth,
    base_solver_digest: checked.base_solver_digest,
    previous_layer_digest: inputCore.previous_layer_digest,
    prior_layer_digests: Object.freeze(priorLayerDigests),
    new_trace_digests: traceDigests,
    accumulated_context_digests: Object.freeze(context),
    accumulated_context_count: context.length,
    input_bundle_digest: digest(inputCore),
    strategy_digest: exactDigest(strategy_digest, 'strategy'),
    helpers: normalizedHelpers,
    helper_count: normalizedHelpers.length,
    external_meta_operator: true,
    authored_by_candidate: false,
    fixed_meta_operator_reused: true,
    meta_operator_code_mutated: false,
    input_strictly_grew: true,
    layer_is_execution_authority: false,
    layer_is_promotion_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, layer_digest: digest(core) });
}

export function verifyRsiRecursiveDepthLayer(layer, policy, prior_layers = []) {
  if (!plainObject(layer) || layer.schema !== RSI_RECURSIVE_DEPTH_LAYER_SCHEMA || layer.version !== 1) throw new Error('rsi_depth_layer_invalid');
  assertZeroAuthority(layer, 'layer');
  if (
    layer.external_meta_operator !== true
    || layer.authored_by_candidate !== false
    || layer.fixed_meta_operator_reused !== true
    || layer.meta_operator_code_mutated !== false
    || layer.input_strictly_grew !== true
    || layer.layer_is_execution_authority !== false
    || layer.layer_is_promotion_authority !== false
  ) throw new Error('rsi_depth_layer_policy_invalid');

  const canonical = createRsiRecursiveDepthLayer({
    policy,
    chain_id: layer.chain_id,
    prior_layers,
    new_trace_digests: layer.new_trace_digests,
    strategy_digest: layer.strategy_digest,
    helpers: layer.helpers.map((row) => ({
      helper_id: row.helper_id,
      kind: row.kind,
      artifact_digest: row.artifact_digest,
      capabilities: row.capabilities,
    })),
    external_meta_operator: true,
    authored_by_candidate: false,
  });
  if (canonical.layer_digest !== exactDigest(layer.layer_digest, 'layer')) throw new Error('rsi_depth_layer_digest_mismatch');
  return canonical;
}

export function createRsiRecursiveDepthEvaluation({
  policy,
  layer,
  prior_layers = [],
  hidden_holdout_digest,
  quality_score,
  novelty_score,
  cost_units,
  hard_invariants_pass,
  evidence_refs,
  external_evaluator = false,
  authored_by_candidate = true,
} = {}) {
  const checked = verifyRsiRecursiveDepthPolicy(policy);
  const verifiedLayer = verifyRsiRecursiveDepthLayer(layer, checked, prior_layers);
  if (external_evaluator !== true || authored_by_candidate !== false) throw new Error('rsi_depth_eval_external_origin_required');
  const hard = hard_invariants_pass === true;
  const core = {
    schema: RSI_RECURSIVE_DEPTH_EVAL_SCHEMA,
    version: 1,
    policy_id: checked.policy_id,
    policy_digest: checked.policy_digest,
    chain_id: verifiedLayer.chain_id,
    layer_digest: verifiedLayer.layer_digest,
    depth: verifiedLayer.depth,
    fixed_meta_operator_digest: checked.fixed_meta_operator_digest,
    evaluator_root_digest: checked.evaluator_root_digest,
    hidden_holdout_digest: exactDigest(hidden_holdout_digest, 'hidden_holdout'),
    quality_score: boundedScore(quality_score, 'quality_score'),
    novelty_score: boundedScore(novelty_score, 'novelty_score'),
    cost_units: finiteNonNegative(cost_units, 'cost_units'),
    hard_invariants_pass: hard,
    evidence_refs: normalizeRefs(evidence_refs),
    external_evaluator: true,
    authored_by_candidate: false,
    evaluation_is_depth_signal_only: true,
    scalar_depth_signal_is_promotion_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, evaluation_digest: digest(core) });
}

export function verifyRsiRecursiveDepthEvaluation(row, policy, layer, prior_layers = []) {
  if (!plainObject(row) || row.schema !== RSI_RECURSIVE_DEPTH_EVAL_SCHEMA || row.version !== 1) throw new Error('rsi_depth_eval_invalid');
  assertZeroAuthority(row, 'eval');
  if (
    row.external_evaluator !== true
    || row.authored_by_candidate !== false
    || row.evaluation_is_depth_signal_only !== true
    || row.scalar_depth_signal_is_promotion_authority !== false
  ) throw new Error('rsi_depth_eval_policy_invalid');
  const canonical = createRsiRecursiveDepthEvaluation({
    policy,
    layer,
    prior_layers,
    hidden_holdout_digest: row.hidden_holdout_digest,
    quality_score: row.quality_score,
    novelty_score: row.novelty_score,
    cost_units: row.cost_units,
    hard_invariants_pass: row.hard_invariants_pass,
    evidence_refs: row.evidence_refs,
    external_evaluator: true,
    authored_by_candidate: false,
  });
  if (canonical.evaluation_digest !== exactDigest(row.evaluation_digest, 'evaluation')) throw new Error('rsi_depth_eval_digest_mismatch');
  return canonical;
}

export function evaluateRsiRecursiveDepthChain({ policy, layers, evaluations } = {}) {
  const checked = verifyRsiRecursiveDepthPolicy(policy);
  if (!Array.isArray(layers) || layers.length < 1 || layers.length > checked.max_depth) throw new Error('rsi_depth_chain_layers_invalid');
  if (!Array.isArray(evaluations) || evaluations.length !== layers.length) throw new Error('rsi_depth_chain_evaluations_invalid');

  const verifiedLayers = [];
  const verifiedEvaluations = [];
  for (let index = 0; index < layers.length; index += 1) {
    const layer = verifyRsiRecursiveDepthLayer(layers[index], checked, verifiedLayers);
    const evaluation = verifyRsiRecursiveDepthEvaluation(evaluations[index], checked, layer, verifiedLayers);
    if (evaluation.depth !== index + 1) throw new Error('rsi_depth_chain_eval_order_invalid');
    verifiedLayers.push(layer);
    verifiedEvaluations.push(evaluation);
  }

  const holdouts = new Set(verifiedEvaluations.map((row) => row.hidden_holdout_digest));
  if (holdouts.size !== 1) throw new Error('rsi_depth_chain_holdout_drift');

  const marginals = verifiedEvaluations.map((row, index) => {
    if (index === 0) return null;
    return row.quality_score - verifiedEvaluations[index - 1].quality_score;
  });
  const costRatios = verifiedEvaluations.map((row, index) => {
    if (index === 0) return null;
    const prev = verifiedEvaluations[index - 1].cost_units;
    if (prev === 0) return row.cost_units === 0 ? 1 : Number.POSITIVE_INFINITY;
    return row.cost_units / prev;
  });

  const hardFailureIndex = verifiedEvaluations.findIndex((row) => row.hard_invariants_pass !== true);
  const atMaxDepth = verifiedLayers.length >= checked.max_depth;
  const patience = checked.convergence_patience;
  const recentMarginals = marginals.slice(-patience);
  const enoughForConvergence = recentMarginals.length === patience && recentMarginals.every((value) => value != null);
  const convergedByGain = enoughForConvergence && recentMarginals.every((value) => value < checked.min_marginal_gain);
  const recentCostRatios = costRatios.slice(-patience);
  const excessiveCostGrowth = recentCostRatios.some((ratio) => ratio != null && ratio > checked.max_cost_growth_ratio);

  let state = 'CONTINUE_DEPTH';
  if (hardFailureIndex >= 0) state = 'STOP_HARD_INVARIANT_FAILURE';
  else if (convergedByGain) state = 'STOP_CONVERGED';
  else if (excessiveCostGrowth) state = 'STOP_COST_GROWTH';
  else if (atMaxDepth) state = 'STOP_MAX_DEPTH';

  const eligibleDepths = verifiedEvaluations
    .filter((row) => row.hard_invariants_pass)
    .map((row, index) => ({
      depth: row.depth,
      layer_digest: row.layer_digest,
      evaluation_digest: row.evaluation_digest,
      quality_score: row.quality_score,
      novelty_score: row.novelty_score,
      cost_units: row.cost_units,
      marginal_gain: marginals[index],
    }));

  const best = eligibleDepths
    .slice()
    .sort((a, b) =>
      b.quality_score - a.quality_score
      || b.novelty_score - a.novelty_score
      || a.cost_units - b.cost_units
      || a.depth - b.depth
    )[0] || null;

  const core = {
    schema: RSI_RECURSIVE_DEPTH_CHAIN_SCHEMA,
    version: 1,
    policy_id: checked.policy_id,
    policy_digest: checked.policy_digest,
    chain_id: verifiedLayers[0].chain_id,
    fixed_meta_operator_digest: checked.fixed_meta_operator_digest,
    evaluator_root_digest: checked.evaluator_root_digest,
    hidden_holdout_digest: [...holdouts][0],
    layer_digests: verifiedLayers.map((row) => row.layer_digest),
    evaluation_digests: verifiedEvaluations.map((row) => row.evaluation_digest),
    depth_count: verifiedLayers.length,
    state,
    hard_failure_depth: hardFailureIndex >= 0 ? hardFailureIndex + 1 : null,
    converged_by_marginal_gain: convergedByGain,
    excessive_cost_growth: excessiveCostGrowth,
    at_max_depth: atMaxDepth,
    marginal_gains: marginals,
    cost_growth_ratios: costRatios.map((value) => Number.isFinite(value) ? value : null),
    best_observed_depth: best?.depth ?? null,
    best_observed_layer_digest: best?.layer_digest ?? null,
    best_observed_evaluation_digest: best?.evaluation_digest ?? null,
    best_observed_quality_score: best?.quality_score ?? null,
    depth_selection_is_promotion: false,
    chain_result_is_archive_input_only: true,
    external_evaluation_required_for_every_depth: true,
    candidate_can_choose_stop_state: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, chain_digest: digest(core) });
}

function dominates(a, b) {
  const noWorse =
    a.best_observed_quality_score >= b.best_observed_quality_score
    && a.novelty_score >= b.novelty_score
    && a.cost_units <= b.cost_units;
  const better =
    a.best_observed_quality_score > b.best_observed_quality_score
    || a.novelty_score > b.novelty_score
    || a.cost_units < b.cost_units;
  return noWorse && better;
}

export function createRsiRecursiveDepthArchive({
  policy,
  chain_results,
  archive_id,
  external_archive_owner = false,
  authored_by_candidate = true,
} = {}) {
  const checked = verifyRsiRecursiveDepthPolicy(policy);
  if (external_archive_owner !== true || authored_by_candidate !== false) throw new Error('rsi_depth_archive_external_origin_required');
  if (!Array.isArray(chain_results) || chain_results.length < 1 || chain_results.length > 1024) throw new Error('rsi_depth_archive_chains_invalid');

  const normalized = chain_results.map((row) => {
    if (!plainObject(row) || row.schema !== RSI_RECURSIVE_DEPTH_CHAIN_SCHEMA || row.version !== 1) throw new Error('rsi_depth_archive_chain_invalid');
    assertZeroAuthority(row, 'archive_chain');
    if (row.policy_digest !== checked.policy_digest || row.fixed_meta_operator_digest !== checked.fixed_meta_operator_digest) {
      throw new Error('rsi_depth_archive_chain_policy_mismatch');
    }
    const clone = structuredClone(row);
    delete clone.chain_digest;
    if (exactDigest(row.chain_digest, 'archive_chain') !== digest(clone)) throw new Error('rsi_depth_archive_chain_digest_mismatch');
    if (row.best_observed_quality_score == null || row.best_observed_layer_digest == null) throw new Error('rsi_depth_archive_chain_no_valid_depth');
    const bestIndex = row.layer_digests.indexOf(row.best_observed_layer_digest);
    if (bestIndex < 0) throw new Error('rsi_depth_archive_best_layer_binding_invalid');
    const cost = finiteNonNegative(row.cost_growth_ratios.length ? row.depth_count : row.depth_count, 'archive_cost_proxy');
    return Object.freeze({
      chain_id: boundedId(row.chain_id, 'archive_chain_id'),
      chain_digest: exactDigest(row.chain_digest, 'archive_chain'),
      best_observed_layer_digest: exactDigest(row.best_observed_layer_digest, 'archive_best_layer'),
      best_observed_quality_score: boundedScore(row.best_observed_quality_score, 'archive_quality'),
      novelty_score: 0,
      cost_units: cost,
      state: String(row.state || ''),
      depth_count: positiveInt(row.depth_count, 'archive_depth_count', checked.max_depth),
    });
  });

  const ids = new Set();
  for (const row of normalized) {
    if (ids.has(row.chain_id)) throw new Error('rsi_depth_archive_chain_duplicate');
    ids.add(row.chain_id);
  }

  const entries = normalized.map((row) => Object.freeze({
    ...row,
    pareto_frontier: !normalized.some((other) => other.chain_id !== row.chain_id && dominates(other, row)),
    scalar_winner: null,
    archive_admission_is_promotion: false,
  }));

  const core = {
    schema: RSI_RECURSIVE_DEPTH_ARCHIVE_SCHEMA,
    version: 1,
    archive_id: boundedId(archive_id, 'archive_id'),
    policy_id: checked.policy_id,
    policy_digest: checked.policy_digest,
    fixed_meta_operator_digest: checked.fixed_meta_operator_digest,
    entries,
    pareto_chain_ids: entries.filter((row) => row.pareto_frontier).map((row) => row.chain_id).sort(),
    evolutionary_archive_over_layer_chains: true,
    scalar_ranking_authoritative: false,
    archive_is_promotion_authority: false,
    candidate_can_edit_archive: false,
    external_archive_owner: true,
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
  return Object.freeze({ ...core, archive_digest: digest(core) });
}

export function rsiRecursiveDepthTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.recursive-depth-root.v1',
    version: 1,
    policy_path: 'apps/metaengine-browser/src/rsi-recursive-depth-controller.mjs',
    mechanism: 'FIXED_META_OPERATION_RECURSING_ON_GROWING_INPUT',
    helper_kinds: [...HELPER_KINDS].sort(),
    forbidden_helper_capabilities: [...FORBIDDEN_HELPER_CAPABILITIES].sort(),
    max_depth_hard_cap: MAX_DEPTH,
    fixed_meta_operation: true,
    meta_operator_mutable_by_candidate: false,
    meta_operator_mutable_by_layer: false,
    strictly_growing_input_required: true,
    depth_selected_by_external_convergence: true,
    archive_search_over_layer_chains_allowed: true,
    candidate_can_choose_depth: false,
    helper_direct_tool_execution_allowed: false,
    arbitrary_code_execution_allowed: false,
    evaluator_root_mutable: false,
    promotion_root_mutable: false,
    scheduler_authority_mutable: false,
    signing_root_mutable: false,
    self_update_root_mutable: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, recursive_depth_root_digest: digest(root) });
}
