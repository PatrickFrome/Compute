# Main Roadmap Lease Truth Projection V2

Date: 2026-08-27

## Research question

Should an expired row that is still physically stored as `ACTIVE` block roadmap planning until a mutating cleanup/reconciliation job runs, or should every authoritative read surface independently derive lease validity from TTL/fencing state?

## Upstream systems

### etcd leases

etcd leases attach a TTL to keys. When the lease expires, attached keys are deleted. Clients use keep-alives to retain the lease, so liveness comes from the lease clock rather than a durable text label on the value. This supports treating physical cleanup as a consequence of lease invalidation, not the source of lease validity.

Primary references:
- https://etcd.io/docs/v3.7/dev-guide/interacting_v3/
- https://etcd.io/docs/v3.5/learning/api/

### Consul sessions and lock sequencing

Consul sessions are invalidated when their TTL is not renewed. Lock correctness uses the key, session identity, and `LockIndex`; the lock index can serve as a sequencer so a stale holder cannot regain authority simply because it still has an old local view. This is directly analogous to exposing H205F22 `claim_id` as a monotonic lease fence while deriving current authority from the lease expiry.

Primary reference:
- https://developer.hashicorp.com/consul/docs/automate/session

### Kubernetes Lease

Kubernetes Lease objects model holder identity, `renewTime`, and `leaseDurationSeconds`. Lease duration is evaluated from observed renewal time; the holder is not authoritative indefinitely just because the object persists.

Primary reference:
- https://kubernetes.io/docs/reference/kubernetes-api/coordination/lease-v1/

### PostgreSQL observation time

PostgreSQL `statement_timestamp()` returns the start time of the current statement. Using one statement timestamp for all claim TTL comparisons prevents one projection call from classifying the same lease against multiple moving instants.

Primary reference:
- https://www.postgresql.org/docs/17/functions-datetime.html

## Design consequence

`ROADMAP_ALIGNMENT_LEASE_TRUTH_PROJECTION_V2` changes the control-plane rule from:

> persisted `ACTIVE` row = authority until explicit reconciliation

to:

> fresh lease + exact authoritative projection = authority; stale persisted rows = observable cleanup debt.

The authoritative alignment projection therefore requires all of:

- `state='ACTIVE'`;
- `expires_at > observed_at`;
- `heartbeat_at <= observed_at`;
- `heartbeat_at < expires_at`.

An `IN_PROGRESS` Level-2 milestone with no fresh claim projects as `PLANNED` in the canonical progress spine. The underlying row is not mutated by the read path.

The V2 guard additionally requires projection equality:

- alignment fresh claim IDs == fresh raw claim IDs;
- supervisor fresh claim IDs == fresh raw claim IDs;
- supervisor fresh directive IDs == fresh raw directive IDs;
- no stale claim/directive ID may appear in an authoritative projection.

Stale rows are preserved in evidence as `cleanup_required=true` while explicitly carrying `stale_rows_authority_effect=false`.

## Live evidence after migration

At `2026-08-27T20:26:49.968056+00:00`:

- legacy alignment still projected claim `32` and `C1=IN_PROGRESS`;
- lease-aware V2 alignment projected no active claim and `C1=PLANNED`;
- supervisor snapshot also projected no active claim/directive and `C1=PLANNED`;
- stale claim `32` remained physically `ACTIVE` and was reported as cleanup debt;
- no claim/directive DML was needed to restore authority correctness.

A later exact V2 guard snapshot at `2026-08-27T20:28:44.228546+00:00` contains one stale claim (`32`) and three stale directives (`25`, `26`, `29`), while alignment and supervisor projections are empty. This is the intended PASS-with-cleanup-debt case.

## Security boundary

The live V2 alignment function and retained legacy forensic readback are both `SECURITY INVOKER`; `anon` and `authenticated` have no EXECUTE privilege; `service_role` retains EXECUTE. No supervisor token or provider credential is part of this read path.

## Non-claims

- stale rows were not reconciled or deleted;
- no supervisor authority was used;
- no provider or Edge deployment occurred;
- no PR was merged;
- no W1 live worker evidence was produced;
- W1 remains READY, not VERIFIED.
