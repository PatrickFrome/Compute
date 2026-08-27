# Roadmap Execution Protocol

The project is governed by two linked roadmap layers:

1. `docs/CANONICAL_ROADMAP.md` — the stable **Level-1 architectural north star**: `R1`, `C1…C17`, `F1+`.
2. Supabase `compute-fabric-roadmap-v1` — the mutable **Level-2 execution DAG** containing implementation gates/submilestones.

The Level-2 DAG is subordinate to Level-1. It may refine dependencies and acceptance gates, but it must not silently redefine, renumber or replace the canonical Level-1 roadmap.

## Mandatory roadmap reconciliation

Before every meaningful semantic step, the workstream must record:

- Canonical Level-1 milestone: `R1`, `C1…C17`, or `F1+`;
- Current Level-2 milestone/claim;
- Which canonical acceptance criterion the step advances;
- Whether the step moves the project closer to real compute or merely adds control-plane complexity.

If a Level-2 assignment cannot be mapped unambiguously to Level-1, stop at `EVIDENCE_READY` and request Supervisor reconciliation.

### Lease-truth fence

Before PLAN or PUBLISH, capture the read-only snapshot in
`supabase/prep/main_roadmap_lease_truth_snapshot_v1.sql` and evaluate it with
`controller/roadmap/roadmap_lease_truth_guard_v2.py`.

The snapshot uses one PostgreSQL `statement_timestamp()` as the observation
instant and includes the durable Level-2 → Level-1 mapping, authoritative
alignment/supervisor projections, and raw rows still labelled `ACTIVE`.
A stored `ACTIVE` label is not authority after the finite lease has expired.
Current authority is derived from a fresh lease plus exact projection equality.

A fresh roadmap claim requires all of:

- `state='ACTIVE'`;
- `expires_at > observed_at`;
- `heartbeat_at <= observed_at`;
- `heartbeat_at < expires_at`.

The authoritative alignment projection must contain exactly the fresh raw claim
IDs. The supervisor projection must contain exactly the fresh raw claim and
fresh raw directive IDs. Any stale ID reappearing in either authoritative
projection is a fail-closed error.

Expired rows that remain physically labelled `ACTIVE` may be retained as
**cleanup debt** when every authoritative projection excludes them. In that
case the receipt may PASS with `cleanup_required=true` and
`stale_rows_authority_effect=false`. Reconciliation remains useful maintenance,
but physical cleanup is not the source of lease validity and is not by itself a
prerequisite for PLAN/PUBLISH.

`claim_id` is exposed as a monotonic lease fence/sequencer. A later holder must
not acquire authority from an older claim merely because an old persisted row
still exists.

An `IN_PROGRESS` Level-2 milestone without a fresh owning claim is projected as
`PLANNED` in the canonical progress spine; the read path does not mutate the
underlying milestone row.

Level-1 ownership is a durable roadmap property. It must not be inferred solely
from whichever transient work claim happens to be active. A work claim may be
absent during planning without erasing the Level-1 mapping.

The lease-truth receipt is PREP evidence only: `canonical=false`,
`authority_effect=false`, and it authorizes no database mutation, provider
mutation, Edge deployment, PR merge, or checkpoint promotion. A blocked receipt
must be resolved before a normal roadmap cycle can be considered publishable.
A PASS with cleanup debt permits roadmap planning but does not authorize the
cleanup mutation itself.

The prior `roadmap_lease_truth_guard.py` V1 behavior is retained only as a
historical/strict-cleanliness contract; V2 is the current roadmap authority
gate.

### Deterministic cycle oracle

Before a new source slice starts, run
`controller/roadmap/roadmap_cycle_oracle.py` in `PLAN` mode against a fresh
Supabase roadmap/alignment snapshot and the exact fetched remote rail. Before
publication, run it again in `PUBLISH` mode after the local commit and after a
second remote fetch.

The oracle fails closed on roadmap-definition drift, dependency cycles, a
missing Level-1 mapping, remote-head advancement, dirty publication state, or
non-fast-forward history. Its receipt is PREP evidence only:
`canonical=false`, `authority_effect=false`, and it never authorizes provider,
database, Edge, PR-merge, or checkpoint promotion actions.

The legacy minimal input JSON for the cycle oracle is the direct result shape
of:

```sql
select jsonb_build_object(
  'roadmap_status', destruktion_meta.compute_fabric_roadmap_status_h205f22(),
  'alignment_status', destruktion_meta.compute_fabric_roadmap_alignment_status_h205f22()
);
```

For normal roadmap execution, prefer the richer lease-truth snapshot first and
retain its exact input hash beside the cycle-oracle receipt.

After fetching the workstream ref, invoke the oracle with the exact observed
remote SHA and write the receipt outside the worktree so the receipt itself
does not make the publication rail dirty:

```bash
python3 controller/roadmap/roadmap_cycle_oracle.py \
  --snapshot /tmp/main-roadmap-live.json \
  --repo . \
  --remote-ref origin/work/w1-sandbox-launcher-prep \
  --local-ref HEAD \
  --expected-remote-head "$EXACT_REMOTE_SHA" \
  --phase PLAN \
  --output /tmp/main-roadmap-plan-receipt.json
```

Use `PUBLISH` only after committing and refetching. It requires `HEAD` to be a
strict descendant of the still-unchanged expected remote SHA.

## Per-workstream loop

1. Read current semantic checkpoint and roadmap status.
2. Capture a single-statement lease-truth snapshot and obtain a passing V2 lease-truth receipt; record cleanup debt separately from authority.
3. Fetch the exact workstream rail and obtain a passing `PLAN` cycle-oracle receipt.
4. Read `docs/CANONICAL_ROADMAP.md` and identify the owning Level-1 milestone.
5. Read the active supervisor directive and work claim, if fresh authority exists.
6. Verify dependency gates, mutation domains and the Level-1 ↔ Level-2 mapping.
7. Implement only within the assigned workstream.
8. Run positive tests and fail-closed negative canaries.
9. Perform deep upstream/amplifier research for semantic steps.
10. Run Supabase security/performance advisors after schema changes.
11. Clearly label `LIVE`, `SYNTHETIC`, `CONTROL_PLANE_ONLY`, `SCHEMA_ONLY`, and `HISTORICAL` evidence.
12. Re-capture lease truth, commit, refetch, and obtain passing lease-truth plus `PUBLISH` cycle-oracle receipts.
13. Publish only as a fast-forward workstream update and keep the PR draft until integration gates pass.
14. Finish the Level-2 roadmap claim as `EVIDENCE_READY` only through an authority-bearing path.
15. State explicitly which Level-1 acceptance criterion is now evidence-ready.

## Integration loop

1. Analyst/Integrator compares all `EVIDENCE_READY` workstreams against both the current semantic head and `docs/CANONICAL_ROADMAP.md`.
2. Check migration order, API/schema compatibility, evidence provenance, tests, CI and roadmap drift.
3. Reject work that advances Level-2 mechanics while moving away from the Level-1 critical path without an explicit Supervisor-approved reason.
4. Recommend `ACCEPT`, `ACCEPT_WITH_REBASE`, `REQUEST_CHANGES`, `HOLD`, or `REJECT`.
5. Supervisor performs the final cross-audit.
6. Supervisor alone merges accepted work and reserves/seals the next checkpoint.
7. Independently verify checkpoint root/ledger.
8. Recompute both the Level-2 ready-set and the current Level-1 progress state.

## Canonical near-term priority

The project must not substitute scheduler/control-plane abstractions for the real execution spine:

`R1 → C1 First Real Linux Worker → C2 First Serial Coding Loop → C3 safe acceleration`

C1 requires a real admitted Linux worker. C2 requires a real repo → edit → build/test → verified artifact loop. Schema/control-plane readiness alone does not satisfy either milestone.

## Hard invariants

- Worker chats never seal mainline checkpoints.
- Synthetic evidence never counts as live evidence.
- A dependency-gated milestone cannot gain runtime authority early.
- Expired lease rows never regain authority from their persisted state alone.
- Cleanup/reconciliation is distinct from authority projection; stale cleanup debt must remain visible until reconciled.
- Parallel workstreams must not overlap mutation domains without explicit Supervisor coordination.
- `main` is the integration result, not a workspace for direct experimentation.
- Every PR must name both its canonical Level-1 milestone and its Level-2 milestone.
- Amplifier research may alter implementation choices but may not silently alter the Level-1 roadmap.
- A Level-1 roadmap amendment requires explicit architectural review, a versioned GitHub change and the matching Supabase canonical-roadmap update.
