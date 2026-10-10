import { createWorkspaceReservation, normalizeMutationClaimBinding } from './workspace-manager.mjs';
import { MANAGED_PROJECT_ADMISSION_SCHEMA } from './managed-task-project-command-adapter.mjs';

export const MANAGED_PROJECT_AUTHORITY_PATHS = Object.freeze([
  '/v1/devos/project-admission', '/v1/devos/project-binding/reserve', '/v1/devos/project-binding/readback',
  '/v1/devos/project-repository/provision',
]);
export const MANAGED_PROJECT_REQUEST_FIELDS = Object.freeze(['idempotency_key', 'coordination_workspace_id', 'task_id', 'agent_id', 'claim_id', 'lease_generation', 'workspace_id', 'workspace_generation']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BINDING_FIELDS = ['workspace_id', 'workspace_generation', 'worktree_id', 'coordination_workspace_id', 'task_id', 'claim_id', 'point_id', 'claim_class', 'repo_id', 'repo_root', 'managed_root', 'worktree_path', 'base_sha', 'branch_name', 'agent_id', 'tab_id', 'target_id', 'agent_generation_epoch', 'lease_generation'];

export function createManagedTaskProjectRepositoryProvisioner({ request } = {}) {
  if (typeof request !== 'function') throw new Error('managed_project_authority_transport_required');
  return async function provisionRepository(config) {
    const fields = ['schema', 'coordination_workspace_id', 'repo_id', 'repo_root', 'managed_root'];
    if (!config || config.schema !== 'metaengine.devos.managed-project-repository-config.v1' || Object.keys(config).length !== fields.length || Object.keys(config).some(key => !fields.includes(key)) || !UUID.test(config.coordination_workspace_id || '') || !/^[a-z0-9][a-z0-9:._/-]{2,159}$/i.test(config.repo_id || '') || [config.repo_root, config.managed_root].some(value => typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0'))) throw new Error('managed_project_repository_config_invalid');
    const value = await request({ method: 'POST', path: MANAGED_PROJECT_AUTHORITY_PATHS[3], body: structuredClone(config) });
    if (value?.schema !== 'metaengine.devos.managed-project-repository.v1' || value.provisioned !== true || value.authority_effect !== false || value.automatic_retry_allowed !== false || typeof value.replayed !== 'boolean' || !UUID.test(value.repository?.device_id || '') || typeof value.repository?.client_id !== 'string' || !value.repository.client_id || !Number.isSafeInteger(value.repository?.admin_grant_epoch) || value.repository.admin_grant_epoch < 1) throw new Error('managed_project_repository_readback_invalid');
    for (const key of fields.filter(key => key !== 'schema')) if (value.repository[key] !== config[key]) throw new Error(`managed_project_repository_readback_drift:${key}`);
    return Object.freeze(structuredClone(value));
  };
}

export function normalizeManagedProjectAuthorityRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== MANAGED_PROJECT_REQUEST_FIELDS.length || Object.keys(value).some(key => !MANAGED_PROJECT_REQUEST_FIELDS.includes(key))) throw new Error('managed_project_authority_request_invalid');
  const request = structuredClone(value);
  for (const key of ['coordination_workspace_id', 'task_id', 'workspace_id']) {
    if (typeof request[key] !== 'string' || !UUID.test(request[key])) throw new Error('managed_project_authority_identity_invalid');
    request[key] = request[key].toLowerCase();
  }
  if (typeof request.idempotency_key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{3,127}$/.test(request.idempotency_key) || typeof request.agent_id !== 'string' || !/^agent_[a-z0-9-]{8,64}$/.test(request.agent_id)) throw new Error('managed_project_authority_identity_invalid');
  for (const key of ['claim_id', 'lease_generation', 'workspace_generation']) if (!Number.isSafeInteger(request[key]) || request[key] < 1) throw new Error('managed_project_authority_identity_invalid');
  return Object.freeze(request);
}

/** One local effect identity for every entry point. Caller keys remain bounded
 * request metadata; they cannot select another durable effect for this binding. */
export function managedProjectEffectKey(value) {
  const request = normalizeManagedProjectAuthorityRequest(value);
  return `project:${request.workspace_id}:g${request.workspace_generation}:l${request.lease_generation}`;
}

function exactBinding(binding, request, states) {
  if (!binding || binding.schema !== 'metaengine.devos.workspace-binding.v1' || !states.includes(binding.state) || binding.authority_effect !== false || binding.page_data_authority !== false || binding.automatic_retry_allowed !== false) throw new Error('managed_project_authority_binding_invalid');
  for (const key of MANAGED_PROJECT_REQUEST_FIELDS.filter(key => key !== 'idempotency_key')) if (binding[key] !== request[key]) throw new Error(`managed_project_authority_identity_drift:${key}`);
  if (!Number.isFinite(Date.parse(binding.lease_expires_at)) || Date.parse(binding.lease_expires_at) <= Date.now()) throw new Error('managed_project_authority_lease_expired');
  return binding;
}

export function createManagedTaskProjectAuthorityResolver({ request } = {}) {
  if (typeof request !== 'function') throw new Error('managed_project_authority_transport_required');
  return async function resolveProjectBinding(input) {
    const identity = normalizeManagedProjectAuthorityRequest(input);
    const value = await request({ method: 'POST', path: MANAGED_PROJECT_AUTHORITY_PATHS[0], body: identity });
    if (!value || value.schema !== MANAGED_PROJECT_ADMISSION_SCHEMA || value.authoritative !== true || value.active !== true || value.authority_effect !== false || value.automatic_retry_allowed !== false || value.scheduler_authority !== false || value.browser_actuation_authority !== false) throw new Error('managed_project_authority_admission_invalid');
    const binding = exactBinding(value.workspace_binding, identity, ['RESERVED', 'READY']);
    if (binding.dirty_hold !== false || binding.ambiguity_code != null) throw new Error('managed_project_authority_binding_invalid');
    const claim = normalizeMutationClaimBinding(value.claim);
    const expected = createWorkspaceReservation({ claim, trusted_repo: { repo_id: binding.repo_id, repo_root: binding.repo_root }, workspace_root: binding.managed_root, workspace_id: binding.workspace_id, worktree_id: binding.worktree_id, workspace_generation: binding.workspace_generation });
    for (const key of BINDING_FIELDS) if (binding[key] !== expected[key]) throw new Error(`managed_project_authority_binding_drift:${key}`);
    if (binding.lease_expires_at !== claim.lease_expires_at || !UUID.test(value.device_id || '') || typeof value.client_id !== 'string' || !value.client_id || !Number.isSafeInteger(value.admin_grant_epoch) || value.admin_grant_epoch < 1) throw new Error('managed_project_authority_device_binding_invalid');
    return Object.freeze(structuredClone(value));
  };
}

function identityFromReservation(reservation) {
  return normalizeManagedProjectAuthorityRequest(Object.fromEntries(MANAGED_PROJECT_REQUEST_FIELDS.map(key => [key, key === 'idempotency_key' ? `binding:${reservation.workspace_id}` : reservation[key]])));
}

/** Host callbacks send identity and bounded receipts only. Stored paths and
 * claims are read by the authenticated server, never supplied in the wire body. */
export function createManagedTaskProjectBindingTransport({ request } = {}) {
  if (typeof request !== 'function') throw new Error('managed_project_authority_transport_required');
  const checked = (value, identity, operation, state) => {
    if (value?.ok !== true || value.operation !== operation || value.authority_effect !== false || value.automatic_retry_allowed !== false) throw new Error(`managed_project_authority_${operation}_rejected`);
    exactBinding(value.binding, identity, [state]);
    return Object.freeze(structuredClone(value.binding));
  };
  return Object.freeze({
    async reserveBinding(reservation) {
      if (reservation?.schema !== 'metaengine.devos.workspace-binding.v1' || reservation.state !== 'RESERVED') throw new Error('managed_project_authority_reservation_invalid');
      const identity = identityFromReservation(reservation);
      const value = await request({ method: 'POST', path: MANAGED_PROJECT_AUTHORITY_PATHS[1], body: identity });
      const binding = checked(value, identity, 'reserve', 'RESERVED');
      for (const key of BINDING_FIELDS) if (binding[key] !== reservation[key]) throw new Error(`managed_project_authority_binding_drift:${key}`);
      return binding;
    },
    async finalizeBinding(entry) {
      if (entry?.authority_effect !== false || entry?.automatic_retry_allowed !== false || !['PROVEN', 'FAILED', 'AMBIGUOUS'].includes(entry.state)) throw new Error('managed_project_authority_receipt_invalid');
      const identity = identityFromReservation(entry.reservation);
      const proven = entry.state === 'PROVEN';
      if (proven && (entry.proof?.head_sha !== entry.reservation.base_sha || entry.proof?.worktree_path !== entry.reservation.worktree_path || entry.proof?.locked !== true)) throw new Error('managed_project_authority_proof_invalid');
      const body = { ...identity, effect_state: proven ? 'PROVEN' : 'AMBIGUOUS', head_sha: proven ? entry.proof.head_sha : null, locked: proven, realpath_verified: proven, ambiguity_code: proven ? null : String(entry.reason || `PROJECT_${entry.state}`).replace(/[^A-Za-z0-9_]/g, '_').toUpperCase().slice(0, 96) };
      const value = await request({ method: 'POST', path: MANAGED_PROJECT_AUTHORITY_PATHS[2], body });
      const binding = checked(value, identity, 'readback', proven ? 'READY' : 'FROZEN');
      for (const key of BINDING_FIELDS) if (binding[key] !== entry.reservation[key]) throw new Error(`managed_project_authority_binding_drift:${key}`);
      if (proven && (binding.initial_head_sha !== entry.proof.head_sha || binding.worktree_realpath !== entry.proof.worktree_path)) throw new Error('managed_project_authority_readback_drift');
      if (!proven && !binding.ambiguity_code) throw new Error('managed_project_authority_freeze_missing');
      return binding;
    },
  });
}
