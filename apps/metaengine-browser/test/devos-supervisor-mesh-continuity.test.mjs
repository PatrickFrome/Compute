import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SupervisorMesh, supervisorInstanceIdForUrl } from '../src/supervisor-mesh.mjs';
import { SupervisorMeshRuntime } from '../src/supervisor-mesh-runtime.mjs';

const A = 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const B = 'https://chatgpt.com/c/bbbbbbbb-1111-2222-3333-444444444444';
const F = 'https://chatgpt.com/c/ffffffff-1111-2222-3333-444444444444';

function meshHarness() {
  let stored = null;
  let seq = 0;
  const mesh = new SupervisorMesh({
    loadState: async () => structuredClone(stored),
    saveState: async (next) => { stored = structuredClone(next); },
    uuid: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    clock: () => Date.parse('2026-08-30T11:00:00Z'),
  });
  return { mesh, state: () => structuredClone(stored) };
}

test('discovers every canonical conversation while fleet chats remain coordination-fenced', async () => {
  const h = meshHarness();
  await h.mesh.init();
  await h.mesh.reconcile({
    tabs: [
      { tab_id: 'tabA', url: A, selected: true },
      { tab_id: 'tabB', url: B, selected: false },
      { tab_id: 'tabF', url: F, selected: false },
    ],
    fleetAgents: [{ agent_id: 'agentF', tab_id: 'tabF' }],
  });
  const snap = h.mesh.snapshot();
  assert.equal(snap.counts.active, 3);
  assert.equal(snap.counts.supervisor_capable, 3);
  assert.equal(snap.counts.coordination_eligible, 2);
  const fleet = snap.supervisors.find((row) => row.conversation_url === F);
  assert.ok(fleet);
  assert.equal(fleet.supervisor_capable, true);
  assert.equal(fleet.fleet_bound, true);
  assert.equal(fleet.coordination_blocked, true);
  assert.equal(fleet.control_policy, 'SUPABASE_SHARED_LEASE_REQUIRED');
  assert.equal(snap.coordinator_supervisor_id, supervisorInstanceIdForUrl(A));
});

test('lost coordinator fails over to standby without changing conversation identity', async () => {
  const h = meshHarness();
  await h.mesh.init();
  await h.mesh.reconcile({ tabs: [{ tab_id: 'tabA', url: A, selected: true }, { tab_id: 'tabB', url: B }] });
  const first = h.mesh.snapshot().coordinator_supervisor_id;
  assert.equal(first, supervisorInstanceIdForUrl(A));
  await h.mesh.reconcile({ tabs: [{ tab_id: 'tabB', url: B, selected: true }] });
  const snap = h.mesh.snapshot();
  assert.equal(snap.coordinator_supervisor_id, supervisorInstanceIdForUrl(B));
  assert.equal(snap.supervisors.find((row) => row.supervisor_id === first)?.status, 'LOST');
  assert.ok(snap.mesh_epoch >= 2);
});

test('duplicate physical incarnation fails closed and is never coordinator eligible', async () => {
  const h = meshHarness();
  await h.mesh.init();
  await h.mesh.reconcile({
    tabs: [
      { tab_id: 'tabA1', url: A, selected: true },
      { tab_id: 'tabA2', url: A },
      { tab_id: 'tabB', url: B },
    ],
  });
  const a = h.mesh.snapshot().supervisors.find((row) => row.conversation_url === A);
  assert.equal(a.status, 'AMBIGUOUS_INCARNATION');
  assert.equal(a.tab_id, null);
  assert.equal(h.mesh.snapshot().coordinator_supervisor_id, supervisorInstanceIdForUrl(B));
});

test('one coordination event routes to exactly one peer and duplicate event key never replays', async () => {
  const h = meshHarness();
  await h.mesh.init();
  await h.mesh.reconcile({ tabs: [{ tab_id: 'tabA', url: A, selected: true }, { tab_id: 'tabB', url: B }] });
  const first = await h.mesh.reserveCoordination({ eventKey: 'continuous:1', reason: 'CONTINUE_DEVELOPMENT' });
  assert.equal(first.ok, true);
  assert.equal(first.deliveries.length, 1);
  assert.match(first.deliveries[0].message, /without waiting for a user message/i);
  const duplicate = await h.mesh.reserveCoordination({ eventKey: 'continuous:1', reason: 'CONTINUE_DEVELOPMENT' });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.deliveries.length, 0);
});

