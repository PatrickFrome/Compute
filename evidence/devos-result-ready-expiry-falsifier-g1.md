# DevOS result-ready expiry falsifier g1 evidence

Status: **RESULT_READY — tested invariant not falsified**

- DevOS task: `68546431-90ab-4c55-a8c5-46fbcbaabeb9`
- Claim: `95`
- Point: `devos.result-ready.expiry.falsify.g1`
- Source evidence: PR #186
- Pinned implementation snapshot: `6768a43bb7df8eead2c1dddf06735f0263ff515b`
- Falsifier branch: `work/devos-result-ready-expiry-falsifier-g1`
- Evidence PR: #194 (draft, advisory-only)
- First executable evidence run: https://github.com/PatrickFrome/Compute/actions/runs/33645817589
- First evidence job: `100300150191`

## Reconciliation

PR #186 had advanced beyond the supplied evidence SHA when this falsifier began. The probe intentionally remained pinned to `6768a43bb7df8eead2c1dddf06735f0263ff515b` and did not borrow later PR behavior into the implementation under test.

The pinned migration changes `public.devos_fleet_reconcile_v1` so expired `LEASED`, `RUNNING`, `RESULT_READY`, and `BLOCKED` task leases fail-close to `AMBIGUOUS`; it separately expires ACTIVE claims and its watchdog delegates recovery by workspace. The expiry event records `result_sha256`, disables automatic retry, and declares no authority effect.

## Falsification harness

`tests/devos_result_ready_expiry_falsifier_g1.sh` applies the pinned migration to a disposable PostgreSQL 16 database with a minimal local schema and event sink. The event sink intentionally has **no uniqueness/deduplication constraint**, so duplicate calls remain observable.

The first pass races a direct reconcile against the watchdog on the same due workspace. A short sleep inside the local task-expiry event sink keeps task row locks open so the watchdog overlaps the direct transaction and exercises `FOR UPDATE SKIP LOCKED`. A second concurrent pass applies duplicate-processing pressure.

Cases seeded:

1. expired `RESULT_READY`, generation 7, digest present;
2. expired `RESULT_READY`, generation 8, digest missing (`NULL`);
3. expired `BLOCKED`, generation 9, digest present;
4. expired same-generation ACTIVE claim for a `BLOCKED` task whose task lease is still live;
5. expired stale-generation 19 ACTIVE claim for a current generation 20 `RESULT_READY` task.

## Run 33645817589 observations

First concurrent direct reconcile:

```json
{"expired_claims":0,"requeued_tasks":0,"authority_effect":false,"automatic_retry_allowed":false,"expired_tasks_fenced_ambiguous":3}
```

First concurrent watchdog:

```json
{"workspaces_reconciled":1,"expired_tasks_fenced_ambiguous":0,"expired_or_orphan_claims_closed":5,"stale_mesh_instances_marked_lost":0,"automatic_retry_allowed":false,"authority_effect":false}
```

Duplicate-pressure direct reconcile and watchdog both reported zero further task/claim mutations and zero requeues.

Final task evidence:

| case | final state | generation | result evidence |
|---|---|---:|---|
| expired RESULT_READY / digest present | `AMBIGUOUS` | 7 | `sha256:result-present` preserved |
| expired RESULT_READY / digest missing | `AMBIGUOUS` | 8 | remains `NULL` |
| expired BLOCKED / digest present | `AMBIGUOUS` | 9 | `sha256:blocked-evidence` preserved |
| claim-only expiry / BLOCKED task lease live | `BLOCKED` | 10 | `sha256:block-live` preserved |
| stale claim gen 19 / current RESULT_READY | `RESULT_READY` | 20 | `sha256:current-generation` preserved |

All five expired ACTIVE claims ended `EXPIRED`. The stale generation 19 claim did not mutate the generation 20 task.

The deliberately non-deduplicating event sink contained exactly eight calls: three `TASK_LEASE_EXPIRED_AMBIGUOUS` events and five `CLAIM_EXPIRED` events. Every idempotency key appeared exactly once. The missing-digest task expiry event carried explicit JSON `null`; present digests were preserved in event payloads. All task-expiry events carried `automatic_retry_allowed=false` and `authority_effect=false`.

No task became `AVAILABLE`; no automatic requeue was observed.

## Result

This probe **did not falsify** the highest-value tested invariant at the pinned PR #186 snapshot: under overlapping direct reconcile/watchdog recovery and duplicate pressure, expired `RESULT_READY`/`BLOCKED` task leases fail-closed to `AMBIGUOUS`, result evidence is preserved (including a missing digest remaining missing), claims expire without mutating newer task generations, duplicate expiry events were not emitted, and no automatic requeue occurred.

Residual scope: this is an advisory development harness using disposable local PostgreSQL and a minimal compatible schema/event sink. It does not claim production-schema or production-load equivalence and performs no production DDL, deployment, requeue, retry, billing, secret access, or irreversible external action.
