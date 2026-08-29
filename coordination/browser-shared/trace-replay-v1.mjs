import crypto from 'node:crypto';

export const TRACE_REPLAY_VERSION = '1.0.0';
export const TRACE_ZERO_HASH = `sha256:${'0'.repeat(64)}`;
const ID_RE = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const EVENT_TYPES = new Set([
  'DECISION_RECORDED',
  'EFFECT_INTENT_RECORDED',
  'EFFECT_OBSERVATION_RECORDED',
  'TERMINAL_RECORDED',
]);
const TERMINALS = new Set(['COMMITTED', 'NO_EFFECT', 'AMBIGUOUS', 'ABORTED']);

export class TraceReplayError extends Error {
  constructor(code) {
    super(code);
    this.name = 'TraceReplayError';
    this.code = code;
  }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
    return out;
  }
  return value;
}
function canonical(value) { return JSON.stringify(stable(value)); }
function digestObject(value) { return `sha256:${crypto.createHash('sha256').update(canonical(value)).digest('hex')}`; }
function text(value, re, code) {
  if (typeof value !== 'string' || !re.test(value)) throw new TraceReplayError(code);
  return value;
}
function ids(value, code) {
  if (!Array.isArray(value) || value.length > 32) throw new TraceReplayError(code);
  const out = value.map((v) => text(v, ID_RE, code));
  if (new Set(out).size !== out.length) throw new TraceReplayError(code);
  return Object.freeze([...out]);
}
function exactKeys(value, expected, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TraceReplayError(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, i) => key !== wanted[i])) throw new TraceReplayError(code);
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
function eventHashBody(event) { const body = { ...event }; delete body.event_hash; return body; }

function normalizeEventInput(input) {
  exactKeys(input, ['event_id', 'event_type', 'subject_id', 'parent_event_ids', 'evidence_digest', 'outcome'], 'trace_event_fields_invalid');
  const eventType = text(input.event_type, /^[A-Z][A-Z0-9_]{1,63}$/, 'trace_event_type_invalid');
  if (!EVENT_TYPES.has(eventType)) throw new TraceReplayError('trace_event_type_invalid');
  const outcome = input.outcome == null ? null : text(input.outcome, /^[A-Z][A-Z0-9_]{1,31}$/, 'trace_outcome_invalid');
  if (eventType === 'TERMINAL_RECORDED') {
    if (!TERMINALS.has(outcome)) throw new TraceReplayError('trace_terminal_outcome_invalid');
  } else if (outcome !== null) {
    throw new TraceReplayError('trace_non_terminal_outcome_forbidden');
  }
  return Object.freeze({
    event_id: text(input.event_id, ID_RE, 'trace_event_id_invalid'),
    event_type: eventType,
    subject_id: text(input.subject_id, ID_RE, 'trace_subject_id_invalid'),
    parent_event_ids: ids(input.parent_event_ids, 'trace_parent_ids_invalid'),
    evidence_digest: text(input.evidence_digest, DIGEST_RE, 'trace_evidence_digest_invalid'),
    outcome,
  });
}

export class TraceRecorderV1 {
  #traceId;
  #sourceCommit;
  #events = [];
  #eventIds = new Set();
  #terminalSubjects = new Set();
  #effectIntentSubjects = new Set();

  constructor({ traceId, sourceCommit }) {
    this.#traceId = text(traceId, ID_RE, 'trace_id_invalid');
    this.#sourceCommit = text(sourceCommit, COMMIT_RE, 'trace_source_commit_invalid');
  }

