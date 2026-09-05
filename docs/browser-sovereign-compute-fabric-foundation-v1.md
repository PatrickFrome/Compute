# METAENGINE Browser Sovereign Compute Fabric Foundation V1

## Status

Executable architecture foundation for the 2026-09-04 Browser / DevOS architecture audit. This is a development/integration slice only. It deliberately does **not** perform Browser Send, task claim, WTS/SCM actuation, installer/relaunch, live authority promotion, live Supabase DDL/ACL mutation, release publication, branch deletion, or production promotion.

The migration principle is a strangler: preserve proven domain journals and physical gates while introducing an engine-neutral causal contract around them. No existing no-replay boundary is replaced by a workflow engine or queue.

## Audit recommendations translated to code

| Audit recommendation | Foundation implementation | Authority boundary |
| --- | --- | --- |
| One append-only Event/Effect Ledger | `browser-fabric-effect-ledger.mjs` + staging-only `sql/browser_fabric_event_effect_ledger_pilot_v1.sql` | reducer only; existing domain journals remain physical-effect boundary |
| Queue carries references, never authority | ledger contract + atomic outbox pilot | outbox payload is `effect_id/event_id/event_sha256`; queue/Reatime authority is false |
| Scoped capabilities / PDP-PEP | `browser-fabric-capability.mjs` | Ed25519 verification at PEP; no private signing key in Browser runtime |
| BrowserCells replace shared tab-fleet | `browser-fabric-browser-cell.mjs` + `browser-fabric-cell-fleet.mjs` | one claim/cell; unique context; unique worker partition; low-trust lanes cannot Send |
| Independent Guardian recovery plane | `browser-fabric-guardian-recovery-plan.mjs` | A/B candidate planner only; all effects still journal-gated |
| Authority only follows a verified immutable artifact | `browser-fabric-release-authority-gate.mjs` | positive result is a candidate, not mutation authority |
| Useful-work/recovery SLOs | `browser-fabric-slo.mjs` | heartbeat explicitly cannot prove fleet health |
| Causal tracing | `browser-fabric-trace-context.mjs` | W3C trace identity + causal IDs only; no prompt/credentials/baggage |
| Branch TTL / one PR per effect domain / patch equivalence | `browser-fabric-governance.mjs` | recommendations only; no GitHub mutation |
| PUBLIC SECURITY DEFINER remediation | `sql/browser_fabric_transport_promotion_acl_dry_run_v1.sql` | rollback-only dry-run source plan; no production DDL |

## Canonical causal protocol

For every irreversible or externally visible effect:

1. `INTENT` records immutable `effect_id`, idempotency key, generation, plan digest and policy hash before authority exists.
2. A Policy Decision Point mints a short-lived signed capability bound to subject/device, task, claim generation, BrowserContext, exact target incarnation, action, deadline, idempotency key, policy hash and plan digest.
3. The local Policy Enforcement Point verifies signature, audience, expiry and every exact binding. Queue delivery is not evidence of authorization.
4. Exactly one `ATTEMPT` is admissible for the effect identity.
5. An independent observer records one or more `READBACK` events. The actuator cannot self-attest a positive outcome.
6. `CONFIRMED` and `ABSENT_PROVEN` require an exact readback digest. `AMBIGUOUS` is a terminal reconciliation state and never an automatic retry input.
7. The deterministic reducer rebuilds the projection. Projection state never outranks the append-only event material.

This contract intentionally stays engine-neutral. A future Temporal/Dapr/Cadence evaluation can orchestrate the protocol, but cannot weaken one-attempt or independent-readback semantics.

## BrowserCell model

The durable unit is the claim/effect identity; the Browser process/context is replaceable execution state.

- **Human Cell:** persistent human profile, explicitly excluded from fleet capacity.
- **Authenticated Worker Cell:** its own persistent partition, one claim, exact target/incarnation, scoped capability required.
- **Ephemeral Research Cell:** non-persistent isolated context, no user data or prompt access, read-only network allowlist, destroyed after evidence upload.
- **Recovery Probe Cell:** no user data, no Send, only health/version/owner-session/target readback actions.

Cross-cell admission rejects duplicated BrowserContext IDs and duplicated worker partitions. The two-cell pilot therefore has an executable no-shared-state invariant before runtime creation is wired.

## Guardian recovery model

Guardian is modeled as an effect-poor OS-managed recovery microkernel. The planner requires:

- a verified immutable release bound to exact source SHA and Browser EXE digest;
- platform signature, provenance and rollback/freshness proof;
- exactly two slots A/B;
- staging to the inactive slot without changing the active pointer;
- independent health challenge plus owner/session and control-plane handshake;
- atomic pointer promotion with the prior slot retained for rollback;
- no reinterpretation of historical `SUCCESSOR_BOOTED` as `NO_EFFECT` and no installer retry after ambiguity.

Guardian never gains task selection, prompt, page/model text, Send, policy, or release-publication authority.

## Release and authority gate

A Git SHA alone is no longer a promotion unit. A positive authority candidate requires all of:

