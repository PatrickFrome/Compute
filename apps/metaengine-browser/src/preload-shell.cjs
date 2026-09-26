const { contextBridge, ipcRenderer } = require('electron');

const snapshotListeners = new Set();
const brainDeltaListeners = new Set();
let brainPort = null;
let brainStreamId = null;
let brainSequence = 0;
let brainBaselinePromise = null;

function unavailableDevOSProjection(reason = 'NOT_EXPOSED') {
  return Object.freeze({
    schema: 'metaengine.devos.projection.v1',
    mode: 'DEVELOPMENT_OS',
    valid: false,
    reason: String(reason || 'NOT_EXPOSED').slice(0, 160),
    primary_object: 'SESSION',
    hierarchy: Object.freeze(['OBJECTIVE', 'WORKSPACE', 'SESSION', 'TASK', 'SURFACE', 'ARTIFACT']),
    objectives: Object.freeze([]),
    workspaces: Object.freeze([]),
    sessions: Object.freeze([]),
    surfaces: Object.freeze([]),
    artifacts: Object.freeze([]),
    attention: Object.freeze([]),
    bounded: true,
    browser_is_shell: false,
    browser_is_surface: true,
    projection_is_authority: false,
    scheduler_authority: false,
    execution_authority: false,
    command_leasing: false,
    automatic_effect_retry_allowed: false,
    page_model_authority: false,
    authority_effect: false,
  });
}

function unavailableDevOSShellViewModel(reason = 'NOT_EXPOSED') {
  return Object.freeze({
    schema: 'metaengine.devos.shell-view-model.v1',
    valid: false,
    reason: String(reason || 'NOT_EXPOSED').slice(0, 160),
    primary_object: 'SESSION',
    roots: Object.freeze([]),
    session_groups: Object.freeze([]),
    now: Object.freeze([]),
    selected_session: null,
    selected_surface: null,
    presentation_focus: null,
    layout_preferences: null,
    counts: Object.freeze({ sessions: 0, surfaces: 0, attention: 0, visible_groups: 0 }),
    browser_is_shell: false,
    browser_is_surface: true,
    renderer_selection_authority: false,
    renderer_routing_authority: false,
    projection_is_authority: false,
    scheduler_authority: false,
    execution_authority: false,
    command_leasing: false,
    automatic_effect_retry_allowed: false,
    page_model_authority: false,
    authority_effect: false,
  });
}

function decorateSnapshot(value) {
  if (!value || typeof value !== 'object') return value;
  const candidate = value?.workspaces?.devos;
  const devos = candidate?.schema === 'metaengine.devos.projection.v1'
    && candidate?.projection_is_authority === false
    && candidate?.scheduler_authority === false
    && candidate?.execution_authority === false
    && candidate?.command_leasing === false
    && candidate?.authority_effect === false
    ? candidate
    : unavailableDevOSProjection(candidate ? 'INVALID_PROJECTION' : 'NOT_EXPOSED');
  const shellCandidate = value?.workspaces?.devos_shell;
  const devos_shell = shellCandidate?.schema === 'metaengine.devos.shell-view-model.v1'
    && (shellCandidate?.valid === true || shellCandidate?.valid === false)
    && shellCandidate?.primary_object === 'SESSION'
    && Array.isArray(shellCandidate?.roots)
    && Array.isArray(shellCandidate?.session_groups)
    && Array.isArray(shellCandidate?.now)
    && shellCandidate?.browser_is_shell === false
    && shellCandidate?.browser_is_surface === true
    && shellCandidate?.renderer_selection_authority === false
    && shellCandidate?.renderer_routing_authority === false
    && shellCandidate?.projection_is_authority === false
    && shellCandidate?.scheduler_authority === false
    && shellCandidate?.execution_authority === false
    && shellCandidate?.command_leasing === false
    && shellCandidate?.automatic_effect_retry_allowed === false
    && shellCandidate?.page_model_authority === false
    && shellCandidate?.authority_effect === false
    ? shellCandidate
    : unavailableDevOSShellViewModel(shellCandidate ? 'INVALID_VIEW_MODEL' : 'NOT_EXPOSED');
  return Object.freeze({ ...value, devos, devos_shell });
}

