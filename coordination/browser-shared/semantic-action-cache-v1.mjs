import { assertPerceptionEnvelope, PERCEPTION_ENVELOPE_VISIBILITY } from './perception-envelope-v1.mjs';

const SCHEMA = 'metaengine.a2-browser-operator.semantic-action-cache.v1';
const RECORD_SCHEMA = 'metaengine.a2-browser-operator.semantic-action-cache-record.v1';
const RESOLUTION_SCHEMA = 'metaengine.a2-browser-operator.semantic-action-cache-resolution.v1';
const DEFAULT_MAX_ENTRIES = 1024;
const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;
const ACTION_KINDS = new Set(['CLICK', 'FOCUS', 'FILL', 'PRESS', 'SELECT', 'TOGGLE']);
const FORBIDDEN_PAYLOAD_KEYS = new Set([
  'text', 'value', 'input', 'arguments', 'args', 'payload', 'secret', 'password', 'token',
  'authorization', 'cookie', 'cookies', 'storage_state', 'headers'
]);

function cleanId(value, code, max = 256) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max || !/^[a-zA-Z0-9_.:-]+$/.test(text)) throw new Error(code);
  return text;
}

function positiveInt(value, code) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(code);
  return n;
}

function normalizeActionKind(value) {
  const kind = String(value ?? '').trim().toUpperCase();
  if (!ACTION_KINDS.has(kind)) throw new Error('semantic_action_cache_action_kind_invalid');
  return kind;
}

function finiteTimestamp(value, code) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(code);
  return n;
}

function assertNoPayloadFields(value) {
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_PAYLOAD_KEYS.has(String(key).toLowerCase())) {
      throw new Error(`semantic_action_cache_payload_forbidden:${key}`);
    }
  }
}

function namespaceFromEnvelope(envelope) {
  assertPerceptionEnvelope(envelope);
  return Object.freeze({
    target_id: cleanId(envelope.target_id, 'semantic_action_cache_target_id_invalid'),
    context_id: cleanId(envelope.context_id, 'semantic_action_cache_context_id_invalid'),
    conversation_epoch: positiveInt(envelope.conversation_epoch, 'semantic_action_cache_conversation_epoch_invalid'),
    document_epoch: cleanId(envelope.document_epoch, 'semantic_action_cache_document_epoch_invalid')
  });
}

function namespaceKey(ns) {
  return `${ns.target_id}\u001f${ns.context_id}\u001f${ns.conversation_epoch}\u001f${ns.document_epoch}`;
}

function entryKey(ns, intentId, actionKind) {
  return `${namespaceKey(ns)}\u001e${intentId}\u001e${actionKind}`;
}

function eligible(node, actionKind) {
  if (!node || node.visibility !== PERCEPTION_ENVELOPE_VISIBILITY.VISIBLE) return false;
  if (actionKind === 'CLICK' || actionKind === 'TOGGLE') return node.clickable === true;
  if (actionKind === 'FILL' || actionKind === 'SELECT') return node.editable === true;
  if (actionKind === 'FOCUS' || actionKind === 'PRESS') return node.focusable === true;
  return false;
}

function publicMiss(reason) {
  return {
    schema: RESOLUTION_SCHEMA,
    cache_status: 'MISS',
    reason,
    candidate_ref: null,
    authority_effect: false,
    actuation_eligible: false,
    revalidation_required: true,
    must_run_actionability_checks: true
  };
}

function publicHit(record, node, ambiguityResolvedByGeometry) {
  return {
    schema: RESOLUTION_SCHEMA,
    cache_status: 'HIT_REVALIDATED',
    reason: ambiguityResolvedByGeometry ? 'SEMANTIC_AND_GEOMETRY_REVALIDATED' : 'UNIQUE_SEMANTIC_REVALIDATED',
    intent_id: record.intent_id,
    action_kind: record.action_kind,
    candidate_ref: node.ref,
    semantic_fingerprint: node.semantic_fingerprint,
    locator_fingerprint: node.locator_fingerprint,
    authority_effect: false,
    actuation_eligible: false,
    revalidation_required: true,
    must_run_actionability_checks: true
  };
}

export class SemanticActionCache {
  constructor({ maxEntries = DEFAULT_MAX_ENTRIES, maxAgeMs = DEFAULT_MAX_AGE_MS, clock = () => Date.now() } = {}) {
    this.maxEntries = positiveInt(maxEntries, 'semantic_action_cache_max_entries_invalid');
    if (this.maxEntries > 100000) throw new Error('semantic_action_cache_max_entries_invalid');
    this.maxAgeMs = finiteTimestamp(maxAgeMs, 'semantic_action_cache_max_age_invalid');
    if (this.maxAgeMs < 1) throw new Error('semantic_action_cache_max_age_invalid');
    if (typeof clock !== 'function') throw new Error('semantic_action_cache_clock_invalid');
    this.clock = clock;
    this.records = new Map();
    this.metrics = { hits: 0, misses: 0, puts: 0, evictions: 0, expirations: 0, invalidations: 0 };
  }

