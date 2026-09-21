const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const AGENT_RE = /^agent_[a-z0-9-]{8,64}$/;
const TAB_RE = /^tab_[a-z0-9-]{8,96}$/i;
const TARGET_RE = /^webcontents:[1-9][0-9]*$/;
const LOCAL_TARGET_SOURCE = 'METAENGINE_BROWSER_LOCAL_WEBCONTENTS';

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`workspace_reincarnation_${name}_invalid`);
  return value;
}
function lower(value) { return String(value ?? '').trim().toLowerCase(); }
function upper(value) { return String(value ?? '').trim().toUpperCase(); }
function exact(actual, expected, code) {
  if (String(actual ?? '') !== String(expected ?? '')) throw new Error(`workspace_reincarnation_${code}`);
}
function positive(value, name) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1) throw new Error(`workspace_reincarnation_${name}_invalid`);
  return out;
}
function uuid(value, name) {
  const out = lower(value);
  if (!UUID_RE.test(out)) throw new Error(`workspace_reincarnation_${name}_invalid`);
  return out;
}
function sha(value, name) {
  const out = lower(value);
  if (!SHA_RE.test(out)) throw new Error(`workspace_reincarnation_${name}_invalid`);
  return out;
}
function timestamp(value, name) {
  const out = Date.parse(String(value ?? ''));
  if (!Number.isFinite(out)) throw new Error(`workspace_reincarnation_${name}_invalid`);
  return out;
}
function zeroAuthority(row, name) {
  for (const key of ['authority_effect', 'page_data_authority', 'model_output_authority', 'browser_authority', 'scheduler_authority']) {
    if (key in row && row[key] !== false) throw new Error(`workspace_reincarnation_${name}_${key}_invalid`);
  }
}

/**
 * Build a zero-authority predecessor -> successor candidate after Browser restart.
 *
 * The DevOS scheduler remains the only task/claim allocator. The existing C5 transport
 * boundary remains the only authority allowed to promote a Browser incarnation to ACTIVE.
 * This function merely verifies durable readbacks from those already-completed boundaries.
 * It never mutates the Workspace registry, allocates a lease, promotes Fleet transport,
 * executes Git, or actuates Browser UI.
 */
