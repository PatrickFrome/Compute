import { assertWebMcpCatalog } from './webmcp-catalog-v1.mjs';

const ROUTING_INDEX_SCHEMA = 'metaengine.a2-browser-operator.webmcp-routing-index.v1';
const MAX_NAME = 64;
const MAX_DESCRIPTION_HINT = 64;
const MAX_ROUTING_INDEX_BYTES = 48 * 1024;
const MAX_SIZE_FIXPOINT_PASSES = 8;
const ENCODER = new TextEncoder();

function stableStringCompare(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  return a < b ? -1 : a > b ? 1 : 0;
}

function cleanToolRef(value) {
  const text = String(value ?? '').trim();
  if (!/^tool_[a-f0-9]{16}$/.test(text)) throw new Error('webmcp_routing_tool_ref_invalid');
  return text;
}

function boundedText(value, max, code, { nullable = false } = {}) {
  if (value == null && nullable) return null;
  if (typeof value !== 'string') throw new Error(code);
  return value.slice(0, max);
}

function cleanFingerprint(value) {
  const text = String(value ?? '').trim();
  if (!/^schema_[a-f0-9]{16}$/.test(text)) throw new Error('webmcp_routing_schema_fingerprint_invalid');
  return text;
}

function cleanRootType(value) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 32 || !/^[a-zA-Z0-9_.:-]+$/.test(text)) throw new Error('webmcp_routing_root_type_invalid');
  return text;
}

function nonNegativeCount(value, code) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0 || count > 100_000) throw new Error(code);
  return count;
}

function compactTool(tool) {
  if (!tool || typeof tool !== 'object' || Array.isArray(tool)) throw new Error('webmcp_routing_tool_invalid');
  const summary = tool.schema_summary;
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) throw new Error('webmcp_routing_schema_summary_invalid');
  const rawDescription = tool.description_preview == null ? null : boundedText(tool.description_preview, 128, 'webmcp_routing_description_invalid');
  const descriptionHint = rawDescription == null ? null : rawDescription.slice(0, MAX_DESCRIPTION_HINT);
  return Object.freeze({
    tool_ref: cleanToolRef(tool.tool_ref),
    name: boundedText(tool.name_preview, MAX_NAME, 'webmcp_routing_name_invalid'),
    description_hint: descriptionHint,
    schema_fingerprint: cleanFingerprint(summary.schema_fingerprint),
    input_root_type: cleanRootType(summary.root_type),
    input_property_count: nonNegativeCount(summary.property_count, 'webmcp_routing_property_count_invalid'),
    preview_lossy: tool.name_truncated === true || tool.description_truncated === true || (rawDescription?.length || 0) > MAX_DESCRIPTION_HINT,
    tainted_page_data: true
  });
}

function finalize(base) {
  let bytes = 0;
  let value = null;
  for (let pass = 0; pass < MAX_SIZE_FIXPOINT_PASSES; pass += 1) {
    value = { ...base, routing_index_bytes: bytes };
    const measured = ENCODER.encode(JSON.stringify(value)).length;
    if (measured === bytes) {
      if (measured > MAX_ROUTING_INDEX_BYTES) throw new Error('webmcp_routing_index_too_large');
      return Object.freeze(value);
    }
    bytes = measured;
  }
  value = { ...base, routing_index_bytes: bytes };
  const measured = ENCODER.encode(JSON.stringify(value)).length;
  if (measured !== bytes) throw new Error('webmcp_routing_index_size_unstable');
  if (measured > MAX_ROUTING_INDEX_BYTES) throw new Error('webmcp_routing_index_too_large');
  return Object.freeze(value);
}

export function compileWebMcpRoutingIndex(catalog) {
  const source = assertWebMcpCatalog(catalog);
  const common = {
    schema: ROUTING_INDEX_SCHEMA,
    source_surface: source.source_surface,
    target_id: source.target_id,
    context_id: source.context_id,
    conversation_epoch: source.conversation_epoch,
    document_epoch: source.document_epoch,
    captured_at: source.captured_at,
    catalog_bytes: source.catalog_bytes,
    tainted_page_data: true,
    authority_effect: false,
    actuation_eligible: false,
    tool_invocation_exposed: false,
    selection_only: true,
    lossy_index: true,
    full_schema_embedded: false,
    annotations_embedded: false,
    fresh_description_required: true,
    semantic_fallback_available: true
  };

  if (source.status === 'UNSUPPORTED') {
    return finalize({
      ...common,
      status: 'UNSUPPORTED',
      unsupported_reason: source.unsupported_reason,
      tool_count: 0,
      tools: Object.freeze([])
    });
  }

  const tools = source.tools.map(compactTool).sort((a, b) =>
    stableStringCompare(`${a.name}\u0000${a.tool_ref}`, `${b.name}\u0000${b.tool_ref}`)
  );
  return finalize({
    ...common,
    status: 'SUPPORTED',
    tool_count: tools.length,
    tools: Object.freeze(tools)
  });
}

export function assertWebMcpRoutingIndex(value) {
  if (!value || typeof value !== 'object' || value.schema !== ROUTING_INDEX_SCHEMA) throw new Error('webmcp_routing_index_invalid');
  if (!['SUPPORTED', 'UNSUPPORTED'].includes(value.status)) throw new Error('webmcp_routing_index_status_invalid');
  if (value.tainted_page_data !== true || value.authority_effect !== false || value.actuation_eligible !== false || value.tool_invocation_exposed !== false) {
    throw new Error('webmcp_routing_index_authority_invalid');
  }
  if (value.selection_only !== true || value.lossy_index !== true || value.full_schema_embedded !== false || value.annotations_embedded !== false || value.fresh_description_required !== true || value.semantic_fallback_available !== true) {
    throw new Error('webmcp_routing_index_contract_invalid');
  }
  if (!Array.isArray(value.tools) || value.tools.length !== value.tool_count) throw new Error('webmcp_routing_index_tool_count_invalid');
  for (const tool of value.tools) {
    cleanToolRef(tool?.tool_ref);
    if (typeof tool?.name !== 'string' || tool.name.length > MAX_NAME) throw new Error('webmcp_routing_name_invalid');
    if (tool.description_hint != null && (typeof tool.description_hint !== 'string' || tool.description_hint.length > MAX_DESCRIPTION_HINT)) throw new Error('webmcp_routing_description_invalid');
    cleanFingerprint(tool.schema_fingerprint);
    cleanRootType(tool.input_root_type);
    nonNegativeCount(tool.input_property_count, 'webmcp_routing_property_count_invalid');
    if ('annotations' in tool || 'input_schema' in tool || 'schema_summary' in tool) throw new Error('webmcp_routing_index_rich_metadata_forbidden');
    if (tool.tainted_page_data !== true) throw new Error('webmcp_routing_tool_taint_invalid');
  }
  const measured = ENCODER.encode(JSON.stringify(value)).length;
  if (value.routing_index_bytes !== measured || measured > MAX_ROUTING_INDEX_BYTES) throw new Error('webmcp_routing_index_size_invalid');
  return value;
}

export const WEBMCP_ROUTING_INDEX_SCHEMA = ROUTING_INDEX_SCHEMA;
export const WEBMCP_ROUTING_INDEX_LIMITS = Object.freeze({
  maxName: MAX_NAME,
  maxDescriptionHint: MAX_DESCRIPTION_HINT,
  maxRoutingIndexBytes: MAX_ROUTING_INDEX_BYTES
});