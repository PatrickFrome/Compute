import test from 'node:test';
import assert from 'node:assert/strict';
import { FleetProvisioner } from '../src/fleet-provisioner.mjs';

// Census-gated capacity (W3): the provisioner must adopt the deterministic
// pre-effect no-op posture from a read-only census WITHOUT attempting a doomed
// createTab, and must release exactly like the physical-close contract does.

function harness({ census, errorMessage = 'tab_capacity_exceeded' } = {}) {
  let state = null;
  let createAttempts = 0;
  let seq = 0;
  const p = new FleetProvisioner({
    policy: { warm_agents: 1, desired_agents: 4, profile: 'BALANCED' },
    clock: (() => { let n = 1788000000000; return () => ++n; })(),
    uuid: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    loadState: async () => state,
    saveState: async (value) => { state = structuredClone(value); },
    tabExists: () => true,
    census,
    createTab: async () => { createAttempts += 1; throw new Error(errorMessage); },
    loadTab: async () => {},
  });
  return { p, attempts: () => createAttempts };
}

test('census at the fleet ceiling blocks provisioning without any createTab attempt', async () => {
  const h = harness({ census: () => ({ total_tabs: 20, max_tabs: 32, by_role: { USER: 4, FLEET: 16 }, fleet_tab_ceiling: 16 }) });
  await h.p.init();
  const snap = await h.p.reconcile({ active: true });
  assert.equal(h.attempts(), 0, 'the census is evidence enough — no doomed create');
  assert.equal(snap.capacity_backpressure.blocked, true);
  assert.equal(snap.capacity_backpressure.deterministic_no_effect, true);
  assert.equal(snap.capacity_backpressure.automatic_retry_allowed, false);
  assert.equal(snap.capacity_backpressure.census_probe.fleet_tabs, 16);
  assert.equal(snap.capacity_backpressure.census_probe.fleet_at_ceiling, true);
  assert.equal(snap.counts.PROVISIONING_AMBIGUOUS, 0);
  assert.equal(snap.capacity_backpressure.authority_effect, false);
});

test('census at the shared wall (fleet below ceiling) blocks provisioning too', async () => {
  const h = harness({ census: () => ({ total_tabs: 32, max_tabs: 32, by_role: { USER: 28, FLEET: 4 }, fleet_tab_ceiling: 16 }) });
  await h.p.init();
  const snap = await h.p.reconcile({ active: true });
  assert.equal(h.attempts(), 0);
  assert.equal(snap.capacity_backpressure.blocked, true);
  assert.equal(snap.capacity_backpressure.census_probe.total_at_wall, true);
});

test('census evidence re-blocks after a physical close only if capacity is still full', async () => {
  let fleetTabs = 16;
  const h = harness({ census: () => ({ total_tabs: 20 + (16 - fleetTabs), max_tabs: 32, by_role: { USER: 4, FLEET: fleetTabs }, fleet_tab_ceiling: 16 }) });
  await h.p.init();
  await h.p.reconcile({ active: true });
  assert.equal(h.attempts(), 0);
  // A physical close clears the backpressure latch (unchanged contract)...
  await h.p.onTabClosed('tab_closed', 'PHYSICAL_TAB_CLOSED');
  assert.equal(h.p.snapshot().capacity_backpressure.blocked, false);
  // ...but the census still proves the ceiling, so the next pass re-blocks
  // WITHOUT attempting (learn-by-read, not learn-by-failed-attempt).
  await h.p.reconcile({ active: true });
  assert.equal(h.attempts(), 0);
  assert.equal(h.p.snapshot().capacity_backpressure.blocked, true);
  // When census headroom genuinely appears, provisioning may attempt again.
  fleetTabs = 15;
  await h.p.onTabClosed('tab_closed_2', 'PHYSICAL_TAB_CLOSED');
  const snap = await h.p.reconcile({ active: true });
  assert.equal(h.attempts(), 1, 'capacity headroom proven by census permits one bounded attempt');
  assert.equal(snap.capacity_backpressure.census_probe.fleet_tabs, 15);
  assert.equal(snap.capacity_backpressure.census_probe.fleet_at_ceiling, false);
});

