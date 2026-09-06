import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildNativeEffectBinding,
  NATIVE_EFFECT_BINDING_SCHEMA,
  NATIVE_EFFECT_BINDING_SCHEMA_V2,
} from '../src/native-effect-binding.mjs';
import { captureSemanticFrame, executeSemanticCommand } from '../src/native-browser-control.mjs';
import { releasePersistentBrowserDebugger } from '../src/browser-persistent-cdp-session.mjs';
import { clearNativeEffectRuntimeObservationsForTest } from '../src/native-effect-runtime-observation.mjs';

const TAB = 'tab_00000000-0000-4000-8000-0000000000bb';
const CLIENT = '00000000-0000-4000-8000-0000000000cc';
const COMMAND_ID = '00000000-0000-4000-8000-0000000000dd';

function fakeWebContents() {
  const listeners = new Map();
  let attached = false;
  let url = 'https://chatgpt.com/';
  const commands = [];
  const dbg = {
    isAttached: () => attached,
    attach: () => { attached = true; },
    detach: () => { attached = false; },
    on(name, fn) {
      const set = listeners.get(name) || new Set();
      set.add(fn);
      listeners.set(name, set);
    },
    off(name, fn) { listeners.get(name)?.delete(fn); },
    async sendCommand(method, params = {}) {
      commands.push({ method, params });
      if (method === 'Accessibility.getFullAXTree') return { nodes: [] };
      if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 1200, clientHeight: 800 } };
      if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
      return {};
    },
    emitMessage(method, params = {}) {
      for (const fn of listeners.get('message') || []) fn({}, method, params, null);
    },
    emitDetach(reason = 'target_closed') {
      attached = false;
      for (const fn of listeners.get('detach') || []) fn({}, reason);
    },
  };
  const wcListeners = new Map();
  const webContents = {
    id: 77,
    debugger: dbg,
    isDestroyed: () => false,
    getOSProcessId: () => 9001,
    getOrCreateDevToolsTargetId: () => 'target-77',
    getURL: () => url,
    getTitle: () => 'ChatGPT',
    once(name, fn) {
      const set = wcListeners.get(name) || new Set();
      set.add(fn);
      wcListeners.set(name, set);
    },
    off(name, fn) { wcListeners.get(name)?.delete(fn); },
  };
  return { webContents, dbg, commands, setUrl: (value) => { url = value; } };
}

function leasedCommand() {
  return {
    command_id: COMMAND_ID,
    idempotency_key: 'idem-1234567890123456',
    action: 'SCROLL',
    platform: 'CHATGPT',
    expires_at: new Date(Date.now() + 300000).toISOString(),
    payload: { tab_id: TAB, delta_y: 180 },
  };
}

function bindingFromFrame(command, frame, options = {}) {
  return buildNativeEffectBinding({
    command,
    clientId: CLIENT,
    processIncarnationId: frame.process_incarnation_id,
    tabId: TAB,
    targetId: frame.target_id,
    observedAt: frame.captured_at,
    runtimeObservationId: frame.runtime_observation_id,
    ...options,
  });
}

test('v2 effect binding seals one exact hot CDP observation and executes while unchanged', async () => {
  clearNativeEffectRuntimeObservationsForTest();
  const { webContents, commands } = fakeWebContents();
  try {
    const frame = await captureSemanticFrame(webContents);
    assert.equal(frame.runtime_binding_observed, true);
    assert.match(frame.runtime_observation_id, /^obs_[a-f0-9]{32}$/);
    const command = leasedCommand();
    const binding = bindingFromFrame(command, frame);
    assert.equal(binding.schema, NATIVE_EFFECT_BINDING_SCHEMA_V2);
    assert.equal(binding.runtime_observation_id, frame.runtime_observation_id);
    assert.equal(binding.web_contents_id, 77);
    assert.equal(binding.renderer_pid, 9001);
    assert.equal(binding.runtime_target_id, 'target-77');
    assert.ok(binding.binding_generation >= 1);
    assert.ok(binding.document_generation >= 1);

    const result = await executeSemanticCommand(webContents, { ...command, effect_binding: binding });
    assert.equal(result.action, 'SCROLL');
    assert.equal(result.authority_effect, true);
    assert.equal(commands.filter((row) => row.method === 'Input.dispatchMouseEvent' && row.params.type === 'mouseWheel').length, 1);
  } finally {
    releasePersistentBrowserDebugger(webContents);
    clearNativeEffectRuntimeObservationsForTest();
  }
});

