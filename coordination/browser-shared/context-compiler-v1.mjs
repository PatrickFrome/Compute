import crypto from 'node:crypto';

const SOURCE_ID_RE = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const POINT_ID_RE = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const KIND_RE = /^[A-Z][A-Z0-9_]{1,31}$/;
const ROLE_RE = /^[A-Z][A-Z0-9_:-]{1,63}$/;

export const CONTEXT_COMPILER_VERSION = '1.0.0';
export const CONTEXT_SOURCE_KINDS = Object.freeze([
  'DIRECTIVE', 'DECISION', 'EVIDENCE', 'OBSERVATION', 'HISTORY', 'CAPABILITY', 'TEST_RESULT',
]);
const KIND_SET = new Set(CONTEXT_SOURCE_KINDS);

const ROLE_POLICIES = Object.freeze({
  RESEARCHER: ['DIRECTIVE', 'DECISION', 'EVIDENCE', 'OBSERVATION', 'HISTORY', 'CAPABILITY', 'TEST_RESULT'],
  CODER: ['DIRECTIVE', 'DECISION', 'EVIDENCE', 'CAPABILITY', 'TEST_RESULT'],
  TESTER: ['DIRECTIVE', 'DECISION', 'EVIDENCE', 'CAPABILITY', 'TEST_RESULT'],
  CRITIC: ['DIRECTIVE', 'DECISION', 'EVIDENCE', 'OBSERVATION', 'TEST_RESULT'],
  FALSIFIER: ['DIRECTIVE', 'DECISION', 'EVIDENCE', 'OBSERVATION', 'TEST_RESULT'],
  SECURITY: ['DIRECTIVE', 'DECISION', 'EVIDENCE', 'OBSERVATION', 'CAPABILITY', 'TEST_RESULT'],
  INTEGRATOR: ['DIRECTIVE', 'DECISION', 'EVIDENCE', 'OBSERVATION', 'HISTORY', 'CAPABILITY', 'TEST_RESULT'],
  JURY: ['DIRECTIVE', 'DECISION', 'EVIDENCE', 'OBSERVATION', 'TEST_RESULT'],
  WORKER: ['DIRECTIVE', 'DECISION', 'EVIDENCE', 'OBSERVATION', 'TEST_RESULT'],
});
const FALLBACK_KINDS = Object.freeze(['DECISION', 'EVIDENCE', 'OBSERVATION', 'TEST_RESULT']);
const KIND_RANK = Object.freeze({ DIRECTIVE: 0, DECISION: 1, TEST_RESULT: 2, EVIDENCE: 3, OBSERVATION: 4, CAPABILITY: 5, HISTORY: 6 });

