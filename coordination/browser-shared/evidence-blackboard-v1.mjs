const EVIDENCE_ID_RE = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const POINT_ID_RE = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const AGENT_ID_RE = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const KIND_RE = /^[A-Z][A-Z0-9_]{1,31}$/;

export const EVIDENCE_BLACKBOARD_VERSION = '1.0.0';
export const EVIDENCE_KINDS = Object.freeze(['PROPOSAL', 'FINDING', 'TEST', 'CRITIQUE', 'DECISION', 'FAILURE', 'OBSERVATION']);
const KIND_SET = new Set(EVIDENCE_KINDS);

export class EvidenceBlackboardError extends Error {
  constructor(code) {
    super(code);
    this.name = 'EvidenceBlackboardError';
    this.code = code;
  }
}

function clone(value) { return value == null ? value : structuredClone(value); }
function text(value, max, code) {
  if (typeof value !== 'string') throw new EvidenceBlackboardError(code);
  const v = value.trim();
  if (!v || v.length > max) throw new EvidenceBlackboardError(code);
  return v;
}
function token(value, re, max, code, transform = (v) => v) {
  const v = transform(text(value, max, code));
  if (!re.test(v)) throw new EvidenceBlackboardError(code);
  return v;
}
function exactKeys(value, expected, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EvidenceBlackboardError(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, i) => key !== wanted[i])) throw new EvidenceBlackboardError(code);
}
function refs(value) {
  if (!Array.isArray(value) || value.length > 32) throw new EvidenceBlackboardError('evidence_refs_invalid');
  const out = value.map((v) => token(v, EVIDENCE_ID_RE, 128, 'evidence_ref_invalid', (x) => x.toLowerCase())).sort();
  if (out.some((v, i) => i > 0 && v === out[i - 1])) throw new EvidenceBlackboardError('evidence_ref_duplicate');
  return Object.freeze(out);
}
function nowIso(clock) {
  const value = clock();
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) throw new EvidenceBlackboardError('evidence_clock_invalid');
  return d.toISOString();
}

export class EvidenceBlackboardV1 {
  #clock;
  #agentExists;
  #entries = new Map();
  #order = [];
  #seq = 0;

  constructor({ clock = () => new Date(), agentExists = null } = {}) {
    if (typeof clock !== 'function') throw new EvidenceBlackboardError('evidence_clock_invalid');
    if (agentExists != null && typeof agentExists !== 'function') throw new EvidenceBlackboardError('evidence_agent_resolver_invalid');
    this.#clock = clock;
    this.#agentExists = agentExists;
  }

  append(input) {
    exactKeys(input, ['evidence_id', 'point_id', 'author_agent_id', 'kind', 'content_digest', 'refs', 'tainted'], 'evidence_fields_invalid');
    const evidenceId = token(input.evidence_id, EVIDENCE_ID_RE, 128, 'evidence_id_invalid', (v) => v.toLowerCase());
    if (this.#entries.has(evidenceId)) throw new EvidenceBlackboardError('evidence_id_exists');
    const pointId = token(input.point_id, POINT_ID_RE, 128, 'evidence_point_id_invalid', (v) => v.toLowerCase());
    const authorAgentId = token(input.author_agent_id, AGENT_ID_RE, 128, 'evidence_author_agent_id_invalid', (v) => v.toLowerCase());
    if (this.#agentExists && this.#agentExists(authorAgentId) !== true) throw new EvidenceBlackboardError('evidence_author_agent_unknown');
    const kind = token(input.kind, KIND_RE, 32, 'evidence_kind_invalid', (v) => v.toUpperCase());
    if (!KIND_SET.has(kind)) throw new EvidenceBlackboardError('evidence_kind_invalid');
    const contentDigest = token(input.content_digest, DIGEST_RE, 71, 'evidence_content_digest_invalid');
    const evidenceRefs = refs(input.refs);
    for (const ref of evidenceRefs) {
      if (ref === evidenceId) throw new EvidenceBlackboardError('evidence_self_ref_forbidden');
      if (!this.#entries.has(ref)) throw new EvidenceBlackboardError('evidence_ref_unknown');
    }
    if (typeof input.tainted !== 'boolean') throw new EvidenceBlackboardError('evidence_tainted_invalid');
    const entry = Object.freeze({
      version: EVIDENCE_BLACKBOARD_VERSION,
      seq: ++this.#seq,
      evidence_id: evidenceId,
      point_id: pointId,
      author_agent_id: authorAgentId,
      kind,
      content_digest: contentDigest,
      refs: evidenceRefs,
      tainted: input.tainted,
      created_at: nowIso(this.#clock),
      authority_effect: false,
      actuation_eligible: false,
    });
    this.#entries.set(evidenceId, entry);
    this.#order.push(evidenceId);
    return clone(entry);
  }

  get(evidenceId) {
    const id = token(evidenceId, EVIDENCE_ID_RE, 128, 'evidence_id_invalid', (v) => v.toLowerCase());
    return this.#entries.has(id) ? clone(this.#entries.get(id)) : null;
  }

  query({ point_id = null, author_agent_id = null, kind = null, tainted = null, limit = 100 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new EvidenceBlackboardError('evidence_query_limit_invalid');
    const pointId = point_id == null ? null : token(point_id, POINT_ID_RE, 128, 'evidence_point_id_invalid', (v) => v.toLowerCase());
    const authorId = author_agent_id == null ? null : token(author_agent_id, AGENT_ID_RE, 128, 'evidence_author_agent_id_invalid', (v) => v.toLowerCase());
    const evidenceKind = kind == null ? null : token(kind, KIND_RE, 32, 'evidence_kind_invalid', (v) => v.toUpperCase());
    if (evidenceKind && !KIND_SET.has(evidenceKind)) throw new EvidenceBlackboardError('evidence_kind_invalid');
    if (tainted != null && typeof tainted !== 'boolean') throw new EvidenceBlackboardError('evidence_tainted_invalid');
    const out = [];
    for (const id of this.#order) {
      const entry = this.#entries.get(id);
      if (pointId && entry.point_id !== pointId) continue;
      if (authorId && entry.author_agent_id !== authorId) continue;
      if (evidenceKind && entry.kind !== evidenceKind) continue;
      if (tainted != null && entry.tainted !== tainted) continue;
      out.push(clone(entry));
      if (out.length >= limit) break;
    }
    return out;
  }

  size() { return this.#order.length; }
  snapshot() {
    return Object.freeze({
      version: EVIDENCE_BLACKBOARD_VERSION,
      size: this.#order.length,
      last_seq: this.#seq,
      entries: this.#order.map((id) => clone(this.#entries.get(id))),
      authority_effect: false,
      actuation_eligible: false,
    });
  }
}

export function createEvidenceBlackboard(options) { return new EvidenceBlackboardV1(options); }
