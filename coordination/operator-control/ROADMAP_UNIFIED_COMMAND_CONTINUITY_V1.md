# METAENGINE Unified Command & Continuity Plane V1

Status: ACCEPTED ROADMAP / P0 INITIAL IMPLEMENTATION
Date: 2026-10-12
Scope: PatrickFrome/Compute / METAENGINE Client + own PostgreSQL + Windows Host
Canonical development base at adoption: `2bc3f3c13a75ed9708d657ae37db5cac610cc13f`
Branch: `work/unified-command-continuity-p0-v1`

## Binding owner directive — own DB only

**SUPABASE IS PROHIBITED** for this architecture and all new execution paths. Do not call Supabase cloud, REST, Realtime, Edge Functions, SDK or hosted Postgres; do not use its credentials, tokens, schema authority or infrastructure. This includes an implicit fallback on failures. The only durable transactional state store is METAENGINE's own self-hosted PostgreSQL 17 (localhost on a single-host deployment, or explicitly operated METAENGINE-owned PostgreSQL for federated deployments). GitHub remains an optional source/CI repository, never a task/effect DB. No dependency on ChatGPT being open.

Legacy SQL files and the path `apps/metaengine-browser/supabase` are historical implementation naming, not permission to connect to Supabase. Existing functions may be reused after independent provenance review and qualification under own Postgres. Remove or rename obsolete Supabase-oriented transport through explicit, tested migrations rather than deleting active code blindly. No future new runtime behavior may require a hosted provider.

## End-state and layers

`GPT chat (ephemeral operator) → own authenticated Gateway → own PostgreSQL intent/claim/event/effect/checkpoint ledger ↔ METAENGINE Client/Supervisor → Agent Fleet → verified result → continuation`

In parallel: `Windows Host Agent + Guardian` provide trusted process/database/package recovery. `Causal Observatory` serves identical projections to GPT and UI. Physical authority remains in the existing typed leased executor; no second scheduler, effect queue, autonomous retry channel or shadow DB.

1. **GPT chat**: temporary observer/coordinator/operator; one context call to recover; multiple chats resolve to one durable project/run identity. Chat is not a heartbeat, storage engine or always-running worker.
2. **Gateway**: authenticated typed tools for `context`, `inspect`, `submit_goal`, `control`, `run_status`, `events`, `qualify`, `emergency_stop`. Begin read-only; mutation routes require separate signed identity, capability, idempotency key and generation. No raw SQL/shell/eval/CDP. Native own HTTPS/MCP transport can be added without changing underlying authority.
3. **Client**: one Supervisor/scheduler, demand-driven Fleet, bounded BrowserCells, exact session/process/target fencing, Brain/Memory, Development Plane, evidence and artifact registries.
4. **Own PostgreSQL**: authoritative per-task owner partition/epoch, transactional leases, append-only event/effect/continuity, durable receipt/checkpoint, ordered cursor. Realtime wake is advisory, not authority. On multi-host deployment use a self-operated transport and explicit single-writer partition ownership; never dual-master local/remote SQL.
5. **Host**: Guardian, host-owned credentials, Windows services, self-update with exact artifact/proof/restart/rollback; no task planning or model/page authority.

## Cross-cutting invariants

- Every response carries schema version, source identity, observed_at, freshness, proof, explicit unknowns and authority_effect=false for all observation APIs.
- `HEALTHY` is NOT equivalent to live PID/socket, available DB, succeeded unit test or a model claim. Unknown, stale, conflicting, or absent independent evidence fails closed.
- All intent/effect/readback operations bind project_id/run_id/task_id/lease_generation/device_id/process_incarnation/source_sha/event_seq where applicable.
- Unknown network outcome after dispatch → AMBIGUOUS; never blindly retry. Follow exact reconciliation evidence and separate authorized generation.
- Zero trust for page/model/worker/memory text. Credentials, raw DOM, sensitive page contents, private SQL connection strings and arbitrary path/shell arguments must never appear in operator snapshots.
- Physical resource slots are bounded; logical agents and tasks are durable and distinct from short-lived browser tabs/sessions; emergency-stop preempts new admissions.
- Progress = verified useful completions, failure recovery and quality/cost, never a count of open tabs or agents.
- Independent CRITIC/FALSIFIER receives artifact/evidence locators, independently reads proof, and cannot grant itself effect authority.
- Own-DB status must be proven by live readback. Historical source names, legacy cloud references and CI mocks are not production evidence.

## Milestones / sequencing

