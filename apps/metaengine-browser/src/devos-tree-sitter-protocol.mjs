export const DEVOS_TREE_SITTER_PROTOCOL_VERSION = 1;
export const DEVOS_TREE_SITTER_PROTOCOL_SCHEMA = 'metaengine.devos.tree-sitter.protocol.v1';

export const DEVOS_TREE_SITTER_BOUNDS = Object.freeze({
  source_text_bytes: 192 * 1024,
  replacement_text_bytes: 64 * 1024,
  changed_ranges: 64,
});

export const DEVOS_TREE_SITTER_RUNTIME_CONTRACT = Object.freeze({
  schema: 'metaengine.devos.tree-sitter.runtime-contract.v1',
  package_name: 'web-tree-sitter',
  package_version: '0.27.0',
  parser_abi_min: 13,
  parser_abi_max: 15,
  packaged_wasm_required: true,
  network_required: false,
  cdn_allowed: false,
  worker_isolation_required: true,
  renderer_supplied_wasm_url_allowed: false,
  renderer_supplied_grammar_path_allowed: false,
  renderer_supplied_query_allowed: false,
  arbitrary_eval_allowed: false,
  old_tree_edit_before_incremental_reparse_required: true,
  source_digest_readback_required: true,
  monaco_coordinates_require_worker_code_unit_mapping: true,
  parser_output_authority: false,
  repository_mutation_authority: false,
  browser_actuation_authority: false,
  process_authority: false,
  production_promotion_authority: false,
  second_scheduler_allowed: false,
  automatic_retry_allowed: false,
  authority_effect: false,
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const TOKEN_RE = /^[A-Za-z0-9._-]+$/;
const ENCODER = new TextEncoder();

function obj(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  return value;
}

function keys(value, required, optional = [], code = 'devos_tree_sitter_fields_invalid') {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(value, key)) throw new Error(code);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(code);
}

function posInt(value, code) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(code);
  return number;
}

function nat(value, code) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(code);
  return number;
}

function sha(value, code) {
  const text = String(value ?? '').toLowerCase();
  if (!SHA256_RE.test(text)) throw new Error(code);
  return text;
}

function token(value, code, max = 96) {
  const text = String(value ?? '');
  if (!text || text.length > max || !TOKEN_RE.test(text)) throw new Error(code);
  return text;
}

function relativePath(value) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 4096 || text.startsWith('/') || text.includes('\\') || text.includes('\0')) {
    throw new Error('devos_tree_sitter_relative_path_invalid');
  }
  const parts = text.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error('devos_tree_sitter_relative_path_escape');
  if (parts[0] === '.git' || text === '.metaengine-source-provenance.json') throw new Error('devos_tree_sitter_relative_path_reserved');
  return text;
}

function boundedText(value, maxBytes, code) {
  if (typeof value !== 'string' || ENCODER.encode(value).byteLength > maxBytes) throw new Error(code);
  return value;
}

