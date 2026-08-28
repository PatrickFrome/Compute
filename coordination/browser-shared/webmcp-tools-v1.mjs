const SCHEMA = 'metaengine.a2-browser-operator.webmcp-tools.v1';
const MAX_TOOLS = 128;
const MAX_NAME = 256;
const MAX_DESCRIPTION = 4096;
const MAX_SCHEMA_BYTES = 64 * 1024;
const MAX_SCHEMA_DEPTH = 12;
const MAX_SCHEMA_NODES = 2048;
const MAX_OBJECT_KEYS = 128;
const MAX_ARRAY_ITEMS = 256;
const MAX_SCHEMA_STRING = 4096;

function fnv1a64(value) {
  let hash = 0xcbf29ce484222325n;
  const bytes = new TextEncoder().encode(String(value ?? ''));
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

function stableStringCompare(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  return a < b ? -1 : a > b ? 1 : 0;
}

function cleanText(value, max, code) {
  if (typeof value !== 'string') throw new Error(code);
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim();
  if (!text || text.length > max) throw new Error(code);
  return text;
}

function cleanId(value, code) {
  const text = cleanText(String(value ?? ''), 256, code);
  if (!/^[a-zA-Z0-9_.:-]+$/.test(text)) throw new Error(code);
  return text;
}

function positiveInt(value, code) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(code);
  return number;
}

function normalizeSchema(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('webmcp_input_schema_invalid');
  const seen = new WeakSet();
  let nodes = 0;
  const visit = (value, depth) => {
    nodes += 1;
    if (nodes > MAX_SCHEMA_NODES || depth > MAX_SCHEMA_DEPTH) throw new Error('webmcp_input_schema_too_complex');
    if (value == null || typeof value === 'boolean' || typeof value === 'number') {
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('webmcp_input_schema_invalid');
      return value;
    }
    if (typeof value === 'string') {
      if (value.length > MAX_SCHEMA_STRING) throw new Error('webmcp_input_schema_string_too_long');
      return value;
    }
    if (typeof value !== 'object') throw new Error('webmcp_input_schema_invalid');
    if (seen.has(value)) throw new Error('webmcp_input_schema_cycle');
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        if (value.length > MAX_ARRAY_ITEMS) throw new Error('webmcp_input_schema_array_too_large');
        return value.map((item) => visit(item, depth + 1));
      }
      const keys = Object.keys(value).sort(stableStringCompare);
      if (keys.length > MAX_OBJECT_KEYS) throw new Error('webmcp_input_schema_object_too_large');
      const out = {};
      for (const key of keys) {
        if (!key || key.length > 256 || /[\u0000-\u001f\u007f]/.test(key)) throw new Error('webmcp_input_schema_key_invalid');
        out[key] = visit(value[key], depth + 1);
      }
      return out;
    } finally {
      seen.delete(value);
    }
  };
  const normalized = visit(input, 0);
  if (new TextEncoder().encode(JSON.stringify(normalized)).length > MAX_SCHEMA_BYTES) throw new Error('webmcp_input_schema_too_large');
  return normalized;
}

function annotationHints(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const hint = (key) => source[key] === true ? true : source[key] === false ? false : null;
  return Object.freeze({
    read_only_hint: hint('readOnly'),
    untrusted_content_hint: hint('untrustedContent'),
    consequential_hint: hint('consequential'),
    autosubmit_hint: hint('autosubmit')
  });
}

function normalizeTool(raw, identity) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('webmcp_tool_invalid');
  const name = cleanText(raw.name, MAX_NAME, 'webmcp_tool_name_invalid');
  const description = raw.description == null ? null : cleanText(raw.description, MAX_DESCRIPTION, 'webmcp_tool_description_invalid');
  const frameId = cleanText(raw.frameId, 512, 'webmcp_tool_frame_id_invalid');
  const schema = normalizeSchema(raw.inputSchema || {});
  const material = [
    identity.target_id,
    identity.context_id,
    identity.conversation_epoch,
    identity.document_epoch,
    frameId,
    name
  ].join('\u0000');
  return Object.freeze({
    tool_ref: `tool_${fnv1a64(material)}`,
    name,
    description,
    input_schema: schema,
    annotations: annotationHints(raw.annotations),
    frame_scope: frameId === identity.main_frame_id ? 'MAIN' : 'SUBFRAME',
    tainted_page_data: true,
    authority_effect: false,
    actuation_eligible: false
  });
}

