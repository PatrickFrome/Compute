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

test('equal known revisions share one deterministic delta-resume cohort', () => {
  const ledger = seededLedger();
  const revision = ledger.snapshot().revision;
  ledger.checkpoint({ consumer: 'semantic-reader', epoch: 2, observation_digest: digest('d') });

  const result = resumeObservationCursorCohorts(ledger, [revision, revision, revision - 1]);
  assert.equal(result.request_count, 3);
  assert.equal(result.cohort_count, 2);
  assert.deepEqual(result.cohorts.map((cohort) => cohort.known_revision), [revision - 1, revision]);
  assert.deepEqual(result.cohorts[1].resumes.map((resume) => resume.consumer), ['semantic-reader']);
});

test('current revisions produce an empty cohort without synthesizing consumers', () => {
  const ledger = seededLedger();
  const revision = ledger.snapshot().revision;
  const result = resumeObservationCursorCohorts(ledger, [revision, revision]);

  assert.equal(result.cohort_count, 1);
  assert.equal(result.cohorts[0].changed, false);
  assert.deepEqual(result.cohorts[0].resumes, []);
});

test('cohort planner validates every revision before materializing any delta', () => {
  const ledger = seededLedger();
  const revision = ledger.snapshot().revision;
  let calls = 0;
  const wrapped = {
    resumeChangedSince(value) {
      calls += 1;
      return ledger.resumeChangedSince(value);
    },
  };

  assert.throws(
    () => resumeObservationCursorCohorts(wrapped, [revision, -1, revision]),
    /cohort_revision_invalid/,
  );
  assert.equal(calls, 0);
});

test('ahead revisions inherit fail-closed ledger fencing', () => {
  const ledger = seededLedger();
  const revision = ledger.snapshot().revision;
  assert.throws(
    () => resumeObservationCursorCohorts(ledger, [revision + 1]),
    /resume_revision_ahead/,
  );
});

test('cohort request list is bounded to 128 revisions', () => {
  const ledger = seededLedger();
  assert.throws(
    () => resumeObservationCursorCohorts(ledger, Array.from({ length: 129 }, () => 0)),
    /cohort_batch_invalid/,
  );
});

test('cohort contract stays provider-neutral, payload-free and zero-authority', () => {
  const ledger = seededLedger();
  const result = resumeObservationCursorCohorts(ledger, [0, 0, 1]);
  assert.equal(result.payload_persisted, false);
  assert.equal(result.scheduler_authority, false);
  assert.equal(result.dispatch_authority, false);
  assert.equal(result.lease_authority, false);
  assert.equal(result.effect_execution_authority, false);
  assert.equal(result.automatic_retry_allowed, false);

  const contract = browserBrainObservationCursorCohortContract();
  assert.equal(contract.max_revision_requests, 128);
  assert.equal(contract.equal_revision_requests_share_one_materialization, true);
  assert.equal(contract.provider_neutral, true);
  assert.equal(contract.authority_effect, false);
});
