import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPerceptionEnvelope, envelopeFromComputeSnapshot, envelopeFromExtensionFrame } from '../perception-envelope-v1.mjs';
import { captureComputePerceptionEnvelope } from '../../browser-compute/src/perception-envelope.mjs';

const NODE_KEY = Buffer.alloc(32, 9);
const IDENTITY = {
  targetId: 'worker_primary',
  cdpTargetId: 'raw-engine-target-must-not-leak',
  conversationEpoch: 7,
  processIncarnationId: 'raw-process-incarnation-must-not-leak'
};

function extensionFrame() {
  return {
    schema: 'metaengine.a2-browser-operator.semantic-frame.v1',
    frame_id: 'extension_frame_internal_1',
    target_id: 'worker_primary',
    context_id: 'context_primary',
    document_epoch: 'doc_extension_7',
    captured_at: '2026-08-28T01:00:00.000Z',
    tainted_page_data: true,
    authority_effect: false,
    truncation: { applied: false },
    nodes: [{
      semantic_id: 'sem_submit',
      role: 'button',
      name: 'Submit',
      value_summary: null,
      states: { focusable: 'true' },
      editable: false,
      clickable: true,
      focusable: true,
      bounds: [64, 128, 96, 32],
      visible: true,
      confidence: 0.98,
      continuity: 'EXACT_BINDING',
      binding_epoch: 3
    }]
  };
}

function computeSnapshot() {
  return {
    schema: 'metaengine.a2-compute-browser.semantic-snapshot.v1',
    target_id: 'worker_primary',
    conversation_epoch: 7,
    process_incarnation_id: 'raw-process-incarnation-must-not-leak',
    session_generation: 5,
    scope: 'MAIN_TARGET',
    oopif_complete: false,
    consistency: 'SEQUENTIAL_READ_ONLY',
    actuation_eligible: false,
    snapshot_id: 'snapshot_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    captured_at: '2026-08-28T01:00:00.000Z',
    nodes: [{
      node_id: 'node_0123456789abcdef0123456789abcdef',
      parent_node_id: null,
      role: 'button',
      name: 'Submit',
      description: null,
      ignored: false,
      state: { focusable: 'true' },
      visible: true,
      bounds: [64, 128, 96, 32],
      paint_order: 4
    }]
  };
}

function domFixture() {
  return {
    strings: ['#document', 'BUTTON', 'block', 'visible', '1', 'auto', 'about:blank', 'frame-1', 'UTF-8'],
    documents: [{
      documentURL: 6,
      title: -1,
      baseURL: 6,
      contentLanguage: -1,
      encodingName: 8,
      publicId: -1,
      systemId: -1,
      frameId: 7,
      nodes: {
        parentIndex: [-1, 0],
        nodeType: [9, 1],
        nodeName: [0, 1],
        nodeValue: [-1, -1],
        backendNodeId: [101, 102],
        attributes: [[], []]
      },
      layout: {
        nodeIndex: [1],
        styles: [[2, 3, 4, 5]],
        bounds: [[64, 128, 96, 32]],
        text: [-1],
        paintOrders: [1]
      }
    }]
  };
}

function axFixture() {
  return {
    nodes: [{
      nodeId: 'raw-ax-button-must-not-leak',
      ignored: false,
      role: { type: 'role', value: 'button' },
      name: { type: 'computedString', value: 'Submit' },
      properties: [{ name: 'focusable', value: { type: 'booleanOrUndefined', value: true } }],
      backendDOMNodeId: 102
    }]
  };
}

test('extension and compute surfaces normalize to one cache-facing schema', () => {
  const extension = assertPerceptionEnvelope(envelopeFromExtensionFrame(extensionFrame(), { conversationEpoch: 7 }));
  const compute = assertPerceptionEnvelope(envelopeFromComputeSnapshot(computeSnapshot(), {
    contextId: 'context_primary',
    documentEpoch: 'doc_compute_7'
  }));

  assert.equal(extension.schema, compute.schema);
  assert.equal(extension.target_id, compute.target_id);
  assert.equal(extension.context_id, compute.context_id);
  assert.equal(extension.conversation_epoch, compute.conversation_epoch);
  assert.equal(extension.nodes[0].role, compute.nodes[0].role);
  assert.equal(extension.nodes[0].name, compute.nodes[0].name);
  assert.equal(extension.nodes[0].semantic_fingerprint, compute.nodes[0].semantic_fingerprint);
  assert.equal(extension.nodes[0].locator_fingerprint, compute.nodes[0].locator_fingerprint);
  assert.equal(extension.nodes[0].visibility, 'VISIBLE');
  assert.equal(compute.nodes[0].visibility, 'VISIBLE');
  assert.equal(extension.tainted_page_data, true);
  assert.equal(compute.tainted_page_data, true);
  assert.equal(extension.authority_effect, false);
  assert.equal(compute.authority_effect, false);
  assert.equal(extension.actuation_eligible, false);
  assert.equal(compute.actuation_eligible, false);

  const serialized = JSON.stringify({ extension, compute });
  assert.doesNotMatch(serialized, /raw-engine-target|raw-process-incarnation|raw-ax-button|backendDOMNodeId|session_generation|loaderId/);
});

