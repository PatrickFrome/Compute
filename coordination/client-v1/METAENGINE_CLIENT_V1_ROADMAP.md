# METAENGINE Client V1 — Convergence Roadmap

Status: **GOVERNANCE CHECKPOINT / RELEASE CONVERGENCE CONTRACT**  
Captured: **2026-09-29**  
Recovery baseline: **R109 @ ff95e9c886fac35b9302ec5c04a4c6bf7b8e8551**  
Reserved package identity: **0.7.0-dev.36516587173.1**

This roadmap does not mutate the frozen R109 release candidate. It is a durable governance checkpoint for converging METAENGINE into one stable product before new architecture generations are admitted.

## Product authority contract

Client V1 has exactly one owner for each critical domain:

- Agent lifecycle: **Native Browser Fleet**
- Orchestration: **Native Browser Supervisor**
- Task / lease authority: **DevOS**
- Browser physical effects: **Native Browser Control**
- Effect reconciliation: **Effect Journal + terminal AMBIGUOUS semantics**
- Recovery / privileged host path: **Guardian + Sentinel**
- Durable distributed coordination: **Supabase / Edge**
- Code, CI, immutable artifacts and releases: **GitHub**
- Update authority: **one Browser updater chain**
- Agent inference path: **real authenticated z.ai Agent Web UI surfaces**
- Runtime memory: **one primary Browser-owned memory plane**

No second scheduler, Browser effect plane, task DB, updater, model-API fallback, AgentChat authority, Mission Control scheduler, or hidden retry loop is allowed in the production Client V1 graph.

## Evidence model

Every stage follows:

`IMPLEMENT → VERIFY → RESEARCH → CHECKPOINT`

Evidence classes remain distinct:

- SOURCE
- STATIC
- SYNTHETIC
- PHYSICAL
- LIVE
- RELEASED

No weaker class may be silently promoted to a stronger one.

## C0 — STOP THE LINE / Truth Freeze

- Freeze R109 source baseline `ff95e9c8…`.
- No new RSI phases, Brain generations, schedulers, providers, UI sections, stores, queues, updater paths, or release mechanisms until C6.
- Classify every open client-relevant PR/branch as:
  - ACTIVE_CANONICAL
  - SELECTIVE_PORT
  - SUPERSEDED
  - REFERENCE_ONLY
  - OBSOLETE
- Maximum one authority-changing PR per domain.
- Client-core WIP target: <= 5 PRs.

**Exit:** one release candidate lineage and no competing task/effect/update/Agent-lifecycle authority.

## C1 — Canonical Product Authority

Create a machine-readable Product V1 authority manifest. Preserve the historical H205F22/Compute roadmap as infrastructure roadmap, but make Client V1 the release authority for the desktop product.

**Exit:** every production runtime module maps to one authority owner and one release lineage.

## C2 — Edge / Source Convergence

- Deploy a successor `a2-browser-native-supervisor-v14-canary` from exact R109 Edge source.
- Apply the exact Agent-origin receipt migration required by R109.
- Read back deployed source digest/version.
- Update R83 qualification evidence only after deployment.
- Re-run R83 without weakening the source-equivalence gate.

**Exit:** R83 green with exact source ↔ deployed Edge equivalence.

## C3 — Fresh Distributed Reconciliation

Read live DB/runtime state after database connectivity is available:

- roadmap authority
- tasks / claims / leases
- Browser / Supervisor heartbeat
- fleet generations / Agent bindings
- updater transaction state
- ambiguity / effect receipts
- Edge source identity

**Exit:** GitHub source, Edge contract, DB authority and installed runtime identity are reconciled or explicitly fenced/degraded.

## C4 — Positive User Goal Control Path

Primary renderer exposes only narrow typed intents:

- submitGoal
- pauseObjective
- resumeObjective
- approveAction
- intervene
- selectAgent

Path:

`UI intent → typed IPC → Native Supervisor → DevOS → exact Agent → readback → UI reconciliation`

No generic command authority in the renderer.

**Exit:** a user goal reaches canonical DevOS/Agent authority and returns durable readback.

## C5 — Golden-Path Real Agent + Useful Work E2E

Physical scenario on a dedicated authenticated z.ai test profile:

