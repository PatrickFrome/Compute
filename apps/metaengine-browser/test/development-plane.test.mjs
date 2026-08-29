import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DevelopmentPlane, DEVELOPMENT_PLANE_CAPABILITIES, DEVELOPMENT_PLANE_PROTOCOL } from '../src/development-plane.mjs';

class FakeChild extends EventEmitter {
  pid = 4242;
  sent = [];
  killed = false;
  postMessage(message) { this.sent.push(message); }
  kill() { this.killed = true; queueMicrotask(() => this.emit('exit', 0)); return true; }
}

function makePlane() {
  const child = new FakeChild();
  let uuid = 0;
  const plane = new DevelopmentPlane({
    spawnWorker: () => child,
    timeout_ms: 500,
    uuid: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`,
    clock: () => 1788000000000,
  });
  return { plane, child };
}

async function ready(h) {
  const starting = h.plane.start();
  h.child.emit('message', { protocol: DEVELOPMENT_PLANE_PROTOCOL, type: 'READY', capabilities: [...DEVELOPMENT_PLANE_CAPABILITIES] });
  await starting;
}

test('starts only after exact capability handshake', async () => {
  const h = makePlane();
  await ready(h);
  const snap = h.plane.snapshot();
  assert.equal(snap.state, 'READY');
  assert.equal(snap.pid, 4242);
  assert.equal(snap.direct_promote_current, false);
  assert.equal(snap.browser_actuation_authority, false);
});

test('mismatched capability handshake fails closed', async () => {
  const h = makePlane();
  const p = h.plane.start();
  h.child.emit('message', { protocol: DEVELOPMENT_PLANE_PROTOCOL, type: 'READY', capabilities: ['HEALTH'] });
  await assert.rejects(p, /capability_handshake_mismatch/);
  assert.equal(h.plane.snapshot().state, 'LOST');
});

test('only DP0 allowlisted capabilities can be requested', async () => {
  const h = makePlane();
  await ready(h);
  await assert.rejects(h.plane.request('RUN_SHELL'), /capability_denied/);
  assert.equal(h.child.sent.length, 0);
});

test('typed request has no payload and no authority effect', async () => {
  const h = makePlane();
  await ready(h);
  const p = h.plane.request('HEALTH');
  const sent = h.child.sent.at(-1);
  assert.equal(sent.capability, 'HEALTH');
  assert.equal(sent.payload, null);
  assert.equal(sent.authority_effect, false);
  h.child.emit('message', { protocol: DEVELOPMENT_PLANE_PROTOCOL, type: 'RESPONSE', request_id: sent.request_id, ok: true, result: { ok: true } });
  assert.deepEqual(await p, { ok: true });
});

test('process loss rejects pending requests and is never auto-restarted', async () => {
  const h = makePlane();
  await ready(h);
  const p = h.plane.request('PROCESS_METRICS');
  h.child.emit('exit', 9);
  await assert.rejects(p, /process_lost/);
  const snap = h.plane.snapshot();
  assert.equal(snap.state, 'LOST');
  assert.equal(snap.automatic_restart, false);
  assert.equal(snap.last_exit_code, 9);
});

test('stop is explicit and transitions to stopped after exit', async () => {
  const h = makePlane();
  await ready(h);
  assert.equal(h.plane.stop(), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.plane.snapshot().state, 'STOPPED');
  assert.equal(h.child.killed, true);
});
