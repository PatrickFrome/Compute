import test from 'node:test';
import assert from 'node:assert/strict';
import { FleetProvisioner } from '../src/fleet-provisioner.mjs';

// Operator fleet target persistence (2026-09-21): the operator's explicit
// FLEET_RECONCILE target must survive restarts (self-update, crash, reboot)
// without capturing the DevOS elastic governor's demand-driven plan targets.

function makeProvisioner({ persisted = null, policy = null, existingTabs = [] } = {}) {
  let state = persisted;
  let seq = 0;
  const createdTabs = [];
  const tabs = new Set(existingTabs);
  const p = new FleetProvisioner({
    policy: policy || { profile: 'BALANCED', warm_agents: 0, desired_agents: 0, spawn_burst_limit: 8 },
    clock: (() => { let n = 1788000000000; return () => ++n; })(),
    uuid: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    loadState: async () => state,
    saveState: async (value) => { state = structuredClone(value); },
    tabExists: (tabId) => tabs.has(String(tabId)),
    createTab: async ({ url, select, load, ownership }) => {
      const tabId = `tab_created_${String(++seq).padStart(4, '0')}`;
      createdTabs.push({ tabId, url, ownership });
      tabs.add(tabId);
      return { tab_id: tabId };
    },
    loadTab: async () => {},
  });
  return { p, createdTabs, state: () => structuredClone(state), tabs };
}

const stateWithBootTarget = (bootFleetTarget, agents = []) => ({
  schema: 'metaengine.browser.fleet-state.v1',
  version: '1.5.0',
  policy: { profile: 'BALANCED', warm_agents: 0, desired_agents: 0, boot_fleet_target: bootFleetTarget },
  agents,
  updated_at: new Date().toISOString(),
});

test('operator target set via FLEET_RECONCILE persists as boot_fleet_target and lifts desired', async () => {
  const h = makeProvisioner();
  await h.p.init();
  await h.p.setOperatorFleetTarget(10);
  const snap = h.p.snapshot();
  assert.equal(snap.policy.boot_fleet_target, 10);
  assert.equal(snap.policy.desired_agents, 10);
  // persisted file carries the operator seed
  assert.equal(h.state().policy.boot_fleet_target, 10);
});

test('operator target 0 clears the boot seed (historical fail-safe boot posture)', async () => {
  const h = makeProvisioner({ persisted: stateWithBootTarget(10) });
  await h.p.init();
  assert.equal(h.p.snapshot().policy.boot_fleet_target, 10);
  await h.p.setOperatorFleetTarget(0);
  assert.equal(h.p.snapshot().policy.boot_fleet_target, 0);
  assert.equal(h.state().policy.boot_fleet_target, 0);
});

test('governor-style desired overwrite never captures or clears the boot seed', async () => {
  const h = makeProvisioner({ persisted: stateWithBootTarget(10) });
  await h.p.init();
  await h.p.setTargetAgents(4); // what a demand-driven plan would persist
  const snap = h.p.snapshot();
  assert.equal(snap.policy.desired_agents, 4);
  assert.equal(snap.policy.boot_fleet_target, 10, 'boot seed must survive governor writes');
  assert.equal(h.state().policy.boot_fleet_target, 10);
});

test('restart restores the operator fleet: loaded boot target lifts startup desired and boot reconcile spawns fresh agents', async () => {
  // After a restart every pre-restart agent is restart-stale LOST (its tab died
  // with the process). Restart-stale rows occupy NO slots, so the boot restore
  // spawns a FRESH fleet up to the recorded operator target.
  const stale = (agentId) => ({
    agent_id: agentId,
    role: 'PLANNER',
    ownership: 'FLEET_OWNED',
    lifecycle_state: 'LOST',
    tab_id: `tab_dead_${agentId.slice(-6)}`,
    target_id: null,
    conversation_epoch: 0,
    generation_epoch: 3,
    created_at: '2026-09-21T04:00:00.000Z',
    updated_at: '2026-09-21T04:00:00.000Z',
    lost_reason: 'RESTART_STALE_PHYSICAL_TAB_ABSENT',
    ambiguous_reason: null,
    transport_proof: null,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
  const h = makeProvisioner({
    persisted: stateWithBootTarget(3, [stale('agent_aaaabbbb-0000-4000-8000-000000000001'), stale('agent_aaaabbbb-0000-4000-8000-000000000002')]),
    policy: { profile: 'BALANCED', warm_agents: 0, desired_agents: 0, spawn_burst_limit: 8 },
  });
  await h.p.init();
  const afterInit = h.p.snapshot();
  assert.equal(afterInit.policy.boot_fleet_target, 3, 'boot seed survives the startup policy replacement');
  assert.equal(afterInit.policy.desired_agents, 3, 'startup desired is lifted to the operator seed');

  // the boot reconcile issued by main.mjs when boot_fleet_target > 0
  const bootTarget = afterInit.policy.boot_fleet_target;
  await h.p.reconcile({ active: bootTarget > 0, target_agents: bootTarget > 0 ? bootTarget : null });
  const snap = h.p.snapshot();
  assert.equal(snap.counts.REGISTERED + snap.counts.PROVISIONING + snap.counts.BOUND_UNVERIFIED + snap.counts.ACTIVE, 3, 'fresh fleet fills the operator target');
  assert.ok(h.createdTabs.length >= 1, 'physical tabs are created for the restored fleet');
  assert.ok(h.createdTabs.every((t) => t.ownership === 'FLEET_OWNED'));
});

test('no persisted file keeps the historical fail-safe posture (no auto-grow)', async () => {
  const h = makeProvisioner({ persisted: null });
  await h.p.init();
  assert.equal(h.p.snapshot().policy.boot_fleet_target, 0);
  assert.equal(h.p.snapshot().policy.desired_agents, 0);
});

test('invalid boot seeds and targets clamp into the [0,64] band without throwing', async () => {
  const h = makeProvisioner({ persisted: stateWithBootTarget(9999) });
  await h.p.init();
  assert.equal(h.p.snapshot().policy.boot_fleet_target, 64, 'out-of-range persisted seed clamps to the hard ceiling');
  const garbage = makeProvisioner({ persisted: stateWithBootTarget('not-a-number') });
  await garbage.p.init();
  assert.equal(garbage.p.snapshot().policy.boot_fleet_target, 0, 'garbage seed clamps to 0 (no auto-grow)');
  await h.p.setOperatorFleetTarget(-5);
  assert.equal(h.p.snapshot().policy.boot_fleet_target, 0);
  await h.p.setOperatorFleetTarget(Number.NaN);
  assert.equal(h.p.snapshot().policy.boot_fleet_target, 0);
  await h.p.setOperatorFleetTarget(64);
  assert.equal(h.p.snapshot().policy.boot_fleet_target, 64);
  await h.p.setOperatorFleetTarget(65);
  assert.equal(h.p.snapshot().policy.boot_fleet_target, 64, 'targets clamp at the hard 64 ceiling');
});
