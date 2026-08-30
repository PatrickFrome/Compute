# METAENGINE Development OS — Supervisor Continuity Keepalive Plan V1

Status: PLANNER evidence checkpoint (no production mutation)

Task: `c4642563-93e3-4232-8860-6c328dd59aa9`
Agent: `agent_51d8cebc-c716-493a-8f66-abcd9a8fb802`
Role: `PLANNER`
Lease generation: `1`
Frozen planning base: `724612235eb7ceb4534c13d126425b274d876394`
Target branch: `work/devos-continuity-keepalive-plan-v1`

## 1. Verified source-of-truth snapshot

### GitHub

The requested base is commit `724612235eb7ceb4534c13d126425b274d876394` (`Merge pull request #49 from PatrickFrome/work/devos-agent-plan-v7`). The source branch has moved ahead and therefore MUST NOT be used as this planner branch base. At inspection time `work/devos-elastic-fleet-bootstrap-v1` was at `83e2a010a374bcf4762f22b6afb78593c5f96288`, three commits ahead of the frozen task base.

The first of those three commits, `2989a415b7c661116c78a0aec999201019bcae89` (`fix(browser): make supervisor continuity restart-safe`), is a useful candidate implementation slice. It adds ambiguous-history retirement, STOP-only orphan recovery and two restart/ambiguity tests. The following two commits (`7a7bad9c...`, `83e2a010...`) are self-update timing changes and are not continuity dependencies.

At the frozen base, `SupervisorKeepalive.canWake()` treats `WAKE_AMBIGUOUS` as a global actuation blocker. `resolveAmbiguous({observed_sent:false})` clears `pending_wake` but leaves the original queue row, so the same logical queue event can later be prepared again. `pending_wake` does not persist the physical tab/generation incarnation.

At source head, `retireAmbiguousAfterTerminal()` consumes the old queue key, burns/advances the pending cycle number and archives the wake with `automatic_retry_allowed:false`. This fixes the most immediate blind replay. However the candidate still has two permanent-safety gaps:

1. `rebindTab()` can change the keepalive-level `tab_id` while an ambiguous pending wake exists. The pending record itself has no bound tab/target/generation incarnation, so a replacement tab can be used to retire ambiguity from an older physical incarnation.
2. `WAKE_AMBIGUOUS` remains represented as a global keepalive state until a terminal boundary is observed. New logical wake intents can be queued, but the ambiguous wake remains a state-level blocker rather than being immediately archived behind a separate physical-incarnation fence.

### Supabase `xpeibufgzjknrhbhpffp` (read-only inspection)

Current live schema has durable DevOS task/claim functions with exact task fencing. `devos_fleet_mark_running_v1` and `devos_fleet_complete_v1` require exact `task_id + agent_id + lease_generation + tab_id + target_id + agent_generation_epoch` and an unexpired lease. `devos_fleet_complete_v1(..., state='AMBIGUOUS')` fences the claim rather than retrying it. `devos_fleet_lease_v1` marks expired `LEASED/RUNNING` tasks `AMBIGUOUS` with `LEASE_EXPIRED_EFFECT_UNKNOWN` and returns `automatic_retry_allowed:false`.

Current supervisor continuity is not yet aligned with that fencing model. `h205f22_a2_browser_supervisor_continue_if_needed_v1` is fired from heartbeat persistence when the reported supervisor generation is `IDLE` and any non-terminal DevOS work exists. It directly inserts a physical `SEMANTIC_TYPE` + `submit_after_type:true` command. Its idempotency key is only `client_id + supervisor generation_epoch`.

`h205f22_a2_browser_supervisor_lease_control_v4` expires stale leased commands with `lease_timeout_no_retry`. The command table has a unique `(workspace_id,idempotency_key)` index across all command statuses. Therefore an ambiguous/expired continuity command permanently consumes that generation key; a later terminal heartbeat in the same generation cannot obtain a fresh successor command. This is a DB-native continuity deadlock and also creates a second physical scheduler beside `SupervisorLifecycleRuntime`.

