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

test('batch checkpoints independent realtime consumers with one transactional commit', () => {
  const ledger = new BrowserBrainObservationCursorLedger({ capacity: 4 });
  const results = ledger.checkpointBatch([
    { consumer: 'browsercell-reader', epoch: 17, observation_digest: digest('a') },
    { consumer: 'process-reader', epoch: 12, observation_digest: digest('b') },
    { consumer: 'semantic-reader', epoch: 21, observation_digest: digest('c') },
  ]);
  assert.deepEqual(results.map((result) => result.disposition), ['APPLIED', 'APPLIED', 'APPLIED']);
  assert.equal(ledger.resumeFrom('browsercell-reader').from_epoch, 17);
  assert.equal(ledger.resumeFrom('process-reader').from_epoch, 12);
  assert.equal(ledger.resumeFrom('semantic-reader').from_epoch, 21);
});

test('batch resumes BrowserCell process semantic and fleet-memory consumers from one bounded read', () => {
  const ledger = new BrowserBrainObservationCursorLedger({ capacity: 4 });
  ledger.checkpointBatch([
    { consumer: 'browsercell-reader', epoch: 17, observation_digest: digest('a') },
    { consumer: 'process-reader', epoch: 12, observation_digest: digest('b') },
    { consumer: 'semantic-reader', epoch: 21, observation_digest: digest('c') },
    { consumer: 'fleet-memory', epoch: 8, observation_digest: digest('d') },
  ]);
  const resumes = ledger.resumeBatch([
    'browsercell-reader',
    'process-reader',
    'semantic-reader',
    'fleet-memory',
    'new-reader',
  ]);
  assert.deepEqual(resumes.map((resume) => resume.from_epoch), [17, 12, 21, 8, 0]);
  assert.deepEqual(resumes.map((resume) => resume.consumer), [
    'browsercell-reader',
    'process-reader',
    'semantic-reader',
    'fleet-memory',
    'new-reader',
  ]);
  assert.equal(resumes.every((resume) => resume.payload_persisted === false), true);
  assert.equal(resumes.every((resume) => resume.effect_execution_authority === false), true);
});

test('batch resume is identity for empty input and fails closed before oversized reads', () => {
  const ledger = new BrowserBrainObservationCursorLedger();
  assert.deepEqual(ledger.resumeBatch([]), []);
  assert.throws(
    () => ledger.resumeBatch(Array.from({ length: 129 }, (_, index) => `reader-${index}`)),
    /resume_batch_invalid/,
  );
  assert.equal(ledger.snapshot().consumer_count, 0);
});

test('resumes the full durable consumer capacity from one bounded read', () => {
  const ledger = new BrowserBrainObservationCursorLedger({ capacity: 256 });
  for (let offset = 0; offset < 256; offset += 128) {
    ledger.checkpointBatch(Array.from({ length: 128 }, (_, index) => ({
      consumer: `reader-${String(offset + index).padStart(3, '0')}`,
      epoch: offset + index + 1,
      observation_digest: digest('a'),
    })));
  }

  const resumes = ledger.resumeAll();
  assert.equal(resumes.length, 256);
  assert.equal(resumes[0].consumer, 'reader-000');
  assert.equal(resumes[0].from_epoch, 1);
  assert.equal(resumes[255].consumer, 'reader-255');
  assert.equal(resumes[255].from_epoch, 256);
  assert.equal(resumes.every((resume) => resume.payload_persisted === false), true);
  assert.equal(resumes.every((resume) => resume.effect_execution_authority === false), true);
});

test('full-capacity resume is deterministic and does not synthesize unseen consumers', () => {
  const ledger = new BrowserBrainObservationCursorLedger({ capacity: 4 });
  ledger.checkpointBatch([
    { consumer: 'z-reader', epoch: 3, observation_digest: digest('a') },
    { consumer: 'a-reader', epoch: 2, observation_digest: digest('b') },
  ]);
  assert.deepEqual(ledger.resumeAll().map((resume) => resume.consumer), ['a-reader', 'z-reader']);
  assert.equal(ledger.resumeAll().some((resume) => resume.consumer === 'new-reader'), false);
});

