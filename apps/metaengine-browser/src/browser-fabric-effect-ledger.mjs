import crypto from 'node:crypto';
import { BROWSER_FABRIC_EXISTING_EFFECT_DOMAINS } from './browser-fabric-effect-domain-policy.mjs';

export const BROWSER_FABRIC_LEDGER_SCHEMA = 'metaengine.browser-fabric.effect-ledger.v1';
export const BROWSER_FABRIC_LEDGER_EVENT_SCHEMA = 'metaengine.browser-fabric.effect-event.v1';
export const BROWSER_FABRIC_REDUCER_VERSION = '1.1.0';

export const FABRIC_EVENT_TYPES = Object.freeze([
  'INTENT',
  'CAPABILITY',
  'ATTEMPT',
  'READBACK',
  'OUTCOME',
]);

export const FABRIC_OUTCOMES = Object.freeze([
  'CONFIRMED',
  'ABSENT_PROVEN',
  'AMBIGUOUS',
  'CONFLICT',
  'CORRUPT',
]);

const TERMINAL_OUTCOMES = new Set(['CONFIRMED', 'ABSENT_PROVEN', 'CONFLICT', 'CORRUPT']);
const SHA256 = /^[0-9a-f]{64}$/;
const EFFECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,191}$/;
const DOMAIN = /^[A-Z][A-Z0-9_]{1,63}$/;
const KNOWN_EFFECT_DOMAINS = new Set(BROWSER_FABRIC_EXISTING_EFFECT_DOMAINS);
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const EVENT_KEYS = new Set([
  'schema', 'sequence', 'effect_id', 'domain', 'type', 'occurred_at',
  'previous_event_sha256', 'material', 'event_sha256',
]);

function deepCanonical(value) {
  if (Array.isArray(value)) return value.map(deepCanonical);
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort((left, right) => left.localeCompare(right));
    return Object.fromEntries(keys.map((key) => [key, deepCanonical(value[key])]));
  }
  return value;
}

export function canonicalFabricJson(value) {
  return JSON.stringify(deepCanonical(value));
}

export function fabricSha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function hash(value) {
  return typeof value === 'string' && SHA256.test(value);
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function exactKeys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length <= allowed.size && keys.every((key) => allowed.has(key));
}

function exactEventKeys(event) {
  return exactKeys(event, EVENT_KEYS) && Object.keys(event).length === EVENT_KEYS.size;
}

