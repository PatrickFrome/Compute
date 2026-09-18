import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBrowserBrainObservationResumeCohorts,
  browserBrainObservationResumeCohortContract,
} from '../src/browser-brain-observation-resume-cohorts.mjs';

test('groups equal cursors so multiple consumers can share one bounded window read', () => {
  const plan = buildBrowserBrainObservationResumeCohorts({
    oldest_epoch: 10,
    latest_epoch: 20,
    cursors: [
      { consumer: 'semantic-indexer', from_epoch: 12 },
      { consumer: 'fleet-memory', from_epoch: 12 },
      { consumer: 'process-reader', from_epoch: 18 },
    ],
  });
  assert.equal(plan.cohort_count, 2);
  assert.deepEqual(plan.cohorts[0], {
    from_epoch: 12,
    consumers: ['fleet-memory', 'semantic-indexer'],
    consumer_count: 2,
    replay_required: true,
  });
  assert.deepEqual(plan.cohorts[1].consumers, ['process-reader']);
});

test('stale consumers are separated for canonical resync instead of synthetic replay', () => {
  const plan = buildBrowserBrainObservationResumeCohorts({
    oldest_epoch: 10,
    latest_epoch: 20,
    cursors: [
      { consumer: 'stale-reader', from_epoch: 8 },
      { consumer: 'boundary-reader', from_epoch: 9 },
    ],
  });
  assert.equal(plan.canonical_resync_count, 1);
  assert.equal(plan.canonical_resync[0].consumer, 'stale-reader');
  assert.equal(plan.canonical_resync[0].canonical_resync_required, true);
  assert.equal(plan.cohorts[0].from_epoch, 9);
});

test('consumer and cohort ordering is deterministic regardless of input order', () => {
  const input = [
    { consumer: 'z-reader', from_epoch: 7 },
    { consumer: 'b-reader', from_epoch: 3 },
    { consumer: 'a-reader', from_epoch: 7 },
  ];
  const first = buildBrowserBrainObservationResumeCohorts({ oldest_epoch: 1, latest_epoch: 9, cursors: input });
  const second = buildBrowserBrainObservationResumeCohorts({ oldest_epoch: 1, latest_epoch: 9, cursors: [...input].reverse() });
  assert.deepEqual(first, second);
  assert.deepEqual(first.cohorts.map((row) => row.from_epoch), [3, 7]);
  assert.deepEqual(first.cohorts[1].consumers, ['a-reader', 'z-reader']);
});

test('duplicate consumers and future cursors fail closed', () => {
  assert.throws(() => buildBrowserBrainObservationResumeCohorts({
    oldest_epoch: 1,
    latest_epoch: 5,
    cursors: [
      { consumer: 'same-reader', from_epoch: 2 },
      { consumer: 'same-reader', from_epoch: 3 },
    ],
  }), /consumer_duplicate/);
  assert.throws(() => buildBrowserBrainObservationResumeCohorts({
    oldest_epoch: 1,
    latest_epoch: 5,
    cursors: [{ consumer: 'future-reader', from_epoch: 6 }],
  }), /future_epoch/);
});

test('already-current consumers need no replay', () => {
  const plan = buildBrowserBrainObservationResumeCohorts({
    oldest_epoch: 4,
    latest_epoch: 9,
    cursors: [{ consumer: 'current-reader', from_epoch: 9 }],
  });
  assert.equal(plan.cohorts[0].replay_required, false);
});

test('contract is provider-neutral, payload-free and has zero execution authority', () => {
  const contract = browserBrainObservationResumeCohortContract();
  assert.equal(contract.groups_equal_epochs, true);
  assert.equal(contract.stale_cursor_requires_canonical_resync, true);
  assert.equal(contract.shared_window_read, true);
  for (const key of [
    'payload_persisted',
    'scheduler_authority',
    'dispatch_authority',
    'lease_authority',
    'effect_execution_authority',
    'automatic_retry_allowed',
    'authority_effect',
  ]) assert.equal(contract[key], false);
});