test('ambiguous delivery moves coordinator to standby but never moves the same event', async () => {
  const h = meshHarness();
  await h.mesh.init();
  await h.mesh.reconcile({ tabs: [{ tab_id: 'tabA', url: A, selected: true }, { tab_id: 'tabB', url: B }] });
  const first = await h.mesh.reserveCoordination({ eventKey: 'ambiguous:1', reason: 'PRIMARY_WAKE_AMBIGUOUS_RECOVERY' });
  const delivery = first.deliveries[0];
  await h.mesh.markDeliveryAmbiguous(delivery.supervisor_id, delivery.pending.delivery_id, 'transport_lost');
  assert.equal(h.mesh.snapshot().coordinator_supervisor_id, supervisorInstanceIdForUrl(B));
  const same = await h.mesh.reserveCoordination({ eventKey: 'ambiguous:1', reason: 'PRIMARY_WAKE_AMBIGUOUS_RECOVERY' });
  assert.equal(same.duplicate, true);
  assert.equal(same.deliveries.length, 0);
  const independent = await h.mesh.reserveCoordination({
    eventKey: 'independent:2',
    reason: 'PRIMARY_WAKE_AMBIGUOUS_RECOVERY',
    priorAmbiguousEventId: delivery.pending.event_id,
  });
  assert.equal(independent.ok, true);
  assert.equal(independent.deliveries[0].supervisor_id, supervisorInstanceIdForUrl(B));
  assert.match(independent.deliveries[0].message, /NEVER repeat its physical effect/);
});

test('mesh recovery runtime sends standby wake only for blocked primary lifecycle', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-mesh-runtime-'));
  const statePath = path.join(dir, 'mesh.json');
  let generating = false;
  let typed = '';
  const actions = [];
  const browserState = {
    tabs: [{ tab_id: 'tabA', url: A, selected: true }, { tab_id: 'tabB', url: B, selected: false }],
    fleet: { agents: [] },
  };
  const executeCommand = async (command) => {
    actions.push(command.action);
    if (command.action === 'CAPTURE') return {
      url: command.payload.tab_id === 'tabB' ? B : A,
      text_excerpt: typed,
      semantic_targets: generating
        ? [{ role: 'textbox', name: 'Message ChatGPT' }, { role: 'button', name: 'Stop generating' }]
        : [{ role: 'textbox', name: 'Message ChatGPT' }, { role: 'button', name: 'Send' }],
    };
    if (command.action === 'SEMANTIC_TYPE') { typed = command.payload.text; return { ok: true }; }
    if (command.action === 'TYPED_CLICK') { generating = true; return { ok: true }; }
    throw new Error(`unexpected:${command.action}`);
  };
  const primaryLifecycle = () => ({
    keepalive: {
      state: 'WAKE_AMBIGUOUS',
      conversation_url: A,
      supervisor_epoch: 7,
      pending_wake: { wake_id: 'wake_prior' },
    },
  });
  const runtime = new SupervisorMeshRuntime({
    getState: async () => browserState,
    executeCommand,
    canActuate: () => true,
    primaryLifecycle,
    statePath,
    uuid: (() => { let i = 0; return () => `00000000-0000-4000-8000-${String(++i).padStart(12, '0')}`; })(),
  });
  await runtime.start();
  const result = await runtime.dispatchRecoveryIfNeeded();
  assert.equal(result.ok, true);
  assert.equal(result.supervisor_id, supervisorInstanceIdForUrl(B));
  assert.match(typed, /prior_ambiguous_event_id=wake_prior/);
  assert.ok(actions.includes('SEMANTIC_TYPE'));
  assert.ok(actions.includes('TYPED_CLICK'));
  const repeat = await runtime.dispatchRecoveryIfNeeded();
  assert.equal(repeat.duplicate, true);
  await fs.rm(dir, { recursive: true, force: true });
});
