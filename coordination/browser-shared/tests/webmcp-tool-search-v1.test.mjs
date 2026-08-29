import assert from 'node:assert/strict';
import test from 'node:test';
import { webMcpEnvelopeFromCdpTools } from '../webmcp-tools-v1.mjs';
import { compileWebMcpCatalog } from '../webmcp-catalog-v1.mjs';
import { compileWebMcpRoutingIndex } from '../webmcp-routing-index-v1.mjs';
import { assertWebMcpToolSearchResult, compileWebMcpToolSearchHandle, searchWebMcpRoutingIndex, WEBMCP_TOOL_SEARCH_LIMITS } from '../webmcp-tool-search-v1.mjs';

function rawTool(index, { name = null, description = null } = {}) {
  const properties = {};
  for (let i = 0; i < 20; i += 1) {
    properties[`field_${index}_${i}`] = { type: 'string', description: `field ${i} ${'x'.repeat(120)}` };
  }
  return {
    name: name || `tool_${String(index).padStart(3, '0')}`,
    description: description || `Generic capability ${index} ${'d'.repeat(200)}`,
    inputSchema: { type: 'object', properties, required: Object.keys(properties).slice(0, 6), additionalProperties: false },
    annotations: { readOnly: index % 2 === 0, consequential: index % 3 === 0 },
    frameId: 'frame-main'
  };
}

function catalog(tools) {
  return compileWebMcpCatalog(webMcpEnvelopeFromCdpTools(tools, {
    targetId: 'target_search', contextId: 'default', conversationEpoch: 7,
    documentEpoch: 'doc_search', mainFrameId: 'frame-main', capturedAt: '2026-08-28T16:00:00.000Z'
  }));
}

test('search handle exposes no tool definitions and remains tiny regardless of tool count', () => {
  const source = catalog(Array.from({ length: 128 }, (_, index) => rawTool(index)));
  const handle = compileWebMcpToolSearchHandle(source);
  assert.equal(handle.status, 'SEARCH_REQUIRED');
  assert.equal(handle.tool_count, 128);
  assert.equal(handle.search_method, 'planning.tools.search');
  assert.equal(handle.full_tool_list_embedded, false);
  assert.equal(handle.full_schema_embedded, false);
  assert.equal(handle.annotations_embedded, false);
  assert.equal(handle.authority_effect, false);
  assert.ok(Buffer.byteLength(JSON.stringify(handle)) < 2048);
  const serialized = JSON.stringify(handle);
  assert.equal(serialized.includes('tool_000'), false);
  assert.equal(serialized.includes('input_schema'), false);
});

test('deterministic lexical search returns only relevant top matches with no full schema or annotations', () => {
  const source = catalog([
    rawTool(0, { name: 'search_flights', description: 'Search flight schedules by origin and destination.' }),
    rawTool(1, { name: 'book_flight', description: 'Book a selected airline itinerary.' }),
    rawTool(2, { name: 'search_hotels', description: 'Search hotels by city and date.' }),
    ...Array.from({ length: 20 }, (_, index) => rawTool(index + 3))
  ]);
  const index = compileWebMcpRoutingIndex(source);
  const first = assertWebMcpToolSearchResult(searchWebMcpRoutingIndex(index, 'find flight schedule'));
  const second = searchWebMcpRoutingIndex(index, 'find flight schedule');
  assert.deepEqual(first, second);
  assert.equal(first.status, 'MATCHES');
  assert.ok(first.result_count >= 1 && first.result_count <= WEBMCP_TOOL_SEARCH_LIMITS.maxResults);
  assert.equal(first.results[0].name, 'search_flights');
  assert.ok(first.results[0].lexical_score > 0);
  assert.equal(first.result_bytes, Buffer.byteLength(JSON.stringify(first)));
  assert.ok(first.result_bytes <= WEBMCP_TOOL_SEARCH_LIMITS.maxResultBytes);
  const serialized = JSON.stringify(first);
  assert.equal(serialized.includes('"input_schema":'), false);
  assert.equal(serialized.includes('"annotations":'), false);
  assert.equal(serialized.includes('field_0_0'), false);
});

test('query normalization is bounded and control characters do not become search structure', () => {
  const source = catalog([
    rawTool(0, { name: 'user_search', description: 'Search users by account name.' }),
    rawTool(1, { name: 'delete_user', description: 'Delete a user account.' })
  ]);
  const index = compileWebMcpRoutingIndex(source);
  const result = searchWebMcpRoutingIndex(index, '  USER\u0000\n search  ');
  assert.equal(result.status, 'MATCHES');
  assert.equal(result.results[0].name, 'user_search');
  assert.throws(() => searchWebMcpRoutingIndex(index, ''), /webmcp_tool_search_query_invalid/);
  assert.throws(() => searchWebMcpRoutingIndex(index, 'x'.repeat(WEBMCP_TOOL_SEARCH_LIMITS.maxQueryChars + 1)), /webmcp_tool_search_query_invalid/);
});

test('no lexical match returns typed NO_MATCH instead of guessing a tool', () => {
  const source = catalog([
    rawTool(0, { name: 'search_flights', description: 'Search flight schedules.' }),
    rawTool(1, { name: 'search_hotels', description: 'Search hotels.' })
  ]);
  const result = searchWebMcpRoutingIndex(compileWebMcpRoutingIndex(source), 'quantum compiler optimization');
  assert.equal(result.status, 'NO_MATCH');
  assert.equal(result.result_count, 0);
  assert.deepEqual(result.results, []);
  assert.equal(result.semantic_fallback_available, true);
});

test('128-tool search returns at most five hints and stays far below routing-index size', () => {
  const tools = Array.from({ length: 128 }, (_, index) => rawTool(index, {
    name: index % 8 === 0 ? `search_report_${index}` : `tool_${index}`,
    description: index % 8 === 0 ? `Search financial reports ${index}` : `Generic unrelated capability ${index}`
  }));
  const source = catalog(tools);
  const index = compileWebMcpRoutingIndex(source);
  const result = searchWebMcpRoutingIndex(index, 'search financial report');
  assert.ok(result.result_count <= 5);
  assert.ok(result.result_bytes < index.routing_index_bytes * 0.25);
  assert.equal(result.full_tool_list_embedded, false);
  assert.equal(result.fresh_toolset_used, true);
});
