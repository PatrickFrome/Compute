import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiFrontierTaskProposal,
  verifyRsiFrontierTaskProposal,
  createRsiFrontierTaskMaterializationReceipt,
  verifyRsiFrontierTaskMaterializationReceipt,
  createRsiFrontierLearnabilityReceipt,
  verifyRsiFrontierLearnabilityReceipt,
  finalizeRsiFrontierTask,
  verifyRsiFrontierTaskHandoff,
  createRsiFrontierTaskBufferSnapshot,
  verifyRsiFrontierTaskBufferSnapshot,
  rsiFrontierCoevolutionTrustRootSnapshot,
} from '../src/rsi-frontier-coevolution.mjs';

const d = (char) => `sha256:${char.repeat(64)}`;

function proposal(id = 'p1', {
  mode = 'DEDUCTION',
  family = 'COMMAND_LIVENESS',
  executorAuthored = true,
  generation = 29,
} = {}) {
  return createRsiFrontierTaskProposal({
    proposal_id: `frontier.proposal.${id}`,
    generation,
    mode,
    family,
    target_difficulty: 7,
    proposer_model_family: 'GPT_5_6_SOL',
    proposer_role: executorAuthored ? 'SHARED_SELF_PLAY_MODEL' : 'CURRICULUM_AGENT',
    source_anchor_digests: [d('a'), d('b')],
    tool_capability_classes: ['READ_ONLY', 'PROPOSAL_ONLY'],
    executor_authored: executorAuthored,
  });
}

function materialization(p, chars = ['1', '2', '3', '4']) {
  return createRsiFrontierTaskMaterializationReceipt({
    proposal: p,
    suite_digest: d(chars[0]),
    hidden_manifest_digest: d(chars[1]),
    oracle_digest: d(chars[2]),
    semantic_contract_digest: d(chars[3]),
    sandbox_backend: 'VERCEL_SANDBOX',
    deterministic_replay_count: 3,
    deterministic_outputs_match: true,
    forbidden_capability_scan_pass: true,
    network_default_deny: true,
    host_repository_mounted: false,
    external_materializer: true,
    authored_by_executor: false,
    evidence_refs: ['MATERIALIZE_RUN_1', 'SANDBOX_REPLAY_1'],
  });
}

function learnability(p, m, {
  attempts = 16,
  successes = 5,
  novelty = 0.60,
  panel = ['GPT_5_6_SOL', 'GLM_5'],
} = {}) {
  return createRsiFrontierLearnabilityReceipt({
    proposal: p,
    materialization: m,
    executor_snapshot_digest: d('e'),
    panel_model_families: panel,
    solve_attempts: attempts,
    solve_successes: successes,
    novelty_score: novelty,
    external_evaluator: true,
    authored_by_executor: false,
    evidence_refs: ['LEARNABILITY_RUN_1', 'PANEL_RECEIPT_1'],
  });
}

function admitted(id, mode, family, chars, successes = 5) {
  const p = proposal(id, { mode, family });
  const m = materialization(p, chars);
  const l = learnability(p, m, { successes });
  const h = finalizeRsiFrontierTask({ proposal: p, materialization: m, learnability: l });
  return { p, m, l, h };
}

test('self-play proposer output is explicitly untrusted and never becomes verifier or authority', () => {
  const row = proposal('self');
  verifyRsiFrontierTaskProposal(row);
  assert.equal(row.executor_authored, true);
  assert.equal(row.proposer_role, 'SHARED_SELF_PLAY_MODEL');
  assert.equal(row.proposal_is_untrusted_until_external_materialization, true);
  assert.equal(row.proposer_is_verifier, false);
  assert.equal(row.proposer_is_promotion_authority, false);
  assert.equal(row.candidate_can_self_admit_task, false);
  assert.equal(row.raw_task_content_in_trust_root, false);
  assert.equal(row.direct_tool_execution_authority, false);
  assert.equal(row.authority_effect, false);
});

