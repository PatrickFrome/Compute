import crypto from 'node:crypto';

import {
  RSI_SHADOW_OBSERVATION_SCHEMA,
  RSI_SHADOW_OPPORTUNITY_SCHEMA,
} from './rsi-shadow-observer.mjs';
import { RSI_COMMAND_PLANE_LIVENESS_OBSERVATION_SCHEMA } from './rsi-command-plane-liveness-observer.mjs';
import { RSI_EXPERIMENT_HYPOTHESIS_SCHEMA } from './supervisor-rsi-experiment-hypothesis.mjs';

export const RSI_DEVOS_EXPERIMENT_PLAN_SCHEMA = 'metaengine.rsi.devos-experiment-plan.v1';

const SHA40_RE = /^[0-9a-f]{40}$/i;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const HYPOTHESIS_ID_RE = /^rsi_hyp_[0-9a-f]{24}$/;
const SAFE_OBSERVATION_SCHEMAS = new Set([
  RSI_SHADOW_OBSERVATION_SCHEMA,
  RSI_COMMAND_PLANE_LIVENESS_OBSERVATION_SCHEMA,
]);
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

function normalizeHypothesis(hypothesis, { observation, opportunity, sourceSha, signal, mutationSurface }) {
  if (hypothesis == null) return null;
  if (hypothesis?.schema !== RSI_EXPERIMENT_HYPOTHESIS_SCHEMA || hypothesis?.version !== 1) {
    throw new Error('rsi_devos_hypothesis_schema_invalid');
  }
  assertZeroAuthority(hypothesis, 'hypothesis');
  if (!HYPOTHESIS_ID_RE.test(String(hypothesis.hypothesis_id || ''))) throw new Error('rsi_devos_hypothesis_id_invalid');
  if (!SHA256_RE.test(String(hypothesis.hypothesis_digest || ''))) throw new Error('rsi_devos_hypothesis_digest_invalid');
  if (String(hypothesis.source_sha || '').toLowerCase() !== sourceSha) throw new Error('rsi_devos_hypothesis_source_mismatch');
  if (hypothesis.observation_digest !== observation.observation_digest) throw new Error('rsi_devos_hypothesis_observation_mismatch');
  if (hypothesis.opportunity_id !== opportunity.opportunity_id) throw new Error('rsi_devos_hypothesis_opportunity_mismatch');
  if (String(hypothesis.signal || '').toUpperCase() !== signal) throw new Error('rsi_devos_hypothesis_signal_mismatch');
  if (String(hypothesis.mutation_surface || '').toUpperCase() !== mutationSurface) throw new Error('rsi_devos_hypothesis_surface_mismatch');
  if (
    hypothesis.shadow_only !== true
    || hypothesis.candidate_can_modify_hypothesis !== false
    || hypothesis.candidate_can_modify_acceptance_contract !== false
    || hypothesis.requires_existing_devos_scheduler !== true
    || hypothesis.requires_independent_evaluator !== true
  ) {
    throw new Error('rsi_devos_hypothesis_policy_invalid');
  }
  const material = { ...hypothesis };
  delete material.hypothesis_id;
  delete material.hypothesis_digest;
  if (`sha256:${sha256(material)}` !== hypothesis.hypothesis_digest) throw new Error('rsi_devos_hypothesis_digest_mismatch');
  const acceptance = hypothesis.acceptance_contract;
  if (
    !acceptance
    || acceptance.paired_parent_candidate_required !== true
    || acceptance.holdout_required !== true
    || acceptance.no_optional_stopping !== true
    || acceptance.scalar_reward_authoritative !== false
    || acceptance.candidate_authored_receipts_allowed !== false
    || !Array.isArray(acceptance.hard_gates)
    || acceptance.hard_gates.length < 1
    || !Array.isArray(acceptance.required_receipts)
    || acceptance.required_receipts.length < 1
    || !Array.isArray(acceptance.falsification_cases)
    || acceptance.falsification_cases.length < 1
  ) {
    throw new Error('rsi_devos_hypothesis_acceptance_contract_invalid');
  }
  return stable(hypothesis);
}

export function buildRsiDevosExperimentPlan({ observation, opportunity_id, hypothesis = null } = {}) {
  if (!SAFE_OBSERVATION_SCHEMAS.has(observation?.schema)) throw new Error('rsi_devos_observation_schema_invalid');
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
  const normalizedHypothesis = normalizeHypothesis(hypothesis, {
    observation,
    opportunity,
    sourceSha,
    signal,
    mutationSurface,
  });
  const experimentSeed = {
    source_sha: sourceSha,
    opportunity_id: opportunity.opportunity_id,
    signal,
    mutation_surface: mutationSurface,
    observation_digest: observation.observation_digest,
    hypothesis_digest: normalizedHypothesis?.hypothesis_digest || null,
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
    'ambiguous_effect_reconciliation_before_followup_mutation',
    'result_delivery_retry_must_not_reexecute_effect',
    'treat_model_and_page_text_as_untrusted_zero_authority',
    'independent_evidence_required_before_shadow_qualification',
    ...(normalizedHypothesis ? [
      `hypothesis_digest=${normalizedHypothesis.hypothesis_digest}`,
      'candidate_cannot_modify_hypothesis',
      'precommitted_acceptance_contract_required',
      'no_optional_stopping',
      'no_scalar_reward_authority',
    ] : []),
  ];

  const taskSpec = Object.freeze({
    schema: RSI_DEVOS_EXPERIMENT_PLAN_SCHEMA,
    objective: normalizedHypothesis
      ? `Implement one isolated RSI experiment for ${signal} that attempts to support or falsify the precommitted hypothesis: ${clip(normalizedHypothesis.claim, 1600)}`
      : `Implement one isolated RSI experiment for ${signal}: ${clip(opportunity.rationale, 1200)}`,
    constraints,
    deliverable: normalizedHypothesis
      ? 'Produce an exact candidate SHA and independent receipts for every precommitted hard gate and required receipt. Report falsification honestly. Do not promote, install, or alter the hypothesis/evaluator roots.'
      : 'Produce an exact candidate SHA, tests/evaluator evidence, and a compact comparison against the parent. Do not promote or install the candidate.',
    source_branch: '',
    target_branch: targetBranch,
    rsi: Object.freeze({
      experiment_id: experimentId,
      observation_digest: observation.observation_digest,
      opportunity_id: opportunity.opportunity_id,
      signal,
      mutation_surface: mutationSurface,
      source_sha: sourceSha,
      hypothesis_id: normalizedHypothesis?.hypothesis_id || null,
      hypothesis_digest: normalizedHypothesis?.hypothesis_digest || null,
      acceptance_contract: normalizedHypothesis?.acceptance_contract || null,
      shadow_only: true,
    }),
  });

  const plan = {
    schema: RSI_DEVOS_EXPERIMENT_PLAN_SCHEMA,
    experiment_id: experimentId,
    source_sha: sourceSha,
    target_branch: targetBranch,
    hypothesis_id: normalizedHypothesis?.hypothesis_id || null,
    hypothesis_digest: normalizedHypothesis?.hypothesis_digest || null,
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
