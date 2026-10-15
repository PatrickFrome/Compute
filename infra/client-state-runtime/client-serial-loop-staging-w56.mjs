// W56: observational continuation of the existing W30/Supervisor lease.
// This module never dispatches, creates a claim, edits source, or upgrades
// SYNTHETIC/STAGING to installed/Agent-origin LIVE.
import { inspectStagingRestart, verifyStagingCheckpointDigest } from './client-serial-loop-staging-w48.mjs';

export const W56_SCHEMA = 'metaengine.client.serial-loop-staging-w56.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const agent = x => /^agent_[a-z0-9-]{8,64}$/.test(String(x));
const positive = x => Number.isSafeInteger(x) && x > 0;
const fenced = reason => Object.freeze({
  schema: W56_SCHEMA, state: 'UNKNOWN', reason,
  origin: 'SYNTHETIC/STAGING', existing_executor: 'EXISTING_DEVOS_FLEET_LEASE_V1',
  permission_to_claim: false, permission_to_edit: false,
  live_completion_verified: false, promotion_authorized: false,
  automatic_retry_allowed: false, authority_effect: false,
});

/**
 * An actual next lease requires TWO distinct readbacks: the existing
 * Supervisor/W30 observation and a fresh row read from disposable own PG17.
 * This never substitutes for W39 authentic Owner and independent LIVE critic.
 */
export function inspectStagingNextLease({
  completedCheckpoint, completedPgReadback, completedEffect,
  nextLease, nextPgLeaseReadback, observed_at_ms = Date.now(),
} = {}) {
  if (!verifyStagingCheckpointDigest(completedCheckpoint))
    return fenced('PREVIOUS_CHECKPOINT_INTEGRITY_UNKNOWN');
  if (nextLease?.schema !== 'metaengine.client.serial-loop-staging-w48.v1'
      || nextLease?.state !== 'STAGING_LEASE_OBSERVED'
      || nextLease?.origin !== 'SYNTHETIC/STAGING'
      || !UUID.test(String(nextLease.task_id))
      || !UUID.test(String(nextLease.workspace_id))
      || !agent(nextLease.agent_id) || !positive(nextLease.lease_generation)
      || !positive(nextLease.owner_generation)
      || nextLease.task_id === completedCheckpoint.task_id
      || nextLease.workspace_id !== completedCheckpoint.workspace_id
      || nextLease.owner_generation !== completedCheckpoint.owner_generation)
    return fenced('NEW_SUPERVISOR_LEASE_UNPROVEN');
  const predecessor = inspectStagingRestart({
    checkpoint: completedCheckpoint, pgReadback: completedPgReadback,
    effect: completedEffect, requested_task_id: nextLease.task_id,
    requested_lease_generation: nextLease.lease_generation, observed_at_ms,
  });
  if (predecessor.state !== 'NEXT_TASK_ELIGIBLE_STAGING_ONLY')
    return fenced('PREDECESSOR_' + predecessor.reason);
  const db = nextPgLeaseReadback;
  if (db?.backend !== 'OWN_PG17_DISPOSABLE' || db.origin !== 'SYNTHETIC/STAGING'
      || db.state !== 'LEASED_STAGING_ONLY' || db.row_count !== 1
      || db.workspace_id !== nextLease.workspace_id
      || db.task_id !== nextLease.task_id
      || db.agent_id !== nextLease.agent_id
      || db.lease_generation !== nextLease.lease_generation
      || db.owner_generation !== nextLease.owner_generation
      || !positive(db.event_seq)
      || !HASH.test(String(db.after_checkpoint_sha256))
      || db.after_checkpoint_sha256 !== completedCheckpoint.checkpoint_sha256)
    return fenced('FRESH_OWN_PG_NEXT_LEASE_UNPROVEN');
  return Object.freeze({
    schema: W56_SCHEMA, state: 'NEXT_LEASE_READBACK_STAGING_ONLY',
    origin: 'SYNTHETIC/STAGING', after_task_id: completedCheckpoint.task_id,
    next_task_id: nextLease.task_id, next_lease_generation: nextLease.lease_generation,
    next_agent_id: nextLease.agent_id, event_seq: db.event_seq,
    existing_executor: 'EXISTING_DEVOS_FLEET_LEASE_V1',
    permission_to_claim: false, permission_to_edit: false,
    live_completion_verified: false, promotion_authorized: false,
    automatic_retry_allowed: false, authority_effect: false,
  });
}
