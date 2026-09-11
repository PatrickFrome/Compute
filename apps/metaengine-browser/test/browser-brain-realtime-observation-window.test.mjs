import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrowserBrainRealtimeObservationWindow,
  browserBrainRealtimeObservationWindowContract,
} from '../src/browser-brain-realtime-observation-window.mjs';

function observation(epoch, source, kind = 'SEMANTIC', digest = 'a'.repeat(64)) {
  return { brain_epoch: epoch, source, kind, digest, disposition: 'APPLIED' };
}

test('correlates BrowserCell/process/semantic/CDP/fanout observations in one bounded epoch window', () => {
  const window = new BrowserBrainRealtimeObservationWindow({ capacity: 8 });
  for (const [index, kind] of ['BROWSERCELL', 'PROCESS', 'SEMANTIC', 'CDP', 'FANOUT'].entries()) {
    const result = window.observe(observation(index + 1, `source:${index}`, kind, String(index + 1).repeat(64)));
    assert.equal(result.disposition, 'APPLIED');
  }
  const snapshot = window.snapshot();
  assert.equal(snapshot.max_epoch, 5);
  assert.equal(snapshot.source_count, 5);
  assert.equal(snapshot.retained_events, 5);
});

test('incremental read returns only observations newer than caller epoch', () => {
  const window = new BrowserBrainRealtimeObservationWindow({ capacity: 8 });
  window.observe(observation(1, 'semantic:main'));
  window.observe(observation(2, 'process:renderer', 'PROCESS', 'b'.repeat(64)));
  window.observe(observation(3, 'fanout:wave', 'FANOUT', 'c'.repeat(64)));
  const delta = window.changesSince(1);
  assert.deepEqual(delta.events.map((row) => row.epoch), [2, 3]);
  assert.equal(delta.to_epoch, 3);
  assert.equal(delta.resync_required, false);
});

test('duplicate delivery is idempotent and source epoch collision fails closed', () => {
  const window = new BrowserBrainRealtimeObservationWindow({ capacity: 8 });
  window.observe(observation(1, 'semantic:main'));
  assert.equal(window.observe(observation(1, 'semantic:main')).disposition, 'DUPLICATE');
  assert.throws(
    () => window.observe(observation(1, 'semantic:main', 'SEMANTIC', 'b'.repeat(64))),
    /epoch_collision/,
  );
  assert.equal(window.snapshot().retained_events, 1);
});

test('stale global epochs do not mutate the realtime window', () => {
  const window = new BrowserBrainRealtimeObservationWindow({ capacity: 8 });
  window.observe(observation(3, 'semantic:main'));
  const stale = window.observe(observation(2, 'process:renderer', 'PROCESS', 'b'.repeat(64)));
  assert.equal(stale.accepted, false);
  assert.equal(stale.disposition, 'STALE_GLOBAL_EPOCH');
  assert.equal(window.snapshot().source_count, 1);
});

test('bounded retention marks old delta readers for canonical resync', () => {
  const window = new BrowserBrainRealtimeObservationWindow({ capacity: 8 });
  for (let epoch = 1; epoch <= 10; epoch += 1) {
    window.observe(observation(epoch, `source:${epoch}`, 'SEMANTIC', epoch.toString(16).padStart(64, '0')));
  }
  const delta = window.changesSince(0);
  assert.equal(delta.events.length, 8);
  assert.equal(delta.truncated, true);
  assert.equal(delta.resync_required, true);
});

test('contract is provider-neutral, payload-free and zero-authority', () => {
  const contract = browserBrainRealtimeObservationWindowContract();
  assert.deepEqual(contract.stream_kinds, ['BROWSERCELL', 'PROCESS', 'SEMANTIC', 'CDP', 'FANOUT']);
  assert.equal(contract.bounded_retention, true);
  assert.equal(contract.incremental_delta_read, true);
  for (const key of [
    'payload_persisted',
    'scheduler_authority',
    'dispatch_authority',
    'lease_authority',
    'effect_execution_authority',
    'automatic_retry_allowed',
    'dedicated_timer',
    'authority_effect',
  ]) assert.equal(contract[key], false);
});
