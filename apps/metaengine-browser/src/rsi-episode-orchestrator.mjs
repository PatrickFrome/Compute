import crypto from 'node:crypto';

export const RSI_EPISODE_EVENT_SCHEMA = 'metaengine.rsi.episode-event.v1';
export const RSI_EPISODE_SNAPSHOT_SCHEMA = 'metaengine.rsi.episode-snapshot.v1';
export const RSI_EPISODE_NOMINATION_READINESS_SCHEMA = 'metaengine.rsi.episode-nomination-readiness.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^(?:sha256:)?[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const CANDIDATE_ID_RE = /^candidate_sha256_[0-9a-f]{64}$/;
const SAFE_SURFACES = new Set([
  'PROMPT_ROUTING',
  'AGENT_ORCHESTRATION',
  'TOOL_INTERFACE',
  'BROWSER_RUNTIME',
  'RSI_IMPROVER',
]);
const REQUIRED_EVIDENCE_KINDS = Object.freeze([
  'HARD_INVARIANTS',
  'OBJECTIVES',
  'HOLDOUT',
  'REGRESSION_REPLAY',
  'EVALUATION_INTEGRITY',
  'TOURNAMENT',
]);
const EVIDENCE_RESULTS = new Set(['PASS', 'FAIL', 'AMBIGUOUS']);
const MAX_EPISODES = 128;
const MAX_CANDIDATES_PER_EPISODE = 16;
const DEFAULT_MAX_CANDIDATES = 4;

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}

function exactSha(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA40_RE.test(out)) throw new Error(`rsi_episode_${label}_sha_invalid`);
  return out;
}

function exactDigest(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!DIGEST_RE.test(out)) throw new Error(`rsi_episode_${label}_digest_invalid`);
  return out.startsWith('sha256:') ? out.slice(7) : out;
}

