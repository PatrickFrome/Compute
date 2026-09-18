import crypto from 'node:crypto';

export const RSI_SHADOW_CANDIDATE_SCHEMA = 'metaengine.rsi.shadow-candidate.v1';
export const RSI_SHADOW_EVIDENCE_SCHEMA = 'metaengine.rsi.shadow-evidence.v1';
export const RSI_SHADOW_SNAPSHOT_SCHEMA = 'metaengine.rsi.shadow-snapshot.v1';

export const RSI_SHADOW_STATES = Object.freeze({
  PROPOSED: 'PROPOSED',
  EVALUATING: 'EVALUATING',
  SHADOW_QUALIFIED: 'SHADOW_QUALIFIED',
  REJECTED: 'REJECTED',
  BLOCKED: 'BLOCKED',
});

export const RSI_MUTATION_SURFACES = Object.freeze([
  'PROMPT_ROUTING',
  'AGENT_ORCHESTRATION',
  'TOOL_INTERFACE',
  'BROWSER_RUNTIME',
  'RSI_IMPROVER',
]);

export const RSI_IMMUTABLE_TRUST_SURFACES = Object.freeze([
  'SIGNING_KEYS',
  'ARTIFACT_VERIFICATION_ROOT',
  'EVALUATOR_ROOT',
  'SOURCE_IDENTITY_ROOT',
  'PERMISSION_BOUNDARY',
  'ONE_ATTEMPT_EFFECT_SEMANTICS',
  'ROLLBACK_AUTHORITY',
]);

export const RSI_HARD_INVARIANTS = Object.freeze([
  'NO_DUPLICATE_IRREVERSIBLE_EFFECT',
  'NO_AUTHORITY_VIOLATION',
  'NO_WORKSPACE_ESCAPE',
  'EXACT_SOURCE_IDENTITY',
  'NO_SECURITY_REGRESSION',
  'NO_AMBIGUOUS_EFFECT_RETRY',
]);

const SHA40_RE = /^[0-9a-f]{40}$/i;
const DIGEST64_RE = /^[0-9a-f]{64}$/i;
const ID_RE = /^[a-z0-9][a-z0-9._:-]{2,127}$/i;
const MAX_EVIDENCE_REFS = 32;

function text(value, max = 512) {
  if (value == null) return null;
  return String(value).trim().slice(0, max);
}

function exactSha(value, field) {
  const normalized = text(value, 40)?.toLowerCase();
  if (!normalized || !SHA40_RE.test(normalized)) throw new Error(`rsi_${field}_exact_sha_required`);
  return normalized;
}

function safeId(value, field) {
  const normalized = text(value, 128);
  if (!normalized || !ID_RE.test(normalized)) throw new Error(`rsi_${field}_invalid`);
  return normalized;
}

function iso(value, field) {
  const raw = text(value, 64);
  const parsed = Date.parse(raw || '');
  if (!raw || Number.isNaN(parsed)) throw new Error(`rsi_${field}_iso_timestamp_required`);
  return new Date(parsed).toISOString();
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}

function clone(value) {
  return structuredClone(value);
}

function boundedEvidenceRefs(refs) {
  if (refs == null) return [];
  if (!Array.isArray(refs)) throw new Error('rsi_evidence_refs_array_required');
  if (refs.length > MAX_EVIDENCE_REFS) throw new Error('rsi_evidence_refs_capacity_exceeded');
  return refs.map((ref) => {
    const normalized = text(ref, 512);
    if (!normalized) throw new Error('rsi_evidence_ref_invalid');
    return normalized;
  });
}

function normalizeObjective(objective) {
  const name = safeId(objective?.name, 'objective_name');
  const direction = String(objective?.direction || '').toUpperCase();
  if (!['MAXIMIZE', 'MINIMIZE'].includes(direction)) throw new Error('rsi_objective_direction_invalid');
  const baseline = Number(objective?.baseline);
  const candidate = Number(objective?.candidate);
  if (!Number.isFinite(baseline) || !Number.isFinite(candidate)) throw new Error('rsi_objective_numeric_value_required');
  return Object.freeze({ name, direction, baseline, candidate });
}

