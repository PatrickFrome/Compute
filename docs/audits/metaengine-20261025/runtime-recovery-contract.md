# Runtime recovery contract audit — second development stream

Date: 2026-10-25. Baseline: `ebf94e50fd652ca2d68461444be2b3afd171fdeb` in
`metaengine-runtime-recovery-20261025`. Line references below describe that baseline;
the controller is being repaired independently in this same checkout.

This review covers the Browser-owned local Host, launcher, shutdown/cleanup,
attached PostgreSQL ownership and native coding channel lifetime. It does not
qualify installation, UI functionality, model work, a restart continuation, or
the complete project. No installed process, Owner record, live database or
installer was changed by this audit/repair.

## Findings

| Priority | Baseline location | Observable contract problem | Required repair |
| --- | --- | --- | --- |
| P1 | `apps/metaengine-browser/src/local-runtime-host-controller.mjs:169-184,282-285` | An exit event is treated as confirmed cleanup and the owned generation is discarded. `stopOwnedLocalRuntimeHost` can then return `NO_OWNED_HOST` and `cleanup_confirmed:true`, including after a crash without child cleanup evidence. | Retain the generation until exact terminal proof or independent reconciliation. Match the actual child handle/PID and per-spawn nonce, not exit code alone. |
| P1 | `infra/client-state-runtime/runtime-host.mjs:443-449`; controller `:307-314` | The controller expects a fixed startup failure IPC envelope, but real Host only writes it to stderr. The existing synthetic controller test injects IPC and therefore misses the production mismatch. | Emit the finite failure envelope over the actual parent IPC channel and await a bounded local send callback before disconnecting. Implemented in this stream. |
| P1 | `apps/metaengine-browser/src/main.mjs:2105-2122,2247-2274,2319,3226` | Native coding runtime closes during window teardown/quit, but not after local Host channel failure. Its IPC capability closes itself (`native-coding-host-ipc-client.mjs:120`) while `nativeCodingRuntime` remains non-null. A replacement Host cannot reuse that capability, and the initialization guard does not recreate it. | Fence new dispatch immediately, drain the old coding runtime, discard old capabilities, re-run full local-provider admission and bind a new runtime/capability to the new Host generation. Keep historical ambiguous executions readback-only. |
| P1 | `apps/metaengine-browser/src/native-coding-host-observers.mjs:230,246`; `native-coding-runtime.mjs:217` | Worker registry marks any fulfilled completion as `EXITED`, even if its result says `tree_cleanup_confirmed:false`. `close()` discards settled termination failures, and runtime close returns a snapshot rather than explicit physical cleanup proof. | Before recovery permits another worker on the same worktree, retain each completion outcome and require positive native tree cleanup, or retain a recovery fence. A fulfilled `close()` alone is not a cleanup witness. |
| P1 | controller `:282-290`; `apps/metaengine-browser/src/main.mjs:2376-2394` | Unexpected Host exit only marks provider boot blocked. The existing automatic retry creates the Browser shell; it does not constitute a replacement local Host and native capability recovery path. | Add a serialized, bounded recovery coordinator with explicit eligibility, cleanup and fresh-admission stages. A timer that retries shell creation is insufficient. |

The native worker's signed `host_process` is the Browser parent, not the separate
DB runtime-host process. Therefore channel loss does not by itself prove that
the native Windows Job lost its owner. Existing workers still have their native
deadline. The defect is the absent explicit drain/rebind/reconciliation contract;
this report does not claim unlimited uncontrolled worker lifetime.

## Current producer semantics and repair

The launcher owns only processes it created. Attached mode adds API and Edge to
its child list, not the external PostgreSQL/Keeper (`launcher.mjs:503-525`).
`stop()` shuts down that list in reverse order and returns `children_stopped`
(`:362-398`). Host persists terminal status, then releases only its exact lock
bytes (`runtime-host.mjs:164-171,350-362`). PID presence, an open database port,
or Host exit code are not equivalents of these two completed actions.

This stream adds `runtime-host-lifecycle.mjs` and connects it to the Host:

- The Browser supplies `COMPUTE_RUNTIME_HOST_LAUNCH_NONCE` as a UUID and requires
  a matching terminal proof. Legacy direct qualification callers may omit it,
  including callers with IPC; they receive no terminal proof. A present invalid
  nonce fails closed. The controller cannot downgrade its proof requirement.
- `compute.runtime-host-terminal.v1` contains exactly `schema`, `launch_nonce`,
  `host_pid`, `instance_id`, `state`, `children_stopped`, `ownership_released`,
  `reason`, and `authority_effect`. It contains no paths, configuration or secrets.
- Positive terminal proof is emitted only after status persistence and exact-lock
  release both succeed. Reasons are finite; unknown reasons become `runtime_ended`.
- A known, cleaned pre-READY failure keeps the diagnostic status `FAILED`, emits
  a null-instance terminal with reason `runtime_host_start_failed`, then sends the
  fixed failure envelope. Terminal `STOPPED` describes owned resource cleanup and
  does not assert that startup ever succeeded.
- Cleanup uncertainty, failed status persistence and changed ownership emit no
  positive terminal proof. Pre-ownership failures/reconciliation ambiguity have
  no positive receipt in this patch; the consumer must fail closed for them.
