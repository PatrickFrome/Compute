
import crypto from 'node:crypto';

import { buildRsiExperimentHypothesis } from './supervisor-rsi-experiment-hypothesis.mjs';
import { buildRsiDevosExperimentPlan, RSI_DEVOS_EXPERIMENT_PLAN_SCHEMA } from './rsi-devos-experiment-plan.mjs';
import {
  verifyRsiSearchContext,
  createRsiSearchModeRoutingPlan,
  verifyRsiSearchModeRoutingPlan,
} from './rsi-search-mode-router.mjs';

export const RSI_AUTONOMOUS_EPISODE_PLAN_SCHEMA = 'metaengine.rsi.autonomous-episode-plan.v1';
export const RSI_AUTONOMOUS_VARIANT_PLAN_SCHEMA = 'metaengine.rsi.autonomous-variant-plan.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^(?:sha256:)?[0-9a-f]{64}$/;
const SAFE_MODE_RE = /^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const SAFE_ROLE_RE = /^(EXPLOIT|EXPLORE|ONLY_COMPATIBLE)$/;
const MAX_VARIANTS = 2;
const MAX_CANDIDATES = 4;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}

function exactSha(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA40_RE.test(out)) throw new Error('rsi_autonomous_' + label + '_sha_invalid');
  return out;
}

function exactDigest(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!DIGEST_RE.test(out)) throw new Error('rsi_autonomous_' + label + '_digest_invalid');
  return out.startsWith('sha256:') ? out.slice(7) : out;
}

function positiveInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > max) throw new Error('rsi_autonomous_' + label + '_invalid');
  return out;
}

function finitePositive(value, label) {
  const out = Number(value);
  if (!Number.isFinite(out) || out <= 0) throw new Error('rsi_autonomous_' + label + '_invalid');
  return out;
}

function boundedFraction(value, label) {
  const out = Number(value);
  if (!Number.isFinite(out) || out <= 0 || out >= 0.5) throw new Error('rsi_autonomous_' + label + '_invalid');
  return out;
}

