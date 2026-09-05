import crypto from 'node:crypto';

export const EFFECT_EVENT_TYPES = Object.freeze({
  INTENT: 'INTENT',
  CAPABILITY: 'CAPABILITY',
  ATTEMPT: 'ATTEMPT',
  READBACK: 'READBACK',
  OUTCOME: 'OUTCOME',
});

export const EFFECT_OUTCOMES = Object.freeze({
  CONFIRMED: 'CONFIRMED',
  ABSENT_PROVEN: 'ABSENT_PROVEN',
  CONFLICT: 'CONFLICT',
  CORRUPT: 'CORRUPT',
  AMBIGUOUS: 'AMBIGUOUS',
  RECONCILE: 'RECONCILE',
});

const EVENT_TYPES = new Set(Object.values(EFFECT_EVENT_TYPES));
const OUTCOMES = new Set(Object.values(EFFECT_OUTCOMES));
const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function nonEmpty(value, reason) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(reason);
  return normalized;
}

function positiveInt(value, reason) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) throw new Error(reason);
  return normalized;
}

export function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function sha256Canonical(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

export function intentMaterial(value = {}) {
  const effectId = nonEmpty(value.effect_id, 'effect_intent_id_required');
  if (!UUID.test(effectId)) throw new Error('effect_intent_id_invalid');
  const material = Object.freeze({
    effect_id: effectId.toLowerCase(),
    domain: nonEmpty(value.domain, 'effect_domain_required').toUpperCase(),
    idempotency_key: nonEmpty(value.idempotency_key, 'effect_idempotency_key_required'),
    generation: positiveInt(value.generation, 'effect_generation_invalid'),
    policy_hash: nonEmpty(value.policy_hash, 'effect_policy_hash_required').toLowerCase(),
    plan: stableValue(value.plan),
    non_idempotent: value.non_idempotent === true,
  });
  if (!SHA256.test(material.policy_hash)) throw new Error('effect_policy_hash_invalid');
  return Object.freeze({ ...material, plan_digest: sha256Canonical(material.plan) });
}

export function queueEnvelope(intent) {
  const exact = intentMaterial(intent);
  return Object.freeze({
    schema: 'metaengine.sovereign-effect-delivery.v1',
    effect_id: exact.effect_id,
    authority_effect: false,
    contains_authority: false,
  });
}

export function appendEvent(history, event) {
  const prior = Array.isArray(history) ? history.map((row) => Object.freeze({ ...row })) : [];
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('effect_event_invalid');
  const eventType = nonEmpty(event.event_type, 'effect_event_type_required').toUpperCase();
  if (!EVENT_TYPES.has(eventType)) throw new Error('effect_event_type_invalid');
  const effectId = nonEmpty(event.effect_id, 'effect_event_id_required').toLowerCase();
  if (!UUID.test(effectId)) throw new Error('effect_event_id_invalid');
  if (prior.some((row) => row.effect_id !== effectId)) throw new Error('effect_history_mixed_effect_ids');

  const sequence = prior.length + 1;
  const immutable = Object.freeze({
    schema: 'metaengine.sovereign-effect-event.v1',
    sequence,
    effect_id: effectId,
    event_type: eventType,
    payload: stableValue(event.payload ?? {}),
  });

  const projection = reduceEffect([...prior, immutable]);
  if (eventType === EFFECT_EVENT_TYPES.INTENT && projection.intent_count > 1) throw new Error('effect_duplicate_intent');
  if (eventType === EFFECT_EVENT_TYPES.ATTEMPT && projection.attempt_count > 1 && projection.non_idempotent) {
    throw new Error('effect_non_idempotent_second_attempt_forbidden');
  }
  if (prior.some((row) => row.event_type === EFFECT_EVENT_TYPES.OUTCOME)) throw new Error('effect_history_terminal');
  return Object.freeze([...prior, immutable]);
}

export function reduceEffect(history = []) {
  let effectId = null;
  let intent = null;
  let capability = null;
  let attempt = null;
  let readback = null;
  let outcome = null;
  let intentCount = 0;
  let attemptCount = 0;

  for (let index = 0; index < history.length; index += 1) {
    const row = history[index];
    if (!row || row.schema !== 'metaengine.sovereign-effect-event.v1') throw new Error('effect_history_schema_invalid');
    if (Number(row.sequence) !== index + 1) throw new Error('effect_history_sequence_invalid');
    if (!effectId) effectId = row.effect_id;
    if (row.effect_id !== effectId) throw new Error('effect_history_mixed_effect_ids');
    switch (row.event_type) {
      case EFFECT_EVENT_TYPES.INTENT:
        intentCount += 1;
        intent = row.payload;
        break;
      case EFFECT_EVENT_TYPES.CAPABILITY:
        capability = row.payload;
        break;
      case EFFECT_EVENT_TYPES.ATTEMPT:
        attemptCount += 1;
        attempt = row.payload;
        break;
      case EFFECT_EVENT_TYPES.READBACK:
        readback = row.payload;
        break;
      case EFFECT_EVENT_TYPES.OUTCOME: {
        const exactOutcome = nonEmpty(row.payload?.outcome, 'effect_outcome_required').toUpperCase();
        if (!OUTCOMES.has(exactOutcome)) throw new Error('effect_outcome_invalid');
        outcome = { ...row.payload, outcome: exactOutcome };
        break;
      }
      default:
        throw new Error('effect_event_type_invalid');
    }
  }

  const nonIdempotent = intent?.non_idempotent === true;
  const resolved = Boolean(outcome && outcome.outcome !== EFFECT_OUTCOMES.RECONCILE);
  const ambiguous = outcome?.outcome === EFFECT_OUTCOMES.AMBIGUOUS;
  return Object.freeze({
    effect_id: effectId,
    intent,
    capability,
    attempt,
    readback,
    outcome,
    intent_count: intentCount,
    attempt_count: attemptCount,
    non_idempotent: nonIdempotent,
    resolved,
    ambiguous,
    automatic_retry_allowed: false,
    retry_eligible: outcome?.outcome === EFFECT_OUTCOMES.ABSENT_PROVEN,
    queue_authority: false,
  });
}

export function classifyReadback({ effect_present, exact, conflict, corrupt, authoritative_absence, readback_complete } = {}) {
  if (corrupt === true) return EFFECT_OUTCOMES.CORRUPT;
  if (conflict === true) return EFFECT_OUTCOMES.CONFLICT;
  if (effect_present === true && exact === true) return EFFECT_OUTCOMES.CONFIRMED;
  if (effect_present === false && authoritative_absence === true && readback_complete === true) return EFFECT_OUTCOMES.ABSENT_PROVEN;
  return EFFECT_OUTCOMES.AMBIGUOUS;
}

export const SOVEREIGN_EFFECT_LEDGER_CONTRACT = Object.freeze({
  schema: 'metaengine.sovereign-effect-ledger-contract.v1',
  append_only: true,
  queue_contains_effect_id_only: true,
  queue_authority: false,
  non_idempotent_attempts_max: 1,
  independent_readback_required: true,
  ambiguous_retry_allowed: false,
  deterministic_reducer: true,
  authority_effect: false,
});
