import crypto from 'node:crypto';

// B7-PRE1 — Durable Effect Ledger contract (shared plane).
//
// Purpose: one normalized identity envelope + one hash-chained append-only
// event schema for every consequential effect in the compute browser plane.
// The chain makes silent tampering, reordering and tail truncation of the
// effect history detectable; the envelope makes every event joinable across
// planes (supervisor command -> lease -> action -> browser incarnation ->
// context -> target -> receipt) without plane-specific guesswork.
//
// Design constraints (inherited from VERIFIED B-line invariants):
// - The ledger is evidence, never authority: no event can mint a lease,
//   authorize an effect, or promote a candidate.
// - Entries are immutable once appended; the store only ever appends.
// - Canonical JSON must be deterministic and total-ordered (sorted keys),
//   and must reject values that cannot round-trip (undefined, functions,
//   symbols, non-finite numbers, bigints) so digests are stable across
//   Node versions and platforms.

export const EFFECT_LEDGER_ENTRY_SCHEMA = 'metaengine.a2-effect-ledger.entry.v1';
export const EFFECT_LEDGER_FILE_SCHEMA = 'metaengine.a2-effect-ledger.ledger.v1';
export const IDENTITY_ENVELOPE_SCHEMA = 'metaengine.a2-identity-envelope.v1';

export const EFFECT_EVENT_TYPES = Object.freeze([
  'INTENT_SEALED',
  'AUTHORITY_GRANTED',
  'DISPATCH_PREPARED',
  'EFFECT_OBSERVED',
  'RECEIPT_EMITTED',
  'RECOVERY_REQUIRED'
]);

// Identity fields that must be present on every event. Everything else in
// the envelope is optional context that planes attach when they have it.
export const IDENTITY_REQUIRED_FIELDS = Object.freeze([
  'lease_id',
  'action_id',
  'target_id',
  'profile_id'
]);

export const IDENTITY_OPTIONAL_FIELDS = Object.freeze([
  'task_id',
  'proposal_id',
  'command_id',
  'browser_node_id',
  'process_incarnation_id',
  'context_id',
  'context_epoch',
  'target_conversation_epoch',
  'receipt_id'
]);

const SHA256_RE = /^[0-9a-f]{64}$/;

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function canonicalJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new Error('effect_ledger_number_invalid');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (plainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new Error('effect_ledger_value_invalid');
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function optionalString(envelope, key) {
  const raw = envelope[key];
  if (raw === undefined || raw === null) return '';
  const text = String(raw);
  if (text.length > 256 || /[\u0000-\u001f\u007f]/.test(text)) throw new Error(`identity_envelope_${key}_invalid`);
  return text;
}

function optionalEpoch(envelope, key) {
  const raw = envelope[key];
  if (raw === undefined || raw === null || raw === '') return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > 2 ** 31) throw new Error(`identity_envelope_${key}_invalid`);
  return value;
}

export function buildIdentityEnvelope(input = {}) {
  if (!plainObject(input)) throw new Error('identity_envelope_required');
  const envelope = {
    schema: IDENTITY_ENVELOPE_SCHEMA,
    task_id: optionalString(input, 'task_id'),
    proposal_id: optionalString(input, 'proposal_id'),
    command_id: optionalString(input, 'command_id'),
    lease_id: optionalString(input, 'lease_id'),
    action_id: optionalString(input, 'action_id'),
    browser_node_id: optionalString(input, 'browser_node_id'),
    profile_id: optionalString(input, 'profile_id'),
    process_incarnation_id: optionalString(input, 'process_incarnation_id'),
    context_id: optionalString(input, 'context_id'),
    context_epoch: optionalEpoch(input, 'context_epoch'),
    target_id: optionalString(input, 'target_id'),
    target_conversation_epoch: optionalEpoch(input, 'target_conversation_epoch'),
    receipt_id: optionalString(input, 'receipt_id')
  };
  for (const field of IDENTITY_REQUIRED_FIELDS) {
    if (!envelope[field]) throw new Error(`identity_envelope_${field}_required`);
  }
  return Object.freeze(envelope);
}

export function validateIdentityEnvelope(value) {
  if (!plainObject(value)) return { ok: false, reason: 'identity_envelope_required' };
  try {
    const normalized = buildIdentityEnvelope(value);
    return { ok: true, envelope: normalized };
  } catch (error) {
    return { ok: false, reason: String(error?.message || error) };
  }
}

// Canonical bytes cover every field that participates in the entry digest.
// entry_sha256 and prev_entry_sha256 are excluded (they ARE the chain).
export function canonicalEntryBytes(entry) {
  const canonical = {
    schema: entry.schema,
    seq: entry.seq,
    type: entry.type,
    occurred_at: entry.occurred_at,
    identity: entry.identity,
    payload: entry.payload ?? null
  };
  return new TextEncoder().encode(canonicalJson(canonical));
}

export function entrySha256(entry) {
  return sha256Hex(new TextDecoder().decode(canonicalEntryBytes(entry)));
}

