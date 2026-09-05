# METAENGINE Browser Brain Control Plane — 2026 Technical Limit

Status: branch-local design and implementation guide. No production authority is granted by this document.

## 1. Goal

The Browser Brain should behave as a continuously attached nervous system rather than a remote macro runner:

`Chromium/Electron events -> exact live binding -> bounded working memory -> brain decision -> durable DB lease -> keyed local dispatch -> physical readback -> durable outcome -> cognitive delta`

The target is not physically impossible zero latency. Chromium IPC, renderer scheduling, OS scheduling, WAN RTT, TLS and database commit latency remain real. The engineering target is **zero artificial polling / attach / full-snapshot / global-scheduler wait on the normal path**.

The page, renderer and model output remain untrusted data. Observation transport never becomes execution authority. `AMBIGUOUS` is never auto-retried.

## 2. Current proven substrate

The existing codebase already has the important lower layers:

- event-driven Electron process/WebContents observation plus periodic resource-only sampling;
- persistent CDP Page/DOM/Accessibility/Runtime/Network perception;
- bounded cognitive delta stream with explicit gaps and snapshot recovery;
- zero-timer cognitive delta transport with exact ACK/cursor semantics;
- authenticated cognitive Edge route and durable gap-safe ingest;
- held signed `/commands/wait-batch` command pickup;
- keyed read-only / tab-mutation / global / emergency command lanes;
- effect intent binding and physical post-condition readback;
- BrowserCells, fleet, owner/session binding and fail-closed recovery.

This slice adds the missing exact runtime identity and compact hot-memory primitives. Wiring remains a separate step.

## 3. Exact live identity: no URL/title heuristics

Every executable BrowserCell target should have one live binding record:

`cell_id + cell_generation`
`-> tab_id`
`-> WebContents.id`
`-> renderer OS pid + ProcessMetric.creationTime`
`-> CDP TargetID`
`-> document_generation + semantic_revision`
`-> binding_generation`

`pid` alone is insufficient because the OS can reuse it. Electron explicitly documents `pid + creationTime` as the useful unique process identity. A renderer crash/replacement, WebContents replacement, target replacement or binding generation change fences the old target immediately.

The runtime binding index is an O(1) map, not a search over tabs by URL/title/provider.

## 4. Process and target coverage

### 4.1 Electron census

Use `app.getAppMetrics()` for Browser/Tab/Utility/GPU/other Electron-associated processes. Keep the current 250 ms resource sampling only for CPU/memory because these are measurements, not lifecycle truth.

Use event-driven lifecycle for:

- `web-contents-created`;
- `child-process-gone`;
- `render-process-gone`;
- destroyed/unresponsive/responsive;
- navigation/loading/focus transitions.

Use `webContents.getAllWebContents()`, `getOSProcessId()` and `getOrCreateDevToolsTargetId()` to bind Electron objects to renderer/DevTools identity.

### 4.2 Chromium target graph

Use persistent CDP. Extend the existing pool with `Target.setDiscoverTargets` / `Target.setAutoAttach(autoAttach=true, flatten=true)` and recursive auto-attach where supported, so workers, service workers, frames and related targets are visible without attach-per-command.

Use `SystemInfo.getProcessInfo()` as an additional Chromium-wide process readback when available. It is observation only and does not replace Electron's canonical application process identity.

## 5. Local nervous system: one long-lived MessageChannel

The Shell/Brain UI should not receive a full snapshot for every event.

Create one `MessageChannelMain` per trusted Shell incarnation:

- main process owns one `MessagePortMain`;
- the other port is transferred through `webContents.postMessage()`;
- initial full snapshot establishes sequence/cursor;
- process/cognitive/command outcome deltas stream over the port;
- sequence gap requests a bounded full resync;
- port close invalidates only that UI stream; it does not affect Browser authority.

No second scheduler is introduced. The port carries observations, health and operator requests to the existing command boundary only.

