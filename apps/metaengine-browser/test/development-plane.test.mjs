import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DevelopmentPlane, DEVELOPMENT_PLANE_CAPABILITIES, DEVELOPMENT_PLANE_PROTOCOL, DEVELOPMENT_PLANE_VERSION } from '../src/development-plane.mjs';

class FakeChild extends EventEmitter {
  pid = 4242;
  sent = [];
  killed = false;
  postMessage(message) {
    this.sent.push(message);
    if (message?.type === 'CONTROL' && message?.control === 'SHUTDOWN') {
      queueMicrotask(() => {
        this.emit('message', { protocol: DEVELOPMENT_PLANE_PROTOCOL, type: 'SHUTDOWN_ACK', version: DEVELOPMENT_PLANE_VERSION, authority_effect: false });
        this.emit('exit', 0);
      });
    }
  }
  kill() { this.killed = true; queueMicrotask(() => this.emit('exit', 0)); return true; }
}

class StuckChild extends FakeChild {
  postMessage(message) { this.sent.push(message); }
  kill() { this.killed = true; return true; }
}

function makePlane({ child = new FakeChild(), timeout_ms = 500, restart_base_ms = 20, restart_max_ms = 80, spawnWorker = null } = {}) {
  let uuid = 0;
  const plane = new DevelopmentPlane({
    spawnWorker: spawnWorker || (() => child),
    timeout_ms,
    restart_base_ms,
    restart_max_ms,
    uuid: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`,
    clock: () => 1788000000000,
  });
  return { plane, child };
}

async function ready(h) {
  const starting = h.plane.start();
  h.child.emit('message', { protocol: DEVELOPMENT_PLANE_PROTOCOL, type: 'READY', version: DEVELOPMENT_PLANE_VERSION, capabilities: [...DEVELOPMENT_PLANE_CAPABILITIES] });
  await starting;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('starts only after exact version and capability handshake', async () => {
  const h = makePlane();
  await ready(h);
  const snap = h.plane.snapshot();
  assert.equal(snap.state, 'READY');
  assert.equal(snap.pid, 4242);
  assert.equal(snap.direct_promote_current, false);
  assert.equal(snap.browser_actuation_authority, false);
  assert.equal(snap.verified_shutdown_required, true);
  assert.equal(snap.cooperative_shutdown, true);
  assert.equal(snap.automatic_restart, true);
  assert.equal(snap.terminal_requires_external_stop, true);
});

test('mismatched capability handshake fails closed and schedules recovery', async () => {
  const h = makePlane();
  const p = h.plane.start();
  h.child.emit('message', { protocol: DEVELOPMENT_PLANE_PROTOCOL, type: 'READY', version: DEVELOPMENT_PLANE_VERSION, capabilities: ['HEALTH'] });
  await assert.rejects(p, /capability_handshake_mismatch/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(['LOST','RESTART_PENDING','STARTING'].includes(h.plane.snapshot().state));
  assert.equal(h.plane.snapshot().automatic_restart, true);
});

test('mismatched worker version fails closed and schedules recovery', async () => {
  const h = makePlane();
  const p = h.plane.start();
  h.child.emit('message', { protocol: DEVELOPMENT_PLANE_PROTOCOL, type: 'READY', version: '0.1.2', capabilities: [...DEVELOPMENT_PLANE_CAPABILITIES] });
  await assert.rejects(p, /capability_handshake_mismatch/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(['LOST','RESTART_PENDING','STARTING'].includes(h.plane.snapshot().state));
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

test('process loss rejects pending requests and automatically restarts until externally stopped', async () => {
  const first = new FakeChild();
  first.pid = 4242;
  const second = new FakeChild();
  second.pid = 4343;
  const children = [first, second];
  let spawnIndex = 0;
  const h = makePlane({ child: first, restart_base_ms: 20, restart_max_ms: 40, spawnWorker: () => children[Math.min(spawnIndex++, children.length - 1)] });
  const starting = h.plane.start();
  first.emit('message', { protocol: DEVELOPMENT_PLANE_PROTOCOL, type: 'READY', version: DEVELOPMENT_PLANE_VERSION, capabilities: [...DEVELOPMENT_PLANE_CAPABILITIES] });
  await starting;
  const p = h.plane.request('PROCESS_METRICS');
  first.emit('exit', 9);
  await assert.rejects(p, /process_lost/);
  assert.equal(h.plane.snapshot().automatic_restart, true);
  assert.ok(['LOST','RESTART_PENDING'].includes(h.plane.snapshot().state));
  await sleep(30);
  second.emit('message', { protocol: DEVELOPMENT_PLANE_PROTOCOL, type: 'READY', version: DEVELOPMENT_PLANE_VERSION, capabilities: [...DEVELOPMENT_PLANE_CAPABILITIES] });
  await sleep(0);
  const recovered = h.plane.snapshot();
  assert.equal(recovered.state, 'READY');
  assert.equal(recovered.pid, 4343);
  assert.equal(recovered.last_exit_code, 9);
  assert.equal(recovered.restart_attempt, 0);

  assert.equal(h.plane.stop(), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.plane.snapshot().state, 'STOPPED');
  assert.equal(h.plane.snapshot().external_stop_requested, true);
});

test('legacy stop remains explicit and transitions to stopped after exit', async () => {
  const h = makePlane();
  await ready(h);
  assert.equal(h.plane.stop(), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.plane.snapshot().state, 'STOPPED');
  assert.equal(h.child.killed, true);
  assert.equal(h.plane.snapshot().restart_pending, false);
});

test('stopAndWait uses typed cooperative shutdown and proves exit', async () => {
  const h = makePlane();
  await ready(h);
  const receipt = await h.plane.stopAndWait(500);
  const control = h.child.sent.at(-1);
  assert.deepEqual(control, { protocol: DEVELOPMENT_PLANE_PROTOCOL, type: 'CONTROL', control: 'SHUTDOWN', authority_effect: false });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.state, 'STOPPED');
  assert.equal(receipt.last_exit_code, 0);
  assert.equal(receipt.cooperative_shutdown_ack, true);
  assert.equal(receipt.authority_effect, false);
  assert.equal(h.plane.snapshot().state, 'STOPPED');
  assert.equal(h.plane.snapshot().restart_pending, false);
});

test('stopAndWait fails closed when process neither cooperates nor exits and external stop prevents restart', async () => {
  const h = makePlane({ child: new StuckChild(), timeout_ms: 150 });
  await ready(h);
  await assert.rejects(h.plane.stopAndWait(150), /stop_timeout/);
  assert.equal(h.plane.snapshot().state, 'LOST');
  assert.equal(h.child.killed, true);
  assert.equal(h.plane.snapshot().restart_pending, false);
  assert.equal(h.plane.snapshot().external_stop_requested, true);
});