| Stage | Work | Acceptance evidence | State |
|---|---|---|---|
| P0 — Truth Plane | Trusted read-only unified snapshot: own-Postgres readback, explicit UNKNOWN for missing Client/Supervisor/Fleet/Host/Source/Continuity; bounded API, freshness and identity; no secret leak | Core falsification tests; protected loopback HTTP; negative auth/origin/method checks; no DB mutations | IN_PROGRESS |
| P1 — Operator Gateway | Compact goal-level API & read-only inspect/events/run-status, then signed admit/control via existing authority; multi-chat idempotency | One chat reconnects by run_id; collision fences; no duplicate effects | PLANNED |
| P2 — Execution Continuity | Attest installed Owner, PostgreSQL/Guardian, reconcile WAKE_AMBIGUOUS, recover real task lease and restart | Physical Windows `Goal → ADMITTED → agent → artifact → critic → verified checkpoint` + restart | BLOCKED_ON_LIVE_EVIDENCE |
| P3 — Fleet Coordination | Distributed task graph, role scheduling, dependency resolver, independent verifier, handoff, bounded resource governor | 4+ coordinated agents, crash/lost-ack/child-failure chaos, no double scheduler/effect | PLANNED |
| P4 — Observatory/UI | One canonical snapshot + cursor-based deltas for Now/Missions/Fleet/Brain/Develop/System/Evidence, causality drill-down | UI and GPT agree on identical run_id, event_seq and proof identity | PLANNED |
| P5 — Self-improvement & verified promotion | Baseline→candidate→isolated eval→independent critic→bounded rollout→rollback; durable learning | Measured quality/speed improvement without unverified promotion | PLANNED |

## P0 slice 1: own local DB context endpoint

Implement a pure source-typed `operator-unified-snapshot-core.mjs` and authenticated `GET /operator/v1/context` on the existing loopback local PostgreSQL API. On this slice the DB facet uses the real existing catalog/capability SQL readback; all unconnected facets are `UNKNOWN` rather than inferred from PID, local files, or project memories. The endpoint grants no action authority. Do not expose an external port or MCP prematurely. Subsequent P0 slices will add signed Host/Owner evidence and consistent read-only task/fleet query projections, each with independent tests.

## Release gates / progress rule

Stage completion requires exact commit + source/tree identity, unit/falsification tests, own PostgreSQL disposable DB tests, Windows packaged UI/Owner/Guardian E2E where applicable, explicit adverse evidence cases, then independent live readback. Commit/PR is implementation, not installation. Installed version is not `READY` until exact EXE bytes and physical startup/effect proof are confirmed. No production DB migration/OS update until independent backup equality, role/ACL, permissions and no-unknown-effect gates are met.

## Immediate next sequence

1. P0 slice 1 implementation + focused tests + local API regressions (no live owner alteration).
2. P0 slice 2 source-backed task/fleet/session and host/guardian observation adapters, with bounded data/sensitivity and freshness checks.
3. P1 read-only external Operator Gateway with authenticated identity and safe transport (self-operated, no hosted backend).
4. Resolve currently unproven installed Admin/Owner and backup compatibility before task/effect testing.
5. Physical one-goal/multi-agent rollout and continuation.

This is a living roadmap. Update this single file on every relevant architecture review or milestone completion. Record exact test receipts and remaining blockers; do not create competing roadmap authorities.

## Implementation checkpoint — 2026-10-12 / P0 slice 1

- Implemented source: `infra/client-state-runtime/operator-unified-snapshot-core.mjs`, its falsification tests, and `GET /operator/v1/context` under the **existing own PostgreSQL** loopback API.
- No new SQL tables, cloud service, scheduler, external listener, raw SQL interface, or effect authority. Client/Supervisor/Fleet/Host/Source/Continuity remain UNKNOWN in this slice.
- Focused unit/HTTP-security contract: 22/22 PASS. Browser source structural gate: 190/190 PASS. Full Windows physical installed E2E: NOT RUN; no release/installation proof.
- **Discovered release-critical legacy drift:** `apps/metaengine-browser/src/native-supervisor-endpoints.mjs` still defines a hosted cloud-first default when `METAENGINE_STATE_PROVIDER` is absent; `bootstrapPersistentLocalProvider()` returns `NO_OWNER_CONFIG` when no owner file exists. Therefore merely shipping this P0 endpoint does NOT yet make the entire Browser strictly own-DB-only. This is a blocking migration requirement, not an accepted fallback.
- **Mandatory before P1 promotion or installed release:** remove the hosted default/fallback and fail closed on missing/mismatched local owner configuration, while preserving offline diagnostic boot; prove no external Supabase request in a Windows dirty-profile/absent-owner negative test. Do not silently substitute a guessed localhost port or bypass owner identity proof.
- This checkpoint is SOURCE-QUALIFIED only; no production DB migration, Windows Guardian mutation, installed update, or live agent effect was executed.

