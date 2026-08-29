import crypto from 'node:crypto';

export const ACTION_GRAPH_VERSION = '1.0.0';
export const ACTION_GRAPH_LIMITS = Object.freeze({ maxActions: 4096, maxEvents: 16384, maxParents: 32 });
export const ACTION_GRAPH_ZERO_HASH = `sha256:${'0'.repeat(64)}`;

const ID_RE = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const RESOURCE_RE = /^[a-z0-9][a-z0-9._:-]{2,95}$/;
const KIND_RE = /^[A-Z][A-Z0-9_]{1,31}$/;
const REASON_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const TYPES = new Set(['ACTION_DECLARED', 'EFFECT_INTENT_SEALED', 'ACTION_COMMITTED', 'ACTION_AMBIGUOUS', 'ACTION_ABORTED']);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort(cmp)) out[key] = stable(value[key]);
    return out;
  }
  return value;
}
export function canonicalActionGraphJson(value) { return JSON.stringify(stable(value)); }
export function digestActionGraphEvidence(value) {
  return `sha256:${crypto.createHash('sha256').update(canonicalActionGraphJson(value)).digest('hex')}`;
}

export class ActionGraphError extends Error {
  constructor(code, { recoveryRequired = false } = {}) {
    super(code);
    this.name = 'ActionGraphError';
    this.code = code;
    this.recovery_required = recoveryRequired;
  }
}

function text(value, code, max) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) throw new ActionGraphError(code);
  return value;
}
function id(value, code, re = ID_RE) {
  const v = text(value, code, 128);
  if (!re.test(v)) throw new ActionGraphError(code);
  return v;
}
function digest(value, code) {
  const v = text(value, code, 71);
  if (!DIGEST_RE.test(v)) throw new ActionGraphError(code);
  return v;
}
function exactKeys(value, expected, code) {
  const a = Object.keys(value).sort(cmp);
  const b = [...expected].sort(cmp);
  if (a.length !== b.length || a.some((key, i) => key !== b[i])) throw new ActionGraphError(code);
}
function normalizeNamespace(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ActionGraphError('action_graph_namespace_invalid');
  exactKeys(value, ['target_id', 'context_id', 'conversation_epoch', 'document_epoch'], 'action_graph_namespace_fields_invalid');
  return Object.freeze({
    target_id: id(value.target_id, 'action_graph_target_id_invalid', RESOURCE_RE),
    context_id: id(value.context_id, 'action_graph_context_id_invalid', RESOURCE_RE),
    conversation_epoch: text(value.conversation_epoch, 'action_graph_conversation_epoch_invalid', 128),
    document_epoch: text(value.document_epoch, 'action_graph_document_epoch_invalid', 256),
  });
}
function normalizeParents(value = []) {
  if (!Array.isArray(value) || value.length > ACTION_GRAPH_LIMITS.maxParents) throw new ActionGraphError('action_graph_dependencies_invalid');
  const out = value.map((v) => id(v, 'action_graph_dependency_id_invalid')).sort(cmp);
  if (out.some((v, i) => i && v === out[i - 1])) throw new ActionGraphError('action_graph_dependency_duplicate');
  return Object.freeze(out);
}
function hashBody(event) { const body = { ...event }; delete body.event_hash; return body; }

function validateShape(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event) || !TYPES.has(event.event_type)) throw new ActionGraphError('action_graph_event_invalid');
  const common = ['version', 'graph_id', 'seq', 'event_type', 'action_id', 'prev_hash', 'event_hash'];
  const extra = {
    ACTION_DECLARED: ['action_kind', 'intent_digest', 'namespace', 'depends_on'],
    EFFECT_INTENT_SEALED: ['pre_effect_evidence_digest'],
    ACTION_COMMITTED: ['effect_receipt_digest'],
    ACTION_AMBIGUOUS: ['uncertainty_digest'],
    ACTION_ABORTED: ['reason_code'],
  }[event.event_type];
  exactKeys(event, [...common, ...extra], 'action_graph_event_fields_invalid');
}