test('conditional full resume is empty at the current ledger revision', () => {
  const ledger = new BrowserBrainObservationCursorLedger({ capacity: 4 });
  ledger.checkpointBatch([
    { consumer: 'browsercell-reader', epoch: 3, observation_digest: digest('a') },
    { consumer: 'process-reader', epoch: 4, observation_digest: digest('b') },
  ]);
  const revision = ledger.snapshot().revision;
  const result = ledger.resumeAllIfChanged(revision);
  assert.equal(result.changed, false);
  assert.equal(result.revision, revision);
  assert.deepEqual(result.resumes, []);
  assert.equal(result.payload_persisted, false);
  assert.equal(result.effect_execution_authority, false);
});

test('conditional full resume returns all durable consumers after one applied checkpoint', () => {
  const ledger = new BrowserBrainObservationCursorLedger({ capacity: 4 });
  ledger.checkpoint({ consumer: 'semantic-reader', epoch: 1, observation_digest: digest('a') });
  const knownRevision = ledger.snapshot().revision;
  ledger.checkpoint({ consumer: 'semantic-reader', epoch: 2, observation_digest: digest('b') });
  ledger.checkpoint({ consumer: 'process-reader', epoch: 5, observation_digest: digest('c') });

  const result = ledger.resumeAllIfChanged(knownRevision);
  assert.equal(result.changed, true);
  assert.equal(result.revision, knownRevision + 2);
  assert.deepEqual(result.resumes.map((resume) => resume.consumer), ['process-reader', 'semantic-reader']);
  assert.deepEqual(result.resumes.map((resume) => resume.from_epoch), [5, 2]);
});

test('ledger revision advances only for applied mutations and survives durable restore', () => {
  const ledger = new BrowserBrainObservationCursorLedger({ capacity: 4 });
  const first = { consumer: 'semantic-reader', epoch: 1, observation_digest: digest('a') };
  ledger.checkpoint(first);
  ledger.checkpoint(first);
  ledger.checkpoint({ ...first, epoch: 0 });
  ledger.checkpoint({ consumer: 'process-reader', epoch: 2, observation_digest: digest('b') });
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.revision, 2);

  const restored = BrowserBrainObservationCursorLedger.restore(snapshot);
  assert.equal(restored.snapshot().revision, 2);
  assert.equal(restored.resumeAllIfChanged(2).changed, false);
});

test('conditional resume fails closed on a caller revision ahead of durable state', () => {
  const ledger = new BrowserBrainObservationCursorLedger();
  ledger.checkpoint({ consumer: 'semantic-reader', epoch: 1, observation_digest: digest('a') });
  assert.throws(() => ledger.resumeAllIfChanged(2), /resume_revision_ahead/);
  assert.throws(() => ledger.resumeAllIfChanged(-1), /resume_revision_invalid/);
});

test('restores a durable multi-stream cursor snapshot with one transactional replay', () => {
  const source = new BrowserBrainObservationCursorLedger({ capacity: 4 });
  source.checkpointBatch([
    { consumer: 'browsercell-reader', epoch: 17, observation_digest: digest('a') },
    { consumer: 'process-reader', epoch: 12, observation_digest: digest('b') },
    { consumer: 'semantic-reader', epoch: 21, observation_digest: digest('c') },
  ]);
  const restored = BrowserBrainObservationCursorLedger.restore(source.snapshot());
  assert.deepEqual(restored.snapshot(), source.snapshot());
  assert.equal(restored.resumeFrom('browsercell-reader').from_epoch, 17);
  assert.equal(restored.resumeFrom('process-reader').from_epoch, 12);
  assert.equal(restored.resumeFrom('semantic-reader').from_epoch, 21);
});

test('restores the full 256-consumer durable cursor capacity through bounded chunks', () => {
  const source = new BrowserBrainObservationCursorLedger({ capacity: 256 });
  for (let offset = 0; offset < 256; offset += 128) {
    source.checkpointBatch(Array.from({ length: 128 }, (_, index) => ({
      consumer: `reader-${offset + index}`,
      epoch: offset + index + 1,
      observation_digest: digest('a'),
    })));
  }
  const snapshot = source.snapshot();
  assert.equal(snapshot.consumer_count, 256);

  const restored = BrowserBrainObservationCursorLedger.restore(snapshot);
  assert.deepEqual(restored.snapshot(), snapshot);
  assert.equal(restored.resumeFrom('reader-0').from_epoch, 1);
  assert.equal(restored.resumeFrom('reader-255').from_epoch, 256);
});

