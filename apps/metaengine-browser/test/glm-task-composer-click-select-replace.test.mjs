import test from 'node:test';
import assert from 'node:assert/strict';
import { captureSemanticFrame, executeSemanticCommand } from '../src/native-browser-control.mjs';

// R98 canonical replace contract: semantic identity is backend-node based and
// replacement is geometry-free. The old draft must be independently proven
// empty after DOM.focus + SelectAll + DeleteBackward before Input.insertText is
// allowed. There is no coordinate/triple-click fallback. A preexisting exact
// match needs no editing gesture (resume path).

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
          if (submitWorks) {
            composerValue = '';
            if (currentUrl === 'https://chat.z.ai/' || currentUrl === 'https://chat.z.ai') {
              currentUrl = 'https://chat.z.ai/c/11111111-2222-4333-8444-555555555555';
            }
          }
          enterCount += 1;
          return {};
        }
        if (!keysHonored) return {};
        if (params.key === 'a' && params.modifiers === 2 && params.type === 'rawKeyDown') composerValue = '';
        if (params.key === 'Backspace' && params.type === 'rawKeyDown' && keysHonored) composerValue = '';
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

test('root task surface: focused key-atomic replaces an oversized account-synced draft wholesale and submits', async () => {
  // Live scenario (2026-09-21): a 48k account-synced draft poisoned every root
  // composer; the focused Ctrl+A+Delete gesture clears it wholesale.
  const h = fakeTaskSurface({ initialDraft: 'POISONED DRAFT x 26763 chars', keysHonored: true });
  const frame = await captureSemanticFrame(h.webContents);
  const composer = composerRefOf(frame);
  const result = await dispatchTask(h, composer.semantic_ref);
  assert.equal(result.replace_verified, true);
  assert.equal(result.replace_gesture, 'CDP_EDIT_COMMAND_CLEAR');
  assert.equal(result.effect_state, 'PROVEN_NEW_CONVERSATION');
  assert.equal(result.new_conversation_observed, true);
  assert.equal(result.value_length_before, 'POISONED DRAFT x 26763 chars'.length);
  assert.equal(result.value_length_after, 'D-M3 TASK PROMPT'.length);
  assert.equal(h.counts().tripleClicks, 0);
  assert.equal(h.counts().insertCount, 1);
  assert.equal(h.counts().enterCount, 1);
  // R-DRAFT-FOCUS: the composer backend node is focused BEFORE the editing
  // keys are dispatched — unfocused keys landed on <body> and were the real
  // D-M3 no-op mechanism.
  const focusCalls = h.calls.filter(([m, p]) => m === 'DOM.focus' && p?.backendNodeId != null);
  assert.ok(focusCalls.length >= 1, 'DOM.focus on the composer expected before editor-command clear');
});

test('root task surface: an empty composer inserts directly without geometry', async () => {
  const h = fakeTaskSurface({ initialDraft: '' });
  const frame = await captureSemanticFrame(h.webContents);
  const composer = composerRefOf(frame);
  const result = await dispatchTask(h, composer.semantic_ref);
  assert.equal(result.replace_verified, true);
  assert.equal(result.replace_gesture, 'EMPTY_COMPOSER_INSERT');
  assert.equal(result.effect_state, 'PROVEN_NEW_CONVERSATION');
  assert.equal(result.new_conversation_observed, true);
  assert.equal(h.counts().insertCount, 1);
  assert.equal(h.counts().tripleClicks, 0);
});

test('root task surface: an unproven clear fails before any prompt insertion', async () => {
  // keysHonored=false models an editor that ignores the clear gesture. The
  // independent empty readback must fail before Input.insertText or Enter.
  const h = fakeTaskSurface({ initialDraft: 'OLD', clickSelectWorks: false });
  const frame = await captureSemanticFrame(h.webContents);
  const composer = composerRefOf(frame);
  await assert.rejects(
    () => dispatchTask(h, composer.semantic_ref),
    /native_semantic_type_replace_unverified/,
  );
  assert.equal(h.counts().insertCount, 0);
  assert.equal(h.counts().enterCount, 0);
  assert.equal(h.counts().tripleClicks, 0);
  assert.equal(h.state().composerValue, 'OLD');
});

test('conversation surface: the proven clear-before-insert gesture stays geometry-free', async () => {
  const h = fakeTaskSurface({
    url: 'https://chat.z.ai/c/11111111-2222-3333-4444-555555555555',
    keysHonored: true,
    initialDraft: 'stale draft',
  });
  const frame = await captureSemanticFrame(h.webContents);
  const composer = composerRefOf(frame);
  const result = await dispatchTask(h, composer.semantic_ref);
  assert.equal(result.replace_verified, true);
  assert.equal(result.replace_gesture, 'CDP_EDIT_COMMAND_CLEAR');
  assert.equal(h.counts().tripleClicks, 0);
  assert.equal(h.counts().enterCount, 1);
});

test('conversation surface: ignored clear fails closed with no coordinate fallback', async () => {
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
  assert.equal(h.counts().insertCount, 0);
  assert.equal(h.counts().tripleClicks, 0);
  assert.equal(h.calls.some(([m]) => m === 'Input.dispatchMouseEvent'), false);
});

test('preexisting exact match skips replace gesture while submit readback can prove a new Agent conversation', async () => {
  const h = fakeTaskSurface({ initialDraft: 'D-M3 TASK PROMPT' });
  const frame = await captureSemanticFrame(h.webContents);
  const composer = composerRefOf(frame);
  const result = await dispatchTask(h, composer.semantic_ref);
  assert.equal(result.replace_verified, true);
  assert.equal(result.replace_gesture, 'PREEXISTING_MATCH');
  assert.equal(h.counts().insertCount, 0);
  assert.equal(h.counts().enterCount, 1);
  assert.equal(result.effect_state, 'PROVEN_NEW_CONVERSATION');
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
