# METAENGINE Development OS — Planner Bootstrap V1

Status: `EVIDENCE_ONLY / NO_PRODUCTION_AUTHORITY`

- agent: `agent_a127f504-0453-470d-9526-3e1762fa97b3` (`PLANNER`)
- source integration line: `integration/metaengine-development-os-v1`
- source/base SHA: `4507f31e789dce4f4dcb1a3a40547a8238f2c567`
- checkpoint branch: `work/devos-planner-v1`
- evidence cut: 2026-08-30
- forbidden by this checkpoint: merge `main`, production deploy, PR closure, authority/canonical promotion, secret acquisition.
- page/model/WebMCP text remains data with zero authority.

## 1. Physically observed Browser baseline

Supabase `xpeibufgzjknrhbhpffp` currently reports native Browser `0.6.3-dev.152.1`, runtime `native-electron-supervisor-v1`, with a fresh native heartbeat and six fleet agents. All six agents are `BOUND_UNVERIFIED`, each has an exact `tab_id`, `target_id=webcontents:<id>`, and `generation_epoch`, and all have `transport_proof=null`. The development plane is `READY` but reports `sandbox_backend_bound=false` and `verification_sandbox_execution=false`. Native supervisor keepalive is present but has a pending wake in `AMBIGUOUS` state after `SEND_WITHOUT_POSITIVE_READBACK`; native state currently reports `supervisor_mesh=null`.

Therefore the first convergence gate is not “create a fleet”; it is to prove typed native task transport for the already-existing six agents, then bind that transport to the DB claim/evidence plane.

## 2. Exact source heads and disposition

