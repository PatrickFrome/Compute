import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { RsiRuntimeService } from '../src/rsi-runtime-service.mjs';
import { RsiOutcomeRiver } from '../src/rsi-outcome-river.mjs';
import {
  FLEET_EXPERIENCE_SIGNAL_SCHEMA,
  deriveFleetExperienceSignal,
} from '../src/fleet-experience-signal.mjs';
import { planElasticFleetCapacity } from '../src/fleet-elastic-governor.mjs';

const SOURCE = 'b'.repeat(40);

// ---------------------------------------------------------------------------
// deriveFleetExperienceSignal — pure projection over the river ring.
// ---------------------------------------------------------------------------

test('fleet experience signal is unavailable and authority-free without river evidence', () => {
  const empty = deriveFleetExperienceSignal({ riverSnapshot: null, fleetSnapshot: null });
  assert.equal(empty.schema, FLEET_EXPERIENCE_SIGNAL_SCHEMA);
  assert.equal(empty.available, false);
  assert.equal(empty.sample_count, 0);
  assert.equal(empty.recent_positive, 0);
  assert.equal(empty.fleet_success_rate, null);
  assert.equal(empty.experience_grace_cycles, 0);
  assert.deepEqual(empty.per_role, {});
  assert.deepEqual(empty.per_agent, {});
  assert.equal(empty.scheduler_authority, false);
  assert.equal(empty.browser_authority, false);
  assert.equal(empty.release_authority, false);
  assert.equal(empty.execution_authority, false);
  assert.equal(empty.authority_effect, false);
  assert.ok(Object.isFrozen(empty));

  const noRing = deriveFleetExperienceSignal({ riverSnapshot: { recent_credits: [] }, fleetSnapshot: { agents: [] } });
  assert.equal(noRing.available, false);
});

test('signal aggregates per-agent and per-role reliability from the credit ring', () => {
  const now = Date.parse('2026-09-20T12:00:00.000Z');
  const riverSnapshot = {
    recent_credits: [
      { at: '2026-09-20T11:50:00.000Z', task_id: 't1', agent_id: 'AGENT_IMPL1', credit: 'POSITIVE' },
      { at: '2026-09-20T11:40:00.000Z', task_id: 't2', agent_id: 'AGENT_IMPL1', credit: 'NEGATIVE' },
      { at: '2026-09-20T11:30:00.000Z', task_id: 't3', agent_id: 'AGENT_IMPL2', credit: 'POSITIVE' },
      { at: '2026-09-20T09:00:00.000Z', task_id: 't4', agent_id: 'AGENT_QA1', credit: 'POSITIVE' }, // outside window
    ],
  };
  const fleetSnapshot = {
    agents: [
      { agent_id: 'agent_impl1', role: 'IMPLEMENTER' },
      { agent_id: 'agent_impl2', role: 'IMPLEMENTER' },
      { agent_id: 'agent_qa1', role: 'VERIFIER' },
    ],
  };
  const signal = deriveFleetExperienceSignal({ riverSnapshot, fleetSnapshot, now });
  assert.equal(signal.available, true);
  assert.equal(signal.sample_count, 4);
  assert.equal(signal.positive_count, 3);
  assert.equal(signal.negative_count, 1);
  assert.equal(signal.recent_positive, 2, 'only positives inside the 60-minute velocity window count');
  assert.equal(signal.fleet_success_rate, 0.75);
  assert.equal(signal.per_agent.agent_impl1.success_rate, 0.5);
  assert.equal(signal.per_agent.agent_impl2.success_rate, 1);
  // Role rollup: IMPLEMENTER 2/3, VERIFIER 1/1 across 1 agent each.
  assert.equal(signal.per_role.IMPLEMENTER.credited, 3);
  assert.equal(signal.per_role.IMPLEMENTER.positive, 2);
  assert.equal(signal.per_role.IMPLEMENTER.success_rate, 0.667);
  assert.equal(signal.per_role.VERIFIER.agent_count, 1);
  assert.equal(signal.per_role.VERIFIER.success_rate, 1);
  // Velocity 2/24 saturation -> grace floor(2/24*4) = 0.
  assert.equal(signal.experience_grace_cycles, 0);
});

