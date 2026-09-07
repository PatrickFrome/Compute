import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrowserBrainObservationCursorLedger,
  browserBrainObservationCursorContract,
} from '../src/browser-brain-observation-cursors.mjs';

const digest = (char) => char.repeat(64);

test('checkpoints independent consumer cursors for restart-safe realtime resume', () => {
  const ledger = new BrowserBrainObservationCursorLedger({ capacity: 4 });
  ledger.checkpoint({ consumer: 'semantic-indexer', epoch: 11, observation_digest: digest('a') });
  ledger.checkpoint({ consumer: 'fleet-memory', epoch: 9, observation_digest: digest('b') });
  assert.equal(ledger.resumeFrom('semantic-indexer').from_epoch, 11);
  assert.equal(ledger.resumeFrom('fleet-memory').from_epoch, 9);
  assert.equal(ledger.resumeFrom('new-consumer').from_epoch, 0);
});

test('duplicate checkpoint is idempotent while same-epoch digest collision fails closed', () => {
  const ledger = new BrowserBrainObservationCursorLedger();
  const row = { consumer: 'brain-reader', epoch: 7, observation_digest: digest('c') };
  ledger.checkpoint(row);
  assert.equal(ledger.checkpoint(row).disposition, 'DUPLICATE');
  assert.throws(
    () => ledger.checkpoint({ ...row, observation_digest: digest('d') }),
    /epoch_collision/,
  );
  assert.equal(ledger.get('brain-reader').observation_digest, digest('c'));
});

test('cursor regression is rejected before mutation', () => {
  const ledger = new BrowserBrainObservationCursorLedger();
  ledger.checkpoint({ consumer: 'process-reader', epoch: 8, observation_digest: digest('e') });
  const result = ledger.checkpoint({ consumer: 'process-reader', epoch: 6, observation_digest: digest('f') });
  assert.equal(result.accepted, false);
  assert.equal(result.disposition, 'REGRESSION');
  assert.equal(ledger.get('process-reader').epoch, 8);
});

test('consumer count is bounded and existing consumers can still advance at capacity', () => {
  const ledger = new BrowserBrainObservationCursorLedger({ capacity: 2 });
  ledger.checkpoint({ consumer: 'a', epoch: 1, observation_digest: digest('a') });
  ledger.checkpoint({ consumer: 'b', epoch: 1, observation_digest: digest('b') });
  assert.throws(
    () => ledger.checkpoint({ consumer: 'c', epoch: 1, observation_digest: digest('c') }),
    /capacity_exceeded/,
  );
  assert.equal(
    ledger.checkpoint({ consumer: 'a', epoch: 2, observation_digest: digest('d') }).disposition,
    'APPLIED',
  );
});

test('snapshot is compact, payload-free and deterministically ordered', () => {
  const ledger = new BrowserBrainObservationCursorLedger({ capacity: 4 });
  ledger.checkpoint({ consumer: 'z-reader', epoch: 3, observation_digest: digest('a') });
  ledger.checkpoint({ consumer: 'a-reader', epoch: 2, observation_digest: digest('b') });
  const snapshot = ledger.snapshot();
  assert.deepEqual(snapshot.cursors.map((row) => row.consumer), ['a-reader', 'z-reader']);
  assert.equal(snapshot.consumer_count, 2);
  assert.equal('payload' in snapshot, false);
  assert.equal(snapshot.payload_persisted, false);
});

test('contract is provider-neutral and zero-authority with no retry synthesis', () => {
  const contract = browserBrainObservationCursorContract();
  assert.equal(contract.provider_neutral, true);
  assert.equal(contract.monotonic_epoch, true);
  assert.equal(contract.durable_checkpoint_only, true);
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
