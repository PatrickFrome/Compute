import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainObservationCursorLedger } from '../src/browser-brain-observation-cursors.mjs';
import {
  applyBrowserBrainObservationResumeAcknowledgements,
  browserBrainObservationResumeAckContract,
} from '../src/browser-brain-observation-resume-acks.mjs';

const digest = (value) => value.toString(16).padStart(64, '0');

function replayResult(consumers = ['fleet-memory', 'semantic-indexer']) {
  return Object.freeze({
    schema: 'metaengine.browser-brain.shared-observation-resume-reads.v1',
    shared_reads: Object.freeze([
      Object.freeze({
        from_epoch: 2,
        to_epoch: 4,
        consumers: Object.freeze(consumers),
        consumer_count: consumers.length,
        replay_required: true,
        events: Object.freeze([
          Object.freeze({ epoch: 3, digest: digest(3) }),
          Object.freeze({ epoch: 4, digest: digest(4) }),
        ]),
      }),
    ]),
    canonical_resync: Object.freeze([]),
  });
}

function acknowledgements(consumers = ['fleet-memory', 'semantic-indexer']) {
  return consumers.map((consumer) => ({ consumer, epoch: 4, observation_digest: digest(4) }));
}

test('exact shared-delivery acknowledgements advance all durable cursors', () => {
  const ledger = new BrowserBrainObservationCursorLedger();
  ledger.checkpoint({ consumer: 'fleet-memory', epoch: 2, observation_digest: digest(2) });
  ledger.checkpoint({ consumer: 'semantic-indexer', epoch: 2, observation_digest: digest(2) });

  const result = applyBrowserBrainObservationResumeAcknowledgements({
    ledger,
    result: replayResult(),
    acknowledgements: acknowledgements(),
  });

  assert.equal(result.expected_ack_count, 2);
  assert.equal(result.applied_ack_count, 2);
  assert.equal(ledger.get('fleet-memory').epoch, 4);
  assert.equal(ledger.get('semantic-indexer').observation_digest, digest(4));
});

test('mismatched delivery proof fails before any cursor mutation', () => {
  const ledger = new BrowserBrainObservationCursorLedger();
  ledger.checkpoint({ consumer: 'fleet-memory', epoch: 2, observation_digest: digest(2) });
  ledger.checkpoint({ consumer: 'semantic-indexer', epoch: 2, observation_digest: digest(2) });
  const bad = acknowledgements();
  bad[1] = { ...bad[1], observation_digest: digest(99) };

  assert.throws(() => applyBrowserBrainObservationResumeAcknowledgements({
    ledger,
    result: replayResult(),
    acknowledgements: bad,
  }), /proof_mismatch/);
  assert.equal(ledger.get('fleet-memory').epoch, 2);
  assert.equal(ledger.get('semantic-indexer').epoch, 2);
});

test('incomplete acknowledgement batch fails closed before mutation', () => {
  const ledger = new BrowserBrainObservationCursorLedger();
  ledger.checkpoint({ consumer: 'fleet-memory', epoch: 2, observation_digest: digest(2) });

  assert.throws(() => applyBrowserBrainObservationResumeAcknowledgements({
    ledger,
    result: replayResult(['fleet-memory', 'semantic-indexer']),
    acknowledgements: acknowledgements(['fleet-memory']),
  }), /ack_incomplete/);
  assert.equal(ledger.get('fleet-memory').epoch, 2);
});

test('canonical-resync consumers cannot be acknowledged as replay delivery', () => {
  const ledger = new BrowserBrainObservationCursorLedger();
  const result = Object.freeze({
    schema: 'metaengine.browser-brain.shared-observation-resume-reads.v1',
    shared_reads: Object.freeze([]),
    canonical_resync: Object.freeze([
      Object.freeze({ consumer: 'stale-reader', from_epoch: 1, canonical_resync_required: true }),
    ]),
  });

  assert.throws(() => applyBrowserBrainObservationResumeAcknowledgements({
    ledger,
    result,
    acknowledgements: [{ consumer: 'stale-reader', epoch: 4, observation_digest: digest(4) }],
  }), /unexpected_consumer/);
  assert.equal(ledger.get('stale-reader'), null);
});

test('preflight rejects a newer durable cursor without partial batch mutation', () => {
  const ledger = new BrowserBrainObservationCursorLedger();
  ledger.checkpoint({ consumer: 'fleet-memory', epoch: 2, observation_digest: digest(2) });
  ledger.checkpoint({ consumer: 'semantic-indexer', epoch: 5, observation_digest: digest(5) });

  assert.throws(() => applyBrowserBrainObservationResumeAcknowledgements({
    ledger,
    result: replayResult(),
    acknowledgements: acknowledgements(),
  }), /ack_regression/);
  assert.equal(ledger.get('fleet-memory').epoch, 2);
  assert.equal(ledger.get('semantic-indexer').epoch, 5);
});

test('contract remains provider-neutral and zero-authority', () => {
  const contract = browserBrainObservationResumeAckContract();
  assert.equal(contract.exact_delivery_proof_required, true);
  assert.equal(contract.complete_batch_required, true);
  assert.equal(contract.preflight_before_cursor_mutation, true);
  assert.equal(contract.canonical_resync_not_acknowledgeable, true);
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
