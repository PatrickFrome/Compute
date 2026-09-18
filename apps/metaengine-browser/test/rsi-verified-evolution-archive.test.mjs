import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { RSI_HARD_INVARIANTS, RSI_SHADOW_STATES } from '../src/rsi-shadow-core.mjs';
import { RSI_EVALUATOR_MESH_RESULT_SCHEMA } from '../src/rsi-evaluator-mesh.mjs';
import { RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA } from '../src/rsi-isolated-candidate-builder.mjs';
import {
  createRsiShadowTournamentPlan,
  createRsiTournamentPairReceipt,
  evaluateRsiShadowTournament,
  verifyRsiShadowTournamentResult,
} from '../src/rsi-shadow-tournament.mjs';
import {
  RsiVerifiedEvolutionArchive,
  RSI_VERIFIED_EVOLUTION_ARCHIVE_ADMISSION_SCHEMA,
  RSI_VERIFIED_EVOLUTION_ARCHIVE_SNAPSHOT_SCHEMA,
} from '../src/rsi-verified-evolution-archive.mjs';

const PARENT = 'a'.repeat(40);
const CANDIDATE = 'b'.repeat(40);
const CANDIDATE_ID = `candidate_sha256_${'c'.repeat(64)}`;
const HANDOFF_DIGEST = `sha256:${'d'.repeat(64)}`;
const SUITE_DIGEST = `sha256:${'e'.repeat(64)}`;
const HOLDOUT_DIGEST = `sha256:${'f'.repeat(64)}`;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}

