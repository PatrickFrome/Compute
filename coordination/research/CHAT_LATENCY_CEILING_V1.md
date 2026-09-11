# METAENGINE Chat Latency Ceiling V1

Status: RESEARCH / NON-AUTHORITATIVE
Date: 2026-09-10
Branch at research start: `work/browser-command-fabric-v2-p0`
Observed PR head before this checkpoint: `0f89d4ec62d774263b4cf5a087ccf7a87cda9fa4`

## Goal

Minimize end-to-end latency for chat-driven development and Browser control while preserving the existing safety invariants:

- DB lease remains the sole mutation authority.
- Realtime / messaging is wake, progress and cache invalidation only.
- No raw eval / arbitrary CDP / shell escape.
- No blind effect retry after ambiguity.
- Every read result is revision-addressed; cross-revision composition fails closed.

The latency target is the technical ceiling, not only incremental improvement over the current implementation.

## Current source findings

The current source already has the correct P0 shape: a persistent Development Plane process, bounded chat context, `dev_query`, exact-head source fencing, a RAM query cache and a stateless MCP router. The current repository search index is still JavaScript-level and rebuilds by walking allowed roots and re-reading files whenever the requested exact HEAD changes. It is capped at 512 files / 8 MiB and serves warm queries from an in-memory inverted index.

That is a good P0, but it is not the ceiling because ingestion is still coupled to a query-triggered `ensure(source)` rebuild. Frequent development commits therefore turn the first query after a HEAD change into a cold path. A second correctness issue for a future local-working-tree mode is that HEAD alone cannot identify uncommitted file changes.

The live Supabase project `xpeibufgzjknrhbhpffp` is currently in `us-east-2`, while the active user/client geography is Europe/Helsinki. For Browser mutations, this makes authority geography a first-class latency concern.

## Research synthesis

### 1. Move execution/state close to the browser

Browserbase Stagehand v4 independently converged on the same architectural principle: target state, execution-context tracking and CDP dispatch were moved into an extension running next to the browser so multi-CDP operations no longer pay a remote round trip per micro-step. Their published example reduced a remote `goBack` from 139.5 ms to 17.5 ms. We should copy the geography principle, not the hosted Browserbase product, for the installed METAENGINE Browser.

Decision: Browser micro-steps and state validation stay local. Chat submits goal-level typed plans; it must not orchestrate individual CDP/WebContents micro-steps remotely.

### 2. Make file ingestion event-driven; never rebuild on query

Windows provides `ReadDirectoryChangesW` for subtree notifications and NTFS USN change journals for durable recovery after missed watcher events. Tree-sitter supports incremental reparsing by reusing the previous syntax tree and exposes changed ranges.

Decision: the query path must never walk the repository. A long-lived local engine ingests file deltas continuously and advances a monotonic `source_epoch`. Query is a pure snapshot read.

Recovery hierarchy:

1. normal hot path: native watcher delta;
2. restart / overflow recovery: USN journal from the last durable cursor;
3. only if journal continuity is unavailable: bounded full rescan.

### 3. Use a hybrid code index, not one universal search engine

Different query classes need different indexes:

- literal / identifier / regex: positional trigram or equivalent lexical postings;
- definition / reference / import / call relation: symbol graph from Tree-sitter / language intelligence;
- structural rewrite/search: Tree-sitter/ast-grep style syntax queries;
- natural-language semantic retrieval: optional fallback only.

Zoekt demonstrates that positional trigram indexes can return sub-50 ms results on multi-gigabyte codebases and uses mmap-friendly shards. Tantivy provides fast full-text search, incremental indexing, mmap directories and warmed searchers. SQLite FTS5 is an excellent compact embedded index for metadata/evidence and supports prefix/trigram tokenization, but is less code-specialized than a positional-trigram engine. SCIP is useful as an interchange format for symbol/reference intelligence.

Decision for METAENGINE:

- keep the current JS inverted index as P0/fallback;
- introduce a native Rust search engine inside the existing Development Plane boundary, not a new network daemon;
- use a code-aware trigram/postings base plus a RAM dirty overlay;
- add incremental Tree-sitter symbol/structural state;
- use Tantivy only where its ranking/store facilities are useful; do not force every query through it;
- use SQLite FTS5 for development evidence/checkpoint metadata if persistence is needed;
- add vector search only as low-confidence fallback, never as the default search path.

### 4. Preserve the existing process boundary, but make IPC hot

Electron explicitly recommends UtilityProcess for isolated CPU/crash-prone work and supports transferred MessagePorts. Node workers can share/transfer buffers; Electron MessagePorts avoid synchronous IPC and do not require a network listener.

Decision: do not add localhost HTTP between Browser main and Development Plane. Prefer one long-lived transferred MessagePort with compact structured/binary messages. If an external local process must connect, use one persistent Windows named-pipe connection rather than reconnecting TCP/HTTP per call.