function emitSnapshot(value) {
  const decorated = decorateSnapshot(value);
  for (const listener of snapshotListeners) {
    try { listener(decorated); } catch {}
  }
}

function emitBrainDelta(value) {
  for (const listener of brainDeltaListeners) {
    try { listener(value); } catch {}
  }
}

async function refreshBrainBaseline() {
  if (brainBaselinePromise) return brainBaselinePromise;
  brainBaselinePromise = ipcRenderer.invoke('metaengine:shell:snapshot')
    .then((value) => {
      const decorated = decorateSnapshot(value);
      emitSnapshot(decorated);
      return decorated;
    })
    .finally(() => { brainBaselinePromise = null; });
  return brainBaselinePromise;
}

// R84/R75 installed UI contract readback. This is observation-only and remains
// inside the trusted preload; the renderer receives no new ipcRenderer/send
// capability. Next/React may hydrate after DOMContentLoaded, so a one-shot
// microtask is insufficient. Observe DOM mutations and emit CONFIRMED as soon as
// the exact R75 composition exists; emit incomplete only after one bounded
// hydration deadline. No interval/polling loop and no renderer authority.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
  const required = ['me2-shell', 'topbar', 'page-command', 'agent-sidebar', 'pagebar', 'statusbar'];
  let settled = false;
  let observer = null;
  let deadline = null;

  const snapshot = () => {
    const present = Object.fromEntries(required.map((id) => [id, Boolean(document.querySelector(`[data-testid="${id}"]`))]));
    return { present, complete: required.every((id) => present[id] === true) };
  };

  const emit = ({ present, complete }) => {
    ipcRenderer.send('metaengine:shell:ui-contract-readback', {
      schema: 'metaengine.browser.me2-ui-contract-readback.v1',
      location_class: location.origin.startsWith('http://127.0.0.1:') ? 'PACKAGED_ME2_LOOPBACK' : 'OTHER',
      hash: String(location.hash || ''),
      required,
      present,
      complete,
      scheduler_authority: false,
      browser_command_authority: false,
      update_authority: false,
      release_authority: false,
      authority_effect: false,
    });
  };

  const finish = (state) => {
    if (settled) return;
    settled = true;
    try { observer?.disconnect(); } catch {}
    if (deadline != null) clearTimeout(deadline);
    emit(state);
  };

  const inspect = () => {
    if (settled) return;
    try {
      const state = snapshot();
      if (state.complete) finish(state);
    } catch {}
  };

  const Observer = window.MutationObserver || globalThis.MutationObserver;
  if (typeof Observer === 'function') {
    observer = new Observer(inspect);
    try { observer.observe(document.documentElement, { childList: true, subtree: true }); } catch {}
  }
  window.addEventListener('load', inspect, { once: true });
  inspect();
  deadline = setTimeout(() => {
    if (settled) return;
    try { finish(snapshot()); } catch {}
  }, 8000);
  }, { once: true });
}