export class ContextCompilerError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ContextCompilerError';
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
function canonicalJson(value) { return JSON.stringify(stable(value)); }
function sha256(value) { return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`; }
function clone(value) { return value == null ? value : structuredClone(value); }
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
function exactKeys(value, expected, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContextCompilerError(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, i) => key !== wanted[i])) throw new ContextCompilerError(code);
}
function text(value, max, code) {
  if (typeof value !== 'string') throw new ContextCompilerError(code);
  const v = value.trim();
  if (!v || v.length > max) throw new ContextCompilerError(code);
  return v;
}
function token(value, re, max, code, transform = (v) => v) {
  const v = transform(text(value, max, code));
  if (!re.test(v)) throw new ContextCompilerError(code);
  return v;
}
function refs(value) {
  if (!Array.isArray(value) || value.length > 32) throw new ContextCompilerError('context_source_refs_invalid');
  const out = value.map((v) => token(v, SOURCE_ID_RE, 128, 'context_source_ref_invalid', (x) => x.toLowerCase())).sort();
  if (out.some((v, i) => i > 0 && v === out[i - 1])) throw new ContextCompilerError('context_source_ref_duplicate');
  return Object.freeze(out);
}
function normalizeSource(raw) {
  exactKeys(raw, ['source_id', 'point_id', 'kind', 'body', 'content_digest', 'tainted', 'priority', 'refs'], 'context_source_fields_invalid');
  const sourceId = token(raw.source_id, SOURCE_ID_RE, 128, 'context_source_id_invalid', (v) => v.toLowerCase());
  const pointId = token(raw.point_id, POINT_ID_RE, 128, 'context_source_point_id_invalid', (v) => v.toLowerCase());
  const kind = token(raw.kind, KIND_RE, 32, 'context_source_kind_invalid', (v) => v.toUpperCase());
  if (!KIND_SET.has(kind)) throw new ContextCompilerError('context_source_kind_invalid');
  if (typeof raw.body !== 'string' || raw.body.length < 1 || raw.body.length > 250_000) throw new ContextCompilerError('context_source_body_invalid');
  const digest = token(raw.content_digest, DIGEST_RE, 71, 'context_source_digest_invalid');
  if (sha256(raw.body) !== digest) throw new ContextCompilerError('context_source_digest_mismatch');
  if (typeof raw.tainted !== 'boolean') throw new ContextCompilerError('context_source_tainted_invalid');
  if (!Number.isInteger(raw.priority) || raw.priority < 0 || raw.priority > 100) throw new ContextCompilerError('context_source_priority_invalid');
  const sourceRefs = refs(raw.refs);
  if (sourceRefs.includes(sourceId)) throw new ContextCompilerError('context_source_self_ref_forbidden');
  return Object.freeze({
    source_id: sourceId,
    point_id: pointId,
    kind,
    body: raw.body,
    content_digest: digest,
    tainted: raw.tainted,
    priority: raw.priority,
    refs: sourceRefs,
  });
}
function rolePolicy(role) {
  const normalized = token(role, ROLE_RE, 64, 'context_role_invalid', (v) => v.toUpperCase());
  const kinds = ROLE_POLICIES[normalized] || FALLBACK_KINDS;
  return Object.freeze({ role: normalized, known_role: Object.hasOwn(ROLE_POLICIES, normalized), allowed_kinds: Object.freeze([...kinds]) });
}
function sourceCmp(a, b) {
  if (a.priority !== b.priority) return b.priority - a.priority;
  const ar = KIND_RANK[a.kind] ?? 99;
  const br = KIND_RANK[b.kind] ?? 99;
  if (ar !== br) return ar - br;
  return a.source_id.localeCompare(b.source_id);
}
function previousManifest(previous) {
  if (previous == null) return [];
  if (!previous || typeof previous !== 'object' || Array.isArray(previous) || !Array.isArray(previous.manifest)) {
    throw new ContextCompilerError('context_previous_capsule_invalid');
  }
  return previous.manifest.map((row) => {
    if (!row || typeof row !== 'object' || typeof row.source_id !== 'string' || typeof row.content_digest !== 'string') {
      throw new ContextCompilerError('context_previous_manifest_invalid');
    }
    return { source_id: row.source_id, content_digest: row.content_digest };
  });
}
function deltaFor(previous, manifest) {
  const oldRows = new Map(previous.map((row) => [row.source_id, row.content_digest]));
  const nextRows = new Map(manifest.map((row) => [row.source_id, row.content_digest]));
  const added = [];
  const removed = [];
  const changed = [];
  for (const [id, digest] of nextRows) {
    if (!oldRows.has(id)) added.push(id);
    else if (oldRows.get(id) !== digest) changed.push(id);
  }
  for (const id of oldRows.keys()) if (!nextRows.has(id)) removed.push(id);
  return Object.freeze({ added: Object.freeze(added.sort()), removed: Object.freeze(removed.sort()), changed: Object.freeze(changed.sort()) });
}

export function compileRoleContext({ point_id, role, sources, max_chars = 16_000, previous_capsule = null } = {}) {
  const pointId = token(point_id, POINT_ID_RE, 128, 'context_point_id_invalid', (v) => v.toLowerCase());
  const policy = rolePolicy(role);
  if (!Array.isArray(sources) || sources.length > 4096) throw new ContextCompilerError('context_sources_invalid');
  if (!Number.isInteger(max_chars) || max_chars < 256 || max_chars > 1_000_000) throw new ContextCompilerError('context_budget_invalid');
  const normalized = sources.map(normalizeSource);
  const ids = new Set();
  for (const source of normalized) {
    if (ids.has(source.source_id)) throw new ContextCompilerError('context_source_id_duplicate');
    ids.add(source.source_id);
  }
  const eligible = normalized
    .filter((source) => source.point_id === pointId && policy.allowed_kinds.includes(source.kind))
    .sort(sourceCmp);

  const selected = [];
  const omitted = [];
  let usedChars = 0;
  for (const source of eligible) {
    const cost = source.body.length;
    if (usedChars + cost > max_chars) {
      if (source.kind === 'DIRECTIVE' && source.tainted === false) throw new ContextCompilerError('context_trusted_directive_budget_exceeded');
      omitted.push(Object.freeze({ source_id: source.source_id, reason: 'BUDGET' }));
      continue;
    }
    selected.push(source);
    usedChars += cost;
  }

  const trustedInstructions = selected
    .filter((source) => source.kind === 'DIRECTIVE' && source.tainted === false)
    .map((source) => Object.freeze({ source_id: source.source_id, content_digest: source.content_digest, body: source.body }));
  const evidenceContext = selected
    .filter((source) => !(source.kind === 'DIRECTIVE' && source.tainted === false))
    .map((source) => Object.freeze({
      source_id: source.source_id,
      kind: source.kind,
      content_digest: source.content_digest,
      tainted: source.tainted,
      data_class: source.tainted ? 'UNTRUSTED_DATA' : 'EVIDENCE_DATA',
      body: source.body,
      refs: source.refs,
    }));
  const manifest = selected.map((source) => Object.freeze({
    source_id: source.source_id,
    point_id: source.point_id,
    kind: source.kind,
    content_digest: source.content_digest,
    tainted: source.tainted,
    priority: source.priority,
    body_chars: source.body.length,
  }));
  const previous = previousManifest(previous_capsule);
  const delta = deltaFor(previous, manifest);
  const body = {
    version: CONTEXT_COMPILER_VERSION,
    point_id: pointId,
    role: policy.role,
    known_role: policy.known_role,
    allowed_kinds: policy.allowed_kinds,
    max_chars,
    used_chars: usedChars,
    trusted_instructions: trustedInstructions,
    evidence_context: evidenceContext,
    manifest,
    omitted,
    delta,
    source_of_truth_rewritten: false,
    authority_effect: false,
    actuation_eligible: false,
  };
  const capsule = { ...body, capsule_digest: sha256(canonicalJson(body)) };
  return deepFreeze(capsule);
}

export function digestContextBody(body) {
  if (typeof body !== 'string') throw new ContextCompilerError('context_source_body_invalid');
  return sha256(body);
}