test('negative or incomplete visibility evidence stays UNKNOWN in the common contract', () => {
  const snapshot = computeSnapshot();
  snapshot.nodes[0].visible = false;
  snapshot.nodes[0].bounds = [64, 128, 96, 32];
  const envelope = envelopeFromComputeSnapshot(snapshot, { contextId: 'context_primary', documentEpoch: 'doc_compute_7' });
  assert.equal(envelope.nodes[0].visibility, 'UNKNOWN');

  const frame = extensionFrame();
  frame.nodes[0].visible = false;
  const extension = envelopeFromExtensionFrame(frame, { conversationEpoch: 7 });
  assert.equal(extension.nodes[0].visibility, 'UNKNOWN');
});

test('cache identity dimensions are mandatory on both surfaces', () => {
  assert.throws(() => envelopeFromExtensionFrame(extensionFrame()), /conversation_epoch_required/);
  assert.throws(() => envelopeFromComputeSnapshot(computeSnapshot(), { contextId: 'context_primary' }), /document_epoch_required/);
  assert.throws(() => envelopeFromComputeSnapshot(computeSnapshot(), { documentEpoch: 'doc_compute_7' }), /context_id_required/);
});

test('common envelope is bounded and records deterministic truncation', () => {
  const frame = extensionFrame();
  frame.nodes.push({ ...frame.nodes[0], semantic_id: 'sem_cancel', name: 'Cancel' });
  const envelope = envelopeFromExtensionFrame(frame, { conversationEpoch: 7, maxNodes: 1 });
  assert.equal(envelope.nodes.length, 1);
  assert.deepEqual(envelope.truncation, { applied: true, source_node_count: 2, emitted_node_count: 1 });
});

test('compute loader sandwich derives stable opaque document epoch and never exposes loader id', async () => {
  const calls = [];
  const scheduler = {
    async run(identity, operation, options) {
      assert.deepEqual(identity, IDENTITY);
      assert.equal(options.deadlineMs, 10000);
      return operation({
        sessionGeneration: 5,
        async call(method, params) {
          calls.push({ method, params });
          if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'raw-frame', loaderId: 'raw-loader-secret', url: 'about:blank' } } };
          if (method === 'DOMSnapshot.captureSnapshot') return domFixture();
          if (method === 'Accessibility.getFullAXTree') return axFixture();
          throw new Error(`unexpected_method:${method}`);
        }
      });
    }
  };

  const result = await captureComputePerceptionEnvelope({
    scheduler,
    identity: IDENTITY,
    contextId: 'context_primary',
    nodeKey: NODE_KEY,
    capturedAt: '2026-08-28T01:00:00.000Z'
  });
  assert.match(result.documentEpoch, /^doc_[a-f0-9]{32}$/);
  assert.equal(result.envelope.document_epoch, result.documentEpoch);
  assert.deepEqual(calls.map((row) => row.method), [
    'Page.getFrameTree',
    'DOMSnapshot.captureSnapshot',
    'Accessibility.getFullAXTree',
    'Page.getFrameTree'
  ]);
  const serialized = JSON.stringify(result.envelope);
  assert.doesNotMatch(serialized, /raw-loader-secret|raw-frame|raw-process-incarnation|raw-engine-target|raw-ax-button/);
});

test('cross-document navigation during capture invalidates the entire envelope', async () => {
  let treeReads = 0;
  const scheduler = {
    async run(_identity, operation) {
      return operation({
        sessionGeneration: 5,
        async call(method) {
          if (method === 'Page.getFrameTree') {
            treeReads += 1;
            return { frameTree: { frame: { id: 'raw-frame', loaderId: treeReads === 1 ? 'loader-before' : 'loader-after', url: 'about:blank' } } };
          }
          if (method === 'DOMSnapshot.captureSnapshot') return domFixture();
          if (method === 'Accessibility.getFullAXTree') return axFixture();
          throw new Error(`unexpected_method:${method}`);
        }
      });
    }
  };
  await assert.rejects(captureComputePerceptionEnvelope({
    scheduler,
    identity: IDENTITY,
    contextId: 'context_primary',
    nodeKey: NODE_KEY
  }), /perception_document_changed_during_capture/);
});
