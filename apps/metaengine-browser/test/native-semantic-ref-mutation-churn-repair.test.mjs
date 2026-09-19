import test from 'node:test';
import assert from 'node:assert/strict';
import { captureSemanticFrame, executeSemanticCommand } from '../src/native-browser-control.mjs';

// D-M1 contract: mutation-only DOM churn (carousel ticks, skeleton loaders,
// timers) advances ONLY semantic_generation. Before the repair every capture
// died instantly on such surfaces (live 2026-09-19: three consecutive
// CAPTURE -> SEMANTIC_TYPE native_semantic_ref_stale failures). The repair
// re-anchors the ref across that churn by re-resolving the exact node
// (backend_node_id + role/name evidence) through the capture-path projection,
// while every document-level movement (navigation, same-document navigation,
// re-attachment) still fails closed.

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
const ZERO_AREA_BOX = [10, 10, 10, 10, 10, 10, 10, 10];

let nextWebContentsId = 8400;
function fakeChurningZai({
  submitWorks = true,
  mutateOnInsert = false,
  composerBox = STANDARD_BOX,
} = {}) {
  let attached = false;
  let url = 'https://chat.z.ai/';
  let composerValue = '';
  let axReads = 0;
  let enterCount = 0;
  let clickCount = 0;
  let insertCount = 0;
  let mutationCount = 0;
  const calls = [];
  const listeners = new Map();
  const webContentsId = nextWebContentsId++;
  // Mutable AX surface: tests swap contents to emulate removals/role changes.
  let nodes = [
    ax('textbox', '', 3, composerValue),
    ax('button', 'Select a model', 5),
  ];
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
      if (['Page.enable','DOM.enable','Accessibility.enable','Page.setLifecycleEventsEnabled','Network.enable','Target.setAutoAttach','DOM.getDocument','Runtime.disable'].includes(method)) return {};
      if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 1200, clientHeight: 800 } };
      if (method === 'Accessibility.getFullAXTree') {
        axReads += 1;
        return { nodes: structuredClone(nodes) };
      }
      if (method === 'DOM.focus') return {};
      if (method === 'Input.insertText') {
        insertCount += 1;
        composerValue = String(params.text || '');
        nodes = [ax('textbox', '', 3, composerValue), ax('button', 'Select a model', 5)];
        if (mutateOnInsert) {
          // Emulate the controlled composer's own re-render: a DOM attribute
          // mutation lands right after the insert (this is the window that
          // used to kill the pre-Enter gate).
          mutationCount += 1;
          this.emitMessage('DOM.attributeModified', { nodeId: 'ax-3', name: 'data-render-pass', value: String(mutationCount) });
        }
        return {};
      }
      if (method === 'Input.dispatchKeyEvent') {
        if (params.key === 'Enter' && params.type === 'rawKeyDown') {
          if (submitWorks) {
            composerValue = '';
            nodes = [ax('textbox', '', 3, composerValue), ax('button', 'Select a model', 5)];
          }
          enterCount += 1;
        }
        if (params.key === 'Enter' && params.type === 'keyUp' && submitWorks) {
          // A real chat surface re-renders its message list after a successful
          // submit; that CDP event is exactly what the outcome latch observes.
          this.emitMessage('Accessibility.nodesUpdated', { nodes: [] });
        }
        return {};
      }
      if (method === 'DOM.getBoxModel') {
        return { model: { content: Number(params?.backendNodeId) === 3 ? composerBox.slice() : STANDARD_BOX.slice() } };
      }
      if (method === 'Input.dispatchMouseEvent') {
        if (params.type === 'mousePressed') clickCount += 1;
        return {};
      }
      throw new Error(`unexpected_debugger_command:${method}`);
    },
  };
  return {
    calls,
    counts: () => ({ axReads, enterCount, clickCount, insertCount, mutationCount }),
    mutate(method = 'DOM.childNodeInserted', params = {}) {
      mutationCount += 1;
      debuggerApi.emitMessage(method, params);
    },
    setNodes(next) { nodes = next; },
    setUrl(next) { url = next; },
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

function composerRefOf(frame) {
  const composer = frame.semantic_targets.find((row) => row.role === 'textbox');
  assert.ok(composer, 'composer target expected');
  return composer;
}

async function typePrompt(h, ref, prompt = 'D-M1 CHURN CONTRACT TASK') {
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

test('carousel churn between CAPTURE and SEMANTIC_TYPE re-anchors instead of failing stale', async () => {
  const h = fakeChurningZai();
  const frame = await captureSemanticFrame(h.webContents);
  const composer = composerRefOf(frame);
  // Off-screen carousel tick: a DOM mutation lands after the capture, before
  // the effect. Before the repair this exact sequence failed live with
  // native_semantic_ref_stale three times in a row.
  h.mutate('DOM.childNodeInserted', { node: { nodeId: 'carousel-1' } });
  const result = await typePrompt(h, composer.semantic_ref);
  assert.equal(result.effect_state, 'PROVEN_COMPOSER_CLEARED');
  assert.equal(result.composer_cleared, true);
  assert.equal(h.counts().enterCount, 1);
  assert.equal(h.counts().insertCount, 1);
});

test('a churn storm of mixed mutation events still resolves one exact composer', async () => {
  const h = fakeChurningZai();
  const frame = await captureSemanticFrame(h.webContents);
  const composer = composerRefOf(frame);
  h.mutate('Accessibility.nodesUpdated', { nodes: [] });
  h.mutate('DOM.childNodeRemoved', { nodeId: 'carousel-2' });
  h.mutate('DOM.characterDataModified', { nodeId: 'carousel-3', characterData: 'x' });
  h.mutate('DOM.attributeRemoved', { nodeId: 'carousel-4', name: 'aria-hidden' });
  const result = await typePrompt(h, composer.semantic_ref);
  assert.equal(result.effect_state, 'PROVEN_COMPOSER_CLEARED');
  assert.equal(h.counts().enterCount, 1);
});

test('the composer re-render after insertText no longer kills the pre-Enter gate', async () => {
  const h = fakeChurningZai({ mutateOnInsert: true });
  const frame = await captureSemanticFrame(h.webContents);
  const composer = composerRefOf(frame);
  const result = await typePrompt(h, composer.semantic_ref);
  assert.equal(result.effect_state, 'PROVEN_COMPOSER_CLEARED');
  assert.equal(result.replace_verified, true);
  assert.equal(h.counts().enterCount, 1);
  assert.equal(h.counts().mutationCount, 1);
});

test('mutation churn with the composer removed from the surface fails closed', async () => {
  const h = fakeChurningZai();
  const frame = await captureSemanticFrame(h.webContents);
  const composer = composerRefOf(frame);
  h.setNodes([ax('button', 'Select a model', 5)]);
  h.mutate('DOM.childNodeRemoved', { nodeId: 'ax-3' });
  await assert.rejects(
    () => typePrompt(h, composer.semantic_ref),
    /native_semantic_ref_stale/,
  );
  assert.equal(h.counts().enterCount, 0);
  assert.equal(h.counts().insertCount, 0);
});

test('mutation churn with the composer role morphed fails closed (evidence mismatch)', async () => {
  const h = fakeChurningZai();
  const frame = await captureSemanticFrame(h.webContents);
  const composer = composerRefOf(frame);
  h.setNodes([ax('button', '', 3), ax('button', 'Select a model', 5)]);
  h.mutate('DOM.attributeModified', { nodeId: 'ax-3', name: 'role', value: 'button' });
  await assert.rejects(
    () => typePrompt(h, composer.semantic_ref),
    /native_semantic_ref_stale/,
  );
  assert.equal(h.counts().insertCount, 0);
});

test('mutation churn with the composer renamed fails closed (name evidence mismatch)', async () => {
  const h = fakeChurningZai();
  const frame = await captureSemanticFrame(h.webContents);
  const composer = composerRefOf(frame);
  // A DIFFERENT textbox appears under the same backend node id with a name
  // the captured ref never saw.
  h.setNodes([ax('textbox', 'Not the composer', 3), ax('button', 'Select a model', 5)]);
  h.mutate('DOM.attributeModified', { nodeId: 'ax-3', name: 'aria-label', value: 'Not the composer' });
  await assert.rejects(
    () => typePrompt(h, composer.semantic_ref),
    /native_semantic_ref_stale/,
  );
});

test('frame navigation after capture still kills the ref outright (no re-anchor)', async () => {
  const h = fakeChurningZai();
  const frame = await captureSemanticFrame(h.webContents);
  const composer = composerRefOf(frame);
  h.setUrl('https://chat.z.ai/c/11111111-2222-3333-4444-555555555555');
  h.mutate('Page.frameNavigated', { frame: { id: 'frame-root', url: 'https://chat.z.ai/c/11111111-2222-3333-4444-555555555555' } });
  await assert.rejects(
    () => typePrompt(h, composer.semantic_ref),
    /native_semantic_ref_stale/,
  );
  assert.equal(h.counts().insertCount, 0);
});

test('same-document navigation after capture still kills the ref outright', async () => {
  const h = fakeChurningZai();
  const frame = await captureSemanticFrame(h.webContents);
  const composer = composerRefOf(frame);
  h.setUrl('https://chat.z.ai/?prompt=x');
  h.mutate('Page.navigatedWithinDocument', { frameId: 'frame-root', url: 'https://chat.z.ai/?prompt=x' });
  await assert.rejects(
    () => typePrompt(h, composer.semantic_ref),
    /native_semantic_ref_stale/,
  );
});

test('document replacement after capture still kills the ref outright', async () => {
  const h = fakeChurningZai();
  const frame = await captureSemanticFrame(h.webContents);
  const composer = composerRefOf(frame);
  h.mutate('DOM.documentUpdated');
  await assert.rejects(
    () => typePrompt(h, composer.semantic_ref),
    /native_semantic_ref_stale/,
  );
});

test('TYPED_CLICK across carousel churn lands exactly one physical click', async () => {
  const h = fakeChurningZai();
  const frame = await captureSemanticFrame(h.webContents);
  const button = frame.semantic_targets.find((row) => row.role === 'button' && row.name === 'Select a model');
  assert.ok(button?.semantic_ref);
  h.mutate('DOM.childNodeInserted', { node: { nodeId: 'carousel-9' } });
  const result = await executeSemanticCommand(h.webContents, {
    action: 'TYPED_CLICK',
    platform: 'GLM_ZAI',
    payload: {
      role: 'button',
      accessible_name: 'Select a model',
      semantic_ref: button.semantic_ref,
    },
  });
  assert.equal(result.action, 'TYPED_CLICK');
  assert.ok(result.point);
  assert.equal(h.counts().clickCount, 1);
});

test('a zero-area (hidden carousel slide) click target fails closed, no physical effect', async () => {
  const h = fakeChurningZai({ composerBox: ZERO_AREA_BOX });
  const frame = await captureSemanticFrame(h.webContents);
  const composer = composerRefOf(frame);
  await assert.rejects(
    () => executeSemanticCommand(h.webContents, {
      action: 'TYPED_CLICK',
      platform: 'GLM_ZAI',
      payload: {
        role: 'textbox',
        accessible_name: null,
        semantic_ref: composer.semantic_ref,
      },
    }),
    /native_semantic_target_not_visible/,
  );
  assert.equal(h.counts().clickCount, 0);
});

test('capture during continuous churn still issues semantic refs', async () => {
  const h = fakeChurningZai();
  h.mutate('DOM.childNodeInserted', { node: { nodeId: 'carousel-a' } });
  const frame = await captureSemanticFrame(h.webContents);
  const composer = composerRefOf(frame);
  assert.ok(composer.semantic_ref);
  assert.ok(frame.semantic_ref_context_complete);
});
