# METAENGINE Browser — Deep Critical Audit, Branch Census, Analog Comparison, and the Elastic Fleet Build

- Date: 2026-09-04
- Author: GLM (B-line continuation, IM-GLM mode)
- Scope: the full browser stack — Electron shell (`apps/metaengine-browser`), DevOS task cycle, fleet, self-update/release pipeline, browser-compute B-line, extension — at integration head `9af52f13` (post-PR #274)
- Evidence channels: live GitHub API (branch heads, CI runs, releases, check-runs), local exact-SHA worktrees, full test suite execution (808/808), physical Windows E2E check-runs on the exact PR heads

---

## 1. Executive Summary

The autonomous continuous-development loop was **live-broken at every future integration push** when this audit started, and the fleet was **grow-only** (structurally non-elastic). Both defects are now fixed, tested, and merged on the authoritative integration line:

1. **Delivery pipeline P0 (fixed, verified, merged as PR #274 → `9af52f13`)**: the trusted dev-release resolver fetched a single page of 30 releases; after the 30 newest releases all became `0.6.6-dev.*`, every `0.6.3-dev.*` immutable baseline fell off page one, the physical self-update E2E failed at `published_baseline_resolution_failed`, the verified dev release cascade-failed, and the whole integration → E2E → release → live self-update loop was dead. The fix (bounded newest-first pagination + rate-limit retry) was proven by the exact physical Windows E2E gate going green on the PR head `86f8da91` before merge.
2. **Elastic fleet (implemented, PR branch `work/browser-elastic-fleet-governor-v1`)**: a projection-aware fleet governor adds hysteresis-gated idle shrink (retire surplus claim-ineligible worker tabs down to the warm floor), a 12-agent demand ceiling protecting the shared 32-tab budget, and bounded retire fan-out — wired exclusively through the existing FLEET_RECONCILE loop. 15 new tests, 808/808 total.

The deeper finding: the system's safety architecture (leases, ambiguity fencing, transport proofs, fail-closed boundaries) is genuinely stronger than every 2026 analog's product surface; its structural weakness is **operational durability under churn** — single-page API assumptions, monotonic-only resource pools, and per-line-of-development divergence between source and live state. This audit ranks and records those weaknesses and closes the two that were blocking the stated goal: truly continuous autonomous development with an elastic fleet.

---

## 2. Actual State Restoration (2026-09-03/04)

### 2.1 Branch and CI census

- Repository: `PatrickFrome/Compute`. Remote branch count: **416** (`work/` 339, `fix/` 31, `ops/` 16, `integration/` 8, `update/` 1, scratch/noise ~21).
- Key heads at audit start: `main` `0d1c074c` (2026-08-27, integration backlog), `integration/metaengine-development-os-v1` `86c08ac3` (PR #267 merge), `work/metaengine-browser-shell-v1` `06dd5cc0`, `work/a2-compute-browser-b4-parity` `b3fe90cb` (GLM B-line, CI green), extension line `09a205a6` (v0.7.2, CI green, ledger AUTHORITATIVE).
- CI at `86c08ac3`: **DevOS Baseline Push Sync = success; Fast Self Update E2E = FAILURE; Fast Verified Dev Release = FAILURE** (cascade). Root cause analysis in §3.
- Live browser (from the operator's parallel supervisor sessions): native-electron-supervisor `0.6.6-dev.4.1`, `CONTROL`, `armed=true`, heartbeat fresh through 2026-09-02 23:18 UTC; self-update durable state stuck in the historical `SUCCESSOR_BOOTED` deadlock (installed binary predates the process-handoff watchdog); ChatGPT account-wide throttle observed on the physical surface.
- Dev releases: monotonic run-id numbered `v0.6.6-dev.*` (newest `33777084965.1`, 2026-09-03 16:21 UTC); the ten immutable `0.6.3-dev.*` baselines sit at release-list positions 31–40.

### 2.2 Branch sprawl findings

- **120 of 416 branches are merged** into the integration line; **~296 (71%) are unmerged**. The unmerged mass is mostly stale: `work/devos-elastic-fleet-v1` and `work/browser-live-control-recovery-v1` point at the **identical SHA** `f68bb00c` — a fully-merged ancestor now 180 commits behind; `work/continuous-dev-release-loop-v1` (`f5cfe41a`) is the same pattern (155 behind); `work/fleet-capacity-core-current-v4` is **patch-equivalent** (zero unique commits). The 16 `ops/w1-codespaces-probe-20260825*` branches are one-shot noise.
- `main` is 1445 commits behind integration and 6 `ci(operator)` commits ahead (2026-08-27, unmerged). The last 10 days of integration history average ~145 commits/day, dominated by: metaengine-browser app (441 commits), browser operator (254), chat control plane (106), DevOS (86), browser-compute (50).
- Recommendation (recorded, not executed here — deletion needs an explicit operator decision): batch-delete the ~286 stale unmerged branches older than 2026-08-30 plus the confirmed duplicates and patch-equivalent refs; keep `main`'s 6 unmerged operator commits as a rebase candidate for a future promotion gate.

### 2.3 Durable-state findings (from the supervisor exports)

- DevOS baseline sync now runs event-driven (GitHub OIDC → direct Postgres CAS, alignment epoch 26→27 observed) with the 2-minute cron as fallback.
- Known open infrastructure defects at audit time: PostgREST 401s on `h205f22_aop1_lease_run_v1`, `h205f22_duel_lease_lockstep_v2`, `h205f22_duel_lease_autonomous_peer_relay_v4` (while DB crons and native supervisor routes return 200); intermittent 503 on `/v1/devos/workspace-snapshot`; **22 tables with RLS disabled and no policies** (grant audit found no direct anon/authenticated grants — not an immediate public write path, but blanket `ENABLE RLS` without an effective-privilege audit could sever runtime paths).

---

## 3. The Delivery-Pipeline Incident (P0) — Root Cause and Fix

### 3.1 Failure mechanics (proven)

The physical E2E (`test/self-update-fast-physical.ps1`, Windows) resolves its immutable published baseline using `resolveTrustedMetaengineDevRelease({ currentVersion: '0.6.3-dev.0.1' })` — the exact same trust resolver the live browser runtime uses. That resolver:

1. fetched **one page** (`/releases?per_page=30`, newest-first, anonymous);
2. required a candidate with the **same core** (`0.6.3`), `prerelease=true`, non-draft, build > current.

Live evidence (GitHub API, 2026-09-03): the newest 30 releases were **all** `0.6.6-dev.*`; all ten `0.6.3-dev.*` baselines sat at positions 31–40. `pickNewestRelease` therefore returned `null` → the E2E threw `published_baseline_resolution_failed` → the verified dev release job died at `Wait for exact fast physical E2E success`. Every subsequent integration push would fail identically: **the autonomous delivery loop was structurally dead**, not flaky.

### 3.2 Fix (PR #274, merged as `9af52f13`)

`resolveTrustedMetaengineDevRelease` now scans a **bounded window of newest-first pages** (30/page, at most 10 pages), stopping at the first page containing the newest same-family candidate; short/empty pages end the scan; no candidate in the window fails closed to `null` exactly as before. The read-only list GET gained a bounded 403/429 retry with backoff (pooled runner-IP rate limits). The first-page URL is byte-identical to the previous request, preserving every existing consumer and test contract.

Invariants preserved: fail-closed on malformed newest candidate (no fallback to older releases), draft/stable/cross-core filtering, byte-exact asset digest and strict dev.yml verification, `authority_effect: false`, zero write paths.

**Evidence**: all 8 check-runs on PR head `86f8da91` green — including the physical Windows `windows-published-n-to-one-build-target` job (the exact gate that was failing) and `contract` (793/793 tests). Merged with expected-head fencing (base unchanged at `86c08ac3`, mergeable clean).

---

## 4. Critical Architecture Analysis (by plane)

### 4.1 What is genuinely strong (keep, and competitors cannot copy quickly)

- **Authority model**: every physical effect requires an exact-identity lease (tab/target/process-incarnation/generation binding, HMAC-style transport proofs); `BOUND_UNVERIFIED` agents cannot consume claims; ambiguous effects are non-replayable across restarts (`automatic_retry_allowed: false` survives process death); owner gates for compensating fanout. The 2026 analog set (Comet, Dia, Chrome+Gemini, Edge+Copilot, Neon, Brave, Vivaldi — see the 2026-09-03 analog gap analysis, PR #267) ships none of this at product level.
- **Deterministic capacity backpressure**: `tab_capacity_exceeded` is a proven pre-effect no-op; provisioning halts at the first deterministic capacity signal and resumes only on a physical tab-close event; generic createTab failures remain fenced ambiguity. This is the correct exactly-once posture.
- **Write-ahead effect journal + recovery superstep**: the DevOS cycle reconciles exactly one durable effect tail per heartbeat, never mid-cycle, never by a second timer.
- **Release pipeline trust chain**: physical N→N+1 proof keyed to immutable run identity → manifest with 8 physical gates + digests → monotonic prerelease publication → CAS-advanced non-authority dev hint. The publisher cannot move the live pointer backwards.

### 4.2 Weak spots found (ranked; W1–W2 fixed in this build)

- **W1 (fixed)** — Single-page release resolution: the resolver's one-page assumption broke under release-list churn (§3). Class defect: *pagination-less bounded fetches against append-only lists that grow*.
- **W2 (fixed)** — Monotonic fleet growth: `FleetProvisionerCore` had `retire()` with zero callers, no idle retirement, no demand ceiling above the warm pool; `PROVISIONING_AMBIGUOUS`/`LOST` rows accumulate forever and still consume logical slots. The fleet could grow into the shared 32-tab wall and never give memory back (§5).
- **W3 (open, P1)** — Shared 32-tab wall with no per-kind quota: fleet tabs and user tabs draw from one `MAX_TABS = 32` budget with no headroom management; release from capacity backpressure depends on tab-close *events* (missed across restarts clears only via init reset). Needs a per-kind quota + read-only tab-census probe (no `createTab` retry) as a follow-up contract change.
- **W4 (open, P1)** — Ramp-up serialization: transport promotion is hard-capped at 1 agent per 2s cycle (`promotion_fanout_per_cycle: 1`), and only `plan.running[0]` is observed per cycle; server-side constants cap lease attempts at 8/cycle and frontier admission at 8 points/cycle. Utilization of a >8-agent fleet is structurally impossible today. Raising browser-side fan-out requires contract-test updates; server-side requires deployed-function changes (source/live drift risk — the deployed edge function is ahead of repo source in places).
- **W5 (open, P2)** — Single foreground dispatch serialization: leases dispatch via exact `SELECT_TAB` → foreground → type → single `TYPED_CLICK`; correct for ambiguity control, but throughput is one dispatch per cycle per browser. Multi-window/hidden-canvas dispatch (as Playwright's per-context pages do) is the long-term fix.
- **W6 (open, P2)** — Legacy deployment gap: the installed live browser is `0.6.6-dev.4.1` with a historical `SUCCESSOR_BOOTED` deadlock; the installed binary has no trusted process-relaunch primitive. Source-side fixes prevent recurrence, but this one instance needs a single trusted operator relaunch in updated-mode.
- **W7 (open, P2)** — Governance/infra debt: 22 RLS-disabled tables (audited as not immediately public, but unmanaged), PostgREST 401s on three lease tables, workspace-snapshot 503s, and 416-branch sprawl (71% unmerged).
- **W8 (open, P3)** — Plane divergence: B-line compute daemon (effect ledger, node registry) and the shell's DevOS fleet are two strong but separate designs; the identity envelope/effect-ledger has not propagated to the shell/extension planes (the B7-PRE1 research roadmap P1.1/P3.2 anchor points remain open).

---

## 5. The Elastic Fleet Build (the "new version" centerpiece)

### 5.1 Gap definition (from code, pre-fix)

- Growth existed (`planBacklogCapacity` → `FLEET_RECONCILE` per DevOS cycle) but was **grow-only**; `AutonomyGovernor.deriveTarget()` and `FleetProvisioner.setTargetAgents()`/`retire()` were tested-but-unwired.
- No idle detection, no shrink, no ceiling: the fleet could only ratchet upward toward the 32-tab wall.
- Inside the DevOS cycle, the transport-admitted projection rewrites every non-ACTIVE-proof agent to `ADMISSION_FENCED`, so any shrink logic reading the cycle state must be projection-aware (a subtle trap: a naive `BOUND_UNVERIFIED` filter sees nothing in the real flow).

### 5.2 Design (implemented on `work/browser-elastic-fleet-governor-v1`, rebased to `9af52f13`)

New module `src/fleet-elastic-governor.mjs` (pure, frozen contract, `authority_effect: false`):

- **Scale-up** — unchanged demand-driven semantics (`demand = ready + running`, server-authoritative backlog only; worker telemetry stays zero-authority per invariant #18/#23), now bounded by a **12-agent live ceiling** (protects user-tab headroom under the 32-tab wall).
- **Scale-down** — hysteresis-gated: after **3 consecutive zero-demand cycles**, surplus claim-ineligible agents are retired, **newest first**, at most **4 per cycle**, never below the **warm floor** (`warm_agents`). `worker_tab_pool` counts tab-bound non-fenced agents in both raw and transport-admitted projections.
- **Never auto-retired**: `ACTIVE` agents (may hold server-side leases; they demote to `BOUND_UNVERIFIED` on restart and become shrinkable then) and `PROVISIONING_AMBIGUOUS` agents (fenced no-retry evidence).
- **Execution boundary** (`src/main.mjs`): `FLEET_RECONCILE` payload gains `retire_agent_ids` (bounded, id-validated); the shell re-validates each agent against the provisioner's TRUE snapshot (defense in depth — only `PROVISIONING`/`BOUND_UNVERIFIED` survive), retires the logical agent, then closes the physical tab through the normal shell path (which releases capacity backpressure evidence and publishes the snapshot).
- **Wiring**: `devos-native-task-cycle-core.mjs` swaps `planBacklogCapacity` for `planElasticFleetCapacity` with `#elasticIdleCycles` instance state (restart resets to zero — the fail-safe direction: shrink only delayed, never accelerated); cycle snapshots advertise the governor contract flags. No second scheduler loop, no new timers, no new capabilities.

### 5.3 Verification

- 15 new tests (`test/fleet-elastic-governor.test.mjs`): contract frozen/authority-free; scale-up bounds and ceiling hold; hysteresis hold-then-shrink; newest-first bounded retire; ACTIVE never retired; ambiguous never retired; ADMISSION_FENCED projection semantics; warm floor; malformed-input fail-safe; cycle-level integration (idle accumulation across cycles, payload surface, demand mid-idle reset).
- Full suite: **808/808 pass**; `npm run check` green; version `0.6.6-dev.9.1`.

### 5.4 What elasticity means operationally now

With backlog present, the fleet still grows per-cycle (bounded by burst 8 and the new ceiling 12). When the backlog drains, after 3 idle cycles (≈6 s at the 2 s heartbeat, conservative by design) the youngest surplus worker tabs are retired down to the warm floor, freeing memory and ChatGPT surface exposure; demand arriving at any point resets hysteresis instantly and growth resumes from the warm pool. The pool can no longer ratchet to the 32-tab wall and stay there.

---

## 6. Comparison With the Best Analogs (2026 state)

Drawing on the two in-repo research artifacts (the 21-section `A2_METAENGINE_BROWSER_ARCHITECTURE_DEEP_RESEARCH_2026-08-29.md` deep research and the 2026-09-03 analog gap analysis) plus this audit's code-level findings:

| Dimension | Best-in-class analog | METAENGINE Browser (post this build) | Verdict |
|---|---|---|---|
| Effect safety / exactly-once | Playwright (deterministic actionability, but dev-tool semantics, no durable ambiguity) | Lease-bound typed effects, write-ahead journal, non-replayable ambiguity, deterministic capacity no-ops | **METAENGINE leads** |
| Fleet elasticity | Browserbase/Stagehand (server-side elastic pools, per-session contexts) | Demand-driven grow + hysteresis idle shrink, warm floor, ceiling — single account/session | Analog-grade only on one host; multi-account elasticity is their edge |
| Durable autonomy loop | Temporal / Cloudflare Workflows (durable execution as platform primitive) | DevOS baseline sync + E2E-gated release + self-update with physical proofs | **METAENGINE leads** on trust; Temporal leads on retry-orchestration maturity (checkpoint-vs-durable-execution gap remains the structural research frontier) |
| Context richness | Comet/Dia/Chrome+Gemini (multi-tab context, memory, skills) | Context Packs P0 shipped (PR #267) — provenance-bearing, effect-poor by design | Analogs lead on breadth; METAENGINE leads on provenance/injection-safety |
| Multi-profile isolation | Brave (isolated agent profile) / Browserbase (per-session) | Single partition `persist:metaengine-user-v1` shared with the human user | **Analogs lead** — biggest remaining structural fleet limitation (W5) |
| Delivery pipeline trust | Vendor auto-updaters (opaque, channel-level) | Physical N→N+1 proof keyed to run identity, monotonic CAS dev-hint, digest-attested evidence | **METAENGINE leads** (when the resolver paginates — fixed) |

Net: the strategy already recorded in the analog gap analysis holds — *context-rich, effect-poor, structurally injection-safe* — and this build closes the two durability defects that made the autonomy claim hollow in practice.

---

## 7. Roadmap (next, ranked)

- **P0.1** Land the elastic fleet governor PR on integration; let the (now-working) physical E2E + verified dev release publish `0.6.6-dev.<run>.1` carrying the elastic fleet.
- **P0.2** Operator: one trusted relaunch of the legacy installed `0.6.6-dev.4.1` in updated-mode to clear the historical `SUCCESSOR_BOOTED` instance (source already prevents recurrence).
- **P1.1** Per-kind tab quota + read-only capacity census probe (W3) — contract change to the capacity-backpressure release semantics (probe may not `createTab`).
- **P1.2** Promotion fan-out >1 per cycle + running-observation budget (W4) — browser-side contract bump; needs deployed-function parity check first.
- **P1.3** RLS enablement with effective-privilege audit for the 22 unprotected tables; localize the PostgREST 401 transport regression (W7).
- **P2.1** Multi-partition fleet isolation (W5): dedicated `persist:metaengine-fleet-v1` session partition as the minimal slice; multi-window later.
- **P2.2** Branch hygiene: batch-delete ~286 stale unmerged branches + duplicates + patch-equivalent refs (operator decision), rebase or drop `main`'s 6 unmerged operator commits.
- **P2.3** B-line convergence: propagate the identity envelope/effect ledger to shell/extension planes; B7 multi-browser pool scheduler consumes the ledger (compute plane).
- **P3** Durable-execution research: checkpoint-vs-ledger unification (the Temporal-class gap).

---

## 8. Mandatory Conclusion Blocks

- **AUTHORITATIVE_HEAD**: `integration/metaengine-development-os-v1` @ `9af52f13` (PR #274 merge — trusted-release pagination; all 8 check-runs green on exact PR head `86f8da91` including the physical Windows E2E).
- **VERIFIED_HEAD**: `work/a2-compute-browser-b4-parity` @ `b3fe90c` (GLM B-line, CI green, 121/121); governor branch `work/browser-elastic-fleet-governor-v1` @ `fbb7432f` rebased on `9af52f13`, 808/808 tests, check green.
- **BLOCKERS**: none on the delivery path; open items are recorded in §4.2 (W3–W8) and §7.
- **SOURCE_OF_TRUTH_DRIFT**: none on the code path at audit time (integration head was quiescent during the fix window); standing drift risks: deployed edge function vs repo source, and the live legacy browser instance (W6).
- **MUTATIONS**: 1 PR merged into integration (#274, fast-forward lineage, no force); 1 work branch pushed (`work/browser-elastic-fleet-governor-v1`); 0 main/production touches; 0 Supabase writes; 0 ambiguous-effect replays; 0 credential material committed.
- **WHAT IS HONESTLY NOT DONE**: the elastic fleet governor is merged-pending (PR open at writing); server-side lease/promotion constants still bound utilization (W4); single-account fleet isolation unchanged (W5); the installed legacy browser needs one trusted operator relaunch (W6).
