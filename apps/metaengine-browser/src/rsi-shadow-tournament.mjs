import crypto from 'node:crypto';

import {
  RSI_HARD_INVARIANTS,
  RSI_MUTATION_SURFACES,
  RSI_SHADOW_STATES,
} from './rsi-shadow-core.mjs';
import { RSI_EVALUATOR_MESH_RESULT_SCHEMA, rsiEvaluatorRootSnapshot } from './rsi-evaluator-mesh.mjs';
import { RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA } from './rsi-isolated-candidate-builder.mjs';

export const RSI_SHADOW_TOURNAMENT_PLAN_SCHEMA = 'metaengine.rsi.shadow-tournament-plan.v1';
export const RSI_SHADOW_TOURNAMENT_PAIR_RECEIPT_SCHEMA = 'metaengine.rsi.shadow-tournament-pair-receipt.v1';
export const RSI_SHADOW_TOURNAMENT_RESULT_SCHEMA = 'metaengine.rsi.shadow-tournament-result.v1';
export const RSI_EVOLUTION_ARCHIVE_SNAPSHOT_SCHEMA = 'metaengine.rsi.evolution-archive-snapshot.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,511}$/;
const MAX_EVIDENCE_REFS = 32;
const DEFAULT_PAIR_COUNT = 5;
const MIN_PAIR_COUNT = 3;
const MAX_PAIR_COUNT = 21;
const DEFAULT_MAX_ARCHIVE_ENTRIES = 256;
const DEFAULT_MAX_NICHE_ENTRIES = 8;

const REQUIRED_OBJECTIVES = Object.freeze([
  'task_success_rate',
  'p95_latency_ms',
  'peak_rss_bytes',
  'recovery_p95_ms',
]);
const OPTIONAL_OBJECTIVES = Object.freeze(['tokens_per_success']);

const MATERIALITY = Object.freeze({
  task_success_rate: Object.freeze({ mode: 'ABSOLUTE', threshold: 0.01 }),
  p95_latency_ms: Object.freeze({ mode: 'RELATIVE', threshold: 0.05 }),
  tokens_per_success: Object.freeze({ mode: 'RELATIVE', threshold: 0.05 }),
  peak_rss_bytes: Object.freeze({ mode: 'RELATIVE', threshold: 0.05 }),
  recovery_p95_ms: Object.freeze({ mode: 'RELATIVE', threshold: 0.05 }),
});

const TOURNAMENT_TRUST_ROOT_PATHS = new Set([
  'apps/metaengine-browser/src/rsi-shadow-tournament.mjs',
  'apps/metaengine-browser/src/rsi-evaluator-mesh.mjs',
  'apps/metaengine-browser/src/rsi-shadow-core.mjs',
  'apps/metaengine-browser/src/rsi-isolated-candidate-builder.mjs',
  'apps/metaengine-browser/src/rsi-open-ended-search-policy.mjs',
  'apps/metaengine-browser/src/rsi-recursive-risk-budget.mjs',
  'apps/metaengine-browser/src/rsi-adversarial-challenge-producer.mjs',
  'apps/metaengine-browser/src/rsi-component-attribution.mjs',
  'apps/metaengine-browser/src/rsi-group-experience-exchange.mjs',
  'apps/metaengine-browser/src/rsi-adaptive-experience-retrieval.mjs',
  'apps/metaengine-browser/src/rsi-agent-architecture-search.mjs',
  'apps/metaengine-browser/src/rsi-clade-metaproductivity.mjs',
  'apps/metaengine-browser/src/rsi-comparative-lineage-operators.mjs',
  'apps/metaengine-browser/src/rsi-trace-guided-harness-repair.mjs',
  'apps/metaengine-browser/src/candidate-capsule.cjs',
  'apps/metaengine-browser/src/verification-sandbox-plan.cjs',
  'apps/metaengine-browser/src/verification-sandbox-backend-binding.cjs',
  'apps/metaengine-browser/src/browser-identity-signer-runtime.mjs',
  'apps/metaengine-browser/src/trusted-dev-release-resolver.mjs',
]);

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

function exactSha(value, label) {
  const normalized = String(value || '').toLowerCase();
  if (!SHA40_RE.test(normalized)) throw new Error(`rsi_tournament_${label}_exact_sha_required`);
  return normalized;
}

function exactDigest(value, label) {
  const normalized = String(value || '').toLowerCase();
  if (!SHA256_RE.test(normalized)) throw new Error(`rsi_tournament_${label}_digest_invalid`);
  return normalized;
}

function zeroAuthority(value, label) {
  for (const field of ['execution_authority', 'production_mutation_authority', 'promotion_authority', 'self_update_authority', 'authority_effect']) {
    if (value?.[field] !== false) throw new Error(`rsi_tournament_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_tournament_${label}_automatic_retry_invalid`);
}

function boundedText(value, label, max = 160) {
  const text = String(value || '').trim();
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) throw new Error(`rsi_tournament_${label}_invalid`);
  return text;
}

function normalizeEvidenceRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EVIDENCE_REFS) throw new Error('rsi_tournament_evidence_refs_invalid');
  const seen = new Set();
  return value.map((entry) => {
    const ref = String(entry || '').trim();
    if (!SAFE_ID_RE.test(ref) || seen.has(ref)) throw new Error('rsi_tournament_evidence_ref_invalid');
    seen.add(ref);
    return ref;
  }).sort();
}

function objectiveRoot() {
  const root = rsiEvaluatorRootSnapshot();
  const byName = new Map(root.objectives.map((entry) => [entry.objective, entry]));
  for (const objective of [...REQUIRED_OBJECTIVES, ...OPTIONAL_OBJECTIVES]) {
    if (!byName.has(objective)) throw new Error(`rsi_tournament_objective_root_missing:${objective}`);
  }
  const rows = [...REQUIRED_OBJECTIVES, ...OPTIONAL_OBJECTIVES].map((name) => {
    const source = byName.get(name);
    return Object.freeze({
      name,
      direction: source.direction,
      evaluator_id: source.evaluator_id,
      evaluator_digest: source.evaluator_digest,
      required: REQUIRED_OBJECTIVES.includes(name),
      materiality: MATERIALITY[name],
    });
  });
  return Object.freeze({
    evaluator_root_digest: root.evaluator_root_digest,
    objectives: rows,
    scalar_reward_authoritative: false,
    candidate_selectable: false,
    candidate_mutable: false,
  });
}

function assertCandidateDoesNotMutateTournamentRoot(handoff) {
  const components = Array.isArray(handoff?.candidate_capsule?.components) ? handoff.candidate_capsule.components : [];
  for (const component of components) {
    const path = String(component?.path || '');
    if (TOURNAMENT_TRUST_ROOT_PATHS.has(path)) throw new Error('rsi_tournament_candidate_mutates_tournament_root');
  }
}

function normalizeHandoff(handoff) {
  if (!plainObject(handoff) || handoff.schema !== RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA || handoff.version !== 1) {
    throw new Error('rsi_tournament_candidate_handoff_invalid');
  }
  zeroAuthority(handoff, 'handoff');
  if (handoff.eligible_for_evaluation !== true || handoff.eligible_for_promotion !== false || handoff.materialization_replay_authorized !== false) {
    throw new Error('rsi_tournament_candidate_handoff_policy_invalid');
  }
  assertCandidateDoesNotMutateTournamentRoot(handoff);
  const candidateSha = exactSha(handoff.candidate_sha, 'candidate');
  const parentSha = exactSha(handoff.parent_sha, 'parent');
  if (candidateSha === parentSha) throw new Error('rsi_tournament_candidate_noop');
  const candidateId = String(handoff.candidate_capsule?.candidate_id || '').toLowerCase();
  if (!/^candidate_sha256_[0-9a-f]{64}$/.test(candidateId)) throw new Error('rsi_tournament_candidate_id_invalid');
  if (handoff.candidate_capsule?.source?.head !== candidateSha || handoff.shadow_archive_proposal?.candidate_id !== candidateId) {
    throw new Error('rsi_tournament_candidate_identity_mismatch');
  }
  const mutationSurface = String(handoff.mutation_surface || '').toUpperCase();
  if (!RSI_MUTATION_SURFACES.includes(mutationSurface)) throw new Error('rsi_tournament_mutation_surface_invalid');
  return Object.freeze({
    candidate_id: candidateId,
    candidate_sha: candidateSha,
    parent_sha: parentSha,
    mutation_surface: mutationSurface,
    handoff_digest: exactDigest(handoff.handoff_digest, 'handoff'),
  });
}

function verifyMeshResultDigest(result) {
  const clone = structuredClone(result);
  delete clone.result_digest;
  return digest(clone);
}

function normalizeEvaluatorResult(result, candidate) {
  if (!plainObject(result) || result.schema !== RSI_EVALUATOR_MESH_RESULT_SCHEMA || result.version !== 1) {
    throw new Error('rsi_tournament_evaluator_result_invalid');
  }
  zeroAuthority(result, 'evaluator_result');
  if (String(result.candidate_id || '').toLowerCase() !== candidate.candidate_id || exactSha(result.candidate_sha, 'evaluator_candidate') !== candidate.candidate_sha) {
    throw new Error('rsi_tournament_evaluator_candidate_mismatch');
  }
  if (result.state !== RSI_SHADOW_STATES.SHADOW_QUALIFIED || result.eligible_for_promotion !== false) {
    throw new Error('rsi_tournament_candidate_not_shadow_qualified');
  }
  const resultDigest = exactDigest(result.result_digest, 'evaluator_result');
  if (resultDigest !== verifyMeshResultDigest(result)) throw new Error('rsi_tournament_evaluator_result_digest_mismatch');
  if (!/^[0-9a-f]{64}$/.test(String(result.final_digest || '').toLowerCase())) throw new Error('rsi_tournament_evaluator_final_digest_invalid');
  if (!Array.isArray(result.receipt_digests) || result.receipt_digests.length < RSI_HARD_INVARIANTS.length + 1) throw new Error('rsi_tournament_evaluator_receipts_invalid');
  for (const receiptDigest of result.receipt_digests) exactDigest(receiptDigest, 'evaluator_receipt');
  if (!plainObject(result.hard_invariants) || Object.keys(result.hard_invariants).length !== RSI_HARD_INVARIANTS.length) throw new Error('rsi_tournament_evaluator_invariant_shape_invalid');
  for (const invariant of RSI_HARD_INVARIANTS) {
    if (result.hard_invariants?.[invariant] !== 'PASS') throw new Error(`rsi_tournament_evaluator_invariant_not_pass:${invariant}`);
  }
  if (!Array.isArray(result.objectives) || result.objectives.length < 1) throw new Error('rsi_tournament_evaluator_objectives_invalid');
  return Object.freeze({ result_digest: resultDigest, plan_id: boundedText(result.plan_id, 'evaluator_plan_id', 160) });
}

