import { assertWebMcpCatalog } from './webmcp-catalog-v1.mjs';
import { assertWebMcpRoutingIndex } from './webmcp-routing-index-v1.mjs';

const HANDLE_SCHEMA = 'metaengine.a2-browser-operator.webmcp-tool-search-handle.v1';
const RESULT_SCHEMA = 'metaengine.a2-browser-operator.webmcp-tool-search-result.v1';
const MAX_QUERY_CHARS = 512;
const MAX_QUERY_TERMS = 24;
const MAX_RESULTS = 5;
const MAX_RESULT_BYTES = 12 * 1024;
const MAX_SIZE_FIXPOINT_PASSES = 8;
const ENCODER = new TextEncoder();

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ')
    .trim();
}

function stableStringCompare(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  return a < b ? -1 : a > b ? 1 : 0;
}

export function validateWebMcpToolSearchQuery(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_QUERY_CHARS) throw new Error('webmcp_tool_search_query_invalid');
  const normalized = normalizeText(value);
  const terms = [...new Set(normalized.match(/[\p{L}\p{N}_:-]{2,64}/gu) || [])].slice(0, MAX_QUERY_TERMS);
  if (!normalized || terms.length === 0) throw new Error('webmcp_tool_search_query_invalid');
  return Object.freeze({ normalized, terms: Object.freeze(terms) });
}

function toolsetFingerprint(index) {
  let hash = 0xcbf29ce484222325n;
  const canonical = index.tools.map((tool) => [
    tool.tool_ref,
    tool.name,
    tool.description_hint,
    tool.schema_fingerprint,
    tool.input_root_type,
    tool.input_property_count
  ]);
  const bytes = ENCODER.encode(JSON.stringify(canonical));
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `toolset_${hash.toString(16).padStart(16, '0')}`;
}

function finalize(base, code) {
  let bytes = 0;
  for (let pass = 0; pass < MAX_SIZE_FIXPOINT_PASSES; pass += 1) {
    const value = { ...base, result_bytes: bytes };
    const measured = ENCODER.encode(JSON.stringify(value)).length;
    if (measured === bytes) {
      if (measured > MAX_RESULT_BYTES) throw new Error(code);
      return Object.freeze(value);
    }
    bytes = measured;
  }
  const value = { ...base, result_bytes: bytes };
  const measured = ENCODER.encode(JSON.stringify(value)).length;
  if (measured !== bytes) throw new Error('webmcp_tool_search_size_unstable');
  if (measured > MAX_RESULT_BYTES) throw new Error(code);
  return Object.freeze(value);
}

function scoreTool(tool, query) {
  const name = normalizeText(tool.name);
  const description = normalizeText(tool.description_hint || '');
  const nameTerms = new Set(name.match(/[\p{L}\p{N}_:-]{2,64}/gu) || []);
  const descriptionTerms = new Set(description.match(/[\p{L}\p{N}_:-]{2,64}/gu) || []);
  let score = 0;
  if (name === query.normalized) score += 2000;
  else if (name.includes(query.normalized)) score += 800;
  if (description.includes(query.normalized)) score += 160;
  for (const term of query.terms) {
    if (nameTerms.has(term)) score += 160;
    else if (nameTerms.size && [...nameTerms].some((candidate) => candidate.startsWith(term) || term.startsWith(candidate))) score += 70;
    else if (name.includes(term)) score += 35;
    if (descriptionTerms.has(term)) score += 28;
    else if (description.includes(term)) score += 10;
  }
  return score;
}

function compactMatch(tool, score) {
  return Object.freeze({
    tool_ref: tool.tool_ref,
    name: tool.name,
    description_hint: tool.description_hint,
    schema_fingerprint: tool.schema_fingerprint,
    input_root_type: tool.input_root_type,
    input_property_count: tool.input_property_count,
    preview_lossy: tool.preview_lossy === true,
    lexical_score: score,
    tainted_page_data: true
  });
}