## Binding cross-client requirement: Live Development Plane (adopted 2026-10-12)

**User directive:** The zero-reinstall, in-app development principle piloted by the
standalone **METAENGINE DevFleet** must also apply to the primary **METAENGINE Browser**
client. Treat this as a mandatory architectural contract for both clients, not
an optional developer convenience or a DevFleet-only feature.

### Target: one persistent bootstrap, replaceable versioned feature plane

Both applications must separate a small, stable, signed/verified **host bootstrap**
(Electron/OS identity, session/profile isolation, local Owner and Guardian trust
boundaries, capability admission, rollback) from **versioned runtime feature
modules** (UI pages, typed agent orchestration adapters, observability views,
research/dev utilities and other nonprivileged logic). A trusted local Dev
Console must let an authorized operator inspect, stage, test, activate, observe
and roll back a module **without reinstalling the EXE**. Reload only the
affected UI/worker when safe; preserve unrelated GPT BrowserCells, logins,
durable task/claim/effect IDs and in-flight sessions.

For capabilities requiring Electron main process / native authority changes,
allow a **controlled process restart against an already-installed, preverified
runtime slot**. This still must not need a Windows installer when the stable
bootstrap and ABI are unchanged. Changes to the bootstrap, privilege/OS
capabilities, trust root or installer ownership remain exact, independently
qualified release-and-update operations; never silently hot-patch them.

### Same semantics for DevFleet and METAENGINE Browser

- Common versioned module manifest: module ID, ABI/schema, source SHA, artifact
  SHA-256, capability list, contract tests, approved activation identity,
  parent generation, rollback slot and independent readback.
- Staging and promotion require an authorized local operator and evidence;
  an untrusted GPT chat, page DOM, model response or remote website may **not**
  write/promote arbitrary JavaScript, bypass model/Chat mode gates, or obtain
  shell, OS, DB or Guardian authority through this mechanism.
- Module updates are atomic: candidate staging -> tests -> hash/ABI admission ->
  generation-fenced activation -> live readback -> durable checkpoint; on failed
  activation, revert to the last known-good slot; no blind retry after an
  ambiguous externally observable effect.
- **One own-PostgreSQL authority** for METAENGINE Browser. Feature module
  activation evidence and history ultimately reside in that own DB. DevFleet
  may begin with isolated, profile-private version records and must never
  turn into a second Browser scheduler, task ledger or hosted/cloud database.
- The **GPT Chat-only** constraint for DevFleet fleet sessions remains binding;
  hot modules must not silently open Work, switch to Work, bypass High/model
  verification or repeat an ambiguous Send. Such guards reside in the trusted
  host, not overrideable UI decorations.
- The Dev Console exposes typed controls and event/proof readback, not raw
  unauthenticated shell, SQL, CDP, eval or process management.
- Rollout order: **L0 DevFleet declarative/live UI & workflow modules** ->
  **L1 sealed feature module interface + tests/rollback** ->
  **L2 equivalent METAENGINE Browser feature plane** with native Supervisor,
  Host/Guardian and own-DB proof -> **L3 resilient self-improvement promotions**.
  Keep P0/P1 trusted-observation gates as prerequisites for an externally
  controlled promotion path.

### Acceptance gates

1. Change a versioned DevFleet feature/module through its in-app console,
   without uninstall/reinstall or clearing authenticated ChatGPT tabs;
   verify source SHA + live UI/feature change + rollback.
2. Terminate/restart DevFleet mid-promotion and prove exactly one active
   version, no lost chat mappings and no duplicate message sends.
3. Apply the same approach to a nonprivileged **METAENGINE Browser** module,
   with exact own-PostgreSQL checkpoint, Owner/Guardian identity intact and
   no second scheduler or effect executor. Run Windows packaged dirty-profile
   and adversarial activation/rollback tests.
4. Promote no module under unresolved effect ambiguity, unsigned/unverified
   privilege boundary, nonlocal DB authority or missing independent evidence.

**Status:** BINDING REQUIREMENT / DevFleet prototype in development /
METAENGINE Browser implementation NOT YET CLAIMED.
