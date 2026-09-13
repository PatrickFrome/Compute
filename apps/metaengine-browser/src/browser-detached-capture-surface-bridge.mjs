export const DETACHED_CAPTURE_SURFACE_BRIDGE_SCHEMA = 'metaengine.browser.detached-capture-surface-bridge.v1';

const SURFACE_READ_METHODS = new Set([
  'Page.enable',
  'DOM.enable',
  'Accessibility.enable',
  'Runtime.enable',
  'Page.setLifecycleEventsEnabled',
  'Network.enable',
  'DOM.getDocument',
  'Target.setAutoAttach',
  'Page.getLayoutMetrics',
  'Page.captureScreenshot',
]);
const DEFAULT_IDLE_RELEASE_MS = 40;
const bridgeByWebContents = new WeakMap();

function liveView(view) {
  return Boolean(view?.webContents) && view.webContents.isDestroyed?.() !== true;
}

function normalizedBounds(view) {
  let raw = null;
  try { raw = view?.getBounds?.() || null; } catch {}
  const width = Math.max(1, Math.min(4096, Math.floor(Number(raw?.width) || 1280)));
  const height = Math.max(1, Math.min(4096, Math.floor(Number(raw?.height) || 720)));
  return {
    original: raw && Number.isFinite(Number(raw.x)) && Number.isFinite(Number(raw.y))
      ? { x: Math.floor(Number(raw.x)), y: Math.floor(Number(raw.y)), width, height }
      : { x: 0, y: 0, width, height },
    hosted: { x: 0, y: 0, width, height },
  };
}

function windowContainsView(BaseWindow, view, excludedWindow = null) {
  let windows = [];
  try { windows = BaseWindow?.getAllWindows?.() || []; } catch { return false; }
  return windows.some((win) => {
    if (!win || win === excludedWindow || win.isDestroyed?.()) return false;
    try { return Array.isArray(win.contentView?.children) && win.contentView.children.includes(view); } catch { return false; }
  });
}

function releaseHiddenHost(state) {
  if (state.releaseTimer) {
    clearTimeout(state.releaseTimer);
    state.releaseTimer = null;
  }
  const host = state.host;
  if (!host) return false;
  state.host = null;
  const view = state.view;
  try {
    if (Array.isArray(host.contentView?.children) && host.contentView.children.includes(view)) {
      host.contentView.removeChildView(view);
    }
  } catch {}
  try {
    const BaseWindow = state.BaseWindow;
    if (state.originalBounds && BaseWindow && !windowContainsView(BaseWindow, view, host)) {
      view.setBounds?.(state.originalBounds);
    }
  } catch {}
  state.originalBounds = null;
  try { if (!host.isDestroyed?.()) host.destroy(); } catch {}
  return true;
}

function scheduleHiddenHostRelease(state) {
  if (!state.host) return;
  if (state.releaseTimer) clearTimeout(state.releaseTimer);
  state.releaseTimer = setTimeout(() => releaseHiddenHost(state), state.idleReleaseMs);
  state.releaseTimer.unref?.();
}

async function ensureRenderableSurface(state) {
  if (!liveView(state.view)) throw new Error('detached_capture_surface_view_unavailable');
  const electron = await state.loadElectronImpl();
  const BaseWindow = electron?.BaseWindow;
  if (typeof BaseWindow !== 'function' || typeof BaseWindow.getAllWindows !== 'function') {
    throw new Error('detached_capture_surface_basewindow_unavailable');
  }
  state.BaseWindow = BaseWindow;

  if (state.host && !state.host.isDestroyed?.()) {
    try {
      if (Array.isArray(state.host.contentView?.children) && state.host.contentView.children.includes(state.view)) {
        return { hosted: true, generation: state.surfaceGeneration };
      }
    } catch {}
    releaseHiddenHost(state);
  }

  if (windowContainsView(BaseWindow, state.view)) return { hosted: false, generation: state.surfaceGeneration };

  const bounds = normalizedBounds(state.view);
  const host = new BaseWindow({
    width: bounds.hosted.width,
    height: bounds.hosted.height,
    show: false,
    focusable: false,
    skipTaskbar: true,
    frame: false,
    title: 'METAENGINE Capture Surface',
  });
  try { host.setIgnoreMouseEvents?.(true); } catch {}
  try {
    host.contentView.addChildView(state.view);
    state.view.setBounds?.(bounds.hosted);
  } catch (error) {
    try { if (!host.isDestroyed?.()) host.destroy(); } catch {}
    throw error;
  }
  state.host = host;
  state.originalBounds = bounds.original;
  state.surfaceGeneration += 1;
  return { hosted: true, generation: state.surfaceGeneration };
}

