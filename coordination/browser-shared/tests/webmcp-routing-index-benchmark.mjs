import { webMcpEnvelopeFromCdpTools } from '../webmcp-tools-v1.mjs';
import { compileWebMcpCatalog } from '../webmcp-catalog-v1.mjs';
import { compileWebMcpRoutingIndex } from '../webmcp-routing-index-v1.mjs';

function rawTool(index) {
  const properties = {};
  for (let i = 0; i < 24; i += 1) {
    properties[`parameter_${index}_${i}`] = {
      type: 'string',
      description: `field:${'x'.repeat(180)}`,
      enum: [`value_${i}_a`, `value_${i}_b`]
    };
  }
  return {
    name: `tool_${String(index).padStart(3, '0')}_${'n'.repeat(80)}`,
    description: `Tool ${index} ${'d'.repeat(1024)}`,
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
      targetId: 'target_route_benchmark', contextId: 'default', conversationEpoch: 11,
      documentEpoch: 'doc_route_benchmark', mainFrameId: 'frame-main', capturedAt: '2026-08-28T15:00:00.000Z'
    }
  );
  const catalog = compileWebMcpCatalog(envelope);
  const index = compileWebMcpRoutingIndex(catalog);
  const fullBytes = Buffer.byteLength(JSON.stringify(envelope));
  const catalogBytes = Buffer.byteLength(JSON.stringify(catalog));
  const indexBytes = Buffer.byteLength(JSON.stringify(index));
  return {
    tool_count: toolCount,
    full_bytes: fullBytes,
    catalog_bytes: catalogBytes,
    routing_index_bytes: indexBytes,
    reduction_vs_full: Number((1 - indexBytes / fullBytes).toFixed(4)),
    reduction_vs_catalog: Number((1 - indexBytes / catalogBytes).toFixed(4))
  };
}

const rows = [8, 32, 128].map(row);
const worst = rows.at(-1);
if (!rows.every((value) => value.routing_index_bytes < value.catalog_bytes && value.routing_index_bytes < value.full_bytes)) {
  throw new Error('r6c_routing_index_not_smaller');
}
if (worst.routing_index_bytes > 48 * 1024) throw new Error('r6c_routing_index_budget_exceeded');
if (worst.reduction_vs_catalog < 0.45) throw new Error('r6c_routing_index_catalog_reduction_insufficient');
console.log(JSON.stringify({
  schema: 'metaengine.a2-browser-operator.r6c-routing-index-benchmark.v1',
  ok: true,
  rows,
  full_schema_embedded: false,
  annotations_embedded: false,
  provider_model_used: false,
  authority_effect: false
}));
