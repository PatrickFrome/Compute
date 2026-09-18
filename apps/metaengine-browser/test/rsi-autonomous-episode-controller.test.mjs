
import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainWorkingMemory } from '../src/browser-brain-working-memory.mjs';
import { RsiShadowObserver } from '../src/rsi-shadow-observer.mjs';
import { createRsiSearchContext } from '../src/rsi-search-mode-router.mjs';
import {
  createRsiAutonomousEpisodePlan,
  verifyRsiAutonomousEpisodePlan,
  rsiAutonomousEpisodeControllerTrustRootSnapshot,
} from '../src/rsi-autonomous-episode-controller.mjs';

const SOURCE_SHA = 'a0af13c0640fffb4b6d5da1645220e32786b5ec0';
const TAB = 'tab_00000000-0000-4000-8000-000000000001';

function observation() {
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
    command_id: 'cmd-ambiguous-autonomous-1',
    action: 'TYPE',
    tab_id: TAB,
    status: 'AMBIGUOUS',
    effect_outcome: 'AMBIGUOUS',
    recorded_at: '2027-01-15T08:01:00.000Z',
  });
  return new RsiShadowObserver({
    source_sha: SOURCE_SHA,
    clock: () => 1_800_000_001_000,
  }).observeBrainSnapshot(memory.snapshot());
}

function context() {
  return createRsiSearchContext({
    context_id: 'rsi-context-ambiguity-1',
    mutation_surface: 'BROWSER_RUNTIME',
    problem_class: 'AMBIGUITY_RECONCILIATION',
    budget_class: 'NORMAL',
    skeleton_available: false,
    trace_history_available: true,
    lineage_candidate_count: 2,
    failure_class: 'TRANSPORT_AMBIGUITY',
    novelty_pressure: 0.35,
    external_context_owner: true,
    authored_by_candidate: false,
  });
}

test('autonomous controller creates deterministic exploit/explore episode variants with zero scheduler authority', () => {
  const obs = observation();
  const opportunity = obs.opportunities.find((row) => row.signal === 'AMBIGUOUS_COMMAND_OUTCOMES');
  const input = {
    observation: obs,
    opportunity_id: opportunity.opportunity_id,
    search_context: context(),
    search_outcomes: [],
    cycle_generation: 1,
    max_candidates: 4,
    proposal_budget_units: 100,
    exploration_fraction: 0.2,
  };
  const first = createRsiAutonomousEpisodePlan(input);
  const second = createRsiAutonomousEpisodePlan(input);
  assert.deepEqual(first, second);
  verifyRsiAutonomousEpisodePlan(first);
  assert.equal(first.variant_count, 2);
  assert.equal(first.routing_plan.allocations.length, 2);
  assert.equal(first.variant_plans[0].target_branch === first.variant_plans[1].target_branch, false);
  assert.equal(new Set(first.variant_plans.map((row) => row.search_variant.search_mode)).size, 2);
  assert.equal(first.existing_devos_scheduler_required, true);
  assert.equal(first.search_routing_is_scheduler_authority, false);
  assert.equal(first.direct_dispatch_enabled, false);
  assert.equal(first.execution_authority, false);
  assert.equal(first.scheduler_authority, false);
  assert.equal(first.promotion_authority, false);
  assert.equal(first.self_update_authority, false);
  assert.equal(first.automatic_retry_allowed, false);
  assert.ok(first.variant_plans.every((row) => row.search_variant.candidate_can_choose_search_mode === false));
});