function safeId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_episode_${label}_invalid`);
  return out;
}

function candidateId(value) {
  const out = String(value || '').trim().toLowerCase();
  if (!CANDIDATE_ID_RE.test(out)) throw new Error('rsi_episode_candidate_id_invalid');
  return out;
}

function surface(value) {
  const out = String(value || '').trim().toUpperCase();
  if (!SAFE_SURFACES.has(out)) throw new Error('rsi_episode_mutation_surface_invalid');
  return out;
}

function positiveInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > max) throw new Error(`rsi_episode_${label}_invalid`);
  return out;
}

function assertZeroAuthority(value, label) {
  for (const key of [
    'execution_authority',
    'browser_authority',
    'scheduler_authority',
    'task_authority',
    'production_mutation_authority',
    'promotion_authority',
    'self_update_authority',
    'authority_effect',
  ]) {
    if (Object.hasOwn(value || {}, key) && value[key] !== false) {
      throw new Error(`rsi_episode_${label}_${key}_invalid`);
    }
  }
  if (Object.hasOwn(value || {}, 'automatic_retry_allowed') && value.automatic_retry_allowed !== false) {
    throw new Error(`rsi_episode_${label}_automatic_retry_invalid`);
  }
}

function zeroAuthority(extra = {}) {
  return Object.freeze({
    ...extra,
    execution_authority: false,
    browser_authority: false,
    scheduler_authority: false,
    task_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function normalizeEvidenceKind(value) {
  const out = String(value || '').trim().toUpperCase();
  if (!REQUIRED_EVIDENCE_KINDS.includes(out)) throw new Error('rsi_episode_evidence_kind_invalid');
  return out;
}

function normalizeEvidenceResult(value) {
  const out = String(value || '').trim().toUpperCase();
  if (!EVIDENCE_RESULTS.has(out)) throw new Error('rsi_episode_evidence_result_invalid');
  return out;
}

function buildEvent(type, body) {
  const core = zeroAuthority({
    schema: RSI_EPISODE_EVENT_SCHEMA,
    version: 1,
    type,
    ...body,
  });
  return Object.freeze({ ...core, episode_event_digest: digest(core) });
}

function verifyEventDigest(event) {
  if (!plainObject(event) || event.schema !== RSI_EPISODE_EVENT_SCHEMA || event.version !== 1) {
    throw new Error('rsi_episode_event_schema_invalid');
  }
  assertZeroAuthority(event, 'event');
  const core = structuredClone(event);
  delete core.episode_event_digest;
  if (digest(core) !== exactDigest(event.episode_event_digest, 'event')) {
    throw new Error('rsi_episode_event_digest_mismatch');
  }
}

function cloneEpisode(episode) {
  return structuredClone(episode);
}

function deriveCandidateState(candidate) {
  const rows = Object.values(candidate.evidence);
  if (rows.some((row) => row.result === 'FAIL' || row.result === 'AMBIGUOUS')) return 'HELD';
  if (REQUIRED_EVIDENCE_KINDS.every((kind) => candidate.evidence[kind]?.result === 'PASS')) return 'NOMINATION_READY';
  if (rows.length > 0) return 'EVALUATING';
  return 'REGISTERED';
}

function deriveEpisodeState(episode) {
  const candidates = Object.values(episode.candidates);
  if (candidates.some((candidate) => deriveCandidateState(candidate) === 'NOMINATION_READY')) return 'NOMINATION_READY';
  if (candidates.some((candidate) => deriveCandidateState(candidate) === 'EVALUATING')) return 'EVALUATING';
  if (candidates.length >= 1) return 'CANDIDATES_READY';
  return 'OPEN';
}

export class RsiEpisodeOrchestrator {
  #sourceSha;
  #trustRootSetDigest;
  #episodes = new Map();

  constructor({ source_sha, trust_root_set_digest } = {}) {
    this.#sourceSha = exactSha(source_sha, 'source');
    this.#trustRootSetDigest = exactDigest(trust_root_set_digest, 'trust_root_set');
  }

  prepareOpen({
    episode_id,
    observation_digest,
    opportunity_id,
    hypothesis_digest,
    mutation_surface,
    search_context_digest,
    max_candidates = DEFAULT_MAX_CANDIDATES,
  } = {}) {
    if (this.#episodes.size >= MAX_EPISODES) throw new Error('rsi_episode_capacity_exhausted');
    const id = safeId(episode_id, 'id');
    if (this.#episodes.has(id)) throw new Error('rsi_episode_duplicate');
    return buildEvent('EPISODE_OPENED', {
      episode_id: id,
      source_sha: this.#sourceSha,
      trust_root_set_digest: this.#trustRootSetDigest,
      observation_digest: exactDigest(observation_digest, 'observation'),
      opportunity_id: safeId(opportunity_id, 'opportunity_id'),
      hypothesis_digest: exactDigest(hypothesis_digest, 'hypothesis'),
      mutation_surface: surface(mutation_surface),
      search_context_digest: exactDigest(search_context_digest, 'search_context'),
      max_candidates: positiveInt(max_candidates, 'max_candidates', MAX_CANDIDATES_PER_EPISODE),
      candidate_effect_executor_exposed: false,
      direct_promotion_enabled: false,
      self_update_authority: false,
    });
  }

  prepareCandidate({
    episode_id,
    candidate_id,
    candidate_sha,
    parent_sha,
    build_plan_digest,
    mutation_surface,
  } = {}) {
    const episode = this.#requireEpisode(episode_id);
    if (Object.keys(episode.candidates).length >= episode.max_candidates) throw new Error('rsi_episode_candidate_capacity_exhausted');
    const id = candidateId(candidate_id);
    if (episode.candidates[id]) throw new Error('rsi_episode_candidate_duplicate');
    const parent = exactSha(parent_sha, 'candidate_parent');
    if (parent !== this.#sourceSha) throw new Error('rsi_episode_candidate_parent_not_bound_source');
    const candidateSha = exactSha(candidate_sha, 'candidate');
    if (candidateSha === parent) throw new Error('rsi_episode_candidate_noop');
    const mutationSurface = surface(mutation_surface);
    if (mutationSurface !== episode.mutation_surface) throw new Error('rsi_episode_candidate_surface_mismatch');
    return buildEvent('CANDIDATE_REGISTERED', {
      episode_id: episode.episode_id,
      source_sha: this.#sourceSha,
      trust_root_set_digest: this.#trustRootSetDigest,
      candidate_id: id,
      candidate_sha: candidateSha,
      parent_sha: parent,
      build_plan_digest: exactDigest(build_plan_digest, 'build_plan'),
      mutation_surface: mutationSurface,
      candidate_effect_executor_exposed: false,
      eligible_for_direct_promotion: false,
    });
  }

  prepareEvidence({
    episode_id,
    candidate_id,
    evidence_id,
    evidence_kind,
    evidence_digest,
    result,
    source_sha,
    trust_root_set_digest,
    ambiguous_effect = false,
  } = {}) {
    const episode = this.#requireEpisode(episode_id);
    const id = candidateId(candidate_id);
    const candidate = episode.candidates[id];
    if (!candidate) throw new Error('rsi_episode_candidate_not_found');
    const kind = normalizeEvidenceKind(evidence_kind);
    if (candidate.evidence[kind]) throw new Error('rsi_episode_evidence_kind_already_recorded');
    if (exactSha(source_sha, 'evidence_source') !== this.#sourceSha) throw new Error('rsi_episode_evidence_source_mismatch');
    if (exactDigest(trust_root_set_digest, 'evidence_trust_root_set') !== this.#trustRootSetDigest) {
      throw new Error('rsi_episode_evidence_trust_root_mismatch');
    }
    const normalizedResult = normalizeEvidenceResult(result);
    if (ambiguous_effect === true && normalizedResult !== 'AMBIGUOUS') {
      throw new Error('rsi_episode_ambiguous_effect_result_mismatch');
    }
    return buildEvent('EVIDENCE_RECORDED', {
      episode_id: episode.episode_id,
      source_sha: this.#sourceSha,
      trust_root_set_digest: this.#trustRootSetDigest,
      candidate_id: id,
      evidence_id: safeId(evidence_id, 'evidence_id'),
      evidence_kind: kind,
      evidence_digest: exactDigest(evidence_digest, 'evidence'),
      result: normalizedResult,
      ambiguous_effect: ambiguous_effect === true,
      physical_effect_replay_allowed: false,
    });
  }

  apply(event) {
    verifyEventDigest(event);
    if (exactSha(event.source_sha, 'event_source') !== this.#sourceSha) throw new Error('rsi_episode_event_source_mismatch');
    if (exactDigest(event.trust_root_set_digest, 'event_trust_root_set') !== this.#trustRootSetDigest) {
      throw new Error('rsi_episode_event_trust_root_mismatch');
    }
    if (event.type === 'EPISODE_OPENED') return this.#applyOpen(event);
    if (event.type === 'CANDIDATE_REGISTERED') return this.#applyCandidate(event);
    if (event.type === 'EVIDENCE_RECORDED') return this.#applyEvidence(event);
    throw new Error('rsi_episode_event_type_invalid');
  }

  replay(events = []) {
    if (!Array.isArray(events)) throw new Error('rsi_episode_replay_events_invalid');
    for (const event of events) this.apply(event);
    return this.snapshot();
  }

  nominationReadiness({ episode_id, candidate_id } = {}) {
    const episode = this.#requireEpisode(episode_id);
    const id = candidateId(candidate_id);
    const candidate = episode.candidates[id];
    if (!candidate) throw new Error('rsi_episode_candidate_not_found');
    const state = deriveCandidateState(candidate);
    const missing = REQUIRED_EVIDENCE_KINDS.filter((kind) => candidate.evidence[kind]?.result !== 'PASS');
    const failed = REQUIRED_EVIDENCE_KINDS.filter((kind) => ['FAIL', 'AMBIGUOUS'].includes(candidate.evidence[kind]?.result));
    return zeroAuthority({
      schema: RSI_EPISODE_NOMINATION_READINESS_SCHEMA,
      version: 1,
      episode_id: episode.episode_id,
      candidate_id: id,
      candidate_sha: candidate.candidate_sha,
      source_sha: this.#sourceSha,
      trust_root_set_digest: this.#trustRootSetDigest,
      state,
      ready: state === 'NOMINATION_READY',
      missing_evidence_kinds: missing,
      blocking_evidence_kinds: failed,
      requires_external_promotion_gate: true,
      direct_promotion_enabled: false,
      physical_effect_replay_allowed: false,
    });
  }

  hasEpisode(episode_id) {
    const id = safeId(episode_id, 'id');
    return this.#episodes.has(id);
  }

  episode(episode_id) {
    const episode = this.#requireEpisode(episode_id);
    return Object.freeze(cloneEpisode({ ...episode, state: deriveEpisodeState(episode) }));
  }

  snapshot() {
    const episodes = [...this.#episodes.values()]
      .map((episode) => ({ ...cloneEpisode(episode), state: deriveEpisodeState(episode) }))
      .sort((a, b) => a.episode_id.localeCompare(b.episode_id));
    return zeroAuthority({
      schema: RSI_EPISODE_SNAPSHOT_SCHEMA,
      version: 1,
      source_sha: this.#sourceSha,
      trust_root_set_digest: this.#trustRootSetDigest,
      episode_count: episodes.length,
      candidate_count: episodes.reduce((sum, episode) => sum + Object.keys(episode.candidates).length, 0),
      episodes,
      required_evidence_kinds: [...REQUIRED_EVIDENCE_KINDS],
      max_episodes: MAX_EPISODES,
      max_candidates_per_episode: MAX_CANDIDATES_PER_EPISODE,
      candidate_effect_executor_exposed: false,
      direct_promotion_enabled: false,
      physical_effect_replay_allowed: false,
    });
  }

  #requireEpisode(episode_id) {
    const id = safeId(episode_id, 'id');
    const episode = this.#episodes.get(id);
    if (!episode) throw new Error('rsi_episode_not_found');
    return episode;
  }

  #applyOpen(event) {
    const id = safeId(event.episode_id, 'id');
    if (this.#episodes.has(id)) throw new Error('rsi_episode_duplicate');
    if (this.#episodes.size >= MAX_EPISODES) throw new Error('rsi_episode_capacity_exhausted');
    const episode = {
      schema: RSI_EPISODE_SNAPSHOT_SCHEMA,
      version: 1,
      episode_id: id,
      source_sha: this.#sourceSha,
      trust_root_set_digest: this.#trustRootSetDigest,
      observation_digest: exactDigest(event.observation_digest, 'observation'),
      opportunity_id: safeId(event.opportunity_id, 'opportunity_id'),
      hypothesis_digest: exactDigest(event.hypothesis_digest, 'hypothesis'),
      mutation_surface: surface(event.mutation_surface),
      search_context_digest: exactDigest(event.search_context_digest, 'search_context'),
      max_candidates: positiveInt(event.max_candidates, 'max_candidates', MAX_CANDIDATES_PER_EPISODE),
      candidates: {},
      authority_effect: false,
      automatic_retry_allowed: false,
    };
    this.#episodes.set(id, episode);
    return this.episode(id);
  }

  #applyCandidate(event) {
    const episode = this.#requireEpisode(event.episode_id);
    if (Object.keys(episode.candidates).length >= episode.max_candidates) throw new Error('rsi_episode_candidate_capacity_exhausted');
    const id = candidateId(event.candidate_id);
    if (episode.candidates[id]) throw new Error('rsi_episode_candidate_duplicate');
    const parent = exactSha(event.parent_sha, 'candidate_parent');
    if (parent !== this.#sourceSha) throw new Error('rsi_episode_candidate_parent_not_bound_source');
    const candidateSha = exactSha(event.candidate_sha, 'candidate');
    if (candidateSha === parent) throw new Error('rsi_episode_candidate_noop');
    const mutationSurface = surface(event.mutation_surface);
    if (mutationSurface !== episode.mutation_surface) throw new Error('rsi_episode_candidate_surface_mismatch');
    episode.candidates[id] = {
      candidate_id: id,
      candidate_sha: candidateSha,
      parent_sha: parent,
      build_plan_digest: exactDigest(event.build_plan_digest, 'build_plan'),
      mutation_surface: mutationSurface,
      evidence: {},
      authority_effect: false,
      automatic_retry_allowed: false,
    };
    return this.episode(episode.episode_id);
  }

  #applyEvidence(event) {
    const episode = this.#requireEpisode(event.episode_id);
    const id = candidateId(event.candidate_id);
    const candidate = episode.candidates[id];
    if (!candidate) throw new Error('rsi_episode_candidate_not_found');
    const kind = normalizeEvidenceKind(event.evidence_kind);
    if (candidate.evidence[kind]) throw new Error('rsi_episode_evidence_kind_already_recorded');
    const result = normalizeEvidenceResult(event.result);
    if (event.ambiguous_effect === true && result !== 'AMBIGUOUS') throw new Error('rsi_episode_ambiguous_effect_result_mismatch');
    candidate.evidence[kind] = {
      evidence_id: safeId(event.evidence_id, 'evidence_id'),
      evidence_kind: kind,
      evidence_digest: exactDigest(event.evidence_digest, 'evidence'),
      result,
      ambiguous_effect: event.ambiguous_effect === true,
      physical_effect_replay_allowed: false,
      authority_effect: false,
      automatic_retry_allowed: false,
    };
    return this.episode(episode.episode_id);
  }
}

export function rsiEpisodeOrchestratorTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.episode-orchestrator-trust-root.v1',
    immutable_component_paths: [
      'apps/metaengine-browser/src/rsi-episode-orchestrator.mjs',
      'apps/metaengine-browser/src/rsi-episode-devos-bridge.mjs',
      'apps/metaengine-browser/src/rsi-episode-evaluation-ingest.mjs',
      'apps/metaengine-browser/src/rsi-autonomous-episode-controller.mjs',
      'apps/metaengine-browser/src/rsi-devos-experiment-plan.mjs',
      'apps/metaengine-browser/src/rsi-runtime-ledger.mjs',
      'apps/metaengine-browser/src/rsi-runtime-service.mjs',
      'apps/metaengine-browser/src/rsi-evaluator-mesh.mjs',
      'apps/metaengine-browser/src/rsi-shadow-tournament.mjs',
      'apps/metaengine-browser/src/rsi-promotion-admission-gate.mjs',
    ],
    required_evidence_kinds: [...REQUIRED_EVIDENCE_KINDS],
    max_episodes: MAX_EPISODES,
    max_candidates_per_episode: MAX_CANDIDATES_PER_EPISODE,
    external_evaluator_required: true,
    candidate_can_modify_orchestrator: false,
    candidate_can_modify_evaluator: false,
    candidate_can_promote: false,
    candidate_can_invoke_self_update: false,
    physical_effect_replay_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, orchestrator_root_digest: digest(root) });
}
