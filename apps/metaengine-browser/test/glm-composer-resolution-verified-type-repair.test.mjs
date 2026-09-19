import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentSessionMonitor } from '../src/agent-session-monitor.mjs';
import { SupervisorLifecycleRuntime } from '../src/supervisor-lifecycle-runtime.mjs';
import { resolveAgentPlatformComposer } from '../src/browser-agent-platform.mjs';
import { captureSemanticFrame, executeSemanticCommand } from '../src/native-browser-control.mjs';

const CONVERSATION = 'https://chat.z.ai/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const sha256 = (value) => crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');

// ---------------------------------------------------------------------------
// D-K1: composer resolution on multi-textbox surfaces
// ---------------------------------------------------------------------------

function target({ name = null, ref = null, value = null, backendNodeId }) {
  const row = {
    role: 'textbox',
    name,
    semantic_ref: ref,
    backend_node_id: backendNodeId,
  };
  if (value != null) {
    row.value_length = value.length;
    row.value_sha256 = value ? sha256(value) : null;
  }
  return row;
}

const REF_A = { schema: 'metaengine.native-browser.semantic-ref.v1', semantic_ref_id: 'semref_' + 'a'.repeat(64) };
const REF_B = { schema: 'metaengine.native-browser.semantic-ref.v1', semantic_ref_id: 'semref_' + 'b'.repeat(64) };

test('D-K1: single unnamed textbox with a semantic_ref still resolves (back-compat)', () => {
  const resolved = resolveAgentPlatformComposer({
    semantic_targets: [target({ ref: REF_A, backendNodeId: 3 })],
  });
  assert.ok(resolved);
  assert.equal(resolved.accessible_name, null);
  assert.equal(resolved.semantic_ref, REF_A);
  assert.equal(resolved.backend_node_id, 3);
  assert.equal(resolved.selector_mode, 'BACKEND_NODE_ID_REQUIRED');
});

test('D-K1: single named textbox resolves and carries value evidence', () => {
  const resolved = resolveAgentPlatformComposer({
    semantic_targets: [target({ name: 'Send a Message', ref: REF_A, value: 'draft', backendNodeId: 1770 })],
  });
  assert.ok(resolved);
  assert.equal(resolved.accessible_name, 'Send a Message');
  assert.equal(resolved.selector_mode, 'ROLE_NAME_OR_BACKEND_NODE_ID');
  assert.equal(resolved.value_length, 5);
  assert.equal(resolved.value_sha256, sha256('draft'));
});

test('D-K1: live conversation shape — named composer + unnamed auxiliary — resolves the named composer', () => {
  // Exact live capture shape (2026-09-19): composer "Send a Message" backend
  // node 1770 + unnamed auxiliary backend node 1864.
  const resolved = resolveAgentPlatformComposer({
    semantic_targets: [
      target({ name: 'Send a Message', ref: REF_A, value: 'x'.repeat(2738), backendNodeId: 1770 }),
      target({ ref: REF_B, value: 'y'.repeat(436), backendNodeId: 1864 }),
    ],
  });
  assert.ok(resolved, 'the uniquely named textbox must win the composer role');
  assert.equal(resolved.accessible_name, 'Send a Message');
  assert.equal(resolved.backend_node_id, 1770);
  assert.equal(resolved.semantic_ref, REF_A);
});

test('D-K1: multiple unnamed textboxes fail closed', () => {
  const resolved = resolveAgentPlatformComposer({
    semantic_targets: [
      target({ ref: REF_A, backendNodeId: 1 }),
      target({ ref: REF_B, backendNodeId: 2 }),
    ],
  });
  assert.equal(resolved, null);
});

test('D-K1: two named textboxes fail closed', () => {
  const resolved = resolveAgentPlatformComposer({
    semantic_targets: [
      target({ name: 'Search', ref: REF_A, backendNodeId: 1 }),
      target({ name: 'Send a Message', ref: REF_B, backendNodeId: 2 }),
    ],
  });
  assert.equal(resolved, null);
});

test('D-K1: zero textboxes and ref-less rows fail closed', () => {
  assert.equal(resolveAgentPlatformComposer({ semantic_targets: [] }), null);
  assert.equal(resolveAgentPlatformComposer({ semantic_targets: [target({ name: 'Send a Message', backendNodeId: 1 })] }), null);
  // multi: the only named row has no ref — nothing usable
  assert.equal(resolveAgentPlatformComposer({
    semantic_targets: [
      target({ name: 'Send a Message', backendNodeId: 1 }),
      target({ ref: REF_B, backendNodeId: 2 }),
    ],
  }), null);
});