test('grace cycles saturate at +4 and unknown credits default to positive sign', () => {
  const now = Date.parse('2026-09-20T12:00:00.000Z');
  const recent = Array.from({ length: 30 }, (_, i) => ({
    at: '2026-09-20T11:59:00.000Z', task_id: `t${i}`, agent_id: 'agent_impl1', credit: 'POSITIVE',
  }));
  const signal = deriveFleetExperienceSignal({ riverSnapshot: { recent_credits: recent }, fleetSnapshot: { agents: [] }, now });
  assert.equal(signal.recent_positive, 30);
  assert.equal(signal.experience_grace_cycles, 4, 'grace is capped at 4 idle cycles');

  const garbageSign = deriveFleetExperienceSignal({
    riverSnapshot: { recent_credits: [{ at: '2026-09-20T11:59:00.000Z', task_id: 'tx', agent_id: 'agent_impl1', credit: 'WHATEVER' }] },
    fleetSnapshot: { agents: [] },
    now,
  });
  assert.equal(garbageSign.positive_count, 1, 'unknown credit sign coerces to POSITIVE, never crashes');
  assert.equal(garbageSign.available, true);
});

// ---------------------------------------------------------------------------
// Governor integration — grace + reliability-ordered retirement.
// ---------------------------------------------------------------------------

function agent(id, state, { created_at = '2026-09-03T10:00:00.000Z', tab_id = null, role = 'IMPLEMENTER' } = {}) {
  return { agent_id: id, role, lifecycle_state: state, tab_id, target_id: tab_id ? 'webcontents:1' : null, generation_epoch: 1, created_at, updated_at: created_at };
}

function fleetSnapshot(agents, policy = {}) {
  return {
    schema: 'metaengine.browser.fleet-snapshot.v1',
    policy: { warm_agents: 2, desired_agents: 6, spawn_burst_limit: 8, ...policy },
    agents,
    counts: {},
    capacity_backpressure: { blocked: false },
  };
}

test('governor without experience keeps the exact pre-T3 idle horizon and flags reliability_informed=false', () => {
  const snap = fleetSnapshot([agent('agent_a1', 'BOUND_UNVERIFIED', { tab_id: 'tab_1' })]);
  const plan = planElasticFleetCapacity({ backlog: { ready: 0, running: 0 }, fleetSnapshot: snap, idleCycles: 2 });
  assert.equal(plan.idle_cycles_required, 3);
  assert.equal(plan.idle_cycles_required_effective, 3);
  assert.equal(plan.experience.reliability_informed, false);
  assert.equal(plan.experience.available, false);
  assert.equal(plan.experience.experience_grace_cycles, 0);
  assert.equal(plan.authority_effect, false);
});

test('experience grace keeps a productive fleet warm past the base idle horizon', () => {
  const snap = fleetSnapshot([
    agent('agent_a1', 'BOUND_UNVERIFIED', { tab_id: 'tab_1', created_at: '2026-09-03T09:00:00.000Z' }),
    agent('agent_a2', 'BOUND_UNVERIFIED', { tab_id: 'tab_2', created_at: '2026-09-03T10:00:00.000Z' }),
  ]);
  const experience = {
    available: true,
    sample_count: 12,
    recent_positive: 12,
    experience_grace_cycles: 2,
    per_role: { IMPLEMENTER: { success_rate: 1 } },
  };
  // Base horizon (3) reached at idleCycles=2 -> next=3, but effective horizon is 5.
  const held = planElasticFleetCapacity({ backlog: { ready: 0, running: 0 }, fleetSnapshot: snap, idleCycles: 2, experience });
  assert.equal(held.idle_cycles, 3);
  assert.equal(held.idle_cycles_required_effective, 5);
  assert.equal(held.scale_down, false, 'grace holds the fleet one more cycle');
  assert.deepEqual([...held.retire_agent_ids], []);
  // Grace exhausted at effective horizon -> retirement proceeds exactly as before.
  const shrink = planElasticFleetCapacity({ backlog: { ready: 0, running: 0 }, fleetSnapshot: snap, idleCycles: 4, experience });
  assert.equal(shrink.idle_cycles, 5);
  assert.equal(shrink.idle_cycles_required_effective, 5);
  assert.equal(shrink.experience.reliability_informed, true);
  assert.equal(shrink.experience.available, true);
  assert.equal(shrink.authority_effect, false, 'experience never becomes an authority effect');
});

