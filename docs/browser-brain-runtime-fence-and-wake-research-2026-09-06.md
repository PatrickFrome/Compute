# Browser Brain runtime fence, wake, scoped leasing, and zero-artificial-wait research

Date: 2026-09-06
Status: branch-local research + reversible implementation contract; production unchanged
Branch: `work/browser-brain-runtime-fence-v1`

## Executive finding

The local Browser architecture is already close to the target Browser Brain model, but four independent control-plane gaps still prevent the intended latency and parallelism from becoming true end-to-end behavior:

1. the live production issuer durably inserts a `PENDING` command but does not emit the private `COMMAND_AVAILABLE` wake consumed by the newer held-wait design;
2. production is behind the branch: the deployed `a2-browser-native-supervisor-v1` still exposes singular `/v1/commands/next`, while the repository branch contains batch leasing and `/v1/commands/wait-batch`;
3. the live command table has a partial unique index that permits only one `PENDING`/`LEASED` mutating command per `(workspace_id,target_client_id)`, which serializes all BrowserCells before the local 32-lane scheduler can help;
4. the local semantic actuation path still had attach/detach-per-call CDP behavior and a 100 ms polling loop for submit readback even though the observation plane already owns persistent CDP sessions.

This branch removes the two local artificial waits and adds a fail-closed runtime mutation fence. The server findings are documented but not deployed because the current standby peer does not have trusted actuation authority and rollover readback is not yet positively proven.

## Production facts verified read-only

### Canonical issuer wake gap

`public.h205f22_a2_browser_supervisor_issue_native_v1(text,text,text,jsonb,integer,text,text)` validates client freshness, action, payload and idempotency, inserts one `PENDING` row into `compute_fabric_a2_browser_supervisor_command_h205f22`, and returns an acknowledgement.

It does not call `realtime.send()`.

The durable command row is therefore present, but a Browser already waiting on the repository's private Realtime wake path has no issuer-side signal from this function.

### Production is behind the repository control plane

The deployed `a2-browser-native-supervisor-v1` version observed during this research still uses the singular lease RPC `h205f22_a2_browser_supervisor_lease_v3` and route `/v1/commands/next`.

The repository branch already contains:

- `h205f22_a2_browser_supervisor_lease_batch_v1` as the intended batch lease dependency;
- `/v1/commands/next-batch`;
- `/v1/commands/wait-batch`;
- private Realtime subscription logic with the race-closing sequence `lease -> subscribe -> lease recheck -> wake -> lease`.

The batch RPC was not present in the live database at the time of the read-only check. Therefore no latency claim based on branch `wait-batch` should be attributed to current production until rollout and readback prove that exact version.

### Hidden global mutation serialization

The live table contains the partial unique index:

`a2_browser_supervisor_one_mutating_inflight_uq`

on `(workspace_id, target_client_id)` for rows whose status is `PENDING` or `LEASED` and whose action is not in the read-only action set.

This means the database currently allows only one outstanding mutating command for the entire Browser client. It prevents 32 independent BrowserCell mutation streams regardless of the local scheduler's capacity.

Removing this index without replacement would be unsafe. The correct replacement is durable mutation-scope semantics.

## Local branch changes

### Exact runtime mutation fence

`BrowserBrainRuntimeControlPlane` composes the existing runtime binding index, bounded Brain working memory and pressure governor.

For every DB-leased tab mutation it can prepare a fence containing:

- command id and action;
- explicit `tab_id`;
- BrowserCell id/generation when available;
- binding generation;
- `WebContents.id`;
- renderer PID;
- renderer process identity based on PID + process creation time;
- real CDP TargetID;
- document/semantic generations.

A synthetic `webcontents:<id>` observation fallback is rejected as mutation authority. The fence must be revalidated immediately before the physical side effect against the current binding generation, current `WebContents.id`, current OS renderer PID and `getOrCreateDevToolsTargetId()`.

`AMBIGUOUS` working-memory state blocks further same-cell mutation preparation until reconciliation. Renderer/WebContents death invalidates the binding synchronously from lifecycle events; the periodic census is reconciliation/telemetry only and is explicitly not execution authority.

### Persistent CDP in the actuation hot path

`native-browser-control.mjs` now reuses `PersistentBrowserCdpSessionPool` through `withPersistentBrowserDebugger()` instead of attaching and detaching a debugger session around each semantic command/capture.

