export const BROWSER_CDP_OUTCOME_LATCH_SCHEMA = 'metaengine.browser.cdp-outcome-latch.v1';

function boundedMs(value, fallback = 2000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(100, Math.min(15000, Math.trunc(parsed)));
}

export function openCdpOutcomeLatch({
  subscribe,
  inspect,
  isResolved,
  onDeadline,
  eventFilter = () => true,
  timeoutMs = 2000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  schedule = queueMicrotask,
} = {}) {
  if (typeof subscribe !== 'function') throw new Error('browser_cdp_outcome_latch_subscribe_required');
  if (typeof inspect !== 'function') throw new Error('browser_cdp_outcome_latch_inspect_required');
  if (typeof isResolved !== 'function') throw new Error('browser_cdp_outcome_latch_resolver_required');
  if (typeof onDeadline !== 'function') throw new Error('browser_cdp_outcome_latch_deadline_projection_required');
  if (typeof eventFilter !== 'function') throw new Error('browser_cdp_outcome_latch_event_filter_invalid');
  if (typeof setTimer !== 'function' || typeof clearTimer !== 'function' || typeof schedule !== 'function') {
    throw new Error('browser_cdp_outcome_latch_clock_invalid');
  }

  const deadlineMs = boundedMs(timeoutMs);
  let settled = false;
  let inspectInFlight = false;
  let inspectPending = false;
  let inspections = 0;
  let signals = 0;
  let lastObservation = null;
  let lastError = null;
  let timer = null;
  let unsubscribe = null;
  let resolveWait;

  const waitPromise = new Promise((resolve) => { resolveWait = resolve; });

  const cleanup = () => {
    if (timer != null) {
      try { clearTimer(timer); } catch {}
      timer = null;
    }
    if (unsubscribe) {
      try { unsubscribe(); } catch {}
      unsubscribe = null;
    }
  };

  const finish = (value) => {
    if (settled) return false;
    settled = true;
    cleanup();
    resolveWait(value);
    return true;
  };

  const runInspection = async () => {
    if (settled) return;
    if (inspectInFlight) {
      inspectPending = true;
      return;
    }
    inspectInFlight = true;
    inspections += 1;
    try {
      const observed = await inspect();
      lastObservation = observed;
      lastError = null;
      if (isResolved(observed) === true) finish(observed);
    } catch (error) {
      lastError = String(error?.message || error || 'inspection_failed').slice(0, 240);
    } finally {
      inspectInFlight = false;
      if (inspectPending && !settled) {
        inspectPending = false;
        schedule(() => { void runInspection(); });
      }
    }
  };

  const signal = (event) => {
    if (settled || eventFilter(event) !== true) return false;
    signals += 1;
    if (inspectInFlight) inspectPending = true;
    else schedule(() => { void runInspection(); });
    return true;
  };

  unsubscribe = subscribe(signal);
  if (unsubscribe != null && typeof unsubscribe !== 'function') throw new Error('browser_cdp_outcome_latch_unsubscribe_invalid');
  timer = setTimer(() => {
    let projected;
    try { projected = onDeadline(lastObservation, lastError); }
    catch (error) {
      projected = Object.freeze({
        effect_state: 'AMBIGUOUS',
        reason: String(error?.message || error || 'deadline_projection_failed').slice(0, 160),
        automatic_retry_allowed: false,
        authority_effect: false,
      });
    }
    finish(projected);
  }, deadlineMs);
  timer?.unref?.();

  // One race-closing observation after subscription. Further inspections are
  // exclusively event-triggered; the only timer is the bounded terminal deadline.
  schedule(() => { void runInspection(); });

  return Object.freeze({
    schema: BROWSER_CDP_OUTCOME_LATCH_SCHEMA,
    wait: () => waitPromise,
    signal,
    close() {
      if (settled) return false;
      const projected = onDeadline(lastObservation, lastError);
      return finish(projected);
    },
    snapshot() {
      return Object.freeze({
        schema: BROWSER_CDP_OUTCOME_LATCH_SCHEMA,
        settled,
        inspections,
        signals,
        inspect_in_flight: inspectInFlight,
        inspect_pending: inspectPending,
        last_error: lastError,
        event_driven: true,
        initial_race_closing_read: true,
        poll_timer_required: false,
        deadline_timer_only: true,
        command_leasing: false,
        execution_authority: false,
        automatic_retry_allowed: false,
        authority_effect: false,
      });
    },
    event_driven: true,
    poll_timer_required: false,
    deadline_timer_only: true,
    execution_authority: false,
    authority_effect: false,
  });
}
