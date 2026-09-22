export const BROWSER_GUARDIAN_SESSION_BROKER_CORE_VERSION = '1.0.0';
export const BROWSER_GUARDIAN_SESSION_BROKER_PLAN_SCHEMA = 'metaengine.browser-guardian.session-broker-plan.v1';

const ACTIONS = new Set([
  'NOOP',
  'HOLD_NO_SESSION',
  'HOLD_AMBIGUOUS_SESSION',
  'HOLD_BROKER_IDENTITY',
  'START_BROKER',
  'RESTART_EXACT_BROKER',
  'ESCALATE_TO_SCM_RECOVERY',
]);
const EFFECT_ACTIONS = new Set(['START_BROKER', 'RESTART_EXACT_BROKER']);
const SID_RE = /^S-\d-\d+(?:-\d+)+$/i;

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function finiteInt(value, fallback = -1) {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : fallback;
}

function normalizedSid(value) {
  const sid = String(value ?? '').trim().toUpperCase();
  return SID_RE.test(sid) ? sid : null;
}

function nonEmpty(value) {
  const out = String(value ?? '').trim();
  return out || null;
}

function output(action, reason, extra = {}) {
  if (!ACTIONS.has(action)) throw new Error('guardian_session_broker_action_invalid');
  return freeze({
    schema: BROWSER_GUARDIAN_SESSION_BROKER_PLAN_SCHEMA,
    version: BROWSER_GUARDIAN_SESSION_BROKER_CORE_VERSION,
    action,
    reason,
    process_effect_candidate: EFFECT_ACTIONS.has(action),
    requires_user_session_executor: EFFECT_ACTIONS.has(action),
    actuation_eligible: false,
    automatic_retry_allowed: false,
    browser_authority: false,
    task_authority: false,
    scheduler_authority: false,
    page_model_text_authority: false,
    release_authority: false,
    session_token_authority: false,
    authority_effect: false,
    ...extra,
  });
}

function policy(input = {}) {
  return freeze({
    broker_liveness_timeout_ms: Math.max(500, finiteInt(input.broker_liveness_timeout_ms, 15_000)),
    restart_window_ms: Math.max(1_000, finiteInt(input.restart_window_ms, 60_000)),
    max_restarts_in_window: Math.max(1, finiteInt(input.max_restarts_in_window, 3)),
  });
}

function restartCount(history, nowMs, windowMs) {
  if (!Array.isArray(history)) return 0;
  const floor = nowMs - windowMs;
  return history.reduce((count, value) => {
    const at = finiteInt(value, -1);
    return count + (at >= floor && at <= nowMs ? 1 : 0);
  }, 0);
}

function exactActiveSessions(sessions, expectedSid) {
  if (!Array.isArray(sessions)) return [];
  return sessions
    .map((session) => {
      if (!session || typeof session !== 'object' || Array.isArray(session)) return null;
      const sessionId = finiteInt(session.session_id, -1);
      const sid = normalizedSid(session.user_sid);
      const state = String(session.state || '').trim().toUpperCase();
      if (sessionId < 0 || sid !== expectedSid || state !== 'ACTIVE') return null;
      return freeze({ session_id: sessionId, user_sid: sid, state: 'ACTIVE' });
    })
    .filter(Boolean);
}

function exactBrokerIdentity(broker) {
  if (!broker || typeof broker !== 'object' || Array.isArray(broker)) return null;
  const pid = finiteInt(broker.pid, 0);
  const processIncarnationId = nonEmpty(broker.process_incarnation_id);
  const sessionId = finiteInt(broker.session_id, -1);
  const userSid = normalizedSid(broker.user_sid);
  const heartbeatAtMs = finiteInt(broker.heartbeat_at_ms, -1);
  if (pid < 1 || !processIncarnationId || sessionId < 0 || !userSid || heartbeatAtMs < 0) return null;
  return freeze({
    pid,
    process_incarnation_id: processIncarnationId,
    session_id: sessionId,
    user_sid: userSid,
    heartbeat_at_ms: heartbeatAtMs,
  });
}

function escalationOr(action, reason, selectedSession, observed, nowMs, resolvedPolicy, extra = {}) {
  const count = restartCount(observed?.broker_restart_history_ms, nowMs, resolvedPolicy.restart_window_ms);
  if (count >= resolvedPolicy.max_restarts_in_window) {
    return output('ESCALATE_TO_SCM_RECOVERY', 'BROKER_RESTART_INTENSITY_EXCEEDED', {
      blocked_reason: reason,
      selected_session: selectedSession,
      restart_count_in_window: count,
      restart_window_ms: resolvedPolicy.restart_window_ms,
      ...extra,
    });
  }
  return output(action, reason, {
    selected_session: selectedSession,
    restart_count_in_window: count,
    restart_window_ms: resolvedPolicy.restart_window_ms,
    ...extra,
  });
}