## 6. WAN nervous system: wake is not authority

### 6.1 Normal path

Keep signed durable DB lease as the only effect authority.

Add a private Realtime topic scoped to the exact device/workspace for **command-ready wake hints**. The wake payload should contain only bounded identity such as workspace/device and queue generation; it must not carry executable command payload or capability material.

On wake:

1. signal the already-running lease loop;
2. immediately drain the canonical signed `/commands/wait-batch` endpoint;
3. execute only DB-leased commands;
4. post exact receipts/readback.

If Broadcast is lost, the held wait-batch request remains the liveness fallback. Therefore wake loss affects latency, not correctness.

### 6.2 Why Broadcast rather than Postgres Changes

Supabase recommends Broadcast for scalable/security-sensitive database change propagation. Realtime itself is a distributed Elixir/Phoenix WebSocket cluster. Current published benchmarks show very high message fan-out capacity, but WAN p50/p95/p99 are still non-zero. Therefore Browser autonomy must remain local-first and never block local coordination on a Realtime round-trip.

### 6.3 NOTIFY

PostgreSQL `LISTEN/NOTIFY` is useful inside server infrastructure as a wake primitive, but payloads are small and delivery is transaction-bound. In hosted Supabase the external client-facing wake should remain Realtime Broadcast; durable table/RPC state remains the source of truth.

## 7. Command scheduler: O(1) keyed causality

The current lane model is correct and should be preserved:

- `READ_ONLY`: wide concurrent fan-out;
- `TAB_MUTATION`: one causal stream per exact BrowserCell/tab key;
- `GLOBAL_MUTATION`: exclusive barrier;
- `EMERGENCY`: highest-priority barrier semantics.

The next scheduler implementation should replace repeated scans such as `pending.some(...)` with precomputed predecessor counts and ready queues:

- build causal dependency metadata once per batch, O(n);
- enqueue immediately-ready reads and per-key mutations;
- release successors by direct key lookup when predecessor completes;
- retain exact original order across global/emergency barriers;
- bounded concurrency is dynamically tuned, never unbounded.

Target at 32 physical tabs:

- up to 32 independent mutation keys;
- read-only concurrency 64–128 when resource pressure permits;
- same-tab mutation concurrency exactly 1;
- global mutation concurrency exactly 1;
- no read-only starvation behind unrelated tab mutations.

## 8. Adaptive backpressure

Static concurrency is not enough. Compute an observation-only pressure score from:

- Node event-loop utilization / event-loop delay;
- Electron per-process CPU and working set;
- renderer count and crash/unresponsive rate;
- CDP network inflight count;
- outstanding command count / lease age;
- Supabase request RTT / result ACK RTT;
- utility worker backlog.

Suggested policy bands:

- GREEN: read 128, mutation min(32, live exact cells);
- YELLOW: read 64, mutation min(16, live exact cells);
- ORANGE: read 32, mutation min(8, live exact cells);
- RED: read 8, mutation 1–4; preserve emergency/readback only.

Pressure changes scheduling capacity but never changes effect authorization.

## 9. Working memory

### 9.1 Hot memory

Keep hot working memory in bounded in-memory structures in the Browser main process:

- exact live binding per cell;
- latest semantic/process causal event;
- latest command/readback outcome;
- current task/claim/effect identity references;
- attention/degraded state;
- cognitive cursor and semantic revision.

Do not store raw DOM, full Network payloads, input values, prompt text or command payloads in this hot index.

### 9.2 Durable memory

Durable memory should contain compact facts/checkpoints, not the firehose:

- cognitive cursor/checkpoint;
- effect ledger identities and terminal outcomes;
- active task/claim/cell generation;
- compact per-cell state;
- provenance hashes;
- unresolved `AMBIGUOUS` items requiring reconciliation.