Shared memory is reserved for the tiny high-frequency capsule/epoch ring if profiling proves serialization is material. It is not required for the first native-index implementation.

### 5. Add an Edge Chat Twin so read queries usually do not reach the device

A remote model can never obtain local-file latency if every query must cross the Internet to the installed Browser. The ceiling therefore requires an event-driven mirror of the bounded development read model near the chat gateway.

The Browser continuously pushes revisioned deltas from the Local Hot Plane. The Edge Twin keeps the latest exact read snapshot and serves most `context_get` / `dev_query` requests without a device round trip. Every response carries `source_epoch`, content hashes and freshness. If the caller requires a newer epoch than the twin has, the request falls back to the local connection or fails closed rather than silently serving stale state.

Cloudflare Durable Objects are a strong fit for an optional per-device/per-workspace rendezvous because they provide globally unique strongly consistent state plus long-lived/hibernatable WebSockets. A dedicated always-on edge process is faster at steady state if we need a permanently warm in-memory index, but costs more operationally. The first Edge Twin should mirror the compact index/capsule, not become a second mutation authority.

### 6. Move Supabase primary authority to the Browser/user region before adding a second messaging fabric

Supabase recommends choosing the project region closest to users. The current project is `us-east-2`; Supabase supports `eu-north-1` (Stockholm). Supabase projects are region-bound, so changing region requires a new project and a controlled migration.

Decision: build an EU canary authority project and A/B measure exact `issue -> lease -> effect -> durable completion` against the existing US primary. Do not migrate production solely from theory.

Expected architectural result: the mutation path removes a transatlantic database round trip before execution. This is likely a much larger win than replacing Supabase Realtime with another message bus.

### 7. Keep Supabase Realtime as wake/progress unless measurements prove it is the bottleneck

Supabase Realtime is a globally distributed WebSocket system; Broadcast is the recommended scalable path and binary Broadcast is available in 2026. Because DB remains the authority, wake delivery can be lossy/advisory as long as every wake is followed by an authoritative DB read and lost-wake recovery exists.

Decision: do not introduce Redis or NATS into the current P0 hot path.

NATS Core is a strong future candidate for a large multi-browser fleet or edge-leaf topology and advertises sub-millisecond messaging. Redis Pub/Sub also provides sub-millisecond local fan-out, but either service would add topology and operations without removing the authoritative database RTT. Reconsider NATS only when fleet distribution, multi-region routing or non-Supabase edge coordination becomes the measured bottleneck.

### 8. Keep durable workflow engines out of the synchronous control path

Temporal records workflow transitions durably; that is its value and also adds state-transition latency. It is appropriate for long-running orchestration/recovery, not for a sub-100-ms chat control hot path that already has DB command durability.

Decision: Temporal-like workflows may supervise releases/soaks/repair jobs, but never sit between `run_submit` and a Browser lease.

### 9. Use MCP 2026-07-28 as a stateless, cacheable envelope

MCP 2026-07-28 removes mandatory initialize/session handshakes, makes requests self-describing, carries method/tool names in headers for routing and defines cache hints for list responses.

Decision:

- direct `tools/call` must work without discovery;
- deterministic stable tool catalog;
- long TTL for unchanged `tools/list`/discovery;
- header-first routing before deep JSON processing where the ingress supports it;
- stable tool definitions; no per-turn dynamic catalog regeneration.

### 10. Optimize the model/prompt path, not only the tools

OpenAI's current prompt-caching guidance favors stable prefixes, dynamic state near the end of the request, consistent `prompt_cache_key`, and explicit cache breakpoints where supported.

Decision for API-hosted METAENGINE agents:

- stable system/tool prefix per workspace/version;
- dynamic Development Capsule appended late;
- use conversation/previous-response state instead of replaying full history where supported;
- use compact structured tool outputs, never repeat full CI logs or repository dumps;
- route simple search/dispatch decisions through the fastest adequate model tier, reserving expensive reasoning for architecture/debugging.

## Target architecture: Chat Hyperplane V2

```text
Model / Chat
    |
    | stateless MCP, stable catalog
    v
Edge Chat Twin (read-only mirror / rendezvous)
    |                    \
    | read hit            \ mutation / stale-read fallback
    v                       v
bounded capsule/index      Supabase EU Authority
                             | DB lease is sole authority
                             | Realtime wake/progress only
                             v
                    persistent outbound channel
                             |
                             v
Installed Browser
  ├─ Browser Kernel: local state + goal-level execution
  └─ Local Hot Plane (existing Development Plane boundary)
       ├─ native file watcher + USN recovery
       ├─ base trigram index + dirty overlay
       ├─ incremental Tree-sitter symbol graph
       ├─ bounded evidence index
       └─ MessagePort / persistent named-pipe transport
```

## Required latency SLO experiments