// ---------------------------------------------------------------------------
// D-K1 + D-K3 end-to-end: the supervisor lifecycle runtime on a live-shaped
// two-textbox conversation surface
// ---------------------------------------------------------------------------

const COMPOSER_REF = { schema: 'metaengine.native-browser.semantic-ref.v1', semantic_ref_id: 'semref_' + 'c'.repeat(64) };
const AUX_REF = { schema: 'metaengine.native-browser.semantic-ref.v1', semantic_ref_id: 'semref_' + 'd'.repeat(64) };

function liveConversationFrame(text = '') {
  return {
    url: CONVERSATION,
    title: 'Z.ai',
    text_excerpt: text,
    semantic_targets: [
      { role: 'textbox', name: 'Send a Message', semantic_ref: COMPOSER_REF, backend_node_id: 1770, value_length: text.length, value_sha256: text ? sha256(text) : null },
      { role: 'textbox', name: null, semantic_ref: AUX_REF, backend_node_id: 1864, value_length: 436, value_sha256: sha256('aux') },
    ],
  };
}

test('D-K1 e2e: supervisor wake send resolves the named composer on the two-textbox surface', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-dk1-'));
  const statePath = path.join(dir, 'keepalive.json');
  let typed = '';
  const typedRefs = [];
  const getState = async () => ({
    tabs: [{ tab_id: 'tab1', url: CONVERSATION, selected: true }],
    fleet: { agents: [] },
  });
  const executeCommand = async (command) => {
    if (command.action === 'CAPTURE') return liveConversationFrame('');
    if (command.action === 'SEMANTIC_TYPE') {
      assert.equal(command.platform, 'GLM_ZAI');
      typedRefs.push(command.payload.semantic_ref);
      typed = String(command.payload?.text || '');
      assert.equal(command.payload.accessible_name, 'Send a Message', 'the composer, not the unnamed auxiliary, must be addressed');
      return { effect_state: 'PROVEN_COMPOSER_CLEARED', composer_cleared: true, new_conversation_observed: false, stop_observed: false, automatic_retry_allowed: false, authority_effect: true, replace_verified: true };
    }
    throw new Error(`unexpected_action:${command.action}`);
  };
  const runtime = new SupervisorLifecycleRuntime({
    getState,
    executeCommand,
    canActuate: () => true,
    statePath,
    monitorMs: 5000,
    researchMs: 5 * 60 * 1000,
    sessionMonitor: new AgentSessionMonitor({ clock: () => Date.parse('2026-09-19T15:00:00Z'), settleMs: 1500 }),
  });
  await runtime.start();
  assert.match(typed, /METAENGINE_SUPERVISOR_WAKE_V1/);
  assert.ok(typedRefs.every((ref) => ref === COMPOSER_REF), 'every typed command must target the composer ref');
  await fs.rm(dir, { recursive: true, force: true });
});