/**
 * Pure Session-0 -> interactive-user broker planner.
 *
 * The SCM service must never guess an interactive user. The caller supplies one
 * durable expected owner SID and observed WTS sessions. Only one ACTIVE session with
 * that exact SID can qualify a broker start/restart candidate. This function never
 * obtains a token, calls WTSQueryUserToken/CreateProcessAsUser, terminates a process,
 * starts the Browser, or performs any page/task/release effect.
 */
export function evaluateGuardianSessionBrokerPlan({ desired = {}, observed = {}, now_ms = Date.now() } = {}) {
  const nowMs = finiteInt(now_ms, -1);
  if (nowMs < 0) return output('HOLD_NO_SESSION', 'CLOCK_INVALID');

  if (desired.external_stop_requested === true || String(desired.state || '').toUpperCase() === 'STOPPED') {
    return output('NOOP', 'EXTERNAL_STOP_RECORDED');
  }
  if (String(desired.state || 'RUNNING').toUpperCase() !== 'RUNNING') {
    return output('HOLD_NO_SESSION', 'DESIRED_STATE_INVALID');
  }

  const expectedSid = normalizedSid(desired.expected_owner_sid);
  if (!expectedSid) return output('HOLD_NO_SESSION', 'EXPECTED_OWNER_SID_INVALID');

  const sessions = exactActiveSessions(observed.sessions, expectedSid);
  if (sessions.length === 0) {
    return output('HOLD_NO_SESSION', 'EXPECTED_OWNER_SESSION_NOT_ACTIVE', { expected_owner_sid: expectedSid });
  }
  if (sessions.length !== 1) {
    return output('HOLD_AMBIGUOUS_SESSION', 'EXPECTED_OWNER_SESSION_AMBIGUOUS', {
      expected_owner_sid: expectedSid,
      matching_session_ids: Object.freeze(sessions.map((row) => row.session_id).sort((a, b) => a - b)),
    });
  }

  const selectedSession = sessions[0];
  const resolvedPolicy = policy(desired.broker_policy);
  const broker = observed.broker;
  if (!broker) {
    if (observed.broker_absence_proven !== true) {
      return output('HOLD_BROKER_IDENTITY', 'BROKER_ABSENCE_UNPROVEN', { selected_session: selectedSession });
    }
    return escalationOr(
      'START_BROKER',
      'EXACT_OWNER_SESSION_BROKER_ABSENCE_PROVEN',
      selectedSession,
      observed,
      nowMs,
      resolvedPolicy,
      { broker_absence_proven: true },
    );
  }

  const exactBroker = exactBrokerIdentity(broker);
  if (!exactBroker) {
    return output('HOLD_BROKER_IDENTITY', 'BROKER_IDENTITY_INCOMPLETE', { selected_session: selectedSession });
  }
  if (exactBroker.user_sid !== selectedSession.user_sid || exactBroker.session_id !== selectedSession.session_id) {
    return output('HOLD_BROKER_IDENTITY', 'BROKER_SESSION_BINDING_MISMATCH', {
      selected_session: selectedSession,
      observed_broker: exactBroker,
    });
  }

  if (exactBroker.heartbeat_at_ms > nowMs) {
    return output('HOLD_BROKER_IDENTITY', 'BROKER_HEARTBEAT_TIMESTAMP_INVALID', {
      selected_session: selectedSession,
      exact_broker: exactBroker,
    });
  }

  const heartbeatAgeMs = nowMs - exactBroker.heartbeat_at_ms;
  if (heartbeatAgeMs > resolvedPolicy.broker_liveness_timeout_ms) {
    return escalationOr(
      'RESTART_EXACT_BROKER',
      'BROKER_LIVENESS_TIMEOUT',
      selectedSession,
      observed,
      nowMs,
      resolvedPolicy,
      {
        exact_pid: exactBroker.pid,
        exact_process_incarnation_id: exactBroker.process_incarnation_id,
        heartbeat_age_ms: heartbeatAgeMs,
        broker_liveness_timeout_ms: resolvedPolicy.broker_liveness_timeout_ms,
      },
    );
  }

  return output('NOOP', 'EXACT_OWNER_SESSION_BROKER_HEALTHY', {
    selected_session: selectedSession,
    exact_pid: exactBroker.pid,
    exact_process_incarnation_id: exactBroker.process_incarnation_id,
    heartbeat_age_ms: heartbeatAgeMs,
  });
}
