import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainObservationCursorLedger } from '../src/browser-brain-observation-cursors.mjs';
import {
  browserBrainObservationCursorCohortContract,
  resumeObservationCursorCohorts,
} from '../src/browser-brain-observation-cursor-cohorts.mjs';

const digest = (char) => char.repeat(64);

function seededLedger() {
  const ledger = new BrowserBrainObservationCursorLedger({ capacity: 8 });
  ledger.checkpointBatch([
    { consumer: 'browsercell-reader', epoch: 1, observation_digest: digest('a') },
    { consumer: 'process-reader', epoch: 1, observation_digest: digest('b') },
    { consumer: 'semantic-reader', epoch: 1, observation_digest: digest('c') },
  ]);
  return ledger;
}

test('changed caller indexes preserve original request order without post-sort', () => {
  const ledger = seededLedger();
  const revision = ledger.snapshot().revision;
  ledger.checkpoint({ consumer: 'semantic-reader', epoch: 2, observation_digest: digest('d') });
  const currentRevision = ledger.snapshot().revision;

  const result = resumeObservationCursorCohorts(
    ledger,
    [currentRevision, revision - 1, currentRevision, revision, revision - 1, currentRevision],
  );

  assert.equal(result.changed_request_count, 3);
  assert.deepEqual(result.changed_request_indexes, [1, 3, 4]);
  assert.deepEqual(
    result.changed_request_indexes.map((requestIndex) => result.request_cohort_indexes[requestIndex]),
    [0, 1, 0],
  );
});

test('unchanged and empty batches report zero changed callers', () => {
  const ledger = seededLedger();
  const revision = ledger.snapshot().revision;

  const unchanged = resumeObservationCursorCohorts(ledger, [revision, revision]);
  assert.equal(unchanged.changed_request_count, 0);
  assert.deepEqual(unchanged.changed_request_indexes, []);

  const empty = resumeObservationCursorCohorts(ledger, []);
  assert.equal(empty.changed_request_count, 0);
  assert.deepEqual(empty.changed_request_indexes, []);
});

test('caller-order optimization preserves provider-neutral zero-authority contract', () => {
  const contract = browserBrainObservationCursorCohortContract();
  assert.equal(contract.changed_request_order_single_pass, true);
  assert.equal(contract.provider_neutral, true);
  assert.equal(contract.payload_persisted, false);
  assert.equal(contract.scheduler_authority, false);
  assert.equal(contract.dispatch_authority, false);
  assert.equal(contract.lease_authority, false);
  assert.equal(contract.effect_execution_authority, false);
  assert.equal(contract.automatic_retry_allowed, false);
  assert.equal(contract.authority_effect, false);
});