test('D-K3: a pre-effect send failure is durably visible instead of presenting as idle WAITING', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-dk3-'));
  const statePath = path.join(dir, 'keepalive.json');
  let failures = 0;
  const getState = async () => ({
    tabs: [{ tab_id: 'tab1', url: CONVERSATION, selected: true }],
    fleet: { agents: [] },
  });
  const executeCommand = async (command) => {
    if (command.action === 'CAPTURE') {
      // A surface where the composer cannot be resolved at all — the historical
      // shape of the D-K1 live livelock (two unnamed textboxes).
      return {
        url: CONVERSATION,
        title: 'Z.ai',
        text_excerpt: '',
        semantic_targets: [
          { role: 'textbox', name: null, semantic_ref: COMPOSER_REF, backend_node_id: 1770, value_length: 0, value_sha256: null },
          { role: 'textbox', name: null, semantic_ref: AUX_REF, backend_node_id: 1864, value_length: 436, value_sha256: sha256('aux') },
        ],
      };
    }
    if (command.action === 'SEMANTIC_TYPE') {
      failures += 1;
      throw new Error('supervisor_composer_not_unique');
    }
    throw new Error(`unexpected_action:${command.action}`);
  };
  const runtime = new SupervisorLifecycleRuntime({
    getState,
    executeCommand,
    canActuate: () => true,
    statePath,
    monitorMs: 1,
    researchMs: 5 * 60 * 1000,
    sessionMonitor: new AgentSessionMonitor({ clock: () => Date.now(), settleMs: 1500 }),
  });
  await runtime.start();
  await runtime.cycle({ force: true });
  await runtime.cycle({ force: true });
  const snap = runtime.snapshot();
  // #typeAndSend throws BEFORE dispatching SEMANTIC_TYPE (the composer is
  // unresolvable) — the durable record, not a command counter, is the proof
  // the wake send was attempted and failed.
  assert.ok(snap.last_send_error, 'last send error is durable');
  assert.equal(snap.last_send_error.reason, 'supervisor_composer_not_unique');
  assert.ok(snap.wake_send_failure_count >= 1, 'failure count is durable');
  assert.equal(snap.last_send_error.clicked, false);
  assert.equal(snap.last_send_error.failure_count, snap.wake_send_failure_count);
  assert.equal(typeof snap.last_send_error.at, 'string');
  // The queued wake is NOT consumed by the silent retry loop (raw keepalive
  // snapshot exposes the array; queued_wake_count is a state-row projection).
  assert.ok((snap.keepalive.queued_wakes || []).length >= 1, `queued wakes must survive the failed sends (got ${(snap.keepalive.queued_wakes || []).length})`);
  await fs.rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// D-K2: readback-verified replace on the GLM lane
// ---------------------------------------------------------------------------

function ax(role, name, id, value = null) {
  const node = {
    nodeId: `ax-${id}`,
    ignored: false,
    role: { value: role },
    backendDOMNodeId: id,
    frameId: 'frame-root',
  };
  if (name != null) node.name = { value: name };
  if (value != null) node.value = { value };
  return node;
}

let nextWebContentsId = 7300;
// appendMode models the live selection-drop defect: insertText APPENDS to the
// composer instead of replacing the Ctrl+A selection. deleteClears models
// whether the Delete-key escalation empties the field.
function fakeZaiTyped({ appendMode = false, deleteClears = true, submitWorks = true } = {}) {
  let attached = false;
  let url = 'https://chat.z.ai/';
  let composerValue = 'STALE DRAFT: previous unsent task prompt';
  const calls = [];
  const listeners = new Map();
  const webContentsId = nextWebContentsId++;
  const debuggerApi = {
    isAttached: () => attached,
    attach: () => { attached = true; },
    detach: () => { attached = false; },
    on(name, fn) { const rows = listeners.get(name) || new Set(); rows.add(fn); listeners.set(name, rows); },
    off(name, fn) { listeners.get(name)?.delete(fn); },
    emitMessage(method, params = {}) { for (const fn of listeners.get('message') || []) fn({}, method, params, null); },
    async sendCommand(method, params = {}) {
      calls.push([method, structuredClone(params)]);
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'frame-root', url } } };
      if (method === 'Runtime.enable') {
        this.emitMessage('Runtime.executionContextCreated', { context: { id: 1, uniqueId: `context-${webContentsId}`, auxData: { frameId: 'frame-root', isDefault: true } } });
        return {};
      }
      if (['Page.enable','DOM.enable','Accessibility.enable','Page.setLifecycleEventsEnabled','Network.enable','Target.setAutoAttach','DOM.getDocument'].includes(method)) return {};
      if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 1200, clientHeight: 800 } };
      if (method === 'Accessibility.getFullAXTree') {
        return { nodes: [
          ax('textbox', 'Send a Message', 3, composerValue),
          ax('textbox', '', 9, 'auxiliary unnamed surface value'),
        ] };
      }
      if (method === 'DOM.focus') return {};
      if (method === 'Input.insertText') {
        composerValue = appendMode ? composerValue + String(params.text || '') : String(params.text || '');
        return {};
      }
      if (method === 'Input.dispatchKeyEvent') {
        if (params.key === 'Delete' && params.type === 'rawKeyDown' && deleteClears) composerValue = '';
        if (params.key === 'Enter' && params.type === 'rawKeyDown' && submitWorks) composerValue = '';
        return {};
      }
      if (method === 'DOM.getBoxModel') return { model: { content: [10, 10, 110, 10, 110, 60, 10, 60] } };
      if (method === 'Input.dispatchMouseEvent') return {};
      throw new Error(`unexpected_debugger_command:${method}`);
    },
  };
  return {
    calls,
    composerValue: () => composerValue,
    webContents: {
      id: webContentsId,
      debugger: debuggerApi,
      isDestroyed: () => false,
      getURL: () => url,
      getTitle: () => 'Z.ai',
      getOSProcessId: () => 19000 + webContentsId,
      getOrCreateDevToolsTargetId: () => `target-${webContentsId}`,
    },
  };
}

