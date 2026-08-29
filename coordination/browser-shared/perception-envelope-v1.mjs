const SCHEMA = 'metaengine.a2-browser-operator.perception-envelope.v1';
const MAX_DEFAULT_NODES = 4096;
const MAX_TEXT = 1024;
const MAX_STATE_KEYS = 64;
const VISIBILITY = Object.freeze({ VISIBLE: 'VISIBLE', UNKNOWN: 'UNKNOWN' });
const COVERAGE = Object.freeze({ COMPLETE: 'COMPLETE', PARTIAL: 'PARTIAL', UNKNOWN: 'UNKNOWN', POSITIVE_ONLY: 'POSITIVE_ONLY' });
const COVERAGE_VALUES = new Set(Object.values(COVERAGE));

function fnv1a64(value) {
  let hash = 0xcbf29ce484222325n;
  const bytes = new TextEncoder().encode(String(value ?? ''));
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

function cleanText(value, max = MAX_TEXT) {
  if (value == null) return null;
  const text = String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

function cleanId(value, code) {
  const text = cleanText(value, 256);
  if (!text || !/^[a-zA-Z0-9_.:-]+$/.test(text)) throw new Error(code);
  return text;
}

function positiveInt(value, code) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(code);
  return number;
}

function normalizeBounds(value) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length !== 4) throw new Error('perception_envelope_bounds_invalid');
  const bounds = value.map(Number);
  if (bounds.some((number) => !Number.isFinite(number))) throw new Error('perception_envelope_bounds_invalid');
  return bounds.map((number) => Object.is(number, -0) ? 0 : number);
}

