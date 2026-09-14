import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { captureSemanticFrame, captureViewThumbnail, executeSemanticCommand } from '../src/native-browser-control.mjs';
import { releasePersistentBrowserDebugger } from '../src/browser-persistent-cdp-session.mjs';
import { clearNativeEffectRuntimeObservationsForTest } from '../src/native-effect-runtime-observation.mjs';

class FakeDebugger extends EventEmitter {
  constructor({ context = true } = {}) {
    super();
    this.attached = false;
    this.context = context;
    this.commands = [];
    this.nodes = [
      { nodeId: 'root', frameId: 'frame-root', ignored: false, role: { value: 'RootWebArea' }, name: { value: 'Page' } },
      { nodeId: 'send', parentId: 'root', ignored: false, role: { value: 'button' }, name: { value: 'Send' }, backendDOMNodeId: 41 },
    ];
  }

  isAttached() { return this.attached; }
  attach() { this.attached = true; }
  detach() { this.attached = false; }

  push(method, params = {}, sessionId = null) {
    this.emit('message', {}, method, params, sessionId);
  }

  createContext(uniqueId = 'context-root-v1') {
    this.push('Runtime.executionContextCreated', {
      context: {
        id: uniqueId.endsWith('v2') ? 12 : 11,
        uniqueId,
        auxData: { frameId: 'frame-root', isDefault: true },
      },
    });
  }

  async sendCommand(method, params = {}) {
    this.commands.push({ method, params });
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'frame-root', url: 'https://chatgpt.com/' } } };
    if (method === 'Runtime.enable' && this.context) this.createContext();
    if (method === 'Accessibility.getFullAXTree') return { nodes: structuredClone(this.nodes) };
    if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 1200, clientHeight: 800 } };
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.getBoxModel') return { model: { border: [0, 0, 20, 0, 20, 20, 0, 20] } };
    return {};
  }
}

function fakeWebContents(options = {}) {
  const dbg = new FakeDebugger(options);
  const webContents = new EventEmitter();
  Object.assign(webContents, {
    id: options.id || 841,
    debugger: dbg,
    isDestroyed: () => false,
    getOSProcessId: () => 9841,
    getOrCreateDevToolsTargetId: () => 'target-841',
    getURL: () => 'https://chatgpt.com/',
    getTitle: () => 'ChatGPT',
  });
  return { webContents, dbg };
}

function clickCommand(ref) {
  return {
    action: 'TYPED_CLICK',
    platform: 'CHATGPT',
    payload: { role: 'button', accessible_name: 'Send', semantic_ref: ref },
  };
}

function jpegImage() {
  return {
    getSize: () => ({ width: 320, height: 200 }),
    resize() { return this; },
    toJPEG: () => Buffer.from('revision-bound-jpeg'),
  };
}

test('trusted capture issues a complete SemanticRef and fresh ref reaches one physical effect', async () => {
  clearNativeEffectRuntimeObservationsForTest();
  const { webContents, dbg } = fakeWebContents();
  try {
    const frame = await captureSemanticFrame(webContents);
    const send = frame.semantic_targets.find((row) => row.name === 'Send');
    assert.equal(frame.semantic_ref_context_complete, true);
    assert.equal(frame.semantic_refs_issued, 1);
    assert.equal(send.frame_id, 'frame-root');
    assert.equal(send.semantic_ref.execution_context_unique_id, 'context-root-v1');
    assert.equal(send.semantic_ref.state_revision_id, frame.state_revision_id);

    const result = await executeSemanticCommand(webContents, clickCommand(send.semantic_ref));
    assert.equal(result.target.backend_node_id, 41);
    assert.equal(dbg.commands.filter((row) => row.method === 'DOM.getBoxModel').length, 1);
    assert.equal(dbg.commands.filter((row) => row.method === 'Input.dispatchMouseEvent').length, 3);
  } finally {
    releasePersistentBrowserDebugger(webContents);
    clearNativeEffectRuntimeObservationsForTest();
  }
});

test('same-document revision change rejects stale SemanticRef before target lookup or input dispatch', async () => {
  clearNativeEffectRuntimeObservationsForTest();
  const { webContents, dbg } = fakeWebContents({ id: 842 });
  try {
    const frame = await captureSemanticFrame(webContents);
    const ref = frame.semantic_targets.find((row) => row.name === 'Send').semantic_ref;
    const before = dbg.commands.length;
    dbg.push('Page.navigatedWithinDocument', { frameId: 'frame-root', url: 'https://chatgpt.com/#next' });

    await assert.rejects(executeSemanticCommand(webContents, clickCommand(ref)), /native_semantic_ref_stale/);
    const after = dbg.commands.slice(before);
    assert.equal(after.some((row) => row.method === 'Accessibility.getFullAXTree'), false);
    assert.equal(after.some((row) => row.method === 'DOM.getBoxModel'), false);
    assert.equal(after.some((row) => row.method.startsWith('Input.')), false);
  } finally {
    releasePersistentBrowserDebugger(webContents);
    clearNativeEffectRuntimeObservationsForTest();
  }
});

