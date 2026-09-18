
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { BrowserBrainWorkingMemory } from '../src/browser-brain-working-memory.mjs';
import { RsiShadowObserver } from '../src/rsi-shadow-observer.mjs';
import { createRsiSearchContext } from '../src/rsi-search-mode-router.mjs';
import { createRsiAutonomousEpisodePlan } from '../src/rsi-autonomous-episode-controller.mjs';
import {
  createRsiVerifiedSearchFeedback,
  verifyRsiVerifiedSearchFeedback,
  rsiVerifiedSearchFeedbackTrustRootSnapshot,
} from '../src/rsi-verified-search-feedback.mjs';

const SOURCE_SHA = 'a0af13c0640fffb4b6d5da1645220e32786b5ec0';
const CANDIDATE_SHA = 'b'.repeat(40);
const CANDIDATE_ID = 'candidate_sha256_' + 'c'.repeat(64);
const TAB = 'tab_00000000-0000-4000-8000-000000000001';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}

function autonomousPlan() {
  const memory = new BrowserBrainWorkingMemory({ maxEvents: 64, maxCells: 8, clock: () => 1_800_000_000_000 });
  memory.rememberBinding({
    valid: true,
    tab_id: TAB,
    binding_generation: 1,
    web_contents_id: 7,
    renderer_pid: 77,
    renderer_process_key: '77:1234',
    target_id: 'target-7',
    document_generation: 1,
    semantic_revision: 1,
  });
  memory.rememberCommandOutcome({
    command_id: 'cmd-feedback-1',
    action: 'TYPE',
    tab_id: TAB,
    status: 'AMBIGUOUS',
    effect_outcome: 'AMBIGUOUS',
    recorded_at: '2027-01-15T08:01:00.000Z',
  });
  const observation = new RsiShadowObserver({
    source_sha: SOURCE_SHA,
    clock: () => 1_800_000_001_000,
  }).observeBrainSnapshot(memory.snapshot());
  const opportunity = observation.opportunities.find((row) => row.signal === 'AMBIGUOUS_COMMAND_OUTCOMES');
  const searchContext = createRsiSearchContext({
    context_id: 'rsi-context-feedback-1',
    mutation_surface: 'BROWSER_RUNTIME',
    problem_class: 'AMBIGUITY_RECONCILIATION',
    budget_class: 'NORMAL',
    skeleton_available: false,
    trace_history_available: true,
    lineage_candidate_count: 2,
    failure_class: 'TRANSPORT_AMBIGUITY',
    novelty_pressure: 0.4,
    external_context_owner: true,
    authored_by_candidate: false,
  });
  return createRsiAutonomousEpisodePlan({
    observation,
    opportunity_id: opportunity.opportunity_id,
    search_context: searchContext,
    cycle_generation: 1,
    max_candidates: 4,
    proposal_budget_units: 100,
    exploration_fraction: 0.2,
  });
}

