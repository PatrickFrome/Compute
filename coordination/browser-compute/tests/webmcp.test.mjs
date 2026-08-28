import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { WEBMCP_DISCOVERY_CDP_METHODS, WEBMCP_INVOCATION_EXPOSED_R6A, captureWebMcpTools } from '../src/webmcp.mjs';

const identity = {
  targetId: 'target_webmcp',
  cdpTargetId: 'engine-target-webmcp',
  conversationEpoch: 3,
  processIncarnationId: '99999999-9999-4999-8999-999999999999'
};
const nodeKey = crypto.randomBytes(32);

function frameTree(loaderId = 'loader-1', frameId = 'frame-main') {
  return { frameTree: { frame: { id: frameId, loaderId } } };
}

class FakeScheduler {
  constructor({ unsupported = false, loaderAfter = 'loader-1', onEnable = null } = {}) {
    this.unsupported = unsupported;
    this.loaderAfter = loaderAfter;
    this.onEnable = onEnable;
    this.calls = [];
    this.handlers = new Map();
    this.frameReads = 0;
  }

  async run(_identity, operation) {
    const onEvent = (method, listener) => {
      const list = this.handlers.get(method) || [];
      list.push(listener);
      this.handlers.set(method, list);
      return () => this.handlers.set(method, (this.handlers.get(method) || []).filter((row) => row !== listener));
    };
    const emit = (method, params) => {
      for (const listener of this.handlers.get(method) || []) listener(params);
    };
    const call = async (method, params = {}) => {
      this.calls.push({ method, params });
      if (method === 'Page.getFrameTree') {
        this.frameReads += 1;
        return frameTree(this.frameReads === 1 ? 'loader-1' : this.loaderAfter);
      }
      if (method === 'WebMCP.enable') {
        if (this.unsupported) throw new Error("cdp_error:-32601:'WebMCP.enable' wasn't found");
        this.onEnable?.(emit);
        return {};
      }
      if (method === 'WebMCP.disable') return {};
      throw new Error(`unexpected_method:${method}`);
    };
    return operation({ call, onEvent, sessionGeneration: 1 });
  }
}

function tool(name, extra = {}) {
  return {
    name,
    description: `Tool ${name}`,
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    annotations: { readOnly: true, consequential: false },
    frameId: 'frame-main',
    backendNodeId: 42,
    stackTrace: { callFrames: [{ url: 'https://untrusted.example/app.js' }] },
    ...extra
  };
}

test('WebMCP discovery uses typed domain events and applies add/remove before publishing', async () => {
  const scheduler = new FakeScheduler({
    onEnable: (emit) => {
      emit('WebMCP.toolsAdded', { tools: [tool('search'), tool('temporary')] });
      emit('WebMCP.toolsRemoved', { tools: [{ name: 'temporary', frameId: 'frame-main' }] });
    }
  });
  const envelope = await captureWebMcpTools({ scheduler, identity, contextId: 'default', nodeKey, settleMs: 0 });
  assert.equal(envelope.status, 'SUPPORTED');
  assert.equal(envelope.tool_count, 1);
  assert.equal(envelope.tools[0].name, 'search');
  assert.equal(envelope.tools[0].frame_scope, 'MAIN');
  assert.equal(envelope.tool_invocation_exposed, false);
  assert.deepEqual(scheduler.calls.map((row) => row.method), [
    'Page.getFrameTree', 'WebMCP.enable', 'Page.getFrameTree', 'WebMCP.disable'
  ]);
  assert.equal(JSON.stringify(envelope).includes('frame-main'), false);
  assert.equal(JSON.stringify(envelope).includes('backendNodeId'), false);
  assert.equal(JSON.stringify(envelope).includes('untrusted.example'), false);
});

test('unsupported WebMCP CDP method returns typed fallback rather than breaking browser runtime', async () => {
  const scheduler = new FakeScheduler({ unsupported: true });
  const envelope = await captureWebMcpTools({ scheduler, identity, contextId: 'default', nodeKey, settleMs: 0 });
  assert.equal(envelope.status, 'UNSUPPORTED');
  assert.equal(envelope.unsupported_reason, 'CDP_WEBMCP_UNAVAILABLE');
  assert.equal(envelope.tool_count, 0);
  assert.deepEqual(scheduler.calls.map((row) => row.method), [
    'Page.getFrameTree', 'WebMCP.enable', 'Page.getFrameTree'
  ]);
});

test('document loader change invalidates WebMCP discovery instead of publishing mixed tools', async () => {
  const scheduler = new FakeScheduler({
    loaderAfter: 'loader-2',
    onEnable: (emit) => emit('WebMCP.toolsAdded', { tools: [tool('search')] })
  });
  await assert.rejects(
    captureWebMcpTools({ scheduler, identity, contextId: 'default', nodeKey, settleMs: 0 }),
    /webmcp_document_changed_during_capture/
  );
  assert.equal(scheduler.calls.at(-1).method, 'WebMCP.disable');
});

test('malformed event payload and aggregate tool overflow fail closed', async () => {
  const malformed = new FakeScheduler({ onEnable: (emit) => emit('WebMCP.toolsAdded', { tools: null }) });
  await assert.rejects(
    captureWebMcpTools({ scheduler: malformed, identity, contextId: 'default', nodeKey, settleMs: 0 }),
    /webmcp_tools_added_invalid/
  );

  const overflow = new FakeScheduler({
    onEnable: (emit) => emit('WebMCP.toolsAdded', { tools: Array.from({ length: 129 }, (_, index) => tool(`tool_${index}`)) })
  });
  await assert.rejects(
    captureWebMcpTools({ scheduler: overflow, identity, contextId: 'default', nodeKey, settleMs: 0 }),
    /webmcp_tools_too_many/
  );
});

test('R6A method closure contains no WebMCP invocation path', () => {
  assert.deepEqual(WEBMCP_DISCOVERY_CDP_METHODS, ['Page.getFrameTree', 'WebMCP.enable', 'WebMCP.disable']);
  assert.equal(WEBMCP_INVOCATION_EXPOSED_R6A, false);
  assert.equal(WEBMCP_DISCOVERY_CDP_METHODS.includes('WebMCP.invokeTool'), false);
});