function baseEnvelope({ sourceSurface, targetId, contextId, conversationEpoch, documentEpoch, capturedAt }) {
  const parsed = Date.parse(String(capturedAt || ''));
  if (!Number.isFinite(parsed)) throw new Error('webmcp_captured_at_invalid');
  return {
    schema: SCHEMA,
    source_surface: cleanId(sourceSurface, 'webmcp_source_surface_invalid'),
    target_id: cleanId(targetId, 'webmcp_target_id_invalid'),
    context_id: cleanId(contextId, 'webmcp_context_id_invalid'),
    conversation_epoch: positiveInt(conversationEpoch, 'webmcp_conversation_epoch_invalid'),
    document_epoch: cleanId(documentEpoch, 'webmcp_document_epoch_invalid'),
    captured_at: new Date(parsed).toISOString(),
    tainted_page_data: true,
    authority_effect: false,
    actuation_eligible: false,
    tool_invocation_exposed: false
  };
}

export function webMcpEnvelopeFromCdpTools(rawTools, {
  sourceSurface = 'COMPUTE_BROWSER',
  targetId,
  contextId,
  conversationEpoch,
  documentEpoch,
  mainFrameId,
  capturedAt = new Date().toISOString(),
  maxTools = MAX_TOOLS
} = {}) {
  if (!Array.isArray(rawTools)) throw new Error('webmcp_tools_invalid');
  if (!Number.isSafeInteger(maxTools) || maxTools < 1 || maxTools > MAX_TOOLS) throw new Error('webmcp_max_tools_invalid');
  if (rawTools.length > maxTools) throw new Error('webmcp_tools_too_many');
  const base = baseEnvelope({ sourceSurface, targetId, contextId, conversationEpoch, documentEpoch, capturedAt });
  const main = cleanText(mainFrameId, 512, 'webmcp_main_frame_id_invalid');
  const identity = { ...base, main_frame_id: main };
  const seen = new Set();
  const tools = rawTools.map((raw) => {
    const frameId = cleanText(raw?.frameId, 512, 'webmcp_tool_frame_id_invalid');
    const name = cleanText(raw?.name, MAX_NAME, 'webmcp_tool_name_invalid');
    const key = `${frameId}\u0000${name}`;
    if (seen.has(key)) throw new Error('webmcp_tool_duplicate');
    seen.add(key);
    return normalizeTool(raw, identity);
  }).sort((a, b) => stableStringCompare(`${a.frame_scope}:${a.name}:${a.tool_ref}`, `${b.frame_scope}:${b.name}:${b.tool_ref}`));
  return Object.freeze({
    ...base,
    status: 'SUPPORTED',
    tool_count: tools.length,
    tools: Object.freeze(tools)
  });
}

export function unsupportedWebMcpEnvelope({
  sourceSurface = 'COMPUTE_BROWSER',
  targetId,
  contextId,
  conversationEpoch,
  documentEpoch,
  capturedAt = new Date().toISOString(),
  reason = 'CDP_WEBMCP_UNAVAILABLE'
} = {}) {
  const base = baseEnvelope({ sourceSurface, targetId, contextId, conversationEpoch, documentEpoch, capturedAt });
  return Object.freeze({
    ...base,
    status: 'UNSUPPORTED',
    unsupported_reason: cleanId(reason, 'webmcp_unsupported_reason_invalid'),
    tool_count: 0,
    tools: Object.freeze([])
  });
}

export function assertWebMcpEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schema !== SCHEMA) throw new Error('webmcp_envelope_invalid');
  if (!['SUPPORTED', 'UNSUPPORTED'].includes(value.status)) throw new Error('webmcp_status_invalid');
  if (value.tainted_page_data !== true || value.authority_effect !== false || value.actuation_eligible !== false || value.tool_invocation_exposed !== false) {
    throw new Error('webmcp_authority_contract_invalid');
  }
  if (!Array.isArray(value.tools) || Number(value.tool_count) !== value.tools.length) throw new Error('webmcp_tool_count_invalid');
  for (const tool of value.tools) {
    if (!tool || typeof tool !== 'object' || tool.tainted_page_data !== true || tool.authority_effect !== false || tool.actuation_eligible !== false) {
      throw new Error('webmcp_tool_authority_contract_invalid');
    }
    cleanId(tool.tool_ref, 'webmcp_tool_ref_invalid');
    cleanText(tool.name, MAX_NAME, 'webmcp_tool_name_invalid');
    normalizeSchema(tool.input_schema || {});
  }
  return value;
}

export const WEBMCP_TOOLS_SCHEMA = SCHEMA;
export const WEBMCP_TOOLS_LIMITS = Object.freeze({
  maxTools: MAX_TOOLS,
  maxName: MAX_NAME,
  maxDescription: MAX_DESCRIPTION,
  maxSchemaBytes: MAX_SCHEMA_BYTES,
  maxSchemaDepth: MAX_SCHEMA_DEPTH,
  maxSchemaNodes: MAX_SCHEMA_NODES
});