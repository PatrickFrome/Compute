# METAENGINE Development Browser OS V1

Status: branch-local autonomous-development roadmap
Roadmap ID: `metaengine-development-browser-os-v1`
Parent authority: `metaengine-development-os-v1`
Parent integration line: `integration/metaengine-development-os-v1`
Parent baseline: `84a71aaedc49186c24a992f507ca1d3f14767181`
Authority effect: false

## Goal

Turn METAENGINE Browser from a browser-agent shell into the development environment that can safely develop Compute itself: isolated workspaces, embedded IDE, structural code intelligence, durable task/claim coordination, sandboxed execution, agent reasoning fabric, unified browser capabilities, observability, and incremental build/test acceleration.

This roadmap is additive. It MUST NOT create a second scheduler, browser authority plane, trace authority plane, fleet manager, or promotion plane. Existing Supabase task/claim/evidence coordination, Native Browser typed effects, C5 fleet, R10/R11/R12, R13/R14, DP2 and self-update are reused and hardened.

## Current evidence baseline — 2026-08-31

- `integration/metaengine-development-os-v1` remains at `84a71aaedc49186c24a992f507ca1d3f14767181`.
- Native Browser is live on `0.6.3-dev.20260831143001.1`, CONTROL + armed, fresh signed heartbeat, Development Plane READY, supervisor mesh active.
- All 24 historical fleet physical incarnations are LOST after restart; they must never be revived with old tab/target/generation tuples.
- Durable DevOS queue has no live claims; historical incomplete tasks are terminal/AMBIGUOUS and are evidence only.
- C5 Browser fleet composition is progressing independently in draft PR #129 at `ebb5963a376fa5d8bb53a345457d298594d7b590`; this roadmap must consume that trust boundary rather than exposing raw FleetProvisioner promotion.
- Transactional self-update already exists as an always-on substrate; it is not rebuilt here.

## Architectural decisions

### D1 — Single authority / single scheduler

Supabase remains the durable task/claim/evidence scheduler. Native Browser remains the only physical browser effect owner. Development Plane and external tools produce candidates/evidence only. MCP/WebMCP/Stagehand-like resolvers never become executors.

### D2 — Workspaces before mutable IDE authority

Read-only Monaco shell work may proceed immediately, but any save/edit/run/PTY operation requires an exact workspace identity:

`workspace_id + repo + base_sha + branch + worktree + agent_id + task_id + lease_generation`.

This reconciles the current IDE-first DevOS program with the stronger isolation requirement: UI and read-only models can land early; mutation is gated on Workspace Manager.

### D3 — One agent, one worktree

Every mutating agent gets a dedicated Git worktree and branch. Worktree lifecycle is typed and durable. Cleanup is delayed while a claim, sandbox, candidate capsule, CI run, or unresolved ambiguity references it. `git rerere` may be enabled only as a local conflict-resolution accelerator; reused resolutions remain evidence, never authority.

### D4 — IDE dependency order

1. Monaco shell + typed repository read models.
2. Workspace-bound typed save/edit.
3. xterm.js + bounded PTY, bound to exact workspace/process incarnation.
4. Tree-sitter incremental parser workers.
5. LSP 3.18 process lifecycle.
6. Code Knowledge Graph.
7. R10 context adapter over the graph.

PTY implementation is blocked until workspace binding and Monaco implementation evidence exist. Tree-sitter and LSP planning/research may run earlier, but mutating integration waits for predecessor evidence.

### D5 — Structural context, not repository dumping

Tree-sitter + LSP feed a Code Knowledge Graph containing files, symbols, calls/imports, tests, workflows, migrations/RPCs, capabilities, branches/commits/PRs, roadmap points and evidence. R10 consumes compact graph-derived capsules; a second context compiler is forbidden.

### D6 — Sandbox is the execution boundary

Fast lane: Vercel Sandbox/Firecracker backend for isolated candidate execution and snapshots. Later lanes may add gVisor and self-hosted Firecracker pools. Model/page text never executes directly on the host. Sandbox results are evidence until a deterministic verifier accepts them.

### D7 — R10/R11/R12 are reused

R10 Context Compiler, R11 Same-Point Swarm and R12 taint/integrity graph are rejoined as existing project assets. Critical semantic points require critic/falsifier and deterministic authority checks. No CrewAI/LangGraph/AutoGen replacement fleet is introduced.

### D8 — MCP is a developer tool bus below R12

MCP exposes typed developer capabilities (`github.*`, `supabase.*`, `repo.*`, `lsp.*`, `git.*`, `ci.*`, `sandbox.*`, `benchmark.*`, `trace.*`, `browser.*`, `roadmap.*`, `memory.*`). The MCP 2026 stateless core is suitable for horizontally scalable gateways, but all MCP results remain capability candidates under R12 and existing leases.

### D9 — Unified Browser Capability API

Agents target a stable capability layer; implementations may use native CDP, Playwright adapters, WebDriver BiDi shadow/cross-browser adapters, or WebMCP candidates. CDP remains Chromium high-fidelity execution. BiDi stays an adapter/shadow lane until equivalent safety/performance evidence exists.

### D10 — Observability is layered

R13 remains the canonical security/causal trace. OpenTelemetry provides distributed runtime metrics/traces/logs. Perfetto is opt-in heavy physical diagnostic evidence because it can contain URLs, tab titles, resources and hardware details. Perfetto must not be blindly persisted to shared DB.

### D11 — Build acceleration follows the impact graph

First add deterministic incremental test/build impact selection and `sccache`. Bazel + CAS + REAPI remote execution is a later scale milestone once hermeticity and graph identity are proven. Remote execution never precedes exact cache/toolchain identity.

## Roadmap