The new working-memory checkpoint is hash-verified. Persistence should run off the hot path. `node:sqlite` is attractive for later local fact indexes, but `DatabaseSync` is synchronous, so large or frequent writes must not run in the command/event hot path. First confirm the Node runtime bundled by Electron 44 before adopting it.

## 10. Autonomous continuity

Borrow the OTP `one_for_one` supervision principle at the BrowserCell level:

- renderer/worker failure degrades only its cell;
- a healthy human cell and unrelated workers remain live;
- restart/rebind produces a new binding generation;
- prior in-flight mutation cannot cross that generation fence;
- the brain reconciles durable task/effect state before any continuation.

Do not convert crash recovery into blind action retry.

## 11. Provider-neutral variation

Provider adapters should expose normalized semantic capabilities, not own scheduling:

- ChatGPT;
- Claude;
- Gemini;
- GLM/Z.ai;
- additional providers later.

Normalized capabilities can include:

- composer target;
- send/stop controls;
- generation state;
- conversation identity;
- file attachment availability;
- citations/tool-state markers;
- provider-specific limits.

The Browser Brain chooses among providers/cells based on task, health, latency, context fit and resource pressure. The common process plane, memory, command lanes, effect ledger and fleet remain provider-neutral.

## 12. Latency instrumentation

Record named point-in-time events rather than unstructured logs:

- `command.issued`;
- `command.wake_received`;
- `command.lease_started`;
- `command.lease_acquired`;
- `command.dispatch_started`;
- `command.physical_effect_returned`;
- `command.readback_completed`;
- `command.receipt_acked`;
- `cognitive.event_observed`;
- `cognitive.delta_acked`;
- `binding.invalidated` / `binding.rebound`.

Track p50/p95/p99 histograms per action/provider/cell without high-cardinality page data.

Initial engineering SLO targets after live measurement:

- local lifecycle event -> working memory: p95 < 10 ms;
- local exact binding lookup: p99 < 1 ms;
- already-leased local read-only dispatch admission: p95 < 5 ms;
- already-leased independent tab mutation admission: p95 < 10 ms excluding physical page work;
- DB issue -> Browser lease pickup within same region: target p95 < 250 ms after push wake, measured rather than assumed;
- cognitive event -> server ACK within same region: target p95 < 300 ms, with local autonomy independent of ACK;
- gap recovery: bounded full snapshot, never replay guessed state.

These are targets, not claims of measured production performance.

## 13. Transport evolution beyond WebSocket

QUIC/HTTP/3 and WebTransport have useful independent streams and low-latency properties. They are not justified as a replacement merely because they are newer. Supabase Realtime already provides managed WebSocket fan-out and the durable command path is HTTP/RPC. Evaluate QUIC/WebTransport only after instrumentation proves transport head-of-line or connection establishment is a material remaining bottleneck.

## 14. Implementation sequence

1. **Exact runtime binding + compact working memory** — current branch-local slice.
2. **Runtime wiring** — existing `BrowserRealtimeProcessPlane` feeds binding index/memory; mutation target lookup becomes exact and stale bindings fail closed.
3. **O(1) scheduler bookkeeping** — preserve lane semantics, remove repeated predecessor scans.
4. **Local MessagePort delta stream** — Shell/Brain becomes continuously attached without snapshot churn.
5. **Private command-ready Broadcast wake** — hint only, signed lease still authoritative.
6. **Adaptive backpressure** — event-loop/process/network-driven concurrency budget.
7. **Provider capability adapters** — variation without scheduler duplication.
8. **Durable compact memory writer** — checkpoint/fact persistence off hot path.
9. **Cell-level supervision** — one-for-one recovery with generation fences.
10. **Physical latency qualification** — instrumented Windows package + long-running soak + packet-loss/network-degrade tests.
11. Only after exact-head proof and a trusted actuation lease: additive production DDL/Edge capability and controlled cutover.

## 15. Non-negotiable invariants

