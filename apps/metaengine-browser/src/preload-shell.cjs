const { contextBridge, ipcRenderer } = require('electron');

const snapshotListeners = new Set();
const brainDeltaListeners = new Set();
let brainPort = null;
let brainStreamId = null;
let brainSequence = 0;
let brainBaselinePromise = null;

function emitSnapshot(value) {
  for (const listener of snapshotListeners) {
    try { listener(value); } catch {}
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
      emitSnapshot(value);
      return value;
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

contextBridge.exposeInMainWorld('metaengineShell', Object.freeze({
  snapshot: () => ipcRenderer.invoke('metaengine:shell:snapshot'),
  command: (command, payload) => ipcRenderer.invoke('metaengine:shell:command', { command, payload }),
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
