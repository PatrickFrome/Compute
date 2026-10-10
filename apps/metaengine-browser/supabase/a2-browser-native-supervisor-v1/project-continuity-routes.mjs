const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT = /^[A-Z][A-Z0-9_]{0,95}$/;
const REGISTER_RPC = 'h205f22_project_register_v1';
const SNAPSHOT_RPC = 'h205f22_project_snapshot_v1';
const HISTORY_RPC = 'h205f22_project_history_v1';
const SPAWN_RPC = 'h205f22_project_spawn_v1';
const ACTIVITY_RPC = 'h205f22_project_activity_v1';
const POLICY_RPC = 'h205f22_project_policy_v1';
const RECONCILE_RPC = 'h205f22_project_reconcile_v1';
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const json = (status, value) => new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
const own = (body, fields) => body && typeof body === 'object' && !Array.isArray(body)
  && Object.keys(body).length === fields.length && Object.keys(body).every(key => fields.includes(key));
const uuid = value => typeof value === 'string' && UUID.test(value);
const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const optionalInteger = (value, min = 0) => value === null || integer(value, min);
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0');

function device(identity) {
  return identity?.ok === true && identity.admin_ready === true && identity.access_tier === 'ADMIN'
    && uuid(identity.device_id) && typeof identity.id === 'string' && identity.id.length > 0
    && integer(identity.admin_grant_epoch, 1);
}

/** Project continuity is a read/coordination membrane. The authenticated
 * device identity and fixed workspace are injected by the Edge server; the
 * request body cannot provide an authority-bearing device, client or path. */