- page/worker/model output has zero authority;
- one durable effect authority;
- wake/broadcast/delta transport has zero execution authority;
- no blind retry after ambiguous physical effect;
- exact target/incarnation/generation binding before mutation;
- same-cell causal order;
- unrelated cells may run in parallel;
- bounded queues and explicit gaps;
- no unbounded raw telemetry persistence;
- human Browser context remains isolated from autonomous fleet capacity;
- recovery can observe and reconcile but cannot silently widen authority.

## 16. Primary references

1. Electron `app.getAppMetrics()` — https://www.electronjs.org/docs/latest/api/app
2. Electron `ProcessMetric` (`pid + creationTime`) — https://www.electronjs.org/docs/latest/api/structures/process-metric
3. Electron `webContents` (`getAllWebContents`, `getOSProcessId`, DevTools TargetID) — https://www.electronjs.org/docs/latest/api/web-contents
4. Electron `Debugger` — https://www.electronjs.org/docs/latest/api/debugger
5. Electron `MessageChannelMain` — https://www.electronjs.org/docs/latest/api/message-channel-main/
6. Electron `MessagePortMain` — https://www.electronjs.org/docs/latest/api/message-port-main
7. Electron `utilityProcess` / transferable ports — https://www.electronjs.org/docs/latest/api/utility-process
8. Chrome DevTools Protocol Target domain — https://chromedevtools.github.io/devtools-protocol/tot/Target/
9. Chrome DevTools Protocol SystemInfo — https://chromedevtools.github.io/devtools-protocol/tot/SystemInfo/
10. Chrome DevTools Protocol Performance — https://chromedevtools.github.io/devtools-protocol/tot/Performance/
11. Chrome DevTools Protocol Accessibility — https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/
12. Chrome DevTools Protocol Network — https://chromedevtools.github.io/devtools-protocol/tot/Network/
13. Supabase Realtime Broadcast — https://supabase.com/docs/guides/realtime/broadcast
14. Supabase Realtime Protocol — https://supabase.com/docs/guides/realtime/protocol
15. Supabase Realtime Architecture — https://supabase.com/docs/guides/realtime/architecture
16. Supabase Realtime Benchmarks — https://supabase.com/docs/guides/realtime/benchmarks
17. Supabase Database Changes / Broadcast recommendation — https://supabase.com/docs/guides/realtime/subscribing-to-database-changes
18. Supabase Realtime Settings/private channels — https://supabase.com/docs/guides/realtime/settings
19. Node `perf_hooks` event-loop utilization/delay — https://nodejs.org/api/perf_hooks.html
20. Node `worker_threads` MessageChannel — https://nodejs.org/api/worker_threads.html
21. Node `diagnostics_channel` — https://nodejs.org/api/diagnostics_channel.html
22. Node AsyncLocalStorage — https://nodejs.org/api/async_context.html
23. Node `node:sqlite` — https://nodejs.org/api/sqlite.html
24. PostgreSQL `NOTIFY` — https://www.postgresql.org/docs/current/sql-notify.html
25. PostgreSQL `SELECT ... SKIP LOCKED` — https://www.postgresql.org/docs/current/sql-select.html
26. OpenTelemetry Events — https://opentelemetry.io/docs/specs/semconv/general/events/
27. OpenTelemetry Metrics Data Model — https://opentelemetry.io/docs/specs/otel/metrics/data-model/
28. OpenTelemetry Exception Logs — https://opentelemetry.io/docs/specs/semconv/exceptions/exceptions-logs/
29. Erlang/OTP supervision principles — https://www.erlang.org/doc/system/sup_princ.html
30. Ray actor concurrency groups — https://docs.ray.io/en/latest/ray-core/actors/concurrency_group_api.html
31. QUIC RFC 9000 — https://www.rfc-editor.org/rfc/rfc9000.html
32. HTTP/3 RFC 9114 — https://www.rfc-editor.org/rfc/rfc9114.html
