import crypto from 'node:crypto';

import {
  RSI_EVOLUTION_ARCHIVE_SNAPSHOT_SCHEMA,
} from './rsi-shadow-tournament.mjs';
import {
  RSI_VERIFIED_EVOLUTION_ARCHIVE_SNAPSHOT_SCHEMA,
} from './rsi-verified-evolution-archive.mjs';

export const RSI_OPEN_ENDED_SEARCH_PLAN_SCHEMA = 'metaengine.rsi.open-ended-search-plan.v1';
export const RSI_EXPERIENCE_LESSON_SCHEMA = 'metaengine.rsi.experience-lesson.v1';
export const RSI_CURRICULUM_CHALLENGE_SCHEMA = 'metaengine.rsi.curriculum-challenge.v1';
export const RSI_PROPOSAL_NOVELTY_SCHEMA = 'metaengine.rsi.proposal-novelty.v1';
export const RSI_MODEL_ROUTING_SCHEMA = 'metaengine.rsi.model-routing.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const CANDIDATE_ID_RE = /^candidate_sha256_[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{1,255}$/;
const SAFE_TOKEN_RE = /^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const SAFE_SURFACES = new Set(['PROMPT_ROUTING', 'AGENT_ORCHESTRATION', 'TOOL_INTERFACE', 'BROWSER_RUNTIME', 'RSI_IMPROVER']);
const FAILURE_CLASSES = new Set([
  'HARD_INVARIANT_FAILURE',
  'NO_MEASURED_ADVANCE',
  'TRANSPORT_AMBIGUITY',
  'LATENCY_REGRESSION',
  'MEMORY_REGRESSION',
  'RECOVERY_REGRESSION',
  'GENERALIZATION_FAILURE',
  'BENCHMARK_CONTAMINATION_RISK',
  'NOVELTY_COLLAPSE',
]);
const CHALLENGE_SOURCES = new Set(['PRODUCTION_INCIDENT', 'HOLDOUT', 'ADVERSARIAL', 'TRANSFER', 'SYNTHETIC_CURRICULUM']);
const MAX_LESSONS = 256;
const MAX_SELECTED_LESSONS = 8;
const MAX_CHALLENGES = 512;
const MAX_SELECTED_CHALLENGES = 4;
const MAX_TAGS = 16;
const MAX_PATHS = 64;

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
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}

function exactDigest(value, label) {
  const out = String(value || '').toLowerCase();
  if (!SHA256_RE.test(out)) throw new Error(`rsi_search_${label}_digest_invalid`);
  return out;
}