function normalizeWorkload(workload) {
  if (!plainObject(workload)) throw new Error('rsi_tournament_workload_invalid');
  const taskClass = boundedText(workload.task_class, 'task_class', 96);
  const environmentFingerprint = boundedText(workload.environment_fingerprint, 'environment_fingerprint', 256);
  const suiteDigest = exactDigest(workload.suite_digest, 'suite');
  const holdoutDigest = exactDigest(workload.holdout_digest, 'holdout');
  if (suiteDigest === holdoutDigest) throw new Error('rsi_tournament_holdout_must_be_separate');
  return Object.freeze({
    task_class: taskClass,
    environment_fingerprint: environmentFingerprint,
    suite_digest: suiteDigest,
    holdout_digest: holdoutDigest,
    dataset_visibility: 'HOLDOUT_TO_CANDIDATE',
    task_manifest_exposed_to_candidate: false,
    deterministic_evaluator_required: true,
    offline_replay_preferred: true,
  });
}

function normalizePairCount(value) {
  const count = value == null ? DEFAULT_PAIR_COUNT : Number(value);
  if (!Number.isSafeInteger(count) || count < MIN_PAIR_COUNT || count > MAX_PAIR_COUNT || count % 2 === 0) {
    throw new Error('rsi_tournament_pair_count_invalid');
  }
  return count;
}

function scheduleFrom(candidate, workload, pairCount) {
  const seedMaterial = digest({
    candidate_id: candidate.candidate_id,
    candidate_sha: candidate.candidate_sha,
    parent_sha: candidate.parent_sha,
    suite_digest: workload.suite_digest,
    holdout_digest: workload.holdout_digest,
    environment_fingerprint: workload.environment_fingerprint,
    pair_count: pairCount,
  }).slice('sha256:'.length);
  const firstCandidate = parseInt(seedMaterial.slice(0, 2), 16) % 2 === 1;
  const seeds = [];
  for (let index = 0; index < pairCount; index += 1) {
    const offset = (index * 8) % (seedMaterial.length - 8);
    seeds.push(parseInt(seedMaterial.slice(offset, offset + 8), 16) >>> 0);
  }
  return Object.freeze({
    order: Array.from({ length: pairCount }, (_, index) => ((index % 2 === 0) === firstCandidate ? 'CANDIDATE_FIRST' : 'INCUMBENT_FIRST')),
    seeds,
  });
}

