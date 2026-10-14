import test from 'node:test';
import assert from 'node:assert/strict';
import { createGatewayReadbackFence, sameGatewayRunIdentity,
  MAX_GATEWAY_RUN_WATERMARKS } from './operator-gateway-security-fence.mjs';

const snapshot = (patch = {}) => ({
  source: 'OWN_POSTGRES_READBACK', proof: 'TRUSTED_READBACK', fresh: true,
  owner_id: 'owner-1', project_id: 'project-1', run_id: 'run-1',
  owner_epoch: 5, cursor: '11', observed_at: new Date().toISOString(), ...patch,
});

test('W28: rejects missing, forged, noncanonical and invalid sequence witnesses', () => {
  for (const patch of [{ proof: 'NONE' }, { source: 'MODEL_CLAIM' }, { fresh: false },
    { run_id: '../bad' }, { owner_epoch: -1 }, { owner_epoch: 0.3 },
    { cursor: '-1' }, { cursor: '01' }, { cursor: '9007199254740992' }]) {
    const guard = createGatewayReadbackFence();
    assert.throws(() => guard.accept(snapshot(patch)), /gateway_/);
  }
});

test('W28: same owner/run/epoch event sequence only advances, even after null identity', () => {
  const guard = createGatewayReadbackFence();
  guard.accept(snapshot());
  guard.accept(snapshot({ cursor: '12' }));
  guard.accept(null);
  guard.accept(snapshot({ cursor: '12' }));
  assert.throws(() => guard.accept(snapshot({ cursor: '11' })), /event_seq_regressed/);
  guard.accept(snapshot({ cursor: '13' }));
});

test('W28: one run cannot be rolled back after observing a different run in same owner epoch', () => {
  const guard = createGatewayReadbackFence();
  guard.accept(snapshot({ run_id: 'run-1', cursor: '18' }));
  guard.accept(snapshot({ run_id: 'run-2', cursor: '2' }));
  assert.throws(() => guard.accept(snapshot({ run_id: 'run-1', cursor: '17' })),
    /event_seq_regressed/);
  guard.accept(snapshot({ run_id: 'run-1', cursor: '18' }));
});

test('W28: a new Owner generation resets event namespace; old generation cannot replay', () => {
  const guard = createGatewayReadbackFence();
  guard.accept(snapshot({ owner_epoch: 5, cursor: '120' }));
  guard.accept(snapshot({ owner_epoch: 6, cursor: '0' }));
  assert.throws(() => guard.accept(snapshot({ owner_epoch: 5, cursor: '130' })),
    /owner_epoch_regressed/);
  assert.throws(() => guard.accept(snapshot({ owner_epoch: 6, cursor: '0',
    proof: 'NONE' })), /readback_unverified/);
  guard.accept(snapshot({ owner_epoch: 6, cursor: '1' }));
});

test('W28: capacity exhaustion fails closed rather than silently evicting anti-replay watermarks', () => {
  const guard = createGatewayReadbackFence();
  for (let i = 0; i < MAX_GATEWAY_RUN_WATERMARKS; i++) {
    guard.accept(snapshot({ run_id: 'run-' + i, cursor: String(i) }));
  }
  assert.throws(() => guard.accept(snapshot({ run_id: 'extra', cursor: '0' })),
    /capacity_exceeded/);
  assert.throws(() => guard.accept(snapshot({ run_id: 'run-0', cursor: '0', owner_epoch: 4 })),
    /owner_epoch_regressed/);
  guard.accept(snapshot({ run_id: 'run-0', cursor: '1' }));
});

test('W28: postflight identity comparison fences TOCTOU epoch/run/cursor swaps', () => {
  const original = snapshot();
  assert.equal(sameGatewayRunIdentity(original, snapshot({ observed_at: 'different' })), true);
  for (const patch of [{ owner_id: 'other' }, { project_id: 'other' },
    { run_id: 'other' }, { owner_epoch: 6 }, { cursor: '12' }]) {
    assert.equal(sameGatewayRunIdentity(original, snapshot(patch)), false);
  }
  assert.equal(sameGatewayRunIdentity(null, null), true);
  assert.equal(sameGatewayRunIdentity(null, original), false);
  assert.equal(sameGatewayRunIdentity(original, null), false);
});