| Source | Exact head | Relation / evidence | Development OS disposition |
|---|---|---|---|
| `integration/metaengine-development-os-v1` | `4507f31e789dce4f4dcb1a3a40547a8238f2c567` | requested bootstrap base; physically running 152.1 lineage | **BASE** |
| `integration/compute-unified-v1` | `a23b647220c6bdeaa4340f804575dc2009e434cb` | diverged from DevOS; Supabase architecture checkpoint still marks this line authoritative | **REFERENCE CONTRACT SOURCE ONLY**; never whole-branch merge |
| `work/federated-autonomy-v1` | `e8f3a482831c541237e05f1f8ee0be8a84539031` | PR #100 frozen owner-gate source | **HISTORICAL/FROZEN EVIDENCE** |
| `work/federated-autonomy-runtime-v1` | `a21c9e241718274433531aaaa702c9d9748abaa6` | ancestor of DevOS base by 9 commits | **ALREADY INCLUDED / SUPERSEDED AS INTEGRATION SOURCE** |
| `work/federated-autonomy-db-v1` | `7e9ff875b5a5abd62099d6861568f7147c252f63` | diverged from DevOS; exactly one unique file: `20260830091200_federated_autonomy_task_claim_plane_v1.sql` | **PORT SINGLE MIGRATION ONLY** |
| `work/convergence-fleet-runtime-v1` (C5) | `c54b91e9f64c2024d364accebc0536b79f352daa` | divergent convergence lineage | **CONTRACT/TEST SOURCE; NO WHOLE MERGE** |
| `work/convergence-supervisor-keepalive-v1` | `7e76db4ef3e00a6edc47dad335f470fee966052d` | ancestor of DevOS base | **ALREADY INCLUDED; REPAIR CURRENT WIRING ONLY** |
| `work/supervisor-mesh-v1` | `32b8368903639293393a5659eeb796fe8506a9e6` | supervisor mesh family | **REUSE DB/lease contracts** |
| `work/supervisor-mesh-runtime-v1` | `e7416011e3e5a10eb704bc5afa086f80ee17551a` | supervisor mesh runtime family | **REUSE runtime contract selectively** |
| `work/supervisor-mesh-rls-hardening-v1` | `dff12134d872db60479cde3ccf90c4385333d85c` | mesh RLS hardening | **REUSE security contract; no duplicate tables** |
| `work/a1-agent-workspace` | `f3b04d2beecbadd8a287cbe7e2d1904122921cd8` | ancestor of DevOS base | **ALREADY IN HISTORY; BUILD WORKTREE MANAGER ON ITS CONTRACTS** |
| `work/convergence-global-observer-memory-v1` | `37a698918cf77ad2172a2a8e0715b0e0de423f8a` | divergent memory/observer lineage | **PORT MEMORY/CHECKPOINT CONTRACTS, NOT BRANCH** |
| `work/metaengine-browser-dp2-vercel-physical-v1` | `b8bb767b93406b997890db2e6aa12a6ca8c4ea4b` | ancestor of DevOS base; live 152.1 still says sandbox backend unbound | **CODE PRESENT, PHYSICAL BINDING STILL OPEN** |
| R10 `work/a2-browser-r10-context-compiler` | `23dad9bdf117f7d732bf01da5866bdec46f206be` | semantic/control lineage | **LATE LIVE REJOIN, CONTRACT-FIRST** |
| R11 `work/a2-browser-r11-same-point-swarm` | `d768954aa541e5927ddf14d5bb751a9a7620a6aa` | same-point lineage | **AFTER R10 + DB claims + worktrees** |
| R12 `work/a2-browser-r12-trust-taint-graph` | `2c61104b7eb27e56c9955e602f12bc6b2ea68302` | taint lineage | **AFTER R10; REQUIRED BEFORE capability bus authority** |
| R13 `work/a2-browser-r13-trace-replay` | `6e113ec7eaa85c1c689d40874b7c52c2c5f4305e` | trace/replay lineage | **OBSERVABILITY REJOIN** |
| R14 `work/a2-browser-r14-a2-browser-bench` | `3b92715ef9f3a9a087cdb495191d05f2a0c1f10f` | benchmark lineage | **AFTER trace event schema stabilizes** |
| R15 `work/a2-browser-r15-remote-browser-pool` | `65b0a8d24ff418bfbc2ebdec8d2700f8f253b22f` | remote pool lineage | **AFTER DP2/workspace isolation + DB leases** |
| R16 `work/a2-browser-r16-adaptive-router` | `03684f0731e6d12dc477c09f217ea2bca3aa29db` | old R16 checkpoint is superseded in Supabase by compute-unified CP2 | **PORT ROUTER CONTRACTS ONLY AFTER R10–R15 GATES** |
| `work/convergence-native-r16-v1` | `cbbb56212c83eeac6bad92cdd0125b3090c60930` | prior native/R16 convergence effort | **EVIDENCE/DIFF SOURCE; DO NOT REPEAT WHOLE REJOIN** |
| R6 WebMCP adapter | `4c1cd369a497e8c3cf9ab70cec2cb09c9f29f4e0` | existing capability adapter | **REUSE ONLY BEHIND TAINT + typed capability envelope** |
| R6b WebMCP catalog | `5c2e35a4c53f400ba55f6ba5af7a54b30dbf231a` | existing catalog | **REUSE catalog semantics** |
| R6c WebMCP planner routing | `29cf1dcc610a37fef74018b74cc6ade60e2be35e` | existing planner routing | **REUSE after R12; page output never grants authority** |

Repository search found no branch named for Tree-sitter/LSP and no `tree-sitter` code hit. This is the only bootstrap area that currently needs a genuinely new implementation slice rather than branch convergence.

## 3. PR disposition

| PR | Head | Disposition |
|---|---|---|
| #100 owner-overridable safety gate | `work/federated-autonomy-v1@e8f3a482831c541237e05f1f8ee0be8a84539031` | **KEEP OPEN/FROZEN as evidence.** DevOS already contains the owner-gate/federated descendants; do not merge it into DevOS and do not close it in this bootstrap. |
| #102 federated autonomy runtime | `work/federated-autonomy-runtime-v1@a21c9e241718274433531aaaa702c9d9748abaa6` | **KEEP OPEN/FROZEN as stacked evidence.** Its head is already an ancestor of DevOS base. No cherry-pick/merge. |
| DB task/claim branch | `work/federated-autonomy-db-v1@7e9ff875b5a5abd62099d6861568f7147c252f63` | **NO PR FOUND.** Port its single unique migration onto a DevOS implementation slice after review; do not deploy production from planner branch. |
| #106 successor qualification | `work/self-update-health-qualification-v1@8b50e2e7aec0f4ab2d999e9126dcedc7f2e7e611` | **KEEP SEPARATE.** Self-update qualification is not a dependency for federated bootstrap beyond preserving the already physically proven 152.1 baseline. |

