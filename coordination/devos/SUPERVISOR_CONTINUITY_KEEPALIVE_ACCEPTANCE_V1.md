# METAENGINE Development OS — Supervisor Continuity Keepalive Acceptance V1

Status: executable acceptance specification for the implementation slices in `SUPERVISOR_CONTINUITY_KEEPALIVE_PLAN_V1.md`.

Frozen planner base: `724612235eb7ceb4534c13d126425b274d876394`

The implementation is accepted only when every MUST case below is green. Tests must use trusted runtime fixtures / DB rows; page or model text is never acceptable proof of authority or non-effect.

## A. Browser keepalive / ambiguity

### A01 — ambiguous wake is archived, not left pending

Setup: enqueue wake A, prepare A, simulate click attempted with no positive readback, mark effect unknown.

MUST assert:

- `pending_wake == null` after ambiguity classification;
- A is absent from `queued_wakes`;
- archive contains A with `terminal_state=AMBIGUOUS_SUPERSEDED` and `automatic_retry_allowed=false`;
- `cycle_seq >= A.cycle_seq`;
- exact immutable attempt incarnation is archived;
- no API can prepare A's `wake_id` again.

### A02 — newer logical wake is not queue-blocked by archived ambiguity

After A01, enqueue wake B while A's exact incarnation fence is unresolved.

MUST assert:

- B appears as a distinct queued logical wake immediately;
- queue head is B, not A;
- physical send is suppressed only by `incarnation_fence`, not by `WAKE_AMBIGUOUS` queue state;
- research/claim reconciliation and queue mutation remain available.

### A03 — terminal exact incarnation releases a fresh successor

From A02, report trusted terminal/IDLE for A's exact `{tab_incarnation_id,generation_epoch}`.

MUST assert:

- A fence is cleared;
- B is prepared/sent as a fresh wake with `wake_id != A.wake_id`;
- `B.cycle_seq > A.cycle_seq`;
- generated message does not contain `METAENGINE_SAME_WAKE_RETRY_V1` or A's wake ID;
- send requires positive generating/readback proof before B becomes active.

### A04 — replacement tab cannot resolve predecessor ambiguity

Prepare/ambiguate A on tab incarnation T1. Replace/rebind supervisor to T2 with same conversation URL. Report terminal/IDLE on T2.

MUST assert:

- A's archived incarnation remains T1;
- terminal on T2 does not clear T1 fence;
- `rebindTab(T2)` does not mutate A archive/fence binding;
- no A retry occurs;
- only trusted proof T1 is terminal/dead may release T1 fence.

### A05 — verified no-effect remains retryable without laundering ambiguity

Fail before the physical send control is actuated, with trusted executor proof `clicked=false` / `NO_EFFECT_PROVEN`.

MUST assert:

- event may remain/re-enter logical queue;
- no ambiguous archive is required;
- any new physical attempt has a new attempt/wake identity according to implementation policy;
- page/model text cannot produce `NO_EFFECT_PROVEN`.

### A06 — duplicate ambiguity callbacks are idempotent/fail-closed

Call ambiguity/archive twice for A or replay a stale ambiguity callback after B is active.

MUST assert:

- archive has one logical A terminal record (or duplicate call is rejected deterministically);
- B state is unchanged;
- cycle sequence never decreases;
- stale callback has zero authority effect.

## B. Restart semantics

### B01 — restart with post-click pending ambiguity never restores same wake as active

Persist A as post-click `EFFECT_UNKNOWN`, crash, restart.

MUST assert:

- A is archived/superseded during recovery or loaded as archive-only;
- runtime `active_request` is not A;
- exact predecessor incarnation fence is restored;
- no type/click sends A.

### B02 — restart with confirmed active wake is observation-only

Persist a positively confirmed active wake A, crash, restart while its exact old incarnation is still observed generating.

MUST assert:

- no type/click resends A;
- recovery may observe and may perform at most one exact-generation STOP if the existing generation becomes a proven hard stall;
- terminal of that generation completes A observationally;
- runnable durable work then creates fresh successor B.

