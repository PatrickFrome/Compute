const BUSY_DOWNLOAD_STATES = new Set(['STARTING', 'DOWNLOADING', 'VERIFYING', 'CANCELLING']);

function downloadsAllowRestart(state) {
  const value = String(state?.downloads?.state || state?.downloads?.status || 'IDLE').toUpperCase();
  return !BUSY_DOWNLOAD_STATES.has(value);
}

export async function confirmSelfUpdateRestartSafety({ getState } = {}) {
  if (typeof getState !== 'function') return false;
  let state;
  try { state = await getState(); }
  catch { return false; }

  // Chat generation, streaming network activity, supervisor wake backlog and active
  // model requests are intentionally NOT restart blockers. They are durable/session
  // continuity concerns handled by the self-update handoff and successor reconciliation.
  // The gate here protects only local shell work that cannot safely overlap installer
  // handoff; NativeSupervisorClient separately requires CONTROL + ARMED and no current
  // typed command before entering this gate.
  return downloadsAllowRestart(state);
}
