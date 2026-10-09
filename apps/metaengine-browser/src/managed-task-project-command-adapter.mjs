import { createWorkspaceReservation, normalizeMutationClaimBinding } from './workspace-manager.mjs';
import { createManagedTaskProjectRuntime } from './managed-task-project-runtime.mjs';

export const MANAGED_PROJECT_COMMAND_ACTIONS = Object.freeze(['PROJECT_CREATE', 'PROJECT_OPEN']);
export const MANAGED_PROJECT_ADMISSION_SCHEMA = 'metaengine.devos.managed-project-admission.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_FIELDS = ['idempotency_key', 'coordination_workspace_id', 'task_id', 'agent_id', 'claim_id', 'lease_generation', 'workspace_id', 'workspace_generation'];
const BINDING_FIELDS = ['workspace_id', 'workspace_generation', 'worktree_id', 'coordination_workspace_id', 'task_id', 'claim_id', 'point_id', 'claim_class', 'repo_id', 'repo_root', 'managed_root', 'worktree_path', 'base_sha', 'branch_name', 'agent_id', 'tab_id', 'target_id', 'agent_generation_epoch', 'lease_generation'];

function requestOf(command) {
  const input = command?.payload;
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !REQUEST_FIELDS.includes(key))) throw new Error('managed_project_command_payload_invalid');
  const request = structuredClone(input);
  for (const key of ['coordination_workspace_id', 'task_id', 'workspace_id']) {
    if (typeof request[key] !== 'string' || !UUID.test(request[key])) throw new Error('managed_project_command_identity_invalid');
    request[key] = request[key].toLowerCase();
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{3,127}$/.test(request.idempotency_key || '') || !/^agent_[a-z0-9-]{8,64}$/.test(request.agent_id || '')) throw new Error('managed_project_command_identity_invalid');
  for (const key of ['claim_id', 'lease_generation', 'workspace_generation']) if (!Number.isSafeInteger(request[key]) || request[key] < 1) throw new Error('managed_project_command_identity_invalid');
  return Object.freeze(request);
}

function checkedAdmission(value, request, expected = null) {
  if (!value || value.schema !== MANAGED_PROJECT_ADMISSION_SCHEMA || value.authoritative !== true || value.active !== true || value.authority_effect !== false) throw new Error('managed_project_authoritative_admission_required');
  const claim = normalizeMutationClaimBinding(value.claim);
  const binding = value.workspace_binding;
  if (!binding || binding.schema !== 'metaengine.devos.workspace-binding.v1' || !['RESERVED', 'READY'].includes(binding.state) || binding.authority_effect !== false || binding.page_data_authority !== false || binding.automatic_retry_allowed !== false || binding.dirty_hold !== false || binding.ambiguity_code != null) throw new Error('managed_project_authoritative_binding_invalid');
  const reservation = createWorkspaceReservation({ claim,
    trusted_repo: { repo_id: binding.repo_id, repo_root: binding.repo_root },
    workspace_root: binding.managed_root, workspace_id: binding.workspace_id,
    worktree_id: binding.worktree_id, workspace_generation: binding.workspace_generation,
  });
  for (const key of BINDING_FIELDS) {
    if (binding[key] !== reservation[key] || (expected && reservation[key] !== expected[key])) throw new Error(`managed_project_authoritative_binding_mismatch:${key}`);
  }
  for (const key of REQUEST_FIELDS.filter(key => key !== 'idempotency_key')) if (request[key] !== reservation[key]) throw new Error(`managed_project_command_binding_mismatch:${key}`);
  if (!Number.isFinite(Date.parse(claim.lease_expires_at)) || Date.parse(claim.lease_expires_at) <= Date.now() || binding.lease_expires_at !== claim.lease_expires_at) throw new Error('managed_project_authoritative_lease_expired');
  return reservation;
}

/** Composition point for SupervisorLoopbackRpcServer.executeCommand. The
 * resolver and DB callbacks are host-owned dependencies, never JSON fields.
 * It stays unmounted until the host supplies an authoritative DB claim reader
 * and a durable journal. The loopback bearer token alone cannot mint a claim. */
export function createManagedTaskProjectCommandAdapter({ executeCommand, resolveProjectBinding, executePlan, journal, reserveBinding, finalizeBinding, openProject = null } = {}) {
  for (const [name, value] of Object.entries({ executeCommand, resolveProjectBinding, executePlan, reserveBinding, finalizeBinding })) if (typeof value !== 'function') throw new Error(`managed_project_adapter_${name}_required`);
  if (!journal || typeof journal.find !== 'function' || typeof journal.append !== 'function') throw new Error('managed_project_adapter_journal_required');

  return async function execute(command) {
    if (!MANAGED_PROJECT_COMMAND_ACTIONS.includes(command?.action)) return executeCommand(command);
    const action = command.action;
    const request = requestOf(command);
    const reservation = checkedAdmission(await resolveProjectBinding(request), request);
    const runtime = createManagedTaskProjectRuntime({ executePlan, journal, reserveBinding, finalizeBinding, openProject,
      validateClaim: async (expected) => {
        checkedAdmission(await resolveProjectBinding(request), request, expected);
        return true;
      },
    });
    const result = await runtime[action === 'PROJECT_OPEN' ? 'open' : 'create']({
      idempotency_key: request.idempotency_key, claim: reservation,
      trusted_repo: { repo_id: reservation.repo_id, repo_root: reservation.repo_root },
      workspace_root: reservation.managed_root, workspace_id: reservation.workspace_id,
      worktree_id: reservation.worktree_id, workspace_generation: reservation.workspace_generation,
    });
    return Object.freeze({ ...result, action, scheduler_authority: false, browser_actuation_authority: false, authority_effect: false });
  };
}