1. install exact candidate bytes
2. open visible Browser shell
3. prove authenticated z.ai Agent surface
4. submit real task
5. acquire DevOS lease
6. one-shot semantic dispatch
7. prove Agent-origin receipt
8. read actual result
9. perform a small real coding loop in a disposable repository:
   - researcher
   - implementer
   - intentionally failing test
   - repair
   - critic
   - verification
10. restart Browser and continue
11. repeat with two independent Agent sessions
12. inject ambiguity and prove no replay

**Exit:** one real user goal produces useful verified work and survives restart without manual repair.

## C6 — BUILD ONCE / Physical Release Qualification

After the last permitted byte change:

- freeze source SHA
- produce one installer
- record producer run + artifact ID + SHA-256
- test the exact same bytes:
  - clean install
  - dirty upgrade
  - singleton launch
  - crash recovery
  - network-loss continuation
  - Agent E2E
  - useful-work E2E
  - self-update
  - post-update continuation

**Invariant:** TESTED ARTIFACT == RELEASED ARTIFACT.

## C7 — Stable Baseline

Publish the first non-prerelease immutable Client V1 baseline with:

- exact source SHA
- exact Edge digest/version
- applied migration set
- producer run
- installer artifact ID
- installer SHA-256
- qualification evidence
- post-update Agent E2E evidence

## C8 — Repository Reset

Only after C7:

- close/supersede absorbed Rxx PRs
- archive historical release/work refs
- restore a protected product trunk
- target <= 10 open project PRs
- target <= 20 active development branches
- Branch TTL: 72h without fresh evidence → STALE/SUPERSEDED

Do not bulk-merge historical branches; use patch-equivalence + consumer census.

## C9 — Runtime Simplification

After stable baseline:

- replace local Next.js production server with bundled renderer
- remove ME2 compatibility probe
- remove ME2 daemon host
- remove UI gateway
- remove old socket transport
- remove retired AgentChat / Mission Control adapters
- remove duplicate task / memory APIs
- remove daemon source-sync product UI
- reduce pollers / ports / persisted state copies

**Exit:** Browser production no longer depends on localhost UI/probe services.

## C10 — Core Decomposition Without New Authority

Split `DevOsNativeTaskCycle` into bounded controllers while keeping:

- one task authority
- one effect authority
- one EffectJournal
- one identity model

Fast Control becomes a facade over canonical authority, never a second scheduler.

## C11 — Agent Robustness

- versioned AgentSurfaceAdapter
- SPA churn tests
- dirty composer recovery
- restart/reincarnation tests
- 100 consecutive real Agent tasks
- no manual repair
- no blind retry

BrowserCell classes:

- Authenticated Provider Cell
- Isolated Ephemeral Cell

## C12 — Learning Closure

Required benchmark:

`wrong decision → failure → lesson → retrieval → changed decision → improved outcome`

Until this passes, memory is observability/routing support, not proven self-improvement.

## C13 — Multi-Agent Development

Scale real agents only after C12:

- 2 → 4 → 8 active agents
- Researcher / Implementer / Critic / Falsifier
- isolated worktrees
- bounded physical concurrency
- one DevOS queue
- one authority graph

Swarm behavior belongs inside Native Fleet; it is not a separate platform.

## C14 — Scale / RSI / Compute Fabric

Only after stable Client V1:

- advanced RSI
- 128+ BrowserCell scale
- remote workers
- H205F22 Compute Fabric C1–C17
- GPU / REAPI / Ray
- Machine Economy

Scale must not change the Client V1 correctness model.

## Engineering invariants

1. One canonical product trunk.
2. <= 5 active client-core PRs.
3. One authority-changing PR per domain.
4. Branch TTL 72h without evidence.
5. No large opaque release PRs; use small semantic slices.
6. Every safety invariant requires a neighboring positive capability test.
7. Synthetic green never substitutes for physical product E2E.
8. Every new mechanism must replace an old mechanism or provide a unique capability.
9. Byte change after freeze => new SHA => full qualification again.
10. Runtime complexity is budgeted: processes, pollers, ports, authority paths and persisted state copies.
11. “Ready” requires one real goal → useful result → learning → restart → continuation.

## Current first blocker

At this checkpoint, R109 exact-head CI is green except **R83 Edge Canary Qualification**. The deployed v14 canary is pinned to older Edge source and must be converged to the R109 contract before release work proceeds.