async function composerRefOf(h) {
  const frame = await captureSemanticFrame(h.webContents);
  const resolved = resolveAgentPlatformComposer(frame);
  assert.ok(resolved, 'fake surface must resolve a composer');
  return resolved;
}

test('D-K2: healthy replace verifies on the first attempt and submits', async () => {
  const h = fakeZaiTyped();
  const composer = await composerRefOf(h);
  const result = await executeSemanticCommand(h.webContents, {
    action: 'SEMANTIC_TYPE',
    platform: 'GLM_ZAI',
    payload: {
      role: 'textbox',
      accessible_name: composer.accessible_name,
      semantic_ref: composer.semantic_ref,
      text: 'fresh wake message',
      replace_existing: true,
      submit_after_type: true,
    },
  });
  assert.equal(result.replace_verified, true);
  assert.equal(result.value_length_before, 'STALE DRAFT: previous unsent task prompt'.length);
  assert.equal(result.effect_state, 'PROVEN_COMPOSER_CLEARED');
  assert.ok(h.calls.some(([m, p]) => m === 'Input.dispatchKeyEvent' && p.key === 'Enter' && p.type === 'rawKeyDown'));
  assert.ok(!h.calls.some(([m, p]) => m === 'Input.dispatchKeyEvent' && p.key === 'Delete'), 'no escalation needed on a healthy surface');
});

test('D-K2: selection-drop append is repaired by the Delete escalation and then submits', async () => {
  const h = fakeZaiTyped({ appendMode: true, deleteClears: true });
  const composer = await composerRefOf(h);
  const result = await executeSemanticCommand(h.webContents, {
    action: 'SEMANTIC_TYPE',
    platform: 'GLM_ZAI',
    payload: {
      role: 'textbox',
      accessible_name: composer.accessible_name,
      semantic_ref: composer.semantic_ref,
      text: 'fresh wake message',
      replace_existing: true,
      submit_after_type: true,
    },
  });
  assert.equal(result.replace_verified, true, 'attempt 2 (Ctrl+A + Delete + insert) must verify');
  assert.ok(h.calls.some(([m, p]) => m === 'Input.dispatchKeyEvent' && p.key === 'Delete' && p.type === 'rawKeyDown'));
  assert.equal(result.effect_state, 'PROVEN_COMPOSER_CLEARED');
  assert.ok(h.calls.some(([m, p]) => m === 'Input.dispatchKeyEvent' && p.key === 'Enter' && p.type === 'rawKeyDown'));
});

test('D-K2: an unprovable replace fails closed BEFORE Enter — no corrupted submit is possible', async () => {
  const h = fakeZaiTyped({ appendMode: true, deleteClears: false });
  const composer = await composerRefOf(h);
  await assert.rejects(() => executeSemanticCommand(h.webContents, {
    action: 'SEMANTIC_TYPE',
    platform: 'GLM_ZAI',
    payload: {
      role: 'textbox',
      accessible_name: composer.accessible_name,
      semantic_ref: composer.semantic_ref,
      text: 'fresh wake message',
      replace_existing: true,
      submit_after_type: true,
    },
  }), /native_semantic_type_replace_unverified/);
  assert.ok(!h.calls.some(([m, p]) => m === 'Input.dispatchKeyEvent' && p.key === 'Enter'), 'Enter must never dispatch when the replace is unproven');
  assert.ok(h.calls.some(([m, p]) => m === 'Input.dispatchKeyEvent' && p.key === 'Delete'), 'the escalation retry must have run');
});

test('D-K2: non-submit type reports replace_verified instead of failing', async () => {
  const h = fakeZaiTyped({ appendMode: true, deleteClears: false });
  const composer = await composerRefOf(h);
  const result = await executeSemanticCommand(h.webContents, {
    action: 'SEMANTIC_TYPE',
    platform: 'GLM_ZAI',
    payload: {
      role: 'textbox',
      accessible_name: composer.accessible_name,
      semantic_ref: composer.semantic_ref,
      text: 'probe',
      replace_existing: true,
      submit_after_type: false,
    },
  });
  assert.equal(result.replace_verified, false);
  // Both attempts appended (deleteClears: false): base + probe + probe.
  const expectedValue = 'STALE DRAFT: previous unsent task prompt' + 'probe' + 'probe';
  assert.equal(result.value_length_after, expectedValue.length);
  assert.equal(result.value_sha256_after, sha256(expectedValue));
});