- existing `metaengine.trusted-dev-release.v1` exact source/tag/assets evidence;
- installed executable SHA-256 binding;
- immutable release evidence: locked tag, locked assets and verified release attestation;
- trusted provenance whose source SHA and artifact subject digest exactly match the candidate.

Even then, the module emits `AUTHORITY_ADVANCE_CANDIDATE`; a separate typed journaled promotion effect is still required.

## Postgres/outbox pilot

`sql/browser_fabric_event_effect_ledger_pilot_v1.sql` is intentionally outside `supabase/migrations`.

The pilot provides:

- append-only event rows with immutable event/effect identities;
- unique INTENT/CAPABILITY/ATTEMPT/OUTCOME per effect;
- multiple READBACK rows for reconciliation without replay;
- update/delete denial via trigger;
- atomic outbox insertion in the same database transaction;
- no PUBLIC/anon/authenticated mutation grants;
- no default general-purpose `service_role` write grant.

A development database branch must prove reducer replay, append-only behavior, event+outbox atomicity and parity with existing domain journals before any migration is promoted.

## Live ACL finding and remediation boundary

Read-only live catalog inspection on 2026-09-05 found exactly two `public.SECURITY DEFINER` functions with PUBLIC EXECUTE among the Browser/DevOS control functions inspected:

- `devos_transport_promotion_lease_v1(uuid,text,text,text,text,bigint)`
- `devos_transport_promotion_release_v1(uuid,text,uuid,text,text,text,bigint)`

The checked public schema grants PUBLIC/anon/authenticated USAGE but not CREATE, and the two functions are owned by `postgres`. The rollback-only SQL plan proves the exact intended ACL transition to `service_role` without committing it. A real revoke remains a separate production change window after staging caller proof, direct-connection smoke tests, rollback review and a fresh Supabase security-advisor read.

## SLO contract

System health is evaluated by outcomes rather than process heartbeat:

- READY → CLAIM p95 < 30 s when upstream is healthy;
- mean time to verified recovery < 5 min;
- duplicate irreversible effects = 0;
- AMBIGUOUS / attempted < 1% per domain and 100% have a reconcile owner;
- affected claims per BrowserCell failure <= 1;
- source ↔ live semantic/ACL drift p95 < 10 min;
- integration → verified artifact p95 < 30 min;
- full causal-chain coverage = 100%;
- open-PR age p90 < 3 days.

A fresh heartbeat is deliberately ignored by the health decision.

## GitHub merge-queue constraint

The audit recommendation to use GitHub Merge Queue is sound, but the current repository is owned by a personal GitHub account (`owner.type=User`). GitHub documents native merge queues for organization-owned public repositories and eligible organization private repositories. Therefore this repository cannot honestly claim the native merge-queue gate today.

V1 implements the parts that are enforceable in code: latest-base evidence requirement, branch TTL census, patch-equivalence census, and at most one authority-changing PR per effect domain. The structural fix is to move the repository to an eligible organization or adopt an independently audited serial merge-admission service; a concurrency-only Actions job is **not** treated as equivalent to a real merge queue.

## Research synthesis: 23 primary-source sites / analog families

The research intentionally spans storage, reconciliation, durable execution, identity/policy, browser isolation, observability and supply-chain recovery rather than copying one orchestration product.

1. **Supabase Queues / PGMQ** — durable Postgres-native delivery and visibility windows. Consequence: queue is transport, not authority.  
   https://supabase.com/docs/guides/queues
2. **Supabase Realtime** — WAL/change notifications are wake-ups and have scaling/order constraints. Consequence: reconciliation must not depend on notifications being the only scheduler path.  
   https://supabase.com/docs/guides/realtime/postgres-changes
3. **Open Policy Agent** — explicit PDP and application PEP split; local policy decisions reduce latency/failure surface. Consequence: capability minting and enforcement stay separate.  
   https://www.openpolicyagent.org/docs/deploy
4. **SPIFFE** — workload identity and short-lived verifiable SVIDs. Consequence: process/device identity is explicit, not inferred from co-location.  
   https://spiffe.io/docs/latest/deploying/svids/
5. **NIST SP 800-207** — no implicit trust from physical/network location; authenticate subject and device. Consequence: local Browser/Guardian IPC is still zero-trust.  
   https://csrc.nist.gov/pubs/sp/800/207/final
6. **Playwright BrowserContext** — independent isolated browser sessions; non-persistent contexts do not write browsing data to disk. Consequence: BrowserContext becomes a domain isolation boundary.  
   https://playwright.dev/docs/api/class-browsercontext
7. **OpenTelemetry** — context propagation correlates traces/logs/metrics across process boundaries. Consequence: every effect carries causal trace identity without sensitive baggage.  
   https://opentelemetry.io/docs/concepts/context-propagation/
8. **The Update Framework** — root/targets/snapshot/timestamp role separation; target hashes/sizes. Consequence: release freshness/rollback/mix-and-match protection belongs outside Browser lifecycle.  
   https://theupdateframework.io/docs/metadata/
9. **SLSA** — verifiable build provenance and trusted builders. Consequence: authority promotion binds exact source to exact artifact provenance.  
   https://slsa.dev/spec/v1.1/