function utcMillis(value) {
  if (typeof value !== 'string' || !UTC.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function eventDigestMaterial(event) {
  return {
    schema: event.schema,
    sequence: event.sequence,
    effect_id: event.effect_id,
    domain: event.domain,
    type: event.type,
    occurred_at: event.occurred_at,
    previous_event_sha256: event.previous_event_sha256,
    material: event.material,
  };
}

export function createFabricLedgerEvent({
  sequence,
  effect_id,
  domain,
  type,
  occurred_at,
  previous_event_sha256 = null,
  material,
} = {}) {
  const event = {
    schema: BROWSER_FABRIC_LEDGER_EVENT_SCHEMA,
    sequence,
    effect_id: String(effect_id || ''),
    domain: String(domain || ''),
    type: String(type || ''),
    occurred_at: String(occurred_at || ''),
    previous_event_sha256: previous_event_sha256 == null ? null : String(previous_event_sha256),
    material: deepCanonical(material),
  };
  event.event_sha256 = fabricSha256(canonicalFabricJson(eventDigestMaterial(event)));
  return Object.freeze(deepCanonical(event));
}

function validIntent(material) {
  const allowed = new Set([
    'effect_kind', 'idempotency_key', 'plan_digest', 'generation', 'policy_hash',
    'non_idempotent', 'desired_state_digest', 'trace_id',
  ]);
  return exactKeys(material, allowed)
    && typeof material.effect_kind === 'string' && material.effect_kind.length > 0
    && typeof material.idempotency_key === 'string' && material.idempotency_key.length >= 8
    && hash(material.plan_digest)
    && positiveInteger(material.generation)
    && hash(material.policy_hash)
    && typeof material.non_idempotent === 'boolean'
    && (material.desired_state_digest == null || hash(material.desired_state_digest))
    && (material.trace_id == null || /^[0-9a-f]{32}$/.test(material.trace_id));
}

function validCapability(material, intent) {
  const allowed = new Set([
    'capability_id', 'capability_digest', 'verified', 'audience', 'subject_device',
    'task_id', 'claim_generation', 'browser_context_id', 'target_id',
    'target_incarnation', 'action', 'deadline', 'idempotency_key', 'policy_hash',
    'plan_digest', 'nonce', 'max_uses', 'retry_budget', 'delegation_depth',
    'parent_capability_digest', 'effect_id', 'issuer', 'key_id',
  ]);
  if (!exactKeys(material, allowed) || material.verified !== true) return false;
  if (typeof material.capability_id !== 'string' || material.capability_id.length < 8) return false;
  if (!hash(material.capability_digest) || !hash(material.policy_hash) || !hash(material.plan_digest)) return false;
  if (material.policy_hash !== intent.policy_hash
      || material.plan_digest !== intent.plan_digest
      || material.idempotency_key !== intent.idempotency_key) return false;
  if (!positiveInteger(material.claim_generation) || utcMillis(material.deadline) == null) return false;
  if (typeof material.nonce !== 'string' || material.nonce.length < 8
      || material.max_uses !== 1
      || material.retry_budget !== 0
      || material.delegation_depth !== 0
      || material.parent_capability_digest !== null) return false;
  const requiredStrings = [
    'audience', 'subject_device', 'task_id', 'browser_context_id', 'target_id',
    'target_incarnation', 'action', 'issuer', 'key_id',
  ];
  return requiredStrings.every((key) => typeof material[key] === 'string' && material[key].length > 0);
}

function validAttempt(material) {
  const allowed = new Set([
    'attempt_id', 'actuator_id', 'dispatched_at', 'capability_digest', 'nonce',
    'target_incarnation',
  ]);
  return exactKeys(material, allowed)
    && typeof material.attempt_id === 'string' && material.attempt_id.length >= 8
    && typeof material.actuator_id === 'string' && material.actuator_id.length > 0
    && utcMillis(material.dispatched_at) != null
    && hash(material.capability_digest)
    && typeof material.nonce === 'string' && material.nonce.length >= 8
    && typeof material.target_incarnation === 'string' && material.target_incarnation.length > 0;
}

function validReadback(material, attempt) {
  const allowed = new Set([
    'observer_id', 'observer_independent', 'observed_at', 'evidence_digest',
    'observed_state', 'target_incarnation',
  ]);
  return exactKeys(material, allowed)
    && typeof material.observer_id === 'string' && material.observer_id.length > 0
    && material.observer_independent === true
    && material.observer_id !== attempt.actuator_id
    && utcMillis(material.observed_at) != null
    && hash(material.evidence_digest)
    && typeof material.observed_state === 'string' && material.observed_state.length > 0
    && material.target_incarnation === attempt.target_incarnation;
}

function validOutcome(material) {
  const allowed = new Set(['state', 'reason', 'readback_evidence_digest', 'automatic_retry_allowed']);
  return exactKeys(material, allowed)
    && FABRIC_OUTCOMES.includes(material.state)
    && typeof material.reason === 'string' && material.reason.length > 0
    && (material.readback_evidence_digest == null || hash(material.readback_evidence_digest))
    && material.automatic_retry_allowed === false;
}

function violation(reason, index, effectId = null) {
  return Object.freeze({ ok: false, reason, event_index: index, effect_id: effectId, authority_effect: false });
}

function freshProjection(domain) {
  return {
    domain,
    next_sequence: 1,
    last_event_sha256: null,
    last_event_ms: null,
    intent: null,
    capability: null,
    capability_recorded_ms: null,
    attempt: null,
    readbacks: [],
    outcome: null,
    outcomes: [],
    ambiguous_event_sequence: null,
    ambiguity_reconciled: false,
  };
}

function validateEventEnvelope(event, state) {
  if (!event || event.schema !== BROWSER_FABRIC_LEDGER_EVENT_SCHEMA || !exactEventKeys(event)) return 'EVENT_SCHEMA_INVALID';
  if (event.sequence !== state.next_sequence) return 'EVENT_SEQUENCE_GAP';
  if (!EFFECT_ID.test(String(event.effect_id || ''))) return 'EFFECT_ID_INVALID';
  if (!DOMAIN.test(String(event.domain || ''))) return 'EFFECT_DOMAIN_INVALID';
  if (!KNOWN_EFFECT_DOMAINS.has(event.domain)) return 'EFFECT_DOMAIN_NOT_REGISTERED';
  if (!FABRIC_EVENT_TYPES.includes(event.type)) return 'EVENT_TYPE_INVALID';
  const eventMs = utcMillis(event.occurred_at);
  if (eventMs == null) return 'EVENT_TIME_INVALID';
  if (state.last_event_ms != null && eventMs < state.last_event_ms) return 'EVENT_TIME_REGRESSION';
  if (event.previous_event_sha256 !== state.last_event_sha256) return 'EVENT_CHAIN_PREVIOUS_DIGEST_MISMATCH';
  const calculated = fabricSha256(canonicalFabricJson(eventDigestMaterial(event)));
  return event.event_sha256 === calculated ? null : 'EVENT_DIGEST_MISMATCH';
}

function applyIntent(state, event) {
  if (state.intent) return 'DUPLICATE_INTENT';
  if (!validIntent(event.material)) return 'INTENT_INVALID';
  state.intent = Object.freeze({ ...event.material, domain: event.domain });
  return null;
}

function applyCapability(state, event, eventMs) {
  if (!state.intent) return 'CAPABILITY_WITHOUT_INTENT';
  if (state.capability) return 'DUPLICATE_CAPABILITY';
  if (event.material == null
      || event.material.effect_id !== event.effect_id
      || !validCapability(event.material, state.intent)) return 'CAPABILITY_INVALID_OR_UNBOUND';
  if (eventMs >= utcMillis(event.material.deadline)) return 'CAPABILITY_RECORDED_AFTER_DEADLINE';
  state.capability = Object.freeze({ ...event.material });
  state.capability_recorded_ms = eventMs;
  return null;
}

function applyAttempt(state, event, eventMs) {
  if (!state.intent || !state.capability) return 'ATTEMPT_WITHOUT_VERIFIED_CAPABILITY';
  if (state.attempt) return 'SECOND_ATTEMPT_FORBIDDEN';
  if (!validAttempt(event.material)) return 'ATTEMPT_INVALID';
  if (event.material.capability_digest !== state.capability.capability_digest
      || event.material.nonce !== state.capability.nonce
      || event.material.target_incarnation !== state.capability.target_incarnation) {
    return 'ATTEMPT_CAPABILITY_BINDING_MISMATCH';
  }
  const dispatchedMs = utcMillis(event.material.dispatched_at);
  if (dispatchedMs < state.capability_recorded_ms || dispatchedMs > eventMs) return 'ATTEMPT_TIME_ORDER_INVALID';
  if (dispatchedMs >= utcMillis(state.capability.deadline)) return 'ATTEMPT_CAPABILITY_EXPIRED';
  state.attempt = Object.freeze({ ...event.material, event_sequence: event.sequence });
  return null;
}

function applyReadback(state, event, eventMs) {
  if (!state.attempt) return 'READBACK_WITHOUT_ATTEMPT';
  if (!validReadback(event.material, state.attempt)) return 'READBACK_NOT_INDEPENDENT_OR_INVALID';
  const observedMs = utcMillis(event.material.observed_at);
  if (observedMs < utcMillis(state.attempt.dispatched_at) || observedMs > eventMs) return 'READBACK_TIME_ORDER_INVALID';
  state.readbacks.push(Object.freeze({ ...event.material, event_sequence: event.sequence }));
  return null;
}

function exactReadback(state, evidenceDigest, afterSequence = 0) {
  return state.readbacks.some((row) => row.evidence_digest === evidenceDigest
    && row.event_sequence > afterSequence);
}

function applyOutcome(state, event) {
  if (!state.intent) return 'OUTCOME_WITHOUT_INTENT';
  if (!state.attempt) return 'OUTCOME_WITHOUT_ATTEMPT';
  if (!validOutcome(event.material)) return 'OUTCOME_INVALID';
  const outcomeState = event.material.state;
  const evidence = event.material.readback_evidence_digest;

  if (state.outcome && state.outcome.state !== 'AMBIGUOUS') return 'EFFECT_ALREADY_TERMINAL';
  if (state.outcome && outcomeState === 'AMBIGUOUS') return 'DUPLICATE_AMBIGUOUS_OUTCOME';
  if (outcomeState === 'AMBIGUOUS') {
    if (evidence != null && !exactReadback(state, evidence)) return 'AMBIGUOUS_EVIDENCE_UNBOUND';
    state.ambiguous_event_sequence = event.sequence;
  } else {
    const afterSequence = state.outcome == null ? 0 : state.ambiguous_event_sequence;
    if (!evidence || !exactReadback(state, evidence, afterSequence)) {
      if (state.outcome != null) return 'RECONCILIATION_WITHOUT_NEW_EXACT_READBACK';
      return ['CONFIRMED', 'ABSENT_PROVEN'].includes(outcomeState)
        ? 'POSITIVE_OUTCOME_WITHOUT_EXACT_READBACK'
        : 'TERMINAL_OUTCOME_WITHOUT_EXACT_READBACK';
    }
    state.ambiguity_reconciled = state.outcome != null;
  }

  const recorded = Object.freeze({ ...event.material, event_sequence: event.sequence });
  state.outcomes.push(recorded);
  state.outcome = recorded;
  return null;
}

function applyEvent(state, event, eventMs) {
  if (state.domain !== event.domain) return 'EFFECT_DOMAIN_DRIFT';
  if (state.outcome && TERMINAL_OUTCOMES.has(state.outcome.state)) return 'EFFECT_ALREADY_TERMINAL';
  if (state.outcome && state.outcome.state === 'AMBIGUOUS' && !['READBACK', 'OUTCOME'].includes(event.type)) {
    return 'AMBIGUOUS_EFFECT_RECONCILIATION_ONLY';
  }
  if (event.type === 'INTENT') return applyIntent(state, event);
  if (event.type === 'CAPABILITY') return applyCapability(state, event, eventMs);
  if (event.type === 'ATTEMPT') return applyAttempt(state, event, eventMs);
  if (event.type === 'READBACK') return applyReadback(state, event, eventMs);
  if (event.type === 'OUTCOME') return applyOutcome(state, event);
  return 'EVENT_TYPE_UNREACHABLE';
}

function publicProjection(state) {
  const terminal = state.outcome != null && TERMINAL_OUTCOMES.has(state.outcome.state);
  return Object.freeze({
    domain: state.domain,
    intent: state.intent,
    capability: state.capability,
    attempt: state.attempt,
    readbacks: Object.freeze([...state.readbacks]),
    outcomes: Object.freeze([...state.outcomes]),
    outcome: state.outcome,
    terminal,
    terminal_ambiguous: state.outcome != null && state.outcome.state === 'AMBIGUOUS',
    ambiguity_reconciled: state.ambiguity_reconciled,
    reconciliation_required: state.outcome != null && state.outcome.state === 'AMBIGUOUS',
    queue_delivery_authority: false,
    automatic_retry_allowed: false,
  });
}

/**
 * Deterministic, side-effect-free reducer for the engine-neutral causal ledger.
 * The reducer never executes effects or infers success from delivery. An
 * ambiguous attempt can only converge through a new independent readback and
 * one terminal classification; it can never authorize another attempt.
 */
export function reduceFabricEffectLedger(events = []) {
  if (!Array.isArray(events)) return violation('LEDGER_EVENTS_NOT_ARRAY', -1);
  const effects = new Map();
  let lastInputDigest = null;

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const effectId = event && typeof event.effect_id === 'string' ? event.effect_id : '';
    const state = effects.get(effectId) || freshProjection(event && event.domain);
    const envelopeViolation = validateEventEnvelope(event, state);
    if (envelopeViolation) return violation(envelopeViolation, index, event == null ? null : event.effect_id);
    const eventMs = utcMillis(event.occurred_at);
    const applyViolation = applyEvent(state, event, eventMs);
    if (applyViolation) return violation(applyViolation, index, event.effect_id);
    state.next_sequence += 1;
    state.last_event_sha256 = event.event_sha256;
    state.last_event_ms = eventMs;
    effects.set(event.effect_id, state);
    lastInputDigest = event.event_sha256;
  }

  const ordered = [...effects.entries()].sort(([left], [right]) => left.localeCompare(right));
  const projection = Object.fromEntries(ordered.map(([effectId, state]) => [effectId, publicProjection(state)]));
  const chainHeads = Object.fromEntries(ordered.map(([effectId, state]) => [effectId, state.last_event_sha256]));
  const projectionDigest = fabricSha256(canonicalFabricJson(projection));
  return Object.freeze({
    ok: true,
    schema: BROWSER_FABRIC_LEDGER_SCHEMA,
    reducer_version: BROWSER_FABRIC_REDUCER_VERSION,
    event_count: events.length,
    last_input_event_sha256: lastInputDigest,
    per_effect_chain_heads: Object.freeze(chainHeads),
    projection: Object.freeze(projection),
    projection_sha256: projectionDigest,
    queue_delivery_authority: false,
    realtime_event_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function browserFabricLedgerContract() {
  return Object.freeze({
    schema: BROWSER_FABRIC_LEDGER_SCHEMA,
    version: BROWSER_FABRIC_REDUCER_VERSION,
    append_only: true,
    deterministic_reducer: true,
    per_effect_hash_chained_events: true,
    globally_serialized_hash_chain: false,
    monotonic_event_time_required: true,
    effect_domain_immutable: true,
    intent_before_authority: true,
    signed_plan_digest_bound_to_intent: true,
    verified_capability_before_attempt: true,
    capability_deadline_bounds_attempt: true,
    one_attempt_per_effect: true,
    independent_readback_required_for_terminal_outcome: true,
    ambiguity_reconciliation_requires_new_readback: true,
    explicit_conflict_and_corrupt_outcomes: true,
    ambiguous_retry_allowed: false,
    queue_delivery_authority: false,
    realtime_event_authority: false,
    existing_domain_journals_are_boundary_adapters: true,
    authority_effect: false,
  });
}