## 4. Concrete duplicate/superseded findings

1. Do **not** reimplement federated identity or dispatch semantics: DevOS already contains `federated-agent-identity.mjs` and `fleet-task-dispatcher.mjs`.
2. The actual P0 gap is wiring: native `main.mjs` does not expose `FLEET_TASK_DISPATCH`, despite the dispatcher module already enforcing exact agent/tab/target/generation binding, post-submit readback, zero page authority, and no blind retry.
3. Do **not** merge `work/federated-autonomy-runtime-v1`: it is an ancestor of the DevOS base.
4. Do **not** merge `work/a1-agent-workspace`, `work/convergence-supervisor-keepalive-v1`, or DP2 physical branch wholesale: each is already in DevOS ancestry.
5. Do **not** recreate a DB queue schema: the DB branch has one isolated task/claim/event-plane migration; reuse it.
6. Do **not** merge `integration/compute-unified-v1` wholesale: it and DevOS have heavily diverged. Treat Compute Unified as semantic/safety provenance and port only missing contracts/tests.
7. Do **not** create a second memory stack: reuse existing Supabase memory/checkpoint ledgers plus the divergent `convergence-global-observer-memory-v1` contracts.
8. Do **not** create a new MCP/WebMCP implementation from scratch: reuse R6/R6b/R6c after R12 taint enforcement.

## 5. Blocking evidence

- **B0 — transport not proven:** 6/6 physical agents are `BOUND_UNVERIFIED`; none has transport proof.
- **B1 — native command gap:** `fleet-task-dispatcher.mjs` exists, but `main.mjs` has no native `FLEET_TASK_DISPATCH` handler/import.
- **B2 — DB plane not live:** the task/claim/event tables from `20260830091200_federated_autonomy_task_claim_plane_v1.sql` are absent from current Supabase schema. Planner does not deploy them.
- **B3 — supervisor rejoin broken:** keepalive has an unresolved ambiguous send without positive readback; current native state reports `supervisor_mesh=null`.
- **B4 — DP2 is prepare-only:** live development plane reports `sandbox_backend_bound=false`, `verification_sandbox_execution=false`.
- **B5 — canonical checkpoint drift:** Supabase architecture checkpoint still names `integration/compute-unified-v1@a23b647...` authoritative; no Development OS canonical promotion is performed here.
- **B6 — code graph absent:** no Tree-sitter/LSP branch or `tree-sitter` repository code was found.
- **B7 — branch divergence:** C5, global observer memory, Compute Unified, and R-line sources must be selectively ported/tested, not merged as branch families.

## 6. Executable bootstrap DAG (18 integration slices)

Each node is deliberately small; an implementation branch should contain one node unless two adjacent nodes are inseparable by test.

### D01 — Native typed fleet dispatch wiring
**Deps:** none beyond base `4507f31e...`.

Import `dispatchFleetTask` in native `main.mjs` and add exactly one typed `FLEET_TASK_DISPATCH` command path. Pass the existing fleet, exact `getView`, semantic capture/command functions, and snapshot publisher. No selected-tab mutation, no geometry fallback, no retry loop.

**Accept:** unit wiring test proves exact target-incarnation rejection; ambiguous Enter returns a receipt and remains non-retriable; command is absent from page-accessible surfaces.

### D02 — Supervisor-capable fleet binding in snapshot/registration
**Deps:** D01.

Wire existing `buildFleetSupervisorBinding()` to the fleet agent snapshot/registration boundary. Do not invent a second identity. Binding must include agent, role, tab, target, generation and deterministic `fsup_*`; `ambient_browser_authority=false`.

**Accept:** changing any physical incarnation component invalidates the binding; ordinary worker has no ambient browser authority; supervisor-capable identity is metadata until a valid shared lease exists.

