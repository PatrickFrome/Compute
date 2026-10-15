// W48 source-only staging guard. Not an executor, scheduler, task database or LIVE attestation.
// Invoked only after the existing Supervisor/Owner and DevOS leased cycle produce readbacks.
import { createHash } from 'node:crypto';
import { planFleetDagClaims } from '../../apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/fleet-dag-claim-plan.mjs';
import { readBoundClientAgentCompletion } from './operator-agent-completion-bound-w39.mjs';

export const W48_SCHEMA = 'metaengine.client.serial-loop-staging-w48.v1';
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const safe = x => Number.isSafeInteger(x) && x > 0;
const hex = s => String(s ?? '').toLowerCase();
const sha256 = value => createHash('sha256').update(value).digest('hex');
const locked = (reason, state = 'UNKNOWN') => Object.freeze({
  schema: W48_SCHEMA, state, reason, origin: 'SYNTHETIC/STAGING',
  automatic_retry_allowed: false, live_completion_verified: false,
  permission_to_claim: false, permission_to_edit: false,
  promotion_authorized: false, authority_effect: false,
});

// The W30 reducer is recomputed, not accepted as an arbitrary caller proof.
// The actual role-only claim remains the existing /v1/devos/cycle lease RPC.
export function inspectStagingLease({ snapshot, runtimeControl, cycle, workspace_id,
  task_id, agent_id, lease_generation } = {}) {
  if (!UUID.test(hex(workspace_id)) || !UUID.test(hex(task_id))
      || !/^agent_[a-z0-9-]{8,64}$/.test(String(agent_id))
      || !safe(lease_generation)) return locked('BINDING_INVALID');
  const plan = planFleetDagClaims({ snapshot, runtimeControl, workspaceId: workspace_id });
  if (!plan || plan.state !== 'OPEN' || plan.proof_state !== 'CONSISTENT_NOT_AUTHORITY'
      || plan.ready < 1 || plan.by_role?.IMPLEMENTER < 1)
    return locked('W30_DAG_OR_OWNER_FENCED');
  if (!cycle || cycle.schema !== 'metaengine.devos.browser-cycle.v1' || cycle.state !== 'OPEN'
      || cycle.admission_fenced !== false || cycle.lease_fenced !== false
      || cycle.second_scheduler_loop !== false || cycle.authority_effect !== false
      || cycle.runtime_control?.workspace_id !== workspace_id
      || cycle.runtime_control?.generation_floor !== runtimeControl?.generation_floor
      || cycle.fleet_dag_admission?.state !== 'OPEN'
      || cycle.fleet_dag_admission?.ready !== plan.ready
      || cycle.lease_attempts !== 1 || !Array.isArray(cycle.leases)
      || cycle.leases.length !== 1)
    return locked('SINGLE_EXECUTOR_READBACK_MISMATCH');
  const lease = cycle.leases[0];
  if (lease?.leased !== true || hex(lease.task_id) !== hex(task_id)
      || lease.agent_id !== agent_id || lease.role !== 'IMPLEMENTER'
      || lease.lease_generation !== lease_generation
      || !snapshot.active_tasks.some(t => hex(t?.task_id) === hex(task_id)
        && t.state === 'READY' && t.role === 'IMPLEMENTER'))
    return locked('EXACT_LEASE_NOT_PROVEN');
  return Object.freeze({
    schema: W48_SCHEMA, state: 'STAGING_LEASE_OBSERVED',
    origin: 'SYNTHETIC/STAGING', workspace_id, task_id, agent_id,
    lease_generation, owner_generation: runtimeControl.generation_floor,
    existing_executor: 'EXISTING_DEVOS_FLEET_LEASE_V1',
    automatic_retry_allowed: false, live_completion_verified: false,
    permission_to_claim: false, permission_to_edit: false,
    promotion_authorized: false, authority_effect: false,
  });
}

