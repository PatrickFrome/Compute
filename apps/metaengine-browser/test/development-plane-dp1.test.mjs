import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DevelopmentPlane, DEVELOPMENT_PLANE_CAPABILITIES, DEVELOPMENT_PLANE_PROTOCOL, DEVELOPMENT_PLANE_VERSION } from '../src/development-plane.mjs';

class FakeChild extends EventEmitter {
  pid = 5252;
  sent = [];
  postMessage(message) { this.sent.push(message); }
  kill() { queueMicrotask(() => this.emit('exit', 0)); return true; }
}

async function ready() {
  const child = new FakeChild();
  const plane = new DevelopmentPlane({ spawnWorker: () => child, timeout_ms: 500, uuid: () => '00000000-0000-4000-8000-000000000001' });
  const starting = plane.start();
  child.emit('message', { protocol: DEVELOPMENT_PLANE_PROTOCOL, type: 'READY', version: DEVELOPMENT_PLANE_VERSION, capabilities: [...DEVELOPMENT_PLANE_CAPABILITIES] });
  await starting;
  return { plane, child };
}

const payload = {
  source_head: 'a'.repeat(40),
  sequence: 1,
  intent: 'Candidate capsule request',
  components: [{ path: 'apps/metaengine-browser/src/development-plane.mjs', change: 'MODIFY', digest: `sha256:${'1'.repeat(64)}` }],
  verification_plan: [{ id: 'UNIT_TESTS', required: true }],
  evidence: [],
};

test('DP1 capability handshake preserves candidate create and verify without promotion authority', async () => {
  const { plane } = await ready();
  const snap = plane.snapshot();
  assert.equal(snap.version, DEVELOPMENT_PLANE_VERSION);
  assert.equal(snap.capabilities.includes('CANDIDATE_CAPSULE_CREATE'), true);
  assert.equal(snap.capabilities.includes('CANDIDATE_CAPSULE_VERIFY'), true);
  assert.equal(snap.candidate_capsules, true);
  assert.equal(snap.candidate_capsules_executable, false);
  assert.equal(snap.direct_promote_current, false);
});

test('candidate create transports a bounded typed payload with zero authority effect', async () => {
  const { plane, child } = await ready();
  const pending = plane.request('CANDIDATE_CAPSULE_CREATE', payload);
  const sent = child.sent.at(-1);
  assert.equal(sent.capability, 'CANDIDATE_CAPSULE_CREATE');
  assert.deepEqual(sent.payload, payload);
  assert.equal(sent.authority_effect, false);
  child.emit('message', { protocol: DEVELOPMENT_PLANE_PROTOCOL, type: 'RESPONSE', request_id: sent.request_id, ok: true, result: { candidate_id: 'candidate_test' } });
  assert.deepEqual(await pending, { candidate_id: 'candidate_test' });
});

test('legacy read-only capabilities reject payload injection', async () => {
  const { plane, child } = await ready();
  await assert.rejects(plane.request('HEALTH', { unexpected: true }), /payload_denied/);
  assert.equal(child.sent.length, 0);
});

test('candidate capabilities require a plain object payload', async () => {
  const { plane, child } = await ready();
  await assert.rejects(plane.request('CANDIDATE_CAPSULE_CREATE'), /payload_required/);
  await assert.rejects(plane.request('CANDIDATE_CAPSULE_VERIFY', []), /payload_required/);
  assert.equal(child.sent.length, 0);
});

test('candidate payload is bounded before crossing process boundary', async () => {
  const { plane, child } = await ready();
  const huge = { ...payload, intent: 'x'.repeat(300000) };
  await assert.rejects(plane.request('CANDIDATE_CAPSULE_CREATE', huge), /payload_too_large/);
  assert.equal(child.sent.length, 0);
});
