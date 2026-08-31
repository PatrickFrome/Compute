const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA40_RE = /^[a-f0-9]{40}$/;

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`meta_workspace_${name}_invalid`);
  return value;
}
function eq(actual, expected, code) {
  if (String(actual ?? '') !== String(expected ?? '')) throw new Error(`meta_workspace_${code}`);
}
function lower(value) { return String(value ?? '').trim().toLowerCase(); }
function branch(value) { return String(value ?? '').trim(); }
function positive(value, name) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1) throw new Error(`meta_workspace_${name}_invalid`);
  return out;
}
function uuid(value, name) {
  const out = lower(value);
  if (!UUID_RE.test(out)) throw new Error(`meta_workspace_${name}_invalid`);
  return out;
}
function sha(value, name) {
  const out = lower(value);
  if (!SHA40_RE.test(out)) throw new Error(`meta_workspace_${name}_invalid`);
  return out;
}
function zeroAuthority(row, name) {
  for (const key of ['authority_effect', 'page_data_authority', 'model_output_authority']) {
    if (key in row && row[key] !== false) throw new Error(`meta_workspace_${name}_${key}_invalid`);
  }
}

/**
 * Deterministic bridge from Meta-Orchestrator semantic work to the physical mutation plane.
 *
 * This gate intentionally runs AFTER DevOS has created a task + exact mutating claim and AFTER
 * Workspace Manager has produced a durable READY binding. It runs BEFORE any repository mutation,
 * worktree write, Browser submit or other authority-bearing effect.
 *
 * It does not choose an agent/tab/target, allocate a lease, execute Git, or actuate Browser UI.
 */
export function assertMetaWorkspaceMutationAdmission({ enqueue_proposal, task, claim, binding } = {}) {
  const proposal = object(enqueue_proposal, 'proposal');
  const t = object(task, 'task');
  const c = object(claim, 'claim');
  const b = object(binding, 'binding');

  if (proposal.schema !== 'metaengine.meta-orchestrator.devos-enqueue-proposal.v1') throw new Error('meta_workspace_proposal_schema_invalid');
  if (proposal.rpc !== 'devos_fleet_enqueue_v1' || proposal.scheduler_admission_required !== true) throw new Error('meta_workspace_proposal_route_invalid');
  if (proposal.authority_effect !== false || proposal.scheduler_authority !== false || proposal.browser_authority !== false) throw new Error('meta_workspace_proposal_authority_invalid');
  if (b.schema !== 'metaengine.devos.workspace-binding.v1' || b.state !== 'READY') throw new Error('meta_workspace_binding_not_ready');
  zeroAuthority(b, 'binding');

  const coordinationWorkspaceId = uuid(proposal.args?.p_workspace, 'coordination_workspace_id');
  const taskId = uuid(t.task_id, 'task_id');
  const bindingTaskId = uuid(b.task_id, 'binding_task_id');
  const baseSha = sha(proposal.args?.p_base, 'proposal_base_sha');
  const leaseGeneration = positive(c.lease_generation ?? t.lease_generation, 'lease_generation');
  const agentGeneration = positive(c.agent_generation_epoch ?? c.lease_agent_generation_epoch ?? t.lease_agent_generation_epoch, 'agent_generation_epoch');

  // Semantic identity from the Meta plan must survive scheduler materialization unchanged.
  eq(lower(t.point_id), lower(proposal.args?.p_point), 'task_point_mismatch');
  eq(String(t.role || '').toUpperCase(), String(proposal.args?.p_role || '').toUpperCase(), 'task_role_mismatch');
  eq(sha(t.base_sha, 'task_base_sha'), baseSha, 'task_base_mismatch');
  if (proposal.args?.p_branch != null) eq(branch(t.branch_name), branch(proposal.args.p_branch), 'task_branch_mismatch');
  eq(String(t.idempotency_key || ''), String(proposal.args?.p_key || ''), 'task_idempotency_mismatch');

  // The scheduler owns the physical identity. Meta-Orchestrator only verifies the readback.
  eq(uuid(c.workspace_id, 'claim_workspace_id'), coordinationWorkspaceId, 'claim_workspace_mismatch');
  eq(uuid(c.task_id, 'claim_task_id'), taskId, 'claim_task_mismatch');
  eq(sha(c.base_sha, 'claim_base_sha'), baseSha, 'claim_base_mismatch');
  eq(lower(c.point_id), lower(t.point_id), 'claim_point_mismatch');
  if (c.branch_name != null || t.branch_name != null) eq(branch(c.branch_name), branch(t.branch_name), 'claim_branch_mismatch');

  // Workspace binding must be the exact incarnation selected by DevOS, never a meta-created one.
  eq(uuid(b.coordination_workspace_id, 'binding_coordination_workspace_id'), coordinationWorkspaceId, 'binding_coordination_workspace_mismatch');
  eq(bindingTaskId, taskId, 'binding_task_mismatch');
  eq(positive(b.claim_id, 'binding_claim_id'), positive(c.claim_id, 'claim_id'), 'binding_claim_mismatch');
  eq(lower(b.point_id), lower(t.point_id), 'binding_point_mismatch');
  eq(sha(b.base_sha, 'binding_base_sha'), baseSha, 'binding_base_mismatch');
  eq(branch(b.branch_name), branch(t.branch_name), 'binding_branch_mismatch');
  eq(lower(b.agent_id), lower(c.agent_id ?? t.lease_agent_id), 'binding_agent_mismatch');
  eq(lower(b.tab_id), lower(c.tab_id ?? t.lease_tab_id), 'binding_tab_mismatch');
  eq(lower(b.target_id), lower(c.target_id ?? t.lease_target_id), 'binding_target_mismatch');
  eq(positive(b.agent_generation_epoch, 'binding_agent_generation_epoch'), agentGeneration, 'binding_agent_generation_mismatch');
  eq(positive(b.lease_generation, 'binding_lease_generation'), leaseGeneration, 'binding_lease_generation_mismatch');

  if (b.initial_head_sha && sha(b.initial_head_sha, 'binding_initial_head_sha') !== baseSha) throw new Error('meta_workspace_binding_initial_head_mismatch');
  if (b.last_verified_head_sha && !SHA40_RE.test(lower(b.last_verified_head_sha))) throw new Error('meta_workspace_binding_last_head_invalid');
  if (b.ambiguity_code) throw new Error('meta_workspace_binding_ambiguous');
  if (b.dirty_hold === true) throw new Error('meta_workspace_binding_dirty_hold');
  if (b.automatic_retry_allowed !== false) throw new Error('meta_workspace_binding_retry_policy_invalid');

  return Object.freeze({
    schema: 'metaengine.meta-orchestrator.workspace-mutation-admission.v1',
    admitted: true,
    task_id: taskId,
    coordination_workspace_id: coordinationWorkspaceId,
    workspace_id: uuid(b.workspace_id, 'binding_workspace_id'),
    binding_id: b.binding_id ? uuid(b.binding_id, 'binding_id') : null,
    base_sha: baseSha,
    branch_name: branch(b.branch_name),
    worktree_path: String(b.worktree_path || ''),
    workspace_generation: positive(b.workspace_generation, 'workspace_generation'),
    lease_generation: positive(b.lease_generation, 'binding_lease_generation'),
    agent_generation_epoch: positive(b.agent_generation_epoch, 'binding_agent_generation_epoch'),
    exact_incarnation_verified: true,
    scheduler_selection_verified_not_created: true,
    mutation_executor_still_must_revalidate_lease: true,
    automatic_retry_allowed: false,
    task_content_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
  });
}
