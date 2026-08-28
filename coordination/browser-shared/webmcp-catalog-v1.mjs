import { assertWebMcpEnvelope } from './webmcp-tools-v1.mjs';

const CATALOG_SCHEMA = 'metaengine.a2-browser-operator.webmcp-catalog.v1';
const DESCRIPTION_SCHEMA = 'metaengine.a2-browser-operator.webmcp-tool-description.v1';
const MAX_NAME_PREVIEW = 64;
const MAX_DESCRIPTION_PREVIEW = 128;
const MAX_CATALOG_BYTES = 96 * 1024;
const MAX_SIZE_FIXPOINT_PASSES = 8;
const ENCODER = new TextEncoder();

function fnv1a64(value) {
  let hash = 0xcbf29ce484222325n;
  const bytes = ENCODER.encode(String(value ?? ''));
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

function cleanToolRef(value) {
  const text = String(value ?? '').trim();
  if (!/^tool_[a-f0-9]{16}$/.test(text)) throw new Error('webmcp_catalog_tool_ref_invalid');
  return text;
}

function preview(value, max) {
  const text = value == null ? '' : String(value);
  return Object.freeze({
    text: text.slice(0, max),
    truncated: text.length > max
  });
}

function rootType(schema) {
  const type = schema?.type;
  if (typeof type === 'string' && type) return type.slice(0, 32);
  if (Array.isArray(type) && type.length > 0 && type.every((value) => typeof value === 'string')) return 'MULTI';
  return 'UNKNOWN';
}

function objectCount(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).length : 0;
}

function arrayCount(value) {
  return Array.isArray(value) ? value.length : 0;
}

function additionalPropertiesHint(schema) {
  if (schema?.additionalProperties === true) return true;
  if (schema?.additionalProperties === false) return false;
  return null;
}

function schemaSummary(schema) {
  const serialized = JSON.stringify(schema || {});
  return Object.freeze({
    root_type: rootType(schema),
    property_count: objectCount(schema?.properties),
    required_count: arrayCount(schema?.required),
    root_enum_count: arrayCount(schema?.enum),
    additional_properties_hint: additionalPropertiesHint(schema),
    schema_fingerprint: `schema_${fnv1a64(serialized)}`
  });
}

function commonEnvelopeFields(envelope) {
  return {
    source_surface: envelope.source_surface,
    target_id: envelope.target_id,
    context_id: envelope.context_id,
    conversation_epoch: envelope.conversation_epoch,
    document_epoch: envelope.document_epoch,
    captured_at: envelope.captured_at,
    tainted_page_data: true,
    authority_effect: false,
    actuation_eligible: false,
    tool_invocation_exposed: false
  };
}

function compactTool(tool) {
  const name = preview(tool.name, MAX_NAME_PREVIEW);
  const description = preview(tool.description, MAX_DESCRIPTION_PREVIEW);
  return Object.freeze({
    tool_ref: cleanToolRef(tool.tool_ref),
    name_preview: name.text,
    name_truncated: name.truncated,
    description_preview: description.text || null,
    description_truncated: description.truncated,
    frame_scope: tool.frame_scope,
    annotations: Object.freeze({ ...tool.annotations }),
    schema_summary: schemaSummary(tool.input_schema),
    tainted_page_data: true,
    authority_effect: false,
    actuation_eligible: false,
    full_schema_embedded: false
  });
}

function finalizeCatalog(base) {
  let bytes = 0;
  let value = null;
  for (let pass = 0; pass < MAX_SIZE_FIXPOINT_PASSES; pass += 1) {
    value = { ...base, catalog_bytes: bytes };
    const measured = ENCODER.encode(JSON.stringify(value)).length;
    if (measured === bytes) {
      if (measured > MAX_CATALOG_BYTES) throw new Error('webmcp_catalog_too_large');
      return Object.freeze(value);
    }
    bytes = measured;
  }
  value = { ...base, catalog_bytes: bytes };
  const measured = ENCODER.encode(JSON.stringify(value)).length;
  if (measured !== bytes) throw new Error('webmcp_catalog_size_unstable');
  if (measured > MAX_CATALOG_BYTES) throw new Error('webmcp_catalog_too_large');
  return Object.freeze(value);
}

