export const RSI_RUNTIME_FRONTIER_INTAKE_RPC = 'h205f22_rsi_runtime_frontier_intake_v1';
export const RSI_RUNTIME_FRONTIER_INTAKE_SCHEMA = 'metaengine.rsi.runtime-frontier-intake.edge.v1';

function boundedError(error) {
  return String(error?.message || error || 'unknown').slice(0, 240);
}

function terminal(state, reason) {
  return Object.freeze({
    schema: RSI_RUNTIME_FRONTIER_INTAKE_SCHEMA,
    state,
    reason,
    rpc_called: false,
    scheduler: 'DEVOS_EXISTING_ONLY',
    browser_enqueue_authority: false,
    execution_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function createRsiRuntimeFrontierIntake({ rpc } = {}) {
  if (typeof rpc !== 'function') throw new Error('rsi_frontier_intake_rpc_required');

  return async function intake({ workspaceId, clientId, state } = {}) {
    const client = String(clientId || '').trim().slice(0, 160);
    if (!workspaceId || !client) return terminal('SKIPPED','IDENTITY_INCOMPLETE');
    if (!state || typeof state !== 'object' || Array.isArray(state)) return terminal('SKIPPED','STATE_INVALID');
    if (!Object.prototype.hasOwnProperty.call(state, 'rsi')) return terminal('SKIPPED','RSI_NOT_PRESENT');
    if (state.rsi == null) return terminal('SKIPPED','RSI_NULL');
    if (typeof state.rsi !== 'object' || Array.isArray(state.rsi)) return terminal('REJECTED','RSI_INVALID');
    let rsi;
    try {
      const encoded = JSON.stringify(state.rsi);
      if (encoded.length > 65_536) return terminal('REJECTED','RSI_OVERSIZED');
      rsi = JSON.parse(encoded);
    } catch {
      return terminal('REJECTED','RSI_UNSERIALIZABLE');
    }

    try {
      const result = await rpc(RSI_RUNTIME_FRONTIER_INTAKE_RPC, {
        p_workspace: workspaceId,
        p_client: client,
        p_state: { rsi },
      });
      return Object.freeze({
        schema: RSI_RUNTIME_FRONTIER_INTAKE_SCHEMA,
        state: result?.accepted === true ? 'ACCEPTED' : 'REJECTED',
        reason: result?.state || result?.reason || null,
        rpc_called: true,
        result: result && typeof result === 'object' ? structuredClone(result) : null,
        scheduler: 'DEVOS_EXISTING_ONLY',
        browser_enqueue_authority: false,
        execution_authority: false,
        promotion_authority: false,
        self_update_authority: false,
        automatic_retry_allowed: false,
        authority_effect: false,
      });
    } catch (error) {
      return Object.freeze({
        schema: RSI_RUNTIME_FRONTIER_INTAKE_SCHEMA,
        state: 'ERROR',
        reason: 'INTAKE_RPC_FAILED',
        error: boundedError(error),
        rpc_called: true,
        scheduler: 'DEVOS_EXISTING_ONLY',
        browser_enqueue_authority: false,
        execution_authority: false,
        promotion_authority: false,
        self_update_authority: false,
        automatic_retry_allowed: false,
        authority_effect: false,
      });
    }
  };
}
