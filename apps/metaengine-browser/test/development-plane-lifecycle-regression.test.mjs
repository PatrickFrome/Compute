import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { DevelopmentPlane, DEVELOPMENT_PLANE_PROTOCOL, DEVELOPMENT_PLANE_VERSION, DEVELOPMENT_PLANE_CAPABILITIES } from '../src/development-plane-activated.mjs';
import { finalRuntimeActivationRegistrySnapshot } from '../src/final-runtime-activation-registry.mjs';

class Worker extends EventEmitter {
  pid = 4242;
  postMessage() {}
  kill() { queueMicrotask(() => this.emit('exit', 0)); return true; }
  ready() { this.emit('message', { protocol: DEVELOPMENT_PLANE_PROTOCOL, type: 'READY',
    version: DEVELOPMENT_PLANE_VERSION, capabilities: [...DEVELOPMENT_PLANE_CAPABILITIES] }); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('same development plane re-registers after a completed stop and restart', async t => {
  let worker;
  const plane = new DevelopmentPlane({ spawnWorker() { worker = new Worker(); return worker; } });
  t.after(() => plane.stop());
  let start = plane.start(); worker.ready(); await start;
  plane.stop(); await tick();
  assert.equal(finalRuntimeActivationRegistrySnapshot().development_plane_registered, false);
  start = plane.start(); worker.ready(); await start;
  assert.equal(plane.snapshot().state, 'READY');
  assert.equal(finalRuntimeActivationRegistrySnapshot().development_plane_registered, true);
});

test('stop fences a resolved readiness continuation before re-registration', async t => {
  let worker;
  const plane = new DevelopmentPlane({ spawnWorker() { worker = new Worker(); return worker; } });
  t.after(() => plane.stop());
  const start = plane.start(); worker.ready(); plane.stop();
  await start; await tick();
  assert.equal(finalRuntimeActivationRegistrySnapshot().development_plane_registered, false);
});

test('obsolete readiness cannot replace a newer development plane owner', async t => {
  let workerA, workerB;
  const planeA = new DevelopmentPlane({ spawnWorker() { workerA = new Worker(); return workerA; } });
  t.after(() => planeA.stop());
  const startA = planeA.start();
  const planeB = new DevelopmentPlane({ spawnWorker() { workerB = new Worker(); return workerB; } });
  t.after(() => planeB.stop());
  const startB = planeB.start(); workerB.ready(); await startB;
  workerA.ready(); await startA;
  planeB.stop(); await tick();
  assert.equal(finalRuntimeActivationRegistrySnapshot().development_plane_registered, false);
  // An explicit restart of the latest instance still owns the vacant slot.
  const restartB = planeB.start(); workerB.ready(); await restartB;
  assert.equal(finalRuntimeActivationRegistrySnapshot().development_plane_registered, true);
  planeA.stop(); await tick();
  assert.equal(finalRuntimeActivationRegistrySnapshot().development_plane_registered, true);
});