function normalizeStates(value) {
  if (value == null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('perception_envelope_states_invalid');
  const entries = Object.entries(value).slice(0, MAX_STATE_KEYS).sort(([a], [b]) => a.localeCompare(b, 'en'));
  const states = {};
  for (const [key, raw] of entries) {
    const name = cleanText(key, 64);
    if (!name) continue;
    if (!['string', 'number', 'boolean'].includes(typeof raw)) continue;
    states[name] = cleanText(raw, 128) ?? '';
  }
  return states;
}

function roleFlags(role, states, supplied = {}) {
  const token = String(role || '').toLowerCase();
  const truthy = (value) => value === true || value === 'true' || value === '1';
  const editable = supplied.editable === true || truthy(states.editable) || ['textbox', 'searchbox', 'combobox', 'spinbutton'].includes(token);
  const clickable = supplied.clickable === true || ['button', 'link', 'menuitem', 'checkbox', 'radio', 'switch', 'tab', 'option'].includes(token);
  const focusable = supplied.focusable === true || truthy(states.focusable) || editable || clickable;
  return { editable, clickable, focusable };
}

function geometryBucket(bounds) {
  if (!bounds) return 'none';
  const [x, y, width, height] = bounds;
  const bucket = (value, size) => Math.round(value / size) * size;
  return [bucket(x, 64), bucket(y, 64), bucket(width, 32), bucket(height, 32)].join(':');
}

function normalizedNode({ ref, parentRef = null, role, name, description = null, valueSummary = null, states = {}, bounds = null, visible = false, confidence = null, continuity = null, bindingEpoch = null, editable = false, clickable = false, focusable = false }) {
  const normalizedRole = cleanText(role, 128) || 'unknown';
  const normalizedStates = normalizeStates(states);
  const normalizedBounds = normalizeBounds(bounds);
  const flags = roleFlags(normalizedRole, normalizedStates, { editable, clickable, focusable });
  const normalizedName = cleanText(name);
  const normalizedDescription = cleanText(description);
  const normalizedValue = cleanText(valueSummary);
  const geometry = geometryBucket(normalizedBounds);
  const semanticMaterial = [
    normalizedRole.toLowerCase(),
    (normalizedName || '').toLowerCase(),
    (normalizedDescription || '').toLowerCase(),
    (normalizedValue || '').toLowerCase(),
    flags.editable ? 'e1' : 'e0',
    flags.clickable ? 'c1' : 'c0',
    flags.focusable ? 'f1' : 'f0'
  ].join('|');
  const semanticFingerprint = `semfp_${fnv1a64(semanticMaterial)}`;
  const numericConfidence = confidence == null ? null : Number(confidence);
  return {
    ref: cleanId(ref, 'perception_envelope_node_ref_invalid'),
    parent_ref: parentRef == null ? null : cleanId(parentRef, 'perception_envelope_parent_ref_invalid'),
    role: normalizedRole,
    name: normalizedName,
    description: normalizedDescription,
    value_summary: normalizedValue,
    states: normalizedStates,
    editable: flags.editable,
    clickable: flags.clickable,
    focusable: flags.focusable,
    bounds: normalizedBounds,
    visibility: visible === true && normalizedBounds ? VISIBILITY.VISIBLE : VISIBILITY.UNKNOWN,
    confidence: Number.isFinite(numericConfidence) ? Math.max(0, Math.min(1, numericConfidence)) : null,
    continuity: cleanText(continuity, 64),
    binding_epoch: bindingEpoch == null ? null : positiveInt(bindingEpoch, 'perception_envelope_binding_epoch_invalid'),
    semantic_fingerprint: semanticFingerprint,
    geometry_bucket: geometry,
    locator_fingerprint: `loc_${fnv1a64(`${semanticFingerprint}|${geometry}`)}`
  };
}

function finalize({ sourceSurface, targetId, contextId, conversationEpoch, documentEpoch, capturedAt, sourceToken, nodes, sourceCount, evidence, sourceScope }) {
  const seen = new Set();
  for (const node of nodes) {
    if (seen.has(node.ref)) throw new Error('perception_envelope_node_ref_duplicate');
    seen.add(node.ref);
  }
  for (const node of nodes) {
    if (node.parent_ref != null && !seen.has(node.parent_ref)) node.parent_ref = null;
  }
  return {
    schema: SCHEMA,
    source_surface: sourceSurface,
    target_id: cleanId(targetId, 'perception_envelope_target_id_invalid'),
    context_id: cleanId(contextId, 'perception_envelope_context_id_required'),
    conversation_epoch: positiveInt(conversationEpoch, 'perception_envelope_conversation_epoch_invalid'),
    document_epoch: cleanId(documentEpoch, 'perception_envelope_document_epoch_invalid'),
    captured_at: cleanText(capturedAt, 64) || new Date(0).toISOString(),
    source_token: `src_${fnv1a64(sourceToken)}`,
    source_scope: sourceScope,
    tainted_page_data: true,
    authority_effect: false,
    actuation_eligible: false,
    evidence: {
      accessibility: evidence.accessibility,
      geometry: evidence.geometry,
      visibility: evidence.visibility,
      oopif: evidence.oopif
    },
    truncation: {
      applied: sourceCount > nodes.length,
      source_node_count: sourceCount,
      emitted_node_count: nodes.length
    },
    nodes
  };
}

function maxNodes(options) {
  const number = Number(options?.maxNodes ?? MAX_DEFAULT_NODES);
  if (!Number.isSafeInteger(number) || number < 1 || number > 20000) throw new Error('perception_envelope_max_nodes_invalid');
  return number;
}

export function envelopeFromExtensionFrame(frame, options = {}) {
  if (frame?.schema !== 'metaengine.a2-browser-operator.semantic-frame.v1') throw new Error('perception_extension_frame_schema_invalid');
  if (frame.tainted_page_data !== true || frame.authority_effect !== false) throw new Error('perception_extension_trust_contract_invalid');
  const conversationEpoch = options.conversationEpoch ?? frame.conversation_epoch;
  if (conversationEpoch == null) throw new Error('perception_extension_conversation_epoch_required');
  const sourceNodes = Array.isArray(frame.nodes) ? frame.nodes : [];
  const limit = maxNodes(options);
  const nodes = sourceNodes.slice(0, limit).map((node) => normalizedNode({
    ref: node.semantic_id,
    parentRef: node.parent_semantic_id || null,
    role: node.role,
    name: node.name,
    valueSummary: node.value_summary,
    states: node.states,
    bounds: node.bounds,
    visible: node.visible === true,
    confidence: node.confidence,
    continuity: node.continuity,
    bindingEpoch: node.binding_epoch,
    editable: node.editable,
    clickable: node.clickable,
    focusable: node.focusable
  }));
  return finalize({
    sourceSurface: 'EXTENSION',
    targetId: frame.target_id,
    contextId: frame.context_id,
    conversationEpoch,
    documentEpoch: frame.document_epoch,
    capturedAt: frame.captured_at,
    sourceToken: frame.frame_id,
    sourceCount: sourceNodes.length,
    sourceScope: 'SEMANTIC_WORKING_SET',
    evidence: {
      accessibility: frame.truncation?.applied === true ? COVERAGE.PARTIAL : COVERAGE.COMPLETE,
      geometry: COVERAGE.PARTIAL,
      visibility: COVERAGE.POSITIVE_ONLY,
      oopif: COVERAGE.UNKNOWN
    },
    nodes
  });
}

export function envelopeFromComputeSnapshot(snapshot, options = {}) {
  if (snapshot?.schema !== 'metaengine.a2-compute-browser.semantic-snapshot.v1') throw new Error('perception_compute_snapshot_schema_invalid');
  if (snapshot.actuation_eligible !== false) throw new Error('perception_compute_snapshot_authority_invalid');
  const documentEpoch = options.documentEpoch;
  if (!documentEpoch) throw new Error('perception_compute_document_epoch_required');
  if (!options.contextId) throw new Error('perception_compute_context_id_required');
  const sourceNodes = Array.isArray(snapshot.nodes) ? snapshot.nodes : [];
  const limit = maxNodes(options);
  const nodes = sourceNodes.slice(0, limit).map((node) => normalizedNode({
    ref: node.node_id,
    parentRef: node.parent_node_id,
    role: node.role,
    name: node.name,
    description: node.description,
    states: node.state,
    bounds: node.bounds,
    visible: node.visible === true,
    confidence: node.visible === true ? 0.98 : 0.82
  }));
  return finalize({
    sourceSurface: 'COMPUTE_BROWSER',
    targetId: snapshot.target_id,
    contextId: options.contextId,
    conversationEpoch: snapshot.conversation_epoch,
    documentEpoch,
    capturedAt: snapshot.captured_at,
    sourceToken: snapshot.snapshot_id,
    sourceCount: sourceNodes.length,
    sourceScope: snapshot.scope || 'MAIN_TARGET',
    evidence: {
      accessibility: COVERAGE.COMPLETE,
      geometry: COVERAGE.PARTIAL,
      visibility: COVERAGE.POSITIVE_ONLY,
      oopif: snapshot.oopif_complete === true ? COVERAGE.COMPLETE : COVERAGE.PARTIAL
    },
    nodes
  });
}

export function assertPerceptionEnvelope(value) {
  if (value?.schema !== SCHEMA) throw new Error('perception_envelope_schema_invalid');
  if (value.tainted_page_data !== true || value.authority_effect !== false || value.actuation_eligible !== false) throw new Error('perception_envelope_authority_invalid');
  cleanId(value.target_id, 'perception_envelope_target_id_invalid');
  cleanId(value.context_id, 'perception_envelope_context_id_required');
  positiveInt(value.conversation_epoch, 'perception_envelope_conversation_epoch_invalid');
  cleanId(value.document_epoch, 'perception_envelope_document_epoch_invalid');
  if (!Array.isArray(value.nodes) || value.nodes.length > 20000) throw new Error('perception_envelope_nodes_invalid');
  for (const key of ['accessibility', 'geometry', 'visibility', 'oopif']) {
    if (!COVERAGE_VALUES.has(value.evidence?.[key])) throw new Error(`perception_envelope_evidence_invalid:${key}`);
  }
  const serialized = JSON.stringify(value);
  if (/backendDOMNodeId|backend_node|cdp_target|session_generation|process_incarnation|browserContextId|loaderId|Runtime\.evaluate/i.test(serialized)) {
    throw new Error('perception_envelope_engine_identity_leak');
  }
  return value;
}

export const PERCEPTION_ENVELOPE_SCHEMA = SCHEMA;
export const PERCEPTION_ENVELOPE_VISIBILITY = VISIBILITY;
export const PERCEPTION_ENVELOPE_COVERAGE = COVERAGE;
