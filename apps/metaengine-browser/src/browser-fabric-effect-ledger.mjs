import crypto from 'node:crypto';

export const BROWSER_FABRIC_LEDGER_SCHEMA = 'metaengine.browser-fabric.effect-ledger.v1';
export const BROWSER_FABRIC_LEDGER_EVENT_SCHEMA = 'metaengine.browser-fabric.effect-event.v1';
export const BROWSER_FABRIC_REDUCER_VERSION = '1.0.0';

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
  'RECONCILE',
]);

const SHA256 = /^[0-9a-f]{64}$/;
const EFFECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,191}$/;
const DOMAIN = /^[A-Z][A-Z0-9_]{1,63}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

function deepCanonical(value) {
  if (Array.isArray(value)) return value.map(deepCanonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, deepCanonical(value[key])]));
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
  return Object.keys(value).every((key) => allowed.has(key));
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
    'effect_id', 'issuer', 'key_id',
  ]);
  if (!exactKeys(material, allowed) || material.verified !== true) return false;
  if (typeof material.capability_id !== 'string' || material.capability_id.length < 8) return false;
  if (!hash(material.capability_digest) || !hash(material.policy_hash)) return false;
  if (material.policy_hash !== intent.policy_hash || material.idempotency_key !== intent.idempotency_key) return false;
  if (!positiveInteger(material.claim_generation) || !UTC.test(String(material.deadline || ''))) return false;
  for (const key of ['audience', 'subject_device', 'task_id', 'browser_context_id', 'target_id', 'target_incarnation', 'action', 'issuer', 'key_id']) {
    if (typeof material[key] !== 'string' || material[key].length === 0) return false;
  }
  return true;
}