async function runSurfaceRead(state, args) {
  await ensureRenderableSurface(state);
  try {
    return await state.originalSendCommand(...args);
  } finally {
    scheduleHiddenHostRelease(state);
  }
}

export function installDetachedCaptureSurfaceBridge(view, {
  loadElectronImpl = () => import('electron'),
  idleReleaseMs = DEFAULT_IDLE_RELEASE_MS,
} = {}) {
  if (!liveView(view)) throw new Error('detached_capture_surface_view_required');
  const webContents = view.webContents;
  const existing = bridgeByWebContents.get(webContents);
  if (existing?.view === view) return existing.snapshot();
  if (existing) uninstallDetachedCaptureSurfaceBridge(existing.view);

  const debuggerApi = webContents.debugger;
  if (!debuggerApi || typeof debuggerApi.sendCommand !== 'function') {
    throw new Error('detached_capture_surface_debugger_unavailable');
  }
  const originalMethod = debuggerApi.sendCommand;
  const hadOwnSendCommand = Object.hasOwn(debuggerApi, 'sendCommand');
  const originalOwnDescriptor = hadOwnSendCommand ? Object.getOwnPropertyDescriptor(debuggerApi, 'sendCommand') : null;
  const state = {
    view,
    webContents,
    debuggerApi,
    originalMethod,
    originalSendCommand: originalMethod.bind(debuggerApi),
    hadOwnSendCommand,
    originalOwnDescriptor,
    loadElectronImpl,
    idleReleaseMs: Math.max(0, Math.min(1000, Number(idleReleaseMs) || DEFAULT_IDLE_RELEASE_MS)),
    host: null,
    BaseWindow: null,
    originalBounds: null,
    releaseTimer: null,
    surfaceGeneration: 0,
    tail: Promise.resolve(),
    wrapper: null,
    snapshot() {
      return Object.freeze({
        schema: DETACHED_CAPTURE_SURFACE_BRIDGE_SCHEMA,
        web_contents_id: Number(webContents.id) || null,
        installed: true,
        surface_generation: state.surfaceGeneration,
        bridged_methods: [...SURFACE_READ_METHODS],
        input_authority: false,
        navigation_authority: false,
        automatic_retry_allowed: false,
        authority_effect: false,
      });
    },
  };

  state.wrapper = function metaengineSurfaceAwareSendCommand(...args) {
    const method = String(args[0] || '');
    if (!SURFACE_READ_METHODS.has(method)) return state.originalSendCommand(...args);
    const run = state.tail.then(() => runSurfaceRead(state, args));
    state.tail = run.then(() => undefined, () => undefined);
    return run;
  };

  debuggerApi.sendCommand = state.wrapper;
  bridgeByWebContents.set(webContents, state);
  return state.snapshot();
}

export function uninstallDetachedCaptureSurfaceBridge(viewOrWebContents) {
  const webContents = viewOrWebContents?.webContents || viewOrWebContents;
  const state = webContents && bridgeByWebContents.get(webContents);
  if (!state) return false;
  bridgeByWebContents.delete(webContents);
  releaseHiddenHost(state);
  try {
    if (state.debuggerApi.sendCommand === state.wrapper) {
      if (state.hadOwnSendCommand && state.originalOwnDescriptor) {
        Object.defineProperty(state.debuggerApi, 'sendCommand', state.originalOwnDescriptor);
      } else {
        delete state.debuggerApi.sendCommand;
      }
    }
  } catch {
    try { state.debuggerApi.sendCommand = state.originalMethod; } catch {}
  }
  return true;
}

export function detachedCaptureSurfaceBridgeSnapshot(webContents) {
  const state = webContents && bridgeByWebContents.get(webContents);
  return state ? state.snapshot() : null;
}