  put(options = {}) {
    assertNoPayloadFields(options);
    const envelope = assertPerceptionEnvelope(options.envelope);
    const ns = namespaceFromEnvelope(envelope);
    const intentId = cleanId(options.intentId, 'semantic_action_cache_intent_id_invalid');
    const actionKind = normalizeActionKind(options.actionKind);
    const nodeRef = cleanId(options.nodeRef, 'semantic_action_cache_node_ref_invalid');
    const node = envelope.nodes.find((candidate) => candidate?.ref === nodeRef);
    if (!node) throw new Error('semantic_action_cache_node_not_in_fresh_envelope');
    if (!eligible(node, actionKind)) throw new Error('semantic_action_cache_node_not_eligible');
    const semanticFingerprint = cleanId(node.semantic_fingerprint, 'semantic_action_cache_semantic_fingerprint_invalid');
    const locatorFingerprint = cleanId(node.locator_fingerprint, 'semantic_action_cache_locator_fingerprint_invalid');
    const createdAtMs = finiteTimestamp(this.clock(), 'semantic_action_cache_clock_invalid');
    const key = entryKey(ns, intentId, actionKind);
    const record = Object.freeze({
      schema: RECORD_SCHEMA,
      namespace: ns,
      intent_id: intentId,
      action_kind: actionKind,
      semantic_fingerprint: semanticFingerprint,
      locator_fingerprint: locatorFingerprint,
      source_surface: String(envelope.source_surface || 'UNKNOWN').slice(0, 64),
      created_at_ms: createdAtMs,
      authority_effect: false,
      actuation_eligible: false,
      stores_action_payload: false,
      stores_node_ref: false
    });
    if (this.records.has(key)) this.records.delete(key);
    this.records.set(key, record);
    this.metrics.puts += 1;
    this.#evictOverflow();
    return record;
  }

  resolve(options = {}) {
    assertNoPayloadFields(options);
    const envelope = assertPerceptionEnvelope(options.envelope);
    const ns = namespaceFromEnvelope(envelope);
    const intentId = cleanId(options.intentId, 'semantic_action_cache_intent_id_invalid');
    const actionKind = normalizeActionKind(options.actionKind);
    const key = entryKey(ns, intentId, actionKind);
    const record = this.records.get(key);
    if (!record) return this.#miss('NO_RECORD');
    const ageMs = finiteTimestamp(this.clock(), 'semantic_action_cache_clock_invalid') - record.created_at_ms;
    if (ageMs < 0 || ageMs > this.maxAgeMs) {
      this.records.delete(key);
      this.metrics.expirations += 1;
      return this.#miss('EXPIRED');
    }
    const semanticCandidates = envelope.nodes.filter((node) =>
      node?.semantic_fingerprint === record.semantic_fingerprint && eligible(node, actionKind)
    );
    if (semanticCandidates.length === 0) return this.#miss('TARGET_NOT_REVALIDATED');
    let chosen = null;
    let geometry = false;
    if (semanticCandidates.length === 1) {
      [chosen] = semanticCandidates;
    } else {
      const locatorCandidates = semanticCandidates.filter((node) => node?.locator_fingerprint === record.locator_fingerprint);
      if (locatorCandidates.length !== 1) return this.#miss('AMBIGUOUS_TARGET');
      [chosen] = locatorCandidates;
      geometry = true;
    }
    this.records.delete(key);
    this.records.set(key, record);
    this.metrics.hits += 1;
    return publicHit(record, chosen, geometry);
  }

  invalidateNamespace(envelope) {
    const ns = namespaceFromEnvelope(envelope);
    const prefix = `${namespaceKey(ns)}\u001e`;
    let removed = 0;
    for (const key of [...this.records.keys()]) {
      if (!key.startsWith(prefix)) continue;
      this.records.delete(key);
      removed += 1;
    }
    this.metrics.invalidations += removed;
    return removed;
  }

  sweep() {
    const nowMs = finiteTimestamp(this.clock(), 'semantic_action_cache_clock_invalid');
    let removed = 0;
    for (const [key, record] of this.records.entries()) {
      const ageMs = nowMs - record.created_at_ms;
      if (ageMs < 0 || ageMs > this.maxAgeMs) {
        this.records.delete(key);
        removed += 1;
      }
    }
    this.metrics.expirations += removed;
    return removed;
  }

  snapshot() {
    return {
      schema: SCHEMA,
      entry_count: this.records.size,
      max_entries: this.maxEntries,
      max_age_ms: this.maxAgeMs,
      authority_effect: false,
      actuation_eligible: false,
      stores_action_payload: false,
      stores_node_ref: false,
      negative_cache_enabled: false,
      metrics: { ...this.metrics }
    };
  }

  #miss(reason) {
    this.metrics.misses += 1;
    return publicMiss(reason);
  }

  #evictOverflow() {
    while (this.records.size > this.maxEntries) {
      const oldestKey = this.records.keys().next().value;
      if (oldestKey == null) break;
      this.records.delete(oldestKey);
      this.metrics.evictions += 1;
    }
  }
}

export function semanticActionCacheNamespace(envelope) {
  return namespaceFromEnvelope(envelope);
}

export const SEMANTIC_ACTION_CACHE_SCHEMA = SCHEMA;
export const SEMANTIC_ACTION_CACHE_RECORD_SCHEMA = RECORD_SCHEMA;
export const SEMANTIC_ACTION_CACHE_RESOLUTION_SCHEMA = RESOLUTION_SCHEMA;
export const SEMANTIC_ACTION_CACHE_ACTION_KINDS = Object.freeze([...ACTION_KINDS]);
