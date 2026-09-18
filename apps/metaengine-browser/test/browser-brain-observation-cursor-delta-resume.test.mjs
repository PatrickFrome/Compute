import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrowserBrainObservationCursorLedger,
  browserBrainObservationCursorContract,
} from '../src/browser-brain-observation-cursors.mjs';

const digest = (char) => char.repeat(64);

test('delta resume returns only realtime consumers changed after the known revision', () => {
  const ledger = new BrowserBrainObservationCursorLedger({ capacity: 8 });
  ledger.checkpointBatch([
    { consumer: 'browsercell-reader', epoch: 5, observation_digest: digest('a') },
    { consumer: 'process-reader', epoch: 7, observation_digest: digest('b') },
    { consumer: 'semantic-reader', epoch: 9, observation_digest: digest('c') },
    { consumer: 'fleet-memory', epoch: 3, observation_digest: digest('d') },
  ]);
  const knownRevision = ledger.snapshot().revision;

  ledger.checkpoint({ consumer: 'semantic-reader', epoch: 10, observation_digest: digest('e') });
  ledger.checkpoint({ consumer: 'process-reader', epoch: 8, observation_digest: digest('f') });

  const delta = ledger.resumeChangedSince(knownRevision);
  assert.equal(delta.changed, true);
  assert.equal(delta.revision, knownRevision + 2);
  assert.deepEqual(delta.resumes.map((resume) => resume.consumer), ['process-reader', 'semantic-reader']);
  assert.deepEqual(delta.resumes.map((resume) => resume.from_epoch), [8, 10]);
  assert.equal(delta.resumes.every((resume) => resume.payload_persisted === false), true);
  assert.equal(delta.resumes.every((resume) => resume.effect_execution_authority === false), true);
});

test('delta resume is empty at current revision and duplicates do not create false changes', () => {
  const ledger = new BrowserBrainObservationCursorLedger({ capacity: 4 });
  const cursor = { consumer: 'semantic-reader', epoch: 1, observation_digest: digest('a') };
  ledger.checkpoint(cursor);
  const revision = ledger.snapshot().revision;
  assert.equal(ledger.checkpoint(cursor).disposition, 'DUPLICATE');
  assert.equal(ledger.checkpoint({ ...cursor, epoch: 0 }).disposition, 'REGRESSION');

  const delta = ledger.resumeChangedSince(revision);
  assert.equal(delta.changed, false);
  assert.equal(delta.revision, revision);
  assert.deepEqual(delta.resumes, []);
});

test('delta change index survives durable snapshot restore exactly', () => {
  const ledger = new BrowserBrainObservationCursorLedger({ capacity: 8 });
  ledger.checkpointBatch([
    { consumer: 'browsercell-reader', epoch: 1, observation_digest: digest('a') },
    { consumer: 'process-reader', epoch: 1, observation_digest: digest('b') },
    { consumer: 'semantic-reader', epoch: 1, observation_digest: digest('c') },
  ]);
  const knownRevision = ledger.snapshot().revision;
  ledger.checkpoint({ consumer: 'semantic-reader', epoch: 2, observation_digest: digest('d') });

  const snapshot = ledger.snapshot();
  const restored = BrowserBrainObservationCursorLedger.restore(snapshot);
  assert.deepEqual(restored.snapshot(), snapshot);
  assert.deepEqual(restored.resumeChangedSince(knownRevision).resumes.map((resume) => resume.consumer), [
    'semantic-reader',
  ]);
});

test('legacy revision snapshots without a change index restore conservatively', () => {
  const ledger = new BrowserBrainObservationCursorLedger({ capacity: 4 });
  ledger.checkpointBatch([
    { consumer: 'process-reader', epoch: 4, observation_digest: digest('a') },
    { consumer: 'semantic-reader', epoch: 6, observation_digest: digest('b') },
  ]);
  const snapshot = ledger.snapshot();
  const { change_revisions: _ignored, ...legacySnapshot } = snapshot;
  const restored = BrowserBrainObservationCursorLedger.restore(legacySnapshot);

  assert.deepEqual(restored.resumeChangedSince(snapshot.revision - 1).resumes.map((resume) => resume.consumer), [
    'process-reader',
    'semantic-reader',
  ]);
  assert.deepEqual(restored.resumeChangedSince(snapshot.revision).resumes, []);
});

test('snapshot restore rejects forged change revision metadata fail closed', () => {
  const ledger = new BrowserBrainObservationCursorLedger({ capacity: 4 });
  ledger.checkpoint({ consumer: 'semantic-reader', epoch: 1, observation_digest: digest('a') });
  const snapshot = ledger.snapshot();

  assert.throws(
    () => BrowserBrainObservationCursorLedger.restore({
      ...snapshot,
      change_revisions: [{ consumer: 'semantic-reader', revision: snapshot.revision + 1 }],
    }),
    /snapshot_change_revisions_invalid/,
  );
  assert.throws(
    () => BrowserBrainObservationCursorLedger.restore({ ...snapshot, change_revisions: [] }),
    /snapshot_change_revisions_invalid/,
  );
});

test('delta resume stays bounded, provider-neutral and zero-authority', () => {
  const ledger = new BrowserBrainObservationCursorLedger({ capacity: 256 });
  for (let offset = 0; offset < 256; offset += 128) {
    ledger.checkpointBatch(Array.from({ length: 128 }, (_, index) => ({
      consumer: `reader-${String(offset + index).padStart(3, '0')}`,
      epoch: 1,
      observation_digest: digest('a'),
    })));
  }
  const delta = ledger.resumeChangedSince(0);
  assert.equal(delta.resumes.length, 256);
  assert.equal(delta.scheduler_authority, false);
  assert.equal(delta.dispatch_authority, false);
  assert.equal(delta.lease_authority, false);
  assert.equal(delta.automatic_retry_allowed, false);

  const contract = browserBrainObservationCursorContract();
  assert.equal(contract.revision_gated_delta_resume, true);
  assert.equal(contract.durable_change_revision_index, true);
  assert.equal(contract.max_delta_resumes, 256);
  assert.equal(contract.provider_neutral, true);
  assert.equal(contract.effect_execution_authority, false);
});
