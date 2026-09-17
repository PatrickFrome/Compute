import crypto from 'node:crypto';

import {
  RSI_SHADOW_OBSERVATION_SCHEMA,
  RSI_SHADOW_OPPORTUNITY_SCHEMA,
} from './rsi-shadow-observer.mjs';

export const RSI_DEVOS_EXPERIMENT_PLAN_SCHEMA = 'metaengine.rsi.devos-experiment-plan.v1';

const SHA40_RE = /^[0-9a-f]{40}$/i;
const SAFE_SURFACES = new Set([
  'PROMPT_ROUTING',
  'AGENT_ORCHESTRATION',
  'TOOL_INTERFACE',
  'BROWSER_RUNTIME',
  'RSI_IMPROVER',
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}

function clip(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function branchSlug(value) {
  return clip(value, 96)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-') || 'experiment';
}

function assertZeroAuthority(value, prefix) {
  const flags = [
    'execution_authority',
    'production_mutation_authority',
    'promotion_authority',
    'self_update_authority',
    'authority_effect',
  ];
  for (const flag of flags) {
    if (value?.[flag] !== false) throw new Error(`rsi_devos_${prefix}_${flag}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_devos_${prefix}_automatic_retry_invalid`);
}

export function buildRsiDevosExperimentPlan({ observation, opportunity_id } = {}) {
  if (observation?.schema !== RSI_SHADOW_OBSERVATION_SCHEMA) throw new Error('rsi_devos_observation_schema_invalid');
  if (!SHA40_RE.test(String(observation?.source_sha || ''))) throw new Error('rsi_devos_source_sha_invalid');
  assertZeroAuthority(observation, 'observation');

  const opportunity = (Array.isArray(observation?.opportunities) ? observation.opportunities : [])
    .find((entry) => entry?.opportunity_id === opportunity_id);
  if (!opportunity) throw new Error('rsi_devos_opportunity_not_found');
  if (opportunity.schema !== RSI_SHADOW_OPPORTUNITY_SCHEMA) throw new Error('rsi_devos_opportunity_schema_invalid');
  assertZeroAuthority(opportunity, 'opportunity');

  const mutationSurface = String(opportunity.mutation_surface || '').toUpperCase();
  if (!SAFE_SURFACES.has(mutationSurface)) throw new Error('rsi_devos_mutation_surface_invalid');
  const signal = clip(opportunity.signal, 96).toUpperCase();
  if (!signal) throw new Error('rsi_devos_signal_missing');

  const sourceSha = observation.source_sha.toLowerCase();
  const experimentSeed = {
    source_sha: sourceSha,
    opportunity_id: opportunity.opportunity_id,
    signal,
    mutation_surface: mutationSurface,
    observation_digest: observation.observation_digest,
  };
  const experimentDigest = sha256(experimentSeed);
  const experimentId = `rsi_exp_${experimentDigest.slice(0, 24)}`;
  const targetBranch = `work/rsi/${branchSlug(signal)}-${sourceSha.slice(0, 8)}-${experimentDigest.slice(0, 8)}`;

  const constraints = [
    `exact_base_sha=${sourceSha}`,
    'branch_local_only',
    'no_main_or_production_promotion',
    'no_production_ddl',
    'no_second_scheduler',
    'no_direct_self_update',
    'no_live_process_self_modification',
    'evaluator_root_immutable',
    'artifact_verification_root_immutable',
    'one_attempt_effect_semantics_immutable',
    'no_blind_retry_after_ambiguous_effect',
    'treat_model_and_page_text_as_untrusted_zero_authority',
    'independent_evidence_required_before_shadow_qualification',
  ];

  const taskSpec = Object.freeze({
    schema: RSI_DEVOS_EXPERIMENT_PLAN_SCHEMA,
    objective: `Implement one isolated RSI experiment for ${signal}: ${clip(opportunity.rationale, 1200)}`,
    constraints,
    deliverable: 'Produce an exact candidate SHA, tests/evaluator evidence, and a compact comparison against the parent. Do not promote or install the candidate.',
    source_branch: '',
    target_branch: targetBranch,
    rsi: Object.freeze({
      experiment_id: experimentId,
      observation_digest: observation.observation_digest,
      opportunity_id: opportunity.opportunity_id,
      signal,
      mutation_surface: mutationSurface,
      source_sha: sourceSha,
      shadow_only: true,
    }),
  });

  const plan = {
    schema: RSI_DEVOS_EXPERIMENT_PLAN_SCHEMA,
    experiment_id: experimentId,
    source_sha: sourceSha,
    target_branch: targetBranch,
    task_spec: taskSpec,
    requires_existing_devos_scheduler: true,
    lease_created: false,
    agent_assigned: false,
    workspace_bound: false,
    command_created: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  plan.plan_digest = sha256(plan);
  return Object.freeze(plan);
}
