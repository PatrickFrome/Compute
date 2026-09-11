import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createFastControlMcpStatelessRouter,
  FAST_CONTROL_MCP_MAX_REQUEST_BYTES,
} from '../src/fast-control-mcp-stateless-router.mjs';
import { FAST_CONTROL_MCP_PROTOCOL_REVISION } from '../src/fast-control-mcp-adapter.mjs';

const meta = () => ({
  'io.modelcontextprotocol/protocolVersion': FAST_CONTROL_MCP_PROTOCOL_REVISION,
  'io.modelcontextprotocol/clientCapabilities': {},
});

const headers = (method, name = null) => ({
  'MCP-Protocol-Version': FAST_CONTROL_MCP_PROTOCOL_REVISION,
  'Mcp-Method': method,
  ...(name ? { 'Mcp-Name': name } : {}),
});

const request = () => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: {
    name: 'dev_query',
    arguments: { query: 'needle' },
    _meta: meta(),
  },
});

function harness() {
  const calls = [];
  return {
    calls,
    router: createFastControlMcpStatelessRouter({
      listTools() {
        return { tools: [], ttlMs: 1, cacheScope: 'private', catalog_revision: 'x' };
      },
      async callTool(name, args) {
        calls.push({ name, args });
        return { structuredContent: { ok: true }, authority_effect: false };
      },
    }),
  };
}

test('measured transport bytes gate request without reserializing envelope', async () => {
  const { router, calls } = harness();
  const req = request();
  req.extra = req;
  const result = await router.handle({
    headers: headers('tools/call', 'dev_query'),
    request: req,
    transport_body_bytes: 256,
  });
  assert.equal(result.result.structuredContent.ok, true);
  assert.equal(calls.length, 1);
});

test('measured oversize request fails before adapter dispatch', async () => {
  const { router, calls } = harness();
  await assert.rejects(() => router.handle({
    headers: headers('tools/call', 'dev_query'),
    request: request(),
    transport_body_bytes: FAST_CONTROL_MCP_MAX_REQUEST_BYTES + 1,
  }), /request_too_large/);
  assert.equal(calls.length, 0);
});

test('invalid measured byte count fails closed', async () => {
  const { router } = harness();
  for (const value of [0, -1, 1.5, '123']) {
    await assert.rejects(() => router.handle({
      headers: headers('tools/call', 'dev_query'),
      request: request(),
      transport_body_bytes: value,
    }), /transport_body_bytes_invalid/);
  }
});

test('legacy callers retain serialized request-size fallback', async () => {
  const { router, calls } = harness();
  const req = request();
  req.params.arguments.query = 'x'.repeat(FAST_CONTROL_MCP_MAX_REQUEST_BYTES + 1);
  await assert.rejects(() => router.handle({
    headers: headers('tools/call', 'dev_query'),
    request: req,
  }), /request_too_large/);
  assert.equal(calls.length, 0);
});

test('routing headers remain case-insensitive and fixed-projection snapshot is visible', async () => {
  const { router } = harness();
  const result = await router.handle({
    headers: {
      'mcp-protocol-version': FAST_CONTROL_MCP_PROTOCOL_REVISION,
      'MCP-METHOD': 'tools/call',
      'MCP-NAME': 'dev_query',
      'X-Ignored': 'value',
    },
    request: request(),
    transport_body_bytes: 256,
  });
  assert.equal(result.result.structuredContent.ok, true);
  const snap = router.snapshot();
  assert.equal(snap.transport_body_bytes_supported, true);
  assert.equal(snap.routing_header_projection, 'FIXED_ONE_PASS');
});