The heartbeat trigger is `a2_browser_supervisor_continuity_v1` on `compute_fabric_a2_browser_supervisor_state_h205f22`. The deployed Edge function `a2-browser-native-supervisor-v1` version 2 persists heartbeat state, then leases control commands. Browser `NativeSupervisorClient.cycle()` independently runs `SupervisorLifecycleRuntime.cycle()` before and after heartbeat/command handling. Thus there are presently two routes capable of causing a supervisor message: lifecycle keepalive and DB-triggered direct `SEMANTIC_TYPE`.

At inspection time the active workspace had durable work remaining (`READY=7`, `LEASED=9`, `RUNNING=3`, `AMBIGUOUS=1`, plus terminal rows), so terminal/IDLE cannot be treated as global completion.

## 2. Permanent target contract

### 2.1 One physical scheduler

`SupervisorLifecycleRuntime` MUST be the only component allowed to prepare and physically send supervisor wake messages.

Supabase/heartbeat may report that durable continuation is required, but MUST NOT issue `SEMANTIC_TYPE`, `TYPED_CLICK`, Enter, or any other physical ChatGPT send as the continuity mechanism. The DB is the durable-work authority; the browser lifecycle is the physical-send authority.

Recommended permanent shape:

1. Replace the DB heartbeat trigger's direct command issuance with a read-only/authority-free continuity hint returned in the existing `/v1/state` heartbeat response.
2. `NativeSupervisorClient.#heartbeat()` validates and passes that hint to `SupervisorLifecycleRuntime.ingestContinuityHint()`.
3. The lifecycle idempotently enqueues the logical wake intent and remains the sole caller of `prepareNextWake()` / physical send.
4. Retire the `DEVOS_HEARTBEAT_CONTINUITY_V1 -> SEMANTIC_TYPE` path once the hint-capable browser/Edge pair is available.

This is not a second polling loop: it reuses the existing signed heartbeat and the existing lifecycle monitor loop.

### 2.2 Separate logical ambiguity from physical-incarnation fencing

An ambiguous physical send MUST be terminal for that wake ID immediately. Do not leave the ambiguous wake as the queue head and do not make it retryable.

Introduce these durable concepts in keepalive state (schema/version bump required):

- `wake_archive[]`: bounded append-only records for completed, failed-no-effect, and ambiguous/superseded wake attempts.
- `incarnation_fence`: at most one unresolved physical-effect fence for the supervisor tab incarnation.
- `queued_wakes[]`: logical future events only; an archived ambiguous event is removed from this queue.

Every prepared physical attempt MUST persist an exact immutable incarnation before the click can occur:

`{ supervisor_id, supervisor_epoch, cycle_seq, wake_id, conversation_url_sha256, tab_id, tab_incarnation_id, generation_epoch }`

`tab_incarnation_id` must come from trusted browser process/tab registry identity (for example the exact tab/target/WebContents incarnation already used by browser control), not page text or URL matching alone.

On post-click ambiguity:

1. atomically remove the matching logical queue row;
2. append the exact pending wake to `wake_archive` with `terminal_state='AMBIGUOUS_SUPERSEDED'`, `automatic_retry_allowed=false`, ambiguity reason/time and the immutable incarnation tuple;
3. advance/burn `cycle_seq` to at least the ambiguous pending sequence so that sequence is never reused;
4. clear `pending_wake` immediately;
5. install `incarnation_fence` for the exact physical incarnation if a terminal/death boundary is not yet proven;
6. continue accepting/deduplicating newer logical queue events behind the fence;
7. never rebuild a message containing the archived `wake_id`.

`incarnation_fence` blocks only physical actuation into the unresolved incarnation. It MUST NOT block enqueue, durable-work observation, claim reconciliation, research events, or construction of newer logical queue entries.

A pre-actuation failure with trusted proof that no click/send happened is not ambiguous. That event may remain queued and be prepared again according to normal policy; the distinction must be explicit (`NO_EFFECT_PROVEN` vs `EFFECT_UNKNOWN`). Page/model text may never prove `NO_EFFECT`.

### 2.3 Terminal/IDLE successor rule

When the exact current supervisor incarnation is terminal/IDLE and the browser is not paused/rolling over, the lifecycle MUST create a fresh successor cycle whenever either condition is true:

- there is a queued logical wake; or
- the signed heartbeat continuity hint says authoritative durable runnable/coordination work remains.

The successor MUST have:

- a new `wake_id`;
- `cycle_seq >` every archived/active/pending cycle in the current supervisor epoch;
- a freshly captured exact tab incarnation and current generation epoch;
- no `METAENGINE_SAME_WAKE_RETRY_V1` envelope from an ambiguous predecessor.

A terminal boundary may release `incarnation_fence` only when it matches the fence's exact tab incarnation and generation semantics. A replacement tab with the same URL is not evidence about the old incarnation.

### 2.4 Restart semantics

Restart recovery MUST classify durable wake state before any send:

- persisted `pending_wake` with post-click uncertainty -> archive as ambiguous/superseded, restore an exact incarnation fence, never resend;
- persisted `pending_wake` with trusted pre-click `NO_EFFECT_PROVEN` journal -> safe logical requeue, new physical attempt ID;
- persisted `active_wake` -> observation-only recovery; never resend the confirmed wake after restart;
- archived ambiguity -> history only, never active/pending;
- queued newer wake -> remains runnable but physical send waits for exact predecessor fence resolution if required.

If the old tab incarnation is provably gone, the fence may be released by trusted browser lifecycle evidence. URL equality or page/model text is insufficient.

The current `start()` behavior that reconstructs an `active_request` from `active_wake` must therefore be narrowed: recovery actions may observe/STOP a proven stuck exact incarnation, but retry functions must never treat restored state as permission to resend the old logical wake.

### 2.5 Rollover semantics

Rollover needs the same incarnation discipline:

- persist a `rollover_id` / `rollover_attempt` with source supervisor epoch and source tab incarnation before creating/sending to a successor conversation;
- `bindRollover()` must require the exact rollover attempt identity, expected source epoch, and trusted new tab incarnation;
- increment `supervisor_epoch` exactly once and reset `cycle_seq=0` only after positive successor binding proof;
- stale bind/confirm from a previous epoch must fail closed;
- archived wake IDs from the old epoch can never become pending/active in the new epoch;
- ambiguous rollover effects are never blindly repeated. Reconciliation may adopt one uniquely proven successor or require a new independently fenced rollover attempt only after old-attempt non-effect/death is proven.

### 2.6 Heartbeat continuity hint V2

Add a read-only Supabase RPC such as `h205f22_a2_browser_supervisor_continuity_hint_v2(workspace, client, state)` and return it from `/v1/state`.

The hint is advisory and `authority_effect=false`. It may be computed only from DB durable state plus signed device heartbeat fields, never page/model/worker text.

Minimum hint fields:

```json
{
  "schema": "metaengine.supervisor-continuity-hint.v2",
  "needed": true,
  "reason": "DURABLE_WORK_REMAINS",
  "logical_key": "...",
  "expected": {
    "client_id": "...",
    "supervisor_epoch": 1,
    "next_cycle_seq": 8,
    "tab_id": "...",
    "generation_epoch": 12
  },
  "authority_effect": false
}
```

`logical_key` must be derived from exact successor identity (client + supervisor epoch + next cycle sequence + trusted tab/generation binding) so repeated heartbeat delivery is idempotent. The browser must reject a stale hint when its current local epoch/cycle/tab incarnation no longer matches the expected predecessor.

The V2 RPC MUST NOT insert into the physical command table. The V1 continuity trigger/direct `SEMANTIC_TYPE` route must be removed or disabled in the same rollout slice that enables V2 hints, preventing dual scheduler actuation.

## 3. Dependency-ordered implementation slices

### D0 — Freeze evidence and preserve candidate work

- Keep this planner branch rooted at exact task base `724612235...`.
- Do not cherry-pick unrelated self-update timing commits.
- Treat source commit `2989a415...` as candidate input, not final authority.
- Before implementation, compare any newer source head against `2989a415...` to avoid duplicate edits.

Exit: implementation branch identifies exact parent and candidate patch provenance.

### D1 — Exact wake-attempt incarnation + archive/fence

Files: `supervisor-keepalive.mjs`, trusted tab identity plumbing, keepalive tests.

