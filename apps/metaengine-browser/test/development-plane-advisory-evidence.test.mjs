import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  DevelopmentPlane,
  DEVELOPMENT_PLANE_CAPABILITIES,
  DEVELOPMENT_PLANE_PROTOCOL,
  DEVELOPMENT_PLANE_VERSION,
} from '../src/development-plane.mjs';

class FakeChild extends EventEmitter {
  pid = 6060;
  sent = [];
  postMessage(message) { this.sent.push(message); }
  kill() { queueMicrotask(() => this.emit('exit', 0)); return true; }
}

async function ready() {
  const child = new FakeChild();
  const plane = new DevelopmentPlane({
    spawnWorker: () => child,
    timeout_ms: 500,
    uuid: () => '00000000-0000-4000-8000-000000000001',
  });
  const starting = plane.start();
  child.emit('message', {
    protocol: DEVELOPMENT_PLANE_PROTOCOL,
    type: 'READY',
    version: DEVELOPMENT_PLANE_VERSION,
    capabilities: [...DEVELOPMENT_PLANE_CAPABILITIES],
  });
  await starting;
  return { plane, child };
}

function minimalEnvelope() {
  return {
    schema: 'metaengine.advisory-evidence-envelope.v1',
    subject: { kind: 'MODEL_ADVISORY_TASK', task_id: 'task-1' },
    policy: { direct_action_allowed: false, browser_authority: false, promotion_authority: false },
    authority_effect: false,
  };
}

test('DP 0.4 advertises advisory verification without network or action authority', async () => {
  const { plane } = await ready();
  const snap = plane.snapshot();
  assert.equal(snap.version, '0.4.0');
  assert.equal(snap.capabilities.includes('ADVISORY_EVIDENCE_VERIFY'), true);
  assert.equal(snap.advisory_evidence_verification, true);
  assert.equal(snap.advisory_evidence_network_dispatch, false);
  assert.equal(snap.advisory_evidence_browser_authority, false);
  assert.equal(snap.advisory_evidence_promotion_authority, false);
  assert.equal(snap.browser_actuation_authority, false);
  assert.equal(snap.direct_promote_current, false);
});

test('advisory evidence crosses DP only as a bounded typed payload with zero authority effect', async () => {
  const { plane, child } = await ready();
  const envelope = minimalEnvelope();
  const pending = plane.request('ADVISORY_EVIDENCE_VERIFY', { envelope });
  const sent = child.sent.at(-1);
  assert.equal(sent.capability, 'ADVISORY_EVIDENCE_VERIFY');
  assert.deepEqual(sent.payload, { envelope });
  assert.equal(sent.authority_effect, false);

  child.emit('message', {
    protocol: DEVELOPMENT_PLANE_PROTOCOL,
    type: 'RESPONSE',
    request_id: sent.request_id,
    ok: true,
    result: {
      valid: true,
      advisory_only: true,
      direct_action_allowed: false,
      browser_authority: false,
      promotion_authority: false,
      authority_effect: false,
    },
  });

  const receipt = await pending;
  assert.equal(receipt.valid, true);
  assert.equal(receipt.direct_action_allowed, false);
  assert.equal(receipt.browser_authority, false);
  assert.equal(receipt.promotion_authority, false);
  assert.equal(receipt.authority_effect, false);
});

test('advisory verification requires an object payload and remains bounded', async () => {
  const { plane, child } = await ready();
  await assert.rejects(plane.request('ADVISORY_EVIDENCE_VERIFY'), /payload_required/);
  await assert.rejects(plane.request('ADVISORY_EVIDENCE_VERIFY', []), /payload_required/);
  await assert.rejects(
    plane.request('ADVISORY_EVIDENCE_VERIFY', { envelope: { blob: 'x'.repeat(300000) } }),
    /payload_too_large/,
  );
  assert.equal(child.sent.length, 0);
});