test('task materialization must be external, deterministic, sandboxed and hide oracle/manifest', () => {
  const p = proposal('materialize', { executorAuthored: false });
  const row = materialization(p);
  verifyRsiFrontierTaskMaterializationReceipt(row, p);
  assert.equal(row.external_materializer, true);
  assert.equal(row.authored_by_executor, false);
  assert.equal(row.deterministic_outputs_match, true);
  assert.equal(row.forbidden_capability_scan_pass, true);
  assert.equal(row.network_default_deny, true);
  assert.equal(row.host_repository_mounted, false);
  assert.equal(row.hidden_manifest_visible_to_proposer, false);
  assert.equal(row.oracle_visible_to_proposer, false);
  assert.equal(row.hidden_manifest_visible_to_executor, false);
  assert.equal(row.oracle_visible_to_executor, false);
  assert.equal(row.benchmark_promotion_evidence, false);

  assert.throws(() => createRsiFrontierTaskMaterializationReceipt({
    proposal: p,
    suite_digest: d('1'),
    hidden_manifest_digest: d('1'),
    oracle_digest: d('2'),
    semantic_contract_digest: d('3'),
    sandbox_backend: 'VERCEL_SANDBOX',
    deterministic_replay_count: 2,
    deterministic_outputs_match: true,
    forbidden_capability_scan_pass: true,
    external_materializer: true,
    authored_by_executor: false,
    evidence_refs: ['RUN_ALIAS'],
  }), /digest_alias/);

  assert.throws(() => createRsiFrontierTaskMaterializationReceipt({
    proposal: p,
    suite_digest: d('1'),
    hidden_manifest_digest: d('2'),
    oracle_digest: d('3'),
    semantic_contract_digest: d('4'),
    sandbox_backend: 'VERCEL_SANDBOX',
    deterministic_replay_count: 2,
    deterministic_outputs_match: true,
    forbidden_capability_scan_pass: true,
    external_materializer: false,
    authored_by_executor: true,
    evidence_refs: ['MODEL_SELF_REPORT'],
  }), /external_origin_required/);
});

test('AZR-style learnability rewards difficult-but-solvable tasks and rejects trivial or impossible extremes', () => {
  const p = proposal('learnability');
  const m = materialization(p);
  const frontier = learnability(p, m, { attempts: 16, successes: 4, novelty: 0.8 });
  verifyRsiFrontierLearnabilityReceipt(frontier, p, m);
  assert.equal(frontier.solve_rate, 0.25);
  assert.equal(frontier.azr_style_learnability_reward, 0.75);
  assert.equal(frontier.frontier_balance_score, 0.75);
  assert.equal(frontier.minimal_criterion_pass, true);
  assert.equal(frontier.novelty_gate_pass, true);
  assert.equal(frontier.state, 'FRONTIER_ADMISSIBLE');
  assert.equal(frontier.no_alpha_spent_for_curriculum_screening, true);
  assert.equal(frontier.authority_effect, false);

  const impossible = learnability(p, m, { attempts: 16, successes: 0, novelty: 1 });
  assert.equal(impossible.azr_style_learnability_reward, 0);
  assert.equal(impossible.minimal_criterion_pass, false);
  assert.equal(impossible.state, 'HELD_NOT_FRONTIER');

  const trivial = learnability(p, m, { attempts: 16, successes: 16, novelty: 1 });
  assert.equal(trivial.azr_style_learnability_reward, 0);
  assert.equal(trivial.minimal_criterion_pass, false);
  assert.equal(trivial.state, 'HELD_NOT_FRONTIER');
});

test('frontier task becomes synthetic curriculum only and cannot become promotion evidence or trusted memory', () => {
  const p = proposal('admit', { mode: 'ABDUCTION', family: 'RECOVERY' });
  const m = materialization(p);
  const l = learnability(p, m, { attempts: 16, successes: 3, novelty: 0.9 });
  const h = finalizeRsiFrontierTask({ proposal: p, materialization: m, learnability: l });
  verifyRsiFrontierTaskHandoff(h, p, m, l);

  assert.equal(h.state, 'ADMITTED_SYNTHETIC_FRONTIER_CURRICULUM');
  assert.equal(h.mode, 'ABDUCTION');
  assert.equal(h.family, 'RECOVERY');
  assert.equal(h.eligible_for_curriculum, true);
  assert.equal(h.challenge.source_class, 'SYNTHETIC_CURRICULUM');
  assert.equal(h.challenge.task_manifest_exposed_to_candidate, false);
  assert.equal(h.challenge.solution_exposed_to_candidate, false);
  assert.equal(h.eligible_as_promotion_benchmark, false);
  assert.equal(h.eligible_for_trusted_memory_ingest, false);
  assert.equal(h.eligible_for_skill_library_ingest, false);
  assert.equal(h.benchmark_provenance_admission_required_for_promotion_evidence, true);
  assert.equal(h.self_play_task_is_promotion_evidence, false);
  assert.equal(h.proposer_cannot_self_certify_task, true);
  assert.equal(h.executor_cannot_self_certify_task, true);
  assert.equal(h.promotion_authority, false);
});