export function proveWorkspaceReincarnationCandidate({
  predecessor,
  successor_agent,
  local_target_observation,
  scheduler_task,
  claim,
  worktree_readback,
  now_ms = Date.now(),
} = {}) {
  const before = object(predecessor, 'predecessor');
  const agent = object(successor_agent, 'successor_agent');
  const observation = object(local_target_observation, 'local_target_observation');
  const task = object(scheduler_task, 'scheduler_task');
  const nextClaim = object(claim, 'claim');
  const worktree = object(worktree_readback, 'worktree_readback');

  if (before.schema !== 'metaengine.devos.workspace-binding.v1' || before.state !== 'READY') {
    throw new Error('workspace_reincarnation_predecessor_not_ready');
  }
  zeroAuthority(before, 'predecessor');
  if (before.ambiguity_code || before.dirty_hold === true || before.automatic_retry_allowed !== false) {
    throw new Error('workspace_reincarnation_predecessor_hold');
  }

  const workspaceId = uuid(before.workspace_id, 'workspace_id');
  const predecessorBindingId = before.binding_id == null ? null : uuid(before.binding_id, 'binding_id');
  const coordinationWorkspaceId = uuid(before.coordination_workspace_id, 'coordination_workspace_id');
  const taskId = uuid(before.task_id, 'task_id');
  const predecessorWorkspaceGeneration = positive(before.workspace_generation, 'workspace_generation');
  const predecessorAgentGeneration = positive(before.agent_generation_epoch, 'predecessor_agent_generation_epoch');
  const predecessorLeaseGeneration = positive(before.lease_generation, 'predecessor_lease_generation');
  const agentId = lower(before.agent_id);
  const predecessorTabId = lower(before.tab_id);
  const predecessorTargetId = lower(before.target_id);
  const baseSha = sha(before.base_sha, 'base_sha');
  const branchName = String(before.branch_name || '').trim();
  const pointId = lower(before.point_id);
  const worktreePath = String(before.worktree_path || '').trim();
  if (!AGENT_RE.test(agentId) || !TAB_RE.test(predecessorTabId) || !TARGET_RE.test(predecessorTargetId) || !branchName || !pointId || !worktreePath) {
    throw new Error('workspace_reincarnation_predecessor_identity_invalid');
  }

  if (upper(agent.lifecycle_state) !== 'ACTIVE' || upper(agent.ownership) !== 'FLEET_OWNED') {
    throw new Error('workspace_reincarnation_successor_not_transport_admitted');
  }
  zeroAuthority(agent, 'successor_agent');
  if (agent.automatic_retry_allowed !== false) throw new Error('workspace_reincarnation_successor_retry_policy_invalid');
  const successorAgentId = lower(agent.agent_id);
  const successorTabId = lower(agent.tab_id);
  const successorTargetId = lower(agent.target_id);
  const successorAgentGeneration = positive(agent.generation_epoch, 'successor_agent_generation_epoch');
  if (!AGENT_RE.test(successorAgentId) || !TAB_RE.test(successorTabId) || !TARGET_RE.test(successorTargetId)) {
    throw new Error('workspace_reincarnation_successor_identity_invalid');
  }
  exact(successorAgentId, agentId, 'successor_agent_mismatch');
  if (successorAgentGeneration <= predecessorAgentGeneration) throw new Error('workspace_reincarnation_agent_generation_not_advanced');
  if (successorTabId === predecessorTabId) throw new Error('workspace_reincarnation_tab_incarnation_not_replaced');
  if (successorTargetId === predecessorTargetId) throw new Error('workspace_reincarnation_target_incarnation_not_replaced');

  const transportProof = object(agent.transport_proof, 'transport_proof');
  zeroAuthority(transportProof, 'transport_proof');
  if (transportProof.schema !== 'metaengine.browser.fleet-transport-proof.v1') throw new Error('workspace_reincarnation_transport_proof_schema_invalid');
  exact(lower(transportProof.tab_id), successorTabId, 'transport_proof_tab_mismatch');
  exact(lower(transportProof.target_id), successorTargetId, 'transport_proof_target_mismatch');
  exact(positive(transportProof.generation_epoch, 'transport_proof_generation_epoch'), successorAgentGeneration, 'transport_proof_generation_mismatch');
  if (!SHA256_RE.test(lower(transportProof.conversation_url_sha256))) throw new Error('workspace_reincarnation_transport_proof_hash_invalid');
  const transportProvenAt = timestamp(transportProof.proven_at, 'transport_proof_time');
  if (transportProvenAt > Number(now_ms) + 5000) throw new Error('workspace_reincarnation_transport_proof_time_in_future');

  if (observation.schema !== 'metaengine.browser.fleet-local-target-observation.v1'
      || observation.source !== LOCAL_TARGET_SOURCE
      || observation.authority_effect !== false
      || observation.tab_exists !== true) {
    throw new Error('workspace_reincarnation_local_target_not_proven');
  }
  exact(lower(observation.tab_id), successorTabId, 'observation_tab_mismatch');
  exact(lower(observation.target_id), successorTargetId, 'observation_target_mismatch');

  zeroAuthority(task, 'scheduler_task');
  if (!['LEASED', 'RUNNING'].includes(upper(task.state))) throw new Error('workspace_reincarnation_task_not_leased');
  if (upper(task.claim_class) !== 'MUTATING') throw new Error('workspace_reincarnation_task_not_mutating');
  exact(uuid(task.workspace_id, 'task_workspace_id'), coordinationWorkspaceId, 'task_workspace_mismatch');
  exact(uuid(task.task_id, 'scheduler_task_id'), taskId, 'task_id_mismatch');
  exact(lower(task.point_id), pointId, 'task_point_mismatch');
  exact(sha(task.base_sha, 'task_base_sha'), baseSha, 'task_base_mismatch');
  exact(String(task.branch_name || '').trim(), branchName, 'task_branch_mismatch');
  exact(lower(task.lease_agent_id), agentId, 'task_agent_mismatch');
  exact(lower(task.lease_tab_id), successorTabId, 'task_tab_mismatch');
  exact(lower(task.lease_target_id), successorTargetId, 'task_target_mismatch');
  exact(positive(task.lease_agent_generation_epoch, 'task_agent_generation_epoch'), successorAgentGeneration, 'task_agent_generation_mismatch');
  const taskLeaseGeneration = positive(task.lease_generation, 'task_lease_generation');
  const taskLeaseExpiresAt = timestamp(task.lease_expires_at, 'task_lease_expires_at');
  if (taskLeaseExpiresAt <= Number(now_ms)) throw new Error('workspace_reincarnation_task_lease_not_fresh');

  zeroAuthority(nextClaim, 'claim');
  if (upper(nextClaim.state) !== 'ACTIVE') throw new Error('workspace_reincarnation_claim_not_active');
  if (upper(nextClaim.claim_class) !== 'MUTATING') throw new Error('workspace_reincarnation_claim_not_mutating');
  const claimId = positive(nextClaim.claim_id, 'claim_id');
  const leaseGeneration = positive(nextClaim.lease_generation, 'lease_generation');
  const leaseExpiresAt = timestamp(nextClaim.expires_at, 'claim_expires_at');
  if (leaseExpiresAt <= Number(now_ms)) throw new Error('workspace_reincarnation_lease_not_fresh');
  if (leaseGeneration <= predecessorLeaseGeneration) throw new Error('workspace_reincarnation_lease_generation_not_advanced');
  exact(leaseGeneration, taskLeaseGeneration, 'claim_task_lease_generation_mismatch');
  exact(leaseExpiresAt, taskLeaseExpiresAt, 'claim_task_expiry_mismatch');
  exact(uuid(nextClaim.workspace_id, 'claim_workspace_id'), coordinationWorkspaceId, 'claim_workspace_mismatch');
  exact(uuid(nextClaim.task_id, 'claim_task_id'), taskId, 'claim_task_mismatch');
  exact(lower(nextClaim.point_id), pointId, 'claim_point_mismatch');
  exact(sha(nextClaim.base_sha, 'claim_base_sha'), baseSha, 'claim_base_mismatch');
  exact(upper(nextClaim.role), upper(task.role), 'claim_role_mismatch');
  if (agent.role != null) exact(upper(agent.role), upper(task.role), 'successor_role_mismatch');
  exact(lower(nextClaim.agent_id), agentId, 'claim_agent_mismatch');
  exact(lower(nextClaim.tab_id), successorTabId, 'claim_tab_mismatch');
  exact(lower(nextClaim.target_id), successorTargetId, 'claim_target_mismatch');
  exact(positive(nextClaim.agent_generation_epoch, 'claim_agent_generation_epoch'), successorAgentGeneration, 'claim_agent_generation_mismatch');

  if (worktree.schema !== 'metaengine.devos.workspace-reincarnation-worktree-readback.v1') {
    throw new Error('workspace_reincarnation_worktree_schema_invalid');
  }
  zeroAuthority(worktree, 'worktree_readback');
  if (worktree.dirty !== false || worktree.ambiguous !== false) throw new Error('workspace_reincarnation_worktree_not_clean');
  exact(String(worktree.branch_name || '').trim(), branchName, 'worktree_branch_mismatch');
  exact(String(worktree.worktree_path || '').trim(), worktreePath, 'worktree_path_mismatch');
  const verifiedHead = sha(worktree.head_sha, 'worktree_head_sha');
  const predecessorVerifiedHead = sha(before.last_verified_head_sha || before.initial_head_sha || before.base_sha, 'predecessor_verified_head_sha');
  exact(verifiedHead, predecessorVerifiedHead, 'worktree_head_mismatch');

  return Object.freeze({
    schema: 'metaengine.devos.workspace-reincarnation-candidate.v1',
    eligible_for_db_transition: true,
    predecessor: Object.freeze({
      binding_id: predecessorBindingId,
      workspace_id: workspaceId,
      workspace_generation: predecessorWorkspaceGeneration,
      task_id: taskId,
      claim_id: positive(before.claim_id, 'predecessor_claim_id'),
      agent_id: agentId,
      tab_id: predecessorTabId,
      target_id: predecessorTargetId,
      agent_generation_epoch: predecessorAgentGeneration,
      lease_generation: predecessorLeaseGeneration,
    }),
    successor: Object.freeze({
      workspace_generation: predecessorWorkspaceGeneration + 1,
      claim_id: claimId,
      agent_id: agentId,
      tab_id: successorTabId,
      target_id: successorTargetId,
      agent_generation_epoch: successorAgentGeneration,
      lease_generation: leaseGeneration,
      lease_expires_at: new Date(leaseExpiresAt).toISOString(),
      base_sha: baseSha,
      branch_name: branchName,
      worktree_path: worktreePath,
      verified_head_sha: verifiedHead,
    }),
    transition_rpc_required: true,
    transition_already_performed: false,
    preexisting_transport_proof_verified: true,
    fleet_transport_promoted_by_this_proof: false,
    scheduler_claim_created_by_this_proof: false,
    url_authority: false,
    title_authority: false,
    continuity_receipt_authority: false,
    automatic_retry_allowed: false,
    scheduler_authority: false,
    browser_actuation_authority: false,
    page_data_authority: false,
    authority_effect: false,
  });
}