10. **Sigstore/Cosign** — identity-bound artifact signatures and transparency evidence. Consequence: platform/release verification can be independently audited.  
    https://docs.sigstore.dev/cosign/verifying/verify/
11. **in-toto** — signed layout plus step/link metadata. Consequence: release/build/install transitions remain typed attestable steps.  
    https://in-toto.io/docs/getting-started/
12. **GitHub Immutable Releases** — tags/assets lock after publication and release attestations bind tag/commit/assets. Consequence: immutable verified release, not raw SHA, is the promotion unit.  
    https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases
13. **GitHub Merge Queue** — serial compatibility testing against queued changes. Consequence: use it after repository ownership permits it; do not fake equivalence with a loose CI concurrency group.  
    https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue
14. **AWS Builders' Library** — retries are safe only with explicit idempotent semantics/client request identity. Consequence: non-idempotent Browser/WTS/installer effects never receive generic retries.  
    https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/
15. **FoundationDB** — `commit_unknown_result` means the client cannot know whether commit happened. Consequence: ambiguous outcomes reconcile durable state instead of inferring success or repeating blindly.  
    https://apple.github.io/foundationdb/developer-guide.html
16. **SQLite atomic commit** — complete durable state transition or rollback even through failure. Consequence: if correlated mutable Guardian state grows, use a real transactional store rather than custom multi-file choreography.  
    https://www.sqlite.org/atomiccommit.html
17. **CockroachDB** — serializable transactions and explicit retry/conflict semantics. Consequence: persistence conflicts are first-class states, separate from effect replay.  
    https://www.cockroachlabs.com/docs/stable/developer-basics.html
18. **Redis SET NX** — conditional create-if-absent primitive. Consequence: CAS ownership remains OS/database-enforced rather than precheck-then-overwrite.  
    https://redis.io/docs/latest/commands/set/
19. **Debezium Outbox Event Router** — atomically persist internal state and outbound event intent to avoid dual-write inconsistency. Consequence: Postgres ledger and delivery outbox share one transaction.  
    https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html
20. **Dapr Workflow** — durable histories and recoverable workflow execution, but workflow retries are a policy feature. Consequence: a future engine may orchestrate but must inherit METAENGINE one-attempt physical-effect semantics.  
    https://docs.dapr.io/developing-applications/building-blocks/workflow/workflow-overview/
21. **Cadence** — workflow state survives process/infrastructure failure. Consequence: continuity belongs to durable history, not one Browser process.  
    https://cadenceworkflow.io/docs/concepts/workflows
22. **Argo CD** — continuously compares declared desired state and live state. Consequence: recovery and deployment are level-triggered reconciliation, not a chain of callback ownership.  
    https://argo-cd.readthedocs.io/en/stable/user-guide/auto_sync/
23. **OSTree** — atomic transitions between bootable deployments: old or new after crash/power loss. Consequence: A/B Browser slots promote an already prepared deployment rather than rerunning an installer.  
    https://ostreedev.github.io/ostree/atomic-upgrades/
24. **NixOS generations** — immutable generations and explicit rollback. Consequence: retain last-known-good Browser slot and make rollback pointer-based.  
    https://wiki.nixos.org/wiki/NixOS
25. **Microsoft WTSQueryUserToken** — highly trusted LocalSystem-only session token acquisition with strict token handling. Consequence: WTS stays a narrow Guardian actuator behind durable owner/capability/journal gates.  
    https://learn.microsoft.com/windows/win32/api/wtsapi32/nf-wtsapi32-wtsqueryusertoken

This exceeds the requested twenty-source floor while keeping every architectural conclusion tied to a concrete METAENGINE boundary.

## What V1 explicitly does not pretend to finish

- It does not apply the ledger DDL to production.
- It does not revoke live PUBLIC EXECUTE yet; the report itself requires a separate production change window.
- It does not enable GitHub native Merge Queue because the repository is not organization-owned.
- It does not create BrowserContexts or two physical BrowserCells yet; it creates the admission/isolation contract that the physical pilot must satisfy.
- It does not perform A/B promotion or rollback; it produces exact journal-gated candidates.
- It does not replace existing Guardian/Send/self-update journals in one big-bang migration.
- It does not adopt Temporal/Dapr/Cadence before the engine-neutral effect contract and benchmark exist.

Those are not omitted recommendations; they are the safety gates required by the recommendation itself.

## Next executable slices after this foundation

1. Merge/reconcile the owner-enrollment readback classifier after its physical Self Update gate is green.
2. Wire durable owner readback into the existing bounded Session Broker controller and existing typed Guardian journal; one exact WTS attempt only.
3. Apply the ledger/outbox SQL to an isolated Supabase development branch, replay transport/session history and compare reducer projections with the existing journals.
4. Add a real two-BrowserContext pilot that proves distinct storage partitions, one claim per cell, teardown and affected-claim blast radius <= 1.
5. Wire the release-authority gate into the development authority publisher after GitHub immutable release evidence is available.
6. Run the rollback-only ACL dry-run through a direct connection; schedule the live revoke only after service-role caller smoke proof and rollback approval.