export function createRsiShadowTournamentPlan({ candidate_handoff, evaluator_result, workload, pair_count = DEFAULT_PAIR_COUNT } = {}) {
  const candidate = normalizeHandoff(candidate_handoff);
  const evaluator = normalizeEvaluatorResult(evaluator_result, candidate);
  const normalizedWorkload = normalizeWorkload(workload);
  const pairCount = normalizePairCount(pair_count);
  const root = objectiveRoot();
  const schedule = scheduleFrom(candidate, normalizedWorkload, pairCount);
  const core = {
    schema: RSI_SHADOW_TOURNAMENT_PLAN_SCHEMA,
    version: 1,
    candidate,
    evaluator,
    objective_root: root,
    workload: normalizedWorkload,
    pair_policy: {
      pair_count: pairCount,
      same_holdout_workload_required: true,
      precommitted_seed_schedule: schedule.seeds,
      precommitted_order_schedule: schedule.order,
      exact_pair_count_required: true,
      early_stop_allowed: false,
      scalar_winner_allowed: false,
      pareto_relation_only: true,
    },
    evidence_policy: {
      external_evaluator_required: true,
      candidate_authored_receipt_allowed: false,
      exact_plan_binding_required: true,
      exact_root_binding_required: true,
      exact_candidate_binding_required: true,
      exact_holdout_binding_required: true,
      bounded_evidence_refs_required: true,
      trusted_ingest_must_verify_external_origin: true,
    },
    archive_policy: {
      preserve_distinct_behavioral_niches: true,
      preserve_non_dominated_frontier: true,
      allow_tradeoff_stepping_stones: true,
      scalar_archive_rank_allowed: false,
      promotion_authority: false,
    },
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  const planDigest = digest(core);
  return Object.freeze({ ...core, plan_id: `rsi_tournament_${planDigest.slice('sha256:'.length)}`, plan_digest: planDigest });
}

export function verifyRsiShadowTournamentPlan(plan) {
  if (!plainObject(plan) || plan.schema !== RSI_SHADOW_TOURNAMENT_PLAN_SCHEMA || plan.version !== 1) throw new Error('rsi_tournament_plan_invalid');
  zeroAuthority(plan, 'plan');
  const clone = structuredClone(plan);
  delete clone.plan_id;
  delete clone.plan_digest;
  const expected = digest(clone);
  if (plan.plan_digest !== expected || plan.plan_id !== `rsi_tournament_${expected.slice('sha256:'.length)}`) throw new Error('rsi_tournament_plan_digest_mismatch');
  const root = objectiveRoot();
  if (JSON.stringify(stable(plan.objective_root)) !== JSON.stringify(stable(root))) throw new Error('rsi_tournament_objective_root_tampered');
  const pairCount = normalizePairCount(plan.pair_policy?.pair_count);
  if (plan.pair_policy?.early_stop_allowed !== false || plan.pair_policy?.scalar_winner_allowed !== false || plan.pair_policy?.pareto_relation_only !== true) {
    throw new Error('rsi_tournament_pair_policy_invalid');
  }
  if (!plainObject(plan.candidate) || !/^candidate_sha256_[0-9a-f]{64}$/.test(String(plan.candidate.candidate_id || ''))) throw new Error('rsi_tournament_plan_candidate_invalid');
  exactSha(plan.candidate.candidate_sha, 'plan_candidate');
  exactSha(plan.candidate.parent_sha, 'plan_parent');
  exactDigest(plan.candidate.handoff_digest, 'plan_handoff');
  if (!RSI_MUTATION_SURFACES.includes(String(plan.candidate.mutation_surface || '').toUpperCase())) throw new Error('rsi_tournament_plan_mutation_surface_invalid');
  if (plan.workload?.dataset_visibility !== 'HOLDOUT_TO_CANDIDATE' || plan.workload?.task_manifest_exposed_to_candidate !== false) {
    throw new Error('rsi_tournament_holdout_policy_invalid');
  }
  exactDigest(plan.workload?.suite_digest, 'plan_suite');
  exactDigest(plan.workload?.holdout_digest, 'plan_holdout');
  if (plan.workload.suite_digest === plan.workload.holdout_digest) throw new Error('rsi_tournament_holdout_must_be_separate');
  if (!Array.isArray(plan.pair_policy.precommitted_seed_schedule) || plan.pair_policy.precommitted_seed_schedule.length !== pairCount) throw new Error('rsi_tournament_seed_schedule_invalid');
  if (!Array.isArray(plan.pair_policy.precommitted_order_schedule) || plan.pair_policy.precommitted_order_schedule.length !== pairCount) throw new Error('rsi_tournament_order_schedule_invalid');
  const canonicalSchedule = scheduleFrom(plan.candidate, plan.workload, pairCount);
  if (JSON.stringify(plan.pair_policy.precommitted_seed_schedule) !== JSON.stringify(canonicalSchedule.seeds)) throw new Error('rsi_tournament_seed_schedule_tampered');
  if (JSON.stringify(plan.pair_policy.precommitted_order_schedule) !== JSON.stringify(canonicalSchedule.order)) throw new Error('rsi_tournament_order_schedule_tampered');
  return Object.freeze({
    schema: 'metaengine.rsi.shadow-tournament-plan-verify.v1',
    ok: true,
    plan_id: plan.plan_id,
    plan_digest: plan.plan_digest,
    objective_root_digest: root.evaluator_root_digest,
    execution_authorized: false,
    promotion_authorized: false,
    authority_effect: false,
  });
}

function normalizeMetrics(value, root) {
  if (!plainObject(value)) throw new Error('rsi_tournament_metrics_invalid');
  const out = {};
  const allowed = new Set(root.objectives.map((entry) => entry.name));
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`rsi_tournament_metric_unknown:${key}`);
  }
  for (const entry of root.objectives) {
    const present = Object.hasOwn(value, entry.name);
    if (entry.required && !present) throw new Error(`rsi_tournament_metric_required:${entry.name}`);
    if (!present) continue;
    const number = Number(value[entry.name]);
    if (!Number.isFinite(number) || number < 0) throw new Error(`rsi_tournament_metric_invalid:${entry.name}`);
    if (entry.name === 'task_success_rate' && number > 1) throw new Error('rsi_tournament_task_success_rate_invalid');
    out[entry.name] = number;
  }
  return Object.freeze(out);
}