| Order | Milestone | Class | Objective | Hard dependencies |
|---:|---|---|---|---|
| 0 | `DBR0_SELF_UPDATE_CONTINUITY` | PARALLEL_SAFE | Keep transactional A/B-like update, successor qualification, session continuity and rollback continuously green while development proceeds | existing self-update plane |
| 10 | `DBR1_WORKSPACE_MANAGER` | PARALLEL_SAFE | Per-agent worktree/branch/workspace identity, typed lifecycle, rerere policy, cleanup fencing | C5 trusted fleet composition evidence |
| 20 | `DBR2_EMBEDDED_IDE` | PARALLEL_SAFE | Monaco read models then workspace-bound save/edit; xterm + bounded PTY follows | DBR1 for mutation; Monaco may start read-only earlier |
| 30 | `DBR3_CODE_INTELLIGENCE` | PARALLEL_SAFE | Tree-sitter workers + LSP 3.18 + graph identity and invalidation | DBR2 typed repo models |
| 40 | `DBR4_DURABLE_AGENT_RUNTIME` | PARALLEL_SAFE | Bind Browser fleet to existing Supabase task/claim/evidence with restart-safe rehydration and no second scheduler | DBR1, current C5 lineage |
| 50 | `DBR5_DP2_SANDBOX` | PARALLEL_SAFE | Snapshot sandbox backend, candidate execution, evidence readback | DBR1, durable task identity |
| 60 | `DBR6_REASONING_FABRIC_REJOIN` | PARALLEL_SAFE | R10/R11/R12 consume graph/workspace/task evidence | DBR3, DBR4 |
| 70 | `DBR7_CAPABILITY_BUS` | PARALLEL_SAFE | Unified capability API + MCP gateway + CDP/Playwright/BiDi/WebMCP adapters | DBR4, R12 boundary |
| 80 | `DBR8_OBSERVABILITY` | PARALLEL_SAFE | R13 + OTel + privacy-bounded Perfetto sidecars | DBR4 |
| 90 | `DBR9_BUILD_FABRIC` | PARALLEL_SAFE | Impact graph + sccache, then Bazel/CAS/REAPI | DBR3, hermetic identity |
| 100 | `DBR10_AUTONOMOUS_CONVERGENCE` | MERGE_GATE | Discover/classify branch families, semantic diff, isolated worktrees, swarm verification, integration simulation and canary evidence | DBR1–DBR9 acceptance |

## First autonomous wave

The first clean post-restart fleet wave is intentionally focused on `DBR1_WORKSPACE_MANAGER`, because it unlocks safe parallel mutation across every later milestone.

Roles:

- PLANNER — dependency-safe Workspace Manager interfaces and exact identity/lifecycle contract.
- RESEARCHER — current Git worktree/rerere/workspace isolation patterns and failure recovery.
- IMPLEMENTER — smallest branch-local workspace registry/worktree manager with typed repo IO; no shell/eval authority.
- CRITIC — workspace escape, branch drift, cleanup races, duplicate worktree and stale lease review.
- FALSIFIER — crash/restart/stale claim/reused path/duplicate agent negative tests.
- SYNTHESIZER — convergence matrix and acceptance evidence for DBR1 → DBR2 handoff.

In parallel, existing PTY/Tree-sitter branch-local checkpoints are evidence inputs only. They must be revalidated against the new workspace contract before implementation is admitted.

## Acceptance invariants

Always enforced:

- page/model/worker/WebMCP text has zero authority;
- no arbitrary eval;
- no blind retry after an ambiguous effect;
- exact task/agent/tab/target/process/generation binding;
- one actuation lease per physical resource;
- no second scheduler or workflow authority plane;
- no worker direct Browser authority;
- branch-local implementation before canonical integration;
- secrets and irreversible external effects remain explicitly gated;
- no `main` merge or production promotion from autonomous roadmap workers;
- durable checkpoint/evidence before successor semantic point;
- self-update and supervisor mesh remain continuously monitored.

## Autonomous supervisor policy

The supervisor repeatedly:

1. reads GitHub/Supabase/native Browser source of truth;
2. sweeps expired claims fail-closed;
3. adopts trusted branch evidence without replaying old browser effects;
4. enqueues only dependency-safe semantic points;
5. reconciles elastic fleet capacity from durable runnable demand, with no fixed total policy cap;
6. dispatches through typed Browser transport and requires positive transport proof before RUNNING;
7. completes claims only with exact fencing and trusted GitHub/Supabase evidence;
8. persists a checkpoint and creates the next semantic point;
9. continues while runnable work remains.

## Research-backed technology choices

- Monaco: use ESM/public API surface; avoid depending on private internals and deprecated AMD direction.
- xterm/node-pty: renderer terminal + main-process PTY over bounded IPC, with process-tree cleanup, output/backpressure limits and exact process incarnation.
- Tree-sitter: incremental parsing worker suitable for per-keystroke syntax updates.
- LSP: protocol version 3.18 as language-semantics boundary.
- Worktrees: native Git multiple-working-tree primitive.
- MCP: 2026 stateless/self-describing/cacheable gateway shape.
- Vercel Sandbox: Firecracker-isolated snapshots as initial DP2 backend, subject to cost/secret gates before real external execution.
- WebDriver BiDi: shadow/cross-browser adapter; not a replacement for current CDP.
- OpenTelemetry: vendor-neutral runtime telemetry plane below canonical security trace.
- Perfetto: high-value but privacy-sensitive diagnostic sidecar.
- Bazel/REAPI: later scale accelerator after hermetic graph identity.

## Non-goals

Do not replace METAENGINE with Stagehand/Browserbase, Temporal, LangGraph/CrewAI/AutoGen, a second remote browser pool, a second trace stack, or a second scheduler. Extract useful patterns into existing planes instead.