test('missing explicit observation id preserves v1 compatibility instead of guessing a runtime sample', async () => {
  clearNativeEffectRuntimeObservationsForTest();
  const { webContents } = fakeWebContents();
  try {
    const frame = await captureSemanticFrame(webContents);
    const command = leasedCommand();
    const binding = buildNativeEffectBinding({
      command,
      clientId: CLIENT,
      processIncarnationId: frame.process_incarnation_id,
      tabId: TAB,
      targetId: frame.target_id,
      observedAt: frame.captured_at,
    });
    assert.equal(binding.schema, NATIVE_EFFECT_BINDING_SCHEMA);
    assert.equal('runtime_observation_id' in binding, false);
    assert.equal('binding_generation' in binding, false);
  } finally {
    releasePersistentBrowserDebugger(webContents);
    clearNativeEffectRuntimeObservationsForTest();
  }
});

test('document generation change after seal rejects the mutation before input dispatch', async () => {
  clearNativeEffectRuntimeObservationsForTest();
  const { webContents, dbg, commands } = fakeWebContents();
  try {
    const frame = await captureSemanticFrame(webContents);
    const command = leasedCommand();
    const binding = bindingFromFrame(command, frame);
    dbg.emitMessage('DOM.documentUpdated', {});

    await assert.rejects(
      executeSemanticCommand(webContents, { ...command, effect_binding: binding }),
      /native_effect_runtime_(document_generation|binding_generation)_mismatch/,
    );
    assert.equal(commands.filter((row) => row.method === 'Input.dispatchMouseEvent' && row.params.type === 'mouseWheel').length, 0);
  } finally {
    releasePersistentBrowserDebugger(webContents);
    clearNativeEffectRuntimeObservationsForTest();
  }
});

test('debugger detach and reattach after seal rejects the mutation before input dispatch', async () => {
  clearNativeEffectRuntimeObservationsForTest();
  const { webContents, dbg, commands } = fakeWebContents();
  try {
    const frame = await captureSemanticFrame(webContents);
    const command = leasedCommand();
    const binding = bindingFromFrame(command, frame);
    dbg.emitDetach('replaced_with_devtools');

    await assert.rejects(
      executeSemanticCommand(webContents, { ...command, effect_binding: binding }),
      /native_effect_runtime_(attachment_generation|binding_generation)_mismatch/,
    );
    assert.equal(commands.filter((row) => row.method === 'Input.dispatchMouseEvent' && row.params.type === 'mouseWheel').length, 0);
  } finally {
    releasePersistentBrowserDebugger(webContents);
    clearNativeEffectRuntimeObservationsForTest();
  }
});

test('URL change after seal rejects the mutation even when the CDP generation has not advanced yet', async () => {
  clearNativeEffectRuntimeObservationsForTest();
  const { webContents, commands, setUrl } = fakeWebContents();
  try {
    const frame = await captureSemanticFrame(webContents);
    const command = leasedCommand();
    const binding = bindingFromFrame(command, frame);
    setUrl('https://chatgpt.com/c/new-document');

    await assert.rejects(
      executeSemanticCommand(webContents, { ...command, effect_binding: binding }),
      /native_effect_runtime_document_url_mismatch/,
    );
    assert.equal(commands.filter((row) => row.method === 'Input.dispatchMouseEvent' && row.params.type === 'mouseWheel').length, 0);
  } finally {
    releasePersistentBrowserDebugger(webContents);
    clearNativeEffectRuntimeObservationsForTest();
  }
});
