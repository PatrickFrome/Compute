# METAENGINE Browser — Round 2: Re-Audit, Headroom Contracts, and the Research Behind Them (2026-09-04)

## 1. Scope and State Restoration (this round)

Re-audit performed on top of the round-1 elastic-fleet build (PR #274 + PR #275, integration head `d84913e9e1`). Current mainline: `integration/metaengine-development-os-v1` @ `7a5ab26b` (PR #276 session-broker journal merged). The autonomous delivery loop stayed alive between rounds: verified release `v0.6.6-dev.33787591453.1` was published at PR #271's merge (`7958b26b`) with no operator action — the pipeline recovery is holding.

Branch census (refresh): **420 remote branches, 296 unmerged (70.4%)** — unchanged from round 1 (no new sprawl; W7 remains a documented operator decision, not a code defect). Full suite on the round-2 base: **822/822 pass** before this build's changes, **839/839 after** (17 new contract tests), `npm run check` green, version `0.6.6-dev.10.1`.

Open PR triage (20 open): the guardian line (#277, #273, #272) is the autonomous loop's own in-flight work; the long tail of 2026-08 fix PRs (#199–#221) predates the current mainline and is superseded by it — batch rebase/drop remains P2.2 (operator decision, unchanged).

## 2. Round-2 Research: What the Best Analogs Did Since the Last Audit

Re-searched 2026 state (Browserbase/Stagehand, Steel, Playwright, Browser Use, Skyvern, Comet/Dia/Atlas/Chrome+Gemini):

- **Browserbase/Stagehand** — 2026 positioning is "reliable browser infrastructure without managing servers": elastic scaling, region routing, per-session contexts, and Stagehand's improved *context management* and self-healing actions. Their elasticity is server-side and multi-account; the per-account ceiling problem METAENGINE solved in round 1 (idle shrink, warm floor, ceiling 12) remains the correct single-host analog.
- **Steel (steel.dev, open source)** — "control fleets of browsers in the cloud", on-demand sessions, and a 72-hour *warm browser* capability (via Kernel). The warm-vs-cold economics validates our warm-floor design; their session quota API is the direct analog of our per-kind quota (below).
- **Playwright 2026** — the reference model for multi-context isolation: many contexts per browser process, per-context storage/permissions, and 2026 AI/MCP additions. Our W5 (single shared partition) remains the biggest structural gap against them; the per-role quota in this round is the single-host slice of that direction.
- **Browser Use / Skyvern 2026** — agent framework layer (89.1% / 85.8% WebVoyager): orthogonal to fleet infrastructure; our contract remains "context-rich, effect-poor, structurally injection-safe".
- **Consumer agentic browsers (Comet, Dia, Atlas, Chrome+Gemini, Brave)** — breadth of context features, but none ship durable effect journals, non-replayable ambiguity, or release trust chains. No change to the round-1 verdict: **METAENGINE leads on effect safety and delivery trust; analogs lead on multi-profile isolation (W5) and context breadth.**

The two P1 gaps from round 1 — W3 (shared 32-tab wall) and W4 (ramp-up serialization) — were exactly the dimensions where the analog set is strongest (quota'd session APIs; parallel page observation). Both are closed in this build.

## 3. This Build: W3 + W4 Contracts

### 3.1 W3 — Per-role tab quota + read-only census probe (`src/tab-registry.mjs` v2)

- Every tab now carries an immutable `role` (`USER` default | `FLEET`), tagged at creation: the fleet provisioner passes `ownership: 'FLEET_OWNED'` through the shell `createTab`, user navigation cannot (role is not patchable).
- **FLEET ceiling = 16 of the shared 32-tab wall.** The user is structurally guaranteed ≥16 slots at all times; the fleet can no longer starve the human surface. Both the wall and the ceiling throw the same `tab_capacity_exceeded`, so the provisioner's deterministic pre-effect classification (never ambiguous) is untouched.
- **Read-only census probe**: `TabRegistry.census()` + `TAB_CENSUS` shell command + census embedded in every published snapshot. It reports per-role/per-kind counts, ceilings, headroom, and fleet tab ids — with `create_tab_attempted: false`. The DevOS cycle and provisioner now learn TRUE capacity by reading, not by failed side effects — including across restarts, where tab-close events are lost (the round-1 W3 complaint).
- **Provisioner census gate** (v1.5.0): when the census proves the fleet at its ceiling or the shared wall, the reconcile pass adopts the identical deterministic no-op posture WITHOUT attempting the doomed createTab. Release semantics unchanged (physical tab close), ambiguity posture unchanged, evidence source improved.
- **Orphan sweep** (bounded 4/cycle, FLEET-role only, never ambiguous-bound tabs): fleet tabs with no live agent binding are closed through the normal shell path — physical slots held by nobody (crash-between-create-and-persist, failed retire-close) are reclaimed instead of leaking forever.
- **RETIRED history bound (64 rows on restart)**: the persisted fleet state was grow-only across capacity events; RETIRED rows carry no slot and no tab, so only the newest 64 survive a load. AMBIGUOUS rows are fenced evidence and are never pruned.
- **Governor grounding** (v1.1.0): the elastic plan gains `physical_worker_tabs` / `fleet_tab_ceiling` / `tab_census_grounded` from the census; the shrink surplus is computed from the TRUE physical pool (never below the logical), while the execution boundary still re-validates every retire against the provisioner's TRUE snapshot — a census defect can only under-shrink, never over-retire.

### 3.2 W4 — Bounded running-observation fan-out (1 → 4 per cycle)

`devos-native-task-cycle-core.mjs`: the cycle now observes up to 4 running tasks per heartbeat (was `plan.running[0]` only). Each observation is an independent fenced read-back (CAPTURE the bound tab → post completion); none touches foreground focus, so there are no parallel physical effects and no new authority. Per-task failures are isolated and recorded (`result_ready_batch`), with the exact old error surface preserved when *every* observed task fails (including the 1-task case). `result_ready` keeps its single-observation shape for compatibility.

With this, a >4-agent fleet harvests results 4× faster; combined with the elastic ceiling (12), fleet utilization is no longer observation-starved. The remaining serialization is honest and documented: promotion stays at 1/cycle and dispatch at 1 lease/cycle — both are server-contract constants (deployed edge function parity required before a browser-side bump; see W4 follow-up in §5).

### 3.3 Verification

17 new tests across three files (`test/tab-registry-census.test.mjs`, `test/fleet-census-capacity.test.mjs`, `test/fleet-census-grounding.test.mjs`): census read-only-ness; fleet ceiling vs user reservation; role validation/immutability; census gate blocks without attempts; census re-block after close only when still full; malformed census degradation; RETIRED pruning bounds + AMBIGUOUS never pruned; governor physical grounding and fallback; 4-of-5 observation fan-out with per-task failure isolation; all-failed error surface preserved; cycle census wiring. Full suite **839/839**, `npm run check` green.

## 4. Analog Comparison Update (delta from round 1)

| Dimension | Best-in-class analog (2026-09) | METAENGINE after this build | Verdict |
|---|---|---|---|
| Per-tenant/session quota | Steel session quota API; Browserbase per-session contexts | Per-role tab quota: fleet 16/32, user reservation 16, census-visible | **Parity (single host)**; multi-account quota remains theirs |
| Capacity observability | Vendor dashboards (opaque) | Read-only census probe in every snapshot; learn-by-read, not by-failed-effect | **METAENGINE leads** |
| Result harvesting throughput | Playwright parallel contexts | 4 observations/cycle, foreground dispatch unchanged | Analogs still lead (multi-window dispatch is W5's long-term fix) |
| Orphan/cold-slot reclamation | Kernel 72h warm sessions | Bounded orphan sweep + census-grounded idle shrink + warm floor | **Parity (single host)** |
| Effect safety / delivery trust | (unchanged: none ship it) | (unchanged: lease-bound effects, journal, monotonic CAS release) | **METAENGINE leads** |

## 5. Remaining Roadmap (ranked, updated)

- **W4-server (P1)**: deployed edge-function parity check, then promotion fan-out >1/cycle and lease dispatch budget >1 (browser-side contract bump is ready to carry it).
- **W5 (P2.1)**: dedicated `persist:metaengine-fleet-v1` partition — now *engineerable* on top of role-tagged tabs, but requires a fleet-partition ChatGPT login flow (product decision, operator).
- **W6 (P0.2, operator)**: one trusted relaunch of the installed legacy `0.6.6-dev.4.1` in updated-mode to clear the historical `SUCCESSOR_BOOTED` instance.
- **W7 (P2.2, operator)**: ~296 unmerged branches batch cleanup; RLS enablement for the 22 unprotected tables; PostgREST 401 transport regression.
- **W8 (P2.3)**: B-line convergence (identity envelope / effect ledger propagation to shell/extension planes; B7 scheduler consumes the ledger).

## 6. Mandatory Conclusion Blocks

- **AUTHORITATIVE_BASE**: `integration/metaengine-development-os-v1` @ `7a5ab26b` (round-2 base; 822/822 green at base).
- **VERIFIED_HEAD**: `work/browser-fleet-headroom-v1` (this PR; 839/839, check green, version `0.6.6-dev.10.1`).
- **INVARIANTS_PRESERVED**: single scheduler loop; worker telemetry zero capacity authority (census is shell-authoritative, not worker telemetry); ambiguous agents never auto-retired and never pruned; ACTIVE agents never auto-retired; deterministic capacity no-op semantics and release contract unchanged; authority_effect false on every new surface; no Supabase writes; no deployed-function changes.
- **MUTATIONS**: browser app source only (tab-registry, main, fleet-provisioner-core, fleet-elastic-governor, devos-native-task-cycle-core, devos-native-task-cycle) + 3 new test files + this document; no server/edge code; no credentials.
- **WHAT_IS_HONESTLY_NOT_DONE**: promotion fan-out and multi-lease dispatch remain server-bound (W4-server); fleet partition isolation is design-ready but product-gated (W5); legacy installed browser relaunch (W6) and branch cleanup (W7) need the operator; Temporal-class durable-execution unification (P3) remains a research frontier.