test('D-K2: replace_existing=false keeps append semantics with replace_verified null', async () => {
  const h = fakeZaiTyped();
  const composer = await composerRefOf(h);
  const result = await executeSemanticCommand(h.webContents, {
    action: 'SEMANTIC_TYPE',
    platform: 'GLM_ZAI',
    payload: {
      role: 'textbox',
      accessible_name: composer.accessible_name,
      semantic_ref: composer.semantic_ref,
      text: 'appended',
      replace_existing: false,
      submit_after_type: false,
    },
  });
  assert.equal(result.replace_verified, null);
  assert.equal(result.replace_existing, false);
  assert.ok(!('value_length_after' in result), 'no verification readback runs for append-mode types');
});

test('D-K2: legacy ChatGPT submit lane keeps its historical unverified replace contract', async () => {
  // Reuse the ChatGPT-shaped fake: no composer value tracking at all. The
  // legacy lane must not require readback verification.
  let attached = false;
  let url = 'https://chatgpt.com/';
  const calls = [];
  const listeners = new Map();
  const webContentsId = nextWebContentsId++;
  let axReads = 0;
  const debuggerApi = {
    isAttached: () => attached,
    attach: () => { attached = true; },
    detach: () => { attached = false; },
    on(name, fn) { const rows = listeners.get(name) || new Set(); rows.add(fn); listeners.set(name, rows); },
    off(name, fn) { listeners.get(name)?.delete(fn); },
    emitMessage(method, params = {}) { for (const fn of listeners.get('message') || []) fn({}, method, params, null); },
    async sendCommand(method, params = {}) {
      calls.push([method, structuredClone(params)]);
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'frame-root', url } } };
      if (method === 'Runtime.enable') {
        this.emitMessage('Runtime.executionContextCreated', { context: { id: 1, uniqueId: `context-${webContentsId}`, auxData: { frameId: 'frame-root', isDefault: true } } });
        return {};
      }
      if (['Page.enable','DOM.enable','Accessibility.enable','Page.setLifecycleEventsEnabled','Network.enable','Target.setAutoAttach','DOM.getDocument'].includes(method)) return {};
      if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 1200, clientHeight: 800 } };
      if (method === 'Accessibility.getFullAXTree') {
        axReads += 1;
        if (axReads === 1) return { nodes: [ax('textbox', 'Чат с ChatGPT', 3)] };
        if (axReads === 2) return { nodes: [ax('textbox', 'Чат с ChatGPT', 3), ax('button', 'Отправить промпт', 7)] };
        return { nodes: [ax('textbox', 'Чат с ChatGPT', 3), ax('button', 'Остановить ответ', 9)] };
      }
      if (method === 'DOM.focus' || method === 'Input.insertText') return {};
      if (method === 'Input.dispatchKeyEvent') {
        if (params.key === 'Enter' && params.type === 'rawKeyDown') url = 'https://chatgpt.com/c/11111111-2222-3333-4444-555555555555';
        return {};
      }
      throw new Error(`unexpected_debugger_command:${method}`);
    },
  };
  const webContents = {
    id: webContentsId,
    debugger: debuggerApi,
    isDestroyed: () => false,
    getURL: () => url,
    getTitle: () => 'ChatGPT',
    getOSProcessId: () => 20000 + webContentsId,
    getOrCreateDevToolsTargetId: () => `target-${webContentsId}`,
  };
  const frame = await captureSemanticFrame(webContents);
  const composer = frame.semantic_targets.find((row) => row.role === 'textbox');
  const result = await executeSemanticCommand(webContents, {
    action: 'SEMANTIC_TYPE',
    platform: 'CHATGPT',
    payload: {
      role: 'textbox',
      accessible_name: 'Чат с ChatGPT',
      semantic_ref: composer.semantic_ref,
      text: 'legacy lane prompt',
      replace_existing: true,
      submit_after_type: true,
    },
  });
  assert.equal(result.replace_verified, null, 'legacy lane is not readback-verified');
  assert.equal(result.effect_state, 'PROVEN_GENERATING');
  assert.ok(!('value_length_after' in result));
});
