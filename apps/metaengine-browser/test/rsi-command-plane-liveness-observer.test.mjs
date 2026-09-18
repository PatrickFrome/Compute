import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRsiDevosExperimentPlan } from '../src/rsi-devos-experiment-plan.mjs';
import {
  RSI_COMMAND_PLANE_LIVENESS_INPUT_SCHEMA,
  RsiCommandPlaneLivenessObserver,
} from '../src/rsi-command-plane-liveness-observer.mjs';

const SOURCE_SHA = 'b71075d3534fd2cd4709c5ad17fd7d47f60c545f';

function baseSnapshot(overrides = {}) {
  return {
    schema: RSI_COMMAND_PLANE_LIVENESS_INPUT_SCHEMA,
    observed_at: '2026-09-17T10:41:40.000Z',
    heartbeat_at: '2026-09-17T10:41:35.000Z',
    perception_at: '2026-09-17T10:41:36.000Z',
    command_progress_at: '2026-09-17T05:09:49.879Z',
    pending_command_count: 5,
    active_command: {
      command_id: 'd5d24937-c7e6-4ce1-bf93-134495b1d039',
      action: 'SCROLL',
      command_lane: 'TAB_MUTATION',
      status: 'LEASED',
      leased_at: '2026-09-17T05:09:48.211Z',
      effect_bound_at: '2026-09-17T05:09:49.879Z',
      receipt_recorded_at: null,
    },
    command_payload_exposed: false,
    page_text_exposed: false,
    input_values_exposed: false,
    raw_network_exposed: false,
    execution_authority: false,
    production_mutation_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
    ...overrides,
  };
}

test('production-derived L1 evidence becomes zero-authority result-delivery and zombie-supervisor opportunities', () => {
  const observation = new RsiCommandPlaneLivenessObserver({ source_sha: SOURCE_SHA }).observe(baseSnapshot());
  const signals = observation.opportunities.map((entry) => entry.signal);

  assert.equal(observation.heartbeat_fresh, true);
  assert.equal(observation.perception_fresh, true);
  assert.equal(observation.command_stalled, true);
  assert.equal(observation.result_delivery_stalled_after_effect_binding, true);
  assert.ok(signals.includes('RESULT_DELIVERY_STALL_AFTER_EFFECT_BINDING'));
  assert.ok(signals.includes('COMMAND_PLANE_STALL_WITH_HEALTHY_HEARTBEAT'));
  assert.equal(observation.active_command.effect_bound, true);
  assert.equal(observation.active_command.receipt_recorded, false);
  assert.equal(observation.command_payload_consumed, false);
  assert.equal(observation.execution_authority, false);
  assert.equal(observation.automatic_retry_allowed, false);
  assert.match(observation.observation_digest, /^[0-9a-f]{64}$/);
  assert.ok(observation.opportunities.every((entry) => entry.automatic_retry_allowed === false));
  assert.ok(observation.opportunities.every((entry) => entry.authority_effect === false));
});

test('L1 opportunity flows into existing DevOS as pre-lease experiment intent only', () => {
  const observation = new RsiCommandPlaneLivenessObserver({ source_sha: SOURCE_SHA }).observe(baseSnapshot());
  const opportunity = observation.opportunities.find((entry) => entry.signal === 'RESULT_DELIVERY_STALL_AFTER_EFFECT_BINDING');
  const plan = buildRsiDevosExperimentPlan({ observation, opportunity_id: opportunity.opportunity_id });

  assert.equal(plan.source_sha, SOURCE_SHA);
  assert.equal(plan.lease_created, false);
  assert.equal(plan.workspace_bound, false);
  assert.equal(plan.command_created, false);
  assert.equal(plan.execution_authority, false);
  assert.equal(plan.self_update_authority, false);
  assert.ok(plan.task_spec.constraints.includes('result_delivery_retry_must_not_reexecute_effect'));
  assert.ok(plan.task_spec.constraints.includes('ambiguous_effect_reconciliation_before_followup_mutation'));
  assert.match(plan.target_branch, /^work\/rsi\/result-delivery-stall-after-effect-binding-b71075d3-[0-9a-f]{8}$/);
});

test('fresh command progress does not create a stall opportunity', () => {
  const observation = new RsiCommandPlaneLivenessObserver({ source_sha: SOURCE_SHA }).observe(baseSnapshot({
    observed_at: '2026-09-17T10:41:40.000Z',
    command_progress_at: '2026-09-17T10:41:35.000Z',
    active_command: {
      command_id: 'cmd-fresh',
      action: 'SCROLL',
      command_lane: 'TAB_MUTATION',
      status: 'LEASED',
      leased_at: '2026-09-17T10:41:34.000Z',
      effect_bound_at: '2026-09-17T10:41:35.000Z',
      receipt_recorded_at: null,
    },
  }));
  assert.equal(observation.command_stalled, false);
  assert.deepEqual(observation.opportunities, []);
});

test('stale heartbeat does not misclassify the process as healthy-heartbeat command-plane stall', () => {
  const observation = new RsiCommandPlaneLivenessObserver({ source_sha: SOURCE_SHA }).observe(baseSnapshot({
    heartbeat_at: '2026-09-17T10:30:00.000Z',
  }));
  const signals = observation.opportunities.map((entry) => entry.signal);
  assert.equal(observation.heartbeat_fresh, false);
  assert.ok(signals.includes('RESULT_DELIVERY_STALL_AFTER_EFFECT_BINDING'));
  assert.ok(!signals.includes('COMMAND_PLANE_STALL_WITH_HEALTHY_HEARTBEAT'));
});

test('observer rejects authority-bearing, private, or temporally impossible liveness projections', () => {
  const observer = new RsiCommandPlaneLivenessObserver({ source_sha: SOURCE_SHA });
  assert.throws(() => observer.observe(baseSnapshot({ automatic_retry_allowed: true })), /rsi_liveness_automatic_retry_invalid/);
  assert.throws(() => observer.observe(baseSnapshot({ command_payload_exposed: true })), /rsi_liveness_command_payload_exposed_invalid/);
  assert.throws(() => observer.observe(baseSnapshot({ heartbeat_at: '2026-09-17T10:50:00.000Z' })), /rsi_liveness_heartbeat_at_future_timestamp/);
});

test('observer requires exact source SHA and bounded thresholds', () => {
  assert.throws(() => new RsiCommandPlaneLivenessObserver({ source_sha: 'release/self-update-ambiguity-live-v2' }), /rsi_liveness_exact_source_sha_required/);
  assert.throws(() => new RsiCommandPlaneLivenessObserver({ source_sha: SOURCE_SHA, command_stall_ms: 86_400_000 }), /rsi_liveness_command_stall_ms_invalid/);
});