test('a census reporting headroom does not gate provisioning (fallback to real attempts)', async () => {
  const h = harness({ census: () => ({ total_tabs: 8, max_tabs: 32, by_role: { USER: 5, FLEET: 3 }, fleet_tab_ceiling: 16 }) });
  await h.p.init();
  await h.p.reconcile({ active: true });
  assert.ok(h.attempts() > 0, 'headroom means the pass learns capacity the old way — by attempting');
});

test('malformed or throwing census degrades to null (never blocks, never throws)', async () => {
  for (const bad of [
    () => null,
    () => ({ total_tabs: 'many' }),
    () => { throw new Error('census transport down'); },
    () => ({ total_tabs: 10, max_tabs: 32, by_role: { FLEET: 2 }, fleet_tab_ceiling: 99 }), // ceiling > wall -> malformed
  ]) {
    const h = harness({ census: bad });
    await h.p.init();
    const snap = await h.p.reconcile({ active: true });
    assert.equal(snap.capacity_backpressure.census_probe, null);
    assert.ok(h.attempts() > 0, 'degraded census falls back to attempt-based learning');
  }
});

test('non-function census dependency is rejected at construction', () => {
  assert.throws(() => new FleetProvisioner({
    createTab: async () => ({}), loadTab: async () => {}, tabExists: () => true,
    loadState: async () => null, saveState: async () => {}, census: 'not-a-function',
  }), /fleet_census_dependency_invalid/);
});

test('RETIRED history is pruned to the newest 64 rows on restart; ambiguous evidence is never pruned', async () => {
  const now = new Date().toISOString();
  const retiredRows = [];
  for (let i = 0; i < 80; i += 1) {
    const id = `agent_00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
    retiredRows.push({
      agent_id: id, role: 'WORKER', ownership: 'FLEET_OWNED', lifecycle_state: 'RETIRED',
      tab_id: null, target_id: null, conversation_epoch: 0, generation_epoch: 2,
      created_at: new Date(1788000000000 + i).toISOString(),
      updated_at: new Date(1788000000000 + i).toISOString(),
      lost_reason: 'TAB_CAPACITY_EXCEEDED_PRE_EFFECT', ambiguous_reason: null,
      transport_proof: null, automatic_retry_allowed: false, authority_effect: false,
    });
  }
  const ambiguousRow = {
    agent_id: 'agent_00000000-0000-4000-8000-000000099', role: 'WORKER', ownership: 'FLEET_OWNED',
    lifecycle_state: 'PROVISIONING_AMBIGUOUS', tab_id: 'tab_x', target_id: null,
    conversation_epoch: 0, generation_epoch: 1, created_at: now, updated_at: now,
    lost_reason: null, ambiguous_reason: 'CREATE_TAB_AMBIGUOUS:transport_disconnected_mid_create',
    transport_proof: null, automatic_retry_allowed: false, authority_effect: false,
  };
  let state = {
    schema: 'metaengine.browser.fleet-state.v1',
    version: '1.4.2',
    policy: { profile: 'BALANCED', warm_agents: 1, desired_agents: 2 },
    agents: [...retiredRows, ambiguousRow],
    updated_at: now,
  };
  let seq = 1000;
  const p = new FleetProvisioner({
    policy: { warm_agents: 1, desired_agents: 2, profile: 'BALANCED' },
    clock: (() => { let n = 1788000000000; return () => ++n; })(),
    uuid: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    loadState: async () => state,
    saveState: async (value) => { state = structuredClone(value); },
    tabExists: () => true,
    createTab: async () => { throw new Error('unused'); },
    loadTab: async () => {},
  });
  const snap = await p.init();
  assert.equal(snap.counts.RETIRED, 64, 'RETIRED history is bounded to 64 rows on load');
  assert.equal(snap.counts.PROVISIONING_AMBIGUOUS, 1, 'ambiguous evidence is fenced and never pruned');
  const kept = snap.agents.filter((a) => a.lifecycle_state === 'RETIRED').map((a) => a.agent_id);
  assert.ok(!kept.includes('agent_00000000-0000-4000-8000-000000000001'), 'the oldest rows are the ones dropped');
  assert.ok(kept.includes('agent_00000000-0000-4000-8000-000000000080'), 'the newest rows survive');
});
