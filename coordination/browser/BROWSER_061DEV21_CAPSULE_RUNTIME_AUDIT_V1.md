# METAENGINE Browser 0.6.1-dev.2.1 Capsule / Runtime Audit V1

Date: 2026-09-01
Audit base: `work/browser-continuous-fleet-audit-v1` @ `7b8fd39e322e3bf075d94e93f42144e9c33fadaf`
Development branch: `work/browser-runtime-compatibility-v1`
Production mutation: **none**

## Capsule verdict

Uploaded ZIP SHA-256: `136dec975f15bf01651579b7523b4e4d5c076f15d05588949b2e9ac855d0abac`.
The archive contains 15 entries. All 13 entries covered by `SHA256SUMS.txt` verify exactly.

The capsule identifies version `0.6.1-dev.2.1`, exact source `50ac1e41fbe53f2c2e33b5ef8ba1bf477b05d2b8`, and candidate id `candidate_sha256_d7f4ced04ef6db3fb577743f508af18a583448c8288d91b54b51693bd080d248`.
Its own verdict is correct: **SOURCE TEST CANDIDATE — NOT PROMOTION AUTHORIZED**.
Evidence: 603/603 Node tests, 0 failures, 0 skips; exact git archive and digest-bound receipt; no Windows packaged test, production migration test, Authenticode/SLSA/Sigstore provenance, or same-SHA physical N→N+1 proof.

The capsule source SHA is no longer an accessible GitHub commit and `work/browser-meta-orchestrator-v1` has moved to a later head. Therefore the ZIP is retained as immutable evidence, not used as current branch authority.

## Current authoritative development state

`work/browser-continuous-fleet-audit-v1` has exact-head and read-only lineage CI green. The lineage auditor sees 290 remote heads, 258 work/integration/release branches, 62 branches fully contained by the audit head, 112 independent same-family lineage tips, and 98 authority-bearing lineage tips. C0 collapses from 17 branches to one exact ancestry tip; C5 collapses from 17 branches to two tips.

The current source already contains the desired no-blind-retry Browser effect journal, write-ahead effect barrier, transport promotion route, ambiguity reconciliation v2 call path, post-lock transport revalidation, meta controller lease, atomic frontier admission and scheduler-capacity projection.

## Live runtime divergence

Read-only Supabase inspection shows live runtime is materially older than the current source contract:

- DevOS tasks: 70 `AMBIGUOUS`, 5 `READY`, 2 `RESULT_READY`, 8 `COMPLETED`, 6 `FAILED`, 6 `CANCELLED`.
- Claims: 72 `EXPIRED`, 20 `RELEASED`, 0 `ACTIVE`.
- All 70 ambiguous tasks carry `LEASE_EXPIRED_EFFECT_UNKNOWN`.
- Only 4/70 ambiguous task generations have an exact matching `TASK_TRANSPORT_PROVEN` DB event; 66/70 remain effect-unknown from DB evidence alone and MUST NOT be blindly requeued.
- The freshest native supervisor heartbeat is about 22 hours stale; sampled supervisor mesh rows are all `LOST`.
- The deployed native supervisor Edge Function is version 4 and exposes the legacy `devos_routes` surface but not the current source promotion/meta capability surface.
- Production migrations stop at the 2026-08-31 DevOS meta/fairness layer. Current source RPCs for ambiguity reconciliation v2, scheduler capacity and meta-orchestrator admission are not deployed.

This is a source/runtime protocol skew, not merely a worker-capacity shortage.

## Security debt discovered during audit

Supabase advisor metadata reports 21 live tables with RLS disabled, including A2 runtime/duel/peer surfaces and `destruktion_meta.metaengine_devos_roadmap_authority_h205f22`. This is treated as P0 security debt. This branch does **not** enable RLS blindly: an RLS migration requires exact caller inventory and explicit policies, otherwise it can silently break service-role/client flows.

## Implemented recovery boundary

This branch introduces a fail-closed runtime compatibility plane:

1. `devos-runtime-compatibility.mjs` rejects legacy/missing/partial capability contracts before physical dispatch is considered compatible.
2. `runtime-capabilities.mjs` defines the exact server protocol generation and requires DB runtime attestation to match byte-semantically before advertising it.
3. `devos_runtime_capabilities_v1()` is service-role-only and zero-authority.
4. `devos_recovery_debt_snapshot_v1(workspace)` is read-only and partitions ambiguity debt into exact effect-proven versus effect-unknown generations without returning task content or granting retry/scheduler/browser/release authority.
5. CI requires exact head, Node 24, negative compatibility tests, service-role ACL text, runtime read-only SQL, no second scheduler, and no automatic retry.

## Recovery policy

`EFFECT_PROVEN` is not equivalent to retryable. A proof-backed ambiguous task may be reconciled by restoring only the DB receipt/state after exact generation/incarnation checks; the Browser effect is never replayed.

`EFFECT_UNKNOWN` remains quarantined until durable local journal evidence or another authoritative receipt resolves it. Absence of a DB transport event is not proof that no Browser effect occurred.

New independent work may proceed only through the existing DevOS scheduler and only after runtime capability compatibility and live transport admission are satisfied. The compatibility layer creates no scheduler, lease, Browser action, release, or production authority.

## Next integration order

1. Wire DB-attested capability output into native supervisor health/status and make the Browser client gate the DevOS physical cycle on it.
2. Feed `devos_recovery_debt_snapshot_v1` into scheduler-capacity/meta pressure so fleet-wide silence plus effect-unknown debt suppresses new physical frontier creation while preserving read-only reconciliation.
3. Add disposable Postgres concurrency tests for capability attestation, recovery-debt classification, leader takeover and ambiguity reconciliation.
4. Add Windows exact-head packaged smoke and physical restart/self-update continuity evidence.
5. Design explicit RLS policies for the 21 flagged tables before any RLS enablement.

No main merge, production DDL, Edge deployment, Browser actuation or release is performed by this checkpoint.