function handoff() {
  return {
    schema: RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA,
    version: 1,
    experiment_id: 'rsi_exp_0123456789abcdef01234567',
    mutation_surface: 'AGENT_ORCHESTRATION',
    parent_sha: PARENT,
    candidate_sha: CANDIDATE,
    target_branch: 'work/rsi/reliability-aaaaaaaa-01234567',
    handoff_digest: HANDOFF_DIGEST,
    candidate_capsule: {
      candidate_id: CANDIDATE_ID,
      source: { head: CANDIDATE },
      components: [{ path: 'apps/metaengine-browser/src/browser-brain-routing-v2.mjs' }],
    },
    shadow_archive_proposal: {
      candidate_id: CANDIDATE_ID,
      parent_sha: PARENT,
      candidate_sha: CANDIDATE,
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

function evaluatorResult() {
  const hardInvariants = Object.fromEntries(RSI_HARD_INVARIANTS.map((name) => [name, 'PASS']));
  const core = {
    schema: RSI_EVALUATOR_MESH_RESULT_SCHEMA,
    version: 1,
    plan_id: 'rsi_eval_0123456789abcdef',
    candidate_id: CANDIDATE_ID,
    candidate_sha: CANDIDATE,
    state: RSI_SHADOW_STATES.SHADOW_QUALIFIED,
    final_digest: '1'.repeat(64),
    receipt_digests: Array.from({ length: RSI_HARD_INVARIANTS.length + 1 }, (_, index) => `sha256:${String(index + 2).repeat(64).slice(0, 64)}`),
    hard_invariants: hardInvariants,
    objectives: [{ name: 'p95_latency_ms', baseline: 100, candidate: 90 }],
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

function plan() {
  return createRsiShadowTournamentPlan({
    candidate_handoff: handoff(),
    evaluator_result: evaluatorResult(),
    workload: {
      task_class: 'browser-routing-shadow',
      environment_fingerprint: 'windows-2025-node24-browsercell-v1',
      suite_digest: SUITE_DIGEST,
      holdout_digest: HOLDOUT_DIGEST,
    },
    pair_count: 5,
  });
}

function allPass() {
  return Object.fromEntries(RSI_HARD_INVARIANTS.map((name) => [name, 'PASS']));
}

function receiptsFor(tournamentPlan) {
  return Array.from({ length: tournamentPlan.pair_policy.pair_count }, (_, index) => {
    const pairIndex = index + 1;
    return createRsiTournamentPairReceipt({
      plan: tournamentPlan,
      pair_index: pairIndex,
      order: tournamentPlan.pair_policy.precommitted_order_schedule[index],
      seed: tournamentPlan.pair_policy.precommitted_seed_schedule[index],
      incumbent_metrics: {
        task_success_rate: 0.90,
        p95_latency_ms: 100 + index,
        peak_rss_bytes: 1000 + index,
        recovery_p95_ms: 50 + index,
      },
      candidate_metrics: {
        task_success_rate: 0.93,
        p95_latency_ms: 88 + index,
        peak_rss_bytes: 880 + index,
        recovery_p95_ms: 44 + index,
      },
      hard_invariants: allPass(),
      evidence_refs: [`github:run:pair-${pairIndex}`],
    });
  });
}

test('verified archive recomputes paired tournament result before admission', () => {
  const tournamentPlan = plan();
  const receipts = receiptsFor(tournamentPlan);
  const result = evaluateRsiShadowTournament({ plan: tournamentPlan, receipts });
  const archive = new RsiVerifiedEvolutionArchive();

  const admission = archive.admit({ plan: tournamentPlan, result, receipts });
  assert.equal(admission.schema, RSI_VERIFIED_EVOLUTION_ARCHIVE_ADMISSION_SCHEMA);
  assert.equal(admission.candidate_id, CANDIDATE_ID);
  assert.equal(admission.tournament_result_digest, result.result_digest);
  assert.deepEqual(admission.receipt_digests, result.receipt_digests);
  assert.equal(admission.canonical_recomputation_required, true);
  assert.equal(admission.caller_supplied_verdict_trusted, false);
  assert.equal(admission.eligible_for_promotion, false);
  assert.equal(admission.execution_authority, false);
  assert.equal(admission.self_update_authority, false);
  assert.equal(admission.automatic_retry_allowed, false);
  assert.match(admission.admission_digest, /^sha256:[0-9a-f]{64}$/);
});

test('digest-consistent forged tournament verdict is rejected at verified archive boundary', () => {
  const tournamentPlan = plan();
  const receipts = receiptsFor(tournamentPlan);
  const canonical = evaluateRsiShadowTournament({ plan: tournamentPlan, receipts });
  const forged = structuredClone(canonical);

  forged.relation = 'TRADEOFF_STEPPING_STONE';
  forged.behavior_signature = `sha256:${'9'.repeat(64)}`;
  forged.objectives[0].candidate_median = 0;
  delete forged.result_digest;
  forged.result_digest = digest(forged);

  assert.equal(verifyRsiShadowTournamentResult({ plan: tournamentPlan, result: forged }).result_digest, forged.result_digest);
  const archive = new RsiVerifiedEvolutionArchive();
  assert.throws(
    () => archive.admit({ plan: tournamentPlan, result: forged, receipts }),
    /result_not_canonical/,
  );
});

test('verified archive rejects incomplete paired evidence instead of trusting result digest', () => {
  const tournamentPlan = plan();
  const receipts = receiptsFor(tournamentPlan);
  const result = evaluateRsiShadowTournament({ plan: tournamentPlan, receipts });
  const archive = new RsiVerifiedEvolutionArchive();

  assert.throws(
    () => archive.admit({ plan: tournamentPlan, result, receipts: receipts.slice(0, -1) }),
    /exact_pair_count_required/,
  );
});

test('verified archive snapshot exposes no promotion or direct archive mutation authority', () => {
  const tournamentPlan = plan();
  const receipts = receiptsFor(tournamentPlan);
  const result = evaluateRsiShadowTournament({ plan: tournamentPlan, receipts });
  const archive = new RsiVerifiedEvolutionArchive();
  archive.admit({ plan: tournamentPlan, result, receipts });

  const snapshot = archive.snapshot();
  assert.equal(snapshot.schema, RSI_VERIFIED_EVOLUTION_ARCHIVE_SNAPSHOT_SCHEMA);
  assert.equal(snapshot.verified_admission_required, true);
  assert.equal(snapshot.direct_archive_mutation_exposed, false);
  assert.equal(snapshot.scalar_ranking_authoritative, false);
  assert.equal(snapshot.eligible_for_promotion, false);
  assert.equal(snapshot.execution_authority, false);
  assert.equal(snapshot.promotion_authority, false);
  assert.equal(snapshot.self_update_authority, false);
  assert.equal(snapshot.automatic_retry_allowed, false);
  assert.match(snapshot.snapshot_digest, /^sha256:[0-9a-f]{64}$/);
});
