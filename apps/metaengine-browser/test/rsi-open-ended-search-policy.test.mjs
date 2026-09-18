import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  RSI_CURRICULUM_CHALLENGE_SCHEMA,
  RSI_EXPERIENCE_LESSON_SCHEMA,
  assessRsiProposalNovelty,
  createRsiCurriculumChallenge,
  createRsiExperienceLesson,
  createRsiOpenEndedSearchPlan,
  rsiOpenEndedSearchTrustRootSnapshot,
  selectRsiProposalModelArm,
  verifyRsiOpenEndedSearchPlan,
} from '../src/rsi-open-ended-search-policy.mjs';
import { RSI_EVOLUTION_ARCHIVE_SNAPSHOT_SCHEMA } from '../src/rsi-shadow-tournament.mjs';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}

const hex = (char, count) => char.repeat(count);
const candidateId = (char) => `candidate_sha256_${hex(char, 64)}`;
const sha = (char) => hex(char, 40);
const d = (char) => `sha256:${hex(char, 64)}`;

function archiveFixture() {
  const entries = [
    {
      candidate_id: candidateId('1'),
      candidate_sha: sha('1'),
      parent_sha: sha('0'),
      mutation_surface: 'BROWSER_RUNTIME',
      result_digest: d('1'),
      behavior_signature: 'browser.runtime.latency',
      state: 'PARETO_ELITE',
      active: true,
      relation: 'PARETO_ADVANCE',
      scalar_score: null,
      row_digest: d('a'),
    },
    {
      candidate_id: candidateId('2'),
      candidate_sha: sha('2'),
      parent_sha: sha('1'),
      mutation_surface: 'TOOL_INTERFACE',
      result_digest: d('2'),
      behavior_signature: 'tool.interface.recovery',
      state: 'STEPPING_STONE',
      active: true,
      relation: 'TRADEOFF_STEPPING_STONE',
      scalar_score: null,
      row_digest: d('b'),
    },
    {
      candidate_id: candidateId('3'),
      candidate_sha: sha('3'),
      parent_sha: sha('2'),
      mutation_surface: 'AGENT_ORCHESTRATION',
      result_digest: d('3'),
      behavior_signature: 'agent.orchestration.parallel',
      state: 'PARETO_ELITE',
      active: true,
      relation: 'PARETO_ADVANCE',
      scalar_score: null,
      row_digest: d('c'),
    },
    {
      candidate_id: candidateId('4'),
      candidate_sha: sha('4'),
      parent_sha: sha('1'),
      mutation_surface: 'PROMPT_ROUTING',
      result_digest: d('4'),
      behavior_signature: 'prompt.routing.experiment',
      state: 'DOMINATED',
      active: false,
      relation: 'TRADEOFF_STEPPING_STONE',
      scalar_score: null,
      row_digest: d('d'),
    },
    {
      candidate_id: candidateId('5'),
      candidate_sha: sha('5'),
      parent_sha: sha('4'),
      mutation_surface: 'RSI_IMPROVER',
      result_digest: d('5'),
      behavior_signature: 'rsi.improver.archive',
      state: 'STEPPING_STONE',
      active: true,
      relation: 'TRADEOFF_STEPPING_STONE',
      scalar_score: null,
      row_digest: d('e'),
    },
  ];
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

function lessonsFixture() {
  return [
    createRsiExperienceLesson({
      source_candidate_id: candidateId('1'),
      source_candidate_sha: sha('1'),
      mutation_surface: 'BROWSER_RUNTIME',
      failure_class: 'GENERALIZATION_FAILURE',
      mechanism_tags: ['RESULT_READBACK', 'BOUNDED_TRANSPORT'],
      challenge_families: ['COMMAND_LIVENESS'],
      recommendation_codes: ['REQUIRE_HOLDOUT', 'PRESERVE_ONE_ATTEMPT'],
      evidence_digest: d('6'),
      evidence_refs: ['GITHUB_RUN_101', 'SUPABASE_RECEIPT_101'],
      external_verifier: true,
      authored_by_candidate: false,
    }),
    createRsiExperienceLesson({
      source_candidate_id: candidateId('4'),
      source_candidate_sha: sha('4'),
      mutation_surface: 'PROMPT_ROUTING',
      failure_class: 'NOVELTY_COLLAPSE',
      mechanism_tags: ['PROMPT_VARIATION'],
      challenge_families: ['AGENT_DESIGN'],
      recommendation_codes: ['AVOID_DUPLICATE_VARIANT'],
      evidence_digest: d('7'),
      evidence_refs: ['GITHUB_RUN_102'],
      external_verifier: true,
      authored_by_candidate: false,
    }),
  ];
}

function challengesFixture() {
  return [
    createRsiCurriculumChallenge({
      challenge_id: 'challenge.command-liveness.production',
      family: 'COMMAND_LIVENESS',
      difficulty: 6,
      source_class: 'PRODUCTION_INCIDENT',
      suite_digest: d('1'),
      hidden_manifest_digest: d('2'),
      attempted_count: 10,
      solved_count: 4,
      external_origin_verified: true,
      authored_by_candidate: false,
    }),
    createRsiCurriculumChallenge({
      challenge_id: 'challenge.red-queen.transport',
      family: 'COMMAND_LIVENESS',
      difficulty: 8,
      source_class: 'ADVERSARIAL',
      suite_digest: d('3'),
      hidden_manifest_digest: d('4'),
      attempted_count: 5,
      solved_count: 2,
      external_origin_verified: true,
      authored_by_candidate: false,
    }),
    createRsiCurriculumChallenge({
      challenge_id: 'challenge.transfer.cross-model',
      family: 'AGENT_DESIGN',
      difficulty: 7,
      source_class: 'TRANSFER',
      suite_digest: d('5'),
      hidden_manifest_digest: d('6'),
      attempted_count: 4,
      solved_count: 2,
      external_origin_verified: true,
      authored_by_candidate: false,
    }),
    createRsiCurriculumChallenge({
      challenge_id: 'challenge.hidden.frontier',
      family: 'BROWSER_RELIABILITY',
      difficulty: 9,
      source_class: 'HOLDOUT',
      suite_digest: d('7'),
      hidden_manifest_digest: d('8'),
      attempted_count: 0,
      solved_count: 0,
      external_origin_verified: true,
      authored_by_candidate: false,
    }),
    createRsiCurriculumChallenge({
      challenge_id: 'challenge.too-easy',
      family: 'BROWSER_RELIABILITY',
      difficulty: 1,
      source_class: 'SYNTHETIC_CURRICULUM',
      suite_digest: d('9'),
      hidden_manifest_digest: d('a'),
      attempted_count: 100,
      solved_count: 100,
      external_origin_verified: true,
      authored_by_candidate: false,
    }),
  ];
}

test('experience lessons are structured external evidence, not candidate-authored free-form memory', () => {
  const lesson = lessonsFixture()[0];
  assert.equal(lesson.schema, RSI_EXPERIENCE_LESSON_SCHEMA);
  assert.equal(lesson.external_verifier, true);
  assert.equal(lesson.authored_by_candidate, false);
  assert.equal(lesson.freeform_candidate_memory_allowed, false);
  assert.equal(lesson.trusted_ingest_required, true);
  assert.equal(lesson.authority_effect, false);

  assert.throws(() => createRsiExperienceLesson({
    source_candidate_id: candidateId('1'),
    source_candidate_sha: sha('1'),
    mutation_surface: 'BROWSER_RUNTIME',
    failure_class: 'GENERALIZATION_FAILURE',
    mechanism_tags: ['TAG'],
    challenge_families: ['FAMILY'],
    recommendation_codes: ['TRY_AGAIN'],
    evidence_digest: d('b'),
    evidence_refs: ['RUN_1'],
    external_verifier: false,
    authored_by_candidate: true,
  }), /external_origin_required/);
});

test('curriculum keeps manifests hidden and rejects candidate-authored challenge authority', () => {
  const challenge = challengesFixture()[0];
  assert.equal(challenge.schema, RSI_CURRICULUM_CHALLENGE_SCHEMA);
  assert.equal(challenge.task_manifest_exposed_to_candidate, false);
  assert.equal(challenge.solution_exposed_to_candidate, false);
  assert.equal(challenge.external_origin_verified, true);
  assert.equal(challenge.authority_effect, false);

  assert.throws(() => createRsiCurriculumChallenge({
    challenge_id: 'challenge.bad',
    family: 'BAD',
    difficulty: 1,
    source_class: 'HOLDOUT',
    suite_digest: d('1'),
    hidden_manifest_digest: d('2'),
    external_origin_verified: false,
    authored_by_candidate: true,
  }), /external_origin_required/);
});

test('open-ended plan preserves elites, stepping stones, niche coverage and useful dominated ancestors without scalar promotion', () => {
  const plan = createRsiOpenEndedSearchPlan({
    archive_snapshot: archiveFixture(),
    generation: 12,
    parent_usage: [
      { candidate_id: candidateId('1'), selection_count: 5, last_selected_generation: 11 },
      { candidate_id: candidateId('2'), selection_count: 2, last_selected_generation: 8 },
      { candidate_id: candidateId('3'), selection_count: 0, last_selected_generation: 0 },
      { candidate_id: candidateId('4'), selection_count: 1, last_selected_generation: 3 },
      { candidate_id: candidateId('5'), selection_count: 1, last_selected_generation: 10 },
    ],
    experience_lessons: lessonsFixture(),
    challenge_catalog: challengesFixture(),
    model_arms: [
      { arm_id: 'GPT_5_6_SOL', attempts: 8, useful_proposals: 5, external_metrics_verified: true, authored_by_candidate: false },
      { arm_id: 'GLM_5', attempts: 0, useful_proposals: 0, external_metrics_verified: true, authored_by_candidate: false },
    ],
  });
  verifyRsiOpenEndedSearchPlan(plan);

  const roles = new Map(plan.parents.map((row) => [row.role, row]));
  assert.equal(roles.get('PARETO_EXPLOIT').state, 'PARETO_ELITE');
  assert.equal(roles.get('STEPPING_STONE').state, 'STEPPING_STONE');
  assert.equal(roles.get('NICHE_COVERAGE').active, true);
  assert.equal(roles.get('ANCESTOR_REVIVAL').candidate_id, candidateId('4'));
  assert.ok(roles.get('ANCESTOR_REVIVAL').descendant_count > 0);
  for (const parent of plan.parents) {
    assert.equal(parent.scalar_winner, null);
    assert.equal(parent.selection_is_promotion, false);
  }

  assert.equal(plan.search_policy.preserve_stepping_stones, true);
  assert.equal(plan.search_policy.dominated_ancestor_revival_if_descendant_evidence, true);
  assert.equal(plan.search_policy.candidate_can_select_parent, false);
  assert.equal(plan.search_policy.candidate_can_modify_search_policy, false);
  assert.equal(plan.search_policy.single_scalar_fitness_authoritative, false);

  assert.equal(plan.proposal_routing.selected_arm_id, 'GLM_5', 'untried model arm gets one exploration opportunity');
  assert.equal(plan.proposal_routing.routing_is_promotion, false);
  assert.equal(plan.proposal_routing.authority_effect, false);

  const challengeSources = new Set(plan.curriculum.selected_challenges.map((row) => row.source_class));
  assert.equal(challengeSources.has('PRODUCTION_INCIDENT'), true);
  assert.equal(challengeSources.has('ADVERSARIAL'), true);
  assert.equal(challengeSources.has('TRANSFER'), true);
  assert.ok(plan.experience_memory.selected_lessons.length >= 1);
  assert.equal(plan.experience_memory.freeform_candidate_memory_allowed, false);
});

test('search plan is deterministic and tamper-evident for the same archive generation and evidence', () => {
  const input = {
    archive_snapshot: archiveFixture(),
    generation: 22,
    parent_usage: [],
    experience_lessons: lessonsFixture(),
    challenge_catalog: challengesFixture(),
  };
  const left = createRsiOpenEndedSearchPlan(input);
  const right = createRsiOpenEndedSearchPlan(input);
  assert.equal(left.plan_id, right.plan_id);
  assert.equal(left.plan_digest, right.plan_digest);
  assert.deepEqual(left.parents, right.parents);
  assert.deepEqual(left.curriculum, right.curriculum);

  const tampered = structuredClone(left);
  tampered.search_policy.candidate_can_select_parent = true;
  assert.throws(() => verifyRsiOpenEndedSearchPlan(tampered), /policy_invalid/);
});

test('novelty prefilter rejects exact duplicates and defers semantic near-duplicates to external review', () => {
  const prior = {
    proposal_id: 'proposal.prior',
    parent_sha: sha('1'),
    mutation_surface: 'BROWSER_RUNTIME',
    mutation_paths: [
      'apps/metaengine-browser/src/a.mjs',
      'apps/metaengine-browser/src/b.mjs',
      'apps/metaengine-browser/src/c.mjs',
      'apps/metaengine-browser/src/d.mjs',
      'apps/metaengine-browser/src/e.mjs',
    ],
    mechanism_tags: ['RESULT_READBACK', 'BOUNDED_TRANSPORT', 'NO_BLIND_RETRY', 'LIVENESS'],
  };
  const exact = assessRsiProposalNovelty({
    proposal: { ...prior, proposal_id: 'proposal.exact' },
    prior_proposals: [prior],
  });
  assert.equal(exact.state, 'REJECT_EXACT_DUPLICATE');
  assert.equal(exact.expensive_evaluation_allowed, false);
  assert.equal(exact.authority_effect, false);

  const near = assessRsiProposalNovelty({
    proposal: {
      proposal_id: 'proposal.near',
      parent_sha: sha('2'),
      mutation_surface: 'BROWSER_RUNTIME',
      mutation_paths: [
        'apps/metaengine-browser/src/a.mjs',
        'apps/metaengine-browser/src/b.mjs',
        'apps/metaengine-browser/src/c.mjs',
        'apps/metaengine-browser/src/d.mjs',
        'apps/metaengine-browser/src/f.mjs',
      ],
      mechanism_tags: ['RESULT_READBACK', 'BOUNDED_TRANSPORT', 'NO_BLIND_RETRY', 'LIVENESS'],
    },
    prior_proposals: [prior],
  });
  assert.equal(near.state, 'EXTERNAL_NOVELTY_REVIEW_REQUIRED');
  assert.equal(near.external_novelty_review_required, true);
  assert.equal(near.llm_novelty_judge_is_authority, false);

  const novel = assessRsiProposalNovelty({
    proposal: {
      proposal_id: 'proposal.novel',
      parent_sha: sha('3'),
      mutation_surface: 'AGENT_ORCHESTRATION',
      mutation_paths: ['apps/metaengine-browser/src/new-agent-router.mjs'],
      mechanism_tags: ['CROSS_MODEL_TRANSFER', 'ADVERSARIAL_CURRICULUM'],
    },
    prior_proposals: [prior],
  });
  assert.equal(novel.state, 'ADMIT_TO_CHEAP_EVAL');
  assert.equal(novel.expensive_evaluation_allowed, true);
});

test('model routing uses verified outcomes for exploration without becoming evaluation authority', () => {
  const routed = selectRsiProposalModelArm({
    arms: [
      { arm_id: 'FAST_MODEL', attempts: 20, useful_proposals: 8, external_metrics_verified: true, authored_by_candidate: false },
      { arm_id: 'DEEP_MODEL', attempts: 5, useful_proposals: 4, external_metrics_verified: true, authored_by_candidate: false },
    ],
  });
  assert.equal(routed.selected_arm_id, 'DEEP_MODEL');
  assert.equal(routed.routing_metric, 'UCB1_USEFUL_PROPOSALS');
  assert.equal(routed.routing_is_evaluation, false);
  assert.equal(routed.routing_is_promotion, false);
  assert.equal(routed.authority_effect, false);
});

test('search trust root freezes candidate parent/challenge/policy control', () => {
  const root = rsiOpenEndedSearchTrustRootSnapshot();
  assert.equal(root.candidate_can_modify_search_policy, false);
  assert.equal(root.candidate_can_author_lessons, false);
  assert.equal(root.candidate_can_select_parent, false);
  assert.equal(root.candidate_can_select_challenge, false);
  assert.equal(root.candidate_can_select_holdout, false);
  assert.equal(root.llm_novelty_judge_is_authority, false);
  assert.equal(root.scalar_fitness_authoritative, false);
  assert.equal(root.execution_authority, false);
  assert.match(root.search_root_digest, /^sha256:[0-9a-f]{64}$/);
});