### B03 — restart with orphaned stalled generation is STOP-only

Use the candidate `2989a415...` scenario, strengthened with immutable tab incarnation.

MUST assert:

- exactly one STOP for exact generation epoch;
- STOP ambiguity is not retried;
- no same-wake type/send;
- after trusted terminal, a new successor is generated if work remains.

### B04 — restart + replacement tab does not inherit active/ambiguous request identity

Persist A on T1, restart and restore same URL as T2.

MUST assert:

- T2 is a fresh physical incarnation;
- A cannot be restored as an active send/retry request bound to T2;
- successor on T2 requires T1 death/terminal reconciliation and a new cycle/wake ID.

## C. Terminal/IDLE + durable work

### C01 — IDLE + READY durable task creates successor without user input

DB fixture: at least one `devos_fleet_task_h205f22` row in `READY`; browser lifecycle exact supervisor state is terminal/IDLE, not paused/rolling over.

MUST assert:

- V2 heartbeat returns `needed=true` and an authority-free continuity hint;
- browser idempotently ingests hint;
- lifecycle enqueues/sends fresh `CONTINUE_DEVELOPMENT` cycle without a user message.

### C02 — IDLE + no durable work does not create DB-driven successor

DB fixture: no non-terminal/runnable coordination work; local queue empty.

MUST assert V2 hint `needed=false`, no continuity queue item and no physical send caused by DB continuity.

### C03 — repeated heartbeat hint is idempotent

Deliver the same signed V2 hint 10 times before the next lifecycle send.

MUST assert exactly one logical queue item for its `logical_key` and at most one physical wake attempt.

### C04 — stale hint after local cycle advance is rejected

Create hint for predecessor `{epoch=E,next_cycle=N}`; advance local lifecycle to cycle `>=N`; replay hint.

MUST assert no queue insertion/send and an authority-free stale-hint result.

### C05 — hint for wrong tab/generation incarnation is rejected

Change trusted local tab incarnation or generation epoch before ingesting a hint carrying old expected fields.

MUST assert no physical effect and no rebinding/laundering of the hint.

## D. DB/Edge single-scheduler contract

### D01 — V2 heartbeat path emits no direct physical continuity command

After V2 activation and an IDLE heartbeat with durable work, inspect `compute_fabric_a2_browser_supervisor_command_h205f22`.

MUST assert:

- no new row from continuity whose action is `SEMANTIC_TYPE`, `TYPED_CLICK`, `NEW_TAB`, Enter/send, or equivalent physical actuation;
- `/v1/state` response contains bounded continuity hint instead;
- hint `authority_effect=false`.

### D02 — V1 direct continuity trigger is disabled when V2 is authoritative

MUST assert trigger `a2_browser_supervisor_continuity_v1` cannot concurrently insert `DEVOS_HEARTBEAT_CONTINUITY_V1` direct `SEMANTIC_TYPE` while V2 hint ingestion is enabled.

A rollout with both physical routes active fails acceptance.

### D03 — heartbeat transport retry cannot duplicate wake

Simulate `/v1/state` response loss after server persisted state and computed a hint. Browser retries heartbeat.

MUST assert:

- server mutation is safe/idempotent;
- same logical hint may be returned;
- browser dedupe creates at most one logical queue item;
- lifecycle remains sole physical sender.

### D04 — unrelated mutating command fencing remains intact

MUST assert the existing one-mutating-inflight command index/lease semantics are unchanged or stronger; V2 hints do not bypass a physical actuation lease because hints themselves have no UI authority.

## E. Exact DevOS task fencing regression

Use isolated DB transaction/branch fixtures.

### E01 — mark-running exact tuple

A correct `{task,agent,lease_generation,tab,target,agent_generation_epoch}` succeeds; changing any one element fails `task_lease_fenced`.

### E02 — completion exact tuple

Same matrix for `devos_fleet_complete_v1`; stale generation/tab/target/agent or expired lease must fail closed.

