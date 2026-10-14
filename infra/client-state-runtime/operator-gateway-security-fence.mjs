// W28: per-listener, observational watermark fence. Not a trust source or a scheduler.
// The caller must first authenticate and validate readbacks from its trusted Owner adapter.
export const MAX_GATEWAY_RUN_WATERMARKS = 128;
const safeSequence = value => Number.isSafeInteger(value) && value >= 0;
const validName = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);

export function sameGatewayRunIdentity(before, after) {
  if (before === null || after === null) return before === null && after === null;
  if (!before || !after) return false;
  return ['owner_id', 'project_id', 'run_id', 'owner_epoch', 'cursor'].every(
    name => before[name] === after[name]);
}

export function createGatewayReadbackFence() {
  let latestOwnerEpoch = -1;
  const watermarks = new Map();
  return Object.freeze({
    // Accept only after both post-readback Owner health and identity checks pass.
    // A missing identity never erases a previously observed generation/watermark.
    accept(identity) {
      if (identity === null) return;
      if (!identity || identity.source !== 'OWN_POSTGRES_READBACK' ||
        identity.proof !== 'TRUSTED_READBACK' || identity.fresh !== true ||
        !validName(identity.owner_id) || !validName(identity.project_id) ||
        !validName(identity.run_id) || !safeSequence(identity.owner_epoch) ||
        typeof identity.cursor !== 'string' ||
        !/^(0|[1-9][0-9]{0,15})$/.test(identity.cursor) ||
        !safeSequence(Number(identity.cursor))) {
        throw new Error('gateway_readback_unverified');
      }
      if (identity.owner_epoch < latestOwnerEpoch) throw new Error('gateway_owner_epoch_regressed');
      const key = JSON.stringify([identity.owner_id, identity.project_id, identity.run_id]);
      const previous = identity.owner_epoch === latestOwnerEpoch ? watermarks.get(key) : undefined;
      const next = Number(identity.cursor);
      if (previous !== undefined && next < previous) throw new Error('gateway_event_seq_regressed');
      if (identity.owner_epoch === latestOwnerEpoch && previous === undefined &&
        watermarks.size >= MAX_GATEWAY_RUN_WATERMARKS) {
        throw new Error('gateway_run_watermark_capacity_exceeded');
      }
      // A new trusted Owner incarnation allows a new event namespace, not a rollback
      // within the same incarnation. Do not evict old runs in an epoch (replay fence).
      if (identity.owner_epoch > latestOwnerEpoch) {
        watermarks.clear();
        latestOwnerEpoch = identity.owner_epoch;
      }
      watermarks.set(key, next);
    },
  });
}
