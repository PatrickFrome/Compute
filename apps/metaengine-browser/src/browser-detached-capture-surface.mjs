const DEFAULT_TEMPORARY_CAPTURE_SURFACE_DEADLINE_MS = 5000;
const DEFAULT_TEMPORARY_CAPTURE_SURFACE_SETTLE_MS = 100;

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
  if (view.getVisible?.() === false) {
    const error = new Error('detached_capture_surface_view_hidden');
    error.code = 'DETACHED_CAPTURE_SURFACE_VIEW_HIDDEN';
    error.automatic_retry_allowed = false;
    throw error;
  }

  const originalBounds = exactViewBounds(view);
  const boundedDeadlineMs = boundedInt(deadlineMs, DEFAULT_TEMPORARY_CAPTURE_SURFACE_DEADLINE_MS, 250, 15000);
  const boundedSettleMs = boundedInt(settleMs, DEFAULT_TEMPORARY_CAPTURE_SURFACE_SETTLE_MS, 0, 500);
  const host = await createHost({ width: originalBounds.width, height: originalBounds.height });
  if (!host?.contentView || typeof host.contentView.addChildView !== 'function' || typeof host.contentView.removeChildView !== 'function') {
    try { host?.close?.(); } catch {}
    throw new Error('detached_capture_surface_host_invalid');
  }

  let attached = false;
  let timer = null;
  try {
    host.contentView.addChildView(view);
    attached = true;
    view.setBounds({ x: 0, y: 0, width: originalBounds.width, height: originalBounds.height });
    view.setVisible?.(true);
    if (boundedSettleMs > 0) await sleepImpl(boundedSettleMs);

    const work = Promise.resolve().then(task);
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(temporarySurfaceTimeoutError(boundedDeadlineMs)), boundedDeadlineMs);
    });
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
    if (attached) {
      try { host.contentView.removeChildView(view); } catch {}
    }
    try { view.setBounds(originalBounds); } catch {}
    try { host.close?.(); } catch {}
  }
}
