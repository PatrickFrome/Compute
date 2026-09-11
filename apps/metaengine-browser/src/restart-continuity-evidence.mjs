export const RESTART_CONTINUITY_EVIDENCE_SCHEMA = 'metaengine.restart.continuity-evidence.v2';

const GIT_SHA_RE = /^[0-9a-f]{40}$/;

function requiredString(value, name) {
  const out = String(value ?? '').trim();
  if (!out) throw new Error(`restart_continuity_${name}_required`);
  return out;
}

function exactBoolean(value, name) {
  if (value !== true && value !== false) throw new Error(`restart_continuity_${name}_boolean_required`);
  return value;
}

export function buildRestartContinuityEvidenceV2({
  workspaceId,
  clientId,
  processIncarnationId,
  supervisorEpoch,
  sourceGitSha,
  stateReadOk,
  durableHandoffReady,
  activeActuationLease,
  verifiedDownloadMutationActive,
  supervisorGeneration = 'UNKNOWN',
  queuedWakes = 0,
  activeModelRequest = false,
} = {}) {
  const workspace_id = requiredString(workspaceId, 'workspace_id');
  const client_id = requiredString(clientId, 'client_id');
  const process_incarnation_id = requiredString(processIncarnationId, 'process_incarnation_id');
  const source_git_sha = requiredString(sourceGitSha, 'source_git_sha').toLowerCase();
  if (!GIT_SHA_RE.test(source_git_sha)) throw new Error('restart_continuity_source_git_sha_invalid');

  const supervisor_epoch = Number(supervisorEpoch);
  if (!Number.isSafeInteger(supervisor_epoch) || supervisor_epoch < 0) {
    throw new Error('restart_continuity_supervisor_epoch_invalid');
  }

  const state_read_ok = exactBoolean(stateReadOk, 'state_read_ok');
  const durable_handoff_ready = exactBoolean(durableHandoffReady, 'durable_handoff_ready');
  const active_actuation_lease = exactBoolean(activeActuationLease, 'active_actuation_lease');
  const verified_download_mutation_active = exactBoolean(verifiedDownloadMutationActive, 'verified_download_mutation_active');
  const active_model_request = exactBoolean(activeModelRequest, 'active_model_request');
  const queued_wakes = Number(queuedWakes);
  if (!Number.isSafeInteger(queued_wakes) || queued_wakes < 0) throw new Error('restart_continuity_queued_wakes_invalid');

  const continuity_safe = state_read_ok
    && durable_handoff_ready
    && !active_actuation_lease
    && !verified_download_mutation_active;

  return Object.freeze({
    schema: RESTART_CONTINUITY_EVIDENCE_SCHEMA,
    workspace_id,
    client_id,
    process_incarnation_id,
    supervisor_epoch,
    source_git_sha,
    state_read_ok,
    durable_handoff_ready,
    active_actuation_lease,
    verified_download_mutation_active,
    supervisor_generation: String(supervisorGeneration || 'UNKNOWN').toUpperCase(),
    queued_wakes,
    active_model_request,
    continuity_safe,
    continuity_transfer_required: true,
    restart_authorized: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
