import { createHash } from 'node:crypto';

const ZERO_AUTHORITY = Object.freeze({
  scheduler_authority: false,
  dispatch_authority: false,
  lease_authority: false,
  effect_execution_authority: false,
  automatic_retry_allowed: false,
  authority_effect: false,
});

function digest64(value, code) {
  const digest = String(value ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new TypeError(code);
  return digest;
}

function epoch(value, code) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) throw new TypeError(code);
  return normalized;
}

function consumer(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError('browser_brain_cohort_ack_consumer_invalid');
  return normalized;
}

function assertLedger(ledger) {
  if (!ledger || typeof ledger.get !== 'function' || typeof ledger.checkpoint !== 'function') {
    throw new TypeError('browser_brain_cohort_ack_ledger_invalid');
  }
}

function assertReadResult(result) {
  if (!result || result.schema !== 'metaengine.browser-brain.shared-observation-resume-reads.v1') {
    throw new TypeError('browser_brain_cohort_ack_result_invalid');
  }
  if (!Array.isArray(result.shared_reads) || !Array.isArray(result.canonical_resync)) {
    throw new TypeError('browser_brain_cohort_ack_result_invalid');
  }
}

export function browserBrainObservationResumeCohortDigest({ from_epoch, to_epoch, terminal_digest, consumers } = {}) {
  const fromEpoch = epoch(from_epoch, 'browser_brain_cohort_ack_from_epoch_invalid');
  const toEpoch = epoch(to_epoch, 'browser_brain_cohort_ack_to_epoch_invalid');
  if (toEpoch < fromEpoch) throw new Error('browser_brain_cohort_ack_epoch_order_invalid');
  const terminalDigest = digest64(terminal_digest, 'browser_brain_cohort_ack_terminal_digest_invalid');
  if (!Array.isArray(consumers) || consumers.length === 0) throw new TypeError('browser_brain_cohort_ack_consumers_invalid');
  const members = consumers.map(consumer).sort((a, b) => a.localeCompare(b));
  if (new Set(members).size !== members.length) throw new Error('browser_brain_cohort_ack_consumer_collision');
  return createHash('sha256')
    .update(`metaengine.browser-brain.observation-resume-cohort-ack.v1\n${fromEpoch}\n${toEpoch}\n${terminalDigest}\n${members.join('\n')}`)
    .digest('hex');
}

export function applyBrowserBrainObservationResumeCohortAcknowledgements({ ledger, result, acknowledgements } = {}) {
  assertLedger(ledger);
  assertReadResult(result);
  if (!Array.isArray(acknowledgements)) throw new TypeError('browser_brain_cohort_ack_list_invalid');

  const blocked = new Set(result.canonical_resync.map((entry) => consumer(entry?.consumer)));
  const expected = new Map();
  const seenConsumers = new Set(blocked);

  for (const read of result.shared_reads) {
    if (!read?.replay_required) continue;
    if (!Array.isArray(read.events) || read.events.length === 0) throw new Error('browser_brain_cohort_ack_read_without_proof');
    if (!Array.isArray(read.consumers) || read.consumers.length === 0) throw new Error('browser_brain_cohort_ack_read_without_consumers');
    const members = read.consumers.map(consumer);
    for (const member of members) {
      if (seenConsumers.has(member)) throw new Error('browser_brain_cohort_ack_consumer_collision');
      seenConsumers.add(member);
    }
    const fromEpoch = epoch(read.from_epoch, 'browser_brain_cohort_ack_from_epoch_invalid');
    const toEpoch = epoch(read.to_epoch, 'browser_brain_cohort_ack_to_epoch_invalid');
    const terminalDigest = digest64(read.events.at(-1)?.digest, 'browser_brain_cohort_ack_terminal_digest_invalid');
    const cohortDigest = browserBrainObservationResumeCohortDigest({
      from_epoch: fromEpoch,
      to_epoch: toEpoch,
      terminal_digest: terminalDigest,
      consumers: members,
    });
    if (expected.has(cohortDigest)) throw new Error('browser_brain_cohort_ack_digest_collision');
    expected.set(cohortDigest, Object.freeze({ members: Object.freeze(members), toEpoch, terminalDigest }));
  }

  const supplied = new Set();
  for (const acknowledgement of acknowledgements) {
    const cohortDigest = digest64(acknowledgement?.cohort_digest, 'browser_brain_cohort_ack_digest_invalid');
    if (!expected.has(cohortDigest)) throw new Error('browser_brain_cohort_ack_unexpected');
    if (supplied.has(cohortDigest)) throw new Error('browser_brain_cohort_ack_duplicate');
    supplied.add(cohortDigest);
  }
  if (supplied.size !== expected.size) throw new Error('browser_brain_cohort_ack_incomplete');

  for (const proof of expected.values()) {
    for (const member of proof.members) {
      const existing = ledger.get(member);
      if (!existing) continue;
      if (existing.epoch > proof.toEpoch) throw new Error('browser_brain_cohort_ack_regression');
      if (existing.epoch === proof.toEpoch && existing.observation_digest !== proof.terminalDigest) {
        throw new Error('browser_brain_cohort_ack_epoch_collision');
      }
    }
  }

  let appliedCursorCount = 0;
  for (const cohortDigest of supplied) {
    const proof = expected.get(cohortDigest);
    for (const member of proof.members) {
      ledger.checkpoint({ consumer: member, epoch: proof.toEpoch, observation_digest: proof.terminalDigest });
      appliedCursorCount += 1;
    }
  }

  return Object.freeze({
    schema: 'metaengine.browser-brain.observation-resume-cohort-acks.v1',
    expected_cohort_ack_count: expected.size,
    applied_cohort_ack_count: supplied.size,
    applied_cursor_count: appliedCursorCount,
    canonical_resync_count: blocked.size,
    payload_persisted: false,
    provider_neutral: true,
    ...ZERO_AUTHORITY,
  });
}

export function browserBrainObservationResumeCohortAckContract() {
  return Object.freeze({
    schema: 'metaengine.browser-brain.observation-resume-cohort-ack-contract.v1',
    one_ack_per_shared_read_cohort: true,
    cohort_digest_binds_members_and_terminal_observation: true,
    complete_batch_required: true,
    preflight_before_cursor_mutation: true,
    canonical_resync_not_acknowledgeable: true,
    payload_persisted: false,
    provider_neutral: true,
    ...ZERO_AUTHORITY,
  });
}
