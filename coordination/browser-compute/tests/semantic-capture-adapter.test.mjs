import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticCaptureAdapter } from '../src/semantic-capture-adapter.mjs';

class FakeCdp {
  constructor() { this.calls = []; }
  async call(method, params = {}, options = {}) {
    this.calls.push({ method, params: structuredClone(params), options: structuredClone(options) });
    if (method === 'Target.attachToTarget') return { sessionId: 'session-semantic-1' };
    if (method === 'Page.enable' || method === 'Accessibility.enable' || method === 'Accessibility.disable' || method === 'Target.detachFromTarget') return {};
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'frame-main', loaderId: 'loader-1', url: 'about:blank' } } };
    if (method === 'Accessibility.getFullAXTree') return { nodes: [
      { nodeId: 'ax-root', backendDOMNodeId: 1, ignored: false, role: { value: 'RootWebArea' }, name: { value: 'Fixture' }, properties: [] },
      { nodeId: 'ax-text', backendDOMNodeId: 2, ignored: false, role: { value: 'textbox' }, name: { value: 'Message' }, value: { value: '' }, properties: [{ name: 'focusable', value: { value: true } }] },
      { nodeId: 'ax-button', backendDOMNodeId: 3, ignored: false, role: { value: 'button' }, name: { value: 'Send message' }, properties: [{ name: 'focusable', value: { value: true } }] }
    ] };
    if (method === 'DOMSnapshot.captureSnapshot') return {
      strings: ['HTML','TEXTAREA','BUTTON','','id','msg','data-testid','composer','aria-label','Send message'],
      documents: [{
        nodes: {
          nodeName: [0,1,2], nodeValue: [3,3,3], backendNodeId: [1,2,3], parentIndex: [-1,0,0],
          attributes: [[], [4,5,6,7], [8,9]]
        },
        layout: { nodeIndex: [0,1,2], bounds: [[0,0,1000,800],[20,700,700,60],[750,700,120,60]] }
      }]
    };
    if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 1280, clientHeight: 800, pageX: 0, pageY: 0, scale: 1 } };
    throw new Error(`unexpected_fake_cdp:${method}`);
  }
}

const target = { target_id: 'target_semantic', context_id: 'context_alpha', conversation_epoch: 3, status: 'ACTIVE' };
const binding = { cdp_target_id: 'physical-target-1', context_id: 'context_alpha', conversation_epoch: 3 };

test('semantic adapter uses flattened CDP read plane and emits no raw browser authority', async () => {
  const cdp = new FakeCdp();
  const adapter = new SemanticCaptureAdapter({ cdp });
  const frame = await adapter.capture({ target, binding, maxNodes: 30, taskText: 'message send' });
  assert.equal(frame.schema, 'metaengine.a2-browser-operator.semantic-frame.v1');
  assert.equal(frame.target_id, target.target_id);
  assert.equal(frame.context_id, target.context_id);
  assert.equal(frame.document_epoch, 'frame-main:loader-1');
  assert.equal(frame.tainted_page_data, true);
  assert.equal(frame.authority_effect, false);
  assert.equal(frame.adapter.transport, 'NATIVE_CDP_PIPE');
  assert.equal(frame.adapter.page_script_evaluation, false);
  assert.equal(frame.adapter.raw_cdp_exposed, false);
  assert.equal(Object.hasOwn(frame.adapter, 'url'), false);
  assert.ok(frame.nodes.some((node) => node.role === 'textbox' && node.binding_evidence.backend_dom_node_id === 2));
  assert.ok(frame.nodes.some((node) => node.role === 'button' && node.binding_evidence.backend_dom_node_id === 3));

  const methods = cdp.calls.map((row) => row.method);
  assert.ok(methods.includes('Target.attachToTarget'));
  assert.ok(methods.includes('Accessibility.getFullAXTree'));
  assert.ok(methods.includes('DOMSnapshot.captureSnapshot'));
  assert.ok(methods.includes('Page.getLayoutMetrics'));
  assert.ok(methods.includes('Target.detachFromTarget'));
  assert.equal(methods.includes('Runtime.evaluate'), false);
  assert.equal(methods.includes('Runtime.enable'), false);
  for (const row of cdp.calls.filter((call) => ['Page.enable','Accessibility.enable','Accessibility.getFullAXTree','DOMSnapshot.captureSnapshot','Page.getLayoutMetrics','Accessibility.disable'].includes(call.method))) {
    assert.equal(row.options.sessionId, 'session-semantic-1');
  }
});

test('semantic adapter rejects stale context or epoch bindings before physical attach', async () => {
  const cdp = new FakeCdp();
  const adapter = new SemanticCaptureAdapter({ cdp });
  await assert.rejects(adapter.capture({ target, binding: { ...binding, context_id: 'context_other' } }), /semantic_target_context_binding_mismatch/);
  await assert.rejects(adapter.capture({ target, binding: { ...binding, conversation_epoch: 2 } }), /semantic_target_epoch_binding_mismatch/);
  assert.equal(cdp.calls.length, 0);
});