test('retirement is ordered by role reliability — worst first, unknown between bands, best keeps its agents', () => {
  const snap = fleetSnapshot([
    agent('agent_good1', 'BOUND_UNVERIFIED', { tab_id: 'tab_1', created_at: '2026-09-03T09:00:00.000Z', role: 'VERIFIER' }),
    agent('agent_bad1', 'BOUND_UNVERIFIED', { tab_id: 'tab_2', created_at: '2026-09-03T10:00:00.000Z', role: 'RESEARCHER' }),
    agent('agent_unknown1', 'BOUND_UNVERIFIED', { tab_id: 'tab_3', created_at: '2026-09-03T11:00:00.000Z', role: 'PLANNER' }),
    agent('agent_bad2', 'BOUND_UNVERIFIED', { tab_id: 'tab_4', created_at: '2026-09-03T12:00:00.000Z', role: 'RESEARCHER' }),
  ]);
  const experience = {
    available: true,
    sample_count: 20,
    recent_positive: 24,
    experience_grace_cycles: 0, // no grace: retire at the base horizon
    per_role: {
      RESEARCHER: { success_rate: 0.2 },
      VERIFIER: { success_rate: 0.95 },
    },
  };
  const plan = planElasticFleetCapacity({ backlog: { ready: 0, running: 0 }, fleetSnapshot: snap, idleCycles: 3, experience });
  assert.equal(plan.idle_cycles, 4);
  assert.equal(plan.scale_down, true);
  // Surplus above warm=2 is 2; the two RESEARCHER agents (worst reliability) retire first,
  // keeping the newest-first order inside the same reliability band (stable sort).
  assert.deepEqual([...plan.retire_agent_ids], ['agent_bad2', 'agent_bad1']);
  // Now bound to 1 retirement: worst role still goes first, unknown beats known-good only when the good one is out of band order.
  const oneSlot = planElasticFleetCapacity({
    backlog: { ready: 0, running: 0 },
    fleetSnapshot: fleetSnapshot(snap.agents, { warm_agents: 3 }),
    idleCycles: 3,
    experience,
  });
  assert.equal(oneSlot.retire_count, 1);
  assert.equal(oneSlot.retire_agent_ids[0], 'agent_bad2', 'worst-reliability role retires before unknown and proven-good roles');
});

test('grace cycles from a malformed experience signal are clamped, never NaN', () => {
  const snap = fleetSnapshot([agent('agent_a1', 'BOUND_UNVERIFIED', { tab_id: 'tab_1' })]);
  const malformed = { available: true, experience_grace_cycles: 99, per_role: 'not-an-object' };
  const plan = planElasticFleetCapacity({ backlog: { ready: 0, running: 0 }, fleetSnapshot: snap, idleCycles: 5, experience: malformed });
  assert.equal(plan.idle_cycles_required_effective, 7, 'grace clamped to 4');
  assert.ok(Number.isFinite(plan.idle_cycles_required_effective));
});

test('reliability re-ranking happens BEFORE the retirement bound — a newest proven-good agent outlives an older worst-role agent', () => {
  // Pre-T3 semantics retire the NEWEST eligible agent first; with reliability
  // evidence the newest (VERIFIER, 0.95) must survive while the older
  // RESEARCHER (0.1) shrinks away — the bound is applied after re-ranking.
  const snap = fleetSnapshot([
    agent('agent_bad_old', 'BOUND_UNVERIFIED', { tab_id: 'tab_1', created_at: '2026-09-03T09:00:00.000Z', role: 'RESEARCHER' }),
    agent('agent_good_new', 'BOUND_UNVERIFIED', { tab_id: 'tab_2', created_at: '2026-09-03T12:00:00.000Z', role: 'VERIFIER' }),
  ]);
  const experience = {
    available: true,
    sample_count: 40,
    experience_grace_cycles: 0,
    per_role: { RESEARCHER: { success_rate: 0.1 }, VERIFIER: { success_rate: 0.95 } },
  };
  const withSignal = planElasticFleetCapacity({ backlog: { ready: 0, running: 0 }, fleetSnapshot: fleetSnapshot(snap.agents, { warm_agents: 1 }), idleCycles: 3, experience });
  assert.equal(withSignal.retire_count, 1);
  assert.equal(withSignal.retire_agent_ids[0], 'agent_bad_old', 'worst-reliability role retires even though it is the oldest');
  // Without the signal the same fleet retires the newest agent — pre-T3 exact.
  const withoutSignal = planElasticFleetCapacity({ backlog: { ready: 0, running: 0 }, fleetSnapshot: fleetSnapshot(snap.agents, { warm_agents: 1 }), idleCycles: 3 });
  assert.deepEqual([...withoutSignal.retire_agent_ids], ['agent_good_new']);
  // An unknown-reliability agent sits between the bands: retires after the
  // worst role but before the proven-good role.
  const three = fleetSnapshot([
    ...snap.agents,
    agent('agent_unknown_mid', 'BOUND_UNVERIFIED', { tab_id: 'tab_3', created_at: '2026-09-03T10:00:00.000Z', role: 'PLANNER' }),
  ]);
  const ranked = planElasticFleetCapacity({ backlog: { ready: 0, running: 0 }, fleetSnapshot: fleetSnapshot(three.agents, { warm_agents: 1 }), idleCycles: 3, experience });
  assert.deepEqual([...ranked.retire_agent_ids].slice(0, 2), ['agent_bad_old', 'agent_unknown_mid'], 'unknown band sits between worst and best');
});

