import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  RSI_EVOLUTION_ARCHIVE_SNAPSHOT_SCHEMA,
  RsiEvolutionArchive,
  createRsiShadowTournamentPlan,
  createRsiTournamentPairReceipt,
  evaluateRsiShadowTournament,
  rsiTournamentTrustRootSnapshot,
  verifyRsiShadowTournamentPlan,
  verifyRsiShadowTournamentResult,
  verifyRsiTournamentPairReceipt,
} from '../src/rsi-shadow-tournament.mjs';
import { RSI_EVALUATOR_MESH_RESULT_SCHEMA } from '../src/rsi-evaluator-mesh.mjs';
import { RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA } from '../src/rsi-isolated-candidate-builder.mjs';

const PARENT = 'a'.repeat(40);
const CANDIDATE = 'b'.repeat(40);
const CANDIDATE_ID = `candidate_sha256_${'c'.repeat(64)}`;
const HANDOFF_DIGEST = `sha256:${'d'.repeat(64)}`;
const SUITE_DIGEST = `sha256:${'e'.repeat(64)}`;
const HOLDOUT_DIGEST = `sha256:${'f'.repeat(64)}`;

const HARD_INVARIANTS = [
  'NO_DUPLICATE_IRREVERSIBLE_EFFECT',
  'NO_AUTHORITY_VIOLATION',
  'NO_WORKSPACE_ESCAPE',
  'EXACT_SOURCE_IDENTITY',
  'NO_SECURITY_REGRESSION',
  'NO_AMBIGUOUS_EFFECT_RETRY',
];

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}

function hardPass(overrides = {}) {
  return Object.fromEntries(HARD_INVARIANTS.map((name) => [name, overrides[name] || 'PASS']));
}

