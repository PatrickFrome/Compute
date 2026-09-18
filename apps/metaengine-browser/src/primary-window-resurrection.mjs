export const PRIMARY_WINDOW_RESURRECTION_SCHEMA = 'metaengine.browser.primary-window-resurrection.v1';
export const DEFAULT_PRIMARY_WINDOW_RECOVERY_TIMEOUT_MS = 6_000;
export const DEFAULT_PRIMARY_WINDOW_RECOVERY_POLL_MS = 100;

function usableWindowCount(BaseWindow) {
  if (!BaseWindow || typeof BaseWindow.getAllWindows !== 'function') return 0;
  return BaseWindow.getAllWindows().filter((win) => {
    if (!win) return false;
    if (typeof win.isDestroyed === 'function' && win.isDestroyed()) return false;
    return true;
  }).length;
}

export function primaryWindowResurrectionContract() {
  return Object.freeze({
    schema: PRIMARY_WINDOW_RESURRECTION_SCHEMA,
    same_primary_process_only: true,
    second_browser_runtime_allowed: false,
    process_termination_allowed: false,
    update_authority_effect: false,
    activation_event_is_request_not_proof: true,
    exact_launch_ack_remains_owned_by_main_entry: true,
    authority_effect: false,
  });
}

export async function requestPrimaryWindowResurrection({
  app,
  BaseWindow,
  timeout_ms = DEFAULT_PRIMARY_WINDOW_RECOVERY_TIMEOUT_MS,
  poll_ms = DEFAULT_PRIMARY_WINDOW_RECOVERY_POLL_MS,
  clock = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!app || typeof app.emit !== 'function') throw new TypeError('primary_window_resurrection_app_required');
  if (!BaseWindow || typeof BaseWindow.getAllWindows !== 'function') throw new TypeError('primary_window_resurrection_base_window_required');
  if (!Number.isFinite(timeout_ms) || timeout_ms < 0) throw new TypeError('primary_window_resurrection_timeout_invalid');
  if (!Number.isFinite(poll_ms) || poll_ms <= 0) throw new TypeError('primary_window_resurrection_poll_invalid');

  const startedAt = Number(clock());
  while (true) {
    const windowCount = usableWindowCount(BaseWindow);
    if (windowCount > 0) {
      return {
        schema: PRIMARY_WINDOW_RESURRECTION_SCHEMA,
        ok: true,
        reason: 'PRIMARY_WINDOW_ALREADY_PRESENT',
        window_count: windowCount,
        recovery_requested: false,
        second_browser_runtime_started: false,
        primary_terminated: false,
        authority_effect: false,
      };
    }

    const ready = typeof app.isReady === 'function' ? app.isReady() === true : true;
    const activateListenerReady = typeof app.listenerCount === 'function'
      ? app.listenerCount('activate') > 0
      : true;
    if (ready && activateListenerReady) {
      const emitted = app.emit('activate');
      return {
        schema: PRIMARY_WINDOW_RESURRECTION_SCHEMA,
        ok: true,
        reason: 'PRIMARY_UI_RECOVERY_REQUESTED',
        window_count: 0,
        recovery_requested: true,
        activate_event_observed: emitted === true,
        second_browser_runtime_started: false,
        primary_terminated: false,
        authority_effect: false,
      };
    }

    const elapsed = Math.max(0, Number(clock()) - startedAt);
    if (elapsed >= timeout_ms) {
      return {
        schema: PRIMARY_WINDOW_RESURRECTION_SCHEMA,
        ok: false,
        reason: 'PRIMARY_UI_RECOVERY_HANDLER_UNAVAILABLE',
        window_count: 0,
        recovery_requested: false,
        elapsed_ms: elapsed,
        second_browser_runtime_started: false,
        primary_terminated: false,
        authority_effect: false,
      };
    }

    await sleep(Math.min(poll_ms, Math.max(1, timeout_ms - elapsed)));
  }
}