function handoff(plan, index = 0) {
  const variant = plan.variant_plans[index];
  return {
    schema: 'metaengine.rsi.isolated-candidate-handoff.v1',
    version: 1,
    experiment_id: variant.experiment_id,
    mutation_surface: 'BROWSER_RUNTIME',
    parent_sha: SOURCE_SHA,
    candidate_sha: CANDIDATE_SHA,
    target_branch: variant.target_branch,
    handoff_digest: 'sha256:' + 'd'.repeat(64),
    candidate_capsule: { candidate_id: CANDIDATE_ID, source: { head: CANDIDATE_SHA } },
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

function bundle(plan, overrides = {}) {
  const resultByKind = {
    HARD_INVARIANTS: 'PASS',
    OBJECTIVES: 'PASS',
    HOLDOUT: 'PASS',
    REGRESSION_REPLAY: 'PASS',
    EVALUATION_INTEGRITY: 'PASS',
    TOURNAMENT: 'PASS',
    ...(overrides.results || {}),
  };
  const evidence = Object.entries(resultByKind).map(([kind, result], index) => ({
    evidence_kind: kind,
    evidence_id: 'feedback-evidence-' + String(index + 1),
    evidence_digest: String(index + 1).repeat(64).slice(0, 64),
    source_artifact_digest: String(index + 7).repeat(64).slice(0, 64),
    result,
    ambiguous_effect: result === 'AMBIGUOUS',
    external_evidence_required: true,
    authored_by_candidate: false,
    physical_effect_replay_allowed: false,
    authority_effect: false,
    automatic_retry_allowed: false,
  }));
  const core = {
    schema: 'metaengine.rsi.episode-evaluation-bundle.v1',
    version: 1,
    episode_id: plan.episode_id,
    source_sha: SOURCE_SHA,
    trust_root_set_digest: 'e'.repeat(64),
    candidate_id: CANDIDATE_ID,
    candidate_sha: CANDIDATE_SHA,
    parent_sha: SOURCE_SHA,
    mutation_surface: 'BROWSER_RUNTIME',
    evidence,
    complete_evidence_set: true,
    candidate_authored_evidence_allowed: false,
    scalar_reward_authoritative: false,
    visible_suite_alone_sufficient: false,
    external_promotion_gate_still_required: true,
    direct_promotion_enabled: false,
    execution_authority: false,
    browser_authority: false,
    scheduler_authority: false,
    task_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return { ...core, bundle_digest: digest(core) };
}

test('all independent evidence PASS becomes verified net-benefit routing evidence only', () => {
  const plan = autonomousPlan();
  const feedback = createRsiVerifiedSearchFeedback({
    controller_plan: plan,
    candidate_handoff: handoff(plan),
    evaluation_bundle: bundle(plan),
    cost_units: 12,
  });
  verifyRsiVerifiedSearchFeedback(feedback);
  assert.equal(feedback.candidate_valid, true);
  assert.equal(feedback.net_benefit_verified, true);
  assert.equal(feedback.routing_outcome.net_benefit_verified, true);
  assert.equal(feedback.routing_outcome.search_mode, plan.variant_plans[0].search_variant.search_mode);
  assert.equal(feedback.scalar_reward_authoritative, false);
  assert.equal(feedback.search_feedback_is_scheduler_authority, false);
  assert.equal(feedback.search_feedback_is_promotion_authority, false);
});

test('no measured advance is a valid search loss, not an invalid candidate', () => {
  const plan = autonomousPlan();
  const feedback = createRsiVerifiedSearchFeedback({
    controller_plan: plan,
    candidate_handoff: handoff(plan),
    evaluation_bundle: bundle(plan, { results: { OBJECTIVES: 'FAIL', TOURNAMENT: 'FAIL' } }),
    cost_units: 8,
  });
  assert.equal(feedback.candidate_valid, true);
  assert.equal(feedback.net_benefit_verified, false);
  assert.equal(feedback.routing_outcome.candidate_valid, true);
  assert.equal(feedback.routing_outcome.net_benefit_verified, false);
});

test('ambiguous evaluation validity cannot count as beneficial router evidence', () => {
  const plan = autonomousPlan();
  const feedback = createRsiVerifiedSearchFeedback({
    controller_plan: plan,
    candidate_handoff: handoff(plan),
    evaluation_bundle: bundle(plan, { results: { EVALUATION_INTEGRITY: 'AMBIGUOUS' } }),
    cost_units: 6,
  });
  assert.equal(feedback.candidate_valid, false);
  assert.equal(feedback.net_benefit_verified, false);
  assert.equal(feedback.routing_outcome.hard_invariants_pass, true);
  assert.equal(feedback.routing_outcome.candidate_valid, false);
  assert.equal(feedback.automatic_retry_allowed, false);
});

test('feedback requires exact autonomous variant branch and candidate lineage', () => {
  const plan = autonomousPlan();
  const wrongBranch = handoff(plan);
  wrongBranch.target_branch = 'work/rsi/not-the-routed-variant';
  assert.throws(() => createRsiVerifiedSearchFeedback({
    controller_plan: plan,
    candidate_handoff: wrongBranch,
    evaluation_bundle: bundle(plan),
    cost_units: 5,
  }), /variant_not_found/);

  const wrongParent = handoff(plan);
  wrongParent.parent_sha = 'f'.repeat(40);
  assert.throws(() => createRsiVerifiedSearchFeedback({
    controller_plan: plan,
    candidate_handoff: wrongParent,
    evaluation_bundle: bundle(plan),
    cost_units: 5,
  }), /parent_source_mismatch/);
});

test('feedback digest is tamper evident and candidate cannot author feedback authority', () => {
  const plan = autonomousPlan();
  const feedback = createRsiVerifiedSearchFeedback({
    controller_plan: plan,
    candidate_handoff: handoff(plan),
    evaluation_bundle: bundle(plan),
    cost_units: 10,
  });
  const tampered = structuredClone(feedback);
  tampered.net_benefit_verified = false;
  assert.throws(() => verifyRsiVerifiedSearchFeedback(tampered), /validity_derivation_mismatch|digest_mismatch/);

  const authority = structuredClone(feedback);
  authority.promotion_authority = true;
  assert.throws(() => verifyRsiVerifiedSearchFeedback(authority), /feedback_promotion_authority_invalid/);
});

test('search-feedback trust root separates validity from benefit and never grants promotion', () => {
  const root = rsiVerifiedSearchFeedbackTrustRootSnapshot();
  assert.equal(root.candidate_feedback_source, 'INDEPENDENT_EVALUATION_BUNDLE_ONLY');
  assert.deepEqual(root.validity_requires, [
    'HARD_INVARIANTS',
    'EVALUATION_INTEGRITY',
    'HOLDOUT',
    'REGRESSION_REPLAY',
  ]);
  assert.deepEqual(root.net_benefit_additionally_requires, ['OBJECTIVES', 'TOURNAMENT']);
  assert.equal(root.scalar_reward_authoritative, false);
  assert.equal(root.candidate_authored_feedback_allowed, false);
  assert.equal(root.search_feedback_is_scheduler_authority, false);
  assert.equal(root.search_feedback_is_promotion_authority, false);
});
