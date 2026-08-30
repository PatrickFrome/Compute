# DevOS Browser-native task dispatch V1 — implementation evidence

Date: 2026-08-30
Task: `09f2e414-5c31-4fc7-87a3-f5de1315cb81`
Agent: `agent_a2bf77e6-66d3-4f10-9c9c-683df36f4510`
Target branch: `work/devos-native-task-dispatch-v1`
Exact base: `724612235eb7ceb4534c13d126425b274d876394`

## Slice implemented

The Browser now has a branch-local DevOS task stage attached to the existing `NativeSupervisorClient.cycle()` scheduler. No second timer or polling loop was added.

The stage performs one bounded heartbeat iteration:

1. Device-signed `/v1/devos/cycle` request.
2. Server-side snapshot/backlog calculation using the existing `devos_fleet_snapshot_v1` RPC.
3. Optional exact lease using the existing `devos_fleet_lease_v1` RPC and the live Browser agent's `agent_id / role / tab_id / target_id / generation_epoch`.
4. Backlog-driven `FLEET_RECONCILE` through the existing typed Browser command executor.
5. Fixed typed dispatch sequence only: `CAPTURE -> SEMANTIC_TYPE -> CAPTURE`.
6. `devos_fleet_mark_running_v1` only after transport proof (`prompt_sha256`, `conversation_url_sha256`, `PROVEN_*` effect state).
7. Running-task observation only on the exact leased tab/target/generation and proven conversation hash.
8. Completion write through `devos_fleet_complete_v1`; if the completion HTTP effect is ambiguous, perform status readback and do not repeat the write blindly.

## Safety invariants preserved

| Invariant | Evidence in this slice |
| --- | --- |
| One scheduler/event source | `DevOsNativeTaskCycle` has no `setInterval`/`setTimeout`; it is invoked from the existing supervisor heartbeat cycle. |
| Exact lease fencing | Every dispatch/mark-running/completion path carries `task_id`, `agent_id`, `lease_generation`, `tab_id`, `target_id`, and `agent_generation_epoch`. |
| Physical target/incarnation binding | Lease is rejected unless live fleet state exactly matches tab, target, role and generation epoch. |
| No arbitrary eval | DevOS actions are fixed typed commands; task text can only become composer text. |
| Page/model text zero authority | Page semantic data is used only to locate the exact composer/STOP state and prove transport; it cannot select an action or authorize a DB transition. |
| No blind retry after ambiguous send | A lease generation is placed in an attempted set before the effecting semantic submit. A failed/ambiguous send is never automatically replayed. |
| No blind retry after ambiguous completion write | One completion POST is followed by readback through `devos_fleet_snapshot_v1` / durable `TASK_RESULT_*` evidence if the HTTP outcome is unknown. |
| Elastic growth is backlog-driven | Target capacity derives from READY+RUNNING backlog and existing warm/burst policy, then uses the existing `FleetProvisioner.reconcile`. |
| Existing supervisor resilience preserved | Original `native-supervisor-client.mjs` blob is retained unchanged as `native-supervisor-client-base.mjs`; the public entry is a thin subclass wrapper. DevOS failure is additive/non-fatal to the original heartbeat/command cycle. |

## Tests and CI

New tests cover:

- stale tab and generation rejection;
- deterministic typed prompt construction;
- burst-bounded backlog reconcile;
- one dispatch per lease generation;
- completion transport ambiguity -> readback, with exactly one completion write attempt;
- heartbeat as the sole scheduler source;
- exact transport-proof RPC fencing;
- terminal status recovery from durable `TASK_RESULT_*` event evidence.

Branch-local workflow: `.github/workflows/devos-native-task-dispatch.yml`

Observed GitHub Actions evidence before this checkpoint:

- run: `33315057926`
- head: `98a9be4a5114ff083e4f8fd35349be35e7132ddd`
- job: `native-task-dispatch`
- conclusion: `success`
- successful gates: Node 24 syntax, DevOS task-dispatch fencing tests, scheduler/authority invariants.

## DB contracts re-used; no duplicate queue

No new durable queue or scheduler was introduced. The slice deliberately reuses existing authoritative DB functions:

- `devos_fleet_snapshot_v1`
- `devos_fleet_lease_v1`
- `devos_fleet_mark_running_v1`
- `devos_fleet_complete_v1`

Existing DB semantics already convert expired leased/running work to `AMBIGUOUS` and enforce exact lease generation + physical binding on state transitions.

## Rollout boundary

`apps/metaengine-browser/supabase/a2-browser-native-supervisor-devos-routes.mjs` is the branch-local, device-authenticated route helper intended to be grafted into `a2-browser-native-supervisor-v1` **after** the existing device-signature authentication step.

The currently active Supabase Edge Function was inspected as source of truth, but was **not deployed or modified** in this task. Until a later evidence-gated rollout imports the helper into that Edge Function, Browser calls fail closed with `SERVER_ROUTE_UNAVAILABLE`; the existing supervisor heartbeat continues normally and no task effect is attempted.

No `main` merge, release promotion, Supabase migration, Edge deployment, production authority change, or secret operation was performed.
