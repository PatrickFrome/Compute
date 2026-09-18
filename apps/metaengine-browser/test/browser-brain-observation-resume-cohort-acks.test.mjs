import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainObservationCursorLedger } from '../src/browser-brain-observation-cursors.mjs';
import {
  applyBrowserBrainObservationResumeCohortAcknowledgements,
  browserBrainObservationResumeCohortAckContract,
  browserBrainObservationResumeCohortDigest,
} from '../src/browser-brain-observation-resume-cohort-acks.mjs';

const digest = (value) => value.toString(16).padStart(64, '0');

function resultFor(consumers = ['fleet-memory', 'semantic-indexer']) {
  return Object.freeze({
    schema: 'metaengine.browser-brain.shared-observation-resume-reads.v1',
    shared_reads: Object.freeze([
      Object.freeze({
        from_epoch: 2,
        to_epoch: 4,
        consumers: Object.freeze(consumers),
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

function ackFor(consumers = ['fleet-memory', 'semantic-indexer']) {
  return [{
    cohort_digest: browserBrainObservationResumeCohortDigest({
      from_epoch: 2,
      to_epoch: 4,
      terminal_digest: digest(4),
      consumers,
    }),
  }];
}

test('one cohort acknowledgement advances every durable consumer cursor', () => {
  const ledger = new BrowserBrainObservationCursorLedger();
  ledger.checkpoint({ consumer: 'fleet-memory', epoch: 2, observation_digest: digest(2) });
  ledger.checkpoint({ consumer: 'semantic-indexer', epoch: 2, observation_digest: digest(2) });

  const applied = applyBrowserBrainObservationResumeCohortAcknowledgements({
    ledger,
    result: resultFor(),
    acknowledgements: ackFor(),
  });

  assert.equal(applied.applied_cohort_ack_count, 1);
  assert.equal(applied.applied_cursor_count, 2);
  assert.equal(ledger.get('fleet-memory').epoch, 4);
  assert.equal(ledger.get('semantic-indexer').observation_digest, digest(4));
});

test('cohort digest is deterministic across consumer ordering and binds membership', () => {
  const first = browserBrainObservationResumeCohortDigest({
    from_epoch: 2,
    to_epoch: 4,
    terminal_digest: digest(4),
    consumers: ['semantic-indexer', 'fleet-memory'],
  });
  const second = browserBrainObservationResumeCohortDigest({
    from_epoch: 2,
    to_epoch: 4,
    terminal_digest: digest(4),
    consumers: ['fleet-memory', 'semantic-indexer'],
  });
  const changed = browserBrainObservationResumeCohortDigest({
    from_epoch: 2,
    to_epoch: 4,
    terminal_digest: digest(4),
    consumers: ['fleet-memory'],
  });

  assert.equal(first, second);
  assert.notEqual(first, changed);
});

test('wrong or incomplete cohort proof fails before any cursor mutation', () => {
  const ledger = new BrowserBrainObservationCursorLedger();
  ledger.checkpoint({ consumer: 'fleet-memory', epoch: 2, observation_digest: digest(2) });
  ledger.checkpoint({ consumer: 'semantic-indexer', epoch: 2, observation_digest: digest(2) });

  assert.throws(() => applyBrowserBrainObservationResumeCohortAcknowledgements({
    ledger,
    result: resultFor(),
    acknowledgements: [{ cohort_digest: digest(99) }],
  }), /cohort_ack_unexpected/);
  assert.equal(ledger.get('fleet-memory').epoch, 2);
  assert.equal(ledger.get('semantic-indexer').epoch, 2);
});

test('newer durable cursor fences the entire cohort before partial mutation', () => {
  const ledger = new BrowserBrainObservationCursorLedger();
  ledger.checkpoint({ consumer: 'fleet-memory', epoch: 2, observation_digest: digest(2) });
  ledger.checkpoint({ consumer: 'semantic-indexer', epoch: 5, observation_digest: digest(5) });

  assert.throws(() => applyBrowserBrainObservationResumeCohortAcknowledgements({
    ledger,
    result: resultFor(),
    acknowledgements: ackFor(),
  }), /cohort_ack_regression/);
  assert.equal(ledger.get('fleet-memory').epoch, 2);
  assert.equal(ledger.get('semantic-indexer').epoch, 5);
});

test('canonical-resync membership cannot overlap an acknowledged cohort', () => {
  const ledger = new BrowserBrainObservationCursorLedger();
  const result = {
    ...resultFor(['fleet-memory']),
    canonical_resync: Object.freeze([
      Object.freeze({ consumer: 'fleet-memory', canonical_resync_required: true }),
    ]),
  };

  assert.throws(() => applyBrowserBrainObservationResumeCohortAcknowledgements({
    ledger,
    result,
    acknowledgements: ackFor(['fleet-memory']),
  }), /consumer_collision/);
  assert.equal(ledger.get('fleet-memory'), null);
});

test('contract stays provider-neutral, payload-free and zero-authority', () => {
  const contract = browserBrainObservationResumeCohortAckContract();
  assert.equal(contract.one_ack_per_shared_read_cohort, true);
  assert.equal(contract.cohort_digest_binds_members_and_terminal_observation, true);
  assert.equal(contract.complete_batch_required, true);
  assert.equal(contract.preflight_before_cursor_mutation, true);
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