function exactSha(value, label) {
  const out = String(value || '').toLowerCase();
  if (!SHA40_RE.test(out)) throw new Error(`rsi_search_${label}_sha_invalid`);
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_search_${label}_invalid`);
  return out;
}

function boundedToken(value, label) {
  const out = String(value || '').trim().toUpperCase();
  if (!SAFE_TOKEN_RE.test(out)) throw new Error(`rsi_search_${label}_invalid`);
  return out;
}

function positiveInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > max) throw new Error(`rsi_search_${label}_invalid`);
  return out;
}

function nonNegativeInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 0 || out > max) throw new Error(`rsi_search_${label}_invalid`);
  return out;
}

function zeroAuthority(extra = {}) {
  return Object.freeze({
    ...extra,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function assertZeroAuthority(value, label) {
  for (const field of ['execution_authority', 'production_mutation_authority', 'promotion_authority', 'self_update_authority', 'authority_effect']) {
    if (value?.[field] !== false) throw new Error(`rsi_search_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_search_${label}_automatic_retry_invalid`);
}

function normalizeCandidateId(value, label = 'candidate') {
  const out = String(value || '').toLowerCase();
  if (!CANDIDATE_ID_RE.test(out)) throw new Error(`rsi_search_${label}_id_invalid`);
  return out;
}

function normalizeSurface(value) {
  const out = String(value || '').toUpperCase();
  if (!SAFE_SURFACES.has(out)) throw new Error('rsi_search_mutation_surface_invalid');
  return out;
}

function normalizeTokens(value, label, max = MAX_TAGS) {
  if (!Array.isArray(value) || value.length < 1 || value.length > max) throw new Error(`rsi_search_${label}_invalid`);
  const set = new Set();
  for (const raw of value) {
    const token = boundedToken(raw, label);
    if (set.has(token)) throw new Error(`rsi_search_${label}_duplicate`);
    set.add(token);
  }
  return [...set].sort();
}

function normalizePaths(value, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PATHS) throw new Error(`rsi_search_${label}_invalid`);
  const set = new Set();
  for (const raw of value) {
    const path = String(raw || '').trim();
    if (!path || path.length > 240 || path.startsWith('/') || path.includes('\\') || path.includes('\0') || path.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error(`rsi_search_${label}_path_invalid`);
    }
    if (set.has(path)) throw new Error(`rsi_search_${label}_path_duplicate`);
    set.add(path);
  }
  return [...set].sort();
}

function verifyArchiveSnapshotDigest(snapshot) {
  const clone = structuredClone(snapshot);
  delete clone.snapshot_digest;
  return digest(clone);
}

function normalizeArchiveSnapshot(value) {
  let snapshot = value;
  if (value?.schema === RSI_VERIFIED_EVOLUTION_ARCHIVE_SNAPSHOT_SCHEMA) {
    assertZeroAuthority(value, 'verified_archive');
    if (value.verified_admission_required !== true || value.direct_archive_mutation_exposed !== false) {
      throw new Error('rsi_search_verified_archive_policy_invalid');
    }
    snapshot = value.archive_snapshot;
    if (!snapshot || value.archive_snapshot_digest !== snapshot.snapshot_digest) throw new Error('rsi_search_verified_archive_binding_invalid');
  }
  if (!plainObject(snapshot) || snapshot.schema !== RSI_EVOLUTION_ARCHIVE_SNAPSHOT_SCHEMA || snapshot.version !== 1) {
    throw new Error('rsi_search_archive_snapshot_invalid');
  }
  if (snapshot.scalar_ranking_authoritative !== false || snapshot.promotion_authority !== false || snapshot.self_update_authority !== false || snapshot.execution_authority !== false || snapshot.authority_effect !== false) {
    throw new Error('rsi_search_archive_authority_invalid');
  }
  if (exactDigest(snapshot.snapshot_digest, 'archive') !== verifyArchiveSnapshotDigest(snapshot)) {
    throw new Error('rsi_search_archive_snapshot_digest_mismatch');
  }
  if (!Array.isArray(snapshot.entries) || snapshot.entries.length < 1 || snapshot.entries.length > 4096) {
    throw new Error('rsi_search_archive_entries_invalid');
  }
  const seen = new Set();
  const entries = snapshot.entries.map((row) => {
    if (!plainObject(row)) throw new Error('rsi_search_archive_entry_invalid');
    const candidateId = normalizeCandidateId(row.candidate_id);
    if (seen.has(candidateId)) throw new Error('rsi_search_archive_candidate_duplicate');
    seen.add(candidateId);
    const state = boundedToken(row.state, 'archive_state');
    if (!['PARETO_ELITE', 'STEPPING_STONE', 'DOMINATED', 'NOT_ADMITTED'].includes(state)) throw new Error('rsi_search_archive_state_invalid');
    const relation = boundedToken(row.relation, 'archive_relation');
    if (!['PARETO_ADVANCE', 'TRADEOFF_STEPPING_STONE', 'NO_MEASURED_ADVANCE', 'REJECTED_HARD_INVARIANT'].includes(relation)) {
      throw new Error('rsi_search_archive_relation_invalid');
    }
    return Object.freeze({
      candidate_id: candidateId,
      candidate_sha: exactSha(row.candidate_sha, 'archive_candidate'),
      parent_sha: exactSha(row.parent_sha, 'archive_parent'),
      mutation_surface: normalizeSurface(row.mutation_surface),
      behavior_signature: boundedId(row.behavior_signature, 'behavior_signature'),
      state,
      active: row.active === true,
      relation,
      row_digest: exactDigest(row.row_digest, 'archive_row'),
    });
  });
  return Object.freeze({
    schema: snapshot.schema,
    version: 1,
    snapshot_digest: snapshot.snapshot_digest,
    entries,
  });
}

export function createRsiExperienceLesson({
  source_candidate_id,
  source_candidate_sha,
  mutation_surface,
  failure_class,
  mechanism_tags,
  challenge_families,
  recommendation_codes,
  evidence_digest,
  evidence_refs,
  external_verifier = false,
  authored_by_candidate = true,
} = {}) {
  if (external_verifier !== true || authored_by_candidate !== false) throw new Error('rsi_search_lesson_external_origin_required');
  const refs = normalizeTokens(evidence_refs, 'lesson_evidence_ref', 32);
  const core = {
    schema: RSI_EXPERIENCE_LESSON_SCHEMA,
    version: 1,
    source_candidate_id: normalizeCandidateId(source_candidate_id, 'lesson_candidate'),
    source_candidate_sha: exactSha(source_candidate_sha, 'lesson_candidate'),
    mutation_surface: normalizeSurface(mutation_surface),
    failure_class: (() => {
      const out = boundedToken(failure_class, 'lesson_failure_class');
      if (!FAILURE_CLASSES.has(out)) throw new Error('rsi_search_lesson_failure_class_invalid');
      return out;
    })(),
    mechanism_tags: normalizeTokens(mechanism_tags, 'lesson_mechanism_tag'),
    challenge_families: normalizeTokens(challenge_families, 'lesson_challenge_family'),
    recommendation_codes: normalizeTokens(recommendation_codes, 'lesson_recommendation_code'),
    evidence_digest: exactDigest(evidence_digest, 'lesson_evidence'),
    evidence_refs: refs,
    external_verifier: true,
    authored_by_candidate: false,
    freeform_candidate_memory_allowed: false,
    trusted_ingest_required: true,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  const lessonDigest = digest(core);
  return Object.freeze({
    ...core,
    lesson_id: `rsi_lesson_${lessonDigest.slice('sha256:'.length, 'sha256:'.length + 24)}`,
    lesson_digest: lessonDigest,
  });
}

export function verifyRsiExperienceLesson(lesson) {
  if (!plainObject(lesson) || lesson.schema !== RSI_EXPERIENCE_LESSON_SCHEMA || lesson.version !== 1) throw new Error('rsi_search_lesson_invalid');
  assertZeroAuthority(lesson, 'lesson');
  if (lesson.external_verifier !== true || lesson.authored_by_candidate !== false || lesson.freeform_candidate_memory_allowed !== false || lesson.trusted_ingest_required !== true) {
    throw new Error('rsi_search_lesson_origin_policy_invalid');
  }
  const copy = {
    schema: lesson.schema,
    version: lesson.version,
    source_candidate_id: normalizeCandidateId(lesson.source_candidate_id, 'lesson_candidate'),
    source_candidate_sha: exactSha(lesson.source_candidate_sha, 'lesson_candidate'),
    mutation_surface: normalizeSurface(lesson.mutation_surface),
    failure_class: boundedToken(lesson.failure_class, 'lesson_failure_class'),
    mechanism_tags: normalizeTokens(lesson.mechanism_tags, 'lesson_mechanism_tag'),
    challenge_families: normalizeTokens(lesson.challenge_families, 'lesson_challenge_family'),
    recommendation_codes: normalizeTokens(lesson.recommendation_codes, 'lesson_recommendation_code'),
    evidence_digest: exactDigest(lesson.evidence_digest, 'lesson_evidence'),
    evidence_refs: normalizeTokens(lesson.evidence_refs, 'lesson_evidence_ref', 32),
    external_verifier: true,
    authored_by_candidate: false,
    freeform_candidate_memory_allowed: false,
    trusted_ingest_required: true,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  if (!FAILURE_CLASSES.has(copy.failure_class)) throw new Error('rsi_search_lesson_failure_class_invalid');
  const expected = digest(copy);
  if (lesson.lesson_digest !== expected || lesson.lesson_id !== `rsi_lesson_${expected.slice('sha256:'.length, 'sha256:'.length + 24)}`) {
    throw new Error('rsi_search_lesson_digest_mismatch');
  }
  return Object.freeze({ ...copy, lesson_id: lesson.lesson_id, lesson_digest: lesson.lesson_digest });
}

export function createRsiCurriculumChallenge({
  challenge_id,
  family,
  difficulty,
  source_class,
  suite_digest,
  hidden_manifest_digest,
  attempted_count = 0,
  solved_count = 0,
  external_origin_verified = false,
  authored_by_candidate = true,
} = {}) {
  if (external_origin_verified !== true || authored_by_candidate !== false) throw new Error('rsi_search_challenge_external_origin_required');
  const attempted = nonNegativeInt(attempted_count, 'challenge_attempted', 1_000_000);
  const solved = nonNegativeInt(solved_count, 'challenge_solved', attempted);
  const source = boundedToken(source_class, 'challenge_source');
  if (!CHALLENGE_SOURCES.has(source)) throw new Error('rsi_search_challenge_source_invalid');
  const core = {
    schema: RSI_CURRICULUM_CHALLENGE_SCHEMA,
    version: 1,
    challenge_id: boundedId(challenge_id, 'challenge_id'),
    family: boundedToken(family, 'challenge_family'),
    difficulty: positiveInt(difficulty, 'challenge_difficulty', 10),
    source_class: source,
    suite_digest: exactDigest(suite_digest, 'challenge_suite'),
    hidden_manifest_digest: exactDigest(hidden_manifest_digest, 'challenge_manifest'),
    attempted_count: attempted,
    solved_count: solved,
    external_origin_verified: true,
    authored_by_candidate: false,
    task_manifest_exposed_to_candidate: false,
    solution_exposed_to_candidate: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  const challengeDigest = digest(core);
  return Object.freeze({ ...core, challenge_digest: challengeDigest });
}

export function verifyRsiCurriculumChallenge(challenge) {
  if (!plainObject(challenge) || challenge.schema !== RSI_CURRICULUM_CHALLENGE_SCHEMA || challenge.version !== 1) throw new Error('rsi_search_challenge_invalid');
  assertZeroAuthority(challenge, 'challenge');
  if (challenge.external_origin_verified !== true || challenge.authored_by_candidate !== false || challenge.task_manifest_exposed_to_candidate !== false || challenge.solution_exposed_to_candidate !== false) {
    throw new Error('rsi_search_challenge_policy_invalid');
  }
  const canonical = createRsiCurriculumChallenge({
    challenge_id: challenge.challenge_id,
    family: challenge.family,
    difficulty: challenge.difficulty,
    source_class: challenge.source_class,
    suite_digest: challenge.suite_digest,
    hidden_manifest_digest: challenge.hidden_manifest_digest,
    attempted_count: challenge.attempted_count,
    solved_count: challenge.solved_count,
    external_origin_verified: true,
    authored_by_candidate: false,
  });
  if (challenge.challenge_digest !== canonical.challenge_digest) throw new Error('rsi_search_challenge_digest_mismatch');
  return canonical;
}

function usageMap(value, entries, generation) {
  const rows = Array.isArray(value) ? value : [];
  if (rows.length > entries.length + 64) throw new Error('rsi_search_parent_usage_invalid');
  const known = new Set(entries.map((entry) => entry.candidate_id));
  const map = new Map();
  for (const row of rows) {
    if (!plainObject(row)) throw new Error('rsi_search_parent_usage_row_invalid');
    const id = normalizeCandidateId(row.candidate_id, 'usage_candidate');
    if (!known.has(id) || map.has(id)) throw new Error('rsi_search_parent_usage_candidate_invalid');
    const selectionCount = nonNegativeInt(row.selection_count, 'selection_count', 1_000_000);
    const lastSelected = row.last_selected_generation == null ? 0 : nonNegativeInt(row.last_selected_generation, 'last_selected_generation', generation);
    map.set(id, Object.freeze({ selection_count: selectionCount, last_selected_generation: lastSelected }));
  }
  return map;
}

function descendantCounts(entries) {
  const bySha = new Map(entries.map((entry) => [entry.candidate_sha, entry]));
  const out = new Map(entries.map((entry) => [entry.candidate_id, 0]));
  for (const entry of entries) {
    const parent = bySha.get(entry.parent_sha);
    if (parent) out.set(parent.candidate_id, (out.get(parent.candidate_id) || 0) + 1);
  }
  return out;
}

function rarityMaps(entries) {
  const behavior = new Map();
  const surface = new Map();
  for (const entry of entries.filter((row) => row.active)) {
    behavior.set(entry.behavior_signature, (behavior.get(entry.behavior_signature) || 0) + 1);
    surface.set(entry.mutation_surface, (surface.get(entry.mutation_surface) || 0) + 1);
  }
  return { behavior, surface };
}

function deterministicTie(seed, id) {
  return crypto.createHash('sha256').update(`${seed}:${id}`, 'utf8').digest('hex');
}

function parentRank(entry, role, usage, rarity, descendants, generation, seed) {
  const row = usage.get(entry.candidate_id) || { selection_count: 0, last_selected_generation: 0 };
  const age = Math.max(0, generation - row.last_selected_generation);
  const behaviorRarity = rarity.behavior.get(entry.behavior_signature) || 0;
  const surfaceRarity = rarity.surface.get(entry.mutation_surface) || 0;
  const childCount = descendants.get(entry.candidate_id) || 0;
  const roleRank = (() => {
    switch (role) {
      case 'PARETO_EXPLOIT': return entry.active && entry.state === 'PARETO_ELITE' ? 0 : 1;
      case 'STEPPING_STONE': return entry.active && entry.state === 'STEPPING_STONE' ? 0 : 1;
      case 'NICHE_COVERAGE': return entry.active ? 0 : 1;
      case 'ANCESTOR_REVIVAL': return !entry.active && entry.state === 'DOMINATED' && childCount > 0 ? 0 : 1;
      default: return 1;
    }
  })();
  return [
    roleRank,
    role === 'NICHE_COVERAGE' ? behaviorRarity : 0,
    role === 'NICHE_COVERAGE' ? surfaceRarity : 0,
    row.selection_count,
    -age,
    role === 'ANCESTOR_REVIVAL' ? -childCount : 0,
    deterministicTie(seed, entry.candidate_id),
  ];
}

function lexCompare(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === b) continue;
    return a < b ? -1 : 1;
  }
  return 0;
}

function selectParents(entries, usage, generation, seed) {
  const rarity = rarityMaps(entries);
  const descendants = descendantCounts(entries);
  const roles = ['PARETO_EXPLOIT', 'STEPPING_STONE', 'NICHE_COVERAGE', 'ANCESTOR_REVIVAL'];
  const selected = [];
  const used = new Set();
  for (const role of roles) {
    const ranked = entries
      .filter((entry) => !used.has(entry.candidate_id))
      .map((entry) => ({ entry, rank: parentRank(entry, role, usage, rarity, descendants, generation, seed) }))
      .sort((a, b) => lexCompare(a.rank, b.rank));
    const best = ranked[0]?.entry || null;
    if (!best) continue;
    const roleEligible = parentRank(best, role, usage, rarity, descendants, generation, seed)[0] === 0;
    if (!roleEligible && role === 'ANCESTOR_REVIVAL') continue;
    used.add(best.candidate_id);
    selected.push(Object.freeze({
      role,
      candidate_id: best.candidate_id,
      candidate_sha: best.candidate_sha,
      state: best.state,
      active: best.active,
      mutation_surface: best.mutation_surface,
      behavior_signature: best.behavior_signature,
      descendant_count: descendants.get(best.candidate_id) || 0,
      scalar_winner: null,
      selection_is_promotion: false,
    }));
  }
  if (selected.length === 0) throw new Error('rsi_search_parent_selection_empty');
  return Object.freeze(selected);
}

function lessonRelevance(lesson, parents, challengeFamilies) {
  let score = 0;
  for (const parent of parents) {
    if (lesson.source_candidate_id === parent.candidate_id) score += 4;
    if (lesson.mutation_surface === parent.mutation_surface) score += 2;
  }
  for (const family of lesson.challenge_families) if (challengeFamilies.has(family)) score += 3;
  if (lesson.failure_class === 'HARD_INVARIANT_FAILURE' || lesson.failure_class === 'GENERALIZATION_FAILURE') score += 1;
  return score;
}

function selectLessons(lessons, parents, challengeFamilies, seed) {
  return lessons
    .map((lesson) => ({ lesson, relevance: lessonRelevance(lesson, parents, challengeFamilies) }))
    .filter((row) => row.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || deterministicTie(seed, a.lesson.lesson_id).localeCompare(deterministicTie(seed, b.lesson.lesson_id)))
    .slice(0, MAX_SELECTED_LESSONS)
    .map(({ lesson }) => Object.freeze({
      lesson_id: lesson.lesson_id,
      lesson_digest: lesson.lesson_digest,
      failure_class: lesson.failure_class,
      mutation_surface: lesson.mutation_surface,
      mechanism_tags: [...lesson.mechanism_tags],
      recommendation_codes: [...lesson.recommendation_codes],
      freeform_memory_exposed: false,
      candidate_authored: false,
    }));
}

function challengeSolveRate(challenge) {
  return challenge.attempted_count === 0 ? null : challenge.solved_count / challenge.attempted_count;
}

function challengeRolePriority(challenge) {
  switch (challenge.source_class) {
    case 'PRODUCTION_INCIDENT': return 0;
    case 'ADVERSARIAL': return 1;
    case 'TRANSFER': return 2;
    case 'HOLDOUT': return 3;
    case 'SYNTHETIC_CURRICULUM': return 4;
    default: return 5;
  }
}

function selectChallenges(challenges, seed) {
  const ranked = challenges
    .map((challenge) => {
      const rate = challengeSolveRate(challenge);
      const frontierDistance = rate == null ? 0 : Math.abs(0.5 - rate);
      const minimalCriterionPenalty = rate != null && (rate <= 0.05 || rate >= 0.95) ? 1 : 0;
      return {
        challenge,
        rank: [
          minimalCriterionPenalty,
          challengeRolePriority(challenge),
          frontierDistance,
          challenge.attempted_count,
          -challenge.difficulty,
          deterministicTie(seed, challenge.challenge_id),
        ],
      };
    })
    .sort((a, b) => lexCompare(a.rank, b.rank));

  const selected = [];
  const sourceSeen = new Set();
  for (const row of ranked) {
    if (selected.length >= MAX_SELECTED_CHALLENGES) break;
    if (sourceSeen.has(row.challenge.source_class) && ranked.some((other) => !sourceSeen.has(other.challenge.source_class))) continue;
    sourceSeen.add(row.challenge.source_class);
    selected.push(row.challenge);
  }
  while (selected.length < Math.min(MAX_SELECTED_CHALLENGES, ranked.length)) {
    const next = ranked.find((row) => !selected.some((challenge) => challenge.challenge_id === row.challenge.challenge_id));
    if (!next) break;
    selected.push(next.challenge);
  }
  return Object.freeze(selected.map((challenge) => Object.freeze({
    challenge_id: challenge.challenge_id,
    challenge_digest: challenge.challenge_digest,
    family: challenge.family,
    difficulty: challenge.difficulty,
    source_class: challenge.source_class,
    solve_rate: challengeSolveRate(challenge),
    suite_digest: challenge.suite_digest,
    hidden_manifest_digest: challenge.hidden_manifest_digest,
    manifest_exposed_to_candidate: false,
    solution_exposed_to_candidate: false,
  })));
}

export function selectRsiProposalModelArm({ arms, exploration = Math.SQRT2, seed = 'rsi-model-routing-v1' } = {}) {
  if (!Array.isArray(arms) || arms.length < 1 || arms.length > 64) throw new Error('rsi_search_model_arms_invalid');
  const normalized = arms.map((row) => {
    if (!plainObject(row) || row.external_metrics_verified !== true || row.authored_by_candidate !== false) throw new Error('rsi_search_model_arm_origin_invalid');
    const attempts = nonNegativeInt(row.attempts, 'model_attempts', 1_000_000);
    const useful = nonNegativeInt(row.useful_proposals, 'model_useful', attempts);
    return Object.freeze({
      arm_id: boundedId(row.arm_id, 'model_arm_id'),
      attempts,
      useful_proposals: useful,
    });
  });
  const total = normalized.reduce((sum, row) => sum + row.attempts, 0);
  const untried = normalized.filter((row) => row.attempts === 0)
    .sort((a, b) => deterministicTie(seed, a.arm_id).localeCompare(deterministicTie(seed, b.arm_id)));
  const selected = untried[0] || normalized
    .map((row) => ({
      row,
      score: row.useful_proposals / row.attempts + Number(exploration) * Math.sqrt(Math.log(Math.max(2, total)) / row.attempts),
    }))
    .sort((a, b) => b.score - a.score || deterministicTie(seed, a.row.arm_id).localeCompare(deterministicTie(seed, b.row.arm_id)))[0]?.row;
  if (!selected) throw new Error('rsi_search_model_arm_selection_failed');
  return zeroAuthority({
    schema: RSI_MODEL_ROUTING_SCHEMA,
    version: 1,
    selected_arm_id: selected.arm_id,
    untried_arm_priority: selected.attempts === 0,
    routing_metric: 'UCB1_USEFUL_PROPOSALS',
    routing_is_evaluation: false,
    routing_is_promotion: false,
    candidate_selectable: false,
    external_metrics_required: true,
  });
}

function jaccard(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / union.size;
}

function normalizeProposal(value) {
  if (!plainObject(value)) throw new Error('rsi_search_proposal_invalid');
  return Object.freeze({
    proposal_id: boundedId(value.proposal_id, 'proposal_id'),
    parent_sha: exactSha(value.parent_sha, 'proposal_parent'),
    mutation_surface: normalizeSurface(value.mutation_surface),
    mutation_paths: normalizePaths(value.mutation_paths, 'proposal_mutation_paths'),
    mechanism_tags: normalizeTokens(value.mechanism_tags, 'proposal_mechanism_tags'),
  });
}

export function assessRsiProposalNovelty({ proposal, prior_proposals = [] } = {}) {
  const candidate = normalizeProposal(proposal);
  if (!Array.isArray(prior_proposals) || prior_proposals.length > 2048) throw new Error('rsi_search_prior_proposals_invalid');
  const priors = prior_proposals.map(normalizeProposal);
  const candidateSignature = digest({
    parent_sha: candidate.parent_sha,
    mutation_surface: candidate.mutation_surface,
    mutation_paths: candidate.mutation_paths,
    mechanism_tags: candidate.mechanism_tags,
  });
  let nearest = null;
  for (const prior of priors) {
    const priorSignature = digest({
      parent_sha: prior.parent_sha,
      mutation_surface: prior.mutation_surface,
      mutation_paths: prior.mutation_paths,
      mechanism_tags: prior.mechanism_tags,
    });
    if (priorSignature === candidateSignature) {
      return zeroAuthority({
        schema: RSI_PROPOSAL_NOVELTY_SCHEMA,
        version: 1,
        proposal_id: candidate.proposal_id,
        state: 'REJECT_EXACT_DUPLICATE',
        proposal_signature: candidateSignature,
        nearest_proposal_id: prior.proposal_id,
        structural_path_similarity: 1,
        mechanism_similarity: 1,
        expensive_evaluation_allowed: false,
        external_novelty_review_required: false,
        llm_novelty_judge_is_authority: false,
      });
    }
    const pathSimilarity = jaccard(candidate.mutation_paths, prior.mutation_paths);
    const mechanismSimilarity = jaccard(candidate.mechanism_tags, prior.mechanism_tags);
    const combined = (pathSimilarity + mechanismSimilarity) / 2;
    if (!nearest || combined > nearest.combined) nearest = { prior, pathSimilarity, mechanismSimilarity, combined };
  }
  const nearDuplicate = nearest
    && nearest.combined >= 0.8
    && nearest.pathSimilarity >= 0.6
    && nearest.mechanismSimilarity >= 0.6;
  return zeroAuthority({
    schema: RSI_PROPOSAL_NOVELTY_SCHEMA,
    version: 1,
    proposal_id: candidate.proposal_id,
    state: nearDuplicate ? 'EXTERNAL_NOVELTY_REVIEW_REQUIRED' : 'ADMIT_TO_CHEAP_EVAL',
    proposal_signature: candidateSignature,
    nearest_proposal_id: nearest?.prior?.proposal_id || null,
    structural_path_similarity: nearest?.pathSimilarity ?? null,
    mechanism_similarity: nearest?.mechanismSimilarity ?? null,
    expensive_evaluation_allowed: !nearDuplicate,
    external_novelty_review_required: Boolean(nearDuplicate),
    llm_novelty_judge_is_authority: false,
  });
}

export function createRsiOpenEndedSearchPlan({
  archive_snapshot,
  generation,
  parent_usage = [],
  experience_lessons = [],
  challenge_catalog = [],
  model_arms = null,
} = {}) {
  const archive = normalizeArchiveSnapshot(archive_snapshot);
  const currentGeneration = positiveInt(generation, 'generation', 1_000_000);
  if (!Array.isArray(experience_lessons) || experience_lessons.length > MAX_LESSONS) throw new Error('rsi_search_lessons_invalid');
  if (!Array.isArray(challenge_catalog) || challenge_catalog.length < 1 || challenge_catalog.length > MAX_CHALLENGES) throw new Error('rsi_search_challenge_catalog_invalid');
  const lessons = experience_lessons.map(verifyRsiExperienceLesson);
  const challenges = challenge_catalog.map(verifyRsiCurriculumChallenge);
  const usage = usageMap(parent_usage, archive.entries, currentGeneration);
  const seed = digest({ archive: archive.snapshot_digest, generation: currentGeneration, challenges: challenges.map((row) => row.challenge_digest) });
  const parents = selectParents(archive.entries, usage, currentGeneration, seed);
  const selectedChallenges = selectChallenges(challenges, seed);
  const challengeFamilies = new Set(selectedChallenges.map((row) => row.family));
  const selectedLessons = selectLessons(lessons, parents, challengeFamilies, seed);
  const modelRouting = model_arms == null ? null : selectRsiProposalModelArm({ arms: model_arms, seed });

  const core = {
    schema: RSI_OPEN_ENDED_SEARCH_PLAN_SCHEMA,
    version: 1,
    generation: currentGeneration,
    archive_snapshot_digest: archive.snapshot_digest,
    parents,
    curriculum: {
      selected_challenges: selectedChallenges,
      minimal_criterion_preferred: true,
      adversarial_history_allowed: true,
      cross_environment_transfer_allowed: true,
      hidden_manifest_required: true,
      candidate_can_select_challenge: false,
      holdout_solution_exposed: false,
    },
    experience_memory: {
      selected_lessons: selectedLessons,
      structured_codes_only: true,
      freeform_candidate_memory_allowed: false,
      external_verifier_required: true,
      candidate_authored_lessons_allowed: false,
    },
    novelty_policy: {
      exact_duplicate_rejected_before_expensive_evaluation: true,
      near_duplicate_requires_external_review: true,
      structural_filter_precedes_llm_novelty_judge: true,
      llm_novelty_judge_is_authority: false,
    },
    proposal_routing: modelRouting,
    search_policy: {
      preserve_stepping_stones: true,
      dominated_ancestor_revival_if_descendant_evidence: true,
      balance_exploration_and_exploitation: true,
      niche_coverage_required: true,
      single_scalar_fitness_authoritative: false,
      parent_selection_is_promotion: false,
      candidate_can_modify_search_policy: false,
      candidate_can_select_parent: false,
      candidate_can_select_holdout: false,
      early_stop_authorized: false,
    },
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  const planDigest = digest(core);
  return Object.freeze({
    ...core,
    plan_id: `rsi_search_${planDigest.slice('sha256:'.length, 'sha256:'.length + 24)}`,
    plan_digest: planDigest,
  });
}

export function verifyRsiOpenEndedSearchPlan(plan) {
  if (!plainObject(plan) || plan.schema !== RSI_OPEN_ENDED_SEARCH_PLAN_SCHEMA || plan.version !== 1) throw new Error('rsi_search_plan_invalid');
  assertZeroAuthority(plan, 'plan');
  if (
    plan.search_policy?.candidate_can_modify_search_policy !== false
    || plan.search_policy?.candidate_can_select_parent !== false
    || plan.search_policy?.candidate_can_select_holdout !== false
    || plan.search_policy?.single_scalar_fitness_authoritative !== false
    || plan.search_policy?.preserve_stepping_stones !== true
    || plan.search_policy?.dominated_ancestor_revival_if_descendant_evidence !== true
    || plan.curriculum?.hidden_manifest_required !== true
    || plan.curriculum?.holdout_solution_exposed !== false
    || plan.experience_memory?.freeform_candidate_memory_allowed !== false
    || plan.novelty_policy?.llm_novelty_judge_is_authority !== false
  ) {
    throw new Error('rsi_search_plan_policy_invalid');
  }
  if (!Array.isArray(plan.parents) || plan.parents.length < 1 || plan.parents.length > 4) throw new Error('rsi_search_plan_parents_invalid');
  for (const parent of plan.parents) {
    normalizeCandidateId(parent.candidate_id, 'plan_parent');
    exactSha(parent.candidate_sha, 'plan_parent');
    normalizeSurface(parent.mutation_surface);
    if (parent.selection_is_promotion !== false || parent.scalar_winner !== null) throw new Error('rsi_search_plan_parent_authority_invalid');
  }
  if (!Array.isArray(plan.curriculum?.selected_challenges) || plan.curriculum.selected_challenges.length < 1 || plan.curriculum.selected_challenges.length > MAX_SELECTED_CHALLENGES) {
    throw new Error('rsi_search_plan_challenges_invalid');
  }
  for (const challenge of plan.curriculum.selected_challenges) {
    exactDigest(challenge.challenge_digest, 'plan_challenge');
    exactDigest(challenge.suite_digest, 'plan_challenge_suite');
    exactDigest(challenge.hidden_manifest_digest, 'plan_challenge_manifest');
    if (challenge.manifest_exposed_to_candidate !== false || challenge.solution_exposed_to_candidate !== false) throw new Error('rsi_search_plan_challenge_exposure_invalid');
  }
  const clone = structuredClone(plan);
  delete clone.plan_id;
  delete clone.plan_digest;
  const expected = digest(clone);
  if (plan.plan_digest !== expected || plan.plan_id !== `rsi_search_${expected.slice('sha256:'.length, 'sha256:'.length + 24)}`) {
    throw new Error('rsi_search_plan_digest_mismatch');
  }
  return plan;
}

export function rsiOpenEndedSearchTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.open-ended-search-root.v1',
    version: 1,
    policy_path: 'apps/metaengine-browser/src/rsi-open-ended-search-policy.mjs',
    parent_roles: ['PARETO_EXPLOIT', 'STEPPING_STONE', 'NICHE_COVERAGE', 'ANCESTOR_REVIVAL'],
    challenge_sources: [...CHALLENGE_SOURCES].sort(),
    failure_classes: [...FAILURE_CLASSES].sort(),
    max_selected_lessons: MAX_SELECTED_LESSONS,
    max_selected_challenges: MAX_SELECTED_CHALLENGES,
    candidate_can_modify_search_policy: false,
    candidate_can_author_lessons: false,
    candidate_can_select_parent: false,
    candidate_can_select_challenge: false,
    candidate_can_select_holdout: false,
    llm_novelty_judge_is_authority: false,
    scalar_fitness_authoritative: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, search_root_digest: digest(root) });
}
