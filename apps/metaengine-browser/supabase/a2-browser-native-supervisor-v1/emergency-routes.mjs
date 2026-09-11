import { waitForEmergencyCommand } from './emergency-command-wait.mjs';

export const EMERGENCY_WAIT_PATH = '/v1/commands/wait-emergency';
export const EMERGENCY_LEASE_RPC = 'h205f22_a2_browser_supervisor_lease_emergency_v1';

function boundedWaitMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 4000;
  return Math.max(250, Math.min(15000, Math.trunc(parsed)));
}

export function createEmergencyCommandRoutes({
  rpc,
  workspaceId,
  openWake,
  json,
} = {}) {
  if (typeof rpc !== 'function') throw new Error('emergency_routes_rpc_required');
  if (typeof openWake !== 'function') throw new Error('emergency_routes_wake_required');
  if (typeof json !== 'function') throw new Error('emergency_routes_json_required');
  const workspace = String(workspaceId || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(workspace)) throw new Error('emergency_routes_workspace_invalid');

  return async function emergencyRoutes({ req, path, body, clientId } = {}) {
    if (req?.method !== 'POST' || path !== EMERGENCY_WAIT_PATH) return null;
    const client = String(clientId || '').trim().slice(0, 160);
    if (!client) return json(400, { error: 'emergency_client_id_required', authority_effect: false });
    const waitMs = boundedWaitMs(body?.wait_ms);
    const result = await waitForEmergencyCommand({
      leaseEmergency: () => rpc(EMERGENCY_LEASE_RPC, {
        p_workspace_id: workspace,
        p_client_id: client,
        p_lease_timeout_seconds: 120,
      }),
      openWake: ({ waitMs: bounded }) => openWake({ clientId: client, waitMs: bounded }),
      waitMs,
    });
    return json(200, {
      ...result,
      route: EMERGENCY_WAIT_PATH,
      authenticated_device_required: true,
      general_scheduler_dependency: false,
      second_general_scheduler: false,
      transport_delivery_is_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  };
}
