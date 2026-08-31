const ACTIVE_WAKE_RE = /^wake_[a-z0-9-]+$/i;

function text(value) { return String(value ?? '').trim(); }
function isoMs(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Decide whether an already-confirmed supervisor wake may be retired at an
 * observed terminal boundary without sending or retrying any effect.
 *
 * This deliberately rejects the normal just-sent IDLE race. Retirement while
 * previous_state is IDLE is allowed only for a durable restored request, or
 * after an exact supervisor-tab rebind and a bounded confirmed-wake age.
 */
export function evaluateActiveWakeTerminalRetirement({
  active_request,
  active_wake,
  terminal_row,
  previous_state,
  observed_tab_id,
  keepalive_tab_id,
  now_ms = Date.now(),
  orphan_grace_ms = 30_000,
} = {}) {
  const requestWake = text(active_request?.wake_id);
  const durableWake = text(active_wake?.wake_id);
  const observedTab = text(observed_tab_id);
  const keepaliveTab = text(keepalive_tab_id);
  const requestTab = text(active_request?.tab_id);
  const previous = text(previous_state).toUpperCase();
  const rowState = text(terminal_row?.state).toUpperCase();
  const generationEpoch = Number(terminal_row?.generation_epoch);
  const confirmedMs = isoMs(active_wake?.confirmed_at);
  const ageMs = confirmedMs == null ? null : Math.max(0, Number(now_ms) - confirmedMs);

  const base = {
    retire: false,
    reason: null,
    wake_id: durableWake || null,
    observed_tab_id: observedTab || null,
    prior_request_tab_id: requestTab || null,
    generation_epoch: Number.isSafeInteger(generationEpoch) && generationEpoch >= 0 ? generationEpoch : null,
    automatic_retry_allowed: false,
    authority_effect: false,
  };

  if (!ACTIVE_WAKE_RE.test(requestWake) || requestWake !== durableWake) return Object.freeze({ ...base, reason: 'WAKE_BINDING_MISMATCH' });
  if (terminal_row?.terminal_ready !== true || rowState !== 'IDLE') return Object.freeze({ ...base, reason: 'TERMINAL_NOT_PROVEN' });
  if (!observedTab || observedTab !== keepaliveTab) return Object.freeze({ ...base, reason: 'CURRENT_TAB_BINDING_MISMATCH' });
  if (!Number.isSafeInteger(generationEpoch) || generationEpoch < 0) return Object.freeze({ ...base, reason: 'GENERATION_EPOCH_INVALID' });

  if (previous && previous !== 'UNKNOWN' && previous !== 'IDLE') {
    return Object.freeze({ ...base, retire: true, reason: 'GENERATION_TO_TERMINAL' });
  }

  if (active_request?.restored_from_durable_keepalive === true) {
    return Object.freeze({ ...base, retire: true, reason: 'RESTORED_ACTIVE_WAKE_TERMINAL' });
  }

  const rebound = requestTab && requestTab !== observedTab;
  const grace = Math.max(10_000, Number(orphan_grace_ms) || 30_000);
  if (rebound && ageMs != null && ageMs >= grace) {
    return Object.freeze({ ...base, retire: true, reason: 'REBIND_ORPHAN_TERMINAL' });
  }

  return Object.freeze({ ...base, reason: rebound ? 'REBIND_GRACE_NOT_ELAPSED' : 'JUST_SENT_IDLE_RACE' });
}