test('snapshot restore fails closed on forged authority or duplicate consumers', () => {
  const source = new BrowserBrainObservationCursorLedger({ capacity: 4 });
  source.checkpoint({ consumer: 'semantic-reader', epoch: 3, observation_digest: digest('a') });
  const snapshot = source.snapshot();
  assert.throws(
    () => BrowserBrainObservationCursorLedger.restore({ ...snapshot, dispatch_authority: true }),
    /snapshot_authority_invalid/,
  );
  assert.throws(
    () => BrowserBrainObservationCursorLedger.restore({
      ...snapshot,
      consumer_count: 2,
      cursors: [snapshot.cursors[0], snapshot.cursors[0]],
    }),
    /snapshot_duplicate_invalid/,
  );
});

test('snapshot restore rejects state above the declared consumer ceiling', () => {
  const source = new BrowserBrainObservationCursorLedger();
  const snapshot = source.snapshot();
  const cursors = Array.from({ length: 257 }, (_, index) => ({
    consumer: `reader-${index}`,
    epoch: index + 1,
    observation_digest: digest('a'),
  }));
  assert.throws(
    () => BrowserBrainObservationCursorLedger.restore({
      ...snapshot,
      capacity: 256,
      consumer_count: cursors.length,
      cursors,
    }),
    /snapshot_cursors_invalid/,
  );
});

test('snapshot restore rejects a revision below durable consumer count', () => {
  const source = new BrowserBrainObservationCursorLedger({ capacity: 4 });
  source.checkpointBatch([
    { consumer: 'semantic-reader', epoch: 1, observation_digest: digest('a') },
    { consumer: 'process-reader', epoch: 1, observation_digest: digest('b') },
  ]);
  const snapshot = source.snapshot();
  assert.throws(
    () => BrowserBrainObservationCursorLedger.restore({ ...snapshot, revision: 1 }),
    /snapshot_revision_invalid/,
  );
});

test('failed batch rolls back every staged cursor mutation', () => {
  const ledger = new BrowserBrainObservationCursorLedger({ capacity: 4 });
  ledger.checkpoint({ consumer: 'semantic-reader', epoch: 3, observation_digest: digest('a') });
  assert.throws(
    () => ledger.checkpointBatch([
      { consumer: 'process-reader', epoch: 4, observation_digest: digest('b') },
      { consumer: 'semantic-reader', epoch: 3, observation_digest: digest('c') },
    ]),
    /epoch_collision/,
  );
  assert.equal(ledger.get('process-reader'), null);
  assert.equal(ledger.get('semantic-reader').observation_digest, digest('a'));
});

test('empty batch is identity and oversized batches fail before mutation', () => {
  const ledger = new BrowserBrainObservationCursorLedger();
  assert.deepEqual(ledger.checkpointBatch([]), []);
  assert.throws(
    () => ledger.checkpointBatch(Array.from({ length: 129 }, (_, index) => ({
      consumer: `reader-${index}`,
      epoch: 1,
      observation_digest: digest('a'),
    }))),
    /batch_invalid/,
  );
  assert.equal(ledger.snapshot().consumer_count, 0);
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
  assert.equal(snapshot.revision, 2);
  assert.equal('payload' in snapshot, false);
  assert.equal(snapshot.payload_persisted, false);
});

test('contract is provider-neutral and zero-authority with no retry synthesis', () => {
  const contract = browserBrainObservationCursorContract();
  assert.equal(contract.provider_neutral, true);
  assert.equal(contract.monotonic_epoch, true);
  assert.equal(contract.monotonic_ledger_revision, true);
  assert.equal(contract.transactional_batch_checkpoint, true);
  assert.equal(contract.transactional_snapshot_restore, true);
  assert.equal(contract.chunked_full_capacity_snapshot_restore, true);
  assert.equal(contract.bounded_batch_resume, true);
  assert.equal(contract.bounded_full_capacity_resume, true);
  assert.equal(contract.revision_gated_conditional_resume, true);
  assert.equal(contract.unchanged_conditional_resume_is_empty, true);
  assert.equal(contract.max_consumers, 256);
  assert.equal(contract.max_batch_checkpoints, 128);
  assert.equal(contract.max_batch_resumes, 128);
  assert.equal(contract.max_full_capacity_resumes, 256);
  assert.equal(contract.max_snapshot_restore_consumers, 256);
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
