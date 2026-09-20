import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainWorkingMemory } from '../src/browser-brain-working-memory.mjs';
import { renderDevosTaskPrompt } from '../src/devos-native-task-cycle-core.mjs';
import { buildRsiDevosExperimentPlan } from '../src/rsi-devos-experiment-plan.mjs';
import { RsiShadowObserver } from '../src/rsi-shadow-observer.mjs';

const SOURCE_SHA = 'a0af13c0640fffb4b6d5da1645220e32786b5ec0';
const TAB = 'tab_00000000-0000-4000-8000-000000000001';

function ambiguousObservation() {
  const memory = new BrowserBrainWorkingMemory({ maxCells: 8, maxEvents: 64 });
  memory.rememberBinding({
    valid: true,
    tab_id: TAB,
    binding_generation: 1,
    web_contents_id: 7,
    renderer_pid: 77,
    renderer_process_key: '77:1234',
    target_id: 'target-7',
  });
  memory.rememberCommandOutcome({
    command_id: 'cmd-ambiguous-1',
    action: 'TYPE',
    tab_id: TAB,
    status: 'AMBIGUOUS',
    effect_outcome: 'AMBIGUOUS',
  });
  return new RsiShadowObserver({ source_sha: SOURCE_SHA }).observeBrainSnapshot(memory.snapshot());
}

test('RSI opportunity becomes a DevOS task proposal without creating a lease, command, or authority', () => {
  const observation = ambiguousObservation();
  const opportunity = observation.opportunities.find((entry) => entry.signal === 'AMBIGUOUS_COMMAND_OUTCOMES');
  const plan = buildRsiDevosExperimentPlan({ observation, opportunity_id: opportunity.opportunity_id });

  assert.equal(plan.source_sha, SOURCE_SHA);
  assert.equal(plan.requires_existing_devos_scheduler, true);
  assert.equal(plan.lease_created, false);
  assert.equal(plan.agent_assigned, false);
  assert.equal(plan.workspace_bound, false);
  assert.equal(plan.command_created, false);
  assert.equal(plan.execution_authority, false);
  assert.equal(plan.production_mutation_authority, false);
  assert.equal(plan.promotion_authority, false);
  assert.equal(plan.self_update_authority, false);
  assert.equal(plan.automatic_retry_allowed, false);
  assert.match(plan.target_branch, /^work\/rsi\/ambiguous-command-outcomes-a0af13c0-[0-9a-f]{8}$/);
  assert.match(plan.plan_digest, /^[0-9a-f]{64}$/);
  assert.ok(plan.task_spec.constraints.includes(`exact_base_sha=${SOURCE_SHA}`));
  assert.ok(plan.task_spec.constraints.includes('no_second_scheduler'));
  assert.ok(plan.task_spec.constraints.includes('no_direct_self_update'));
  assert.ok(plan.task_spec.constraints.includes('no_blind_retry_after_ambiguous_effect'));
});

test('generated task spec is compatible with the existing DevOS prompt contract', () => {
  const observation = ambiguousObservation();
  const opportunity = observation.opportunities[0];
  const plan = buildRsiDevosExperimentPlan({ observation, opportunity_id: opportunity.opportunity_id });

  const prompt = renderDevosTaskPrompt({
    agent_id: 'agent_12345678-1234-1234-1234-123456789abc',
    role: 'IMPLEMENTER',
    task_id: '12345678-1234-4234-8234-123456789abc',
    lease_generation: 1,
    base_sha: SOURCE_SHA,
    branch_name: plan.target_branch,
    task_spec: plan.task_spec,
  });

  assert.match(prompt, /METAENGINE FLEET TASK V1/);
  assert.match(prompt, new RegExp(`base_sha=${SOURCE_SHA}`));
  assert.match(prompt, /no_second_scheduler/);
  assert.match(prompt, /Do not blindly retry an ambiguous browser effect/);
  assert.doesNotMatch(prompt, /promotion_authority=true/);
});

test('DevOS bridge refuses opportunities that are not part of the observed evidence set', () => {
  const observation = ambiguousObservation();
  assert.throws(() => buildRsiDevosExperimentPlan({
    observation,
    opportunity_id: 'opp:000000000000000000000000',
  }), /rsi_devos_opportunity_not_found/);
});

test('DevOS bridge refuses an observation that claims execution authority', () => {
  const observation = ambiguousObservation();
  const opportunity = observation.opportunities[0];
  assert.throws(() => buildRsiDevosExperimentPlan({
    observation: { ...observation, execution_authority: true },
    opportunity_id: opportunity.opportunity_id,
  }), /rsi_devos_observation_execution_authority_invalid/);
});