### D03 — One-at-a-time physical transport proof for all six agents
**Deps:** D01, D02.

Use typed dispatch to each existing Browser 152.1 hidden/background ChatGPT agent and require post-submit positive readback before `ACTIVE` promotion.

**Accept:** 6/6 agents become transport-proven without selecting their tabs; an ambiguous send stays held and is never auto-replayed.

### D04 — Port DB-native task/claim/evidence migration
**Deps:** D02; review only before any environment apply.

Port only `supabase/migrations/20260830091200_federated_autonomy_task_claim_plane_v1.sql` from `7e9ff875...` onto a DevOS DB slice. Preserve one-mutator-per `(workspace,point,base_sha)`, exact incarnation lease binding, append-only events, RLS deny-by-default, `canonical=false`, `authority_effect=false`.

**Accept:** migration/static SQL tests pass in ephemeral/staging verification; no production apply from planner/integration branch.

### D05 — Browser DB claim client
**Deps:** D03, D04.

Add a narrow client for enqueue → claim → renew → result/ambiguous/finalize using only documented RPCs. Bind every mutating claim to exact supervisor-capable agent incarnation and lease generation.

**Accept:** stale generation, wrong target, expired lease, duplicate mutator, replayed idempotency key fail closed.

### D06 — Durable dispatcher loop
**Deps:** D05.

Consume DB tasks only after claim readback; dispatch by typed native command; persist event/effect evidence before transition. Ambiguous browser effect becomes `AMBIGUOUS/BLOCKED`, not retry.

**Accept:** kill/restart between claim and dispatch, and between dispatch and receipt, never causes duplicate actuation.

### D07 — Agent Worktree Workspace Manager
**Deps:** D05.

Build on A1 history: one isolated git worktree/branch per mutating task/agent; advisory agents remain read-only. Workspace identity is bound to task, point, base SHA, claim generation, and agent generation.

**Accept:** two IMPLEMENTER claims cannot mutate the same point/base; cleanup never deletes a worktree with a live claim/evidence gap; stale agent cannot write after incarnation rollover.

### D08 — Durable memory / learning / checkpoint adapter
**Deps:** D05, D07.

Reuse current memory/checkpoint ledgers and selectively port contracts from `work/convergence-global-observer-memory-v1`; keep observations, learned hypotheses, accepted facts and canonical checkpoints as distinct evidence classes.

**Accept:** model/page observations cannot become canonical facts without trusted verifier evidence; restart resumes task/checkpoint state without prompt text becoming authority.

### D09 — Keepalive Supervisor Mesh live rejoin
**Deps:** D03, D05, D08.

Reuse current keepalive and Supervisor Mesh contracts. Replace unresolved `SEND_WITHOUT_POSITIVE_READBACK` with receipt-bound wake lifecycle and DB/native dedup key. Fleet supervisor identities register/rejoin through mesh but act only through shared typed actuation lease.

**Accept:** rollover/restart restores supervisor loop; duplicate wake is idempotent; ambiguous wake is held; only one valid actuation lease can cause browser effect.

### D10 — Tree-sitter/LSP code graph v1
**Deps:** D07.

New minimal component because no existing implementation was found: parse changed/workspace files into symbol/reference/import graph, then overlay LSP diagnostics/definitions where available. Keep graph advisory and content-addressed to exact repo SHA/worktree.

**Accept:** graph invalidates on SHA/file hash change; parser/LSP output cannot mutate code; unsupported languages degrade to text/search, not fabricated symbols.

### D11 — DP2 physical sandbox execution binding
**Deps:** D07, D10.

Finish the already-present DP2 backend binding rather than creating a second sandbox plane. All candidate code/test execution goes through typed sandbox request + resource/network policy + evidence receipt.

**Accept:** live development plane reports bound backend and execution capability only after physical smoke; direct promote remains false; page/browser authority remains false.

### D12 — R10 Context Compiler live rejoin
**Deps:** D08, D10.

Port only R10 compiler contracts needed to build task context from durable checkpoint + code graph + verified evidence; do not inject raw browser/page text as authority.

**Accept:** deterministic context hash for same source set; provenance for every context segment; size budget/truncation is deterministic.

