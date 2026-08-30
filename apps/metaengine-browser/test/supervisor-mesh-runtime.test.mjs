import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SupervisorMeshRuntime } from '../src/supervisor-mesh-runtime.mjs';
import { supervisorInstanceIdForUrl } from '../src/supervisor-mesh.mjs';

const A = 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const B = 'https://chatgpt.com/c/11111111-2222-3333-4444-555555555555';
const F = 'https://chatgpt.com/c/99999999-9999-9999-9999-999999999999';

async function tempState() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-supervisor-mesh-runtime-'));
  return { dir, statePath: path.join(dir, 'mesh.json') };
}

test('runtime automatically discovers all non-fleet ChatGPT supervisor conversations', async () => {
  const t = await tempState();
  let state = {
    tabs: [
      { tab_id:'tab-a', url:A, selected:false },
      { tab_id:'tab-b', url:B, selected:true },
      { tab_id:'tab-fleet', url:F, selected:false },
    ],
    fleet:{ agents:[{ agent_id:'worker-1', tab_id:'tab-fleet' }] },
  };
  const runtime = new SupervisorMeshRuntime({ getState:async () => state, statePath:t.statePath });
  await runtime.start();
  const snap = runtime.snapshot();
  assert.equal(snap.running, true);
  assert.equal(snap.mesh.counts.active, 2);
  assert.equal(snap.mesh.counts.total, 2);
  assert.equal(snap.mesh.preferred_supervisor_id, supervisorInstanceIdForUrl(B));
  assert.equal(snap.authority_effect, false);
  await fs.rm(t.dir, { recursive:true, force:true });
});

test('runtime persists mesh membership and recovers lost peers without creating tabs', async () => {
  const t = await tempState();
  let state = {
    tabs:[{ tab_id:'tab-a', url:A, selected:true }, { tab_id:'tab-b', url:B, selected:false }],
    fleet:{ agents:[] },
  };
  const first = new SupervisorMeshRuntime({ getState:async () => state, statePath:t.statePath });
  await first.start();
  first.stop();

  state = { tabs:[{ tab_id:'tab-b', url:B, selected:true }], fleet:{ agents:[] } };
  const second = new SupervisorMeshRuntime({ getState:async () => state, statePath:t.statePath });
  await second.start();
  const snap = second.snapshot();
  assert.equal(snap.mesh.counts.active, 1);
  assert.equal(snap.mesh.counts.lost, 1);
  assert.equal(snap.mesh.supervisors.find((row) => row.conversation_url === A).tab_id, null);
  assert.equal(snap.mesh.preferred_supervisor_id, supervisorInstanceIdForUrl(B));
  await fs.rm(t.dir, { recursive:true, force:true });
});

test('preferred peer changes only mesh routing state and does not select or navigate Browser tabs', async () => {
  const t = await tempState();
  const state = {
    tabs:[{ tab_id:'tab-a', url:A, selected:true }, { tab_id:'tab-b', url:B, selected:false }],
    fleet:{ agents:[] },
  };
  const runtime = new SupervisorMeshRuntime({ getState:async () => structuredClone(state), statePath:t.statePath });
  await runtime.start();
  const result = await runtime.prefer({ tab_id:'tab-b' });
  assert.equal(result.preferred_supervisor_id, supervisorInstanceIdForUrl(B));
  assert.equal(runtime.snapshot().mesh.supervisors.filter((row) => row.status === 'ACTIVE').length, 2);
  assert.equal(state.tabs.find((row) => row.tab_id === 'tab-a').selected, true);
  assert.equal(state.tabs.find((row) => row.tab_id === 'tab-b').selected, false);
  await fs.rm(t.dir, { recursive:true, force:true });
});

test('runtime fanout reserves independent deliveries but performs no Browser actuation itself', async () => {
  const t = await tempState();
  const runtime = new SupervisorMeshRuntime({
    getState:async () => ({ tabs:[{ tab_id:'tab-a',url:A,selected:true },{ tab_id:'tab-b',url:B,selected:false }], fleet:{agents:[]} }),
    statePath:t.statePath,
    uuid:(() => { let n=0; return () => `00000000-0000-0000-0000-${String(++n).padStart(12,'0')}`; })(),
  });
  await runtime.start();
  const reserved = await runtime.reserveWakeTargets({ reason:'CI_TERMINAL', fanout:2 });
  assert.equal(reserved.ok, true);
  assert.equal(reserved.deliveries.length, 2);
  assert.equal(runtime.isQuiescent(), false);
  for (const row of reserved.deliveries) await runtime.confirmDelivery(row.supervisor_id, row.pending.delivery_id);
  assert.equal(runtime.isQuiescent(), true);
  await fs.rm(t.dir, { recursive:true, force:true });
});

test('duplicate physical incarnation is surfaced as ambiguity and never becomes a preferred route', async () => {
  const t = await tempState();
  const runtime = new SupervisorMeshRuntime({
    getState:async () => ({ tabs:[{ tab_id:'tab-a1',url:A,selected:true },{ tab_id:'tab-a2',url:A,selected:false }], fleet:{agents:[]} }),
    statePath:t.statePath,
  });
  await runtime.start();
  const snap = runtime.snapshot();
  assert.equal(snap.mesh.counts.ambiguous_incarnation, 1);
  assert.equal(snap.mesh.counts.active, 0);
  assert.equal(snap.mesh.preferred_supervisor_id, null);
  await fs.rm(t.dir, { recursive:true, force:true });
});

test('state-provider failure is contained as read-only runtime error and cannot fabricate membership', async () => {
  const t = await tempState();
  let fail = false;
  const runtime = new SupervisorMeshRuntime({
    getState:async () => {
      if (fail) throw new Error('state_unavailable');
      return { tabs:[{ tab_id:'tab-a',url:A,selected:true }], fleet:{agents:[]} };
    },
    statePath:t.statePath,
  });
  await runtime.start();
  fail = true;
  await runtime.reconcile();
  const snap = runtime.snapshot();
  assert.equal(snap.mesh.counts.active, 1);
  assert.match(snap.last_error, /state_unavailable/);
  assert.equal(snap.authority_effect, false);
  await fs.rm(t.dir, { recursive:true, force:true });
});
