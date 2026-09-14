export const NATIVE_SUPERVISOR_HEARTBEAT_PATH = '/v1/heartbeat';
export const NATIVE_SUPERVISOR_HEARTBEAT_RPC = 'h205f22_a2_browser_supervisor_heartbeat_v1';
export const NATIVE_SUPERVISOR_HEARTBEAT_ACK_SCHEMA = 'metaengine.native-supervisor.heartbeat-ack.v1';
const HEARTBEAT_PHASES = new Set(['BOOTSTRAP', 'WATCHDOG']);
const HEARTBEAT_FIELDS = new Set(['phase', 'authority_effect']);

function heartbeatAcceptorUnavailable(error) {
  const message = String(error?.message || error || '');
  return /rest_404:|PGRST202|PGRST203|could not find the function|function .* does not exist/i.test(message);
}

function heartbeatBodyIsValid(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const keys = Object.keys(body);
  if (keys.length !== HEARTBEAT_FIELDS.size || keys.some((key) => !HEARTBEAT_FIELDS.has(key))) return false;
  if (body.authority_effect !== false) return false;
  return HEARTBEAT_PHASES.has(String(body.phase || '').toUpperCase());
}

function heartbeatAckIsValid(value) {
  return value?.accepted === true
    && value?.authority_effect === false
    && value?.state_document_mutated === false
    && value?.liveness_mutated === true
    && value?.last_seen_at_mutated === true;
}

export function createNativeSupervisorHeartbeatRoute({ rpc, workspaceId, json } = {}) {
  if (typeof rpc !== 'function') throw new Error('native_heartbeat_rpc_required');
  if (!workspaceId) throw new Error('native_heartbeat_workspace_required');
  if (typeof json !== 'function') throw new Error('native_heartbeat_json_required');

  return async function nativeSupervisorHeartbeatRoute({ req, path, body, identity } = {}) {
    if (path !== NATIVE_SUPERVISOR_HEARTBEAT_PATH) return null;
    if (req?.method !== 'POST') return json(405, {
      error: 'native_heartbeat_method_not_allowed',
      automatic_retry_allowed: false,
      authority_effect: false,
    });
    if (!identity?.id || !identity?.device_id) return json(401, {
      error: 'native_heartbeat_device_identity_required',
      automatic_retry_allowed: false,
      authority_effect: false,
    });
    if (!heartbeatBodyIsValid(body)) return json(400, {
      error: 'native_heartbeat_payload_invalid',
      state_payload_allowed: false,
      allowed_phases: [...HEARTBEAT_PHASES],
      allowed_fields: [...HEARTBEAT_FIELDS],
      automatic_retry_allowed: false,
      authority_effect: false,
    });

    let accepted;
    try {
      accepted = await rpc(NATIVE_SUPERVISOR_HEARTBEAT_RPC, {
        p_workspace_id: String(workspaceId),
        p_client_id: String(identity.id),
        p_authority_effect: false,
      });
    } catch (error) {
      if (heartbeatAcceptorUnavailable(error)) return json(501, {
        error: 'native_heartbeat_acceptor_unavailable',
        reason: 'DB_ACCEPTOR_NOT_INSTALLED',
        automatic_retry_allowed: false,
        authority_effect: false,
      });
      throw error;
    }

    if (!heartbeatAckIsValid(accepted)) return json(409, {
      error: 'native_heartbeat_not_accepted',
      reason: String(accepted?.reason || 'HEARTBEAT_ACK_INVALID').slice(0, 160),
      automatic_retry_allowed: false,
      authority_effect: false,
    });

    return json(202, {
      schema: NATIVE_SUPERVISOR_HEARTBEAT_ACK_SCHEMA,
      accepted: true,
      phase: String(body.phase).toUpperCase(),
      client_id: String(identity.id),
      workspace_id: String(workspaceId),
      last_seen_at: accepted?.last_seen_at || null,
      state_mutated: false,
      state_document_mutated: false,
      liveness_mutated: true,
      last_seen_at_mutated: true,
      command_leasing: false,
      control_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  };
}