export function sealStagingCheckpoint({ lease, effect, source, tests, artifact, critic,
  ready_at_ms, completed_at_ms } = {}) {
  if (lease?.schema !== W48_SCHEMA || lease.state !== 'STAGING_LEASE_OBSERVED')
    return locked('STAGING_LEASE_MISSING');
  if (effect?.operation !== 'FIXED_SANDBOX_SOURCE_EDIT' ||
      effect?.state !== 'ACKED' || effect?.ack_durable !== true ||
      effect?.task_id !== lease.task_id || effect?.lease_generation !== lease.lease_generation ||
      !UUID.test(hex(effect.effect_id)))
    return locked('EFFECT_NOT_DURABLY_RECONCILED', 'AMBIGUOUS');
  if (!SHA.test(hex(source?.base_sha)) || !SHA.test(hex(source?.head_sha)) ||
      hex(source.base_sha) === hex(source.head_sha) || source?.repo_scope !== 'UNIQUE_TEMP_GIT')
    return locked('TEMP_SOURCE_PROOF_MISSING');
  if (tests?.before_exit_code !== 1 || tests?.after_exit_code !== 0 ||
      tests?.build_exit_code !== 0 || tests?.working_tree_clean !== true)
    return locked('FAILING_TO_PASSING_TEST_NOT_PROVEN');
  if (!DIGEST.test(hex(artifact?.file_sha256)) ||
      !DIGEST.test(hex(artifact?.manifest_sha256)) ||
      artifact?.source_head_sha !== source.head_sha ||
      artifact?.origin !== 'SYNTHETIC/STAGING')
    return locked('ARTIFACT_DIGEST_UNPROVEN');
  if (critic?.source !== 'INDEPENDENT_DISPOSABLE_PROCESS' ||
      critic.agent_id === lease.agent_id ||
      !/^agent_[a-z0-9-]{8,64}$/.test(String(critic.agent_id)) ||
      critic?.verdict !== 'ACCEPT' ||
      hex(critic?.artifact_sha256) !== hex(artifact.manifest_sha256) ||
      hex(critic?.source_head_sha) !== hex(source.head_sha))
    return locked('INDEPENDENT_CRITIC_BINDING_MISSING');
  if (!safe(ready_at_ms) || !safe(completed_at_ms) ||
      completed_at_ms < ready_at_ms || completed_at_ms >= ready_at_ms + 86_400_000)
    return locked('RESULT_READY_EXPIRED');
  const record = Object.freeze({
    schema: W48_SCHEMA, origin: 'SYNTHETIC/STAGING',
    workspace_id: lease.workspace_id, task_id: lease.task_id,
    agent_id: lease.agent_id, lease_generation: lease.lease_generation,
    owner_generation: lease.owner_generation, effect_id: effect.effect_id,
    base_sha: hex(source.base_sha), source_sha: hex(source.head_sha),
    file_sha256: hex(artifact.file_sha256),
    artifact_sha256: hex(artifact.manifest_sha256),
    critic_agent_id: critic.agent_id, critic_digest: hex(critic.artifact_sha256),
    ready_at_ms, completed_at_ms,
  });
  return Object.freeze({
    ...record, checkpoint_sha256: sha256(JSON.stringify(record)),
    state: 'STAGING_REVIEW_REQUIRED', own_pg_checkpoint: 'UNPROVEN',
    w39_live_completion: 'UNKNOWN', authority_effect: false,
    live_completion_verified: false, promotion_authorized: false,
    automatic_retry_allowed: false, permission_to_claim: false,
    permission_to_edit: false,
  });
}

// A digest-shaped value is NOT proof of an immutable checkpoint. Recompute
// the precise W48 canonical record before comparing with the PostgreSQL row.
// Otherwise an edited source/critic/owner field could be paired with a stale
// checkpoint_sha256 and incorrectly become NEXT_TASK_ELIGIBLE_STAGING_ONLY.
export function verifyStagingCheckpointDigest(checkpoint) {
  if (checkpoint?.schema !== W48_SCHEMA || checkpoint.state !== 'STAGING_REVIEW_REQUIRED'
      || checkpoint.origin !== 'SYNTHETIC/STAGING'
      || !UUID.test(hex(checkpoint.workspace_id)) || !UUID.test(hex(checkpoint.task_id))
      || !UUID.test(hex(checkpoint.effect_id))
      || !/^agent_[a-z0-9-]{8,64}$/.test(String(checkpoint.agent_id))
      || !/^agent_[a-z0-9-]{8,64}$/.test(String(checkpoint.critic_agent_id))
      || checkpoint.agent_id === checkpoint.critic_agent_id
      || !safe(checkpoint.lease_generation) || !safe(checkpoint.owner_generation)
      || !SHA.test(hex(checkpoint.base_sha)) || !SHA.test(hex(checkpoint.source_sha))
      || checkpoint.base_sha === checkpoint.source_sha
      || ![checkpoint.file_sha256, checkpoint.artifact_sha256,
           checkpoint.critic_digest, checkpoint.checkpoint_sha256].every(x => DIGEST.test(hex(x)))
      || checkpoint.critic_digest !== checkpoint.artifact_sha256
      || !safe(checkpoint.ready_at_ms) || !safe(checkpoint.completed_at_ms)
      || checkpoint.completed_at_ms < checkpoint.ready_at_ms
      || checkpoint.completed_at_ms >= checkpoint.ready_at_ms + 86_400_000) return false;
  const record = {
    schema: W48_SCHEMA, origin: 'SYNTHETIC/STAGING',
    workspace_id: checkpoint.workspace_id, task_id: checkpoint.task_id,
    agent_id: checkpoint.agent_id, lease_generation: checkpoint.lease_generation,
    owner_generation: checkpoint.owner_generation, effect_id: checkpoint.effect_id,
    base_sha: checkpoint.base_sha, source_sha: checkpoint.source_sha,
    file_sha256: checkpoint.file_sha256, artifact_sha256: checkpoint.artifact_sha256,
    critic_agent_id: checkpoint.critic_agent_id, critic_digest: checkpoint.critic_digest,
    ready_at_ms: checkpoint.ready_at_ms, completed_at_ms: checkpoint.completed_at_ms,
  };
  return sha256(JSON.stringify(record)) === checkpoint.checkpoint_sha256;
}

