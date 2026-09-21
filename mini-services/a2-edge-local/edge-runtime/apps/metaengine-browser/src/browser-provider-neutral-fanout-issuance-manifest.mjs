import { createHash } from 'node:crypto';
import {
  projectProviderNeutralFanoutIssuanceWindow,
  providerNeutralFanoutIssuanceWindowContract,
} from './browser-provider-neutral-fanout-issuance-window.mjs';

const SCHEMA = 'metaengine.browser.provider-neutral-fanout-issuance-manifest.v1';
const DIGEST_RE = /^[0-9a-f]{64}$/;

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeTargetDigests(value, expectedCount) {
  if (!Array.isArray(value) || value.length !== expectedCount) {
    throw new Error('fanout_issuance_manifest_target_count_mismatch');
  }
  return Object.freeze(value.map((targetDigest) => {
    const normalized = String(targetDigest ?? '').trim().toLowerCase();
    if (!DIGEST_RE.test(normalized)) {
      throw new Error('fanout_issuance_manifest_target_digest_invalid');
    }
    return normalized;
  }));
}

export function projectProviderNeutralFanoutIssuanceManifest(checkpointInput, options = {}) {
  const window = projectProviderNeutralFanoutIssuanceWindow(checkpointInput, options);
  const targetDigests = normalizeTargetDigests(options.target_binding_digests, window.projected_count);
  const entries = Object.freeze(window.indices.map((fanoutIndex, offset) => Object.freeze({
    fanout_index: fanoutIndex,
    target_binding_digest: targetDigests[offset],
    entry_digest: digest({
      issuance_window_digest: window.issuance_window_digest,
      fanout_index: fanoutIndex,
      target_binding_digest: targetDigests[offset],
    }),
  })));
  const core = Object.freeze({
    schema: SCHEMA,
    action_id: window.action_id,
    action_digest: window.action_digest,
    checkpoint_digest: window.checkpoint_digest,
    capacity_projection_digest: window.capacity_projection_digest,
    issuance_window_digest: window.issuance_window_digest,
    start_index: window.start_index,
    end_exclusive: window.end_exclusive,
    projected_count: window.projected_count,
    entries,
  });
  return Object.freeze({ ...core, issuance_manifest_digest: digest(core) });
}

export function providerNeutralFanoutIssuanceManifestContract() {
  const windowContract = providerNeutralFanoutIssuanceWindowContract();
  return Object.freeze({
    ...windowContract,
    schema: 'metaengine.browser.provider-neutral-fanout-issuance-manifest-contract.v1',
    target_binding_digest_fenced: true,
    exact_window_membership_fenced: true,
    command_payload_persisted: false,
  });
}