function normalizeInvariantResults(value) {
  if (!plainObject(value)) throw new Error('rsi_tournament_invariants_invalid');
  const out = {};
  for (const invariant of RSI_HARD_INVARIANTS) {
    const result = String(value[invariant] || '').toUpperCase();
    if (!['PASS', 'FAIL'].includes(result)) throw new Error(`rsi_tournament_invariant_result_invalid:${invariant}`);
    out[invariant] = result;
  }
  if (Object.keys(value).length !== RSI_HARD_INVARIANTS.length) throw new Error('rsi_tournament_invariant_shape_invalid');
  return Object.freeze(out);
}

function tournamentRunnerRoot(plan) {
  const spec = {
    runner: 'trusted/rsi-shadow-tournament-paired-v1',
    evaluator_root_digest: plan.objective_root.evaluator_root_digest,
    suite_digest: plan.workload.suite_digest,
    holdout_digest: plan.workload.holdout_digest,
    exact_pair_count: plan.pair_policy.pair_count,
    early_stop_allowed: false,
  };
  return Object.freeze({ ...spec, runner_digest: digest(spec) });
}

export function createRsiTournamentPairReceipt({
  plan,
  pair_index,
  order,
  seed,
  incumbent_metrics,
  candidate_metrics,
  hard_invariants,
  evidence_refs,
} = {}) {
  verifyRsiShadowTournamentPlan(plan);
  const pairIndex = Number(pair_index);
  if (!Number.isSafeInteger(pairIndex) || pairIndex < 1 || pairIndex > plan.pair_policy.pair_count) throw new Error('rsi_tournament_pair_index_invalid');
  const expectedOrder = plan.pair_policy.precommitted_order_schedule[pairIndex - 1];
  const expectedSeed = plan.pair_policy.precommitted_seed_schedule[pairIndex - 1];
  if (order !== expectedOrder) throw new Error('rsi_tournament_pair_order_mismatch');
  if (Number(seed) !== expectedSeed) throw new Error('rsi_tournament_pair_seed_mismatch');
  const root = tournamentRunnerRoot(plan);
  const core = {
    schema: RSI_SHADOW_TOURNAMENT_PAIR_RECEIPT_SCHEMA,
    version: 1,
    plan_id: plan.plan_id,
    plan_digest: plan.plan_digest,
    candidate_id: plan.candidate.candidate_id,
    candidate_sha: plan.candidate.candidate_sha,
    parent_sha: plan.candidate.parent_sha,
    evaluator_result_digest: plan.evaluator.result_digest,
    runner: root.runner,
    runner_digest: root.runner_digest,
    evaluator_root_digest: plan.objective_root.evaluator_root_digest,
    suite_digest: plan.workload.suite_digest,
    holdout_digest: plan.workload.holdout_digest,
    pair_index: pairIndex,
    order: expectedOrder,
    seed: expectedSeed,
    incumbent_metrics: normalizeMetrics(incumbent_metrics, plan.objective_root),
    candidate_metrics: normalizeMetrics(candidate_metrics, plan.objective_root),
    hard_invariants: normalizeInvariantResults(hard_invariants),
    evidence_refs: normalizeEvidenceRefs(evidence_refs),
    external_evaluator: true,
    authored_by_candidate: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, receipt_digest: digest(core) });
}

