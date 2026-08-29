import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertWebMcpEnvelope,
  unsupportedWebMcpEnvelope,
  webMcpEnvelopeFromCdpTools
} from '../webmcp-tools-v1.mjs';

const options = {
  targetId: 'target_1',
  contextId: 'default',
  conversationEpoch: 4,
  documentEpoch: 'doc_1234',
  mainFrameId: 'engine-main-frame',
  capturedAt: '2026-08-28T14:00:00.000Z'
};

function tool(overrides = {}) {
  return {
    name: 'search_products',
    description: 'Search products by query',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query']
    },
    annotations: {
      readOnly: true,
      untrustedContent: true,
      consequential: false,
      autosubmit: false
    },
    frameId: 'engine-main-frame',
    backendNodeId: 98123,
    registrationStackTrace: { callFrames: [{ functionName: 'secret', url: 'https://page.example/app.js' }] },
    ...overrides
  };
}

test('WebMCP tools normalize into tainted backend-neutral discovery records', () => {
  const envelope = webMcpEnvelopeFromCdpTools([tool()], options);
  assert.equal(envelope.status, 'SUPPORTED');
  assert.equal(envelope.tool_count, 1);
  assert.equal(envelope.authority_effect, false);
  assert.equal(envelope.actuation_eligible, false);
  assert.equal(envelope.tool_invocation_exposed, false);
  const item = envelope.tools[0];
  assert.match(item.tool_ref, /^tool_[0-9a-f]{16}$/);
  assert.equal(item.frame_scope, 'MAIN');
  assert.deepEqual(item.annotations, {
    read_only_hint: true,
    untrusted_content_hint: true,
    consequential_hint: false,
    autosubmit_hint: false
  });
  const serialized = JSON.stringify(envelope);
  for (const forbidden of ['engine-main-frame', 'backendNodeId', '98123', 'registrationStackTrace', 'callFrames', 'app.js']) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.equal(assertWebMcpEnvelope(envelope), envelope);
});

test('opaque tool refs rotate across document identity and preserve subframe scope only as a label', () => {
  const main = webMcpEnvelopeFromCdpTools([tool()], options).tools[0];
  const changedDocument = webMcpEnvelopeFromCdpTools([tool()], { ...options, documentEpoch: 'doc_5678' }).tools[0];
  const subframe = webMcpEnvelopeFromCdpTools([tool({ frameId: 'engine-child-frame' })], options).tools[0];
  assert.notEqual(main.tool_ref, changedDocument.tool_ref);
  assert.notEqual(main.tool_ref, subframe.tool_ref);
  assert.equal(subframe.frame_scope, 'SUBFRAME');
  assert.equal(JSON.stringify(subframe).includes('engine-child-frame'), false);
});

test('duplicate tool identity and over-limit descriptor inputs fail closed', () => {
  assert.throws(() => webMcpEnvelopeFromCdpTools([tool(), tool()], options), /webmcp_tool_duplicate/);
  assert.throws(() => webMcpEnvelopeFromCdpTools([tool({ name: 'x'.repeat(257) })], options), /webmcp_tool_name_invalid/);
  assert.throws(() => webMcpEnvelopeFromCdpTools([tool({ description: 'x'.repeat(4097) })], options), /webmcp_tool_description_invalid/);
  assert.throws(() => webMcpEnvelopeFromCdpTools(Array.from({ length: 129 }, (_, index) => tool({ name: `tool_${index}` })), options), /webmcp_tools_too_many/);
});

test('malformed and structurally adversarial input schemas are rejected rather than truncated', () => {
  assert.throws(() => webMcpEnvelopeFromCdpTools([tool({ inputSchema: [] })], options), /webmcp_input_schema_invalid/);
  const tooWide = {};
  for (let index = 0; index < 129; index += 1) tooWide[`key_${index}`] = { type: 'string' };
  assert.throws(() => webMcpEnvelopeFromCdpTools([tool({ inputSchema: tooWide })], options), /webmcp_input_schema_object_too_large/);
  let deep = { leaf: true };
  for (let index = 0; index < 14; index += 1) deep = { nested: deep };
  assert.throws(() => webMcpEnvelopeFromCdpTools([tool({ inputSchema: deep })], options), /webmcp_input_schema_too_complex/);
});

test('unsupported capability is typed, empty, and preserves the same non-authority boundary', () => {
  const envelope = unsupportedWebMcpEnvelope({
    targetId: options.targetId,
    contextId: options.contextId,
    conversationEpoch: options.conversationEpoch,
    documentEpoch: options.documentEpoch,
    capturedAt: options.capturedAt
  });
  assert.equal(envelope.status, 'UNSUPPORTED');
  assert.equal(envelope.tool_count, 0);
  assert.deepEqual(envelope.tools, []);
  assert.equal(envelope.authority_effect, false);
  assert.equal(envelope.actuation_eligible, false);
  assert.equal(assertWebMcpEnvelope(envelope), envelope);
});
