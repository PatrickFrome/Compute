// W54: an ADMIN transport connection is not permission to execute work.
// This is a bounded presentation-only projection; the native Owner/readiness
// path remains the sole source of evidence and this grants no effects.
const SCHEMA = 'metaengine.client.work-readiness.v1';
const BLOCKED_LABELS = Object.freeze({
  SUPERVISOR_RECOVERY_REQUIRED: 'Recovery required',
  WORKSPACE_AUTHORITY_UNAVAILABLE: 'Recovery required',
  GENERATION_FLOOR_REGRESSION: 'Recovery required',
  SUPERVISOR_ADMISSION_NOT_OBSERVED: 'Recovery required',
  AGENT_ORIGIN_UNVERIFIED: 'Agents unverified',
  NATIVE_CONTROL_NOT_ARMED: 'Control unavailable',
  HEARTBEAT_READBACK_STALE: 'Status unavailable',
  LOCAL_RUNTIME_STARTING: 'Starting',
  ADMIN_CONNECTION_UNAVAILABLE: 'Reconnecting',
  SUPERVISOR_SESSION_STARTING: 'Starting chats',
});
export function projectClientWorkBadge({ connection = null, work = null } = {}) {
  const connected = connection?.admin_ready === true && connection?.local_runtime_ready === true;
  const valid = work?.schema === SCHEMA && work?.authority_effect === false;
  const ready = connected && valid && work.state === 'READY' &&
    work.execution_ready === true && work.capabilities?.chat_dispatch?.ready === true &&
    work.automatic_retry_allowed === false;
  const paused = connected && valid && work.state === 'PAUSED' &&
    work.execution_ready === false && work.reason === 'WORKSPACE_EXECUTION_PAUSED' &&
    work.capabilities?.chat_dispatch?.ready === false;
  const blocked = connected && valid && work.state === 'BLOCKED' &&
    work.execution_ready === false && work.capabilities?.chat_dispatch?.ready === false;
  const reason = blocked && Object.hasOwn(BLOCKED_LABELS, work.reason) ? work.reason :
    paused ? 'WORKSPACE_EXECUTION_PAUSED' : null;
  const state = ready ? 'READY' : paused ? 'PAUSED' : blocked ? 'BLOCKED' : 'UNAVAILABLE';
  const label = ready ? 'Chats ready' : paused ? 'Execution paused' :
    reason ? BLOCKED_LABELS[reason] : 'Status unavailable';
  const autonomousReady = ready && work.continuous_autonomy_ready === true &&
    work.capabilities?.coding_execution?.ready === true &&
    work.capabilities?.host_continuity?.ready === true &&
    work.capabilities?.continuous_autonomy?.ready === true;
  return Object.freeze({
    state, label, reason, admin_ready: connected,
    autonomous_ready_color: autonomousReady,
    // A renderer badge is never installed Owner, Agent, or update authority.
    authority_effect: false,
  });
}