export function buildEffectEvent({ seq, prevEntrySha256, type, identity, payload = null, occurredAt = new Date().toISOString() } = {}) {
  if (!Number.isSafeInteger(seq) || seq < 1) throw new Error('effect_event_seq_invalid');
  if (type !== undefined && !EFFECT_EVENT_TYPES.includes(type)) throw new Error('effect_event_type_invalid');
  if (!identity) throw new Error('effect_event_identity_required');
  const envelope = identity.schema === IDENTITY_ENVELOPE_SCHEMA && Object.isFrozen(identity)
    ? identity
    : buildIdentityEnvelope(identity);
  const prev = prevEntrySha256 === null || prevEntrySha256 === undefined ? '' : String(prevEntrySha256);
  if (prev !== '' && !SHA256_RE.test(prev)) throw new Error('effect_event_prev_invalid');
  const when = String(occurredAt);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(when)) throw new Error('effect_event_occurred_at_invalid');
  if (payload !== null && !plainObject(payload)) throw new Error('effect_event_payload_invalid');

  const entry = {
    schema: EFFECT_LEDGER_ENTRY_SCHEMA,
    seq,
    type,
    occurred_at: when,
    identity: envelope,
    payload,
    prev_entry_sha256: prev,
    entry_sha256: ''
  };
  entry.entry_sha256 = entrySha256(entry);
  return Object.freeze(entry);
}

export function validateEffectEvent(entry) {
  if (!plainObject(entry)) return { ok: false, reason: 'effect_event_required' };
  if (entry.schema !== EFFECT_LEDGER_ENTRY_SCHEMA) return { ok: false, reason: 'effect_event_schema_invalid' };
  if (!Number.isSafeInteger(entry.seq) || entry.seq < 1) return { ok: false, reason: 'effect_event_seq_invalid' };
  if (!EFFECT_EVENT_TYPES.includes(entry.type)) return { ok: false, reason: 'effect_event_type_invalid' };
  if (typeof entry.occurred_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(entry.occurred_at)) {
    return { ok: false, reason: 'effect_event_occurred_at_invalid' };
  }
  const identity = validateIdentityEnvelope(entry.identity);
  if (!identity.ok) return { ok: false, reason: `effect_event_${identity.reason}` };
  if (entry.payload !== null && entry.payload !== undefined && !plainObject(entry.payload)) {
    return { ok: false, reason: 'effect_event_payload_invalid' };
  }
  if (typeof entry.prev_entry_sha256 !== 'string' || (entry.prev_entry_sha256 !== '' && !SHA256_RE.test(entry.prev_entry_sha256))) {
    return { ok: false, reason: 'effect_event_prev_invalid' };
  }
  if (entry.seq > 1 && entry.prev_entry_sha256 === '') return { ok: false, reason: 'effect_event_prev_required' };
  if (typeof entry.entry_sha256 !== 'string' || !SHA256_RE.test(entry.entry_sha256)) {
    return { ok: false, reason: 'effect_event_digest_invalid' };
  }
  let computed;
  try {
    computed = entrySha256(entry);
  } catch {
    return { ok: false, reason: 'effect_event_value_invalid' };
  }
  if (computed !== entry.entry_sha256) return { ok: false, reason: 'effect_event_digest_mismatch' };
  return { ok: true, entry };
}

// Full-chain verification. Detects: mutated payloads (digest mismatch),
// reordering and gaps (seq walk + prev links), and tail truncation against
// an externally recorded head (callers pass expectedHead when they have one).
export function verifyLedgerChain(entries, { expectedHeadSeq = null, expectedHeadSha256 = null } = {}) {
  if (!Array.isArray(entries)) return { ok: false, reason: 'ledger_entries_required' };
  let prev = '';
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const checked = validateEffectEvent(entry);
    if (!checked.ok) return { ok: false, reason: checked.reason, first_bad_seq: entry?.seq ?? index + 1 };
    if (entry.seq !== index + 1) return { ok: false, reason: 'ledger_seq_gap', first_bad_seq: entry.seq };
    if (entry.prev_entry_sha256 !== prev) return { ok: false, reason: 'ledger_prev_link_mismatch', first_bad_seq: entry.seq };
    prev = entry.entry_sha256;
  }
  if (expectedHeadSeq !== null && expectedHeadSeq !== undefined) {
    const actualSeq = entries.length;
    if (Number(expectedHeadSeq) !== actualSeq) {
      return { ok: false, reason: 'ledger_head_seq_mismatch', head_seq: actualSeq, expected_head_seq: Number(expectedHeadSeq) };
    }
  }
  if (expectedHeadSha256) {
    const actualHead = entries.length ? entries[entries.length - 1].entry_sha256 : '';
    if (String(expectedHeadSha256) !== actualHead) {
      return { ok: false, reason: 'ledger_head_digest_mismatch', head_sha256: actualHead };
    }
  }
  const last = entries.length ? entries[entries.length - 1] : null;
  return {
    ok: true,
    head_seq: last ? last.seq : 0,
    head_entry_sha256: last ? last.entry_sha256 : '',
    head_type: last ? last.type : null,
    entries: entries.length
  };
}

export function ledgerHead(entries) {
  if (!Array.isArray(entries) || !entries.length) return Object.freeze({ seq: 0, entry_sha256: '' });
  const last = entries[entries.length - 1];
  return Object.freeze({ seq: last.seq, entry_sha256: last.entry_sha256 });
}