export function verifyRsiTournamentPairReceipt({ plan, receipt } = {}) {
  verifyRsiShadowTournamentPlan(plan);
  if (!plainObject(receipt) || receipt.schema !== RSI_SHADOW_TOURNAMENT_PAIR_RECEIPT_SCHEMA || receipt.version !== 1) {
    throw new Error('rsi_tournament_receipt_invalid');
  }
  zeroAuthority(receipt, 'receipt');
  if (receipt.external_evaluator !== true || receipt.authored_by_candidate !== false) throw new Error('rsi_tournament_receipt_origin_invalid');
  if (receipt.plan_id !== plan.plan_id || receipt.plan_digest !== plan.plan_digest) throw new Error('rsi_tournament_receipt_plan_mismatch');
  if (
    String(receipt.candidate_id || '').toLowerCase() !== plan.candidate.candidate_id
    || exactSha(receipt.candidate_sha, 'receipt_candidate') !== plan.candidate.candidate_sha
    || exactSha(receipt.parent_sha, 'receipt_parent') !== plan.candidate.parent_sha
    || exactDigest(receipt.evaluator_result_digest, 'receipt_evaluator_result') !== plan.evaluator.result_digest
  ) throw new Error('rsi_tournament_receipt_candidate_mismatch');
  const pairIndex = Number(receipt.pair_index);
  if (!Number.isSafeInteger(pairIndex) || pairIndex < 1 || pairIndex > plan.pair_policy.pair_count) throw new Error('rsi_tournament_pair_index_invalid');
  if (receipt.order !== plan.pair_policy.precommitted_order_schedule[pairIndex - 1]) throw new Error('rsi_tournament_pair_order_mismatch');
  if (Number(receipt.seed) !== plan.pair_policy.precommitted_seed_schedule[pairIndex - 1]) throw new Error('rsi_tournament_pair_seed_mismatch');
  if (receipt.suite_digest !== plan.workload.suite_digest || receipt.holdout_digest !== plan.workload.holdout_digest) throw new Error('rsi_tournament_receipt_workload_mismatch');
  const runner = tournamentRunnerRoot(plan);
  if (receipt.runner !== runner.runner || receipt.runner_digest !== runner.runner_digest || receipt.evaluator_root_digest !== runner.evaluator_root_digest) {
    throw new Error('rsi_tournament_receipt_runner_mismatch');
  }
  const normalizedIncumbent = normalizeMetrics(receipt.incumbent_metrics, plan.objective_root);
  const normalizedCandidate = normalizeMetrics(receipt.candidate_metrics, plan.objective_root);
  const normalizedInvariants = normalizeInvariantResults(receipt.hard_invariants);
  const normalizedRefs = normalizeEvidenceRefs(receipt.evidence_refs);
  const core = {
    schema: RSI_SHADOW_TOURNAMENT_PAIR_RECEIPT_SCHEMA,
    version: 1,
    plan_id: plan.plan_id,
    plan_digest: plan.plan_digest,
    candidate_id: plan.candidate.candidate_id,
    candidate_sha: plan.candidate.candidate_sha,
    parent_sha: plan.candidate.parent_sha,
    evaluator_result_digest: plan.evaluator.result_digest,
    runner: runner.runner,
    runner_digest: runner.runner_digest,
    evaluator_root_digest: runner.evaluator_root_digest,
    suite_digest: plan.workload.suite_digest,
    holdout_digest: plan.workload.holdout_digest,
    pair_index: pairIndex,
    order: receipt.order,
    seed: Number(receipt.seed),
    incumbent_metrics: normalizedIncumbent,
    candidate_metrics: normalizedCandidate,
    hard_invariants: normalizedInvariants,
    evidence_refs: normalizedRefs,
    external_evaluator: true,
    authored_by_candidate: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  const receiptDigest = digest(core);
  if (receipt.receipt_digest !== receiptDigest) throw new Error('rsi_tournament_receipt_digest_mismatch');
  return Object.freeze({ ...core, receipt_digest: receiptDigest });
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function directionalDelta(direction, baseline, candidate) {
  return direction === 'MAXIMIZE' ? candidate - baseline : baseline - candidate;
}

function normalizedMateriality(objective, baselineMedian, candidateMedian) {
  const delta = directionalDelta(objective.direction, baselineMedian, candidateMedian);
  const spec = objective.materiality;
  if (spec.mode === 'ABSOLUTE') return delta;
  return delta / Math.max(Math.abs(baselineMedian), 1e-9);
}

function classifyObjective(objective, receipts) {
  const incumbent = receipts.map((entry) => entry.incumbent_metrics[objective.name]).filter((value) => value != null);
  const candidate = receipts.map((entry) => entry.candidate_metrics[objective.name]).filter((value) => value != null);
  if (incumbent.length !== receipts.length || candidate.length !== receipts.length) {
    if (objective.required) throw new Error(`rsi_tournament_required_metric_missing:${objective.name}`);
    return null;
  }
  const baselineMedian = median(incumbent);
  const candidateMedian = median(candidate);
  const materiality = normalizedMateriality(objective, baselineMedian, candidateMedian);
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (let index = 0; index < receipts.length; index += 1) {
    const delta = directionalDelta(objective.direction, incumbent[index], candidate[index]);
    if (delta > 0) wins += 1;
    else if (delta < 0) losses += 1;
    else ties += 1;
  }
  let status = 'UNCHANGED';
  if (materiality >= objective.materiality.threshold && wins > losses) status = 'IMPROVED';
  else if (materiality <= -objective.materiality.threshold && losses > wins) status = 'REGRESSED';
  return Object.freeze({
    name: objective.name,
    direction: objective.direction,
    baseline_median: baselineMedian,
    candidate_median: candidateMedian,
    materiality,
    materiality_mode: objective.materiality.mode,
    materiality_threshold: objective.materiality.threshold,
    wins,
    losses,
    ties,
    status,
  });
}

function verifyResultDigest(result) {
  const clone = structuredClone(result);
  delete clone.result_digest;
  return digest(clone);
}

export function evaluateRsiShadowTournament({ plan, receipts } = {}) {
  verifyRsiShadowTournamentPlan(plan);
  if (!Array.isArray(receipts) || receipts.length !== plan.pair_policy.pair_count) throw new Error('rsi_tournament_exact_pair_count_required');
  const verified = receipts.map((receipt) => verifyRsiTournamentPairReceipt({ plan, receipt })).sort((a, b) => a.pair_index - b.pair_index);
  const seen = new Set();
  for (let index = 0; index < verified.length; index += 1) {
    const receipt = verified[index];
    if (seen.has(receipt.pair_index)) throw new Error('rsi_tournament_duplicate_pair');
    seen.add(receipt.pair_index);
    if (receipt.pair_index !== index + 1) throw new Error('rsi_tournament_pair_sequence_gap');
  }

  const hardFailures = [];
  for (const invariant of RSI_HARD_INVARIANTS) {
    const failedPairs = verified.filter((entry) => entry.hard_invariants[invariant] !== 'PASS').map((entry) => entry.pair_index);
    if (failedPairs.length) hardFailures.push(Object.freeze({ invariant, failed_pairs: failedPairs }));
  }

  const objectiveComparisons = plan.objective_root.objectives
    .map((objective) => classifyObjective(objective, verified))
    .filter(Boolean);
  const improved = objectiveComparisons.filter((entry) => entry.status === 'IMPROVED').map((entry) => entry.name);
  const regressed = objectiveComparisons.filter((entry) => entry.status === 'REGRESSED').map((entry) => entry.name);

  let relation = 'NO_MEASURED_ADVANCE';
  let archiveEligible = false;
  if (hardFailures.length) relation = 'REJECTED_HARD_INVARIANT';
  else if (improved.length > 0 && regressed.length === 0) {
    relation = 'PARETO_ADVANCE';
    archiveEligible = true;
  } else if (improved.length > 0 && regressed.length > 0) {
    relation = 'TRADEOFF_STEPPING_STONE';
    archiveEligible = true;
  }

  const behaviorCore = {
    task_class: plan.workload.task_class,
    mutation_surface: plan.candidate.mutation_surface,
    statuses: objectiveComparisons.map((entry) => `${entry.name}:${entry.status}`).sort(),
  };
  const behaviorSignature = digest(behaviorCore);
  const resultCore = {
    schema: RSI_SHADOW_TOURNAMENT_RESULT_SCHEMA,
    version: 1,
    plan_id: plan.plan_id,
    plan_digest: plan.plan_digest,
    candidate: plan.candidate,
    workload: plan.workload,
    pair_count: verified.length,
    receipt_digests: verified.map((entry) => entry.receipt_digest),
    hard_failures: hardFailures,
    objectives: objectiveComparisons,
    relation,
    behavior_signature: behaviorSignature,
    archive_eligible: archiveEligible,
    scalar_winner: null,
    eligible_for_promotion: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...resultCore, result_digest: digest(resultCore) });
}

export function verifyRsiShadowTournamentResult({ plan, result } = {}) {
  verifyRsiShadowTournamentPlan(plan);
  if (!plainObject(result) || result.schema !== RSI_SHADOW_TOURNAMENT_RESULT_SCHEMA || result.version !== 1) throw new Error('rsi_tournament_result_invalid');
  zeroAuthority(result, 'result');
  if (result.eligible_for_promotion !== false || result.scalar_winner !== null) throw new Error('rsi_tournament_result_authority_invalid');
  if (result.plan_id !== plan.plan_id || result.plan_digest !== plan.plan_digest) throw new Error('rsi_tournament_result_plan_mismatch');
  if (result.candidate?.candidate_id !== plan.candidate.candidate_id || result.candidate?.candidate_sha !== plan.candidate.candidate_sha) {
    throw new Error('rsi_tournament_result_candidate_mismatch');
  }
  if (exactDigest(result.result_digest, 'result') !== verifyResultDigest(result)) throw new Error('rsi_tournament_result_digest_mismatch');
  if (!['PARETO_ADVANCE', 'TRADEOFF_STEPPING_STONE', 'NO_MEASURED_ADVANCE', 'REJECTED_HARD_INVARIANT'].includes(result.relation)) {
    throw new Error('rsi_tournament_result_relation_invalid');
  }
  return result;
}

function resultMetricMap(result) {
  return new Map(result.objectives.map((entry) => [entry.name, entry]));
}

function paretoDominates(left, right) {
  const l = resultMetricMap(left);
  const r = resultMetricMap(right);
  let strictlyBetter = false;
  for (const [name, rightMetric] of r.entries()) {
    const leftMetric = l.get(name);
    if (!leftMetric || leftMetric.direction !== rightMetric.direction) return false;
    if (rightMetric.direction === 'MAXIMIZE') {
      if (leftMetric.candidate_median < rightMetric.candidate_median) return false;
      if (leftMetric.candidate_median > rightMetric.candidate_median) strictlyBetter = true;
    } else {
      if (leftMetric.candidate_median > rightMetric.candidate_median) return false;
      if (leftMetric.candidate_median < rightMetric.candidate_median) strictlyBetter = true;
    }
  }
  return strictlyBetter;
}

export class RsiEvolutionArchive {
  constructor({ maxEntries = DEFAULT_MAX_ARCHIVE_ENTRIES, maxNicheEntries = DEFAULT_MAX_NICHE_ENTRIES } = {}) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 4096) throw new Error('rsi_archive_max_entries_invalid');
    if (!Number.isSafeInteger(maxNicheEntries) || maxNicheEntries < 1 || maxNicheEntries > 64) throw new Error('rsi_archive_max_niche_entries_invalid');
    this.maxEntries = maxEntries;
    this.maxNicheEntries = maxNicheEntries;
    this.rows = new Map();
  }

  admit({ plan, result } = {}) {
    verifyRsiShadowTournamentResult({ plan, result });
    const candidateId = result.candidate.candidate_id;
    if (this.rows.has(candidateId)) throw new Error('rsi_archive_candidate_duplicate');
    if (this.rows.size >= this.maxEntries) throw new Error('rsi_archive_capacity_blocked');

    const comparable = [...this.rows.values()].filter((entry) =>
      entry.active === true
      && entry.result.workload.task_class === result.workload.task_class
      && entry.result.workload.holdout_digest === result.workload.holdout_digest
      && entry.result.workload.environment_fingerprint === result.workload.environment_fingerprint
    );
    const sameNiche = comparable.filter((entry) => entry.result.behavior_signature === result.behavior_signature);
    if (sameNiche.filter((entry) => entry.active).length >= this.maxNicheEntries && !sameNiche.some((entry) => paretoDominates(result, entry.result))) {
      throw new Error('rsi_archive_niche_capacity_blocked');
    }

    let state = 'NOT_ADMITTED';
    let active = false;
    if (result.archive_eligible) {
      const sameNicheDominated = sameNiche.some((entry) => paretoDominates(entry.result, result));
      const globallyDominated = comparable.some((entry) => paretoDominates(entry.result, result));
      if (sameNicheDominated) {
        state = 'DOMINATED';
      } else if (globallyDominated) {
        state = 'STEPPING_STONE';
        active = true;
      } else {
        state = 'PARETO_ELITE';
        active = true;
      }
    }

    if (active) {
      for (const entry of sameNiche) {
        if (entry.active && paretoDominates(result, entry.result)) {
          entry.state = 'DOMINATED';
          entry.active = false;
        }
      }
      for (const entry of comparable) {
        if (entry.active && entry.result.behavior_signature !== result.behavior_signature && paretoDominates(result, entry.result) && entry.state === 'PARETO_ELITE') {
          entry.state = 'STEPPING_STONE';
        }
      }
    }

    const rowCore = {
      candidate_id: candidateId,
      candidate_sha: result.candidate.candidate_sha,
      parent_sha: result.candidate.parent_sha,
      mutation_surface: result.candidate.mutation_surface,
      result_digest: result.result_digest,
      behavior_signature: result.behavior_signature,
      state,
      active,
      relation: result.relation,
      scalar_score: null,
      promotion_authority: false,
      self_update_authority: false,
      execution_authority: false,
      authority_effect: false,
    };
    const row = { ...rowCore, row_digest: digest(rowCore), result };
    this.rows.set(candidateId, row);
    return Object.freeze(structuredClone(row));
  }

  get(candidateId) {
    const row = this.rows.get(String(candidateId || '').toLowerCase());
    if (!row) throw new Error('rsi_archive_candidate_missing');
    return Object.freeze(structuredClone(row));
  }

  snapshot() {
    const entries = [...this.rows.values()].map((row) => ({
      candidate_id: row.candidate_id,
      candidate_sha: row.candidate_sha,
      parent_sha: row.parent_sha,
      mutation_surface: row.mutation_surface,
      result_digest: row.result_digest,
      behavior_signature: row.behavior_signature,
      state: row.state,
      active: row.active,
      relation: row.relation,
      scalar_score: null,
      row_digest: row.row_digest,
    })).sort((a, b) => a.candidate_id.localeCompare(b.candidate_id));
    const core = {
      schema: RSI_EVOLUTION_ARCHIVE_SNAPSHOT_SCHEMA,
      version: 1,
      entries,
      active_frontier: entries.filter((entry) => entry.active).map((entry) => entry.candidate_id),
      scalar_ranking_authoritative: false,
      promotion_authority: false,
      self_update_authority: false,
      execution_authority: false,
      authority_effect: false,
    };
    return Object.freeze({ ...core, snapshot_digest: digest(core) });
  }
}

export function rsiTournamentTrustRootSnapshot() {
  const root = {
    immutable_component_paths: [...TOURNAMENT_TRUST_ROOT_PATHS].sort(),
    objective_root: objectiveRoot(),
    required_hard_invariants: [...RSI_HARD_INVARIANTS].sort(),
    required_objectives: [...REQUIRED_OBJECTIVES],
    optional_objectives: [...OPTIONAL_OBJECTIVES],
    pair_count_bounds: { min: MIN_PAIR_COUNT, max: MAX_PAIR_COUNT, default: DEFAULT_PAIR_COUNT, odd_only: true },
    scalar_reward_authoritative: false,
    candidate_selectable: false,
    candidate_mutable: false,
  };
  return Object.freeze({ ...root, tournament_root_digest: digest(root) });
}
