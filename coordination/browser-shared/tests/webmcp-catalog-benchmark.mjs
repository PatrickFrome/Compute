import assert from 'node:assert/strict';
import { webMcpEnvelopeFromCdpTools } from '../webmcp-tools-v1.mjs';
import { compileWebMcpCatalog } from '../webmcp-catalog-v1.mjs';

function tool(index) {
  const properties = {};
  for (let i = 0; i < 24; i += 1) {
    properties[`field_${index}_${i}`] = {
      type: 'string',
      description: `Field ${i} ${'x'.repeat(160)}`,
      enum: [`a_${i}`, `b_${i}`, `c_${i}`]
    };
  }
  return {
    name: `structured_tool_${index}`,
    description: `Structured browser tool ${index}. ${'d'.repeat(900)}`,
    inputSchema: { type: 'object', properties, required: Object.keys(properties).slice(0, 12), additionalProperties: false },
    annotations: { readOnly: index % 2 === 0, consequential: index % 5 === 0 },
    frameId: 'frame-main'
  };
}

const rows = [];
for (const count of [8, 32, 128]) {
  const envelope = webMcpEnvelopeFromCdpTools(Array.from({ length: count }, (_, index) => tool(index)), {
    targetId: 'target_benchmark', contextId: 'default', conversationEpoch: 1,
    documentEpoch: `doc_${count}`, mainFrameId: 'frame-main', capturedAt: '2026-08-28T14:30:00.000Z'
  });
  const catalog = compileWebMcpCatalog(envelope);
  const fullBytes = Buffer.byteLength(JSON.stringify(envelope));
  const catalogBytes = Buffer.byteLength(JSON.stringify(catalog));
  const reduction = 1 - (catalogBytes / fullBytes);
  assert.ok(reduction > 0.70, `catalog_reduction_too_small:${count}:${reduction}`);
  rows.push({ tool_count: count, full_bytes: fullBytes, catalog_bytes: catalogBytes, reduction_ratio: Number(reduction.toFixed(4)) });
}

console.log(JSON.stringify({
  schema: 'metaengine.a2-browser-operator.r6b-catalog-benchmark.v1',
  ok: true,
  rows,
  full_schema_embedded: false,
  provider_model_used: false,
  authority_effect: false
}));
