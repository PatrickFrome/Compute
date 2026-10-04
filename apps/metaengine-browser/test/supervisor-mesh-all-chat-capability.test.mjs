import test from 'node:test';
import assert from 'node:assert/strict';
import { SupervisorMesh, supervisorInstanceIdForUrl } from '../src/supervisor-mesh.mjs';

function harness() {
  let durable = null;
  let now = Date.parse('2026-09-02T12:00:00.000Z');
  let seq = 0;
  const mesh = new SupervisorMesh({
    loadState: async () => durable,
    saveState: async (next) => { durable = structuredClone(next); },
    clock: () => now++,
    uuid: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
  });
  return { mesh, durable: () => structuredClone(durable) };
}

test('fleet chat remains a supervisor-capable mesh peer but is fenced from automatic coordination', async () => {
  const { mesh } = harness();
  await mesh.init();
  const fleetUrl = 'https://chatgpt.com/c/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const supervisorUrl = 'https://chatgpt.com/c/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const snapshot = await mesh.reconcile({
    tabs: [
      { tab_id: 'tab_fleet', url: fleetUrl, selected: true },
      { tab_id: 'tab_supervisor', url: supervisorUrl, selected: false },
    ],
    fleetAgents: [
      { agent_id: 'agent_fleet', tab_id: 'tab_fleet', lifecycle_state: 'ACTIVE' },
    ],
  });
  const fleet = snapshot.supervisors.find((row) => row.supervisor_id === supervisorInstanceIdForUrl(fleetUrl));
  assert.ok(fleet);
  assert.equal(fleet.status, 'ACTIVE');
  assert.equal(fleet.supervisor_capable, true);
  assert.equal(fleet.fleet_bound, true);
  assert.equal(fleet.coordination_blocked, true);
  assert.equal(fleet.control_policy, 'SUPABASE_SHARED_LEASE_REQUIRED');
  assert.equal(snapshot.all_canonical_chats_supervisor_capable, true);
  assert.equal(snapshot.direct_parallel_actuation, false);
  assert.equal(snapshot.actuation_policy, 'SUPABASE_SHARED_LEASE_REQUIRED');

  const reserved = await mesh.reserveCoordination({ eventKey: 'all-chat-capability:1' });
  assert.equal(reserved.ok, true);
  assert.equal(reserved.deliveries[0].tab_id, 'tab_supervisor');
});

test('a fleet-only mesh exposes control capability but cannot self-interrupt with coordinator wake', async () => {
  const { mesh } = harness();
  await mesh.init();
  const snapshot = await mesh.reconcile({
    tabs: [{ tab_id: 'tab_fleet', url: 'https://chatgpt.com/c/cccccccc-cccc-4ccc-8ccc-cccccccccccc', selected: true }],
    fleetAgents: [{ agent_id: 'agent_fleet', tab_id: 'tab_fleet', lifecycle_state: 'ACTIVE' }],
  });
  assert.equal(snapshot.counts.supervisor_capable, 1);
  assert.equal(snapshot.counts.coordination_eligible, 0);
  const reserved = await mesh.reserveCoordination({ eventKey: 'all-chat-capability:2' });
  assert.deepEqual(reserved, { ok: false, reason: 'NO_ELIGIBLE_SUPERVISOR', deliveries: [], authority_effect: false });
});

test('duplicate physical incarnations of one conversation remain ambiguous even when one is fleet-bound', async () => {
  const { mesh } = harness();
  await mesh.init();
  const url = 'https://chatgpt.com/c/dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const snapshot = await mesh.reconcile({
    tabs: [
      { tab_id: 'tab_one', url, selected: true },
      { tab_id: 'tab_two', url, selected: false },
    ],
    fleetAgents: [{ agent_id: 'agent_fleet', tab_id: 'tab_one', lifecycle_state: 'ACTIVE' }],
  });
  assert.equal(snapshot.supervisors.length, 1);
  assert.equal(snapshot.supervisors[0].status, 'AMBIGUOUS_INCARNATION');
  assert.equal(snapshot.supervisors[0].tab_id, null);
  assert.equal(snapshot.supervisors[0].supervisor_capable, true);
  assert.equal(snapshot.supervisors[0].fleet_bound, true);
  assert.equal(snapshot.supervisors[0].coordination_blocked, true);
  assert.equal(snapshot.counts.coordination_eligible, 0);
});
