-- W4/P2 source-only schema for METAENGINE-owned PostgreSQL 17.
-- Do not apply to installed/production DB without independently approved migration.
-- Existing supervisor executor is the only writer; this is NOT an effect queue.
BEGIN;
CREATE TABLE IF NOT EXISTS public.metaengine_supervisor_continuity_lease_v1 (
  owner_id text NOT NULL CHECK (owner_id ~ '^[A-Za-z0-9:_-]{1,160}$'),
  run_id text NOT NULL CHECK (run_id ~ '^[A-Za-z0-9:_-]{1,160}$'),
  process_incarnation_id text NOT NULL CHECK (process_incarnation_id ~ '^[A-Za-z0-9:_-]{1,160}$'),
  lease_generation bigint NOT NULL CHECK (lease_generation >= 1),
  expires_at timestamptz NOT NULL,
  event_seq bigint NOT NULL DEFAULT 0 CHECK (event_seq >= 0),
  pending_wake_id text CHECK (pending_wake_id ~ '^wake_[A-Za-z0-9-]{8,100}$'),
  pending_wake_status text CHECK (pending_wake_status IN ('PREPARED','AMBIGUOUS','CONFIRMED_SENT','PROVEN_NOT_SENT')),
  pending_wake_epoch bigint CHECK (pending_wake_epoch >= 1),
  pending_wake_cycle bigint CHECK (pending_wake_cycle >= 1),
  pending_wake_process_incarnation_id text CHECK (pending_wake_process_incarnation_id ~ '^[A-Za-z0-9:_-]{1,160}$'),
  pending_wake_lease_generation bigint CHECK (pending_wake_lease_generation >= 1),
  last_receipt_sha256 text CHECK (last_receipt_sha256 ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY (owner_id, run_id),
  CONSTRAINT supervisor_pending_wake_consistent CHECK (
    (pending_wake_id IS NULL AND pending_wake_status IS NULL
      AND pending_wake_epoch IS NULL AND pending_wake_cycle IS NULL
      AND pending_wake_process_incarnation_id IS NULL AND pending_wake_lease_generation IS NULL)
    OR (pending_wake_id IS NOT NULL AND pending_wake_status IS NOT NULL
      AND pending_wake_epoch IS NOT NULL AND pending_wake_cycle IS NOT NULL
      AND pending_wake_process_incarnation_id IS NOT NULL AND pending_wake_lease_generation IS NOT NULL)
  )
);
REVOKE ALL ON public.metaengine_supervisor_continuity_lease_v1 FROM PUBLIC;
COMMIT;
