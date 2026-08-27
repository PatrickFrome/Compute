# Main Roadmap Lease-Truth Fence — research note

Date: 2026-08-27

## Live finding

A read-only Supabase observation at `2026-08-27T20:01:57.264166+00:00` found a control-plane inconsistency:

- raw roadmap claim `claim_id=32` is still stored as `state=ACTIVE`, but `expires_at=2026-08-25T23:00:00.637797+00:00`;
- raw supervisor directives `25`, `26`, and `29` are still stored as `status=ACTIVE`, although all three expiry timestamps are in the past;
- `compute_fabric_supervisor_snapshot_h205f22_v2()` projects no active claims/directives, while `compute_fabric_roadmap_alignment_status_h205f22()` still includes claim `32` in `active_claim_alignment`;
- the durable Level-2 mapping already contains `W1_PERSISTENT_LINUX_WORKER_SAFETY -> C1 (PRIMARY)` and therefore Level-1 ownership does not need to be inferred from a transient claim lease.

This means two read surfaces currently disagree about lease truth. It does **not** make W1 verified, and it is not evidence of live worker persistence.

## Upstream comparison

### Kubernetes Lease semantics

Kubernetes `coordination.k8s.io/v1` Lease explicitly models holder identity, `renewTime`, and `leaseDurationSeconds`; lease duration is measured against the last observed renewal. Kubernetes also uses leases as lightweight distributed locks for control-plane leadership: once renewal stops and the lease expires, another candidate may take over. This is the correct conceptual model for roadmap authority: a stored label such as `ACTIVE` is not sufficient when its renewal window has elapsed.

References:
- https://kubernetes.io/docs/reference/kubernetes-api/coordination/lease-v1/
- https://kubernetes.io/docs/concepts/cluster-administration/coordinated-leader-election/

### PostgreSQL observation time

PostgreSQL distinguishes transaction time from statement time. `CURRENT_TIMESTAMP` / `transaction_timestamp()` are fixed at transaction start, while `statement_timestamp()` represents the start of the current statement. For a one-statement, read-only lease snapshot, anchoring every TTL comparison to `statement_timestamp()` gives one explicit observation instant without the moving-time ambiguity of `clock_timestamp()`.

Reference: https://www.postgresql.org/docs/17/functions-datetime.html

### PostgreSQL reconciliation serialization

PostgreSQL advisory locks are application-defined locks. Transaction-level advisory locks are released automatically when the transaction ends, which makes them appropriate for preventing two supervisor reconciliation calls from racing without introducing a persistent lock row. `UPDATE ... RETURNING` provides the exact set of rows actually transitioned, avoiding a second query that could race with concurrent state changes.

References:
- https://www.postgresql.org/docs/16/explicit-locking.html
- https://www.postgresql.org/docs/17/dml-returning.html

### GitHub Actions least privilege

GitHub recommends granting the `GITHUB_TOKEN` only the minimum permissions a workflow needs. The roadmap guard is pure verification, so `contents: read` remains sufficient; it must not acquire write, deployment, package, or identity-token authority merely to validate leases.

References:
- https://docs.github.com/en/actions/reference/security/secure-use
- https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax

## Guard design decision

Add a separate, deterministic `roadmap_lease_truth_guard.py` before PLAN/PUBLISH:

1. Bind the snapshot to a single `observed_at` produced by `statement_timestamp()`.
2. Resolve Level-1 ownership from the durable Level-2 mapping table, not from the holder of a transient claim.
3. Treat expired rows still labelled ACTIVE as stale and fail closed.
4. Reject duplicate fresh claims/directives for the selected milestone.
5. Reject alignment output that references an already-expired claim.
6. Require the supervisor's projected active-claim IDs to match the fresh raw claim IDs.
7. Keep every receipt non-authoritative (`canonical=false`, `authority_effect=false`) and grant no database/provider/Edge/merge/checkpoint mutation authority.

## Reconciliation design decision

Prepare `compute_fabric_supervisor_reconcile_roadmap_leases_h205f22(uuid)` as an explicit, supervisor-token-gated mutation primitive:

1. Require the current `COMPUTE_FABRIC_MAINLINE` supervisor token and ACTIVE supervisor mode.
2. Take a transaction-level advisory lock for the reconciliation resource.
3. Capture one `statement_timestamp()` and use it for all expiry decisions in that call.
4. Transition only finite expired `ACTIVE` roadmap claims to `EXPIRED`.
5. Transition only finite expired `ACTIVE` supervisor directives to `SUPERSEDED`, preserving the existing directive lifecycle vocabulary and `superseded_at` field.
6. Reset an `IN_PROGRESS` milestone to `PLANNED` only when no fresh ACTIVE claim remains for that milestone, matching the existing lazy-expiry behavior in `compute_fabric_claim_roadmap_work_h205f22`.
7. Use `UPDATE ... RETURNING` to emit exact mutated IDs in the receipt.
8. State mutation truth explicitly: this operation has `database_mutation=true` and `authority_effect=true`, while provider, Edge, PR-merge and checkpoint-promotion effects remain false.
9. Revoke PUBLIC execution and grant the primitive only to `service_role`; the supervisor token remains an additional application-level gate.

The migration file defines the primitive but does not invoke it. No supervisor token is retrieved, logged, embedded, or requested by the implementation.

## Why this outranks more CI acceleration

The local suite is already small enough that sharding/REAPI would optimize seconds while leaving a correctness ambiguity in roadmap authority. Lease truth sits directly on the W1 critical path and can prevent stale authority from contaminating target selection, checkpoint evidence, or supervisor handoff. Correctness therefore has higher expected value than another test-speed layer at this stage.

## Non-claims

- migration prepared, but live DDL not applied;
- reconciliation primitive not invoked;
- no supervisor secret accessed;
- no stale rows mutated or expired by this branch;
- no Edge deployment;
- no provider mutation;
- no PR merge;
- no W1 promotion to VERIFIED;
- no canonical checkpoint seal.
