import {
  FAST_CONTROL_MCP_PROTOCOL_REVISION,
  FAST_CONTROL_MCP_LIST_TTL_MS,
  FAST_CONTROL_MCP_CACHE_SCOPE,
} from './fast-control-mcp-adapter.mjs';

export const FAST_CONTROL_MCP_STATELESS_ROUTER_SCHEMA = 'metaengine.fast-control-mcp-stateless-router.v1';
export const FAST_CONTROL_MCP_MAX_REQUEST_BYTES = 32 * 1024;
export const FAST_CONTROL_MCP_SERVER_INFO = Object.freeze({
  name: 'metaengine-browser-fast-control',
  version: '0.7.0-dev',
});

const SUPPORTED_METHODS = new Set(['server/discover', 'tools/list', 'tools/call']);
const PROTOCOL_META = 'io.modelcontextprotocol/protocolVersion';
const CAPABILITIES_META = 'io.modelcontextprotocol/clientCapabilities';
const SERVER_INFO_META = 'io.modelcontextprotocol/serverInfo';

const plain = (value) => value && typeof value === 'object' && !Array.isArray(value);

function requestBytes(request, transportBodyBytes) {
  if (transportBodyBytes != null) {
    if (!Number.isSafeInteger(transportBodyBytes) || transportBodyBytes < 1) {
      throw new Error('fast_control_mcp_transport_body_bytes_invalid');
    }
    return transportBodyBytes;
  }
  return Buffer.byteLength(JSON.stringify(request), 'utf8');
}

function routingHeaders(value) {
  if (!plain(value)) throw new Error('fast_control_mcp_headers_invalid');
  let protocol;
  let method;
  let name;
  let hasName = false;
  for (const [key, item] of Object.entries(value)) {
    switch (key.toLowerCase()) {
      case 'mcp-protocol-version': protocol = String(item); break;
      case 'mcp-method': method = String(item); break;
      case 'mcp-name': name = String(item); hasName = true; break;
      default: break;
    }
  }
  return Object.freeze({ protocol, method, name, hasName });
}

function validateEnvelope(headersInput, request, transportBodyBytes) {
  if (!plain(request) || request.jsonrpc !== '2.0' || request.id == null) throw new Error('fast_control_mcp_request_invalid');
  if (requestBytes(request, transportBodyBytes) > FAST_CONTROL_MCP_MAX_REQUEST_BYTES) throw new Error('fast_control_mcp_request_too_large');
  const method = String(request.method || '');
  if (!SUPPORTED_METHODS.has(method)) throw new Error('fast_control_mcp_method_unsupported');
  const params = plain(request.params) ? request.params : {};
  const meta = plain(params._meta) ? params._meta : null;
  if (!meta) throw new Error('fast_control_mcp_meta_required');
  if (meta[PROTOCOL_META] !== FAST_CONTROL_MCP_PROTOCOL_REVISION) throw new Error('fast_control_mcp_protocol_unsupported');
  if (!plain(meta[CAPABILITIES_META])) throw new Error('fast_control_mcp_client_capabilities_required');

  const headers = routingHeaders(headersInput);
  if (headers.protocol !== FAST_CONTROL_MCP_PROTOCOL_REVISION) throw new Error('fast_control_mcp_protocol_header_mismatch');
  if (headers.method !== method) throw new Error('fast_control_mcp_method_header_mismatch');
  if (method === 'tools/call') {
    const name = String(params.name || '');
    if (!name) throw new Error('fast_control_mcp_tool_name_required');
    if (headers.name !== name) throw new Error('fast_control_mcp_name_header_mismatch');
    if (!plain(params.arguments ?? {})) throw new Error('fast_control_mcp_tool_arguments_invalid');
  } else if (headers.hasName) {
    throw new Error('fast_control_mcp_name_header_unexpected');
  }
  return Object.freeze({ method, params });
}

function serverMeta() {
  return Object.freeze({ [SERVER_INFO_META]: FAST_CONTROL_MCP_SERVER_INFO });
}

function response(id, result) {
  return Object.freeze({ jsonrpc: '2.0', id, result: Object.freeze(result) });
}

export function createFastControlMcpStatelessRouter(adapter) {
  if (!adapter || typeof adapter.listTools !== 'function' || typeof adapter.callTool !== 'function') {
    throw new Error('fast_control_mcp_adapter_required');
  }
  return Object.freeze({
    schema: FAST_CONTROL_MCP_STATELESS_ROUTER_SCHEMA,
    protocol_revision: FAST_CONTROL_MCP_PROTOCOL_REVISION,
    session_state: false,
    listener_owned: false,
    subscriptions: false,
    tasks: false,
    async handle({ headers = {}, request, transport_body_bytes = null } = {}) {
      const { method, params } = validateEnvelope(headers, request, transport_body_bytes);
      if (method === 'server/discover') {
        return response(request.id, {
          resultType: 'complete',
          supportedVersions: [FAST_CONTROL_MCP_PROTOCOL_REVISION],
          capabilities: { tools: {} },
          instructions: 'Prefer dev_query as the single read for what changed, what broke, where, and what to do next. Use context_get only when live Browser state is required.',
          ttlMs: FAST_CONTROL_MCP_LIST_TTL_MS,
          cacheScope: FAST_CONTROL_MCP_CACHE_SCOPE,
          _meta: serverMeta(),
          authority_effect: false,
        });
      }
      if (method === 'tools/list') {
        const listed = adapter.listTools();
        return response(request.id, {
          resultType: 'complete',
          tools: listed.tools,
          ttlMs: listed.ttlMs,
          cacheScope: listed.cacheScope,
          catalogRevision: listed.catalog_revision,
          _meta: serverMeta(),
          authority_effect: false,
        });
      }
      const called = await adapter.callTool(String(params.name), params.arguments ?? {});
      return response(request.id, {
        ...called,
        _meta: serverMeta(),
        authority_effect: false,
      });
    },
    snapshot() {
      return Object.freeze({
        schema: FAST_CONTROL_MCP_STATELESS_ROUTER_SCHEMA,
        protocol_revision: FAST_CONTROL_MCP_PROTOCOL_REVISION,
        supported_methods: [...SUPPORTED_METHODS],
        max_request_bytes: FAST_CONTROL_MCP_MAX_REQUEST_BYTES,
        transport_body_bytes_supported: true,
        legacy_request_size_fallback: true,
        routing_header_projection: 'FIXED_ONE_PASS',
        session_state: false,
        listener_owned: false,
        subscriptions: false,
        tasks: false,
        second_scheduler: false,
        command_leasing_authority: false,
        browser_execution_authority: false,
        authority_effect: false,
      });
    },
  });
}