test('execution-context reincarnation rejects stale ref without role/name rebinding', async () => {
  clearNativeEffectRuntimeObservationsForTest();
  const { webContents, dbg } = fakeWebContents({ id: 843 });
  try {
    const frame = await captureSemanticFrame(webContents);
    const ref = frame.semantic_targets.find((row) => row.name === 'Send').semantic_ref;
    dbg.push('Runtime.executionContextDestroyed', { executionContextId: 11, executionContextUniqueId: 'context-root-v1' });
    dbg.createContext('context-root-v2');

    await assert.rejects(executeSemanticCommand(webContents, clickCommand(ref)), /native_semantic_ref_stale/);
    assert.equal(dbg.commands.some((row) => row.method === 'DOM.getBoxModel'), false);
    assert.equal(dbg.commands.some((row) => row.method.startsWith('Input.')), false);
  } finally {
    releasePersistentBrowserDebugger(webContents);
    clearNativeEffectRuntimeObservationsForTest();
  }
});

test('material AX node replacement advances StateRevision and never rebinds the old role/name', async () => {
  clearNativeEffectRuntimeObservationsForTest();
  const { webContents, dbg } = fakeWebContents({ id: 845 });
  try {
    const before = await captureSemanticFrame(webContents);
    const oldRef = before.semantic_targets.find((row) => row.name === 'Send').semantic_ref;
    dbg.nodes = [
      { nodeId: 'root', frameId: 'frame-root', ignored: false, role: { value: 'RootWebArea' }, name: { value: 'Page' } },
      { nodeId: 'send-new', parentId: 'root', ignored: false, role: { value: 'button' }, name: { value: 'Send' }, backendDOMNodeId: 42 },
    ];
    dbg.push('Accessibility.nodesUpdated', { nodes: structuredClone(dbg.nodes) });

    await assert.rejects(executeSemanticCommand(webContents, clickCommand(oldRef)), /native_semantic_ref_stale/);
    assert.equal(dbg.commands.some((row) => row.method === 'DOM.getBoxModel'), false);
    assert.equal(dbg.commands.some((row) => row.method.startsWith('Input.')), false);

    const after = await captureSemanticFrame(webContents);
    const newRef = after.semantic_targets.find((row) => row.name === 'Send').semantic_ref;
    assert.notEqual(newRef.semantic_ref_id, oldRef.semantic_ref_id);
    assert.notEqual(after.state_revision_id, before.state_revision_id);
  } finally {
    releasePersistentBrowserDebugger(webContents);
    clearNativeEffectRuntimeObservationsForTest();
  }
});

test('missing trusted execution-context identity emits evidence without guessing a SemanticRef', async () => {
  clearNativeEffectRuntimeObservationsForTest();
  const { webContents } = fakeWebContents({ id: 844, context: false });
  try {
    const frame = await captureSemanticFrame(webContents);
    const send = frame.semantic_targets.find((row) => row.name === 'Send');
    assert.equal(frame.semantic_ref_context_complete, false);
    assert.equal(frame.semantic_refs_issued, 0);
    assert.equal(send.semantic_ref, undefined);
  } finally {
    releasePersistentBrowserDebugger(webContents);
    clearNativeEffectRuntimeObservationsForTest();
  }
});

test('visual capture is sealed to the same target and StateRevision', async () => {
  clearNativeEffectRuntimeObservationsForTest();
  const { webContents } = fakeWebContents({ id: 846 });
  webContents.capturePage = async () => jpegImage();
  try {
    const capture = await captureViewThumbnail(webContents);
    assert.equal(capture.revision_bound, true);
    assert.match(capture.state_revision_id, /^rev_[a-f0-9]{64}$/);
    assert.equal(capture.target_id, 'webcontents:846');
    assert.equal(capture.frame_id, 'frame-root');
    assert.equal(capture.automatic_retry_allowed, false);
  } finally {
    releasePersistentBrowserDebugger(webContents);
    clearNativeEffectRuntimeObservationsForTest();
  }
});

test('visual capture crossing a semantic revision is discarded without retry', async () => {
  clearNativeEffectRuntimeObservationsForTest();
  const { webContents, dbg } = fakeWebContents({ id: 847 });
  webContents.capturePage = async () => {
    dbg.push('Accessibility.nodesUpdated', { nodes: structuredClone(dbg.nodes) });
    return jpegImage();
  };
  try {
    await assert.rejects(
      captureViewThumbnail(webContents),
      (error) => error?.code === 'NATIVE_CAPTURE_STATE_REVISION_CHANGED'
        && error?.automatic_retry_allowed === false,
    );
  } finally {
    releasePersistentBrowserDebugger(webContents);
    clearNativeEffectRuntimeObservationsForTest();
  }
});