function validateTransition(event, actions) {
  const current = actions.get(event.action_id);
  if (event.event_type === 'ACTION_DECLARED') {
    if (current) throw new ActionGraphError('action_graph_action_id_exists');
    if (actions.size >= ACTION_GRAPH_LIMITS.maxActions) throw new ActionGraphError('action_graph_action_limit_exceeded');
    if (event.depends_on.includes(event.action_id)) throw new ActionGraphError('action_graph_self_dependency');
    for (const parentId of event.depends_on) if (!actions.has(parentId)) throw new ActionGraphError('action_graph_dependency_missing');
    return;
  }
  if (!current) throw new ActionGraphError('action_graph_action_missing');
  if (event.event_type === 'EFFECT_INTENT_SEALED') {
    if (current.state !== 'DECLARED') throw new ActionGraphError('action_graph_effect_intent_state_invalid');
    for (const parentId of current.depends_on) if (actions.get(parentId)?.state !== 'COMMITTED') throw new ActionGraphError('action_graph_dependency_not_committed');
    return;
  }
  if (event.event_type === 'ACTION_ABORTED') {
    if (current.state !== 'DECLARED') throw new ActionGraphError('action_graph_abort_after_effect_intent_forbidden');
    return;
  }
  if (current.state !== 'EFFECT_INTENT_SEALED') throw new ActionGraphError('action_graph_effect_resolution_state_invalid');
}

function apply(event, actions) {
  if (event.event_type === 'ACTION_DECLARED') {
    actions.set(event.action_id, Object.freeze({
      action_id: event.action_id,
      action_kind: event.action_kind,
      intent_digest: event.intent_digest,
      namespace: Object.freeze({ ...event.namespace }),
      depends_on: Object.freeze([...event.depends_on]),
      state: 'DECLARED', declared_seq: event.seq, sealed_seq: null, terminal_seq: null,
    }));
    return;
  }
  const next = { ...actions.get(event.action_id) };
  if (event.event_type === 'EFFECT_INTENT_SEALED') { next.state = 'EFFECT_INTENT_SEALED'; next.sealed_seq = event.seq; }
  if (event.event_type === 'ACTION_COMMITTED') { next.state = 'COMMITTED'; next.terminal_seq = event.seq; }
  if (event.event_type === 'ACTION_AMBIGUOUS') { next.state = 'AMBIGUOUS'; next.terminal_seq = event.seq; }
  if (event.event_type === 'ACTION_ABORTED') { next.state = 'ABORTED'; next.terminal_seq = event.seq; }
  actions.set(event.action_id, Object.freeze(next));
}

function normalizeVerifiedEvent(raw, graphId, seq, prevHash, actions) {
  validateShape(raw);
  if (raw.version !== ACTION_GRAPH_VERSION || raw.graph_id !== graphId) throw new ActionGraphError('action_graph_event_identity_mismatch');
  if (raw.seq !== seq || raw.prev_hash !== prevHash) throw new ActionGraphError('action_graph_sequence_or_chain_invalid');
  id(raw.action_id, 'action_graph_action_id_invalid');
  digest(raw.prev_hash, 'action_graph_prev_hash_invalid');
  digest(raw.event_hash, 'action_graph_event_hash_invalid');
  if (raw.event_hash !== digestActionGraphEvidence(hashBody(raw))) throw new ActionGraphError('action_graph_event_hash_mismatch');
  if (raw.event_type === 'ACTION_DECLARED') {
    if (typeof raw.action_kind !== 'string' || !KIND_RE.test(raw.action_kind)) throw new ActionGraphError('action_graph_action_kind_invalid');
    digest(raw.intent_digest, 'action_graph_intent_digest_invalid');
    raw.namespace = normalizeNamespace(raw.namespace);
    raw.depends_on = normalizeParents(raw.depends_on);
  } else if (raw.event_type === 'EFFECT_INTENT_SEALED') digest(raw.pre_effect_evidence_digest, 'action_graph_pre_effect_evidence_digest_invalid');
  else if (raw.event_type === 'ACTION_COMMITTED') digest(raw.effect_receipt_digest, 'action_graph_effect_receipt_digest_invalid');
  else if (raw.event_type === 'ACTION_AMBIGUOUS') digest(raw.uncertainty_digest, 'action_graph_uncertainty_digest_invalid');
  else if (typeof raw.reason_code !== 'string' || !REASON_RE.test(raw.reason_code)) throw new ActionGraphError('action_graph_abort_reason_invalid');
  validateTransition(raw, actions);
  return raw;
}

export class ActionGraphState {
  #graphId;
  #events = [];
  #actions = new Map();
  #lastHash = ACTION_GRAPH_ZERO_HASH;

