import { CONTROL_ACTION_MANIFEST_REVISION } from './control-actions-manifest.mjs';
import { FAST_CONTROL_TOOL_NAMES } from './fast-control-gateway-core.mjs';

export const FAST_CONTROL_MCP_SCHEMA = 'metaengine.fast-control-mcp.v1';

const objectSchema = (properties, required = []) => Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: Object.freeze(properties),
  required: Object.freeze(required),
});

export const FAST_CONTROL_MCP_TOOLS = Object.freeze([
  Object.freeze({
    name: 'context_get',
    description: 'Read a bounded revisioned source-of-truth context. Read-only; use if_none_match to avoid unchanged payloads.',
    inputSchema: objectSchema({
      fields: { type: 'array', maxItems: 32, items: { type: 'string', maxLength: 80 } },
      if_none_match: { type: 'string', maxLength: 96 },
      max_bytes: { type: 'integer', minimum: 256, maximum: 16384 },
    }),
  }),
  Object.freeze({
    name: 'dev_query',
    description: 'Search a bounded in-memory development index for source, CI, checkpoints, changes, hotspots, blockers, next actions, runtime and database evidence. Read-only and revision-addressed.',
    inputSchema: objectSchema({
      query: { type: 'string', minLength: 1, maxLength: 1024 },
      kinds: {
        type: 'array', minItems: 1, maxItems: 9, uniqueItems: true,
        items: { type: 'string', enum: ['SOURCE', 'CI', 'CHECKPOINT', 'CHANGE', 'HOTSPOT', 'BLOCKER', 'NEXT_ACTION', 'RUNTIME', 'DATABASE'] },
      },
      limit: { type: 'integer', minimum: 1, maximum: 12 },
      if_none_match: { type: 'string', maxLength: 96 },
      max_bytes: { type: 'integer', minimum: 512, maximum: 8192 },
    }, ['query']),
  }),
  Object.freeze({
    name: 'run_submit',
    description: 'Issue one bounded typed command batch. This does not lease or execute Browser effects; DB leasing remains the sole actuation authority.',
    inputSchema: objectSchema({
      capability_revision: { type: 'string', const: CONTROL_ACTION_MANIFEST_REVISION },
      steps: {
        type: 'array', minItems: 1, maxItems: 64,
        items: objectSchema({
          idempotency_key: { type: 'string', minLength: 8, maxLength: 160, pattern: '^[A-Za-z0-9._:-]+$' },
          action: { type: 'string', minLength: 2, maxLength: 80, pattern: '^[A-Z][A-Z0-9_]+$' },
          platform: { type: 'string', maxLength: 80 },
          payload: { type: 'object', additionalProperties: true },
        }, ['idempotency_key', 'action']),
      },
    }, ['capability_revision', 'steps']),
  }),
  Object.freeze({
    name: 'run_status',
    description: 'Read the monotonic terminal result delta after a cursor. Small verified receipts may be inlined; large receipts remain digest-addressed.',
    inputSchema: objectSchema({
      after_seq: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: 16 },
    }),
  }),
  Object.freeze({
    name: 'emergency_stop',
    description: 'Issue a DB-authoritative emergency DISARM or supervisor OFF request. Transport delivery itself never grants authority or proves cancellation of an in-flight effect.',
    inputSchema: objectSchema({
      kind: { type: 'string', enum: ['DISARM', 'OFF'] },
      idempotency_key: { type: 'string', minLength: 8, maxLength: 160, pattern: '^[A-Za-z0-9._:-]+$' },
      reason: { type: 'string', maxLength: 240 },
    }, ['idempotency_key']),
  }),
]);

export function createFastControlMcpAdapter(gateway) {
  if (!gateway || typeof gateway.invoke !== 'function' || typeof gateway.manifest !== 'function') {
    throw new Error('fast_control_mcp_gateway_required');
  }
  const manifest = gateway.manifest();
  const gatewayNames = Array.isArray(manifest?.tools) ? manifest.tools.map((row) => row.name) : [];
  if (JSON.stringify(gatewayNames) !== JSON.stringify(FAST_CONTROL_TOOL_NAMES)) {
    throw new Error('fast_control_mcp_gateway_manifest_drift');
  }
  return Object.freeze({
    schema: FAST_CONTROL_MCP_SCHEMA,
    capability_revision: CONTROL_ACTION_MANIFEST_REVISION,
    listTools() {
      return Object.freeze({
        tools: FAST_CONTROL_MCP_TOOLS.map((tool) => structuredClone(tool)),
        capability_revision: CONTROL_ACTION_MANIFEST_REVISION,
        authority_effect: false,
      });
    },
    async callTool(name, args = {}) {
      const tool = FAST_CONTROL_MCP_TOOLS.find((row) => row.name === String(name || ''));
      if (!tool) throw new Error('fast_control_mcp_tool_unknown');
      const result = await gateway.invoke(tool.name, args);
      return Object.freeze({
        content: [],
        structuredContent: structuredClone(result),
        isError: false,
        raw_sql: false,
        arbitrary_eval: false,
        raw_cdp_passthrough: false,
        transport_delivery_is_authority: false,
        authority_effect: false,
      });
    },
  });
}