function zeroAuthority(extra = {}) {
  return Object.freeze({
    ...extra,
    parser_output_authority: false,
    repository_mutation_authority: false,
    browser_actuation_authority: false,
    process_authority: false,
    production_promotion_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function validateDevOSTreeSitterDocumentRef(value) {
  const row = obj(value, 'devos_tree_sitter_document_ref_invalid');
  keys(row, [
    'workspace_id', 'workspace_generation', 'document_id', 'document_generation',
    'relative_path', 'revision', 'source_sha256',
  ], [], 'devos_tree_sitter_document_ref_fields_invalid');
  const workspaceId = String(row.workspace_id || '').toLowerCase();
  const documentId = String(row.document_id || '').toLowerCase();
  if (!UUID_RE.test(workspaceId)) throw new Error('devos_tree_sitter_workspace_id_invalid');
  if (!UUID_RE.test(documentId)) throw new Error('devos_tree_sitter_document_id_invalid');
  return Object.freeze({
    workspace_id: workspaceId,
    workspace_generation: posInt(row.workspace_generation, 'devos_tree_sitter_workspace_generation_invalid'),
    document_id: documentId,
    document_generation: posInt(row.document_generation, 'devos_tree_sitter_document_generation_invalid'),
    relative_path: relativePath(row.relative_path),
    revision: posInt(row.revision, 'devos_tree_sitter_revision_invalid'),
    source_sha256: sha(row.source_sha256, 'devos_tree_sitter_source_sha256_invalid'),
  });
}

export function sameDevOSTreeSitterDocumentIdentity(a, b) {
  const x = validateDevOSTreeSitterDocumentRef(a);
  const y = validateDevOSTreeSitterDocumentRef(b);
  return x.workspace_id === y.workspace_id
    && x.workspace_generation === y.workspace_generation
    && x.document_id === y.document_id
    && x.document_generation === y.document_generation
    && x.relative_path === y.relative_path;
}

export function validateDevOSTreeSitterParserRef(value) {
  const row = obj(value, 'devos_tree_sitter_parser_ref_invalid');
  keys(row, ['worker_generation', 'language_id', 'grammar_asset_id', 'grammar_sha256', 'parser_abi'], [], 'devos_tree_sitter_parser_ref_fields_invalid');
  const abi = posInt(row.parser_abi, 'devos_tree_sitter_parser_abi_invalid');
  if (abi < 13 || abi > 15) throw new Error('devos_tree_sitter_parser_abi_unsupported');
  return Object.freeze({
    worker_generation: posInt(row.worker_generation, 'devos_tree_sitter_worker_generation_invalid'),
    language_id: token(row.language_id, 'devos_tree_sitter_language_id_invalid', 64),
    grammar_asset_id: token(row.grammar_asset_id, 'devos_tree_sitter_grammar_asset_id_invalid'),
    grammar_sha256: sha(row.grammar_sha256, 'devos_tree_sitter_grammar_sha256_invalid'),
    parser_abi: abi,
  });
}

function sameParser(a, b) {
  const x = validateDevOSTreeSitterParserRef(a);
  const y = validateDevOSTreeSitterParserRef(b);
  return JSON.stringify(x) === JSON.stringify(y);
}

function monacoPoint(value, code) {
  const row = obj(value, code);
  keys(row, ['line_number', 'column'], [], code);
  return Object.freeze({ line_number: posInt(row.line_number, code), column: posInt(row.column, code) });
}

function treePoint(value, code) {
  const row = obj(value, code);
  keys(row, ['row', 'column'], [], code);
  return Object.freeze({ row: nat(row.row, code), column: nat(row.column, code) });
}

function ordered(a, b, rowKey, colKey) {
  return a[rowKey] < b[rowKey] || (a[rowKey] === b[rowKey] && a[colKey] <= b[colKey]);
}

export function validateDevOSTreeSitterMonacoEdit(value) {
  const row = obj(value, 'devos_tree_sitter_monaco_edit_invalid');
  keys(row, ['start', 'end', 'replacement_text'], [], 'devos_tree_sitter_monaco_edit_fields_invalid');
  const start = monacoPoint(row.start, 'devos_tree_sitter_monaco_start_invalid');
  const end = monacoPoint(row.end, 'devos_tree_sitter_monaco_end_invalid');
  if (!ordered(start, end, 'line_number', 'column')) throw new Error('devos_tree_sitter_monaco_range_invalid');
  const replacement = boundedText(row.replacement_text, DEVOS_TREE_SITTER_BOUNDS.replacement_text_bytes, 'devos_tree_sitter_replacement_text_invalid');
  return zeroAuthority({
    start, end, replacement_text: replacement,
    replacement_utf8_bytes: ENCODER.encode(replacement).byteLength,
    replacement_utf16_code_units: replacement.length,
    renderer_edit_indices_trusted: false,
    renderer_tree_points_trusted: false,
  });
}

export function validateDevOSTreeSitterOpenRequest(value) {
  const row = obj(value, 'devos_tree_sitter_open_invalid');
  keys(row, ['schema', 'protocol_version', 'request_id', 'document', 'parser', 'source_text'], [], 'devos_tree_sitter_open_fields_invalid');
  if (row.schema !== 'metaengine.devos.tree-sitter.open.v1' || Number(row.protocol_version) !== 1) throw new Error('devos_tree_sitter_open_contract_invalid');
  const source = boundedText(row.source_text, DEVOS_TREE_SITTER_BOUNDS.source_text_bytes, 'devos_tree_sitter_source_text_invalid');
  return zeroAuthority({
    schema: row.schema, protocol_version: 1,
    request_id: token(row.request_id, 'devos_tree_sitter_request_id_invalid', 128),
    document: validateDevOSTreeSitterDocumentRef(row.document),
    parser: validateDevOSTreeSitterParserRef(row.parser),
    source_text: source,
    source_utf8_bytes: ENCODER.encode(source).byteLength,
    worker_source_sha256_readback_required: true,
    packaged_grammar_resolution_required: true,
  });
}

export function validateDevOSTreeSitterEditRequest(value) {
  const row = obj(value, 'devos_tree_sitter_edit_invalid');
  keys(row, ['schema', 'protocol_version', 'request_id', 'previous_document', 'next_document', 'parser', 'edit'], [], 'devos_tree_sitter_edit_fields_invalid');
  if (row.schema !== 'metaengine.devos.tree-sitter.edit.v1' || Number(row.protocol_version) !== 1) throw new Error('devos_tree_sitter_edit_contract_invalid');
  const previous = validateDevOSTreeSitterDocumentRef(row.previous_document);
  const next = validateDevOSTreeSitterDocumentRef(row.next_document);
  if (!sameDevOSTreeSitterDocumentIdentity(previous, next)) throw new Error('devos_tree_sitter_document_identity_drift');
  if (next.revision !== previous.revision + 1) throw new Error('devos_tree_sitter_revision_gap');
  if (next.source_sha256 === previous.source_sha256) throw new Error('devos_tree_sitter_revision_digest_unchanged');
  return zeroAuthority({
    schema: row.schema, protocol_version: 1,
    request_id: token(row.request_id, 'devos_tree_sitter_request_id_invalid', 128),
    previous_document: previous, next_document: next,
    parser: validateDevOSTreeSitterParserRef(row.parser),
    edit: validateDevOSTreeSitterMonacoEdit(row.edit),
    edit_count: 1,
    worker_code_unit_mapping_required: true,
    old_tree_edit_before_parse_required: true,
    full_reparse_on_mapping_ambiguity: true,
  });
}

export function validateDevOSTreeSitterDerivedEditReceipt(value) {
  const row = obj(value, 'devos_tree_sitter_derived_edit_invalid');
  keys(row, [
    'schema', 'protocol_version', 'previous_document', 'next_document',
    'start_index', 'old_end_index', 'new_end_index',
    'start_position', 'old_end_position', 'new_end_position',
    'replacement_utf8_bytes', 'replacement_utf16_code_units', 'worker_source_sha256_verified',
  ], [], 'devos_tree_sitter_derived_edit_fields_invalid');
  if (row.schema !== 'metaengine.devos.tree-sitter.derived-edit.v1' || Number(row.protocol_version) !== 1) throw new Error('devos_tree_sitter_derived_edit_contract_invalid');
  const previous = validateDevOSTreeSitterDocumentRef(row.previous_document);
  const next = validateDevOSTreeSitterDocumentRef(row.next_document);
  if (!sameDevOSTreeSitterDocumentIdentity(previous, next) || next.revision !== previous.revision + 1) throw new Error('devos_tree_sitter_derived_edit_revision_invalid');
  const start = nat(row.start_index, 'devos_tree_sitter_start_index_invalid');
  const oldEnd = nat(row.old_end_index, 'devos_tree_sitter_old_end_index_invalid');
  const newEnd = nat(row.new_end_index, 'devos_tree_sitter_new_end_index_invalid');
  const replacementBytes = nat(row.replacement_utf8_bytes, 'devos_tree_sitter_replacement_bytes_invalid');
  const replacementCodeUnits = nat(row.replacement_utf16_code_units, 'devos_tree_sitter_replacement_code_units_invalid');
  if (oldEnd < start || newEnd < start || newEnd - start !== replacementCodeUnits) throw new Error('devos_tree_sitter_code_unit_edit_invalid');
  const startPoint = treePoint(row.start_position, 'devos_tree_sitter_start_position_invalid');
  const oldEndPoint = treePoint(row.old_end_position, 'devos_tree_sitter_old_end_position_invalid');
  const newEndPoint = treePoint(row.new_end_position, 'devos_tree_sitter_new_end_position_invalid');
  if (!ordered(startPoint, oldEndPoint, 'row', 'column') || !ordered(startPoint, newEndPoint, 'row', 'column')) throw new Error('devos_tree_sitter_tree_point_order_invalid');
  if (row.worker_source_sha256_verified !== true) throw new Error('devos_tree_sitter_source_readback_unverified');
  return zeroAuthority({
    schema: row.schema, protocol_version: 1,
    previous_document: previous, next_document: next,
    start_index: start, old_end_index: oldEnd, new_end_index: newEnd,
    start_position: startPoint, old_end_position: oldEndPoint, new_end_position: newEndPoint,
    replacement_utf8_bytes: replacementBytes,
    replacement_utf16_code_units: replacementCodeUnits,
    edit_indices_are_utf16_code_units: true,
    tree_point_columns_are_utf16_code_units: true,
    wasm_shim_converts_code_units_to_core_bytes: true,
    worker_source_sha256_verified: true,
  });
}

export function classifyDevOSTreeSitterIncrementalEligibility({
  previous_document, next_document, previous_parser, next_parser,
  edit_count, old_tree_available, code_unit_mapping_verified,
} = {}) {
  const previous = validateDevOSTreeSitterDocumentRef(previous_document);
  const next = validateDevOSTreeSitterDocumentRef(next_document);
  if (!sameDevOSTreeSitterDocumentIdentity(previous, next)) return zeroAuthority({ state: 'FULL_REPARSE_REQUIRED', reason: 'DOCUMENT_IDENTITY_DRIFT', incremental: false });
  if (next.revision !== previous.revision + 1) return zeroAuthority({ state: 'FULL_REPARSE_REQUIRED', reason: 'REVISION_GAP', incremental: false });
  if (!sameParser(previous_parser, next_parser)) return zeroAuthority({ state: 'FULL_REPARSE_REQUIRED', reason: 'PARSER_DRIFT', incremental: false });
  if (nat(edit_count, 'devos_tree_sitter_edit_count_invalid') !== 1) return zeroAuthority({ state: 'FULL_REPARSE_REQUIRED', reason: 'EDIT_BATCH_NOT_SINGLE', incremental: false });
  if (old_tree_available !== true) return zeroAuthority({ state: 'FULL_REPARSE_REQUIRED', reason: 'OLD_TREE_MISSING', incremental: false });
  if (code_unit_mapping_verified !== true) return zeroAuthority({ state: 'FULL_REPARSE_REQUIRED', reason: 'CODE_UNIT_MAPPING_UNVERIFIED', incremental: false });
  return zeroAuthority({ state: 'INCREMENTAL_ALLOWED', reason: null, incremental: true, old_tree_edit_before_parse_required: true });
}

export function classifyDevOSTreeSitterSourceDigest({ declared_source_sha256, observed_source_sha256 } = {}) {
  const declared = sha(declared_source_sha256, 'devos_tree_sitter_declared_sha256_invalid');
  const observed = sha(observed_source_sha256, 'devos_tree_sitter_observed_sha256_invalid');
  return declared === observed
    ? zeroAuthority({ state: 'SOURCE_DIGEST_VERIFIED', accepted: true, source_sha256: declared })
    : zeroAuthority({ state: 'SOURCE_DIGEST_MISMATCH', accepted: false, declared_source_sha256: declared, observed_source_sha256: observed });
}

export const DEVOS_TREE_SITTER_PROTOCOL_CONTRACT = Object.freeze({
  schema: DEVOS_TREE_SITTER_PROTOCOL_SCHEMA,
  protocol_version: DEVOS_TREE_SITTER_PROTOCOL_VERSION,
  document_identity: 'WORKSPACE+DOCUMENT_GENERATIONS+PATH',
  revision_rule: 'NEXT_EQUALS_PREVIOUS_PLUS_ONE',
  source_identity: 'SHA256_READBACK_REQUIRED',
  monaco_input_coordinates: 'ONE_BASED_UTF16_LINE_COLUMN_CLAIM',
  tree_sitter_edit_indices: 'WEB_BINDING_UTF16_CODE_UNITS',
  tree_sitter_point_columns: 'WEB_BINDING_UTF16_CODE_UNITS',
  wasm_core_bridge: 'CODE_UNIT_TO_BYTE_IN_BINDING_WEB_SHIM',
  incremental_edit_count: 1,
  multiple_edits_require_full_reparse: true,
  parser_drift_requires_full_reparse: true,
  revision_gap_requires_full_reparse: true,
  mapping_ambiguity_requires_full_reparse: true,
  old_tree_edit_before_parse_required: true,
  worker_isolation_required: true,
  packaged_wasm_required: true,
  renderer_supplied_wasm_url_allowed: false,
  renderer_supplied_grammar_path_allowed: false,
  renderer_supplied_query_allowed: false,
  network_required: false,
  arbitrary_eval_allowed: false,
  parser_output_authority: false,
  repository_mutation_authority: false,
  browser_actuation_authority: false,
  process_authority: false,
  production_promotion_authority: false,
  second_scheduler_allowed: false,
  automatic_retry_allowed: false,
  authority_effect: false,
});