This aligns observation and actuation with one persistent local nervous-system transport and removes an avoidable attach/setup edge from the hot path.

The legacy server effect-binding remains unchanged in this slice: its target identity is still `webcontents:<id>`. The new runtime fence is an additional local proof using the real CDP TargetID and does not widen remote authority.

### Event-driven physical outcome latch

The old ChatGPT submit readback performed up to 20 `Accessibility.getFullAXTree` reads separated by 100 ms sleeps.

The new `BrowserCdpOutcomeLatch` instead:

1. subscribes before Enter;
2. schedules one race-closing semantic read;
3. reacts only to relevant Accessibility/DOM/Page/Runtime events;
4. coalesces events arriving during an in-flight inspection into one follow-up read;
5. has no polling timer;
6. uses only one bounded terminal deadline;
7. resolves to `AMBIGUOUS_AFTER_ENTER` on an unproven deadline and never manufactures an automatic retry.

Relevant wake methods currently include `Accessibility.nodesUpdated`, `DOM.documentUpdated`, navigation/lifecycle events and `Runtime.executionContextCreated`.

## Server evolution: transactional wake

The intended invariant is:

`durable issue -> bounded private wake hint -> canonical durable lease`

The wake must never become command authority.

After successful command insertion, the issuer should call database Broadcast in the same transaction using a payload that contains no command payload, capability, lease or authority-bearing material. The exact client topic should match the wait consumer, e.g.:

`metaengine-control:<workspace_id>:<client_id>`

with event `COMMAND_AVAILABLE` and `private = true`.

A minimal payload can be only a schema/version marker and perhaps a bounded count. The Browser must ignore payload semantics and perform the existing durable lease RPC.

Properties:

- lost wake: command remains `PENDING`; held-wait timeout/fallback lease can recover it;
- duplicated wake: causes another lease attempt only;
- reordered wake: database state still decides what can be leased;
- transaction rollback: command and database-side wake insert roll back together;
- Broadcast delivery is never an acknowledgement of execution.

Supabase documents database Broadcast as an insert into `realtime.messages` followed by logical-replication/WAL delivery to subscribed WebSockets. Private/public configuration must match between `realtime.send(..., is_private)` and the channel subscription.

## Server evolution: durable mutation scopes

The current client-global unique index must not simply be removed. Replace its semantic responsibility with explicit scope metadata and lease logic.

Recommended command fields (names provisional):

- `mutation_scope_kind`: `READ | CELL | CLIENT_GLOBAL`;
- `mutation_scope_key`: nullable for reads/global, otherwise a normalized durable BrowserCell identity (or exact tab identity during migration);
- `scope_sequence`: monotonic sequence inside `(workspace, client, scope)`;
- optional `causal_predecessor_id` when a cross-scope dependency must be represented durably.

### Admission semantics

Use a short transaction-level admission critical section per `(workspace,client)` only to make the decision race-free. This is not an execution mutex and should not survive the issuance transaction.

For a `CELL` mutation:

- reject/defer only when an earlier active `CLIENT_GLOBAL` barrier conflicts;
- permit commands for different cells to coexist;
- preserve same-cell sequence.

For a `CLIENT_GLOBAL` mutation:

- it forms a barrier against cell mutations according to causal/order policy;
- do not allow later cell mutations to leapfrog it.

Reads have no mutation scope lock but can still be bounded by the pressure governor.

PostgreSQL transaction-level advisory locks are appropriate for this tiny issuance/admission race boundary because they are automatically released at transaction end. They must not be held across Browser execution or WAN waits.

### Lease semantics

Batch lease should use queue-style row locking (`FOR UPDATE SKIP LOCKED`) and select:

- many independent reads up to the pressure-derived read budget;
- at most one runnable mutation per cell scope;
- no mutation whose same-scope predecessor is unresolved;
- no cell mutation across a preceding client-global barrier;
- no command from a cell in durable/reconciled `AMBIGUOUS` attention state if that state is represented server-side.

`SKIP LOCKED` is suitable here specifically because this is a queue-consumer workload; it is not appropriate as a general consistency mechanism.

The local scheduler remains responsible for O(1) causal dispatch after lease. The DB does not become a second scheduler; it only makes the durable lease set race-free and scope-safe.

