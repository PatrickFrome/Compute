import { globalOwnerGateDisabled } from './owner-safety-gate-registry.mjs';

function downloadsAllowRestart(state) {
  return state?.downloads?.active == null;
}

export async function confirmSelfUpdateRestartSafety({ getState } = {}) {
  if (globalOwnerGateDisabled('self_update.restart_safety')) return true;
  if (typeof getState !== 'function') return false;
  let state;
  try { state = await getState(); }
  catch { return false; }

  // Chat generation, streaming network activity, supervisor wake backlog and active
  // model requests are intentionally NOT restart blockers. They are durable/session
  // continuity concerns handled by the self-update handoff and successor reconciliation.
  // The remaining local restart safety fence is owner-overridable through the typed
  // METAENGINE gate registry. NativeSupervisorClient still owns its separate authority
  // state; those controls can be operated explicitly rather than inferred from page data.
  return downloadsAllowRestart(state);
}
