import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SupervisorMesh,
  normalizeSupervisorConversationUrl,
  supervisorInstanceIdForUrl,
} from '../src/supervisor-mesh.mjs';

function harness() {
  let persisted = null;
  let now = Date.parse('2026-08-30T06:00:00.000Z');
  let seq = 0;
  const mesh = new SupervisorMesh({
    loadState: async () => persisted,
    saveState: async (value) => { persisted = structuredClone(value); },
    clock: () => now,
    uuid: () => `00000000-0000-0000-0000-${String(++seq).padStart(12, '0')}`,
  });
  return {
    mesh,
    tick(ms = 1000) { now += ms; },
    persisted: () => structuredClone(persisted),
  };
}

const A = 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const B = 'https://chatgpt.com/c/11111111-2222-3333-4444-555555555555';

function tabs(...rows) {
  return rows.map(([tab_id, url, selected = false]) => ({ tab_id, url, selected }));
}

test('canonical conversation identity is stable and strips query/hash without accepting non-conversation pages', () => {
  assert.equal(normalizeSupervisorConversationUrl(`${A}?foo=bar#x`), A);
  assert.equal(supervisorInstanceIdForUrl(`${A}?foo=bar`), supervisorInstanceIdForUrl(A));
  assert.throws(() => normalizeSupervisorConversationUrl('https://example.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'), /origin_invalid/);
  assert.throws(() => normalizeSupervisorConversationUrl('https://chatgpt.com/'), /path_invalid/);
});

test('mesh discovers multiple non-fleet supervisors and keeps one preferred without deleting peers', async () => {
  const h = harness();
  await h.mesh.init();
  await h.mesh.reconcile({
    tabs: tabs(['tab-a', A, false], ['tab-b', B, true], ['fleet-tab', 'https://chatgpt.com/c/99999999-9999-9999-9999-999999999999', false]),
    fleetAgents: [{ tab_id: 'fleet-tab' }],
  });
  const snap = h.mesh.snapshot();
  assert.equal(snap.counts.active, 2);
  assert.equal(snap.counts.total, 2);
  assert.equal(snap.preferred_supervisor_id, supervisorInstanceIdForUrl(B));
  assert.equal(h.mesh.preferredSupervisor().tab_id, 'tab-b');

  await h.mesh.prefer({ tab_id: 'tab-a' });
  assert.equal(h.mesh.snapshot().preferred_supervisor_id, supervisorInstanceIdForUrl(A));
  assert.equal(h.mesh.snapshot().counts.active, 2);
});

test('same conversation in two physical tabs becomes ambiguous and cannot be selected', async () => {
  const h = harness();
  await h.mesh.init();
  await h.mesh.reconcile({ tabs: tabs(['tab-a1', A, true], ['tab-a2', A, false]) });
  const snap = h.mesh.snapshot();
  assert.equal(snap.counts.ambiguous_incarnation, 1);
  assert.equal(snap.counts.active, 0);
  const row = snap.supervisors[0];
  assert.equal(row.status, 'AMBIGUOUS_INCARNATION');
  assert.equal(row.tab_id, null);
  assert.deepEqual(new Set(row.tab_incarnations), new Set(['tab-a1', 'tab-a2']));
  await assert.rejects(h.mesh.prefer({ supervisor_id: row.supervisor_id }), /not_active/);
});

test('fanout uses one mesh event with independently bound deliveries', async () => {
  const h = harness();
  await h.mesh.init();
  await h.mesh.reconcile({ tabs: tabs(['tab-a', A, true], ['tab-b', B, false]) });
  const prepared = await h.mesh.reserveWakeTargets({ reason: 'CI_TERMINAL', metadata: { run_id: 42 }, fanout: 2 });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.deliveries.length, 2);
  assert.equal(new Set(prepared.deliveries.map((row) => row.pending.event_id)).size, 1);
  assert.equal(new Set(prepared.deliveries.map((row) => row.pending.delivery_id)).size, 2);
  assert.match(prepared.deliveries[0].message, /shared Supabase actuation lease/);
  assert.match(prepared.deliveries[0].message, /multi-supervisor METAENGINE mesh/);
});

test('ambiguous send on one supervisor blocks only that delivery, not an independent peer', async () => {
  const h = harness();
  await h.mesh.init();
  await h.mesh.reconcile({ tabs: tabs(['tab-a', A, true], ['tab-b', B, false]) });
  const prepared = await h.mesh.reserveWakeTargets({ reason: 'WORKER_FAILED', fanout: 2 });
  const [one, two] = prepared.deliveries;

  await h.mesh.markDeliveryAmbiguous(one.supervisor_id, one.pending.delivery_id, 'SEND_WITHOUT_POSITIVE_READBACK');
  let snap = h.mesh.snapshot();
  const rowOne = snap.supervisors.find((row) => row.supervisor_id === one.supervisor_id);
  const rowTwo = snap.supervisors.find((row) => row.supervisor_id === two.supervisor_id);
  assert.ok(rowOne.ambiguous_delivery);
  assert.ok(rowTwo.pending_delivery);

  await h.mesh.confirmDelivery(two.supervisor_id, two.pending.delivery_id);
  snap = h.mesh.snapshot();
  assert.ok(snap.supervisors.find((row) => row.supervisor_id === one.supervisor_id).ambiguous_delivery);
  assert.equal(snap.supervisors.find((row) => row.supervisor_id === two.supervisor_id).pending_delivery, null);

  await assert.rejects(
    h.mesh.confirmDelivery(one.supervisor_id, one.pending.delivery_id),
    /delivery_binding_mismatch/,
  );
  await h.mesh.resolveDeliveryAmbiguity(one.supervisor_id, { observed_sent: false });
  assert.equal(h.mesh.snapshot().supervisors.find((row) => row.supervisor_id === one.supervisor_id).ambiguous_delivery, null);
});

test('lost peer remains persisted for recovery while another live peer continues', async () => {
  const h = harness();
  await h.mesh.init();
  await h.mesh.reconcile({ tabs: tabs(['tab-a', A, true], ['tab-b', B, false]) });
  h.tick();
  await h.mesh.reconcile({ tabs: tabs(['tab-b', B, true]) });
  const snap = h.mesh.snapshot();
  assert.equal(snap.counts.active, 1);
  assert.equal(snap.counts.lost, 1);
  assert.equal(h.mesh.preferredSupervisor().tab_id, 'tab-b');
  const lost = snap.supervisors.find((row) => row.conversation_url === A);
  assert.equal(lost.status, 'LOST');
  assert.equal(lost.tab_id, null);
});

test('pause is explicit and resume requires one exact live tab incarnation', async () => {
  const h = harness();
  await h.mesh.init();
  await h.mesh.reconcile({ tabs: tabs(['tab-a', A, true]) });
  const id = supervisorInstanceIdForUrl(A);
  await h.mesh.pause(id);
  assert.equal(h.mesh.snapshot().supervisors[0].status, 'PAUSED');
  await h.mesh.resume(id);
  assert.equal(h.mesh.snapshot().supervisors[0].status, 'ACTIVE');

  await h.mesh.reconcile({ tabs: tabs(['tab-a1', A, true], ['tab-a2', A, false]) });
  await h.mesh.pause(id);
  await assert.rejects(h.mesh.resume(id), /exact_live_incarnation/);
});