// ---------------------------------------------------------------------------
// River ring — recent_credits durability and snapshot bounding.
// ---------------------------------------------------------------------------

function readbackFor(commandId, { status = 'COMPLETED', effectOutcome = 'CONFIRMED', action = 'SCROLL', platform = 'GLM_ZAI', effectKey = null, executionMs = 12.5 } = {}) {
  return {
    schema: 'metaengine.rsi.result-receipt-readback.v1',
    command_id: commandId,
    found: true,
    terminal: true,
    status,
    receipt: {
      schema: 'metaengine.native-supervisor.command-receipt.v2',
      command_id: commandId,
      action,
      platform,
      result: { ok: true },
      effect_outcome: effectOutcome,
      lane: 'MUTATION',
      effect_key: effectKey,
      execution_ms: executionMs,
      recorded_at: '2026-09-20T10:00:00.000Z',
      authority_effect: false,
    },
    error: null,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

async function creditedEpisode(root, name, { commandId, taskId, agentId, failed = false }) {
  const runtime = new RsiRuntimeService({ source_sha: SOURCE, ledgerPath: path.join(root, `${name}.jsonl`) });
  await runtime.start();
  const river = new RsiOutcomeRiver({ source_sha: SOURCE, statePath: path.join(root, `${name}.jsonl.outcome-river.json`) }).attach(runtime);
  await river.init();
  const command = {
    command_id: commandId,
    action: 'SEMANTIC_TYPE',
    platform: 'GLM_ZAI',
    effect_key: null,
    payload: {
      tab_id: 'tab-1',
      rsi_task: { schema: 'metaengine.rsi.command-task-context.v1', task_id: taskId, agent_id: agentId },
    },
  };
  await river.bindLeasedCommand(command, { environment_fingerprint: 'metaengine-browser-0.7.0' });
  const readback = failed
    ? readbackFor(commandId, { action: 'SEMANTIC_TYPE', status: 'FAILED', effectOutcome: 'PRE_EFFECT_FAILURE' })
    : readbackFor(commandId, { action: 'SEMANTIC_TYPE' });
  const episode = await runtime.ingestBrowserOutcome({ readback, attribution: null });
  assert.equal(episode.eligible_for_credit_assignment, true);
  const credited = await river.creditIngestedEpisode(episode, { environment_fingerprint: 'metaengine-browser-0.7.0' });
  assert.equal(credited.credited, true);
  return { runtime, river };
}

test('credited episodes append to the recent-credits ring with sign and agent attribution', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-fleet-experience-'));
  try {
    const { river } = await creditedEpisode(root, 'ring-pos', {
      commandId: '44444444-4444-4444-8444-444444444444',
      taskId: '550e8400-e29b-41d4-a716-446655440000',
      agentId: 'agent_fleetabcd',
    });
    const snap = river.snapshot();
    assert.equal(snap.recent_credits.length, 1);
    assert.equal(snap.recent_credits[0].task_id, '550e8400-e29b-41d4-a716-446655440000');
    assert.equal(snap.recent_credits[0].agent_id, 'agent_fleetabcd');
    assert.equal(snap.recent_credits[0].credit, 'POSITIVE');
    assert.ok(Object.isFrozen(snap.recent_credits[0]));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('failed episodes land as NEGATIVE credit and the ring survives restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-fleet-experience-'));
  try {
    const taskId = '660e8400-e29b-41d4-a716-446655440000';
    const commandId = '55555555-5555-4555-8555-555555555555';
    await creditedEpisode(root, 'ring-neg', {
      commandId,
      taskId,
      agentId: 'agent_fleetffff',
      failed: true,
    });
    const statePath = path.join(root, 'ring-neg.jsonl.outcome-river.json');
    // Restart: a fresh river instance over the same durable state must reload the ring.
    const runtime2 = new RsiRuntimeService({ source_sha: SOURCE, ledgerPath: path.join(root, 'ring-neg.jsonl') });
    await runtime2.start();
    const river2 = new RsiOutcomeRiver({ source_sha: SOURCE, statePath }).attach(runtime2);
    await river2.init();
    const snap = river2.snapshot();
    assert.equal(snap.recent_credits.length, 1);
    assert.equal(snap.recent_credits[0].credit, 'NEGATIVE');
    assert.equal(snap.recent_credits[0].task_id, taskId);
    // The signal derives from the reloaded ring.
    const signal = deriveFleetExperienceSignal({ riverSnapshot: snap, fleetSnapshot: { agents: [{ agent_id: 'agent_fleetffff', role: 'IMPLEMENTER' }] } });
    assert.equal(signal.available, true);
    assert.equal(signal.sample_count, 1);
    assert.equal(signal.negative_count, 1);
    assert.equal(signal.per_role.IMPLEMENTER.success_rate, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
