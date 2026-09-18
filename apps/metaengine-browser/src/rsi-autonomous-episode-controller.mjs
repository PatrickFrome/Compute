
import crypto from 'node:crypto';

import { buildRsiExperimentHypothesis } from './supervisor-rsi-experiment-hypothesis.mjs';
import { buildRsiDevosExperimentPlan, RSI_DEVOS_EXPERIMENT_PLAN_SCHEMA } from './rsi-devos-experiment-plan.mjs';
import {
  verifyRsiSearchContext,
  createRsiSearchModeRoutingPlan,
  verifyRsiSearchModeRoutingPlan,
} from './rsi-search-mode-router.mjs';
import { verifyRsiHarnessRepairSpec } from './rsi-trace-guided-harness-repair.mjs';
import { verifyRsiExperienceContextPlan } from './rsi-experience-context-planner.mjs';

export const RSI_AUTONOMOUS_EPISODE_PLAN_SCHEMA = 'metaengine.rsi.autonomous-episode-plan.v1';
export const RSI_AUTONOMOUS_VARIANT_PLAN_SCHEMA = 'metaengine.rsi.autonomous-variant-plan.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^(?:sha256:)?[0-9a-f]{64}$/;
const SAFE_MODE_RE = /^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const SAFE_ROLE_RE = /^(EXPLOIT|EXPLORE|ONLY_COMPATIBLE)$/;
const MAX_VARIANTS = 2;
const MAX_CANDIDATES = 4;

const HARNESS_LAYER_TO_MUTATION_SURFACE = Object.freeze({
  EXECUTION: 'BROWSER_RUNTIME',
  TOOLS: 'TOOL_INTERFACE',
  CONTEXT: 'PROMPT_ROUTING',
  LIFECYCLE: 'BROWSER_RUNTIME',
  OBSERVABILITY: 'BROWSER_RUNTIME',
  VERIFICATION: 'RSI_IMPROVER',
  GOVERNANCE: 'RSI_IMPROVER',
});

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

function normalizeHarnessRepairSpec(repairSpec, { sourceSha, mutationSurface, hypothesis } = {}) {
  if (repairSpec == null) return null;
  const checked = verifyRsiHarnessRepairSpec(repairSpec);
  if (exactSha(checked.source_sha, 'harness_repair_source') !== sourceSha) {
    throw new Error('rsi_autonomous_harness_repair_source_mismatch');
  }
  const layer = String(checked.component_layer || '').trim().toUpperCase();
  const mappedSurface = HARNESS_LAYER_TO_MUTATION_SURFACE[layer];
  if (!mappedSurface) throw new Error('rsi_autonomous_harness_repair_layer_unmapped');
  if (mappedSurface !== mutationSurface) throw new Error('rsi_autonomous_harness_repair_surface_mismatch');

  const suspected = Array.isArray(hypothesis?.suspected_components)
    ? hypothesis.suspected_components.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  if (suspected.length > 0 && !suspected.includes(checked.component_path)) {
    throw new Error('rsi_autonomous_harness_repair_component_not_suspected');
  }
  return Object.freeze(structuredClone(checked));
}

function harnessRepairSummary(repairSpec) {
  if (!repairSpec) return null;
  return Object.freeze({
    repair_id: repairSpec.repair_id,
    repair_digest: repairSpec.repair_digest,
    flaw_id: repairSpec.flaw_id,
    flaw_digest: repairSpec.flaw_digest,
    component_id: repairSpec.component_id,
    component_path: repairSpec.component_path,
    component_layer: repairSpec.component_layer,
    repair_operator: repairSpec.repair_operator,
    predicted_failure_code_reduction: repairSpec.predicted_failure_code_reduction,
    predicted_objective_codes: Object.freeze([...(repairSpec.predicted_objective_codes || [])]),
    regression_guard_codes: Object.freeze([...(repairSpec.regression_guard_codes || [])]),
    heldout_suite_digest: repairSpec.heldout_suite_digest,
    matched_budget_digest: repairSpec.matched_budget_digest,
    exact_component_scope_required: true,
    broad_patch_forbidden: true,
    matched_feedback_budget_baseline_required: true,
    heldout_generalization_required: true,
    candidate_can_modify_repair_spec: false,
    patch_materialization_external: true,
    scheduler_action_authorized: false,
    authority_effect: false,
  });
}

