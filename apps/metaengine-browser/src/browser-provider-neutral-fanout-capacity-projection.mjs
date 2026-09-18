import { createHash } from 'node:crypto';
import { restoreProviderNeutralFanoutDurableCheckpoint } from './browser-provider-neutral-fanout-durable-checkpoint.mjs';

const SCHEMA = 'metaengine.browser.provider-neutral-fanout-capacity-projection.v1';
const MAX_FANOUT = 128;
const ZERO_AUTHORITY = Object.freeze({
  payload_persisted: false,
  semantic_payload_persisted: false,
  scheduler_authority: false,
  dispatch_authority: false,
  lease_authority: false,
  effect_execution_authority: false,
  automatic_retry_allowed: false,
  ambiguous_retry_allowed: false,
  authority_effect: false,
});

function boundedInteger(value, name, { min = 0, max = MAX_FANOUT } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`fanout_capacity_${name}_invalid`);
  }
  return number;
}

function digestProjection(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function projectProviderNeutralFanoutCapacity(checkpointInput, options = {}) {
  const checkpoint = restoreProviderNeutralFanoutDurableCheckpoint(checkpointInput).checkpoint();
  const expectedCount = boundedInteger(checkpoint.expected_count, 'expected_count', { min: 1 });
  const issuedCount = boundedInteger(options.issued_count, 'issued_count');
  const requestedCount = boundedInteger(options.requested_count, 'requested_count');
  const maxParallel = boundedInteger(options.max_parallel, 'max_parallel', { min: 1 });
  const receivedCount = boundedInteger(checkpoint.received_count, 'received_count');

  if (issuedCount < receivedCount || issuedCount > expectedCount) {
    throw new Error('fanout_capacity_issued_count_inconsistent');
  }

  const inFlight = issuedCount - receivedCount;
  const availableCredits = Math.max(0, maxParallel - inFlight);
  const remainingUnissued = expectedCount - issuedCount;
  const projectedCount = Math.min(requestedCount, availableCredits, remainingUnissued);
  const deferredCount = requestedCount - projectedCount;
  const projectionCore = Object.freeze({
    schema: SCHEMA,
    action_id: checkpoint.action_id,
    action_digest: checkpoint.action_digest,
    checkpoint_digest: checkpoint.checkpoint_digest,
    expected_count: expectedCount,
    received_count: receivedCount,
    issued_count: issuedCount,
    requested_count: requestedCount,
    max_parallel: maxParallel,
    in_flight: inFlight,
    available_credits: availableCredits,
    remaining_unissued: remainingUnissued,
    projected_count: projectedCount,
    deferred_count: deferredCount,
  });

  return Object.freeze({
    ...projectionCore,
    projection_digest: digestProjection(projectionCore),
    ...ZERO_AUTHORITY,
  });
}

export function providerNeutralFanoutCapacityProjectionContract() {
  return Object.freeze({
    schema: 'metaengine.browser.provider-neutral-fanout-capacity-projection-contract.v1',
    max_fanout: MAX_FANOUT,
    checkpoint_digest_fenced: true,
    bounded_projection_only: true,
    queue_persisted: false,
    provider_neutral: true,
    ...ZERO_AUTHORITY,
  });
}
