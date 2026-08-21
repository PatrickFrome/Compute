-- Supports W1 persistence evidence scans by worker and observation time.
-- Noncanonical performance-only change.

create index if not exists compute_fabric_worker_heartbeat_w1_worker_observed_idx
  on destruktion_meta.compute_fabric_worker_heartbeat_receipt_h205f22(worker_id, observed_at desc, heartbeat_id desc)
  where accepted and worker_id is not null;
