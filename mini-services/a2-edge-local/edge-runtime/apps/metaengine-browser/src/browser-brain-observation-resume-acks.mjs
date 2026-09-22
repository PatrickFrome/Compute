const ZERO_AUTHORITY = Object.freeze({
  scheduler_authority: false,
  dispatch_authority: false,
  lease_authority: false,
  effect_execution_authority: false,
  automatic_retry_allowed: false,
  authority_effect: false,
});

function normalizeDigest(value, code) {
  const digest = String(value ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new TypeError(code);
  return digest;
}

function normalizeEpoch(value, code) {
  const epoch = Number(value);
  if (!Number.isSafeInteger(epoch) || epoch < 0) throw new TypeError(code);
  return epoch;
}

function assertLedger(ledger) {
  if (!ledger || typeof ledger.get !== 'function' || typeof ledger.checkpoint !== 'function') {
    throw new TypeError('browser_brain_resume_ack_ledger_invalid');
  }
}

function assertReadResult(result) {
  if (!result || result.schema !== 'metaengine.browser-brain.shared-observation-resume-reads.v1') {
    throw new TypeError('browser_brain_resume_ack_result_invalid');
  }
  if (!Array.isArray(result.shared_reads) || !Array.isArray(result.canonical_resync)) {
    throw new TypeError('browser_brain_resume_ack_result_invalid');
  }
}

export function applyBrowserBrainObservationResumeAcknowledgements({ ledger, result, acknowledgements } = {}) {
  assertLedger(ledger);
  assertReadResult(result);
  if (!Array.isArray(acknowledgements)) throw new TypeError('browser_brain_resume_ack_list_invalid');

  const expected = new Map();
  const blockedConsumers = new Set(result.canonical_resync.map((entry) => entry.consumer));

  for (const read of result.shared_reads) {
    if (!read.replay_required) continue;
    if (!Array.isArray(read.events) || read.events.length === 0) {
      throw new Error('browser_brain_resume_ack_read_without_proof');
    }
    const lastEvent = read.events.at(-1);
    const digest = normalizeDigest(lastEvent?.digest, 'browser_brain_resume_ack_read_digest_invalid');
    const toEpoch = normalizeEpoch(read.to_epoch, 'browser_brain_resume_ack_read_epoch_invalid');
    for (const consumer of read.consumers) {
      if (expected.has(consumer) || blockedConsumers.has(consumer)) {
        throw new Error('browser_brain_resume_ack_consumer_collision');
      }
      expected.set(consumer, Object.freeze({ consumer, epoch: toEpoch, observation_digest: digest }));
    }
  }

  const supplied = new Map();
  for (const input of acknowledgements) {
    if (!input || typeof input !== 'object') throw new TypeError('browser_brain_resume_ack_invalid');
    const consumer = String(input.consumer ?? '').trim();
    if (!expected.has(consumer)) throw new Error('browser_brain_resume_ack_unexpected_consumer');
    if (supplied.has(consumer)) throw new Error('browser_brain_resume_ack_duplicate_consumer');
    const epoch = normalizeEpoch(input.epoch, 'browser_brain_resume_ack_epoch_invalid');
    const observationDigest = normalizeDigest(input.observation_digest, 'browser_brain_resume_ack_digest_invalid');
    const proof = expected.get(consumer);
    if (epoch !== proof.epoch || observationDigest !== proof.observation_digest) {
      throw new Error('browser_brain_resume_ack_proof_mismatch');
    }
    supplied.set(consumer, proof);
  }

  if (supplied.size !== expected.size) throw new Error('browser_brain_resume_ack_incomplete');

  for (const proof of supplied.values()) {
    const existing = ledger.get(proof.consumer);
    if (!existing) continue;
    if (existing.epoch > proof.epoch) throw new Error('browser_brain_resume_ack_regression');
    if (existing.epoch === proof.epoch && existing.observation_digest !== proof.observation_digest) {
      throw new Error('browser_brain_resume_ack_epoch_collision');
    }
  }

  const applied = [];
  for (const proof of supplied.values()) {
    applied.push(ledger.checkpoint(proof));
  }

  return Object.freeze({
    schema: 'metaengine.browser-brain.observation-resume-acks.v1',
    expected_ack_count: expected.size,
    applied_ack_count: applied.length,
    applied: Object.freeze(applied),
    canonical_resync_count: blockedConsumers.size,
    payload_persisted: false,
    provider_neutral: true,
    ...ZERO_AUTHORITY,
  });
}

export function browserBrainObservationResumeAckContract() {
  return Object.freeze({
    schema: 'metaengine.browser-brain.observation-resume-ack-contract.v1',
    exact_delivery_proof_required: true,
    complete_batch_required: true,
    preflight_before_cursor_mutation: true,
    canonical_resync_not_acknowledgeable: true,
    payload_persisted: false,
    provider_neutral: true,
    ...ZERO_AUTHORITY,
  });
}
