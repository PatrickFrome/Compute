// W71 / C2 SOURCE-only bridge. This inspects the REAL DevelopmentPlane worker
// message protocol and canonical Client goal/W30/W39 contracts. It deliberately
// does not submit a goal before a legitimate, independently attested write-capable
// worker is available: an admitted but unexecutable goal is not progress.
// No DB connection, Host bootstrap, network fallback or scheduler is created.
import { probeW64GeneratedDevelopmentWorker } from './client-serial-loop-development-worker-w64.mjs';
import { verifyStagingCheckpointDigest } from './client-serial-loop-staging-w48.mjs';
import { inspectStagingNextLease } from './client-serial-loop-staging-w56.mjs';
import { inspectLiveCompletionForStaging } from './client-serial-loop-staging-w48.mjs';

export const W71_SCHEMA = 'metaengine.client.c2-existing-worker-gate-w71.v1';
export const W71_EXISTING_ENTRYPOINTS = Object.freeze({
  admission: 'public.client_v1_goal_submit_v1',
  task_admission: 'public.meta_orchestrator_task_admit_v1',
  claim: 'public.devos_fleet_lease_v1',
  result: 'public.devos_fleet_complete_v1',
  critic_readback: 'readBoundClientAgentCompletion/W39',
  worker: 'DevelopmentPlane/REPO_HEAD_READ',
});
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{40}$/;
const flags = Object.freeze({
  origin: 'SOURCE/STAGING', authority_effect: false,
  automatic_retry_allowed: false, permission_to_claim: false,
  permission_to_edit: false, admission_authorized: false,
  live_completion_verified: false, promotion_authorized: false,
});
function fenced(reason, evidence = null) {
  return Object.freeze({ schema: W71_SCHEMA, state: 'C2_CAPABILITY_BLOCKED',
    reason, existing_entrypoints: W71_EXISTING_ENTRYPOINTS,
    evidence, ...flags });
}
const isPlain = x => x && typeof x === 'object' && !Array.isArray(x)
  && (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
const falseFlags = v => isPlain(v) && ['authority_effect', 'scheduler_authority',
  'browser_authority', 'release_authority','automatic_retry_allowed']
  .every(key => v[key] === false);

// A goal-submit RPC reply is an ADMISSION observation, never a lease or an
// effect credential. Recheck both nested canonical replies and exact identity.
// Untrusted JSON cannot satisfy worker/effect authority.
export function inspectW71GoalAdmission({admission, workspace_id, point_id} = {}) {
  if (!ID.test(String(workspace_id)) || !/^[a-z0-9][a-z0-9._:-]{2,191}$/.test(String(point_id)))
    return fenced('GOAL_IDENTITY_INVALID');
  if (!isPlain(admission) || admission.schema !== 'metaengine.client-v1.goal-submit.v1'
    || String(admission.workspace_id).toLowerCase() !== workspace_id.toLowerCase()
    || admission.point_id !== point_id || admission.roadmap_id !== 'metaengine-client-v1'
    || !Number.isSafeInteger(admission.plan_generation) || admission.plan_generation < 1
    || !ID.test(String(admission.task_id)) || admission.atomic_plan_and_admission !== true
    || admission.operator_initiated !== true
    || admission.task_payload_returned !== false || admission.scheduler_identity_returned !== false
    || !falseFlags(admission) || !isPlain(admission.activation)
    || admission.activation.schema !== 'metaengine.meta-orchestrator.plan-state.v1'
    || admission.activation.state !== 'ACTIVE'
    || admission.activation.plan_generation !== admission.plan_generation
    || !falseFlags(admission.activation)
    || !isPlain(admission.admission)
    || admission.admission.schema !== 'metaengine.meta-orchestrator.task-admission.v1'
    || admission.admission.point_id !== point_id
    || admission.admission.task_id !== admission.task_id
    || admission.admission.task_payload_returned !== false
    || admission.admission.scheduler_identity_returned !== false
    || !falseFlags(admission.admission))
    return fenced('GOAL_ADMISSION_NOT_CANONICALLY_BOUND');
  return Object.freeze({schema:W71_SCHEMA,state:'ADMISSION_SHAPE_ONLY',
    task_id:admission.task_id,workspace_id,plan_generation:admission.plan_generation,
    origin:'SOURCE/STAGING',admission_authenticated:false,
    effect_claim_proven:false,independent_critic_proven:false,
    ...flags});
}

// Real W64 worker is an existing read-only DevelopmentPlane actor. A goal
// must NOT be admitted and marked successful based on a test fixture Git edit.
// This function requests the real worker, checks source/epoch and W48/W56
// readbacks, then discriminates: absent authenticated mutable worker -> CLOSED.
// It never accepts a caller-provided "capabilities" or "verified" field.
export async function probeW71ExistingC2({
  sourceDir, expected_source_sha, goal, workspace_id, point_id,
  completedCheckpoint, completedPgReadback, completedEffect,
  nextLease, nextPgLeaseReadback, owner_epoch,
} = {}) {
  if (!SHA.test(String(expected_source_sha))
      || !Number.isSafeInteger(owner_epoch) || owner_epoch < 1)
    return fenced('SOURCE_OR_OWNER_EPOCH_INVALID');
  const worker = await probeW64GeneratedDevelopmentWorker(sourceDir);
  if (worker.head !== expected_source_sha
      || worker.origin !== 'SYNTHETIC/STAGING' || worker.edit_authority !== false
      || worker.authority_effect !== false)
    return fenced('ACTUAL_WORKER_SOURCE_OR_AUTHORITY_MISMATCH');
  // Never derive a credential or Owner epoch from generated task JSON.
  const admission = inspectW71GoalAdmission({admission:goal, workspace_id, point_id});
  if (goal != null && admission.state !== 'ADMISSION_SHAPE_ONLY')
    return fenced('ADMISSION_INVALID', {worker_head:worker.head,reason:admission.reason});
  const hasCheckpoint = completedCheckpoint != null;
  if (hasCheckpoint && (!verifyStagingCheckpointDigest(completedCheckpoint)
      || completedCheckpoint.owner_generation !== owner_epoch))
    return fenced('CHECKPOINT_OR_EPOCH_STALE',{worker_head:worker.head});
  if (nextLease != null) {
    if (!hasCheckpoint) return fenced('PREDECESSOR_MISSING',{worker_head:worker.head});
    const next = inspectStagingNextLease({
      completedCheckpoint, completedPgReadback, completedEffect,
      nextLease, nextPgLeaseReadback,
    });
    if (next.state !== 'NEXT_LEASE_READBACK_STAGING_ONLY')
      return fenced('W30_NEXT_LEASE_UNPROVEN',{worker_head:worker.head,reason:next.reason});
    if (goal != null && (nextLease.task_id !== goal.task_id
        || nextLease.workspace_id !== workspace_id
        || nextLease.owner_generation !== owner_epoch))
      return fenced('GOAL_LEASE_BINDING_MISMATCH',{worker_head:worker.head});
  }
  // All optional shape/readback evidence is advisory: actual worker has no
  // FIXED_SANDBOX_SOURCE_EDIT, execution sandbox, or current promotion API.
  return fenced('EXISTING_DEVELOPMENT_WORKER_READ_ONLY',{
    worker_protocol:'metaengine.development-plane.v1',
    worker_capability:worker.capability, worker_head:worker.head,
    submission:goal == null?'NOT_PERFORMED':'UNTRUSTED_ADMISSION_SHAPE_ONLY',
    claim:nextLease == null?'NOT_PERFORMED':'STAGING_ONLY',
    checkpoint:hasCheckpoint?'SYNTHETIC/STAGING':'NOT_PRESENT',
    W39:'OWNER_BOUND_INDEPENDENT_CRITIC_NOT_PROVEN',
    forbidden_mutation:'SANDBOX_EXECUTE',
  });
}

// Route to W39's EXISTING independent verification only. No caller-side
// 'ready' flag, fixture critic or restored checkpoint can promote this result.
export async function inspectW71LiveOnlyThroughW39(expected) {
  const evidence = await inspectLiveCompletionForStaging({expected});
  return Object.freeze({schema:W71_SCHEMA,state:'C2_CAPABILITY_BLOCKED',
    reason:'AUTHENTIC_OWNER_AND_INDEPENDENT_CRITIC_REQUIRED',
    w39_state:evidence.w39_state,w39_reason:evidence.w39_reason,
    existing_entrypoints:W71_EXISTING_ENTRYPOINTS, ...flags});
}
