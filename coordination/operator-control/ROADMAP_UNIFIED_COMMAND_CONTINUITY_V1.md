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

## Implementation checkpoint — 2026-10-12 / P0 slice 2, Truth Plane hardening (partial)

- Branch: `work/devfleet-p0-truth-v1`, independent isolated checkout from exact slice-1 base `6deab07107faeccd12c7e753ff8f02a785c673d7`.
- Existing protected `GET /operator/v1/context` is retained; no new listener, task database, scheduler or mutation route.
- Database readback no longer fabricates `observed_at` using the HTTP clock. It makes one bounded, fixed `SELECT` for PostgreSQL clock/startup/database identity inside the existing capability-RPC transaction and qualifies contradictory, missing or malformed readback as `UNVERIFIED`. Stale DB time is `STALE`, partial catalog is `DEGRADED`. `AVAILABLE` remains DB-only, not Owner/Client/Fleet/Guardian HEALTHY.
- Pure snapshot reducer now rejects non-DB positive claims without Owner/heartbeat; requires process incarnation for Client/Host, signed-proof flag and epoch for Supervisor, lease generation for Fleet, exact source SHA for Source, ordered event sequence for Continuity. Contradictory owners become `AMBIGUOUS`. These *minimum shape gates are not cryptographic attestation*; no untrusted caller can supply them to the protected endpoint.
- Default endpoint still emits `UNKNOWN` for Client, Supervisor, Fleet, Host, Source and Continuity. Their real signed Owner/Guardian/native/session/checkpoint readback adapters are **NOT IMPLEMENTED**. This slice is intentionally **PARTIAL / NOT RELEASE READY**; do not infer deployment readiness from hermetic tests.
- Falsification coverage: absent/duplicate/corrupt database witness, incomplete catalog, stale clock, missing Owner/heartbeat, stale heartbeat, contradictory Owner, absent signed supervisor flag, corrupt SHA/event_seq/lease generation, private data non-disclosure; protected endpoint missing witness case.
- Release blockers persist: legacy cloud-first default without exact Owner config (PR #1184 addresses a different branch but requires independently proven absent-Owner behavior), real Windows Owner/PostgreSQL/Guardian test, independent live source/continuity attestation, installed-package proof and own DB recovery exercise. No installed client/production DB/Guardian mutated.
- Focused evidence on isolated Windows checkout, Node v24.19.0: `node --test operator-unified-snapshot-core.test.mjs operator-truth-readback.test.mjs db-api.test.mjs` = **27/27 PASS** after repairing a test-harness assertion (first run 26/27); `node --check` for the three runtime modules and `git diff --check` PASS. Exact released/live Owner readback remains untested.
## P0 slice 2 — Host/Browser process incarnation (source branch checkpoint)

Branch: `work/fleet-p0-host-truth-v1`, stacked on P0 slice 1 head `6deab07107faeccd12c7e753ff8f02a785c673d7`.
An independent, explicit read-only Host-observation reducer was added with Browser PID/creation/incarnation fencing, Guardian status, split-channel heartbeat, OS process inventory, bounded freshness, strict allowlist/redaction and no possible Host `READY` promotion. The existing loopback `GET /operator/v1/context` gains an optional trusted in-process Host readback callback; the standalone CLI deliberately leaves it disconnected (`UNKNOWN`) until independently reviewed, wired and physically attested. No new API route, SQL, local process inspection side-effect, Supabase client, installed-client mutation or scheduler authority.
Adversarial source tests cover PID reuse, stale heartbeat, absent Guardian, metadata redaction and runtime-probe-only. **These tests are added but not executed by this distributed Chat role**; exact replay is required from an isolated checkout and is not live host evidence.
Next: the coordinator independently validates the new branch, then connects a trusted read-only Owner/Guardian adapter only after exact process-incarnation/heartbeat provenance verification. The legacy cloud-first Browser fallback remains a separate release blocker.


## W2/P0 — Owner-scoped own-Postgres ledger truth (2026-10-13, source qualification)

- Independent implementation branch `work/roadmap-w2-own-pg-truth-20261013`, stacked on PR #1191 exact head `fff5c2147d83445457f47e9e3503e2bab0161292`; do not merge/release before review.
- `infra/client-state-runtime/operator-own-pg-fleet-truth.mjs` adds fixed parameterized, bounded read-only SQL for project, task/claim/lease and ordered event cursor from existing own PostgreSQL. One repeatable-read, read-only snapshot with scoped trusted Owner identity; no new schema/effects/planner/listener.
- Existing protected operator context now optionally consumes an **in-process** trusted Owner adapter. No Owner adapter and no proven ledger privileges means explicit `UNKNOWN`, not fabricated fleet readiness. Contradictory active claims / lease generations / event cursors fail closed. Limited counts and `after_seq/next_seq/through_seq` only; raw task specs, event content, credentials and SQL are excluded from projections.
- Focused W2 + protected HTTP + existing DB API/Host/context falsification tests: 38/38 PASS on Windows Node v24.19.0 (exact source SHA at first qualification: 85e37b1b5d23e851e15add35471e9e65a91837d4). Real PostgreSQL RLS/grant proof, live Owner binding and installed Host/Guardian effects remain necessary gates. This is **SOURCE-QUALIFIED, NOT INSTALLED/READY**. No production migration, Browser/Guardian mutation, Supabase connection or main update.
