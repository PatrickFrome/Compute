import crypto from 'node:crypto';

import { RSI_EPISODE_SNAPSHOT_SCHEMA } from './rsi-episode-orchestrator.mjs';
import { RSI_DEVOS_EXPERIMENT_PLAN_SCHEMA } from './rsi-devos-experiment-plan.mjs';
import { RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA } from './rsi-isolated-candidate-builder.mjs';

export const RSI_EPISODE_DEVOS_REQUEST_SCHEMA = 'metaengine.rsi.episode-devos-candidate-request.v1';
export const RSI_EPISODE_CANDIDATE_ADMISSION_SCHEMA = 'metaengine.rsi.episode-candidate-admission.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^(?:sha256:)?[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const CANDIDATE_ID_RE = /^candidate_sha256_[0-9a-f]{64}$/;

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
  if (!SHA40_RE.test(out)) throw new Error(`rsi_episode_devos_${label}_sha_invalid`);
  return out;
}

function exactDigest(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!DIGEST_RE.test(out)) throw new Error(`rsi_episode_devos_${label}_digest_invalid`);
  return out.startsWith('sha256:') ? out.slice(7) : out;
}

function safeId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_episode_devos_${label}_invalid`);
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
      throw new Error(`rsi_episode_devos_${label}_${field}_invalid`);
    }
  }
  if (Object.hasOwn(value || {}, 'automatic_retry_allowed') && value.automatic_retry_allowed !== false) {
    throw new Error(`rsi_episode_devos_${label}_automatic_retry_invalid`);
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

function verifyExperimentPlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || plan.schema !== RSI_DEVOS_EXPERIMENT_PLAN_SCHEMA) {
    throw new Error('rsi_episode_devos_plan_schema_invalid');
  }
  assertZeroAuthority(plan, 'plan');
  if (
    plan.requires_existing_devos_scheduler !== true
    || plan.lease_created !== false
    || plan.agent_assigned !== false
    || plan.workspace_bound !== false
    || plan.command_created !== false
  ) {
    throw new Error('rsi_episode_devos_plan_authority_contract_invalid');
  }
  const clone = structuredClone(plan);
  const claimed = exactDigest(clone.plan_digest, 'plan');
  delete clone.plan_digest;
  if (digest(clone) !== claimed) throw new Error('rsi_episode_devos_plan_digest_mismatch');
  return Object.freeze(structuredClone(plan));
}

function verifyEpisode(episode) {
  if (!episode || typeof episode !== 'object' || Array.isArray(episode) || episode.schema !== RSI_EPISODE_SNAPSHOT_SCHEMA) {
    throw new Error('rsi_episode_devos_episode_schema_invalid');
  }
  if (!episode.episode_id) throw new Error('rsi_episode_devos_episode_id_missing');
  assertZeroAuthority(episode, 'episode');
  const sourceSha = exactSha(episode.source_sha, 'episode_source');
  const trustRoot = exactDigest(episode.trust_root_set_digest, 'episode_trust_root');
  return Object.freeze({
    episode_id: safeId(episode.episode_id, 'episode_id'),
    source_sha: sourceSha,
    trust_root_set_digest: trustRoot,
    hypothesis_digest: exactDigest(episode.hypothesis_digest, 'episode_hypothesis'),
    mutation_surface: String(episode.mutation_surface || '').trim().toUpperCase(),
    candidate_count: Object.keys(episode.candidates || {}).length,
    max_candidates: Number(episode.max_candidates),
  });
}

export function createRsiEpisodeDevosCandidateRequest({
  episode,
  experiment_plan,
  request_generation = 1,
} = {}) {
  const normalizedEpisode = verifyEpisode(episode);
  const plan = verifyExperimentPlan(experiment_plan);
  const generation = Number(request_generation);
  if (!Number.isSafeInteger(generation) || generation < 1 || generation > 1_000_000) {
    throw new Error('rsi_episode_devos_request_generation_invalid');
  }
  const planSource = exactSha(plan.source_sha, 'plan_source');
  if (planSource !== normalizedEpisode.source_sha) throw new Error('rsi_episode_devos_source_mismatch');
  const planRsi = plan.task_spec?.rsi;
  if (!planRsi || typeof planRsi !== 'object') throw new Error('rsi_episode_devos_plan_rsi_contract_missing');
  if (String(planRsi.mutation_surface || '').trim().toUpperCase() !== normalizedEpisode.mutation_surface) {
    throw new Error('rsi_episode_devos_surface_mismatch');
  }
  const planHypothesis = plan.hypothesis_digest == null ? null : exactDigest(plan.hypothesis_digest, 'plan_hypothesis');
  if (planHypothesis !== normalizedEpisode.hypothesis_digest) throw new Error('rsi_episode_devos_hypothesis_mismatch');
  if (!Number.isSafeInteger(normalizedEpisode.max_candidates) || normalizedEpisode.max_candidates < 1) {
    throw new Error('rsi_episode_devos_episode_candidate_bound_invalid');
  }
  if (normalizedEpisode.candidate_count >= normalizedEpisode.max_candidates) {
    throw new Error('rsi_episode_devos_episode_candidate_capacity_exhausted');
  }
  const planDigest = exactDigest(plan.plan_digest, 'plan');
  const taskSpecDigest = digest(plan.task_spec);
  const requestMaterial = {
    episode_id: normalizedEpisode.episode_id,
    source_sha: normalizedEpisode.source_sha,
    trust_root_set_digest: normalizedEpisode.trust_root_set_digest,
    experiment_id: safeId(plan.experiment_id, 'experiment_id'),
    plan_digest: planDigest,
    task_spec_digest: taskSpecDigest,
    target_branch: safeId(plan.target_branch, 'target_branch'),
    request_generation: generation,
  };
  const requestDigest = digest(requestMaterial);
  return zeroAuthority({
    schema: RSI_EPISODE_DEVOS_REQUEST_SCHEMA,
    version: 1,
    request_id: `rsi_episode_devos_req_${requestDigest.slice(0, 24)}`,
    request_digest: requestDigest,
    ...requestMaterial,
    task_spec: structuredClone(plan.task_spec),
    requires_existing_devos_scheduler: true,
    external_scheduler_owner_required: true,
    dispatch_authorized: false,
    lease_created: false,
    workspace_created: false,
    task_created: false,
    one_attempt_effect_semantics_required: true,
    ambiguous_result_requires_reconciliation: true,
    repeat_after_ambiguous_result_allowed: false,
    candidate_effect_executor_exposed: false,
  });
}

function verifyRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request) || request.schema !== RSI_EPISODE_DEVOS_REQUEST_SCHEMA || request.version !== 1) {
    throw new Error('rsi_episode_devos_request_schema_invalid');
  }
  assertZeroAuthority(request, 'request');
  if (
    request.requires_existing_devos_scheduler !== true
    || request.external_scheduler_owner_required !== true
    || request.dispatch_authorized !== false
    || request.lease_created !== false
    || request.workspace_created !== false
    || request.task_created !== false
    || request.one_attempt_effect_semantics_required !== true
    || request.ambiguous_result_requires_reconciliation !== true
    || request.repeat_after_ambiguous_result_allowed !== false
    || request.candidate_effect_executor_exposed !== false
  ) throw new Error('rsi_episode_devos_request_policy_invalid');
  const core = {
    episode_id: safeId(request.episode_id, 'request_episode_id'),
    source_sha: exactSha(request.source_sha, 'request_source'),
    trust_root_set_digest: exactDigest(request.trust_root_set_digest, 'request_trust_root'),
    experiment_id: safeId(request.experiment_id, 'request_experiment_id'),
    plan_digest: exactDigest(request.plan_digest, 'request_plan'),
    task_spec_digest: exactDigest(request.task_spec_digest, 'request_task_spec'),
    target_branch: safeId(request.target_branch, 'request_target_branch'),
    request_generation: Number(request.request_generation),
  };
  if (!Number.isSafeInteger(core.request_generation) || core.request_generation < 1) throw new Error('rsi_episode_devos_request_generation_invalid');
  const expectedDigest = digest(core);
  if (request.request_digest !== expectedDigest || request.request_id !== `rsi_episode_devos_req_${expectedDigest.slice(0, 24)}`) {
    throw new Error('rsi_episode_devos_request_digest_mismatch');
  }
  if (digest(request.task_spec) !== core.task_spec_digest) throw new Error('rsi_episode_devos_request_task_spec_tampered');
  return Object.freeze({ ...core, request_id: request.request_id, request_digest: request.request_digest });
}

function verifyCandidateHandoff(handoff) {
  if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff) || handoff.schema !== RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA || handoff.version !== 1) {
    throw new Error('rsi_episode_devos_candidate_handoff_schema_invalid');
  }
  assertZeroAuthority(handoff, 'candidate_handoff');
  if (
    handoff.eligible_for_evaluation !== true
    || handoff.eligible_for_promotion !== false
    || handoff.materialization_replay_authorized !== false
  ) throw new Error('rsi_episode_devos_candidate_handoff_policy_invalid');
  const id = String(handoff.candidate_capsule?.candidate_id || '').trim().toLowerCase();
  if (!CANDIDATE_ID_RE.test(id)) throw new Error('rsi_episode_devos_candidate_id_invalid');
  return Object.freeze({
    candidate_id: id,
    candidate_sha: exactSha(handoff.candidate_sha, 'candidate'),
    parent_sha: exactSha(handoff.parent_sha, 'candidate_parent'),
    mutation_surface: String(handoff.mutation_surface || '').trim().toUpperCase(),
    handoff_digest: exactDigest(handoff.handoff_digest, 'candidate_handoff'),
  });
}

export function createRsiEpisodeCandidateAdmission({ episode, request, candidate_handoff } = {}) {
  const normalizedEpisode = verifyEpisode(episode);
  const normalizedRequest = verifyRequest(request);
  const candidate = verifyCandidateHandoff(candidate_handoff);
  if (normalizedRequest.episode_id !== normalizedEpisode.episode_id) throw new Error('rsi_episode_devos_request_episode_mismatch');
  if (normalizedRequest.source_sha !== normalizedEpisode.source_sha) throw new Error('rsi_episode_devos_request_source_mismatch');
  if (normalizedRequest.trust_root_set_digest !== normalizedEpisode.trust_root_set_digest) throw new Error('rsi_episode_devos_request_trust_root_mismatch');
  if (candidate.parent_sha !== normalizedEpisode.source_sha) throw new Error('rsi_episode_devos_candidate_parent_mismatch');
  if (candidate.candidate_sha === candidate.parent_sha) throw new Error('rsi_episode_devos_candidate_noop');
  if (candidate.mutation_surface !== normalizedEpisode.mutation_surface) throw new Error('rsi_episode_devos_candidate_surface_mismatch');
  if (Object.hasOwn(episode.candidates || {}, candidate.candidate_id)) throw new Error('rsi_episode_devos_candidate_already_registered');
  if (normalizedEpisode.candidate_count >= normalizedEpisode.max_candidates) throw new Error('rsi_episode_devos_episode_candidate_capacity_exhausted');

  const core = zeroAuthority({
    schema: RSI_EPISODE_CANDIDATE_ADMISSION_SCHEMA,
    version: 1,
    episode_id: normalizedEpisode.episode_id,
    request_id: normalizedRequest.request_id,
    request_digest: normalizedRequest.request_digest,
    source_sha: normalizedEpisode.source_sha,
    trust_root_set_digest: normalizedEpisode.trust_root_set_digest,
    candidate_id: candidate.candidate_id,
    candidate_sha: candidate.candidate_sha,
    parent_sha: candidate.parent_sha,
    mutation_surface: candidate.mutation_surface,
    candidate_handoff_digest: candidate.handoff_digest,
    external_devos_result_required: true,
    candidate_effect_executor_exposed: false,
    direct_promotion_enabled: false,
    physical_effect_replay_allowed: false,
    registration: Object.freeze({
      episode_id: normalizedEpisode.episode_id,
      candidate_id: candidate.candidate_id,
      candidate_sha: candidate.candidate_sha,
      parent_sha: candidate.parent_sha,
      build_plan_digest: candidate.handoff_digest,
      mutation_surface: candidate.mutation_surface,
    }),
  });
  return Object.freeze({ ...core, admission_digest: digest(core) });
}

export function rsiEpisodeDevosBridgeTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.episode-devos-bridge-trust-root.v1',
    immutable_component_paths: [
      'apps/metaengine-browser/src/rsi-episode-devos-bridge.mjs',
      'apps/metaengine-browser/src/rsi-episode-orchestrator.mjs',
      'apps/metaengine-browser/src/rsi-devos-experiment-plan.mjs',
      'apps/metaengine-browser/src/rsi-isolated-candidate-builder.mjs',
      'apps/metaengine-browser/src/rsi-runtime-ledger.mjs',
      'apps/metaengine-browser/src/rsi-runtime-service.mjs',
    ],
    existing_devos_scheduler_only: true,
    request_is_not_dispatch_authority: true,
    candidate_effect_executor_exposed: false,
    direct_promotion_enabled: false,
    self_update_authority: false,
    repeat_after_ambiguous_result_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, bridge_root_digest: digest(root) });
}
