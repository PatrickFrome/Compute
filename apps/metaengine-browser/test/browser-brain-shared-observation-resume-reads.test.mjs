import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainRealtimeObservationWindow } from '../src/browser-brain-realtime-observation-window.mjs';
import { buildBrowserBrainObservationResumeCohorts } from '../src/browser-brain-observation-resume-cohorts.mjs';
import {
  browserBrainSharedObservationResumeReadContract,
  readBrowserBrainObservationResumeCohorts,
} from '../src/browser-brain-shared-observation-resume-reads.mjs';

const digest = (value) => value.toString(16).padStart(64, '0');

function windowWithEpochs(...epochs) {
  const window = new BrowserBrainRealtimeObservationWindow({ capacity: 8 });
  for (const epoch of epochs) {
    window.observe({ epoch, source: `process:${epoch}`, kind: 'PROCESS', digest: digest(epoch) });
  }
  return window;
}

test('equal cursor cohorts share one physical observation read', () => {
  const window = windowWithEpochs(1, 2, 3, 4);
  const plan = buildBrowserBrainObservationResumeCohorts({
    oldest_epoch: 1,
    latest_epoch: 4,
    cursors: [
      { consumer: 'semantic-indexer', from_epoch: 2 },
      { consumer: 'fleet-memory', from_epoch: 2 },
    ],
  });
  const result = readBrowserBrainObservationResumeCohorts({ window, plan });
  assert.equal(result.physical_read_count, 1);
  assert.equal(result.delivery_count, 2);
  assert.deepEqual(result.shared_reads[0].consumers, ['fleet-memory', 'semantic-indexer']);
  assert.deepEqual(result.shared_reads[0].events.map((row) => row.epoch), [3, 4]);
});

test('already-current cohorts require zero physical reads', () => {
  const window = windowWithEpochs(1, 2);
  const plan = buildBrowserBrainObservationResumeCohorts({
    oldest_epoch: 1,
    latest_epoch: 2,
    cursors: [{ consumer: 'current-reader', from_epoch: 2 }],
  });
  const result = readBrowserBrainObservationResumeCohorts({ window, plan });
  assert.equal(result.physical_read_count, 0);
  assert.equal(result.shared_reads[0].events.length, 0);
});

test('a stale plan fails closed before any replay read', () => {
  const window = windowWithEpochs(1, 2);
  const plan = buildBrowserBrainObservationResumeCohorts({
    oldest_epoch: 1,
    latest_epoch: 2,
    cursors: [{ consumer: 'reader', from_epoch: 1 }],
  });
  window.observe({ epoch: 3, source: 'process:3', kind: 'PROCESS', digest: digest(3) });
  assert.throws(() => readBrowserBrainObservationResumeCohorts({ window, plan }), /plan_stale/);
});

test('truncated cohort is converted into canonical resync for every consumer', () => {
  const window = new BrowserBrainRealtimeObservationWindow({ capacity: 8 });
  for (let epoch = 1; epoch <= 10; epoch += 1) {
    window.observe({ epoch, source: `process:${epoch}`, kind: 'PROCESS', digest: digest(epoch) });
  }
  const plan = buildBrowserBrainObservationResumeCohorts({
    oldest_epoch: 1,
    latest_epoch: 10,
    cursors: [
      { consumer: 'a-reader', from_epoch: 1 },
      { consumer: 'b-reader', from_epoch: 1 },
    ],
  });
  const result = readBrowserBrainObservationResumeCohorts({ window, plan });
  assert.equal(result.physical_read_count, 1);
  assert.equal(result.shared_reads.length, 0);
  assert.deepEqual(result.canonical_resync.map((row) => row.consumer), ['a-reader', 'b-reader']);
});

test('contract stays provider-neutral and zero-authority', () => {
  const contract = browserBrainSharedObservationResumeReadContract();
  assert.equal(contract.one_window_read_per_replay_cohort, true);
  assert.equal(contract.current_cohort_zero_read, true);
  assert.equal(contract.stale_plan_fail_closed, true);
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
