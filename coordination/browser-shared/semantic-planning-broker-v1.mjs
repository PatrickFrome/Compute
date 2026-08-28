import { assertPerceptionEnvelope } from './perception-envelope-v1.mjs';
import { SemanticActionCache, semanticActionCacheNamespace } from './semantic-action-cache-v1.mjs';

const SCHEMA = 'metaengine.a2-browser-operator.semantic-planning-broker.v1';
const LOOKUP_SCHEMA = 'metaengine.a2-browser-operator.semantic-planning-lookup.v1';
const LEASE_SCHEMA = 'metaengine.a2-browser-operator.semantic-planning-lease.v1';
const CONTEXT_SCHEMA = 'metaengine.a2-browser-operator.semantic-planning-context.v1';
const PROMOTION_SCHEMA = 'metaengine.a2-browser-operator.semantic-planning-promotion.v1';
const DEFAULT_LEASE_TTL_MS = 30_000;
const DEFAULT_MAX_FLIGHTS = 256;
const ACTION_KINDS = new Set(['CLICK', 'FOCUS', 'FILL', 'PRESS', 'SELECT', 'TOGGLE']);

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

function finiteTimestamp(value, code) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(code);
  return n;
}

function normalizeActionKind(value) {
  const kind = String(value ?? '').trim().toUpperCase();
  if (!ACTION_KINDS.has(kind)) throw new Error('semantic_planning_broker_action_kind_invalid');
  return kind;
}

function randomOpaque(prefix) {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID !== 'function') throw new Error('semantic_planning_broker_secure_random_unavailable');
  return `${prefix}_${randomUUID.call(globalThis.crypto).replaceAll('-', '')}`;
}

function flightKey(envelope, intentId, actionKind) {
  const ns = semanticActionCacheNamespace(envelope);
  return [ns.target_id, ns.context_id, ns.conversation_epoch, ns.document_epoch, intentId, actionKind].join('\u001f');
}

function publicBase() {
  return {
    schema: LOOKUP_SCHEMA,
    authority_effect: false,
    actuation_eligible: false,
    revalidation_required: true,
    must_run_actionability_checks: true,
    stores_execution_payload: false
  };
}

export class SemanticPlanningBroker {
  constructor({
    cache = new SemanticActionCache(),
    clock = () => Date.now(),
    leaseTtlMs = DEFAULT_LEASE_TTL_MS,
    maxFlights = DEFAULT_MAX_FLIGHTS,
    flightIdFactory = () => randomOpaque('flight'),
    leaseTokenFactory = () => randomOpaque('lease')
  } = {}) {
    if (!cache || typeof cache.resolve !== 'function' || typeof cache.put !== 'function') throw new Error('semantic_planning_broker_cache_invalid');
    if (typeof clock !== 'function') throw new Error('semantic_planning_broker_clock_invalid');
    if (typeof flightIdFactory !== 'function' || typeof leaseTokenFactory !== 'function') throw new Error('semantic_planning_broker_id_factory_invalid');
    this.cache = cache;
    this.clock = clock;
    this.leaseTtlMs = positiveInt(leaseTtlMs, 'semantic_planning_broker_lease_ttl_invalid');
    this.maxFlights = positiveInt(maxFlights, 'semantic_planning_broker_max_flights_invalid');
    if (this.leaseTtlMs > 10 * 60_000) throw new Error('semantic_planning_broker_lease_ttl_invalid');
    if (this.maxFlights > 100_000) throw new Error('semantic_planning_broker_max_flights_invalid');
    this.flightIdFactory = flightIdFactory;
    this.leaseTokenFactory = leaseTokenFactory;
    this.flightsById = new Map();
    this.flightIdByKey = new Map();
    this.metrics = {
      lookups: 0,
      cache_hits: 0,
      leader_misses: 0,
      waiters: 0,
      lease_preflights: 0,
      context_revalidations: 0,
      context_revalidation_failures: 0,
      promotions: 0,
      promotion_revalidation_failures: 0,
      aborts: 0,
      expirations: 0,
      capacity_rejections: 0,
      lease_rejections: 0
    };
  }

