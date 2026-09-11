import { createHash } from 'node:crypto';
import {
  projectProviderNeutralFanoutCapacity,
  providerNeutralFanoutCapacityProjectionContract,
} from './browser-provider-neutral-fanout-capacity-projection.mjs';

const SCHEMA = 'metaengine.browser.provider-neutral-fanout-issuance-window.v1';

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function projectProviderNeutralFanoutIssuanceWindow(checkpointInput, options = {}) {
  const capacity = projectProviderNeutralFanoutCapacity(checkpointInput, options);
  const startIndex = capacity.issued_count;
  const endExclusive = startIndex + capacity.projected_count;
  const indices = Object.freeze(Array.from({ length: capacity.projected_count }, (_, offset) => startIndex + offset));
  const core = Object.freeze({
    ...capacity,
    schema: SCHEMA,
    capacity_projection_digest: capacity.projection_digest,
    start_index: startIndex,
    end_exclusive: endExclusive,
    indices,
  });

  return Object.freeze({
    ...core,
    issuance_window_digest: digest(core),
  });
}

export function providerNeutralFanoutIssuanceWindowContract() {
  const capacityContract = providerNeutralFanoutCapacityProjectionContract();
  return Object.freeze({
    ...capacityContract,
    schema: 'metaengine.browser.provider-neutral-fanout-issuance-window-contract.v1',
    capacity_projection_digest_fenced: true,
    deterministic_contiguous_indices: true,
    reservation_authority: false,
  });
}