## Why one-PENDING-per-scope is also too restrictive

The current index includes both `PENDING` and `LEASED`. If copied mechanically to each BrowserCell it would still cap each cell's queued causal chain at one command and would prevent useful batch issuance.

The target design should permit multiple `PENDING` commands per cell with explicit sequence/predecessor information, while ensuring only the runnable head can become `LEASED`/physically dispatched. This supports a 256-command batch without sacrificing same-cell order.

## Exact target graph evolution

Electron exposes:

- `WebContents.id`;
- `getOSProcessId()`;
- `getOrCreateDevToolsTargetId()`;
- lookup from CDP TargetID back to WebContents.

The CDP Target domain can discover and auto-attach related targets and emits `targetDestroyed`/`targetCrashed` events. The next wiring step should use these lifecycle edges as immediate binding invalidators and keep the 250 ms process metric sample strictly for resource pressure/reconciliation.

The runtime mutation fence intentionally treats the real CDP TargetID as mandatory. A fallback identity is useful for observation continuity but is insufficient proof for physical mutation.

## Pressure signal refinement

The project currently targets Electron 44.0.0 / Node 24.18.x. Avoid making a newer Node-only event-loop-delay mode a hard dependency.

Preferred hot pressure inputs:

- delta `performance.eventLoopUtilization()`;
- Electron process metrics keyed by PID + creation time;
- renderer unresponsive/crash lifecycle events;
- network in-flight counts already derived from the persistent Network domain;
- lease/result RTT and durable pickup age.

Periodic event-loop-delay histograms may remain optional telemetry. Missing pressure signals must degrade capacity conservatively rather than claim GREEN.

## Latency instrumentation

Avoid subtracting timestamps from different hosts where possible.

DB-clock segments:

- `issued_at -> leased_at` (primary command pickup SLA);
- `issued_at -> completed_at` / receipt commit.

Browser monotonic segments:

- wait response/wake -> lease response;
- lease response -> scheduler admission;
- admission -> runtime-fence validation;
- fence validation -> physical dispatch;
- physical dispatch -> proven readback;
- proven readback -> result request.

Include correlation fields but no command payload/page text:

- `command_id`;
- cell/scope hash or bounded identifier;
- binding generation;
- renderer process key hash if needed externally;
- CDP target hash if needed externally;
- pressure band;
- wake reason;
- effect outcome (`CONFIRMED | AMBIGUOUS | FAILED`).

Report p50/p95/p99 separately for pickup, dispatch and physical readback. Do not collapse them into one latency number or a server improvement can hide a Browser-side regression.

## Rollout order

Production remains unchanged until the trusted actuation/rollover readback invariant is restored.

When rollout is allowed, use this order:

1. prove exact deployed Edge/database version and positive readback;
2. deploy batch lease/wait-batch consumer path without changing authority;
3. deploy transactional private issuer wake and verify `issued_at -> leased_at` improvement;
4. wire local runtime fence into the final mutation callsite and remove selected/platform fallback for DB-leased tab mutations;
5. introduce durable mutation scopes and batch lease fairness behind compatibility/readback gates;
6. only then raise concurrency toward 32 cell mutation lanes under the existing pressure governor;
7. add persistent main-process <-> Brain UI MessagePort deltas after execution authority is exact and observable.

At each phase, loss of wake, semantic delta transport or pressure telemetry must degrade to the existing durable authority path rather than grant a new one.

## Primary references

- Electron WebContents: https://www.electronjs.org/docs/latest/api/web-contents
- Electron Debugger: https://www.electronjs.org/docs/latest/api/debugger
- Electron MessageChannelMain: https://www.electronjs.org/docs/latest/api/message-channel-main
- Chrome DevTools Protocol Target domain: https://chromedevtools.github.io/devtools-protocol/tot/Target/
- Supabase Realtime Broadcast: https://supabase.com/docs/guides/realtime/broadcast
- PostgreSQL 17 advisory locks: https://www.postgresql.org/docs/17/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS
- PostgreSQL 17 explicit/advisory locking: https://www.postgresql.org/docs/17/explicit-locking.html
- PostgreSQL 17 SELECT locking / SKIP LOCKED: https://www.postgresql.org/docs/17/sql-select.html