export function compileWebMcpToolSearchHandle(catalog) {
  const source = assertWebMcpCatalog(catalog);
  if (source.status !== 'SUPPORTED' || source.tool_count < 1) throw new Error('webmcp_tool_search_unavailable');
  return Object.freeze({
    schema: HANDLE_SCHEMA,
    status: 'SEARCH_REQUIRED',
    source_surface: source.source_surface,
    target_id: source.target_id,
    context_id: source.context_id,
    conversation_epoch: source.conversation_epoch,
    document_epoch: source.document_epoch,
    tool_count: source.tool_count,
    search_method: 'planning.tools.search',
    max_results: MAX_RESULTS,
    query_max_chars: MAX_QUERY_CHARS,
    deterministic_lexical_search: true,
    full_tool_list_embedded: false,
    full_schema_embedded: false,
    annotations_embedded: false,
    fresh_toolset_search_required: true,
    exact_description_required: true,
    semantic_fallback_available: true,
    tainted_page_data: true,
    authority_effect: false,
    actuation_eligible: false,
    tool_invocation_exposed: false
  });
}

export function searchWebMcpRoutingIndex(index, queryValue) {
  const source = assertWebMcpRoutingIndex(index);
  if (source.status !== 'SUPPORTED' || source.tool_count < 1) throw new Error('webmcp_tool_search_unavailable');
  const query = validateWebMcpToolSearchQuery(queryValue);
  const scored = source.tools
    .map((tool) => ({ tool, score: scoreTool(tool, query) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || stableStringCompare(`${a.tool.name}\u0000${a.tool.tool_ref}`, `${b.tool.name}\u0000${b.tool.tool_ref}`))
    .slice(0, MAX_RESULTS)
    .map((row) => compactMatch(row.tool, row.score));

  return finalize({
    schema: RESULT_SCHEMA,
    status: scored.length > 0 ? 'MATCHES' : 'NO_MATCH',
    source_surface: source.source_surface,
    target_id: source.target_id,
    context_id: source.context_id,
    conversation_epoch: source.conversation_epoch,
    document_epoch: source.document_epoch,
    toolset_fingerprint: toolsetFingerprint(source),
    total_tool_count: source.tool_count,
    result_count: scored.length,
    results: Object.freeze(scored),
    query_term_count: query.terms.length,
    deterministic_lexical_search: true,
    full_tool_list_embedded: false,
    full_schema_embedded: false,
    annotations_embedded: false,
    fresh_toolset_used: true,
    exact_description_required: true,
    semantic_fallback_available: true,
    tainted_page_data: true,
    authority_effect: false,
    actuation_eligible: false,
    tool_invocation_exposed: false
  }, 'webmcp_tool_search_result_too_large');
}

export function assertWebMcpToolSearchResult(value) {
  if (!value || typeof value !== 'object' || value.schema !== RESULT_SCHEMA) throw new Error('webmcp_tool_search_result_invalid');
  if (!['MATCHES', 'NO_MATCH'].includes(value.status)) throw new Error('webmcp_tool_search_status_invalid');
  if (!Array.isArray(value.results) || value.results.length !== value.result_count || value.result_count > MAX_RESULTS) throw new Error('webmcp_tool_search_result_count_invalid');
  if (value.full_tool_list_embedded !== false || value.full_schema_embedded !== false || value.annotations_embedded !== false || value.fresh_toolset_used !== true || value.exact_description_required !== true) throw new Error('webmcp_tool_search_contract_invalid');
  if (value.tainted_page_data !== true || value.authority_effect !== false || value.actuation_eligible !== false || value.tool_invocation_exposed !== false) throw new Error('webmcp_tool_search_authority_invalid');
  const measured = ENCODER.encode(JSON.stringify(value)).length;
  if (value.result_bytes !== measured || measured > MAX_RESULT_BYTES) throw new Error('webmcp_tool_search_size_invalid');
  return value;
}

export const WEBMCP_TOOL_SEARCH_HANDLE_SCHEMA = HANDLE_SCHEMA;
export const WEBMCP_TOOL_SEARCH_RESULT_SCHEMA = RESULT_SCHEMA;
export const WEBMCP_TOOL_SEARCH_LIMITS = Object.freeze({
  maxQueryChars: MAX_QUERY_CHARS,
  maxQueryTerms: MAX_QUERY_TERMS,
  maxResults: MAX_RESULTS,
  maxResultBytes: MAX_RESULT_BYTES
});
