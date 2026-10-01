import assert from 'node:assert/strict';
import test from 'node:test';
import { createClientRuntimeResource } from '../../me2-ui/src/lib/client-runtime-resource.ts';

const readback = () => ({
  connection: { schema: 'metaengine.client.connection-status.v1', admin_ready: true, local_runtime_ready: true, cloud_control_state: 'CONNECTED', authority_effect: false },
  work: { schema: 'metaengine.client.work-readiness.v1', state: 'READY', execution_ready: true, heartbeat_fresh: true,
    proven_agent_count: 1, generation_floor: 28, local_generation_floor: 28,
    label: 'Ready for work', detail: 'Task results still require verification.', useful_work_verified: false,
    recovery_effect_exposed: false, scheduler_authority: false, automatic_retry_allowed: false, authority_effect: false },
});
function harness(read) {
  const timers = new Map(); let id = 0; let visible = true; let visibility = null;
  const resource = createClientRuntimeResource({
    read, isVisible: () => visible,
    onVisibilityChange: fn => { visibility = fn; return () => { visibility = null; }; },
    schedule: (fn, ms) => { timers.set(++id, { fn, ms }); return id; },
    cancel: timer => timers.delete(timer),
  });
  return { resource, timers,
    visible: value => { visible = value; visibility?.(); },
    fire: ms => { const entry = [...timers].find(([, t]) => t.ms === ms); assert.ok(entry); timers.delete(entry[0]); entry[1].fn(); },
  };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('two UI consumers share one pending read and one periodic observation', async () => {
  let calls = 0; let resolve;
  const h = harness(() => { calls++; return new Promise(r => { resolve = r; }); });
  const a = h.resource.subscribe(() => {}); const b = h.resource.subscribe(() => {});
  void h.resource.refresh(); await flush();
  assert.equal(calls, 1);
  resolve(readback()); await flush();
  assert.equal(h.resource.getSnapshot().state, 'LIVE');
  assert.equal([...h.timers.values()].filter(t => t.ms === 2_000).length, 1);
  a(); b(); assert.equal(h.timers.size, 0);
});

test('IPC failure clears a previously positive status', async () => {
  let fail = false;
  const h = harness(async () => { if (fail) throw new Error('offline'); return readback(); });
  const stop = h.resource.subscribe(() => {}); await flush();
  assert.equal(h.resource.getSnapshot().readback.work.execution_ready, true);
  fail = true; await h.resource.refresh();
  assert.deepEqual(h.resource.getSnapshot(), { state: 'UNAVAILABLE', readback: null });
  stop();
});

test('deadline clears stale green; a late response cannot overwrite a newer success', async () => {
  let calls = 0; let late;
  const h = harness(() => {
    calls++;
    return calls === 2 ? new Promise(r => { late = r; }) : Promise.resolve(readback());
  });
  const stop = h.resource.subscribe(() => {}); await flush();
  const hung = h.resource.refresh(); await flush(); h.fire(4_000); await hung;
  assert.equal(h.resource.getSnapshot().readback, null);
  await h.resource.refresh();
  assert.equal(h.resource.getSnapshot().state, 'LIVE');
  late({ connection: {}, work: {} }); await flush();
  assert.equal(h.resource.getSnapshot().state, 'LIVE');
  assert.equal(calls, 3); stop();
});

test('invalid authority/readiness payload never produces a positive badge', async () => {
  const value = readback(); value.work.authority_effect = true;
  const h = harness(async () => value); const stop = h.resource.subscribe(() => {});
  await flush(); assert.equal(h.resource.getSnapshot().state, 'UNAVAILABLE'); stop();
});

test('a nominal READY payload without proven agents or matching generations is rejected', async () => {
  for (const [field, value] of [['proven_agent_count', 0], ['generation_floor', 27], ['local_generation_floor', null]]) {
    const next = readback(); next.work[field] = value;
    const h = harness(async () => next); const stop = h.resource.subscribe(() => {});
    await flush(); assert.equal(h.resource.getSnapshot().state, 'UNAVAILABLE'); stop();
  }
});

test('a disconnected or stale heartbeat cannot be labeled ready', async () => {
  for (const field of ['cloud_control_state', 'heartbeat_fresh']) {
    const value = readback();
    if (field === 'cloud_control_state') value.connection.cloud_control_state = 'RECONNECTING';
    else value.work.heartbeat_fresh = false;
    const h = harness(async () => value); const stop = h.resource.subscribe(() => {});
    await flush(); assert.equal(h.resource.getSnapshot().state, 'UNAVAILABLE'); stop();
  }
});

test('a valid blocked readback remains explanatory, rather than being conflated with an IPC outage', async () => {
  const value = readback(); Object.assign(value.work, { state: 'BLOCKED', execution_ready: false, heartbeat_fresh: false, label: 'Status unavailable' });
  const h = harness(async () => value); const stop = h.resource.subscribe(() => {});
  await flush(); assert.equal(h.resource.getSnapshot().readback.work.state, 'BLOCKED'); stop();
});

test('background and detached consumers perform no reads and no stale positive publication', async () => {
  let calls = 0; let resolve;
  const h = harness(() => { calls++; return new Promise(r => { resolve = r; }); });
  const stop = h.resource.subscribe(() => {}); await flush();
  h.visible(false); resolve(readback()); await flush();
  assert.equal(h.resource.getSnapshot().readback, null);
  assert.equal(h.timers.size, 0);
  await h.resource.refresh(); assert.equal(calls, 1);
  stop();
  await h.resource.refresh(); assert.equal(calls, 1);
});
