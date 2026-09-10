import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createFastControlMcpStatelessRouter,
  FAST_CONTROL_MCP_MAX_REQUEST_BYTES,
} from '../src/fast-control-mcp-stateless-router.mjs';
import {
  FAST_CONTROL_MCP_PROTOCOL_REVISION,
  FAST_CONTROL_MCP_LIST_TTL_MS,
  FAST_CONTROL_MCP_CACHE_SCOPE,
} from '../src/fast-control-mcp-adapter.mjs';

const meta = () => ({
  'io.modelcontextprotocol/protocolVersion': FAST_CONTROL_MCP_PROTOCOL_REVISION,
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'test-chat', version: '1.0.0' },
});

function headers(method, name = null) {
  const out = {
    'MCP-Protocol-Version': FAST_CONTROL_MCP_PROTOCOL_REVISION,
    'Mcp-Method': method,
  };
  if (name) out['Mcp-Name'] = name;
  return out;
}

function harness() {
  const calls = [];
  const adapter = {
    listTools() {
      return {
        tools: [{ name: 'dev_query', inputSchema: { type: 'object' } }],
        ttlMs: FAST_CONTROL_MCP_LIST_TTL_MS,
        cacheScope: FAST_CONTROL_MCP_CACHE_SCOPE,
        catalog_revision: 'mcpcat:test',
        authority_effect: false,
      };
    },
    async callTool(name, args) {
      calls.push({ name, args: structuredClone(args) });
      return { content: [], structuredContent: { ok: true }, isError: false, authority_effect: false };
    },
  };
  return { router: createFastControlMcpStatelessRouter(adapter), calls };
}

test('modern tools/call is one self-contained request with no discovery or session prerequisite', async () => {
  const { router, calls } = harness();
  const result = await router.handle({
    headers: headers('tools/call', 'dev_query'),
    request: {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'dev_query', arguments: { query: 'shell failure' }, _meta: meta() },
    },
  });
  assert.equal(result.id, 1);
  assert.equal(result.result.structuredContent.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { name: 'dev_query', args: { query: 'shell failure' } });
  assert.equal(result.result.authority_effect, false);
});

test('server discover advertises only stateless tools capability with cache hints', async () => {
  const { router } = harness();
  const result = await router.handle({
    headers: headers('server/discover'),
    request: { jsonrpc: '2.0', id: 'discover-1', method: 'server/discover', params: { _meta: meta() } },
  });
  assert.deepEqual(result.result.supportedVersions, [FAST_CONTROL_MCP_PROTOCOL_REVISION]);
  assert.deepEqual(result.result.capabilities, { tools: {} });
  assert.equal(result.result.ttlMs, FAST_CONTROL_MCP_LIST_TTL_MS);
  assert.equal(result.result.cacheScope, FAST_CONTROL_MCP_CACHE_SCOPE);
  assert.match(result.result.instructions, /Prefer dev_query/);
  assert.equal(result.result.authority_effect, false);
});

test('tools list preserves deterministic adapter catalog cache boundary', async () => {
  const { router } = harness();
  const result = await router.handle({
    headers: headers('tools/list'),
    request: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: meta() } },
  });
  assert.equal(result.result.catalogRevision, 'mcpcat:test');
  assert.equal(result.result.ttlMs, FAST_CONTROL_MCP_LIST_TTL_MS);
  assert.equal(result.result.cacheScope, 'private');
  assert.equal(result.result.tools[0].name, 'dev_query');
});

test('protocol metadata and routable headers must agree before tool dispatch', async () => {
  const { router, calls } = harness();
  await assert.rejects(() => router.handle({
    headers: headers('tools/list'),
    request: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'dev_query', arguments: {}, _meta: meta() } },
  }), /method_header_mismatch/);
  await assert.rejects(() => router.handle({
    headers: headers('tools/call', 'context_get'),
    request: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'dev_query', arguments: {}, _meta: meta() } },
  }), /name_header_mismatch/);
  const badMeta = meta();
  badMeta['io.modelcontextprotocol/protocolVersion'] = '2025-11-25';
  await assert.rejects(() => router.handle({
    headers: headers('tools/list'),
    request: { jsonrpc: '2.0', id: 3, method: 'tools/list', params: { _meta: badMeta } },
  }), /protocol_unsupported/);
  assert.equal(calls.length, 0);
});

test('modern request size is bounded before adapter work', async () => {
  const { router, calls } = harness();
  const huge = 'x'.repeat(FAST_CONTROL_MCP_MAX_REQUEST_BYTES + 1);
  await assert.rejects(() => router.handle({
    headers: headers('tools/call', 'dev_query'),
    request: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'dev_query', arguments: { query: huge }, _meta: meta() } },
  }), /request_too_large/);
  assert.equal(calls.length, 0);
});

test('router owns no listener, protocol session, subscription, scheduler, lease, or Browser authority', () => {
  const { router } = harness();
  const snap = router.snapshot();
  assert.equal(snap.session_state, false);
  assert.equal(snap.listener_owned, false);
  assert.equal(snap.subscriptions, false);
  assert.equal(snap.tasks, false);
  assert.equal(snap.second_scheduler, false);
  assert.equal(snap.command_leasing_authority, false);
  assert.equal(snap.browser_execution_authority, false);
  assert.equal(snap.authority_effect, false);
});