  constructor(graphId) { this.#graphId = id(graphId, 'action_graph_graph_id_invalid'); }
  get graphId() { return this.#graphId; }
  get eventCount() { return this.#events.length; }
  get lastHash() { return this.#lastHash; }

  replay(rawEvents) {
    if (!Array.isArray(rawEvents) || rawEvents.length > ACTION_GRAPH_LIMITS.maxEvents) throw new ActionGraphError('action_graph_event_limit_exceeded');
    for (const raw of rawEvents) this.#acceptVerified(structuredClone(raw));
    return this;
  }

  prepareDeclared({ actionId, actionKind, intentDigest, namespace, dependsOn = [] }) {
    const kind = text(actionKind, 'action_graph_action_kind_invalid', 32);
    if (!KIND_RE.test(kind)) throw new ActionGraphError('action_graph_action_kind_invalid');
    return this.#prepare('ACTION_DECLARED', id(actionId, 'action_graph_action_id_invalid'), {
      action_kind: kind,
      intent_digest: digest(intentDigest, 'action_graph_intent_digest_invalid'),
      namespace: normalizeNamespace(namespace),
      depends_on: normalizeParents(dependsOn),
    });
  }
  prepareSeal({ actionId, preEffectEvidenceDigest }) {
    return this.#prepare('EFFECT_INTENT_SEALED', id(actionId, 'action_graph_action_id_invalid'), {
      pre_effect_evidence_digest: digest(preEffectEvidenceDigest, 'action_graph_pre_effect_evidence_digest_invalid'),
    });
  }
  prepareCommit({ actionId, effectReceiptDigest }) {
    return this.#prepare('ACTION_COMMITTED', id(actionId, 'action_graph_action_id_invalid'), {
      effect_receipt_digest: digest(effectReceiptDigest, 'action_graph_effect_receipt_digest_invalid'),
    });
  }
  prepareAmbiguous({ actionId, uncertaintyDigest }) {
    return this.#prepare('ACTION_AMBIGUOUS', id(actionId, 'action_graph_action_id_invalid'), {
      uncertainty_digest: digest(uncertaintyDigest, 'action_graph_uncertainty_digest_invalid'),
    });
  }
  prepareAbort({ actionId, reasonCode }) {
    const reason = text(reasonCode, 'action_graph_abort_reason_invalid', 64);
    if (!REASON_RE.test(reason)) throw new ActionGraphError('action_graph_abort_reason_invalid');
    return this.#prepare('ACTION_ABORTED', id(actionId, 'action_graph_action_id_invalid'), { reason_code: reason });
  }

  acceptPrepared(rawEvent) { return this.#acceptVerified(structuredClone(rawEvent)); }

  receipt(actionId, event = null) {
    const action = this.#actions.get(actionId);
    return Object.freeze({
      graph_id: this.#graphId, action_id: actionId, state: action?.state ?? null,
      seq: event?.seq ?? this.#events.length, event_hash: event?.event_hash ?? this.#lastHash,
      authority_effect: false, actuation_eligible: false,
      fresh_authority_required: action?.state === 'EFFECT_INTENT_SEALED',
    });
  }

  snapshot() {
    const actions = [...this.#actions.values()].map((value) => structuredClone(value)).sort((a, b) => cmp(a.action_id, b.action_id));
    return Object.freeze({
      version: ACTION_GRAPH_VERSION, graph_id: this.#graphId,
      event_count: this.#events.length, action_count: actions.length,
      head_event_hash: this.#lastHash, actions: Object.freeze(actions),
      authority_effect: false, actuation_eligible: false,
    });
  }

  #prepare(type, actionId, fields) {
    if (this.#events.length >= ACTION_GRAPH_LIMITS.maxEvents) throw new ActionGraphError('action_graph_event_limit_exceeded');
    const event = {
      version: ACTION_GRAPH_VERSION, graph_id: this.#graphId,
      seq: this.#events.length + 1, event_type: type, action_id: actionId,
      prev_hash: this.#lastHash, ...fields,
    };
    validateTransition(event, this.#actions);
    event.event_hash = digestActionGraphEvidence(event);
    return Object.freeze(event);
  }

  #acceptVerified(raw) {
    const event = normalizeVerifiedEvent(raw, this.#graphId, this.#events.length + 1, this.#lastHash, this.#actions);
    apply(event, this.#actions);
    this.#events.push(Object.freeze(structuredClone(event)));
    this.#lastHash = event.event_hash;
    return this.receipt(event.action_id, event);
  }
}
