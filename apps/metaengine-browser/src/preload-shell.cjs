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

function isPrimaryMe2PresentationDocument(locationLike = globalThis.location) {
  try {
    if (!locationLike || locationLike.protocol !== 'http:' || locationLike.hostname !== '127.0.0.1') return false;
    const configuredPort = typeof process === 'object' && process?.env?.ME2_UI_GATEWAY_PORT
      ? String(process.env.ME2_UI_GATEWAY_PORT)
      : '8137';
    return String(locationLike.port || '80') === configuredPort;
  } catch {
    return false;
  }
}

const setPrimaryPage = (page) => ipcRenderer.invoke('metaengine:shell:primary-page', String(page ?? ''));
const setPrimaryOverlay = (active) => ipcRenderer.invoke('metaengine:shell:primary-overlay', active === true);
const setPrimaryCommandRail = (open) => ipcRenderer.invoke('metaengine:shell:primary-command-rail', open === true);
const setPrimaryContextDrawer = (open, dock, height, width) => ipcRenderer.invoke(
  'metaengine:shell:primary-context-drawer',
  open === true,
  String(dock || 'bottom'),
  Number.isFinite(Number(height)) ? Number(height) : null,
  Number.isFinite(Number(width)) ? Number(width) : null,
);
const primaryChatFleetRoster = () => ipcRenderer.invoke('metaengine:shell:primary-chat-fleet-roster');
const selectPrimaryChatActor = (actorId) => ipcRenderer.invoke(
  'metaengine:shell:primary-chat-actor-select',
  String(actorId ?? ''),
);
const submitClientGoal = (goal) => ipcRenderer.invoke(
  'metaengine:client:submit-goal',
  String(goal ?? ''),
);
const selectClientAgent = (agentId) => ipcRenderer.invoke(
  'metaengine:client:select-agent',
  String(agentId ?? ''),
);
const latestClientGoal = () => ipcRenderer.invoke('metaengine:client:latest-goal');
const clientGoalStatus = (requestId) => ipcRenderer.invoke(
  'metaengine:client:goal-status',
  String(requestId ?? ''),
);

if (isPrimaryMe2PresentationDocument()) {
  // R84 capability fence: the Browser-owned loopback ME2 renderer is not given
  // the legacy generic shell command bridge. Client V1 adds a separate narrow
  // typed product-control bridge below: user intent -> dedicated IPC -> Native
  // Supervisor -> signed Edge/DB readback. No arbitrary command name/payload is
  // accepted by that bridge.
  contextBridge.exposeInMainWorld('metaengineShell', Object.freeze({
    setPrimaryPage,
    setPrimaryOverlay,
    setPrimaryCommandRail,
    setPrimaryContextDrawer,
    primaryChatFleetRoster,
    selectPrimaryChatActor,
    presentation_only: true,
    browser_command_authority: false,
    scheduler_authority: false,
    update_authority: false,
    release_authority: false,
    authority_effect: false,
  }));
  contextBridge.exposeInMainWorld('metaengineClient', Object.freeze({
    submitGoal: submitClientGoal,
    selectAgent: selectClientAgent,
    latestGoal: latestClientGoal,
    goalStatus: clientGoalStatus,
    typed_positive_api: true,
    generic_command_exposed: false,
    scheduler_authority: false,
    browser_actuation_authority: false,
    update_authority: false,
    release_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  }));
} else {
  contextBridge.exposeInMainWorld('metaengineShell', Object.freeze({
    snapshot: () => ipcRenderer.invoke('metaengine:shell:snapshot').then(decorateSnapshot),
    command: (command, payload) => ipcRenderer.invoke('metaengine:shell:command', { command, payload }),
    setPrimaryPage,
    setPrimaryOverlay,
    setPrimaryCommandRail,
    setPrimaryContextDrawer,
    presentationFocus: Object.freeze({
      snapshot: () => ipcRenderer.invoke('metaengine:shell:presentation-focus:snapshot'),
      selectSession: (sessionId) => ipcRenderer.invoke('metaengine:shell:presentation-focus:select-session', String(sessionId ?? '')),
      selectSurface: (sessionId, surfaceId) => ipcRenderer.invoke('metaengine:shell:presentation-focus:select-surface', String(sessionId ?? ''), String(surfaceId ?? '')),
      setLayout: (sessionId, layoutMode) => ipcRenderer.invoke('metaengine:shell:presentation-layout:set', String(sessionId ?? '')),
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
}
