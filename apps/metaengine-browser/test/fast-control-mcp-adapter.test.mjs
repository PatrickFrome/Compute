import assert from 'node:assert/strict';
import test from 'node:test';
import { FastControlGatewayCore } from '../src/fast-control-gateway-core.mjs';
import { CONTROL_ACTION_MANIFEST_REVISION } from '../src/control-actions-manifest.mjs';
import {
  FAST_CONTROL_MCP_TOOLS,
  FAST_CONTROL_MCP_PROTOCOL_REVISION,
  FAST_CONTROL_MCP_CATALOG_REVISION,
  FAST_CONTROL_MCP_LIST_TTL_MS,
  createFastControlMcpAdapter,
} from '../src/fast-control-mcp-adapter.mjs';

function adapter() {
  const gateway = new FastControlGatewayCore({
    contextGet: async () => ({ schema: 'metaengine.fast-context.v1', revision: 'ctx:1', authority_effect: false }),
    devQuery: async ({ query }) => ({ schema: 'metaengine.chat-development-query.v1', query, revision: 'dev:1', hits: [], authority_effect: false }),
    issueBatch: async () => ({ accepted: true, authority_effect: false }),
    resultDelta: async ({ after_seq }) => ({ next_seq: after_seq, results: [], authority_effect: false }),
    issueEmergency: async () => ({ accepted: true, authority_effect: false }),
  });
  return createFastControlMcpAdapter(gateway);
}

test('MCP adapter lists exactly the five gateway tools with strict top-level schemas', () => {
  const mcp = adapter();
  const listed = mcp.listTools();
  assert.deepEqual(listed.tools.map((row) => row.name), ['context_get', 'dev_query', 'run_submit', 'run_status', 'emergency_stop']);
  assert.equal(listed.capability_revision, CONTROL_ACTION_MANIFEST_REVISION);
  for (const tool of FAST_CONTROL_MCP_TOOLS) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
  assert.equal(listed.authority_effect, false);
});

test('MCP 2026 catalog is deterministic, privately cacheable, and marks short read tools read-only', () => {
  const mcp = adapter();
  const first = mcp.listTools();
  const second = mcp.listTools();
  assert.equal(first.protocol_revision, FAST_CONTROL_MCP_PROTOCOL_REVISION);
  assert.equal(first.protocol_revision, '2026-07-28');
  assert.equal(first.catalog_revision, FAST_CONTROL_MCP_CATALOG_REVISION);
  assert.equal(second.catalog_revision, first.catalog_revision);
  assert.equal(first.ttlMs, FAST_CONTROL_MCP_LIST_TTL_MS);
  assert.ok(first.ttlMs >= 60_000);
  assert.equal(first.cacheScope, 'private');
  assert.equal(first.deterministic_order, true);
  for (const name of ['context_get', 'dev_query', 'run_status']) {
    const tool = first.tools.find((row) => row.name === name);
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.openWorldHint, false);
    assert.equal(tool.execution.taskSupport, 'forbidden');
  }
  assert.equal(first.tools.find((row) => row.name === 'run_submit').annotations.idempotentHint, true);
  assert.equal(first.tools.find((row) => row.name === 'emergency_stop').annotations.idempotentHint, true);
});

test('dev_query MCP schema is bounded and exposes only development evidence domains', () => {
  const tool = FAST_CONTROL_MCP_TOOLS.find((row) => row.name === 'dev_query');
  assert.equal(tool.inputSchema.properties.query.maxLength, 1024);
  assert.equal(tool.inputSchema.properties.limit.maximum, 12);
  assert.equal(tool.inputSchema.properties.max_bytes.maximum, 8192);
  assert.deepEqual(tool.inputSchema.properties.kinds.items.enum, ['SOURCE', 'CI', 'CHECKPOINT', 'CHANGE', 'HOTSPOT', 'BLOCKER', 'NEXT_ACTION', 'RUNTIME', 'DATABASE']);
  assert.equal(tool.inputSchema.additionalProperties, false);
});

test('run_submit MCP schema pins the canonical capability revision and bounded plan size', () => {
  const tool = FAST_CONTROL_MCP_TOOLS.find((row) => row.name === 'run_submit');
  assert.equal(tool.inputSchema.properties.capability_revision.const, CONTROL_ACTION_MANIFEST_REVISION);
  assert.equal(tool.inputSchema.properties.steps.maxItems, 64);
  assert.equal(tool.inputSchema.properties.steps.items.additionalProperties, false);
});

test('emergency MCP schema exposes only DISARM and OFF', () => {
  const tool = FAST_CONTROL_MCP_TOOLS.find((row) => row.name === 'emergency_stop');
  assert.deepEqual(tool.inputSchema.properties.kind.enum, ['DISARM', 'OFF']);
  assert.equal(tool.inputSchema.additionalProperties, false);
});

test('tool call returns compact structuredContent and no text/raw execution channel', async () => {
  const mcp = adapter();
  const result = await mcp.callTool('dev_query', { query: 'boundedNavigation', limit: 4 });
  assert.deepEqual(result.content, []);
  assert.equal(result.structuredContent.tool, 'dev_query');
  assert.equal(result.structuredContent.indexed_read_only, true);
  assert.equal(result.raw_sql, false);
  assert.equal(result.arbitrary_eval, false);
  assert.equal(result.raw_cdp_passthrough, false);
  assert.equal(result.transport_delivery_is_authority, false);
  assert.equal(result.authority_effect, false);
});

test('unknown MCP tool fails closed before gateway dispatch', async () => {
  const mcp = adapter();
  await assert.rejects(() => mcp.callTool('sql', {}), /mcp_tool_unknown/);
});