### D13 — R11 Same-Point Swarm live rejoin
**Deps:** D06, D07, D12.

Map advisory same-point roles onto DB tasks/claims. Exactly one mutating winner can hold the point lease; planner/researcher/critic/falsifier/synthesizer remain advisory until a typed promotion decision.

**Accept:** concurrent same-point swarm cannot create two mutators; losing/advisory branches cannot promote themselves.

### D14 — R12 Taint Graph live rejoin
**Deps:** D08, D10, D12.

Rejoin taint propagation across page/model/WebMCP output, code graph facts, memory and candidate evidence. Authority laundering across summaries/agents is forbidden.

**Accept:** tainted input remains tainted through summarization and peer transfer; only explicitly trusted verifier evidence can discharge a defined taint edge.

### D15 — MCP capability bus
**Deps:** D09, D14.

Reuse R6/R6b/R6c WebMCP catalog/adapter/routing as one capability registry behind typed envelopes, capability allowlists, leases and taint tracking. WebMCP/page declarations are discovery data, never authority.

**Accept:** unknown capability denied; stale lease denied; capability output tainted by source; no arbitrary eval/direct page-to-host execution.

### D16 — R13 trace replay + R14 benchmark
**Deps:** D06, D11, D14.

Rejoin trace/replay on the new durable task/claim/event IDs, then rebase benchmark scenarios on those traces.

**Accept:** replay is evidence-only unless a fresh lease is explicitly acquired; benchmark reproduces routing/claim/taint invariants and detects duplicate actuation.

### D17 — R15 remote browser pool + R16 adaptive router
**Deps:** D09, D11, D14, D16.

Rejoin remote pool only through sandbox/workspace identity and DB leases; then port R16 routing over local Browser 152.1, remote pools and advisory models. No route can weaken authority/taint/ambiguous-effect semantics.

**Accept:** router choice changes execution venue, never authority rules; target/process incarnation stays exact; remote loss cannot trigger blind replay.

### D18 — Observability + build fabric
**Deps:** D06, D08, D11, D16.

Unify task/claim/agent/worktree/sandbox/trace/build IDs into one correlation graph. Add build-cache/parallel test scheduling only after provenance keys include repo SHA, worktree/task identity, toolchain and dependency hashes.

**Accept:** every artifact/build result traces to source/task/toolchain; cache poisoning/stale artifact tests fail closed; dashboards remain observational and cannot change authority.

## 7. Dependency spine

`D01 → D02 → D03 → D04 → D05 → D06`

From `D05`: `D07 → D08 → D09` and `D07 → D10 → D11`.

Then `D08 + D10 → D12 → D13`, `D08 + D10 + D12 → D14`, `D09 + D14 → D15`, `D06 + D11 + D14 → D16 → D17`, and finally `D06 + D08 + D11 + D16 → D18`.

This ordering intentionally moves R10/R11/R12 and MCP behind durable claims/worktrees/memory/code graph so their richer reasoning cannot bypass the physical authority boundary.

## 8. Next three smallest safe implementation slices

1. **D01 — native `FLEET_TASK_DISPATCH` wiring only.** Existing dispatcher + tests are already present; this is the smallest code delta that turns prepared semantics into a native callable path.
2. **D02 — expose/bind existing supervisor-capable fleet identity.** No new identity system, no DB mutation; purely exact-incarnation metadata plus tests.
3. **D04-prep — port the single DB migration onto a DevOS DB branch and run ephemeral/static acceptance tests.** Do not apply production. D03 physical proof can run in parallel once D01/D02 build reaches a physically testable Browser, but DB runtime integration must wait for positive transport proof.

## 9. Promotion rule

Development OS must not become canonical merely because this checkpoint exists. A future authority promotion requires explicit trusted evidence that D01–D06 acceptance gates pass, 6/6 agents have positive transport proof, DB lease/evidence semantics survive restart/ambiguous-effect tests, and the authorized integration process deliberately supersedes the current Supabase `integration/compute-unified-v1@a23b647...` architecture checkpoint. This planner commit has `authority_effect=false` by design.
