import test from 'node:test';
import assert from 'node:assert/strict';
import { captureSemanticFrame, executeSemanticCommand } from '../src/native-browser-control.mjs';

// D-M3 contract: the agent-task composer on the PRECONVERSATION_ROOT surface
// ignores synthetic key events (live-proven 2026-09-19: targeted Backspace was
// a no-op; Ctrl+A+Delete never cleared a 26.7k account-synced draft; plain
// insertText appended). The replace is therefore gesture-ordered per surface:
// CLICK_SELECT (triple-click native select-all + one insertText that replaces
// the selection) first on the root task surface, KEY_ATOMIC first on
// conversations. A gesture that neither verifies nor provably no-ops stops the
// sequence so no double-append can occur. A preexisting exact match needs no
// gesture (resume path).

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

const STANDARD_BOX = [10, 10, 110, 10, 110, 60, 10, 60];

let nextWebContentsId = 9200;
function fakeTaskSurface({
  url = 'https://chat.z.ai/',
  keysHonored = false,
  clickSelectWorks = true,
  initialDraft = '',
  submitWorks = true,
} = {}) {
  let attached = false;
  let currentUrl = url;
  let composerValue = initialDraft;
  let enterCount = 0;
  let insertCount = 0;
  let tripleClickCount = 0;
  let selectionActive = false;
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
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'frame-root', url: currentUrl } } };
      if (method === 'Runtime.enable') {
        this.emitMessage('Runtime.executionContextCreated', { context: { id: 1, uniqueId: `context-${webContentsId}`, auxData: { frameId: 'frame-root', isDefault: true } } });
        return {};
      }
      if (['Page.enable','DOM.enable','Accessibility.enable','Page.setLifecycleEventsEnabled','Network.enable','Target.setAutoAttach','DOM.getDocument','Runtime.disable'].includes(method)) return {};
      if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 1200, clientHeight: 800 } };
      if (method === 'Accessibility.getFullAXTree') {
        return { nodes: [
          ax('textbox', '', 3, composerValue),
          ax('button', 'Select a model', 5),
        ] };
      }
      if (method === 'DOM.focus') return {};
      if (method === 'Input.insertText') {
        insertCount += 1;
        // The gesture contract: on an active selection (triple-click),
        // insertText replaces it; without a selection it appends at the caret.
        if (selectionActive && clickSelectWorks) {
          composerValue = String(params.text || '');
        } else {
          composerValue = composerValue + String(params.text || '');
        }
        selectionActive = false;
        return {};
      }
      if (method === 'Input.dispatchKeyEvent') {
        // Live-proven split (2026-09-19): the task composer IGNORES synthetic
        // editing keys (Backspace/Ctrl+A/Delete) but still honors Enter for
        // submit — three live dispatches proved Enter submits from the root
        // task surface.
        if (params.key === 'Enter' && params.type === 'rawKeyDown') {
          if (submitWorks) composerValue = '';
          enterCount += 1;
          return {};
        }
        if (!keysHonored) return {};
        if (params.key === 'a' && params.modifiers === 2 && params.type === 'rawKeyDown') composerValue = '';
        if (params.key === 'Delete' && params.type === 'rawKeyDown' && composerValue === '') composerValue = '';
        return {};
      }
      if (method === 'Input.dispatchKeyEvent.enter') return {};
      if (method === 'DOM.getBoxModel') return { model: { content: STANDARD_BOX.slice() } };
      if (method === 'Input.dispatchMouseEvent') {
        if (params.type === 'mousePressed' && params.clickCount === 3) {
          tripleClickCount += 1;
          selectionActive = true;
        }
        if (params.type === 'mousePressed' && params.clickCount === 1) selectionActive = false;
        return {};
      }
      throw new Error(`unexpected_debugger_command:${method}`);
    },
  };
  // Enter keyUp emits the post-submit re-render event the latch observes.
  const origSend = debuggerApi.sendCommand.bind(debuggerApi);
  debuggerApi.sendCommand = async (method, params = {}) => {
    const out = await origSend(method, params);
    if (method === 'Input.dispatchKeyEvent' && params?.key === 'Enter' && params?.type === 'keyUp') {
      debuggerApi.emitMessage('Accessibility.nodesUpdated', { nodes: [] });
    }
    return out;
  };
  return {
    calls,
    counts: () => ({ enterCount, insertCount, tripleClicks: tripleClickCount }),
    state: () => ({ composerValue, url: currentUrl }),
    webContents: {
      id: webContentsId,
      debugger: debuggerApi,
      isDestroyed: () => false,
      getURL: () => currentUrl,
      getTitle: () => 'Z.ai',
      getOSProcessId: () => 21000 + webContentsId,
      getOrCreateDevToolsTargetId: () => `target-${webContentsId}`,
    },
  };
}

async function dispatchTask(h, ref, prompt = 'D-M3 TASK PROMPT') {
  return executeSemanticCommand(h.webContents, {
    action: 'SEMANTIC_TYPE',
    platform: 'GLM_ZAI',
    payload: {
      role: 'textbox',
      accessible_name: null,
      semantic_ref: ref,
      text: prompt,
      replace_existing: true,
      submit_after_type: true,
    },
  });
}