  lookup({ envelope, intentId, actionKind } = {}) {
    const freshEnvelope = assertPerceptionEnvelope(envelope);
    const normalizedIntent = cleanId(intentId, 'semantic_planning_broker_intent_id_invalid');
    const normalizedAction = normalizeActionKind(actionKind);
    const nowMs = finiteTimestamp(this.clock(), 'semantic_planning_broker_clock_invalid');
    this.sweep(nowMs);
    this.metrics.lookups += 1;
    const cached = this.cache.resolve({ envelope: freshEnvelope, intentId: normalizedIntent, actionKind: normalizedAction });
    if (cached.cache_status === 'HIT_REVALIDATED') {
      this.metrics.cache_hits += 1;
      return Object.freeze({ ...publicBase(), status: 'HIT_REVALIDATED', reason: cached.reason, intent_id: normalizedIntent, action_kind: normalizedAction, candidate_ref: cached.candidate_ref, semantic_fingerprint: cached.semantic_fingerprint, locator_fingerprint: cached.locator_fingerprint, model_call_required: false, wait_required: false, flight_id: null, lease_token: null });
    }
    const key = flightKey(freshEnvelope, normalizedIntent, normalizedAction);
    const existingFlightId = this.flightIdByKey.get(key);
    const existing = existingFlightId ? this.flightsById.get(existingFlightId) : null;
    if (existing) {
      this.metrics.waiters += 1;
      return Object.freeze({ ...publicBase(), status: 'WAIT_FOR_PROMOTION', reason: cached.reason, intent_id: normalizedIntent, action_kind: normalizedAction, candidate_ref: null, model_call_required: false, wait_required: true, flight_id: existing.flight_id, lease_token: null, lease_expires_in_ms: Math.max(0, existing.expires_at_ms - nowMs) });
    }
    if (this.flightsById.size >= this.maxFlights) {
      this.metrics.capacity_rejections += 1;
      throw new Error('semantic_planning_broker_capacity_exceeded');
    }
    const flightId = cleanId(this.flightIdFactory(), 'semantic_planning_broker_flight_id_invalid');
    const leaseToken = cleanId(this.leaseTokenFactory(), 'semantic_planning_broker_lease_token_invalid', 512);
    if (this.flightsById.has(flightId)) throw new Error('semantic_planning_broker_flight_id_collision');
    const record = Object.freeze({ key, flight_id: flightId, lease_token: leaseToken, intent_id: normalizedIntent, action_kind: normalizedAction, leader_envelope: freshEnvelope, source_token: String(freshEnvelope.source_token || ''), created_at_ms: nowMs, expires_at_ms: nowMs + this.leaseTtlMs });
    this.flightsById.set(flightId, record);
    this.flightIdByKey.set(key, flightId);
    this.metrics.leader_misses += 1;
    return Object.freeze({ ...publicBase(), status: 'MISS_LEADER', reason: cached.reason, intent_id: normalizedIntent, action_kind: normalizedAction, candidate_ref: null, model_call_required: true, wait_required: false, flight_id: flightId, lease_token: leaseToken, source_token: record.source_token, lease_expires_in_ms: this.leaseTtlMs });
  }

  assertLease({ flightId, leaseToken } = {}) {
    const id = cleanId(flightId, 'semantic_planning_broker_flight_id_invalid');
    const token = cleanId(leaseToken, 'semantic_planning_broker_lease_token_invalid', 512);
    const nowMs = finiteTimestamp(this.clock(), 'semantic_planning_broker_clock_invalid');
    this.sweep(nowMs);
    const flight = this.flightsById.get(id);
    if (!flight || flight.lease_token !== token) {
      this.metrics.lease_rejections += 1;
      throw new Error('semantic_planning_broker_lease_invalid');
    }
    const ns = semanticActionCacheNamespace(flight.leader_envelope);
    this.metrics.lease_preflights += 1;
    return Object.freeze({
      schema: LEASE_SCHEMA,
      status: 'LEASE_VALID',
      flight_id: id,
      intent_id: flight.intent_id,
      action_kind: flight.action_kind,
      target_id: ns.target_id,
      context_id: ns.context_id,
      conversation_epoch: ns.conversation_epoch,
      document_epoch: ns.document_epoch,
      lease_expires_in_ms: Math.max(0, flight.expires_at_ms - nowMs),
      authority_effect: false,
      actuation_eligible: false
    });
  }

  revalidateContext({ flightId, leaseToken, freshEnvelope } = {}) {
    const id = cleanId(flightId, 'semantic_planning_broker_flight_id_invalid');
    const token = cleanId(leaseToken, 'semantic_planning_broker_lease_token_invalid', 512);
    const envelope = assertPerceptionEnvelope(freshEnvelope);
    const nowMs = finiteTimestamp(this.clock(), 'semantic_planning_broker_clock_invalid');
    this.sweep(nowMs);
    const flight = this.flightsById.get(id);
    if (!flight || flight.lease_token !== token) {
      this.metrics.lease_rejections += 1;
      throw new Error('semantic_planning_broker_lease_invalid');
    }
    try {
      const expectedKey = flightKey(envelope, flight.intent_id, flight.action_kind);
      if (expectedKey !== flight.key) throw new Error('semantic_planning_broker_namespace_changed');
      this.metrics.context_revalidations += 1;
      return Object.freeze({ schema: CONTEXT_SCHEMA, status: 'CONTEXT_REVALIDATED', flight_id: id, intent_id: flight.intent_id, action_kind: flight.action_kind, document_epoch: envelope.document_epoch, authority_effect: false, actuation_eligible: false, stores_execution_payload: false });
    } catch (error) {
      this.metrics.context_revalidation_failures += 1;
      throw error;
    }
  }

