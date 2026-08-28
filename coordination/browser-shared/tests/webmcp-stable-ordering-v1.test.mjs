import assert from 'node:assert/strict';
import test from 'node:test';
import { webMcpEnvelopeFromCdpTools } from '../webmcp-tools-v1.mjs';
import { compileWebMcpCatalog } from '../webmcp-catalog-v1.mjs';
import { compileWebMcpRoutingIndex } from '../webmcp-routing-index-v1.mjs';

const EXPECTED = ['Zeta', 'alpha', 'Ångstrom', 'äther'];

function schemaWithUnicodeKeys() {
  return {
    type: 'object',
    properties: {
      äther: { type: 'string' },
      Ångstrom: { type: 'string' },
      alpha: { type: 'string' },
      Zeta: { type: 'string' }
    },
    additionalProperties: false
  };
}

function rawTool(name) {
  return {
    name,
    description: `Capability ${name}`,
    inputSchema: schemaWithUnicodeKeys(),
    annotations: { readOnly: true },
    frameId: 'frame-main'
  };
}

function envelope(inputNames) {
  return webMcpEnvelopeFromCdpTools(inputNames.map(rawTool), {
    targetId: 'stable_target',
    contextId: 'default',
    conversationEpoch: 11,
    documentEpoch: 'doc_stable',
    mainFrameId: 'frame-main',
    capturedAt: '2026-08-28T16:20:00.000Z'
  });
}

test('WebMCP normalization uses locale-independent code-unit order for tools and schema keys', () => {
  const forward = envelope(['äther', 'alpha', 'Ångstrom', 'Zeta']);
  const reverse = envelope(['Zeta', 'Ångstrom', 'alpha', 'äther']);
  assert.deepEqual(forward.tools.map((tool) => tool.name), EXPECTED);
  assert.deepEqual(reverse.tools.map((tool) => tool.name), EXPECTED);
  assert.deepEqual(Object.keys(forward.tools[0].input_schema.properties), EXPECTED);
  assert.deepEqual(Object.keys(reverse.tools[0].input_schema.properties), EXPECTED);
  assert.deepEqual(forward, reverse);
});

test('catalog and routing index preserve the same byte-stable order independent of discovery order', () => {
  const firstCatalog = compileWebMcpCatalog(envelope(['äther', 'Zeta', 'alpha', 'Ångstrom']));
  const secondCatalog = compileWebMcpCatalog(envelope(['Ångstrom', 'alpha', 'Zeta', 'äther']));
  assert.deepEqual(firstCatalog.tools.map((tool) => tool.name_preview), EXPECTED);
  assert.deepEqual(secondCatalog.tools.map((tool) => tool.name_preview), EXPECTED);
  assert.deepEqual(firstCatalog, secondCatalog);

  const firstIndex = compileWebMcpRoutingIndex(firstCatalog);
  const secondIndex = compileWebMcpRoutingIndex(secondCatalog);
  assert.deepEqual(firstIndex.tools.map((tool) => tool.name), EXPECTED);
  assert.deepEqual(secondIndex.tools.map((tool) => tool.name), EXPECTED);
  assert.deepEqual(firstIndex, secondIndex);
});
