import assert from 'node:assert/strict';
import test from 'node:test';
import { webMcpEnvelopeFromCdpTools, unsupportedWebMcpEnvelope } from '../webmcp-tools-v1.mjs';
import { assertWebMcpCatalog, compileWebMcpCatalog, hydrateWebMcpTool, WEBMCP_CATALOG_LIMITS } from '../webmcp-catalog-v1.mjs';

function rawTool(index, { documentMarker = 'a', descriptionSize = 1024, propertyCount = 24 } = {}) {
  const properties = {};
  for (let i = 0; i < propertyCount; i += 1) {
    properties[`parameter_${index}_${i}`] = {
      type: 'string',
      description: `${documentMarker}:${'x'.repeat(180)}`,
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

function envelope({ count = 8, documentEpoch = 'doc_a', marker = 'a', descriptionSize = 1024, propertyCount = 24 } = {}) {
  return webMcpEnvelopeFromCdpTools(
    Array.from({ length: count }, (_, index) => rawTool(index, { documentMarker: marker, descriptionSize, propertyCount })),
    {
      targetId: 'target_catalog',
      contextId: 'default',
      conversationEpoch: 7,
      documentEpoch,
      mainFrameId: 'frame-main',
      capturedAt: '2026-08-28T14:20:00.000Z'
    }
  );
}

function unicodeEnvelope(names) {
  const schema = {
    type: 'object',
    properties: {
      äther: { type: 'string' },
      Ångstrom: { type: 'string' },
      alpha: { type: 'string' },
      Zeta: { type: 'string' }
    },
    additionalProperties: false
  };
  return webMcpEnvelopeFromCdpTools(names.map((name) => ({
    name,
    description: `Capability ${name}`,
    inputSchema: schema,
    annotations: { readOnly: true },
    frameId: 'frame-main'
  })), {
    targetId: 'target_catalog', contextId: 'default', conversationEpoch: 7,
    documentEpoch: 'doc_unicode', mainFrameId: 'frame-main', capturedAt: '2026-08-28T14:20:00.000Z'
  });
}

test('catalog preserves every tool but excludes full schemas and stays dramatically smaller', () => {
  const source = envelope({ count: 32, descriptionSize: 1400, propertyCount: 32 });
  const catalog = assertWebMcpCatalog(compileWebMcpCatalog(source));
  assert.equal(catalog.status, 'SUPPORTED');
  assert.equal(catalog.tool_count, source.tool_count);
  assert.equal(catalog.tools.every((tool) => tool.full_schema_embedded === false && !('input_schema' in tool)), true);
  assert.equal(JSON.stringify(catalog).includes('parameter_0_0'), false);
  assert.ok(Buffer.byteLength(JSON.stringify(catalog)) < Buffer.byteLength(JSON.stringify(source)) * 0.2);
  assert.ok(catalog.catalog_bytes <= WEBMCP_CATALOG_LIMITS.maxCatalogBytes);
});

test('catalog previews are deterministic, explicitly lossy, and keep annotations as hints only', () => {
  const source = envelope({ count: 2 });
  const first = compileWebMcpCatalog(source);
  const second = compileWebMcpCatalog(source);
  assert.deepEqual(first, second);
  assert.equal(first.tools[0].name_truncated, true);
  assert.equal(first.tools[0].description_truncated, true);
  assert.equal(first.tools[0].name_preview.length, WEBMCP_CATALOG_LIMITS.maxNamePreview);
  assert.equal(first.tools[0].description_preview.length, WEBMCP_CATALOG_LIMITS.maxDescriptionPreview);
  assert.equal(first.tools[0].tainted_page_data, true);
  assert.equal(first.tools[0].authority_effect, false);
  assert.equal(first.tools[0].actuation_eligible, false);
});

test('WebMCP normalization and catalog order are locale-independent even for Unicode metadata', () => {
  const expected = ['Zeta', 'alpha', 'Ångstrom', 'äther'];
  const firstEnvelope = unicodeEnvelope(['äther', 'alpha', 'Ångstrom', 'Zeta']);
  const secondEnvelope = unicodeEnvelope(['Zeta', 'Ångstrom', 'alpha', 'äther']);
  assert.deepEqual(firstEnvelope.tools.map((tool) => tool.name), expected);
  assert.deepEqual(secondEnvelope.tools.map((tool) => tool.name), expected);
  assert.deepEqual(Object.keys(firstEnvelope.tools[0].input_schema.properties), expected);
  assert.deepEqual(firstEnvelope, secondEnvelope);
  const firstCatalog = compileWebMcpCatalog(firstEnvelope);
  const secondCatalog = compileWebMcpCatalog(secondEnvelope);
  assert.deepEqual(firstCatalog.tools.map((tool) => tool.name_preview), expected);
  assert.deepEqual(firstCatalog, secondCatalog);
});

test('fresh hydration returns one exact sanitized schema and never creates invocation authority', () => {
  const source = envelope({ count: 3 });
  const catalog = compileWebMcpCatalog(source);
  const selected = catalog.tools[1];
  const hydrated = hydrateWebMcpTool(source, selected.tool_ref);
  assert.equal(hydrated.status, 'DESCRIBED');
  assert.equal(hydrated.tool_ref, selected.tool_ref);
  assert.deepEqual(hydrated.tool.input_schema, source.tools.find((tool) => tool.tool_ref === selected.tool_ref).input_schema);
  assert.equal(hydrated.schema_fingerprint, selected.schema_summary.schema_fingerprint);
  assert.equal(hydrated.fresh_discovery_used, true);
  assert.equal(hydrated.document_bound_ref, true);
  assert.equal(hydrated.tool_invocation_exposed, false);
  assert.equal(hydrated.authority_effect, false);
  assert.equal(hydrated.actuation_eligible, false);
});

test('document rotation and schema mutation invalidate old catalog identity', () => {
  const first = envelope({ count: 1, documentEpoch: 'doc_a', marker: 'a' });
  const second = envelope({ count: 1, documentEpoch: 'doc_b', marker: 'b' });
  const firstCatalog = compileWebMcpCatalog(first);
  const secondCatalog = compileWebMcpCatalog(second);
  assert.notEqual(firstCatalog.tools[0].tool_ref, secondCatalog.tools[0].tool_ref);
  assert.notEqual(firstCatalog.tools[0].schema_summary.schema_fingerprint, secondCatalog.tools[0].schema_summary.schema_fingerprint);
  assert.throws(() => hydrateWebMcpTool(second, firstCatalog.tools[0].tool_ref), /webmcp_catalog_tool_not_found/);
});

test('unsupported discovery compiles to a typed empty catalog and cannot hydrate', () => {
  const source = unsupportedWebMcpEnvelope({
    targetId: 'target_catalog', contextId: 'default', conversationEpoch: 7, documentEpoch: 'doc_x',
    capturedAt: '2026-08-28T14:20:00.000Z', reason: 'CDP_WEBMCP_UNAVAILABLE'
  });
  const catalog = assertWebMcpCatalog(compileWebMcpCatalog(source));
  assert.equal(catalog.status, 'UNSUPPORTED');
  assert.equal(catalog.tool_count, 0);
  assert.equal(catalog.progressive_disclosure, true);
  assert.throws(() => hydrateWebMcpTool(source, 'tool_0123456789abcdef'), /webmcp_catalog_unsupported/);
});