test('non-frontier task is held and cannot enter curriculum', () => {
  const p = proposal('held');
  const m = materialization(p);
  const l = learnability(p, m, { attempts: 16, successes: 1, novelty: 0.05 });
  const h = finalizeRsiFrontierTask({ proposal: p, materialization: m, learnability: l });
  assert.equal(h.state, 'HELD_NOT_FRONTIER');
  assert.equal(h.eligible_for_curriculum, false);
  assert.equal(h.challenge, null);
  assert.equal(h.eligible_as_promotion_benchmark, false);
  assert.equal(h.authority_effect, false);
});

test('verified frontier buffer preserves multi-mode/multi-family diversity and hides task internals', () => {
  const rows = [
    admitted('d1', 'DEDUCTION', 'COMMAND_LIVENESS', ['1','2','3','4'], 4),
    admitted('a1', 'ABDUCTION', 'RECOVERY', ['5','6','7','8'], 5),
    admitted('i1', 'INDUCTION', 'AGENT_DESIGN', ['9','a','b','c'], 6),
    admitted('d2', 'DEDUCTION', 'BROWSER_RELIABILITY', ['d','e','f','0'], 7),
  ];
  const snapshot = createRsiFrontierTaskBufferSnapshot({
    generation: 30,
    handoffs: rows.map((row) => row.h),
  });
  verifyRsiFrontierTaskBufferSnapshot(snapshot);
  assert.equal(snapshot.task_count, 4);
  assert.equal(snapshot.distinct_mode_count, 3);
  assert.equal(snapshot.distinct_family_count, 4);
  assert.equal(snapshot.diversity_floor_required, true);
  assert.equal(snapshot.diversity_floor_pass, true);
  assert.equal(snapshot.eligible_for_proposer_conditioning, true);
  assert.equal(snapshot.buffer_exposes_hidden_manifests, false);
  assert.equal(snapshot.buffer_exposes_oracles, false);
  assert.equal(snapshot.buffer_exposes_raw_task_content, false);
  assert.equal(snapshot.buffer_tasks_are_promotion_evidence, false);
  assert.equal(snapshot.candidate_can_select_buffer_tasks, false);
  assert.equal(snapshot.authority_effect, false);
});

test('frontier buffer detects mode collapse instead of feeding collapsed self-play back to proposer', () => {
  const rows = [
    admitted('collapse1', 'DEDUCTION', 'FAMILY_A', ['1','2','3','4'], 4),
    admitted('collapse2', 'DEDUCTION', 'FAMILY_B', ['5','6','7','8'], 5),
    admitted('collapse3', 'DEDUCTION', 'FAMILY_C', ['9','a','b','c'], 6),
    admitted('collapse4', 'DEDUCTION', 'FAMILY_D', ['d','e','f','0'], 7),
  ];
  const snapshot = createRsiFrontierTaskBufferSnapshot({
    generation: 31,
    handoffs: rows.map((row) => row.h),
  });
  assert.equal(snapshot.diversity_floor_required, true);
  assert.equal(snapshot.diversity_floor_pass, false);
  assert.equal(snapshot.eligible_for_proposer_conditioning, false);
  assert.equal(snapshot.max_single_mode_fraction, 1);
  assert.equal(snapshot.candidate_can_relax_diversity_floor, false);
});

test('frontier co-evolution trust root keeps self-play on the curriculum side of the trust boundary', () => {
  const root = rsiFrontierCoevolutionTrustRootSnapshot();
  assert.deepEqual(root.modes, ['DEDUCTION', 'ABDUCTION', 'INDUCTION']);
  assert.equal(root.proposer_may_share_model_family_with_executor, true);
  assert.equal(root.proposer_is_verifier, false);
  assert.equal(root.external_materializer_required, true);
  assert.equal(root.external_learnability_evaluator_required, true);
  assert.equal(root.deterministic_sandbox_replay_required, true);
  assert.equal(root.hidden_manifest_required, true);
  assert.equal(root.oracle_hidden_from_proposer_and_executor, true);
  assert.equal(root.self_play_task_is_promotion_evidence, false);
  assert.equal(root.benchmark_provenance_admission_required_for_promotion_evidence, true);
  assert.equal(root.buffer_diversity_floor_required, true);
  assert.equal(root.candidate_can_relax_frontier_thresholds, false);
  assert.equal(root.candidate_can_self_admit_task, false);
  assert.equal(root.execution_authority, false);
  assert.equal(root.promotion_authority, false);
  assert.match(root.frontier_root_digest, /^sha256:[0-9a-f]{64}$/);
});