export function compileWebMcpCatalog(envelope) {
  const source = assertWebMcpEnvelope(envelope);
  const common = commonEnvelopeFields(source);
  if (source.status === 'UNSUPPORTED') {
    return finalizeCatalog({
      schema: CATALOG_SCHEMA,
      ...common,
      status: 'UNSUPPORTED',
      unsupported_reason: source.unsupported_reason,
      tool_count: 0,
      tools: Object.freeze([]),
      progressive_disclosure: true,
      full_schema_embedded: false,
      fresh_hydration_required: true
    });
  }

  const tools = source.tools.map(compactTool).sort((a, b) =>
    `${a.name_preview}\u0000${a.tool_ref}`.localeCompare(`${b.name_preview}\u0000${b.tool_ref}`, 'en')
  );
  return finalizeCatalog({
    schema: CATALOG_SCHEMA,
    ...common,
    status: 'SUPPORTED',
    tool_count: tools.length,
    tools: Object.freeze(tools),
    progressive_disclosure: true,
    full_schema_embedded: false,
    fresh_hydration_required: true
  });
}

export function hydrateWebMcpTool(envelope, toolRef) {
  const source = assertWebMcpEnvelope(envelope);
  if (source.status !== 'SUPPORTED') throw new Error('webmcp_catalog_unsupported');
  const ref = cleanToolRef(toolRef);
  const tool = source.tools.find((candidate) => candidate?.tool_ref === ref);
  if (!tool) throw new Error('webmcp_catalog_tool_not_found');
  return Object.freeze({
    schema: DESCRIPTION_SCHEMA,
    ...commonEnvelopeFields(source),
    status: 'DESCRIBED',
    tool_ref: ref,
    schema_fingerprint: schemaSummary(tool.input_schema).schema_fingerprint,
    tool: Object.freeze({
      ...tool,
      input_schema: structuredClone(tool.input_schema),
      annotations: Object.freeze({ ...tool.annotations }),
      tainted_page_data: true,
      authority_effect: false,
      actuation_eligible: false
    }),
    fresh_discovery_used: true,
    document_bound_ref: true,
    tool_invocation_exposed: false
  });
}

export function assertWebMcpCatalog(value) {
  if (!value || typeof value !== 'object' || value.schema !== CATALOG_SCHEMA) throw new Error('webmcp_catalog_invalid');
  if (!['SUPPORTED', 'UNSUPPORTED'].includes(value.status)) throw new Error('webmcp_catalog_status_invalid');
  if (value.tainted_page_data !== true || value.authority_effect !== false || value.actuation_eligible !== false || value.tool_invocation_exposed !== false) {
    throw new Error('webmcp_catalog_authority_invalid');
  }
  if (value.progressive_disclosure !== true || value.full_schema_embedded !== false || value.fresh_hydration_required !== true) {
    throw new Error('webmcp_catalog_disclosure_contract_invalid');
  }
  if (!Array.isArray(value.tools) || value.tools.length !== value.tool_count) throw new Error('webmcp_catalog_tool_count_invalid');
  for (const tool of value.tools) {
    cleanToolRef(tool?.tool_ref);
    if (tool.full_schema_embedded !== false || 'input_schema' in tool) throw new Error('webmcp_catalog_full_schema_forbidden');
  }
  const measured = ENCODER.encode(JSON.stringify(value)).length;
  if (value.catalog_bytes !== measured || measured > MAX_CATALOG_BYTES) throw new Error('webmcp_catalog_size_invalid');
  return value;
}

export const WEBMCP_CATALOG_SCHEMA = CATALOG_SCHEMA;
export const WEBMCP_TOOL_DESCRIPTION_SCHEMA = DESCRIPTION_SCHEMA;
export const WEBMCP_CATALOG_LIMITS = Object.freeze({
  maxNamePreview: MAX_NAME_PREVIEW,
  maxDescriptionPreview: MAX_DESCRIPTION_PREVIEW,
  maxCatalogBytes: MAX_CATALOG_BYTES
});