// Reconciliation is read-only. No "resume then replay" on crash/lost ACK.
export function inspectStagingRestart({ checkpoint, pgReadback, effect, requested_task_id,
  requested_lease_generation, observed_at_ms = Date.now() } = {}) {
  if (effect?.state === 'PREPARED' || effect?.state === 'AMBIGUOUS' ||
      effect?.ack_durable !== true)
    return locked('PREPARED_OR_LOST_ACK_NEEDS_EXISTING_EFFECT_RECONCILIATION', 'AMBIGUOUS');
  if (!verifyStagingCheckpointDigest(checkpoint))
    return locked('CHECKPOINT_INVALID');
  if (!safe(observed_at_ms) || observed_at_ms >= checkpoint.ready_at_ms + 86_400_000)
    return locked('RESULT_READY_EXPIRED');
  if (!pgReadback || pgReadback.backend !== 'OWN_PG17_DISPOSABLE' ||
      pgReadback.origin !== 'SYNTHETIC/STAGING' ||
      pgReadback.checkpoint_sha256 !== checkpoint.checkpoint_sha256 ||
      pgReadback.task_id !== checkpoint.task_id ||
      pgReadback.lease_generation !== checkpoint.lease_generation ||
      pgReadback.source_sha !== checkpoint.source_sha ||
      pgReadback.artifact_sha256 !== checkpoint.artifact_sha256 ||
      pgReadback.effect_id !== checkpoint.effect_id)
    return locked('DURABLE_OWN_PG_READBACK_MISSING');
  if (requested_task_id === checkpoint.task_id)
    return locked('COMPLETED_TASK_REPLAY_FORBIDDEN', 'FENCED');
  if (!UUID.test(hex(requested_task_id)) || !safe(requested_lease_generation))
    return locked('NEXT_TASK_BINDING_UNKNOWN');
  // Only an eligibility observation: the next task still needs a NEW lease from
  // the same real Owner/Supervisor. Not a local task claim, edit or Send.
  return Object.freeze({
    schema: W48_SCHEMA, state: 'NEXT_TASK_ELIGIBLE_STAGING_ONLY',
    origin: 'SYNTHETIC/STAGING', after_task_id: checkpoint.task_id,
    next_task_id: requested_task_id,
    next_lease_generation: requested_lease_generation,
    authority_effect: false, permission_to_claim: false,
    permission_to_edit: false, live_completion_verified: false,
    promotion_authorized: false, automatic_retry_allowed: false,
  });
}

// W39 must still be invoked using native-Owner and real own-PG callbacks for
// LIVE. Fake Supervisor/critic/readback content cannot turn STAGING into LIVE.
export async function inspectLiveCompletionForStaging(options = {}) {
  const result = await readBoundClientAgentCompletion(options);
  return Object.freeze({
    schema: W48_SCHEMA, state: 'LIVE_UNKNOWN', origin: 'SYNTHETIC/STAGING',
    w39_state: result?.state ?? 'UNKNOWN', w39_reason: result?.reason ?? null,
    live_completion_verified: false, authority_effect: false,
    promotion_authorized: false, automatic_retry_allowed: false,
  });
}