function normalizeExperienceContextPlan(plan, {
  sourceSha,
  observationDigest,
  opportunityId,
  mutationSurface,
} = {}) {
  if (plan == null) return null;
  const checked = verifyRsiExperienceContextPlan(plan);
  if (exactSha(checked.source_sha, 'experience_context_source') !== sourceSha) {
    throw new Error('rsi_autonomous_experience_context_source_mismatch');
  }
  if (exactDigest(checked.observation_digest, 'experience_context_observation') !== observationDigest) {
    throw new Error('rsi_autonomous_experience_context_observation_mismatch');
  }
  if (String(checked.opportunity_id || '') !== String(opportunityId || '')) {
    throw new Error('rsi_autonomous_experience_context_opportunity_mismatch');
  }
  if (String(checked.mutation_surface || '').toUpperCase() !== String(mutationSurface || '').toUpperCase()) {
    throw new Error('rsi_autonomous_experience_context_surface_mismatch');
  }
  return Object.freeze(structuredClone(checked));
}

function experienceContextSummary(plan) {
  if (!plan) return null;
  return Object.freeze({
    schema: 'metaengine.rsi.autonomous-experience-context-summary.v1',
    version: 1,
    context_plan_digest: plan.context_plan_digest,
    search_context_digest: plan.search_context_digest,
    graph_snapshot_digest: plan.graph_snapshot_digest,
    retrieval_digest: plan.retrieval_digest,
    mode: plan.mode,
    selected_case_count: plan.selected_case_count,
    selected_cases: Object.freeze((plan.selected_cases || []).map((row) => Object.freeze({
      rank: row.rank,
      case_id: row.case_id,
      case_digest: row.case_digest,
      outcome: row.outcome,
      candidate_id: row.candidate_id,
      candidate_sha: row.candidate_sha,
      failure_codes: Object.freeze([...(row.failure_codes || [])]),
      mechanism_tags: Object.freeze([...(row.mechanism_tags || [])]),
      lesson_digests: Object.freeze([...(row.lesson_digests || [])]),
      contextual_utility: row.contextual_utility,
      ranking_score: row.ranking_score,
      authority_effect: false,
    }))),
    retrieval_is_advisory_only: true,
    candidate_can_modify_context: false,
    candidate_can_select_retrieval_thresholds: false,
    source_context_truth_is_portable: false,
    scheduler_action_authorized: false,
    execution_authority: false,
    promotion_authority: false,
    self_update_authority: false,
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

function variantPlanFrom({
  basePlan,
  routingPlan,
  allocation,
  variantIndex,
  harnessRepairSpec = null,
  experienceContextPlan = null,
}) {
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

  const repairSummary = harnessRepairSummary(harnessRepairSpec);
  const experienceSummary = experienceContextSummary(experienceContextPlan);
  const variantMaterial = {
    base_plan_digest: exactDigest(basePlan.plan_digest, 'base_plan'),
    routing_digest: exactDigest(routingPlan.routing_digest, 'routing'),
    harness_repair_digest: repairSummary ? exactDigest(repairSummary.repair_digest, 'harness_repair') : null,
    experience_context_digest: experienceSummary
      ? exactDigest(experienceSummary.context_plan_digest, 'experience_context')
      : null,
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
    ...(experienceSummary ? [
      'rsi_experience_context_digest=' + experienceSummary.context_plan_digest,
      'rsi_experience_context_mode=' + experienceSummary.mode,
      'rsi_experience_selected_case_count=' + experienceSummary.selected_case_count,
      'rsi_experience_retrieval_is_advisory_only',
      'rsi_experience_candidate_cannot_modify_context',
      ...(experienceSummary.graph_snapshot_digest
        ? ['rsi_experience_graph_snapshot_digest=' + experienceSummary.graph_snapshot_digest]
        : []),
    ] : []),
    ...(repairSummary ? [
      'rsi_harness_repair_digest=' + repairSummary.repair_digest,
      'rsi_harness_component_path=' + repairSummary.component_path,
      'rsi_harness_repair_operator=' + repairSummary.repair_operator,
      'rsi_harness_exact_component_scope_required',
      'rsi_harness_broad_patch_forbidden',
      'rsi_harness_matched_budget_baseline_required',
      'rsi_harness_heldout_generalization_required',
      'rsi_harness_candidate_cannot_modify_repair_spec',
    ] : []),
  ]);
  plan.task_spec.rsi = Object.freeze({
    ...(basePlan.task_spec?.rsi || {}),
    harness_repair: repairSummary,
    experience_context: experienceSummary,
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
  harness_repair_spec = null,
  experience_context_plan = null,
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
  const mutationSurface = String(opportunity.mutation_surface || '').toUpperCase();
  const repairSpec = normalizeHarnessRepairSpec(harness_repair_spec, {
    sourceSha,
    mutationSurface,
    hypothesis,
  });
  const experienceContextPlan = normalizeExperienceContextPlan(experience_context_plan, {
    sourceSha,
    observationDigest,
    opportunityId: opportunity_id,
    mutationSurface,
  });
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
      harness_repair_digest: repairSpec ? exactDigest(repairSpec.repair_digest, 'harness_repair') : null,
      experience_context_digest: experienceContextPlan
        ? exactDigest(experienceContextPlan.context_plan_digest, 'experience_context')
        : null,
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
      harnessRepairSpec: repairSpec,
      experienceContextPlan,
    })
  );

  const episodeMaterial = {
    source_sha: sourceSha,
    observation_digest: observationDigest,
    opportunity_id,
    hypothesis_digest: exactDigest(hypothesis.hypothesis_digest, 'hypothesis'),
    search_context_digest: exactDigest(context.context_digest, 'search_context'),
    routing_digest: exactDigest(routingPlan.routing_digest, 'routing'),
    harness_repair_digest: repairSpec ? exactDigest(repairSpec.repair_digest, 'harness_repair') : null,
    experience_context_digest: experienceContextPlan
      ? exactDigest(experienceContextPlan.context_plan_digest, 'experience_context')
      : null,
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
    mutation_surface: mutationSurface,
    harness_repair_spec: repairSpec,
    harness_repair_digest: repairSpec ? exactDigest(repairSpec.repair_digest, 'harness_repair') : null,
    experience_context_plan: experienceContextPlan,
    experience_context_digest: experienceContextPlan
      ? exactDigest(experienceContextPlan.context_plan_digest, 'experience_context')
      : null,
    experience_context_summary: experienceContextSummary(experienceContextPlan),
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
      mutation_surface: mutationSurface,
      search_context_digest: exactDigest(context.context_digest, 'search_context'),
      max_candidates: candidateLimit,
    }),
    existing_devos_scheduler_required: true,
    search_routing_is_scheduler_authority: false,
    search_routing_is_promotion_authority: false,
    candidate_can_choose_search_mode: false,
    experience_context_advisory_only: true,
    candidate_can_modify_experience_context: false,
    experience_context_is_scheduler_authority: false,
    experience_context_is_promotion_authority: false,
    harness_repair_exact_component_scope: true,
    broad_harness_patch_allowed: false,
    candidate_can_modify_harness_repair_spec: false,
    harness_repair_requires_matched_budget_baseline: true,
    harness_repair_requires_heldout_generalization: true,
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
    || plan.experience_context_advisory_only !== true
    || plan.candidate_can_modify_experience_context !== false
    || plan.experience_context_is_scheduler_authority !== false
    || plan.experience_context_is_promotion_authority !== false
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
  let checkedExperienceContext = null;
  if (plan.experience_context_plan != null) {
    checkedExperienceContext = normalizeExperienceContextPlan(plan.experience_context_plan, {
      sourceSha: plan.source_sha,
      observationDigest: exactDigest(plan.observation_digest, 'plan_observation'),
      opportunityId: plan.opportunity_id,
      mutationSurface: plan.mutation_surface,
    });
    const checkedDigest = exactDigest(checkedExperienceContext.context_plan_digest, 'plan_experience_context');
    if (checkedDigest !== exactDigest(plan.experience_context_digest, 'plan_experience_context_claimed')) {
      throw new Error('rsi_autonomous_experience_context_digest_mismatch');
    }
    const expectedSummary = experienceContextSummary(checkedExperienceContext);
    if (JSON.stringify(expectedSummary) !== JSON.stringify(plan.experience_context_summary)) {
      throw new Error('rsi_autonomous_experience_context_summary_mismatch');
    }
  } else if (plan.experience_context_digest != null || plan.experience_context_summary != null) {
    throw new Error('rsi_autonomous_experience_context_plan_missing');
  }
  let checkedRepair = null;
  if (plan.harness_repair_spec != null) {
    checkedRepair = verifyRsiHarnessRepairSpec(plan.harness_repair_spec);
    const normalizedRepairDigest = exactDigest(checkedRepair.repair_digest, 'plan_harness_repair');
    if (normalizedRepairDigest !== exactDigest(plan.harness_repair_digest, 'plan_harness_repair_claimed')) {
      throw new Error('rsi_autonomous_harness_repair_digest_mismatch');
    }
    if (exactSha(checkedRepair.source_sha, 'plan_harness_repair_source') !== plan.source_sha) {
      throw new Error('rsi_autonomous_harness_repair_source_mismatch');
    }
    const mappedSurface = HARNESS_LAYER_TO_MUTATION_SURFACE[String(checkedRepair.component_layer || '').toUpperCase()];
    if (mappedSurface !== plan.mutation_surface) throw new Error('rsi_autonomous_harness_repair_surface_mismatch');
    const suspected = Array.isArray(plan.hypothesis?.suspected_components) ? plan.hypothesis.suspected_components : [];
    if (suspected.length > 0 && !suspected.includes(checkedRepair.component_path)) {
      throw new Error('rsi_autonomous_harness_repair_component_not_suspected');
    }
  } else if (plan.harness_repair_digest != null) {
    throw new Error('rsi_autonomous_harness_repair_spec_missing');
  }
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
    const variantExperienceSummary = variant.task_spec?.rsi?.experience_context || null;
    if (checkedExperienceContext) {
      const expectedExperienceSummary = experienceContextSummary(checkedExperienceContext);
      if (!variantExperienceSummary
        || JSON.stringify(variantExperienceSummary) !== JSON.stringify(expectedExperienceSummary)) {
        throw new Error('rsi_autonomous_variant_experience_context_mismatch');
      }
    } else if (variantExperienceSummary != null) {
      throw new Error('rsi_autonomous_variant_unexpected_experience_context');
    }
    const repairSummary = variant.task_spec?.rsi?.harness_repair || null;
    if (checkedRepair) {
      if (!repairSummary || exactDigest(repairSummary.repair_digest, 'variant_harness_repair') !== exactDigest(checkedRepair.repair_digest, 'checked_harness_repair')) {
        throw new Error('rsi_autonomous_variant_harness_repair_mismatch');
      }
      if (
        repairSummary.component_path !== checkedRepair.component_path
        || repairSummary.repair_operator !== checkedRepair.repair_operator
        || repairSummary.candidate_can_modify_repair_spec !== false
        || repairSummary.patch_materialization_external !== true
        || repairSummary.scheduler_action_authorized !== false
      ) throw new Error('rsi_autonomous_variant_harness_repair_policy_invalid');
    } else if (repairSummary != null) {
      throw new Error('rsi_autonomous_variant_unexpected_harness_repair');
    }
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
      'apps/metaengine-browser/src/rsi-trace-guided-harness-repair.mjs',
      'apps/metaengine-browser/src/rsi-verified-search-feedback.mjs',
      'apps/metaengine-browser/src/rsi-experience-context-planner.mjs',
      'apps/metaengine-browser/src/rsi-experience-graph.mjs',
    ],
    contextual_search_routing: true,
    explicit_exploration_budget: true,
    max_parallel_search_variants: MAX_VARIANTS,
    max_candidates_per_episode: MAX_CANDIDATES,
    existing_devos_scheduler_required: true,
    second_scheduler_allowed: false,
    candidate_can_choose_search_mode: false,
    verified_experience_context_supported: true,
    experience_context_retrieval_is_advisory_only: true,
    candidate_can_modify_experience_context: false,
    experience_context_is_scheduler_authority: false,
    experience_context_is_promotion_authority: false,
    direct_dispatch_enabled: false,
    direct_promotion_enabled: false,
    self_update_authority: false,
    physical_effect_replay_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, autonomous_controller_root_digest: digest(root) });
}
