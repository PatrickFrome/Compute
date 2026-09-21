const DEFAULT_TEMPORARY_CAPTURE_SURFACE_DEADLINE_MS = 5000;
const DEFAULT_TEMPORARY_CAPTURE_SURFACE_SETTLE_MS = 100;
const activeCaptureSurfaceLeases = new WeakSet();

function boundedInt(value, fallback, min, max) {
  const n = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? Math.floor(n) : fallback));
}

function exactViewBounds(view) {
  const bounds = view?.getBounds?.() || null;
  const width = Math.floor(Number(bounds?.width || 0));
  const height = Math.floor(Number(bounds?.height || 0));
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    const error = new Error('detached_capture_surface_bounds_unavailable');
    error.code = 'DETACHED_CAPTURE_SURFACE_BOUNDS_UNAVAILABLE';
    error.automatic_retry_allowed = false;
    throw error;
  }
  return {
    x: Math.floor(Number(bounds?.x || 0)),
    y: Math.floor(Number(bounds?.y || 0)),
    width,
    height,
  };
}

function temporarySurfaceTimeoutError(deadlineMs) {
  const error = new Error(`detached_capture_surface_timeout:${deadlineMs}`);
  error.code = 'DETACHED_CAPTURE_SURFACE_TIMEOUT';
  error.deadline_ms = deadlineMs;
  error.automatic_retry_allowed = false;
  return error;
}

function temporarySurfaceBusyError() {
  const error = new Error('detached_capture_surface_busy');
  error.code = 'DETACHED_CAPTURE_SURFACE_BUSY';
  error.automatic_retry_allowed = false;
  return error;
}

async function defaultCreateCaptureHost({ width, height }) {
  const { BaseWindow } = await import('electron');
  return new BaseWindow({
    width,
    height,
    show: false,
    useContentSize: true,
    backgroundColor: '#000000',
  });
}

export function detachedCaptureSurfaceContract() {
  return Object.freeze({
    schema: 'metaengine.browser.detached-capture-surface.contract.v1',
    exact_existing_view_only: true,
    second_webcontents_created: false,
    hidden_host_only: true,
    restores_detached_state: true,
    bounded: true,
    single_flight_per_view: true,
    timeout_quarantines_until_task_settled: true,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export async function withTemporaryDetachedCaptureSurface(view, task, {
  deadlineMs = DEFAULT_TEMPORARY_CAPTURE_SURFACE_DEADLINE_MS,
  settleMs = DEFAULT_TEMPORARY_CAPTURE_SURFACE_SETTLE_MS,
  createHost = defaultCreateCaptureHost,
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!view || typeof view !== 'object' || !view.webContents || view.webContents.isDestroyed?.()) {
    throw new Error('detached_capture_surface_view_unavailable');
  }
  if (typeof task !== 'function') throw new Error('detached_capture_surface_task_required');
  if (activeCaptureSurfaceLeases.has(view)) throw temporarySurfaceBusyError();
  activeCaptureSurfaceLeases.add(view);

  let host = null;
  let attached = false;
  let timer = null;
  let originalBounds = null;
  const originalVisible = view.getVisible?.() !== false;
  let work = null;
  let deadlineExpired = false;
  try {
    originalBounds = exactViewBounds(view);
    const boundedDeadlineMs = boundedInt(deadlineMs, DEFAULT_TEMPORARY_CAPTURE_SURFACE_DEADLINE_MS, 250, 15000);
    const boundedSettleMs = boundedInt(settleMs, DEFAULT_TEMPORARY_CAPTURE_SURFACE_SETTLE_MS, 0, 500);
    host = await createHost({ width: originalBounds.width, height: originalBounds.height });
    if (!host?.contentView || typeof host.contentView.addChildView !== 'function' || typeof host.contentView.removeChildView !== 'function') {
      throw new Error('detached_capture_surface_host_invalid');
    }

    host.contentView.addChildView(view);
    attached = true;
    view.setBounds({ x: 0, y: 0, width: originalBounds.width, height: originalBounds.height });
    view.setVisible?.(true);
    if (boundedSettleMs > 0) await sleepImpl(boundedSettleMs);

    work = Promise.resolve().then(task);
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        deadlineExpired = true;
        reject(temporarySurfaceTimeoutError(boundedDeadlineMs));
      }, boundedDeadlineMs);
    });
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
    if (attached) {
      try { host?.contentView?.removeChildView?.(view); } catch {}
    }
    if (originalBounds) {
      try { view.setBounds(originalBounds); } catch {}
    }
    if (!originalVisible) {
      try { view.setVisible?.(false); } catch {}
    }
    try { host?.close?.(); } catch {}

    if (deadlineExpired && work) {
      // `capturePage()` is not abortable. Keep the exact View quarantined even
      // after the temporary host is torn down so a late/hung capture cannot
      // overlap a second lease. A permanently hung capture therefore fails
      // future captures closed instead of silently violating single-flight.
      void work.then(
        () => { activeCaptureSurfaceLeases.delete(view); },
        () => { activeCaptureSurfaceLeases.delete(view); },
      );
    } else {
      activeCaptureSurfaceLeases.delete(view);
    }
  }
}