  promote({ flightId, leaseToken, candidateRef, freshEnvelope } = {}) {
    const id = cleanId(flightId, 'semantic_planning_broker_flight_id_invalid');
    const token = cleanId(leaseToken, 'semantic_planning_broker_lease_token_invalid', 512);
    const candidate = cleanId(candidateRef, 'semantic_planning_broker_candidate_ref_invalid');
    const envelope = assertPerceptionEnvelope(freshEnvelope);
    const nowMs = finiteTimestamp(this.clock(), 'semantic_planning_broker_clock_invalid');
    this.sweep(nowMs);
    const flight = this.flightsById.get(id);
    if (!flight || flight.lease_token !== token) {
      this.metrics.lease_rejections += 1;
      throw new Error('semantic_planning_broker_lease_invalid');
    }
    try {
      const expectedKey = flightKey(envelope, flight.intent_id, flight.action_kind);
      if (expectedKey !== flight.key) throw new Error('semantic_planning_broker_namespace_changed');
      const probe = new SemanticActionCache({ maxEntries: 1, maxAgeMs: this.leaseTtlMs, clock: this.clock });
      probe.put({ envelope: flight.leader_envelope, intentId: flight.intent_id, actionKind: flight.action_kind, nodeRef: candidate });
      const revalidated = probe.resolve({ envelope, intentId: flight.intent_id, actionKind: flight.action_kind });
      if (revalidated.cache_status !== 'HIT_REVALIDATED') throw new Error(`semantic_planning_broker_target_not_revalidated:${revalidated.reason}`);
      this.cache.put({ envelope, intentId: flight.intent_id, actionKind: flight.action_kind, nodeRef: revalidated.candidate_ref });
      this.metrics.promotions += 1;
      return Object.freeze({ schema: PROMOTION_SCHEMA, status: 'PROMOTED_REVALIDATED', flight_id: id, intent_id: flight.intent_id, action_kind: flight.action_kind, candidate_ref: revalidated.candidate_ref, revalidation_reason: revalidated.reason, authority_effect: false, actuation_eligible: false, must_run_actionability_checks: true, stores_execution_payload: false });
    } catch (error) {
      this.metrics.promotion_revalidation_failures += 1;
      throw error;
    } finally {
      this.#removeFlight(id);
    }
  }

  abort({ flightId, leaseToken, reasonCode = 'PLANNER_ABORTED' } = {}) {
    const id = cleanId(flightId, 'semantic_planning_broker_flight_id_invalid');
    const token = cleanId(leaseToken, 'semantic_planning_broker_lease_token_invalid', 512);
    const reason = cleanId(reasonCode, 'semantic_planning_broker_abort_reason_invalid', 128);
    const flight = this.flightsById.get(id);
    if (!flight || flight.lease_token !== token) {
      this.metrics.lease_rejections += 1;
      throw new Error('semantic_planning_broker_lease_invalid');
    }
    this.#removeFlight(id);
    this.metrics.aborts += 1;
    return Object.freeze({ schema: PROMOTION_SCHEMA, status: 'ABORTED', flight_id: id, reason_code: reason, authority_effect: false, actuation_eligible: false });
  }

  sweep(nowValue = this.clock()) {
    const nowMs = finiteTimestamp(nowValue, 'semantic_planning_broker_clock_invalid');
    let removed = 0;
    for (const [id, flight] of this.flightsById.entries()) {
      if (flight.expires_at_ms > nowMs) continue;
      this.#removeFlight(id);
      removed += 1;
    }
    this.metrics.expirations += removed;
    return removed;
  }

  clear() {
    const removed = this.flightsById.size;
    this.flightsById.clear();
    this.flightIdByKey.clear();
    return removed;
  }

  snapshot() {
    return Object.freeze({ schema: SCHEMA, authority_effect: false, actuation_eligible: false, stores_execution_payload: false, stores_perception_persistently: false, in_flight_count: this.flightsById.size, max_flights: this.maxFlights, lease_ttl_ms: this.leaseTtlMs, metrics: { ...this.metrics }, cache: this.cache.snapshot() });
  }

  #removeFlight(id) {
    const flight = this.flightsById.get(id);
    if (!flight) return false;
    this.flightsById.delete(id);
    if (this.flightIdByKey.get(flight.key) === id) this.flightIdByKey.delete(flight.key);
    return true;
  }
}

export const SEMANTIC_PLANNING_BROKER_SCHEMA = SCHEMA;
export const SEMANTIC_PLANNING_LOOKUP_SCHEMA = LOOKUP_SCHEMA;
export const SEMANTIC_PLANNING_LEASE_SCHEMA = LEASE_SCHEMA;
export const SEMANTIC_PLANNING_CONTEXT_SCHEMA = CONTEXT_SCHEMA;
export const SEMANTIC_PLANNING_PROMOTION_SCHEMA = PROMOTION_SCHEMA;