function validAttempt(material) {
  const allowed = new Set(['attempt_id', 'actuator_id', 'dispatched_at', 'capability_digest', 'target_incarnation']);
  return exactKeys(material, allowed)
    && typeof material.attempt_id === 'string' && material.attempt_id.length >= 8
    && typeof material.actuator_id === 'string' && material.actuator_id.length > 0
    && UTC.test(String(material.dispatched_at || ''))
    && hash(material.capability_digest)
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
    && UTC.test(String(material.observed_at || ''))
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

function freshProjection() {
  return {
    intent: null,
    capability: null,
    attempt: null,
    readbacks: [],
    outcome: null,
    terminal_ambiguous: false,
    queue_delivery_authority: false,
    automatic_retry_allowed: false,
  };
}

/**
 * Deterministic, side-effect-free reducer for the engine-neutral causal ledger.
 * The reducer deliberately does not execute effects, fetch policy, read a queue,
 * or infer success from delivery. A queue wake-up can carry effect_id only.
 */
export function reduceFabricEffectLedger(events = []) {
  if (!Array.isArray(events)) return violation('LEDGER_EVENTS_NOT_ARRAY', -1);

  const effects = new Map();
  let expectedSequence = 1;
  let previousDigest = null;

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    if (!event || event.schema !== BROWSER_FABRIC_LEDGER_EVENT_SCHEMA) return violation('EVENT_SCHEMA_INVALID', i);
    if (event.sequence !== expectedSequence) return violation('EVENT_SEQUENCE_GAP', i, event.effect_id);
    if (!EFFECT_ID.test(String(event.effect_id || ''))) return violation('EFFECT_ID_INVALID', i, event.effect_id);
    if (!DOMAIN.test(String(event.domain || ''))) return violation('EFFECT_DOMAIN_INVALID', i, event.effect_id);
    if (!FABRIC_EVENT_TYPES.includes(event.type)) return violation('EVENT_TYPE_INVALID', i, event.effect_id);
    if (!UTC.test(String(event.occurred_at || ''))) return violation('EVENT_TIME_INVALID', i, event.effect_id);
    if (event.previous_event_sha256 !== previousDigest) return violation('EVENT_CHAIN_PREVIOUS_DIGEST_MISMATCH', i, event.effect_id);
    const calculated = fabricSha256(canonicalFabricJson(eventDigestMaterial(event)));
    if (event.event_sha256 !== calculated) return violation('EVENT_DIGEST_MISMATCH', i, event.effect_id);

    const state = effects.get(event.effect_id) || freshProjection();
    if (state.outcome && event.type !== 'READBACK') return violation('EFFECT_ALREADY_OUTCOME_CLASSIFIED', i, event.effect_id);

    if (event.type === 'INTENT') {
      if (state.intent) return violation('DUPLICATE_INTENT', i, event.effect_id);
      if (!validIntent(event.material)) return violation('INTENT_INVALID', i, event.effect_id);
      state.intent = Object.freeze({ ...event.material, domain: event.domain });
    } else if (event.type === 'CAPABILITY') {
      if (!state.intent) return violation('CAPABILITY_WITHOUT_INTENT', i, event.effect_id);
      if (state.capability) return violation('DUPLICATE_CAPABILITY', i, event.effect_id);
      if (event.material?.effect_id !== event.effect_id || !validCapability(event.material, state.intent)) {
        return violation('CAPABILITY_INVALID_OR_UNBOUND', i, event.effect_id);
      }
      state.capability = Object.freeze({ ...event.material });
    } else if (event.type === 'ATTEMPT') {
      if (!state.intent || !state.capability) return violation('ATTEMPT_WITHOUT_VERIFIED_CAPABILITY', i, event.effect_id);
      if (state.attempt) return violation('SECOND_ATTEMPT_FORBIDDEN', i, event.effect_id);
      if (!validAttempt(event.material)) return violation('ATTEMPT_INVALID', i, event.effect_id);
      if (event.material.capability_digest !== state.capability.capability_digest
          || event.material.target_incarnation !== state.capability.target_incarnation) {
        return violation('ATTEMPT_CAPABILITY_BINDING_MISMATCH', i, event.effect_id);
      }
      state.attempt = Object.freeze({ ...event.material });
    } else if (event.type === 'READBACK') {
      if (!state.attempt) return violation('READBACK_WITHOUT_ATTEMPT', i, event.effect_id);
      if (!validReadback(event.material, state.attempt)) return violation('READBACK_NOT_INDEPENDENT_OR_INVALID', i, event.effect_id);
      state.readbacks.push(Object.freeze({ ...event.material }));
    } else if (event.type === 'OUTCOME') {
      if (!state.intent) return violation('OUTCOME_WITHOUT_INTENT', i, event.effect_id);
      if (!validOutcome(event.material)) return violation('OUTCOME_INVALID', i, event.effect_id);
      if (['CONFIRMED', 'ABSENT_PROVEN'].includes(event.material.state)) {
        const evidence = event.material.readback_evidence_digest;
        if (!evidence || !state.readbacks.some((row) => row.evidence_digest === evidence)) {
          return violation('POSITIVE_OUTCOME_WITHOUT_EXACT_READBACK', i, event.effect_id);
        }
      }
      if (event.material.state === 'AMBIGUOUS' && event.material.automatic_retry_allowed !== false) {
        return violation('AMBIGUOUS_RETRY_FORBIDDEN', i, event.effect_id);
      }
      state.outcome = Object.freeze({ ...event.material });
      state.terminal_ambiguous = event.material.state === 'AMBIGUOUS';
    }

    effects.set(event.effect_id, state);
    previousDigest = event.event_sha256;
    expectedSequence += 1;
  }

  const projection = Object.fromEntries([...effects.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([effectId, state]) => [effectId, Object.freeze({
    intent: state.intent,
    capability: state.capability,
    attempt: state.attempt,
    readbacks: Object.freeze([...state.readbacks]),
    outcome: state.outcome,
    terminal_ambiguous: state.terminal_ambiguous,
    queue_delivery_authority: false,
    automatic_retry_allowed: false,
  })]));
  const projectionDigest = fabricSha256(canonicalFabricJson(projection));

  return Object.freeze({
    ok: true,
    schema: BROWSER_FABRIC_LEDGER_SCHEMA,
    reducer_version: BROWSER_FABRIC_REDUCER_VERSION,
    event_count: events.length,
    last_event_sha256: previousDigest,
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
    hash_chained_events: true,
    intent_before_authority: true,
    verified_capability_before_attempt: true,
    one_attempt_per_effect: true,
    independent_readback_required_for_positive_outcome: true,
    ambiguous_retry_allowed: false,
    queue_delivery_authority: false,
    realtime_event_authority: false,
    existing_domain_journals_are_boundary_adapters: true,
    authority_effect: false,
  });
}
