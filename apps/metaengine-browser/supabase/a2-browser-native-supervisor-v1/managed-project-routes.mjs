const ADMISSION_RPC = 'h205f22_a2_managed_project_admission_v1';
const EFFECT_RPC = 'h205f22_a2_managed_project_binding_effect_v1';
const PROVISION_RPC = 'h205f22_a2_managed_project_repository_provision_v1';
const REQUEST_FIELDS = ['idempotency_key', 'coordination_workspace_id', 'task_id', 'agent_id', 'claim_id', 'lease_generation', 'workspace_id', 'workspace_generation'];
const RECEIPT_FIELDS = ['effect_state', 'head_sha', 'locked', 'realpath_verified', 'ambiguity_code'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const json = (status, value) => new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });

function requestIdentity(body, workspaceId, receipt) {
  const fields = receipt ? [...REQUEST_FIELDS, ...RECEIPT_FIELDS] : REQUEST_FIELDS;
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== fields.length || Object.keys(body).some(key => !fields.includes(key))) throw new Error('MANAGED_PROJECT_REQUEST_INVALID');
  for (const key of ['coordination_workspace_id', 'task_id', 'workspace_id']) if (typeof body[key] !== 'string' || !UUID.test(body[key])) throw new Error('MANAGED_PROJECT_IDENTITY_INVALID');
  if (body.coordination_workspace_id.toLowerCase() !== workspaceId || typeof body.agent_id !== 'string' || !/^agent_[a-z0-9-]{8,64}$/.test(body.agent_id) || typeof body.idempotency_key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{3,127}$/.test(body.idempotency_key)) throw new Error('MANAGED_PROJECT_IDENTITY_INVALID');
  for (const key of ['claim_id', 'lease_generation', 'workspace_generation']) if (!Number.isSafeInteger(body[key]) || body[key] < 1) throw new Error('MANAGED_PROJECT_IDENTITY_INVALID');
  if (receipt) {
    if (!['PROVEN', 'AMBIGUOUS'].includes(body.effect_state)) throw new Error('MANAGED_PROJECT_RECEIPT_INVALID');
    if (body.effect_state === 'PROVEN' && (typeof body.head_sha !== 'string' || !/^[0-9a-f]{40}$/.test(body.head_sha) || body.locked !== true || body.realpath_verified !== true || body.ambiguity_code !== null)) throw new Error('MANAGED_PROJECT_RECEIPT_INVALID');
    if (body.effect_state === 'AMBIGUOUS' && (body.head_sha !== null || body.locked !== false || body.realpath_verified !== false || typeof body.ambiguity_code !== 'string' || !/^[A-Z0-9_]{1,96}$/.test(body.ambiguity_code))) throw new Error('MANAGED_PROJECT_RECEIPT_INVALID');
  }
  return body;
}

function exactResponse(value, body, identity, operation) {
  const binding = operation === 'admission' ? value?.workspace_binding : value?.binding;
  if (!value || value.authority_effect !== false || value.automatic_retry_allowed !== false || !binding || binding.schema !== 'metaengine.devos.workspace-binding.v1' || binding.authority_effect !== false || binding.page_data_authority !== false || binding.automatic_retry_allowed !== false) throw new Error('MANAGED_PROJECT_DB_READBACK_INVALID');
  for (const key of REQUEST_FIELDS.filter(key => key !== 'idempotency_key')) if (String(binding[key]).toLowerCase() !== String(body[key]).toLowerCase()) throw new Error('MANAGED_PROJECT_DB_READBACK_INVALID');
  if (operation === 'admission') {
    if (value.schema !== 'metaengine.devos.managed-project-admission.v1' || value.authoritative !== true || value.active !== true || value.device_id !== identity.device_id || value.client_id !== identity.id || value.admin_grant_epoch !== identity.admin_grant_epoch || !value.claim || !['RESERVED', 'READY'].includes(binding.state) || binding.dirty_hold !== false || binding.ambiguity_code != null || value.scheduler_authority !== false || value.browser_actuation_authority !== false) throw new Error('MANAGED_PROJECT_DB_READBACK_INVALID');
    for (const key of ['task_id', 'claim_id', 'point_id', 'claim_class', 'base_sha', 'branch_name', 'agent_id', 'tab_id', 'target_id', 'agent_generation_epoch', 'lease_generation', 'lease_expires_at', 'coordination_workspace_id']) if (value.claim[key] !== binding[key]) throw new Error('MANAGED_PROJECT_DB_READBACK_INVALID');
  } else if (value.ok !== true || value.operation !== operation || binding.state !== (operation === 'reserve' ? 'RESERVED' : body.effect_state === 'PROVEN' ? 'READY' : 'FROZEN')) throw new Error('MANAGED_PROJECT_DB_READBACK_INVALID');
  return value;
}