function assertZeroAuthority(value, label) {
  for (const field of [
    'execution_authority',
    'browser_authority',
    'scheduler_authority',
    'task_authority',
    'production_mutation_authority',
    'promotion_authority',
    'self_update_authority',
    'authority_effect',
  ]) {
    if (Object.hasOwn(value || {}, field) && value[field] !== false) {
      throw new Error('rsi_autonomous_' + label + '_' + field + '_invalid');
    }
  }
  if (Object.hasOwn(value || {}, 'automatic_retry_allowed') && value.automatic_retry_allowed !== false) {
    throw new Error('rsi_autonomous_' + label + '_automatic_retry_invalid');
  }
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

function normalizeAllocation(allocation, index) {
  if (!allocation || typeof allocation !== 'object' || Array.isArray(allocation)) {
    throw new Error('rsi_autonomous_allocation_invalid');
  }
  const searchMode = String(allocation.search_mode || '').trim().toUpperCase();
  const role = String(allocation.role || '').trim().toUpperCase();
  if (!SAFE_MODE_RE.test(searchMode)) throw new Error('rsi_autonomous_search_mode_invalid');
  if (!SAFE_ROLE_RE.test(role)) throw new Error('rsi_autonomous_allocation_role_invalid');
  return Object.freeze({
    allocation_index: index,
    search_mode: searchMode,
    role,
    proposal_budget_units: finitePositive(allocation.proposal_budget_units, 'proposal_budget_units'),
  });
}

function variantPlanFrom({ basePlan, routingPlan, allocation, variantIndex }) {
  if (!basePlan || basePlan.schema !== RSI_DEVOS_EXPERIMENT_PLAN_SCHEMA) {
    throw new Error('rsi_autonomous_base_plan_invalid');
  }
  assertZeroAuthority(basePlan, 'base_plan');
  verifyRsiSearchModeRoutingPlan(routingPlan);
  const normalized = normalizeAllocation(allocation, variantIndex);
  if (!routingPlan.allocations.some((row) =>
    row.search_mode === normalized.search_mode
    && row.role === normalized.role
    && Number(row.proposal_budget_units) === normalized.proposal_budget_units
  )) {
    throw new Error('rsi_autonomous_allocation_not_in_routing_plan');
  }

  const variantMaterial = {
    base_plan_digest: exactDigest(basePlan.plan_digest, 'base_plan'),
    routing_digest: exactDigest(routingPlan.routing_digest, 'routing'),
    search_mode: normalized.search_mode,
    allocation_role: normalized.role,
    proposal_budget_units: normalized.proposal_budget_units,
    variant_index: variantIndex,
  };
  const variantDigest = digest(variantMaterial);
  const variantId = 'rsi_variant_' + variantDigest.slice(0, 24);
  const modeSlug = normalized.search_mode.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const targetBranch = String(basePlan.target_branch) + '-' + modeSlug + '-' + variantDigest.slice(0, 8);

  const plan = structuredClone(basePlan);
  delete plan.plan_digest;
  plan.experiment_id = 'rsi_exp_' + digest({
    base_experiment_id: basePlan.experiment_id,
    variant_digest: variantDigest,
  }).slice(0, 24);
  plan.target_branch = targetBranch;
  plan.task_spec = structuredClone(basePlan.task_spec);
  plan.task_spec.target_branch = targetBranch;
  plan.task_spec.constraints = Object.freeze([
    ...(Array.isArray(basePlan.task_spec?.constraints) ? basePlan.task_spec.constraints : []),
    'rsi_search_mode=' + normalized.search_mode,
    'rsi_search_allocation_role=' + normalized.role,
    'rsi_search_routing_digest=' + routingPlan.routing_digest,
    'rsi_search_variant_digest=' + variantDigest,
    'rsi_search_mode_is_proposal_guidance_only',
    'rsi_search_router_has_zero_scheduler_authority',
  ]);
  plan.task_spec.rsi = Object.freeze({
    ...(basePlan.task_spec?.rsi || {}),
    search_variant: Object.freeze({
      schema: RSI_AUTONOMOUS_VARIANT_PLAN_SCHEMA,
      version: 1,
      variant_id: variantId,
      variant_digest: variantDigest,
      routing_digest: routingPlan.routing_digest,
      search_mode: normalized.search_mode,
      allocation_role: normalized.role,
      proposal_budget_units: normalized.proposal_budget_units,
      scheduler_action_authorized: false,
      candidate_can_choose_search_mode: false,
      authority_effect: false,
    }),
  });
  plan.search_variant = Object.freeze({
    variant_id: variantId,
    variant_digest: variantDigest,
    routing_digest: routingPlan.routing_digest,
    search_mode: normalized.search_mode,
    allocation_role: normalized.role,
    proposal_budget_units: normalized.proposal_budget_units,
    scheduler_action_authorized: false,
    candidate_can_choose_search_mode: false,
    authority_effect: false,
  });
  plan.plan_digest = digest(plan);
  return Object.freeze(plan);
}

export function createRsiAutonomousEpisodePlan({
  observation,
  opportunity_id,
  search_context,
  search_outcomes = [],
  cycle_generation = 1,
  max_candidates = MAX_CANDIDATES,
  proposal_budget_units = 100,
  exploration_fraction = 0.2,
} = {}) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
    throw new Error('rsi_autonomous_observation_invalid');
  }
  assertZeroAuthority(observation, 'observation');
  const sourceSha = exactSha(observation.source_sha, 'source');
  const observationDigest = exactDigest(observation.observation_digest, 'observation');
  const opportunity = (Array.isArray(observation.opportunities) ? observation.opportunities : [])
    .find((row) => row?.opportunity_id === opportunity_id);
  if (!opportunity) throw new Error('rsi_autonomous_opportunity_not_found');
  assertZeroAuthority(opportunity, 'opportunity');

  const context = verifyRsiSearchContext(search_context);
  if (String(context.mutation_surface || '').toUpperCase() !== String(opportunity.mutation_surface || '').toUpperCase()) {
    throw new Error('rsi_autonomous_search_context_surface_mismatch');
  }

  const hypothesis = buildRsiExperimentHypothesis({ observation, opportunity_id });
  const basePlan = buildRsiDevosExperimentPlan({
    observation,
    opportunity_id,
    hypothesis,
  });
  const generation = positiveInt(cycle_generation, 'cycle_generation', 1_000_000);
  const candidateLimit = positiveInt(max_candidates, 'max_candidates', MAX_CANDIDATES);
  const totalBudget = finitePositive(proposal_budget_units, 'proposal_budget_units');
  const explore = boundedFraction(exploration_fraction, 'exploration_fraction');

  const routingPlan = createRsiSearchModeRoutingPlan({
    context,
    outcomes: search_outcomes,
    routing_id: 'rsi-route-' + digest({
      source_sha: sourceSha,
      observation_digest: observationDigest,
      opportunity_id,
      hypothesis_digest: hypothesis.hypothesis_digest,
      cycle_generation: generation,
    }).slice(0, 24),
    proposal_budget_units: totalBudget,
    exploration_fraction: explore,
    external_router: true,
    authored_by_candidate: false,
  });
  verifyRsiSearchModeRoutingPlan(routingPlan);

  if (!Array.isArray(routingPlan.allocations) || routingPlan.allocations.length < 1 || routingPlan.allocations.length > MAX_VARIANTS) {
    throw new Error('rsi_autonomous_routing_allocation_count_invalid');
  }
  if (candidateLimit < routingPlan.allocations.length) {
    throw new Error('rsi_autonomous_candidate_limit_below_routing_allocations');
  }

  const variantPlans = routingPlan.allocations.map((allocation, index) =>
    variantPlanFrom({
      basePlan,
      routingPlan,
      allocation,
      variantIndex: index + 1,
    })
  );

  const episodeMaterial = {
    source_sha: sourceSha,
    observation_digest: observationDigest,
    opportunity_id,
    hypothesis_digest: exactDigest(hypothesis.hypothesis_digest, 'hypothesis'),
    search_context_digest: exactDigest(context.context_digest, 'search_context'),
    routing_digest: exactDigest(routingPlan.routing_digest, 'routing'),
    cycle_generation: generation,
  };
  const episodeDigest = digest(episodeMaterial);
  const episodeId = 'rsi_episode_' + episodeDigest.slice(0, 24);

  const core = zeroAuthority({
    schema: RSI_AUTONOMOUS_EPISODE_PLAN_SCHEMA,
    version: 1,
    episode_id: episodeId,
    episode_digest: episodeDigest,
    cycle_generation: generation,
    source_sha: sourceSha,
    observation_digest: observationDigest,
    opportunity_id,
    hypothesis,
    hypothesis_digest: exactDigest(hypothesis.hypothesis_digest, 'hypothesis'),
    mutation_surface: String(opportunity.mutation_surface || '').toUpperCase(),
    search_context: context,
    search_context_digest: exactDigest(context.context_digest, 'search_context'),
    routing_plan: routingPlan,
    routing_digest: exactDigest(routingPlan.routing_digest, 'routing'),
    variant_plans: Object.freeze(variantPlans),
    variant_count: variantPlans.length,
    max_candidates: candidateLimit,
    episode_open_spec: Object.freeze({
      episode_id: episodeId,
      observation_digest: observationDigest,
      opportunity_id,
      hypothesis_digest: exactDigest(hypothesis.hypothesis_digest, 'hypothesis'),
      mutation_surface: String(opportunity.mutation_surface || '').toUpperCase(),
      search_context_digest: exactDigest(context.context_digest, 'search_context'),
      max_candidates: candidateLimit,
    }),
    existing_devos_scheduler_required: true,
    search_routing_is_scheduler_authority: false,
    search_routing_is_promotion_authority: false,
    candidate_can_choose_search_mode: false,
    direct_dispatch_enabled: false,
    direct_promotion_enabled: false,
    physical_effect_replay_allowed: false,
  });
  return Object.freeze({ ...core, controller_plan_digest: digest(core) });
}

export function verifyRsiAutonomousEpisodePlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || plan.schema !== RSI_AUTONOMOUS_EPISODE_PLAN_SCHEMA || plan.version !== 1) {
    throw new Error('rsi_autonomous_plan_schema_invalid');
  }
  assertZeroAuthority(plan, 'plan');
  if (
    plan.existing_devos_scheduler_required !== true
    || plan.search_routing_is_scheduler_authority !== false
    || plan.search_routing_is_promotion_authority !== false
    || plan.candidate_can_choose_search_mode !== false
    || plan.direct_dispatch_enabled !== false
    || plan.direct_promotion_enabled !== false
    || plan.physical_effect_replay_allowed !== false
  ) {
    throw new Error('rsi_autonomous_plan_policy_invalid');
  }
  exactSha(plan.source_sha, 'plan_source');
  exactDigest(plan.observation_digest, 'plan_observation');
  exactDigest(plan.hypothesis_digest, 'plan_hypothesis');
  exactDigest(plan.search_context_digest, 'plan_search_context');
  exactDigest(plan.routing_digest, 'plan_routing');
  verifyRsiSearchContext(plan.search_context);
  verifyRsiSearchModeRoutingPlan(plan.routing_plan);
  if (exactDigest(plan.routing_plan.routing_digest, 'routing_plan') !== exactDigest(plan.routing_digest, 'routing')) {
    throw new Error('rsi_autonomous_routing_digest_mismatch');
  }
  if (!Array.isArray(plan.variant_plans) || plan.variant_plans.length !== plan.variant_count || plan.variant_count < 1 || plan.variant_count > MAX_VARIANTS) {
    throw new Error('rsi_autonomous_variant_count_invalid');
  }
  if (Number(plan.max_candidates) < plan.variant_count || Number(plan.max_candidates) > MAX_CANDIDATES) {
    throw new Error('rsi_autonomous_max_candidates_invalid');
  }
  for (const variant of plan.variant_plans) {
    if (variant.schema !== RSI_DEVOS_EXPERIMENT_PLAN_SCHEMA) throw new Error('rsi_autonomous_variant_schema_invalid');
    assertZeroAuthority(variant, 'variant');
    if (variant.search_variant?.scheduler_action_authorized !== false || variant.search_variant?.candidate_can_choose_search_mode !== false) {
      throw new Error('rsi_autonomous_variant_policy_invalid');
    }
    if (exactSha(variant.source_sha, 'variant_source') !== plan.source_sha) throw new Error('rsi_autonomous_variant_source_mismatch');
    if (exactDigest(variant.hypothesis_digest, 'variant_hypothesis') !== plan.hypothesis_digest) throw new Error('rsi_autonomous_variant_hypothesis_mismatch');
    const clone = structuredClone(variant);
    const claimed = exactDigest(clone.plan_digest, 'variant_plan');
    delete clone.plan_digest;
    if (digest(clone) !== claimed) throw new Error('rsi_autonomous_variant_plan_digest_mismatch');
  }
  const clone = structuredClone(plan);
  const claimed = exactDigest(clone.controller_plan_digest, 'controller_plan');
  delete clone.controller_plan_digest;
  if (digest(clone) !== claimed) throw new Error('rsi_autonomous_controller_plan_digest_mismatch');
  return plan;
}

export function rsiAutonomousEpisodeControllerTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.autonomous-episode-controller-root.v1',
    version: 1,
    immutable_component_paths: [
      'apps/metaengine-browser/src/rsi-autonomous-episode-controller.mjs',
      'apps/metaengine-browser/src/supervisor-rsi-experiment-hypothesis.mjs',
      'apps/metaengine-browser/src/rsi-devos-experiment-plan.mjs',
      'apps/metaengine-browser/src/rsi-search-mode-router.mjs',
      'apps/metaengine-browser/src/rsi-episode-orchestrator.mjs',
      'apps/metaengine-browser/src/rsi-episode-devos-bridge.mjs',
      'apps/metaengine-browser/src/rsi-evaluation-integrity-guard.mjs',
    ],
    contextual_search_routing: true,
    explicit_exploration_budget: true,
    max_parallel_search_variants: MAX_VARIANTS,
    max_candidates_per_episode: MAX_CANDIDATES,
    existing_devos_scheduler_required: true,
    second_scheduler_allowed: false,
    candidate_can_choose_search_mode: false,
    direct_dispatch_enabled: false,
    direct_promotion_enabled: false,
    self_update_authority: false,
    physical_effect_replay_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, autonomous_controller_root_digest: digest(root) });
}
