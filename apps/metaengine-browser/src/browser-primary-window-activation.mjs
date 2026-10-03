export const PRIMARY_WINDOW_STABLE_MS = 1_500;
export const PRIMARY_WINDOW_OBSERVE_TIMEOUT_MS = 30_000;

function liveWindows(BaseWindow) {
  if (!BaseWindow || typeof BaseWindow.getAllWindows !== 'function') return [];
  const rows = BaseWindow.getAllWindows();
  if (!Array.isArray(rows)) return [];
  return rows.filter((win) => win && typeof win.isDestroyed === 'function' && win.isDestroyed() !== true);
}

export function activateExistingPrimaryWindow(BaseWindow) {
  try {
    const windows = liveWindows(BaseWindow);
    if (windows.length === 0) {
      return Object.freeze({
        ok: false,
        reason: 'PRIMARY_WINDOW_NOT_READY',
        window_count: 0,
        authority_effect: false,
      });
    }
    const focused = typeof BaseWindow.getFocusedWindow === 'function' ? BaseWindow.getFocusedWindow() : null;
    const target = focused && windows.includes(focused) ? focused : windows[0];
    const wasMinimized = typeof target.isMinimized === 'function' && target.isMinimized() === true;
    if (wasMinimized && typeof target.restore === 'function') target.restore();
    if (typeof target.show === 'function') target.show();
    if (typeof target.focus === 'function') target.focus();
    return Object.freeze({
      ok: true,
      reason: 'PRIMARY_WINDOW_ACTIVATED',
      window_count: windows.length,
      restored: wasMinimized,
      visible: typeof target.isVisible === 'function' ? target.isVisible() === true : null,
      focused: typeof target.isFocused === 'function' ? target.isFocused() === true : null,
      authority_effect: false,
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: 'PRIMARY_WINDOW_ACTIVATION_ERROR',
      error: String(error?.message || error).slice(0, 200),
      authority_effect: false,
    });
  }
}

export async function waitForStablePrimaryWindow(BaseWindow, {
  timeout_ms = PRIMARY_WINDOW_OBSERVE_TIMEOUT_MS,
  stable_ms = PRIMARY_WINDOW_STABLE_MS,
  poll_ms = 100,
  clock = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (![timeout_ms, stable_ms, poll_ms].every((value) => Number.isFinite(value) && value > 0)) {
    return Object.freeze({ ok: false, reason: 'PRIMARY_WINDOW_OBSERVER_CONFIG_INVALID', authority_effect: false });
  }
  const startedAt = Number(clock());
  if (!Number.isFinite(startedAt)) {
    return Object.freeze({ ok: false, reason: 'PRIMARY_WINDOW_OBSERVER_CLOCK_INVALID', authority_effect: false });
  }
  let target = null;
  let stableSince = null;

  while (Number(clock()) - startedAt <= timeout_ms) {
    let windows;
    try {
      windows = liveWindows(BaseWindow);
    } catch {
      windows = [];
    }
    const visible = windows.find((win) => typeof win.isVisible !== 'function' || win.isVisible() === true) || null;
    const now = Number(clock());
    if (visible && visible === target) {
      if (stableSince != null && now - stableSince >= stable_ms) {
        return Object.freeze({
          ok: true,
          reason: 'PRIMARY_WINDOW_STABLE',
          window_count: windows.length,
          stable_ms: now - stableSince,
          visible: typeof visible.isVisible === 'function' ? visible.isVisible() === true : null,
          focused: typeof visible.isFocused === 'function' ? visible.isFocused() === true : null,
          authority_effect: false,
        });
      }
    } else if (visible) {
      target = visible;
      stableSince = now;
    } else {
      target = null;
      stableSince = null;
    }
    await sleep(poll_ms);
  }

  return Object.freeze({
    ok: false,
    reason: 'PRIMARY_WINDOW_STABLE_TIMEOUT',
    window_count: liveWindows(BaseWindow).length,
    authority_effect: false,
  });
}