- persist bound tab/incarnation/generation on `pending_wake` before any click;
- replace state-level ambiguous pending with immediate archive + `incarnation_fence`;
- make `rebindTab()` update only future supervisor binding; never mutate an archived/pending attempt's incarnation;
- burn ambiguous cycle sequence;
- remove/deprecate any ambiguous-resolution path that can recycle the old queue key without trusted `NO_EFFECT` proof.

Exit: old wake ID cannot be prepared again and replacement-tab terminal cannot resolve old ambiguity.

### D2 — Lifecycle terminal/restart successor

Files: `supervisor-lifecycle-runtime.mjs`, `chatgpt-session-monitor.mjs` only if exact generation export is insufficient, tests.

- restore pending/active state in observation-only mode;
- STOP-only recovery remains at most once per exact generation epoch;
- terminal/death proof clears only matching `incarnation_fence`;
- terminal/IDLE immediately schedules a fresh successor when local queue or trusted durable-work hint requires it;
- stale/replaced tab cannot inherit predecessor request identity.

Exit: crash/restart and orphan stall cannot cause same-wake resend, and durable work resumes with a new cycle.

### D3 — Rollover exact-attempt binding

Files: keepalive/lifecycle rollover paths and tests.

- introduce exact `rollover_id` attempt record;
- fence bind/confirm to source epoch + source/new tab incarnations;
- preserve archives across epoch transition;
- reject stale rollover confirms/binds.

Exit: one positive rollover -> one epoch increment; stale old-epoch evidence has zero effect.

### D4 — DB/Edge continuity hint V2; remove second physical scheduler

Artifacts expected on implementation branch: migration SQL + Edge source + Browser heartbeat parser.

- add read-only `continuity_hint_v2` RPC;
- Edge `/v1/state` returns bounded V2 hint after state persistence;
- Browser parses and idempotently ingests it into lifecycle queue;
- V2 uses authoritative DevOS task state to decide `needed`;
- disable/drop V1 heartbeat trigger that inserts direct `SEMANTIC_TYPE` continuity commands;
- do not weaken existing command lease/index or DevOS task fences.

Exit: only lifecycle physically sends wake messages; repeated heartbeat hints cannot duplicate a wake.

### D5 — Cross-plane integration tests and rollout gate

- run Browser unit/acceptance suite;
- run SQL tests in an isolated/dev database transaction, never production mutation for validation;
- test Edge heartbeat contract with signed fixture/device mock;
- verify no direct continuity `SEMANTIC_TYPE` row is emitted under V2;
- verify task claim functions still enforce exact task-agent-tab-target-generation fencing;
- verify `authority_effect=false` for hint/archive/checkpoint operations.

Exit: all acceptance tests in `SUPERVISOR_CONTINUITY_KEEPALIVE_ACCEPTANCE_V1.md` green.

## 4. Rollout order (fail-closed)

1. Land D1-D3 Browser support first, retaining compatibility with existing DB V1 but guarding against duplicate logical wake preparation.
2. Land Browser V2 heartbeat-hint parser before server starts returning required hints; unknown hints must be ignored fail-closed.
3. In one server migration/deploy window, expose V2 hint and disable the V1 direct continuity trigger. Never run both physical schedulers as an intended steady state.
4. Observe one complete terminal -> hint -> enqueue -> fresh wake -> terminal cycle with exact IDs.
5. Only after evidence, remove dead V1 continuity code. Production promotion is outside this planner task.

Rollback rule: rollback may restore V1 only if V2 is disabled first. Never enable V1 direct physical continuity while V2 lifecycle ingestion is concurrently allowed to send the same logical continuation.

## 5. Hard invariants / non-goals

- No blind retry after an ambiguous physical effect.
- Page/model/worker text has zero authority.
- No arbitrary eval.
- No second physical scheduler or independent polling loop.
- Exact task-agent-tab-target-generation fences stay unchanged or stronger.
- Ambiguous wake ID and cycle sequence are never reused.
- Replacement tabs cannot launder old-incarnation evidence.
- Heartbeat retry is safe because hints are advisory/idempotent and do not directly actuate UI.
- No main merge, production deployment, schema mutation, Edge deployment, release promotion, or secret access in this planning checkpoint.
