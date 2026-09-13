export const NATIVE_SUPERVISOR_HEARTBEAT_PATH = '/v1/heartbeat';
export const NATIVE_SUPERVISOR_HEARTBEAT_RPC = 'h205f22_a2_browser_supervisor_heartbeat_v1';
export const NATIVE_SUPERVISOR_HEARTBEAT_ACK_SCHEMA = 'metaengine.native-supervisor.heartbeat-ack.v1';

function heartbeatAcceptorUnavailable(error) {
  const message = String(error?.message || error || '');
  return /rest_404:|PGRST202|PGRST203|could not find the function|function .* does not exist/i.test(message);
}

function heartbeatBodyIsValid(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  if (Object.hasOwn(body, 'state')) return false;
  if (body.authority_effect !== false) return false;
  return String(body.phase || '').toUpperCase() === 'WATCHDOG';
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

    if (accepted?.accepted !== true) return json(409, {
      error: 'native_heartbeat_not_accepted',
      reason: String(accepted?.reason || 'STATE_NOT_REGISTERED').slice(0, 160),
      automatic_retry_allowed: false,
      authority_effect: false,
    });

    return json(202, {
      schema: NATIVE_SUPERVISOR_HEARTBEAT_ACK_SCHEMA,
      accepted: true,
      client_id: String(identity.id),
      workspace_id: String(workspaceId),
      last_seen_at: accepted?.last_seen_at || null,
      state_mutated: false,
      command_leasing: false,
      control_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  };
}