function objectiveImproved(objective) {
  return objective.direction === 'MAXIMIZE'
    ? objective.candidate > objective.baseline
    : objective.candidate < objective.baseline;
}

export class RsiShadowArchive {
  #clock;
  #candidates = new Map();

  constructor({ clock = () => Date.now() } = {}) {
    if (typeof clock !== 'function') throw new Error('rsi_clock_required');
    this.#clock = clock;
  }

  #now() {
    return new Date(this.#clock()).toISOString();
  }

  #row(candidateId) {
    const id = safeId(candidateId, 'candidate_id');
    const row = this.#candidates.get(id);
    if (!row) throw new Error('rsi_candidate_not_found');
    return row;
  }

  propose({
    candidate_id,
    parent_sha,
    candidate_sha,
    mutation_surface,
    hypothesis,
    created_at = this.#now(),
  } = {}) {
    const candidateId = safeId(candidate_id, 'candidate_id');
    if (this.#candidates.has(candidateId)) throw new Error('rsi_candidate_already_exists');

    const surface = String(mutation_surface || '').toUpperCase();
    if (RSI_IMMUTABLE_TRUST_SURFACES.includes(surface)) throw new Error('rsi_immutable_trust_surface_forbidden');
    if (!RSI_MUTATION_SURFACES.includes(surface)) throw new Error('rsi_mutation_surface_invalid');

    const row = {
      schema: RSI_SHADOW_CANDIDATE_SCHEMA,
      candidate_id: candidateId,
      parent_sha: exactSha(parent_sha, 'parent'),
      candidate_sha: exactSha(candidate_sha, 'candidate'),
      mutation_surface: surface,
      hypothesis: text(hypothesis, 2000),
      state: RSI_SHADOW_STATES.PROPOSED,
      created_at: iso(created_at, 'created_at'),
      evaluation_started_at: null,
      finalized_at: null,
      evidence: [],
      hard_invariants: Object.fromEntries(RSI_HARD_INVARIANTS.map((name) => [name, 'UNVERIFIED'])),
      objectives: [],
      promotion_authority: false,
      self_update_authority: false,
      execution_authority: false,
      production_mutation_authority: false,
      automatic_retry_allowed: false,
      shadow_only: true,
    };
    row.candidate_digest = digest({ ...row, candidate_digest: undefined });
    this.#candidates.set(candidateId, row);
    return this.get(candidateId);
  }

  beginEvaluation(candidateId, { started_at = this.#now() } = {}) {
    const row = this.#row(candidateId);
    if (row.state !== RSI_SHADOW_STATES.PROPOSED) throw new Error('rsi_candidate_not_proposed');
    row.state = RSI_SHADOW_STATES.EVALUATING;
    row.evaluation_started_at = iso(started_at, 'evaluation_started_at');
    return this.get(candidateId);
  }

  recordInvariant(candidateId, {
    invariant,
    result,
    evaluator_id,
    evaluator_digest,
    evidence_refs = [],
    recorded_at = this.#now(),
  } = {}) {
    const row = this.#row(candidateId);
    if (row.state !== RSI_SHADOW_STATES.EVALUATING) throw new Error('rsi_candidate_not_evaluating');
    const normalizedInvariant = String(invariant || '').toUpperCase();
    if (!RSI_HARD_INVARIANTS.includes(normalizedInvariant)) throw new Error('rsi_hard_invariant_invalid');
    const normalizedResult = String(result || '').toUpperCase();
    if (!['PASS', 'FAIL'].includes(normalizedResult)) throw new Error('rsi_invariant_result_invalid');
    if (row.hard_invariants[normalizedInvariant] !== 'UNVERIFIED') throw new Error('rsi_invariant_already_recorded');

    const evaluatorId = safeId(evaluator_id, 'evaluator_id');
    const evaluatorDigest = text(evaluator_digest, 64)?.toLowerCase();
    if (!evaluatorDigest || !DIGEST64_RE.test(evaluatorDigest)) throw new Error('rsi_evaluator_digest_required');

    const evidence = {
      schema: RSI_SHADOW_EVIDENCE_SCHEMA,
      kind: 'HARD_INVARIANT',
      invariant: normalizedInvariant,
      result: normalizedResult,
      evaluator_id: evaluatorId,
      evaluator_digest: evaluatorDigest,
      evidence_refs: boundedEvidenceRefs(evidence_refs),
      recorded_at: iso(recorded_at, 'recorded_at'),
      authority_effect: false,
    };
    evidence.evidence_digest = digest(evidence);
    row.evidence.push(Object.freeze(evidence));
    row.hard_invariants[normalizedInvariant] = normalizedResult;
    return clone(evidence);
  }

  recordObjective(candidateId, {
    objective,
    evaluator_id,
    evaluator_digest,
    evidence_refs = [],
    recorded_at = this.#now(),
  } = {}) {
    const row = this.#row(candidateId);
    if (row.state !== RSI_SHADOW_STATES.EVALUATING) throw new Error('rsi_candidate_not_evaluating');
    const normalized = normalizeObjective(objective);
    if (row.objectives.some((entry) => entry.name === normalized.name)) throw new Error('rsi_objective_already_recorded');

    const evaluatorId = safeId(evaluator_id, 'evaluator_id');
    const evaluatorDigest = text(evaluator_digest, 64)?.toLowerCase();
    if (!evaluatorDigest || !DIGEST64_RE.test(evaluatorDigest)) throw new Error('rsi_evaluator_digest_required');

    const evidence = {
      schema: RSI_SHADOW_EVIDENCE_SCHEMA,
      kind: 'OBJECTIVE',
      objective: normalized,
      improved: objectiveImproved(normalized),
      evaluator_id: evaluatorId,
      evaluator_digest: evaluatorDigest,
      evidence_refs: boundedEvidenceRefs(evidence_refs),
      recorded_at: iso(recorded_at, 'recorded_at'),
      authority_effect: false,
    };
    evidence.evidence_digest = digest(evidence);
    row.evidence.push(Object.freeze(evidence));
    row.objectives.push(Object.freeze({ ...normalized, improved: evidence.improved }));
    return clone(evidence);
  }

  finalize(candidateId, { finalized_at = this.#now() } = {}) {
    const row = this.#row(candidateId);
    if (row.state !== RSI_SHADOW_STATES.EVALUATING) throw new Error('rsi_candidate_not_evaluating');
    const invariantStates = Object.values(row.hard_invariants);

    if (invariantStates.includes('FAIL')) {
      row.state = RSI_SHADOW_STATES.REJECTED;
    } else if (invariantStates.includes('UNVERIFIED')) {
      row.state = RSI_SHADOW_STATES.BLOCKED;
    } else if (row.objectives.length === 0 || !row.objectives.some((entry) => entry.improved === true)) {
      row.state = RSI_SHADOW_STATES.BLOCKED;
    } else {
      row.state = RSI_SHADOW_STATES.SHADOW_QUALIFIED;
    }

    row.finalized_at = iso(finalized_at, 'finalized_at');
    row.final_digest = digest({
      candidate_id: row.candidate_id,
      parent_sha: row.parent_sha,
      candidate_sha: row.candidate_sha,
      state: row.state,
      hard_invariants: row.hard_invariants,
      objectives: row.objectives,
      evidence_digests: row.evidence.map((entry) => entry.evidence_digest),
    });
    return this.get(candidateId);
  }

  get(candidateId) {
    return clone(this.#row(candidateId));
  }

  snapshot() {
    const candidates = [...this.#candidates.values()]
      .map((row) => clone(row))
      .sort((a, b) => a.candidate_id.localeCompare(b.candidate_id));
    return Object.freeze({
      schema: RSI_SHADOW_SNAPSHOT_SCHEMA,
      candidate_count: candidates.length,
      candidates,
      immutable_trust_surfaces: [...RSI_IMMUTABLE_TRUST_SURFACES],
      hard_invariants: [...RSI_HARD_INVARIANTS],
      promotion_authority: false,
      self_update_authority: false,
      execution_authority: false,
      production_mutation_authority: false,
      automatic_retry_allowed: false,
      shadow_only: true,
    });
  }
}