test('autonomous variants carry routing guidance into the DevOS task without widening authority', () => {
  const obs = observation();
  const opportunity = obs.opportunities.find((row) => row.signal === 'AMBIGUOUS_COMMAND_OUTCOMES');
  const plan = createRsiAutonomousEpisodePlan({
    observation: obs,
    opportunity_id: opportunity.opportunity_id,
    search_context: context(),
  });
  for (const variant of plan.variant_plans) {
    assert.equal(variant.schema, 'metaengine.rsi.devos-experiment-plan.v1');
    assert.equal(variant.requires_existing_devos_scheduler, true);
    assert.equal(variant.lease_created, false);
    assert.equal(variant.agent_assigned, false);
    assert.equal(variant.workspace_bound, false);
    assert.equal(variant.command_created, false);
    assert.equal(variant.execution_authority, false);
    assert.equal(variant.promotion_authority, false);
    assert.equal(variant.self_update_authority, false);
    assert.equal(variant.task_spec.rsi.search_variant.scheduler_action_authorized, false);
    assert.ok(variant.task_spec.constraints.includes('rsi_search_mode_is_proposal_guidance_only'));
    assert.ok(variant.task_spec.constraints.includes('rsi_search_router_has_zero_scheduler_authority'));
  }
});

test('search context cannot drift from the observed mutation surface', () => {
  const obs = observation();
  const opportunity = obs.opportunities.find((row) => row.signal === 'AMBIGUOUS_COMMAND_OUTCOMES');
  const wrong = createRsiSearchContext({
    context_id: 'rsi-context-wrong-surface',
    mutation_surface: 'AGENT_ORCHESTRATION',
    problem_class: 'AMBIGUITY_RECONCILIATION',
    budget_class: 'NORMAL',
    skeleton_available: false,
    trace_history_available: true,
    lineage_candidate_count: 2,
    failure_class: 'TRANSPORT_AMBIGUITY',
    novelty_pressure: 0.35,
    external_context_owner: true,
    authored_by_candidate: false,
  });
  assert.throws(() => createRsiAutonomousEpisodePlan({
    observation: obs,
    opportunity_id: opportunity.opportunity_id,
    search_context: wrong,
  }), /search_context_surface_mismatch/);
});

test('controller fails closed when candidate bound cannot cover routed variants', () => {
  const obs = observation();
  const opportunity = obs.opportunities.find((row) => row.signal === 'AMBIGUOUS_COMMAND_OUTCOMES');
  assert.throws(() => createRsiAutonomousEpisodePlan({
    observation: obs,
    opportunity_id: opportunity.opportunity_id,
    search_context: context(),
    max_candidates: 1,
  }), /candidate_limit_below_routing_allocations/);
});

test('controller plan and variant plans are tamper evident', () => {
  const obs = observation();
  const opportunity = obs.opportunities.find((row) => row.signal === 'AMBIGUOUS_COMMAND_OUTCOMES');
  const plan = createRsiAutonomousEpisodePlan({
    observation: obs,
    opportunity_id: opportunity.opportunity_id,
    search_context: context(),
  });
  const controllerTamper = structuredClone(plan);
  controllerTamper.direct_dispatch_enabled = true;
  assert.throws(() => verifyRsiAutonomousEpisodePlan(controllerTamper), /plan_policy_invalid/);

  const variantTamper = structuredClone(plan);
  variantTamper.variant_plans[0].task_spec.constraints.push('candidate_can_choose_mode');
  assert.throws(() => verifyRsiAutonomousEpisodePlan(variantTamper), /variant_plan_digest_mismatch/);
});

test('trust root fixes autonomous search policy outside candidate and scheduler authority', () => {
  const root = rsiAutonomousEpisodeControllerTrustRootSnapshot();
  assert.equal(root.contextual_search_routing, true);
  assert.equal(root.explicit_exploration_budget, true);
  assert.equal(root.existing_devos_scheduler_required, true);
  assert.equal(root.second_scheduler_allowed, false);
  assert.equal(root.candidate_can_choose_search_mode, false);
  assert.equal(root.direct_dispatch_enabled, false);
  assert.equal(root.direct_promotion_enabled, false);
  assert.equal(root.self_update_authority, false);
  assert.ok(root.immutable_component_paths.includes('apps/metaengine-browser/src/rsi-autonomous-episode-controller.mjs'));
});