- Terminal and failure IPC wait at most one second for the send callback before
  disconnect. Failure/absence of that callback never grants cleanup or retries.

The only actionable startup failure currently forwarded over IPC is
`runtime_host_recovery_startup_custody_missing`; other private errors map to
`runtime_host_start_failed`. The finite original diagnostic remains in local
Host stderr/status as applicable.

## Recovery eligibility

`runtime_health_failed` is not a sufficient retry predicate. The launcher uses
that same terminal reason for transient transport failures, PostgreSQL identity
changes and capability/source mismatch (`launcher.mjs:541-573`). A replacement
must read the matching finite `last_health_failure`, not infer it from exit code.

Minimal conservative policy after positive terminal proof:

1. Cancel any pending replacement when application shutdown is requested.
2. Retain the exact failed generation and its terminal/health evidence. Verify
   the same protected Owner/config/bundle binding and no unresolved upgrade or
   recovery gate. Do not rewrite Owner or delete old journal/lock records.
3. Permit a bounded backoff for API/Edge transport timeout, connection refusal,
   network failure, or selected HTTP 408/429/5xx results. A deliberate stop is not
   a recovery request. Treat malformed responses, unattested/source-mismatched
   capability, PostgreSQL identity/incarnation errors, permissions/auth failures,
   missing databases and unclassified errors as held until resolved.
4. Drain old native coding work and require physical tree cleanup before handing
   a mutable worktree to a new generation. Preserve every attempted/unknown write
   and execution. Reconnection does not authorize replay.
5. Reuse the established full bootstrap path: pinned bundle, exact process,
   durable status UUID, current health/capability admission, fresh IPC capability.
   Recreate dependent native runtime bindings. Existing W30 remains the allocator.
6. Require an installed fault-injection run: one real qualifying transient failure,
   positive cleanup, fresh ready generation, independent PG/Keeper continuity,
   retained task/lease history and useful successor work without duplicate effects.

The abandoned-lock reconciler is deliberately narrower than general restart. It
accepts only pinned attached READY records with exactly API+Edge children, checks
host/child PID and API/Edge port absence twice, preserves old lock bytes by rename,
and retains a durable gate on ambiguous rename (`runtime-host-orphan-reconciliation.mjs:37-165`).
`STARTING` without complete custody remains an explicit recovery hold. A listening
PostgreSQL port there is only a preservation condition; the successor launcher
still performs its independent database identity qualification.

## Validation in this stream

`runtime-host-lifecycle.test.mjs`: **8 PASS, 0 FAIL, 0 SKIP**. Includes terminal
ordering/uniqueness, malformed or unconfirmed proof rejection, bounded IPC flush,
changed lock and failed status persistence, known/unknown pre-READY cleanup, and
a real spawned Host delivering its startup failure IPC before closing, including
legacy missing-nonce compatibility and rejection of a present invalid nonce.

The resumed root-owned qualification ran the controller, real inert child terminal,
native IPC, worker registry and native runtime suites together: **107 PASS, 0 FAIL,
0 SKIP**. They exercise exact nonce/PID/instance terminal admission, shutdown before
spawn and READY, invalid terminal revocation, real channel loss, stale capabilities,
native worker cleanup uncertainty, asynchronous spawn/close races and preservation
of unknown execution/completion outcomes.

The Host, lifecycle and launcher suites together produced **55 PASS, 0 FAIL, 0 SKIP**.
This includes all callers joining the same unsuccessful launcher stop: each rejects
with `runtime_cleanup_unconfirmed`; neither a concurrent startup catch nor a later
stop can turn `{children_stopped:false}` into a successful release. Abort during API
startup preserves either that cleanup uncertainty or the original startup failure
after positively confirmed cleanup. The first launcher attempt lacked the exact
offline `postgres@3.4.7` dependency and failed before launch; the dependency was
restored only under ignored `node_modules`, without source/lockfile changes.

These are source and isolated fixture tests, including real inert ChildProcess
channels and fixture API/Edge servers. They do not establish installed recovery,
real model work or autonomous agent continuity. No installed process, Owner or
Keeper was used. Full installed fault injection and useful restart continuation
remain separate gates.

## Fresh Browser generation is still required

The active Supervisor instance is captured at module evaluation in
`native-supervisor-endpoints.mjs:57-69`; `explicit-local-supervisor-provider.mjs:26-34`
rejects an environment instance that differs from that protected pin. Therefore a
new Host UUID inside the same Browser cannot honestly rebind the whole Supervisor
by assigning environment variables or merely replacing the native IPC capability.
The real-child tests above qualify controller generation custody only, not complete
application recovery. The next implementation must either use a fresh verified
Browser bootstrap or explicitly redesign all dependent generation bindings.

The selected next approach is a bounded same-executable Browser relaunch after
positive Host cleanup, positive native-worker tree cleanup, retained ambiguous
effects and a durable restart-intent/readback barrier. Existing Guardian
`RESTART_EXACT_CHILD` output is a plan requiring its separately admitted durable
effect executor, not permission to issue a restart. Existing self-update release
authority must not be reused as fabricated same-version recovery authority.