export function createProjectContinuityRoutes({ rpc, workspaceId } = {}) {
  const workspace = String(workspaceId || '').toLowerCase();
  if (typeof rpc !== 'function' || !UUID.test(workspace)) throw new Error('project_continuity_routes_dependencies_invalid');
  const fail = (code, status = 409) => json(status, { accepted: false, error: code, automatic_retry_allowed: false, scheduler_authority: false, authority_effect: false });
  const call = async (name, args) => {
    try {
      const value = await rpc(name, args);
      const schemas = { [REGISTER_RPC]: 'metaengine.devos.project-registration.v1', [SNAPSHOT_RPC]: 'metaengine.devos.project-snapshot.v1', [HISTORY_RPC]: 'metaengine.devos.project-history.v1', [SPAWN_RPC]: 'metaengine.devos.project-spawn.v1', [ACTIVITY_RPC]: 'metaengine.devos.project-activity.v1', [POLICY_RPC]: 'metaengine.devos.project-policy.v1', [RECONCILE_RPC]: 'metaengine.devos.project-reconcile.v1' };
      if (!value || value.schema !== schemas[name] || value.authority_effect !== false || value.automatic_retry_allowed !== false
        || (args.p_project_id != null && value.project_id !== args.p_project_id) || (name === RECONCILE_RPC && args.p_project_id === null && (value.project_id !== null || value.bounded_projects !== 4 || !Array.isArray(value.projects) || value.projects.length > 4))) throw new Error('PROJECT_DB_READBACK_INVALID');
      return json(200, value);
    }
    catch (error) {
      const message = String(error?.message || error);
      const known = message.match(/\bPROJECT_[A-Z0-9_]+\b/);
      return fail(known?.[0] || 'PROJECT_CONTINUITY_READ_UNAVAILABLE', known ? 409 : 503);
    }
  };
  return async function projectContinuityRoutes({ req, path, body, identity } = {}) {
    if (!path?.startsWith('/v1/devos/project/')) return null;
    if (req?.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);
    if (!device(identity)) return fail('ADMIN_DEVICE_REQUIRED', 403);
    const injected = { p_device_id: identity.device_id, p_client_id: identity.id, p_admin_grant_epoch: identity.admin_grant_epoch };
    try {
      if (path === '/v1/devos/project/register') {
        if (!own(body, ['request_id']) || !uuid(body.request_id)) throw new Error('PROJECT_REQUEST_INVALID');
        return call(REGISTER_RPC, { p_workspace_id: workspace, p_request_id: body.request_id, ...injected });
      }
      if (path === '/v1/devos/project/reconcile') {
        if (!own(body, ['project_id']) || (body.project_id !== null && !uuid(body.project_id))) throw new Error('PROJECT_RECONCILE_REQUEST_INVALID');
        return call(RECONCILE_RPC, { p_workspace_id: workspace, p_project_id: body.project_id, ...injected });
      }
      if (path === '/v1/devos/project/snapshot') {
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('PROJECT_SNAPSHOT_REQUEST_INVALID');
        const normalized = { project_id: null, task_id: null, task_after_seq: 0, limit: 128, ...body };
        if (!own(normalized, ['project_id', 'task_id', 'task_after_seq', 'limit']) || (normalized.project_id !== null && !uuid(normalized.project_id)) || (normalized.task_id !== null && !uuid(normalized.task_id))
          || (normalized.project_id === null) === (normalized.task_id === null) || !integer(normalized.task_after_seq, 0) || !integer(normalized.limit, 1) || normalized.limit > 128) throw new Error('PROJECT_SNAPSHOT_REQUEST_INVALID');
        return call(SNAPSHOT_RPC, { p_workspace_id: workspace, p_project_id: normalized.project_id, p_task_id: normalized.task_id, p_task_after_seq: normalized.task_after_seq, p_limit: normalized.limit, ...injected });
      }
      if (path === '/v1/devos/project/history') {
        if (!own(body, ['project_id', 'after_seq', 'through_seq', 'limit', 'task_id', 'attempt', 'event_type']) || !uuid(body.project_id)
          || !integer(body.after_seq, 0) || !optionalInteger(body.through_seq, 0) || !integer(body.limit, 1) || body.limit > 128
          || (body.task_id !== null && !uuid(body.task_id)) || !optionalInteger(body.attempt, 0) || (body.event_type !== null && !EVENT.test(body.event_type))) throw new Error('PROJECT_HISTORY_REQUEST_INVALID');
        return call(HISTORY_RPC, { p_workspace_id: workspace, p_project_id: body.project_id, p_after_seq: body.after_seq, p_through_seq: body.through_seq, p_limit: body.limit, p_task_id: body.task_id, p_attempt: body.attempt, p_event_type: body.event_type, ...injected });
      }
      if (path === '/v1/devos/project/spawn') {
        if (!own(body, ['project_id', 'parent_task_id', 'claim_id', 'lease_generation', 'request_id', 'children']) || !uuid(body.project_id) || !uuid(body.parent_task_id)
          || !integer(body.claim_id, 1) || !integer(body.lease_generation, 1) || !uuid(body.request_id) || !Array.isArray(body.children) || body.children.length < 1 || body.children.length > 8) throw new Error('PROJECT_SPAWN_REQUEST_INVALID');
        return call(SPAWN_RPC, { p_workspace_id: workspace, p_project_id: body.project_id, p_parent_task_id: body.parent_task_id, p_claim_id: body.claim_id, p_lease_generation: body.lease_generation, p_request_id: body.request_id, p_children: body.children, ...injected });
      }
      if (path === '/v1/devos/project/activity') {
        if (!own(body, ['project_id', 'task_id', 'claim_id', 'lease_generation', 'request_id', 'event_type', 'causal_parent_seq', 'tool', 'artifact', 'content', 'receipt_event_id'])
          || !uuid(body.project_id) || !uuid(body.task_id) || !integer(body.claim_id, 1) || !integer(body.lease_generation, 1) || !uuid(body.request_id) || !EVENT.test(body.event_type)
          || !optionalInteger(body.causal_parent_seq, 0) || (body.tool !== null && !text(body.tool, 160)) || (body.artifact !== null && !text(body.artifact, 512))
          || !body.content || typeof body.content !== 'object' || Array.isArray(body.content) || !optionalInteger(body.receipt_event_id, 1)) throw new Error('PROJECT_ACTIVITY_REQUEST_INVALID');
        return call(ACTIVITY_RPC, { p_workspace_id: workspace, p_project_id: body.project_id, p_task_id: body.task_id, p_claim_id: body.claim_id, p_lease_generation: body.lease_generation, p_request_id: body.request_id, p_event_type: body.event_type, p_causal_parent_seq: body.causal_parent_seq, p_tool: body.tool, p_artifact: body.artifact, p_content: body.content, p_receipt_event_id: body.receipt_event_id, ...injected });
      }
      if (path === '/v1/devos/project/policy') {
        if (!own(body, ['project_id', 'expected_generation', 'max_depth', 'max_tasks', 'max_children']) || !uuid(body.project_id) || !integer(body.expected_generation, 1)
          || !optionalInteger(body.max_depth, 0) || !optionalInteger(body.max_tasks, 1) || !optionalInteger(body.max_children, 1)) throw new Error('PROJECT_POLICY_REQUEST_INVALID');
        return call(POLICY_RPC, { p_workspace_id: workspace, p_project_id: body.project_id, p_expected_generation: body.expected_generation, p_max_depth: body.max_depth, p_max_tasks: body.max_tasks, p_max_children: body.max_children, ...injected });
      }
      return null;
    } catch (error) {
      const message = String(error?.message || error);
      return fail(message.startsWith('PROJECT_') ? message : 'PROJECT_CONTINUITY_REQUEST_INVALID', 400);
    }
  };
}
