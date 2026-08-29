import { webMcpEnvelopeFromCdpTools } from '../webmcp-tools-v1.mjs';
import { compileWebMcpCatalog } from '../webmcp-catalog-v1.mjs';
import { compileWebMcpRoutingIndex } from '../webmcp-routing-index-v1.mjs';
import { compileWebMcpToolSearchHandle, searchWebMcpRoutingIndex } from '../webmcp-tool-search-v1.mjs';

function rawTool(index) {
  const properties = {};
  for (let i = 0; i < 24; i += 1) {
    properties[`parameter_${index}_${i}`] = {
      type: 'string',
      description: `field:${'x'.repeat(180)}`,
      enum: [`value_${i}_a`, `value_${i}_b`]
    };
  }
  const relevant = index % 7 === 0;
  return {
    name: relevant ? `search_financial_report_${index}` : `generic_tool_${index}`,
    description: relevant ? `Search financial reports and revenue records for company ${index}. ${'d'.repeat(900)}` : `Generic unrelated capability ${index}. ${'d'.repeat(900)}`,
    inputSchema: {
      type: 'object', properties,
      required: Object.keys(properties).slice(0, 12), additionalProperties: false
    },
    annotations: { readOnly: index % 2 === 0, consequential: index % 3 === 0, untrustedContent: true },
    frameId: 'frame-main'
  };
}

function row(toolCount) {
  const envelope = webMcpEnvelopeFromCdpTools(
    Array.from({ length: toolCount }, (_, index) => rawTool(index)),
    {
      targetId: 'target_search_benchmark', contextId: 'default', conversationEpoch: 12,
      documentEpoch: 'doc_search_benchmark', mainFrameId: 'frame-main', capturedAt: '2026-08-28T16:00:00.000Z'
    }
  );
  const catalog = compileWebMcpCatalog(envelope);
  const index = compileWebMcpRoutingIndex(catalog);
  const handle = compileWebMcpToolSearchHandle(catalog);
  const result = searchWebMcpRoutingIndex(index, 'search financial report revenue');
  const fullBytes = Buffer.byteLength(JSON.stringify(envelope));
  const catalogBytes = Buffer.byteLength(JSON.stringify(catalog));
  const indexBytes = Buffer.byteLength(JSON.stringify(index));
  const handleBytes = Buffer.byteLength(JSON.stringify(handle));
  const resultBytes = Buffer.byteLength(JSON.stringify(result));
  const firstTurnBytes = handleBytes;
  const searchedContextBytes = handleBytes + resultBytes;
  return {
    tool_count: toolCount,
    full_bytes: fullBytes,
    catalog_bytes: catalogBytes,
    routing_index_bytes: indexBytes,
    search_handle_bytes: handleBytes,
    search_result_bytes: resultBytes,
    searched_context_bytes: searchedContextBytes,
    result_count: result.result_count,
    first_turn_reduction_vs_routing_index: Number((1 - firstTurnBytes / indexBytes).toFixed(4)),
    searched_reduction_vs_routing_index: Number((1 - searchedContextBytes / indexBytes).toFixed(4)),
    searched_reduction_vs_full: Number((1 - searchedContextBytes / fullBytes).toFixed(4))
  };
}

const rows = [8, 32, 128].map(row);
const worst = rows.at(-1);
if (worst.search_handle_bytes >= 2048) throw new Error('r6c_tool_search_handle_too_large');
if (worst.search_result_bytes >= 12 * 1024) throw new Error('r6c_tool_search_result_too_large');
if (worst.searched_reduction_vs_routing_index < 0.85) throw new Error('r6c_tool_search_reduction_insufficient');
if (worst.searched_reduction_vs_full < 0.99) throw new Error('r6c_tool_search_full_reduction_insufficient');
console.log(JSON.stringify({
  schema: 'metaengine.a2-browser-operator.r6c-tool-search-benchmark.v1',
  ok: true,
  rows,
  max_results: 5,
  query_persisted: false,
  full_tool_list_embedded: false,
  full_schema_embedded: false,
  annotations_embedded: false,
  provider_model_used: false,
  authority_effect: false
}));