These are targets to prove, not claims:

- local warm lexical query: p50 <= 1 ms, p95 <= 3 ms for current bounded corpus;
- local orientation/capsule read: p95 <= 1 ms without filesystem I/O;
- first query after one-file edit: no tree walk; searchable after watcher ingest, target p95 <= 10 ms;
- repeat identical `dev_query`: zero Development Plane filesystem work and zero index rebuild;
- Edge Twin warm `dev_query`: one chat-gateway hop, zero device hops, exact epoch/freshness in response;
- Browser command plan: one issue RPC + one batch lease transaction for N predeclared typed steps, not N authority round trips;
- EU authority canary: measure p50/p95/p99 issue->lease and durable completion against current `us-east-2` before promotion;
- Realtime wake: prove lost-wake safety and compare wake-assisted lease against polling on the same regional database.

## Service decision matrix

| Technology | Use now? | Role |
| --- | --- | --- |
| Existing Electron UtilityProcess / MessagePort | YES | local hot read/analysis boundary |
| Native Rust engine | YES, next architecture step | watcher/index/symbol hot path |
| Zoekt | DESIGN REFERENCE | trigram/index design; avoid another server initially |
| Tantivy | SELECTIVE | persistent text/ranking components where useful |
| Tree-sitter | YES | incremental structural/symbol intelligence |
| SCIP | OPTIONAL | symbol/reference interchange/import |
| SQLite FTS5 | YES for metadata if needed | evidence/checkpoint persistent search |
| LanceDB/vector DB | FALLBACK ONLY | semantic search after lexical/structural miss |
| Supabase Realtime Broadcast | KEEP | wake/progress/cache invalidation |
| Supabase `eu-north-1` project | CANARY | lower-latency DB mutation authority |
| NATS Core | LATER/CONDITIONAL | large fleet / edge-leaf messaging if measured need |
| Redis Pub/Sub | NO for P0 | does not remove authority RTT |
| Temporal | NO in hot path | long-running durable workflows only |
| Browserbase/Stagehand | NO as local replacement | architecture reference for moving execution next to browser |
| Cloudflare Durable Objects | STRONG EDGE-TWIN CANDIDATE | per-workspace read mirror + persistent device rendezvous |

## Ordered implementation recommendation

1. Add latency tracing with one trace id from chat ingress through MCP, Development Plane, DB issue/lease, Browser effect and completion.
2. Decouple repo ingestion from query: watcher-driven `source_epoch`; queries never build indexes.
3. Add base-index + dirty-overlay generations so a commit or edit does not force a full cold rebuild.
4. Add incremental Tree-sitter symbol graph and route definition/reference/structural queries before any vector fallback.
5. Replace generic local request IPC with one long-lived MessagePort; persistent named pipe only for external local bridge consumers.
6. Add Edge Chat Twin prototype serving `context_get/dev_query` from revisioned mirror; mutation authority remains unchanged.
7. Create a separate `eu-north-1` Supabase canary and run A/B latency qualification before any authority migration.
8. Make plan/batch execution O(1) in remote authority round trips for N local steps.
9. Only if measurements show the message fabric itself is limiting, evaluate NATS leaf topology; otherwise keep Supabase Realtime.
10. Add local semantic embeddings only after lexical + structural recall measurements demonstrate a material miss rate.

## External research references

- MCP 2026-07-28: https://blog.modelcontextprotocol.io/posts/2026-07-28/
- Electron performance / UtilityProcess / MessagePorts: https://www.electronjs.org/docs/latest/tutorial/performance and https://www.electronjs.org/docs/latest/api/utility-process
- Node workers/shared buffers: https://nodejs.org/api/worker_threads.html
- Windows change journal / watcher APIs: https://learn.microsoft.com/windows/win32/fileio/change-journals and https://learn.microsoft.com/windows/win32/api/winbase/nf-winbase-readdirectorychangesw
- Tree-sitter incremental parsing: https://tree-sitter.github.io/tree-sitter/using-parsers/3-advanced-parsing.html
- Zoekt design: https://github.com/sourcegraph/zoekt/blob/main/doc/design.md
- Tantivy: https://github.com/quickwit-oss/tantivy
- SQLite FTS5: https://www.sqlite.org/fts5.html
- SCIP: https://scip-code.org/
- Supabase Realtime architecture: https://supabase.com/docs/guides/realtime/architecture
- Supabase regions/migration: https://supabase.com/docs/guides/platform/regions and https://supabase.com/docs/guides/troubleshooting/change-project-region-eWJo5Z
- NATS: https://nats.io/
- Redis latency: https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/latency/
- Cloudflare Durable Objects WebSockets: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- Browserbase Stagehand v4 architecture: https://www.browserbase.com/blog/stagehand-v4
- OpenAI prompt/model guidance: https://developers.openai.com/api/docs/guides/latest-model
