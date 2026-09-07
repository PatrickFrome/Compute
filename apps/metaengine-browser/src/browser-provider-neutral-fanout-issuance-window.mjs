import { createHash } from 'node:crypto';
import { projectProviderNeutralFanoutCapacity } from './browser-provider-neutral-fanout-capacity-projection.mjs';

const SCHEMA = 'metaengine.browser.provider-neutral-fanout-issuance-window.v1';
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

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function projectProviderNeutralFanoutIssuanceWindow(checkpointInput, options = {}) {
  const capacity = projectProviderNeutralFanoutCapacity(checkpointInput, options);
  const startIndex = capacity.issued_count;
  const endExclusive = startIndex + capacity.projected_count;
  const indices = Object.freeze(Array.from({ length: capacity.projected_count }, (_, offset) => startIndex + offset));
  const core = Object.freeze({
    schema: SCHEMA,
    action_id: capacity.action_id,
    action_digest: capacity.action_digest,
    checkpoint_digest: capacity.checkpoint_digest,
    capacity_projection_digest: capacity.projection_digest,
    expected_count: capacity.expected_count,
    received_count: capacity.received_count,
    issued_count: capacity.issued_count,
    requested_count: capacity.requested_count,
    max_parallel: capacity.max_parallel,
    projected_count: capacity.projected_count,
    deferred_count: capacity.deferred_count,
    start_index: startIndex,
    end_exclusive: endExclusive,
    indices,
  });

  return Object.freeze({
    ...core,
    issuance_window_digest: digest(core),
    ...ZERO_AUTHORITY,
  });
}

export function providerNeutralFanoutIssuanceWindowContract() {
  return Object.freeze({
    schema: 'metaengine.browser.provider-neutral-fanout-issuance-window-contract.v1',
    capacity_projection_digest_fenced: true,
    deterministic_contiguous_indices: true,
    bounded_projection_only: true,
    queue_persisted: false,
    reservation_authority: false,
    provider_neutral: true,
    ...ZERO_AUTHORITY,
  });
}