function composerRefOf(frame) {
  const composer = frame.semantic_targets.find((row) => row.role === 'textbox');
  assert.ok(composer, 'composer target expected');
  return composer;
}

test('root task surface: click-select replaces a poisoned draft wholesale and submits', async () => {
  const h = fakeTaskSurface({ initialDraft: 'POISONED DRAFT x 26763 chars' });
  const frame = await captureSemanticFrame(h.webContents);
  const composer = composerRefOf(frame);
  const result = await dispatchTask(h, composer.semantic_ref);
  assert.equal(result.replace_verified, true);
  assert.equal(result.replace_gesture, 'CLICK_SELECT');
  assert.equal(result.effect_state, 'PROVEN_COMPOSER_CLEARED');
  assert.equal(result.value_length_before, 'POISONED DRAFT x 26763 chars'.length);
  assert.equal(result.value_length_after, 'D-M3 TASK PROMPT'.length);
  assert.equal(h.counts().tripleClicks, 1);
  assert.equal(h.counts().insertCount, 1);
  assert.equal(h.counts().enterCount, 1);
});

test('root task surface: an empty composer goes through the same verified click-select', async () => {
  const h = fakeTaskSurface({ initialDraft: '' });
  const frame = await captureSemanticFrame(h.webContents);
  const composer = composerRefOf(frame);
  const result = await dispatchTask(h, composer.semantic_ref);
  assert.equal(result.replace_verified, true);
  assert.equal(result.replace_gesture, 'CLICK_SELECT');
  assert.equal(result.effect_state, 'PROVEN_COMPOSER_CLEARED');
  assert.equal(h.counts().insertCount, 1);
});

test('root task surface: keys-only fallback still lands when click-select is a provable no-op', async () => {
  // clickSelectWorks=false models an editor that drops the mouse selection
  // before the insert; insertText then appends -> readback differs from both
  // the text and the before-value -> fail fast, no second gesture.
  const h = fakeTaskSurface({ initialDraft: 'OLD', clickSelectWorks: false });
  const frame = await captureSemanticFrame(h.webContents);
  const composer = composerRefOf(frame);
  await assert.rejects(
    () => dispatchTask(h, composer.semantic_ref),
    /native_semantic_type_replace_unverified/,
  );
  // Exactly ONE insertText ran - the append damage is bounded to a single
  // prompt, never two.
  assert.equal(h.counts().insertCount, 1);
  assert.equal(h.counts().enterCount, 0);
  assert.equal(h.state().composerValue, 'OLDD-M3 TASK PROMPT');
});

test('conversation surface: the proven key-atomic gesture stays first', async () => {
  const h = fakeTaskSurface({
    url: 'https://chat.z.ai/c/11111111-2222-3333-4444-555555555555',
    keysHonored: true,
    initialDraft: 'stale draft',
  });
  const frame = await captureSemanticFrame(h.webContents);
  const composer = composerRefOf(frame);
  const result = await dispatchTask(h, composer.semantic_ref);
  assert.equal(result.replace_verified, true);
  assert.equal(result.replace_gesture, 'KEY_ATOMIC');
  assert.equal(h.counts().tripleClicks, 0);
  assert.equal(h.counts().enterCount, 1);
});

test('conversation surface: click-select rescues when keys are a provable no-op', async () => {
  // keysHonored=false but URL is a conversation: KEY_ATOMIC runs first, keys
  // are ignored, insertText appends -> readback differs from before-value ->
  // fail fast WITHOUT the click gesture (bounded damage).
  const h = fakeTaskSurface({
    url: 'https://chat.z.ai/c/11111111-2222-3333-4444-555555555555',
    keysHonored: false,
    initialDraft: 'old',
  });
  const frame = await captureSemanticFrame(h.webContents);
  const composer = composerRefOf(frame);
  await assert.rejects(
    () => dispatchTask(h, composer.semantic_ref),
    /native_semantic_type_replace_unverified/,
  );
  assert.equal(h.counts().insertCount, 1);
});

test('preexisting exact match verifies without any gesture (resume path)', async () => {
  const h = fakeTaskSurface({ initialDraft: 'D-M3 TASK PROMPT' });
  const frame = await captureSemanticFrame(h.webContents);
  const composer = composerRefOf(frame);
  const result = await dispatchTask(h, composer.semantic_ref);
  assert.equal(result.replace_verified, true);
  assert.equal(result.replace_gesture, 'PREEXISTING_MATCH');
  assert.equal(h.counts().insertCount, 0);
  assert.equal(h.counts().enterCount, 1);
  assert.equal(result.effect_state, 'PROVEN_COMPOSER_CLEARED');
});

test('replace_gesture is null on the unverified legacy lane', async () => {
  const h = fakeTaskSurface({ initialDraft: '' });
  const frame = await captureSemanticFrame(h.webContents);
  const composer = composerRefOf(frame);
  const result = await executeSemanticCommand(h.webContents, {
    action: 'SEMANTIC_TYPE',
    platform: null,
    payload: {
      role: 'textbox',
      accessible_name: null,
      semantic_ref: composer.semantic_ref,
      text: 'legacy lane',
      replace_existing: true,
      submit_after_type: false,
    },
  });
  assert.equal(result.replace_verified, null);
  assert.equal(result.replace_gesture, null);
});
