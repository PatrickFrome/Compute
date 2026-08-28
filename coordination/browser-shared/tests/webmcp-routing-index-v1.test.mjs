import assert from 'node:assert/strict';
import test from 'node:test';
import { webMcpEnvelopeFromCdpTools, unsupportedWebMcpEnvelope } from '../webmcp-tools-v1.mjs';
import { compileWebMcpCatalog } from '../webmcp-catalog-v1.mjs';
import { assertWebMcpRoutingIndex, compileWebMcpRoutingIndex, WEBMCP_ROUTING_INDEX_LIMITS } from '../webmcp-routing-index-v1.mjs';

function rawTool(index, { descriptionSize = 1024, propertyCount = 24 } = {}) {
  const properties = {};
  for (let i = 0; i < propertyCount; i += 1) {
    properties[`parameter_${index}_${i}`] = {
      type: 'string',
      description: `field:${'x'.repeat(180)}`,
      enum: [`value_${i}_a`, `value_${i}_b`]
    };
  }
  return {
    name: `tool_${String(index).padStart(3, '0')}_${'n'.repeat(80)}`,
    description: `Tool ${index} ${'d'.repeat(descriptionSize)}`,
    inputSchema: {
      type: 'object',
      properties,
      required: Object.keys(properties).slice(0, Math.floor(propertyCount / 2)),
      additionalProperties: false
    },
    annotations: { readOnly: index % 2 === 0, consequential: index % 3 === 0, untrustedContent: true },
    frameId: 'frame-main'
  };
}

function envelope({ count = 8, documentEpoch = 'doc_route' } = {}) {
  return webMcpEnvelopeFromCdpTools(
    Array.from({ length: count }, (_, index) => rawTool(index)),
    {
      targetId: 'target_route', contextId: 'default', conversationEpoch: 9,
      documentEpoch, mainFrameId: 'frame-main', capturedAt: '2026-08-28T15:00:00.000Z'
    }
  );
}

function resealCatalogBytes(catalog) {
  let bytes = 0;
  for (let pass = 0; pass < 8; pass += 1) {
    catalog.catalog_bytes = bytes;
    const measured = Buffer.byteLength(JSON.stringify(catalog));
    if (measured === bytes) return catalog;
    bytes = measured;
  }
  catalog.catalog_bytes = bytes;
  if (Buffer.byteLength(JSON.stringify(catalog)) !== bytes) throw new Error('test_catalog_size_unstable');
  return catalog;
}

test('routing index keeps all 128 tool refs under 48 KiB while removing rich metadata', () => {
  const source = envelope({ count: 128 });
  const catalog = compileWebMcpCatalog(source);
  const index = assertWebMcpRoutingIndex(compileWebMcpRoutingIndex(catalog));
  assert.equal(index.status, 'SUPPORTED');
  assert.equal(index.tool_count, 128);
  assert.ok(index.routing_index_bytes <= WEBMCP_ROUTING_INDEX_LIMITS.maxRoutingIndexBytes);
  assert.ok(index.routing_index_bytes < catalog.catalog_bytes * 0.6);
  const serialized = JSON.stringify(index);
  assert.equal(serialized.includes('"input_schema":'), false);
  assert.equal(serialized.includes('"annotations":'), false);
  assert.equal(serialized.includes('"schema_summary":'), false);
  assert.equal(serialized.includes('parameter_0_0'), false);
  assert.equal(index.tools.every((tool) => tool.tainted_page_data === true), true);
});

test('routing index is deterministic, explicitly lossy, and byte accounting covers the final JSON', () => {
  const catalog = compileWebMcpCatalog(envelope({ count: 12 }));
  const first = compileWebMcpRoutingIndex(catalog);
  const second = compileWebMcpRoutingIndex(catalog);
  assert.deepEqual(first, second);
  assert.equal(first.lossy_index, true);
  assert.equal(first.selection_only, true);
  assert.equal(first.fresh_description_required, true);
  assert.equal(first.semantic_fallback_available, true);
  assert.equal(first.full_schema_embedded, false);
  assert.equal(first.annotations_embedded, false);
  assert.equal(first.tools[0].description_hint.length, WEBMCP_ROUTING_INDEX_LIMITS.maxDescriptionHint);
  assert.equal(first.tools[0].preview_lossy, true);
  assert.equal(first.routing_index_bytes, Buffer.byteLength(JSON.stringify(first)));
});

test('routing index preserves document-bound tool identity but never authority', () => {
  const first = compileWebMcpRoutingIndex(compileWebMcpCatalog(envelope({ count: 2, documentEpoch: 'doc_a' })));
  const second = compileWebMcpRoutingIndex(compileWebMcpCatalog(envelope({ count: 2, documentEpoch: 'doc_b' })));
  assert.notEqual(first.document_epoch, second.document_epoch);
  assert.notEqual(first.tools[0].tool_ref, second.tools[0].tool_ref);
  assert.equal(first.authority_effect, false);
  assert.equal(first.actuation_eligible, false);
  assert.equal(first.tool_invocation_exposed, false);
});

test('unsupported catalog compiles to a typed empty routing index', () => {
  const unsupported = unsupportedWebMcpEnvelope({
    targetId: 'target_route', contextId: 'default', conversationEpoch: 9,
    documentEpoch: 'doc_u', capturedAt: '2026-08-28T15:00:00.000Z', reason: 'CDP_WEBMCP_UNAVAILABLE'
  });
  const index = assertWebMcpRoutingIndex(compileWebMcpRoutingIndex(compileWebMcpCatalog(unsupported)));
  assert.equal(index.status, 'UNSUPPORTED');
  assert.equal(index.tool_count, 0);
  assert.deepEqual(index.tools, []);
});

test('malformed rich metadata fails closed instead of entering planner context', () => {
  const catalog = structuredClone(compileWebMcpCatalog(envelope({ count: 1 })));
  catalog.tools[0].schema_summary.schema_fingerprint = 'schema_not_valid';
  resealCatalogBytes(catalog);
  assert.throws(() => compileWebMcpRoutingIndex(catalog), /webmcp_routing_schema_fingerprint_invalid/);
});