ipcRenderer.on('metaengine:shell:snapshot', (_event, value) => emitSnapshot(value));
ipcRenderer.on('metaengine:brain:port', (event, transfer = {}) => {
  if (
    transfer?.schema !== 'metaengine.browser.cognitive-port-transfer.v1'
    || transfer?.control_authority !== false
    || transfer?.command_leasing !== false
    || transfer?.authority_effect !== false
  ) return;
  const port = event?.ports?.[0];
  if (!port || typeof port.postMessage !== 'function') return;
  try { brainPort?.close?.(); } catch {}
  brainPort = port;
  brainStreamId = null;
  brainSequence = 0;
  port.onmessage = (messageEvent) => {
    const message = messageEvent?.data;
    if (!message || typeof message !== 'object' || message.authority_effect !== false) return;
    if (message.schema === 'metaengine.browser.cognitive-port-hello.v1') {
      const streamId = String(message.stream_id || '');
      const latest = Number(message.latest_sequence);
      if (!streamId || !Number.isSafeInteger(latest) || latest < 0 || message.baseline_required !== true) return;
      brainStreamId = streamId;
      brainSequence = latest;
      void refreshBrainBaseline().then(() => {
        if (brainPort !== port || brainStreamId !== streamId) return;
        port.postMessage({
          schema: 'metaengine.browser.cognitive-port-ready.v1',
          stream_id: streamId,
          through_sequence: latest,
          baseline_confirmed: true,
          control_authority: false,
          command_leasing: false,
          authority_effect: false,
        });
      }).catch(() => {});
      return;
    }
    if (message.schema === 'metaengine.browser.cognitive-port-resync.v1') {
      const streamId = String(message.stream_id || '');
      const latest = Number(message.latest_sequence);
      if (!streamId || !Number.isSafeInteger(latest) || latest < 0 || message.full_snapshot_required !== true) return;
      void refreshBrainBaseline().then(() => {
        if (brainPort !== port) return;
        brainStreamId = streamId;
        brainSequence = latest;
        port.postMessage({
          schema: 'metaengine.browser.cognitive-port-resync-ack.v1',
          stream_id: streamId,
          through_sequence: latest,
          baseline_confirmed: true,
          control_authority: false,
          command_leasing: false,
          authority_effect: false,
        });
      }).catch(() => {});
      return;
    }
    if (message.schema !== 'metaengine.browser.cognitive-port-batch.v1') return;
    const through = Number(message.through_sequence);
    const events = Array.isArray(message.events) ? message.events : [];
    if (
      String(message.stream_id || '') !== brainStreamId
      || !Number.isSafeInteger(through)
      || through <= brainSequence
      || Number(message.after_sequence) !== brainSequence
      || Number(message.event_count) !== events.length
      || message.raw_payload_exposed !== false
      || message.page_text_exposed !== false
      || message.input_values_exposed !== false
      || message.delta_is_execution_authority !== false
      || message.control_authority !== false
      || message.command_leasing !== false
    ) return;
    emitBrainDelta(Object.freeze({ ...message, events: events.map((row) => Object.freeze({ ...row })) }));
    brainSequence = through;
    port.postMessage({
      schema: 'metaengine.browser.cognitive-port-ack.v1',
      stream_id: brainStreamId,
      through_sequence: through,
      control_authority: false,
      command_leasing: false,
      authority_effect: false,
    });
  };
  port.onclose = () => {
    if (brainPort !== port) return;
    brainPort = null;
    brainStreamId = null;
    brainSequence = 0;
  };
  port.start();
});

contextBridge.exposeInMainWorld('metaengineShell', Object.freeze({
  snapshot: () => ipcRenderer.invoke('metaengine:shell:snapshot').then(decorateSnapshot),
  command: (command, payload) => ipcRenderer.invoke('metaengine:shell:command', { command, payload }),
  // R84 primary ME2 shell presentation hint. This controls only which native
  // Browser WebContentsView is composed into the ME2 page; it grants no task,
  // scheduler, browser-command, update, or release authority.
  setPrimaryPage: (page) => ipcRenderer.invoke('metaengine:shell:primary-page', String(page ?? '')),
  presentationFocus: Object.freeze({
    snapshot: () => ipcRenderer.invoke('metaengine:shell:presentation-focus:snapshot'),
    selectSession: (sessionId) => ipcRenderer.invoke('metaengine:shell:presentation-focus:select-session', String(sessionId ?? '')),
    selectSurface: (sessionId, surfaceId) => ipcRenderer.invoke('metaengine:shell:presentation-focus:select-surface', String(sessionId ?? ''), String(surfaceId ?? '')),
    setLayout: (sessionId, layoutMode) => ipcRenderer.invoke('metaengine:shell:presentation-layout:set', String(sessionId ?? ''), String(layoutMode ?? '')),
    clear: () => ipcRenderer.invoke('metaengine:shell:presentation-focus:clear'),
  }),
  onSnapshot: (listener) => {
    if (typeof listener !== 'function') return () => {};
    snapshotListeners.add(listener);
    return () => snapshotListeners.delete(listener);
  },
  onBrainDelta: (listener) => {
    if (typeof listener !== 'function') return () => {};
    brainDeltaListeners.add(listener);
    return () => brainDeltaListeners.delete(listener);
  },
  brainStreamStatus: () => Object.freeze({
    connected: brainPort != null,
    stream_id: brainStreamId,
    acknowledged_through_sequence: brainSequence,
    long_lived_message_port: true,
    full_snapshot_per_delta: false,
    control_authority: false,
    command_leasing: false,
    authority_effect: false,
  }),
}));