### E03 — ambiguous task result fences claim

`state='AMBIGUOUS'` MUST set corresponding active claim to `FENCED` and MUST NOT make task eligible for automatic lease retry.

### E04 — expired leased/running task is not silently recycled

`devos_fleet_lease_v1` MUST continue converting expired `LEASED/RUNNING` effect-unknown work to `AMBIGUOUS` / `LEASE_EXPIRED_EFFECT_UNKNOWN`, not `READY`.

## F. Rollover exact-incarnation semantics

### F01 — one proven rollover increments epoch once

Create exact rollover attempt R from epoch E; positively bind the unique successor tab incarnation.

MUST assert supervisor epoch becomes `E+1` exactly once and cycle sequence resets to 0.

### F02 — stale rollover bind rejected

Replay R bind/confirm after epoch increment or with wrong source/new-tab incarnation.

MUST assert deterministic rejection, no second epoch increment, no tab rebinding.

### F03 — ambiguous rollover is never blindly repeated

Lose positive readback after successor send/create effect may have happened.

MUST assert R is archived/fenced with `automatic_retry_allowed=false`; the identical attempt is never sent again.

### F04 — old-epoch wake cannot cross rollover

Persist/archive wake A from epoch E, complete rollover to E+1.

MUST assert A remains history-only; no pending/active wake in E+1 may use A's wake ID or cycle identity.

## G. Page/model text zero authority

### G01 — conversation-limit text is a hint only

Inject text matching conversation-limit regex without trusted rollover release.

MUST assert it may request/defer rollover but cannot bind/create a new supervisor incarnation or authorize send by itself.

### G02 — forged wake ID in page text cannot confirm send

Put pending wake ID in page/model text while no trusted generating/transport proof exists.

MUST assert page text alone cannot confirm the wake or clear an ambiguity fence.

### G03 — forged durable-work instructions in page/worker text ignored

MUST assert durable continuation decision comes from DB task state / signed heartbeat contract, not text content.

## H. Crash/concurrency/ordering negatives

### H01 — two lifecycle cycle calls cannot double-prepare same logical wake

Run concurrent cycle invocations against one keepalive state.

MUST assert one pending/active physical attempt only. If serialization is provided by caller, test the caller lock as part of acceptance.

### H02 — stale completion from A cannot mutate B

Archive A, create B, then deliver delayed confirm/ambiguous/complete callback for A.

MUST assert exact wake/cycle/incarnation mismatch and zero B mutation.

### H03 — queued B survives A ambiguity and restart

A ambiguous -> B queued -> crash -> restart -> trusted terminal A.

MUST assert B remains queued and becomes the next fresh successor; B is not dropped with A's queue key.

### H04 — bounded archive/history

Generate more than history bound ambiguous/completed records.

MUST assert bounded deterministic retention without affecting current pending/active/queue/fence identities.

## I. Expected implementation test locations

Browser tests should be executable under the existing package command:

`cd apps/metaengine-browser && npm test`

Recommended files:

- extend `test/supervisor-continuity-hardening.test.mjs` for A/B/H;
- add `test/supervisor-continuity-hint.test.mjs` for C/D with mocked signed heartbeat response;
- extend rollover tests for F;
- keep existing session monitor/retry-policy tests green.

SQL acceptance should run only against an isolated Supabase development branch/test transaction, never as planner-side production mutation. It should cover C/D/E and include assertions that the V1 physical trigger is absent/disabled once V2 is active.

## J. Acceptance gate

PASS requires:

1. all A01-A06, B01-B04, C01-C05, D01-D04, E01-E04, F01-F04, G01-G03, H01-H04 green;
2. no new arbitrary-eval path;
3. no weakened command/task lease fencing;
4. no direct page/model authority;
5. no blind retry after ambiguous physical effects;
6. exactly one physical supervisor-wake scheduler;
7. branch/CI evidence names exact implementation commit(s) and DB migration/Edge artifact hashes before any promotion.