/** These routes execute only after device signature/nonce verification. The
 * server injects the device grant; page/model JSON cannot supply trusted paths. */
export function createManagedProjectRoutes({ rpc, workspaceId } = {}) {
  const workspace = String(workspaceId || '').toLowerCase();
  if (typeof rpc !== 'function' || !UUID.test(workspace)) throw new Error('managed_project_routes_dependencies_invalid');
  return async function managedProjectRoutes({ req, path, body, identity } = {}) {
    const operation = path === '/v1/devos/project-admission' ? 'admission' : path === '/v1/devos/project-binding/reserve' ? 'reserve' : path === '/v1/devos/project-binding/readback' ? 'readback' : path === '/v1/devos/project-repository/provision' ? 'provision' : null;
    if (!operation) return null;
    const closed = (error, status = 409) => json(status, { accepted: false, error, automatic_retry_allowed: false, authority_effect: false });
    if (req?.method !== 'POST') return closed('METHOD_NOT_ALLOWED', 405);
    if (identity?.ok !== true || identity.admin_ready !== true || identity.access_tier !== 'ADMIN' || !UUID.test(identity.device_id || '') || typeof identity.id !== 'string' || !identity.id || !Number.isSafeInteger(identity.admin_grant_epoch) || identity.admin_grant_epoch < 1) return closed('ADMIN_DEVICE_REQUIRED', 403);
    try {
      if (operation === 'provision') {
        const fields = ['schema', 'coordination_workspace_id', 'repo_id', 'repo_root', 'managed_root'];
        if (!body || body.schema !== 'metaengine.devos.managed-project-repository-config.v1' || Object.keys(body).length !== fields.length || Object.keys(body).some(key => !fields.includes(key)) || body.coordination_workspace_id !== workspace || !/^[a-z0-9][a-z0-9:._/-]{2,159}$/i.test(body.repo_id || '') || [body.repo_root, body.managed_root].some(value => typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0'))) throw new Error('MANAGED_PROJECT_REPOSITORY_CONFIG_INVALID');
        const value = await rpc(PROVISION_RPC, { p_coordination_workspace_id: workspace, p_device_id: identity.device_id, p_client_id: identity.id, p_admin_grant_epoch: identity.admin_grant_epoch, p_repo_id: body.repo_id, p_repo_root: body.repo_root, p_managed_root: body.managed_root });
        if (value?.schema !== 'metaengine.devos.managed-project-repository.v1' || value.provisioned !== true || value.authority_effect !== false || value.automatic_retry_allowed !== false || value.repository?.device_id !== identity.device_id || value.repository?.client_id !== identity.id || value.repository?.admin_grant_epoch !== identity.admin_grant_epoch || fields.filter(key => key !== 'schema').some(key => value.repository[key] !== body[key])) throw new Error('MANAGED_PROJECT_DB_READBACK_INVALID');
        return json(200, value);
      }
      const request = requestIdentity(body, workspace, operation === 'readback');
      const args = Object.fromEntries(REQUEST_FIELDS.filter(key => key !== 'idempotency_key').map(key => [`p_${key}`, request[key]]));
      Object.assign(args, { p_device_id: identity.device_id, p_client_id: identity.id, p_admin_grant_epoch: identity.admin_grant_epoch });
      if (operation !== 'admission') Object.assign(args, { p_operation: operation, p_effect_state: operation === 'reserve' ? null : request.effect_state, p_head_sha: operation === 'reserve' ? null : request.head_sha, p_locked: operation === 'readback' && request.locked, p_realpath_verified: operation === 'readback' && request.realpath_verified, p_ambiguity_code: operation === 'reserve' ? null : request.ambiguity_code });
      const value = await rpc(operation === 'admission' ? ADMISSION_RPC : EFFECT_RPC, args);
      return json(200, exactResponse(value, request, identity, operation));
    } catch (error) {
      const code = String(error?.message || error);
      const known = code.match(/\bMANAGED_PROJECT_[A-Z0-9_]+\b/);
      return closed(known?.[0] || 'MANAGED_PROJECT_READ_UNAVAILABLE', known ? 409 : 503);
    }
  };
}
