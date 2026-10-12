const BINDING_SCHEMA = 'metaengine.devos.workspace-binding.v1';
const IDENTITY_FIELDS = Object.freeze([
  'workspace_id', 'workspace_generation', 'worktree_id',
  'coordination_workspace_id', 'task_id', 'claim_id', 'point_id',
  'claim_class', 'repo_id', 'repo_root', 'managed_root', 'worktree_path',
  'base_sha', 'branch_name', 'agent_id', 'tab_id', 'target_id',
  'agent_generation_epoch', 'lease_generation',
]);

function exactBinding(row, reservation, state) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('managed_project_db_binding_missing');
  for (const field of IDENTITY_FIELDS) {
    if (String(row[field]) !== String(reservation[field])) throw new Error(`managed_project_db_${field}_drift`);
  }
  if (row.state !== state || row.automatic_retry_allowed !== false || row.page_data_authority !== false || row.authority_effect !== false) {
    throw new Error('managed_project_db_state_invalid');
  }
  if (state === 'READY' && (row.initial_head_sha !== reservation.base_sha || row.worktree_realpath !== reservation.worktree_path)) {
    throw new Error('managed_project_db_ready_proof_invalid');
  }
  if (state === 'FROZEN' && !row.ambiguity_code) throw new Error('managed_project_db_freeze_missing');
  return Object.freeze(structuredClone(row));
}

function responseBinding(result, reservation, operation, state) {
  if (result?.ok !== true || result.operation !== operation || result.authority_effect !== false || result.automatic_retry_allowed === true) {
    throw new Error(`managed_project_db_${operation}_rejected`);
  }
  return exactBinding(result.binding, reservation, state);
}

function assertReservation(reservation, state = 'RESERVED') {
  if (reservation?.schema !== BINDING_SCHEMA || reservation.state !== state || reservation.claim_class !== 'MUTATING') {
    throw new Error('managed_project_db_reservation_invalid');
  }
}

/** Adapter for the existing service-role workspace registry RPCs. The caller
 * must supply a claim resolved from the authoritative lease plane. */
export function createManagedTaskProjectBindingRpc({ rpc } = {}) {
  if (typeof rpc !== 'function') throw new Error('managed_project_db_rpc_required');

  async function reserve(reservation) {
    assertReservation(reservation);
    const result = await rpc('h205f22_a2_workspace_binding_register_v1', {
      p_workspace_id: reservation.workspace_id,
      p_workspace_generation: reservation.workspace_generation,
      p_worktree_id: reservation.worktree_id,
      p_coordination_workspace_id: reservation.coordination_workspace_id,
      p_task_id: reservation.task_id,
      p_claim_id: reservation.claim_id,
      p_point_id: reservation.point_id,
      p_repo_id: reservation.repo_id,
      p_repo_root: reservation.repo_root,
      p_managed_root: reservation.managed_root,
      p_worktree_path: reservation.worktree_path,
      p_base_sha: reservation.base_sha,
      p_branch_name: reservation.branch_name,
      p_agent_id: reservation.agent_id,
      p_tab_id: reservation.tab_id,
      p_target_id: reservation.target_id,
      p_agent_generation_epoch: reservation.agent_generation_epoch,
      p_lease_generation: reservation.lease_generation,
      p_lease_expires_at: reservation.lease_expires_at,
    });
    return responseBinding(result, reservation, 'register', 'RESERVED');
  }

  async function finalize(reservation, { state, proof = null, reason = null } = {}) {
    if (!['PROVEN', 'FAILED', 'AMBIGUOUS'].includes(state)) throw new Error('managed_project_db_effect_state_invalid');
    assertReservation(reservation, state === 'PROVEN' ? 'READY' : 'RESERVED');
    if (state === 'PROVEN' && (proof?.head_sha !== reservation.base_sha || proof?.worktree_path !== reservation.worktree_path || proof?.locked !== true)) {
      throw new Error('managed_project_db_proof_invalid');
    }
    const result = await rpc('h205f22_a2_workspace_binding_readback_v1', {
      p_workspace_id: reservation.workspace_id,
      p_task_id: reservation.task_id,
      p_agent_id: reservation.agent_id,
      p_lease_generation: reservation.lease_generation,
      p_branch_name: reservation.branch_name,
      p_worktree_path: reservation.worktree_path,
      p_effect_state: state === 'PROVEN' ? 'PROVEN' : 'AMBIGUOUS',
      p_initial_head_sha: state === 'PROVEN' ? proof.head_sha : null,
      p_worktree_realpath: state === 'PROVEN' ? proof.worktree_path : null,
      p_ambiguity_code: state === 'PROVEN' ? null : String(reason || `PROJECT_${state}`).slice(0, 96),
    });
    return responseBinding(result, reservation, 'readback', state === 'PROVEN' ? 'READY' : 'FROZEN');
  }

  async function finalizeBinding(entry) {
    if (entry?.authority_effect !== false || entry?.automatic_retry_allowed !== false) throw new Error('managed_project_db_entry_invalid');
    return finalize(entry.reservation, { state: entry.state, proof: entry.proof, reason: entry.reason });
  }

  return Object.freeze({ reserve, finalize, reserveBinding: reserve, finalizeBinding });
}
