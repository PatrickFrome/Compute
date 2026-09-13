import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyComputeBridgeFailure, COMPUTE_HEALTH_STATES } from '../src/compute-bridge-client.mjs';
import { FleetProvisioner, classifyFleetReconcileOutcome } from '../src/fleet-provisioner.mjs';
import { normalizeDevelopmentPlaneProjection, projectWorkspaceWorkbench } from '../src/workspace-workbench-projection.mjs';

test('compute health distinguishes startup/config uncertainty from proven offline', () => {
  const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
  assert.deepEqual(classifyComputeBridgeFailure(missing), {
    state: COMPUTE_HEALTH_STATES.STARTING,
    reason_code: 'MANIFEST_NOT_PRESENT',
    outage_proven: false,
  });

  const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1'), { code: 'ECONNREFUSED' });
  assert.deepEqual(classifyComputeBridgeFailure(refused), {
    state: COMPUTE_HEALTH_STATES.OFFLINE,
    reason_code: 'ECONNREFUSED',
    outage_proven: true,
  });

  const timeout = Object.assign(new Error('deadline exceeded'), { name: 'AbortError' });
  const unknown = classifyComputeBridgeFailure(timeout);
  assert.equal(unknown.state, COMPUTE_HEALTH_STATES.UNKNOWN);
  assert.equal(unknown.outage_proven, false);
});

test('canonical Development Plane projection is always materialized', () => {
  const projection = normalizeDevelopmentPlaneProjection(null);
  assert.equal(projection.schema, 'metaengine.development-plane.snapshot.v1');
  assert.equal(projection.state, 'UNKNOWN');
  assert.equal(projection.reason, 'SNAPSHOT_NOT_MATERIALIZED');
  assert.equal(projection.authority_effect, false);

  const workbench = projectWorkspaceWorkbench({
    tabs: { tabs: [] },
    development_plane: null,
    compute: {
      schema: 'metaengine.compute-bridge.health.v2',
      state: 'STARTING',
      available: false,
      outage_proven: false,
      reason_code: 'MANIFEST_NOT_PRESENT',
      authority_effect: false,
    },
  });
  assert.equal(workbench.canonical_development_plane.state, 'UNKNOWN');
  assert.ok(!workbench.devos.attention.some((row) => row.kind === 'COMPUTE_OFFLINE'));
  assert.ok(workbench.devos.attention.some((row) => row.kind === 'COMPUTE_UNAVAILABLE'));
});

test('fleet reconcile classifier ignores volatile telemetry and proves stable no-effect', () => {
  const base = {
    policy: { profile: 'BALANCED', warm_agents: 0, desired_agents: 7, spawn_burst_limit: 8 },
    agents: [{
      agent_id: 'agent_terminal-1', role: 'PLANNER', lifecycle_state: 'RETIRED', tab_id: null, target_id: null,
      generation_epoch: 2, conversation_epoch: 0, updated_at: '2026-09-13T18:00:00.000Z', authority_effect: false,
    }],
    capacity_backpressure: { blocked: false, reason: null, census_probe: { total_tabs: 1 } },
  };
  const after = structuredClone(base);
  after.agents[0].updated_at = '2026-09-13T19:00:00.000Z';
  after.capacity_backpressure.census_probe.total_tabs = 31;
  const classified = classifyFleetReconcileOutcome({ before: base, after, active: false });
  assert.equal(classified.effect_outcome, 'NO_EFFECT_PROVEN');
  assert.equal(classified.semantic_before_sha256, classified.semantic_after_sha256);
  assert.equal(classified.postcondition.satisfied, true);

  const cleaned = classifyFleetReconcileOutcome({ before: base, after, active: false, physical_cleanup_count: 1 });
  assert.equal(cleaned.effect_outcome, 'CONFIRMED');
  assert.equal(cleaned.postcondition.physical_cleanup_count, 1);
});

test('FleetProvisioner reconcile returns NO_EFFECT_PROVEN for zero warm no-op and CONFIRMED for structural change', async () => {
  let persisted = null;
  const noOp = new FleetProvisioner({
    createTab: async () => { throw new Error('unexpected_create_tab'); },
    loadTab: async () => { throw new Error('unexpected_load_tab'); },
    tabExists: () => false,
    loadState: async () => persisted,
    saveState: async (value) => { persisted = structuredClone(value); },
    policy: { profile: 'BALANCED', warm_agents: 0, desired_agents: 0, spawn_burst_limit: 2 },
  });
  await noOp.init();
  const unchanged = await noOp.reconcile({ active: false });
  assert.equal(unchanged.effect_outcome, 'NO_EFFECT_PROVEN');
  assert.equal(unchanged.postcondition.desired_slots, 0);
  assert.equal(unchanged.postcondition.observed_slots, 0);

  persisted = null;
  const changedFleet = new FleetProvisioner({
    createTab: async () => { throw new Error('unexpected_create_tab'); },
    loadTab: async () => { throw new Error('unexpected_load_tab'); },
    tabExists: () => false,
    loadState: async () => persisted,
    saveState: async (value) => { persisted = structuredClone(value); },
    policy: { profile: 'BALANCED', warm_agents: 1, desired_agents: 1, spawn_burst_limit: 2 },
    uuid: () => '12345678-1234-4234-9234-123456789abc',
    clock: () => Date.parse('2026-09-13T19:00:00.000Z'),
  });
  await changedFleet.init();
  const changed = await changedFleet.reconcile({ active: false });
  assert.equal(changed.effect_outcome, 'CONFIRMED');
  assert.equal(changed.postcondition.desired_slots, 1);
  assert.equal(changed.postcondition.observed_slots, 1);
  assert.equal(changed.counts.REGISTERED, 1);
  assert.equal(changed.automatic_retry_allowed, false);
});
