const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_RE = /^[0-9a-f]{40}$/;
const AGENT_RE = /^agent_[a-z0-9-]{8,64}$/;
const TAB_RE = /^tab_[a-z0-9-]{8,96}$/i;
const TARGET_RE = /^webcontents:[1-9][0-9]*$/;
const LOCAL_TARGET_SOURCE = 'METAENGINE_BROWSER_LOCAL_WEBCONTENTS';

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`workspace_reincarnation_${name}_invalid`);
  return value;
}
function lower(value) { return String(value ?? '').trim().toLowerCase(); }
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
function zeroAuthority(row, name) {
  for (const key of ['authority_effect', 'page_data_authority', 'model_output_authority', 'browser_authority', 'scheduler_authority']) {
    if (key in row && row[key] !== false) throw new Error(`workspace_reincarnation_${name}_${key}_invalid`);
  }
}

/**
 * Build a zero-authority predecessor -> successor candidate after Browser restart.
 *
 * This function never mutates the Workspace registry, never allocates a task/lease,
 * never promotes Fleet transport and never actuates Browser UI. A successful result
 * only proves that a future DB-native exact-CAS transition has enough typed evidence
 * to be attempted once by a separate authority boundary.
 */
export function proveWorkspaceReincarnationCandidate({
  predecessor,
  successor_agent,
  local_target_observation,
  claim,
  worktree_readback,
  now_ms = Date.now(),
} = {}) {
  const before = object(predecessor, 'predecessor');
  const agent = object(successor_agent, 'successor_agent');
  const observation = object(local_target_observation, 'local_target_observation');
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
  const worktreePath = String(before.worktree_path || '').trim();
  if (!AGENT_RE.test(agentId) || !TAB_RE.test(predecessorTabId) || !TARGET_RE.test(predecessorTargetId) || !branchName || !worktreePath) {
    throw new Error('workspace_reincarnation_predecessor_identity_invalid');
  }

  if (String(agent.lifecycle_state || '').toUpperCase() !== 'BOUND_UNVERIFIED') {
    throw new Error('workspace_reincarnation_successor_not_bound_unverified');
  }
  zeroAuthority(agent, 'successor_agent');
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
  if (agent.transport_proof != null) throw new Error('workspace_reincarnation_transport_promotion_not_allowed');

  if (observation.schema !== 'metaengine.browser.fleet-local-target-observation.v1'
      || observation.source !== LOCAL_TARGET_SOURCE
      || observation.authority_effect !== false
      || observation.tab_exists !== true) {
    throw new Error('workspace_reincarnation_local_target_not_proven');
  }
  exact(lower(observation.tab_id), successorTabId, 'observation_tab_mismatch');
  exact(lower(observation.target_id), successorTargetId, 'observation_target_mismatch');

  zeroAuthority(nextClaim, 'claim');
  if (String(nextClaim.claim_class || '').toUpperCase() !== 'MUTATING') throw new Error('workspace_reincarnation_claim_not_mutating');
  const claimId = positive(nextClaim.claim_id, 'claim_id');
  const leaseGeneration = positive(nextClaim.lease_generation, 'lease_generation');
  const leaseExpiresAt = Date.parse(String(nextClaim.lease_expires_at || ''));
  if (!Number.isFinite(leaseExpiresAt) || leaseExpiresAt <= Number(now_ms)) throw new Error('workspace_reincarnation_lease_not_fresh');
  if (leaseGeneration <= predecessorLeaseGeneration) throw new Error('workspace_reincarnation_lease_generation_not_advanced');
  exact(uuid(nextClaim.coordination_workspace_id ?? nextClaim.workspace_id, 'claim_workspace_id'), coordinationWorkspaceId, 'claim_workspace_mismatch');
  exact(uuid(nextClaim.task_id, 'claim_task_id'), taskId, 'claim_task_mismatch');
  exact(lower(nextClaim.agent_id), agentId, 'claim_agent_mismatch');
  exact(lower(nextClaim.tab_id), successorTabId, 'claim_tab_mismatch');
  exact(lower(nextClaim.target_id), successorTargetId, 'claim_target_mismatch');
  exact(positive(nextClaim.agent_generation_epoch, 'claim_agent_generation_epoch'), successorAgentGeneration, 'claim_agent_generation_mismatch');
  exact(sha(nextClaim.base_sha, 'claim_base_sha'), baseSha, 'claim_base_mismatch');
  exact(String(nextClaim.branch_name || '').trim(), branchName, 'claim_branch_mismatch');

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
    fleet_transport_promoted: false,
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