function handoff({
  parent = PARENT,
  candidate = CANDIDATE,
  candidateId = CANDIDATE_ID,
  mutationSurface = 'AGENT_ORCHESTRATION',
  components = [{ path: 'apps/metaengine-browser/src/browser-brain-routing-v2.mjs', change: 'MODIFY', digest: `sha256:${'1'.repeat(64)}` }],
} = {}) {
  return {
    schema: RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA,
    version: 1,
    experiment_id: 'rsi_exp_0123456789abcdef01234567',
    mutation_surface: mutationSurface,
    parent_sha: parent,
    candidate_sha: candidate,
    target_branch: 'work/rsi/reliability-aaaaaaaa-01234567',
    handoff_digest: HANDOFF_DIGEST,
    candidate_capsule: {
      candidate_id: candidateId,
      source: { head: candidate },
      components,
    },
    candidate_verification: { ok: true, executable: false, promotion_authorized: false },
    sandbox_plan: { mode: 'PREPARE_ONLY' },
    sandbox_plan_verification: { execution_authorized: false },
    shadow_archive_proposal: {
      candidate_id: candidateId,
      parent_sha: parent,
      candidate_sha: candidate,
      mutation_surface: mutationSurface,
      hypothesis: 'Improve runtime while preserving authority boundaries.',
    },
    eligible_for_evaluation: true,
    eligible_for_promotion: false,
    materialization_replay_authorized: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

function evaluatorResult({ candidate = CANDIDATE, candidateId = CANDIDATE_ID } = {}) {
  const core = {
    schema: RSI_EVALUATOR_MESH_RESULT_SCHEMA,
    version: 1,
    plan_id: `rsi_eval_${'2'.repeat(64)}`,
    candidate_id: candidateId,
    candidate_sha: candidate,
    state: 'SHADOW_QUALIFIED',
    final_digest: '3'.repeat(64),
    receipt_digests: Array.from({ length: 7 }, (_, index) => `sha256:${String(index + 4).repeat(64).slice(0, 64)}`),
    hard_invariants: hardPass(),
    objectives: [
      { name: 'p95_latency_ms', baseline: 120, candidate: 90, direction: 'MINIMIZE', improved: true },
    ],
    eligible_for_promotion: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return { ...core, result_digest: digest(core) };
}

function workload(overrides = {}) {
  return {
    task_class: 'browser-autonomous-soak',
    environment_fingerprint: 'windows-2025-node24-electron44',
    suite_digest: SUITE_DIGEST,
    holdout_digest: HOLDOUT_DIGEST,
    ...overrides,
  };
}

function plan(extra = {}) {
  return createRsiShadowTournamentPlan({
    candidate_handoff: handoff(),
    evaluator_result: evaluatorResult(),
    workload: workload(),
    pair_count: 5,
    ...extra,
  });
}

function metrics({
  task_success_rate = 1,
  p95_latency_ms = 100,
  peak_rss_bytes = 1000,
  recovery_p95_ms = 50,
  tokens_per_success,
} = {}) {
  const out = { task_success_rate, p95_latency_ms, peak_rss_bytes, recovery_p95_ms };
  if (tokens_per_success != null) out.tokens_per_success = tokens_per_success;
  return out;
}

function receiptsFor(
  tournamentPlan,
  {
    incumbent = metrics(),
    candidate = metrics({ p95_latency_ms: 80 }),
    invariantOverridesByPair = {},
  } = {},
) {
  return Array.from({ length: tournamentPlan.pair_policy.pair_count }, (_, index) => {
    const pairIndex = index + 1;
    return createRsiTournamentPairReceipt({
      plan: tournamentPlan,
      pair_index: pairIndex,
      order: tournamentPlan.pair_policy.precommitted_order_schedule[index],
      seed: tournamentPlan.pair_policy.precommitted_seed_schedule[index],
      incumbent_metrics: typeof incumbent === 'function' ? incumbent(pairIndex) : incumbent,
      candidate_metrics: typeof candidate === 'function' ? candidate(pairIndex) : candidate,
      hard_invariants: hardPass(invariantOverridesByPair[pairIndex] || {}),
      evidence_refs: [`github:run:${9000 + pairIndex}`, `artifact:pair:${pairIndex}`],
    });
  });
}

test('tournament plan is deterministic, holdout-bound, precommitted and zero-authority', () => {
  const first = plan();
  const second = plan();
  assert.deepEqual(first, second);
  assert.equal(first.workload.dataset_visibility, 'HOLDOUT_TO_CANDIDATE');
  assert.equal(first.workload.task_manifest_exposed_to_candidate, false);
  assert.equal(first.pair_policy.pair_count, 5);
  assert.equal(first.pair_policy.early_stop_allowed, false);
  assert.equal(first.pair_policy.scalar_winner_allowed, false);
  assert.equal(first.pair_policy.pareto_relation_only, true);
  assert.equal(new Set(first.pair_policy.precommitted_seed_schedule).size > 1, true);
  assert.equal(first.pair_policy.precommitted_order_schedule.filter((entry) => entry === 'CANDIDATE_FIRST').length >= 2, true);
  assert.equal(first.pair_policy.precommitted_order_schedule.filter((entry) => entry === 'INCUMBENT_FIRST').length >= 2, true);
  assert.equal(first.archive_policy.scalar_archive_rank_allowed, false);
  assert.equal(first.execution_authority, false);
  assert.equal(first.promotion_authority, false);
  assert.equal(first.self_update_authority, false);
  assert.equal(first.automatic_retry_allowed, false);
  assert.equal(verifyRsiShadowTournamentPlan(first).ok, true);
});

test('plan refuses benchmark leakage, even pair counts and candidate mutation of tournament trust root', () => {
  assert.throws(
    () => plan({ workload: workload({ holdout_digest: SUITE_DIGEST }) }),
    /holdout_must_be_separate/,
  );
  assert.throws(() => plan({ pair_count: 4 }), /pair_count_invalid/);
  assert.throws(
    () => plan({
      candidate_handoff: handoff({
        components: [{ path: 'apps/metaengine-browser/src/rsi-shadow-tournament.mjs', change: 'MODIFY', digest: `sha256:${'4'.repeat(64)}` }],
      }),
    }),
    /candidate_mutates_tournament_root/,
  );
});

test('pair receipt is exact-bound to precommitted seed/order, holdout and runner root', () => {
  const tournamentPlan = plan();
  const [receipt] = receiptsFor(tournamentPlan);
  assert.equal(verifyRsiTournamentPairReceipt({ plan: tournamentPlan, receipt }).pair_index, 1);

  const mutations = [
    (copy) => { copy.seed += 1; },
    (copy) => { copy.order = copy.order === 'CANDIDATE_FIRST' ? 'INCUMBENT_FIRST' : 'CANDIDATE_FIRST'; },
    (copy) => { copy.holdout_digest = `sha256:${'9'.repeat(64)}`; },
    (copy) => { copy.runner = 'candidate/controlled-runner'; },
    (copy) => { copy.authored_by_candidate = true; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(receipt);
    mutate(copy);
    assert.throws(() => verifyRsiTournamentPairReceipt({ plan: tournamentPlan, receipt: copy }), /rsi_tournament_/);
  }
});

test('tournament requires the exact precommitted pair count and forbids optional stopping', () => {
  const tournamentPlan = plan();
  const all = receiptsFor(tournamentPlan);
  assert.throws(() => evaluateRsiShadowTournament({ plan: tournamentPlan, receipts: all.slice(0, 3) }), /exact_pair_count_required/);
  assert.equal(evaluateRsiShadowTournament({ plan: tournamentPlan, receipts: all }).pair_count, 5);
});

test('material improvement with no measured regression yields Pareto advance without scalar winner', () => {
  const tournamentPlan = plan();
  const result = evaluateRsiShadowTournament({
    plan: tournamentPlan,
    receipts: receiptsFor(tournamentPlan, {
      incumbent: (pair) => metrics({ p95_latency_ms: 100 + pair, peak_rss_bytes: 1000 + pair }),
      candidate: (pair) => metrics({ p95_latency_ms: 78 + pair, peak_rss_bytes: 1000 + pair }),
    }),
  });
  assert.equal(result.relation, 'PARETO_ADVANCE');
  assert.equal(result.archive_eligible, true);
  assert.equal(result.scalar_winner, null);
  assert.equal(result.eligible_for_promotion, false);
  assert.equal(result.promotion_authority, false);
  assert.equal(result.self_update_authority, false);
  assert.equal(result.objectives.find((entry) => entry.name === 'p95_latency_ms').status, 'IMPROVED');
  assert.equal(result.objectives.find((entry) => entry.name === 'peak_rss_bytes').status, 'UNCHANGED');
  assert.equal(verifyRsiShadowTournamentResult({ plan: tournamentPlan, result }).relation, 'PARETO_ADVANCE');
});

test('tradeoff is preserved as a stepping-stone relation rather than collapsed into one score', () => {
  const tournamentPlan = plan();
  const result = evaluateRsiShadowTournament({
    plan: tournamentPlan,
    receipts: receiptsFor(tournamentPlan, {
      incumbent: metrics({ p95_latency_ms: 100, peak_rss_bytes: 1000 }),
      candidate: metrics({ p95_latency_ms: 75, peak_rss_bytes: 1250 }),
    }),
  });
  assert.equal(result.relation, 'TRADEOFF_STEPPING_STONE');
  assert.equal(result.archive_eligible, true);
  assert.equal(result.scalar_winner, null);
  assert.deepEqual(
    result.objectives.filter((entry) => entry.status !== 'UNCHANGED').map((entry) => [entry.name, entry.status]).sort(),
    [['p95_latency_ms', 'IMPROVED'], ['peak_rss_bytes', 'REGRESSED']].sort(),
  );
});

test('any hard invariant failure rejects tournament result regardless of performance gain', () => {
  const tournamentPlan = plan();
  const result = evaluateRsiShadowTournament({
    plan: tournamentPlan,
    receipts: receiptsFor(tournamentPlan, {
      candidate: metrics({ task_success_rate: 1, p95_latency_ms: 1, peak_rss_bytes: 1, recovery_p95_ms: 1 }),
      invariantOverridesByPair: { 3: { NO_AMBIGUOUS_EFFECT_RETRY: 'FAIL' } },
    }),
  });
  assert.equal(result.relation, 'REJECTED_HARD_INVARIANT');
  assert.equal(result.archive_eligible, false);
  assert.equal(result.hard_failures[0].failed_pairs.includes(3), true);
  assert.equal(result.eligible_for_promotion, false);
});

test('evolution archive preserves distinct behavioral niches as stepping stones and rejects same-niche domination', () => {
  const archive = new RsiEvolutionArchive();

  const elitePlan = plan();
  const eliteResult = evaluateRsiShadowTournament({
    plan: elitePlan,
    receipts: receiptsFor(elitePlan, {
      incumbent: metrics({ p95_latency_ms: 100, peak_rss_bytes: 1000 }),
      candidate: metrics({ p95_latency_ms: 70, peak_rss_bytes: 900 }),
    }),
  });
  const elite = archive.admit({ plan: elitePlan, result: eliteResult });
  assert.equal(elite.state, 'PARETO_ELITE');
  assert.equal(elite.active, true);

  const secondCandidateId = `candidate_sha256_${'5'.repeat(64)}`;
  const secondCandidateSha = '6'.repeat(40);
  const tradeoffPlan = createRsiShadowTournamentPlan({
    candidate_handoff: handoff({
      candidate: secondCandidateSha,
      candidateId: secondCandidateId,
      mutationSurface: 'BROWSER_RUNTIME',
    }),
    evaluator_result: evaluatorResult({ candidate: secondCandidateSha, candidateId: secondCandidateId }),
    workload: workload(),
    pair_count: 5,
  });
  const tradeoffResult = evaluateRsiShadowTournament({
    plan: tradeoffPlan,
    receipts: receiptsFor(tradeoffPlan, {
      incumbent: metrics({ p95_latency_ms: 100, peak_rss_bytes: 1000 }),
      candidate: metrics({ p95_latency_ms: 80, peak_rss_bytes: 1300 }),
    }),
  });
  const stepping = archive.admit({ plan: tradeoffPlan, result: tradeoffResult });
  assert.equal(stepping.state, 'STEPPING_STONE');
  assert.equal(stepping.active, true);

  const dominatedCandidateId = `candidate_sha256_${'7'.repeat(64)}`;
  const dominatedCandidateSha = '8'.repeat(40);
  const dominatedPlan = createRsiShadowTournamentPlan({
    candidate_handoff: handoff({
      candidate: dominatedCandidateSha,
      candidateId: dominatedCandidateId,
      mutationSurface: 'AGENT_ORCHESTRATION',
    }),
    evaluator_result: evaluatorResult({ candidate: dominatedCandidateSha, candidateId: dominatedCandidateId }),
    workload: workload(),
    pair_count: 5,
  });
  const dominatedResult = evaluateRsiShadowTournament({
    plan: dominatedPlan,
    receipts: receiptsFor(dominatedPlan, {
      incumbent: metrics({ p95_latency_ms: 100, peak_rss_bytes: 1000 }),
      candidate: metrics({ p95_latency_ms: 80, peak_rss_bytes: 940 }),
    }),
  });
  const dominated = archive.admit({ plan: dominatedPlan, result: dominatedResult });
  assert.equal(dominated.state, 'DOMINATED');
  assert.equal(dominated.active, false);

  const snapshot = archive.snapshot();
  assert.equal(snapshot.schema, RSI_EVOLUTION_ARCHIVE_SNAPSHOT_SCHEMA);
  assert.equal(snapshot.scalar_ranking_authoritative, false);
  assert.equal(snapshot.promotion_authority, false);
  assert.equal(snapshot.active_frontier.includes(elite.candidate_id), true);
  assert.equal(snapshot.active_frontier.includes(stepping.candidate_id), true);
  assert.equal(snapshot.active_frontier.includes(dominated.candidate_id), false);
  assert.match(snapshot.snapshot_digest, /^sha256:[0-9a-f]{64}$/);
});

test('tournament trust root exposes fixed evaluator linkage and no candidate choice', () => {
  const root = rsiTournamentTrustRootSnapshot();
  assert.match(root.tournament_root_digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(root.scalar_reward_authoritative, false);
  assert.equal(root.candidate_selectable, false);
  assert.equal(root.candidate_mutable, false);
  assert.equal(root.required_objectives.includes('task_success_rate'), true);
  assert.equal(root.required_objectives.includes('p95_latency_ms'), true);
  assert.equal(root.immutable_component_paths.includes('apps/metaengine-browser/src/rsi-shadow-tournament.mjs'), true);
});