  record(input) {
    const normalized = normalizeEventInput(input);
    if (this.#eventIds.has(normalized.event_id)) throw new TraceReplayError('trace_event_id_duplicate');
    for (const parent of normalized.parent_event_ids) {
      if (!this.#eventIds.has(parent)) throw new TraceReplayError('trace_parent_must_precede_child');
    }
    if (this.#terminalSubjects.has(normalized.subject_id)) throw new TraceReplayError('trace_subject_already_terminal');
    if (normalized.event_type === 'TERMINAL_RECORDED' && normalized.outcome !== 'ABORTED' && !this.#effectIntentSubjects.has(normalized.subject_id)) {
      throw new TraceReplayError('trace_terminal_effect_intent_missing');
    }

    const prevHash = this.#events.length ? this.#events.at(-1).event_hash : TRACE_ZERO_HASH;
    const event = {
      version: TRACE_REPLAY_VERSION,
      trace_id: this.#traceId,
      source_commit: this.#sourceCommit,
      seq: this.#events.length + 1,
      ...normalized,
      prev_hash: prevHash,
    };
    event.event_hash = digestObject(eventHashBody(event));
    const frozen = freeze(event);
    this.#events.push(frozen);
    this.#eventIds.add(frozen.event_id);
    if (frozen.event_type === 'EFFECT_INTENT_RECORDED') this.#effectIntentSubjects.add(frozen.subject_id);
    if (frozen.event_type === 'TERMINAL_RECORDED') this.#terminalSubjects.add(frozen.subject_id);
    return structuredClone(frozen);
  }

  snapshot() {
    return freeze({
      version: TRACE_REPLAY_VERSION,
      trace_id: this.#traceId,
      source_commit: this.#sourceCommit,
      events: this.#events.map((event) => structuredClone(event)),
      authority_effect: false,
      actuation_eligible: false,
      replay_executes_effects: false,
    });
  }
}

export function verifyTraceReplayV1(trace) {
  exactKeys(trace, ['version', 'trace_id', 'source_commit', 'events', 'authority_effect', 'actuation_eligible', 'replay_executes_effects'], 'trace_envelope_fields_invalid');
  if (trace.version !== TRACE_REPLAY_VERSION) throw new TraceReplayError('trace_version_invalid');
  const traceId = text(trace.trace_id, ID_RE, 'trace_id_invalid');
  const sourceCommit = text(trace.source_commit, COMMIT_RE, 'trace_source_commit_invalid');
  if (!Array.isArray(trace.events) || trace.events.length > 16384) throw new TraceReplayError('trace_events_invalid');
  if (trace.authority_effect !== false || trace.actuation_eligible !== false || trace.replay_executes_effects !== false) {
    throw new TraceReplayError('trace_replay_authority_invalid');
  }

  const seen = new Set();
  const intents = new Set();
  const terminals = new Map();
  let prevHash = TRACE_ZERO_HASH;

  for (let i = 0; i < trace.events.length; i += 1) {
    const event = trace.events[i];
    exactKeys(event, [
      'version','trace_id','source_commit','seq','event_id','event_type','subject_id','parent_event_ids',
      'evidence_digest','outcome','prev_hash','event_hash'
    ], 'trace_event_record_fields_invalid');
    if (event.version !== TRACE_REPLAY_VERSION || event.trace_id !== traceId || event.source_commit !== sourceCommit) throw new TraceReplayError('trace_event_envelope_mismatch');
    if (event.seq !== i + 1) throw new TraceReplayError('trace_sequence_invalid');
    if (event.prev_hash !== prevHash) throw new TraceReplayError('trace_prev_hash_invalid');
    if (event.event_hash !== digestObject(eventHashBody(event))) throw new TraceReplayError('trace_event_hash_invalid');

    const normalized = normalizeEventInput({
      event_id: event.event_id,
      event_type: event.event_type,
      subject_id: event.subject_id,
      parent_event_ids: event.parent_event_ids,
      evidence_digest: event.evidence_digest,
      outcome: event.outcome,
    });
    if (seen.has(normalized.event_id)) throw new TraceReplayError('trace_event_id_duplicate');
    for (const parent of normalized.parent_event_ids) if (!seen.has(parent)) throw new TraceReplayError('trace_parent_must_precede_child');
    if (terminals.has(normalized.subject_id)) throw new TraceReplayError('trace_subject_already_terminal');
    if (normalized.event_type === 'EFFECT_INTENT_RECORDED') intents.add(normalized.subject_id);
    if (normalized.event_type === 'TERMINAL_RECORDED') {
      if (normalized.outcome !== 'ABORTED' && !intents.has(normalized.subject_id)) throw new TraceReplayError('trace_terminal_effect_intent_missing');
      terminals.set(normalized.subject_id, normalized.outcome);
    }
    seen.add(normalized.event_id);
    prevHash = event.event_hash;
  }

  const terminal_outcomes = [...terminals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([subject_id, outcome]) => ({ subject_id, outcome }));
  return freeze({
    version: TRACE_REPLAY_VERSION,
    trace_id: traceId,
    source_commit: sourceCommit,
    event_count: trace.events.length,
    last_event_hash: prevHash,
    terminal_outcomes,
    ambiguous_subject_ids: terminal_outcomes.filter((row) => row.outcome === 'AMBIGUOUS').map((row) => row.subject_id),
    replay_executes_effects: false,
    authority_effect: false,
    actuation_eligible: false,
  });
}

export function createTraceRecorderV1(options) { return new TraceRecorderV1(options); }
