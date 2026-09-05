# Sovereign Browser Compute Fabric — Foundation V1

## Status

Current-base implementation record for the architecture audit dated 2026-09-04. This slice is additive and authority-poor: it defines the durable causal model, scoped capability contract, BrowserCell isolation model, Guardian A/B recovery plan, verified-release authority gate, useful-work SLOs, and a source-only Postgres ledger pilot. It does **not** execute WTS, SCM, Send, tab creation, installer, release promotion, production DDL, or live ACL mutation.

The target architecture is three authority-separated planes:

1. **Control plane** — desired state, policy, append-only Event/Effect Ledger, deterministic reducers, queue/outbox references, SLOs.
2. **Browser data plane** — replaceable BrowserCells; one high-trust claim per authenticated worker context, isolated ephemeral research contexts, exact target/incarnation binding.
3. **Recovery plane** — minimal Guardian outside Browser lifecycle; owner/session evidence, verified release admission, A/B runtime slots and bounded health/readback. Guardian has no task, prompt, Send, release-publishing, or policy authority.

The durable unit is `effect_id`, not a browser process. The execution unit is a BrowserCell, not a long-lived tab-fleet agent.

## Audit recommendations implemented in this slice

| Audit recommendation | V1 implementation | Safety boundary |
| --- | --- | --- |
| One causal Event/Effect Ledger | `sovereign-effect-ledger.mjs` + `devos_effect_event_v1` pilot | append-only events; deterministic reducer; no live executor |
| Queue carries reference, not authority | `queueEnvelope()` + outbox table containing `effect_id`/correlation only | delivery cannot authorize execution |
| One attempt for non-idempotent effects | reducer rejects a second `ATTEMPT` | `AMBIGUOUS` remains non-retryable |
| Independent readback algebra | `classifyReadback()` | only exact presence or authoritative absence resolves uncertainty |
| Short-lived exact capabilities | `effect-capability.mjs` | audience/subject/device/task/claim/context/target/incarnation/action/deadline/idempotency/policy bound; verifier required |
| BrowserCells | `browser-cell-model.mjs` | one claim per worker cell; isolated partitions; ephemeral research allowlist + TTL; recovery probe has no prompt/Send authority |
| Guardian A/B recovery | `guardian-ab-slot-plan.mjs` | stage inactive, verify provenance/signature/freshness, health challenge, atomic pointer promotion/rollback; no installer retry |
| Authority follows verified release | `verified-release-authority-gate.mjs` | a Git SHA is insufficient; exact immutable artifact/provenance/physical proof required |
| Useful-work SLOs | `sovereign-slo.mjs` | READY→CLAIM, recovery, duplicate effects, ambiguity, drift, traces, branch age |
| Postgres ledger + outbox pilot | source-only migration | RLS forced; service-role only; no `SECURITY DEFINER`; append-only trigger |
| Live legacy RPC drift remediation | guarded scripts under `supabase/ops/security/` | not auto-migrated; direct preflight + explicit session guard + rollback required |
| Current-base owner P0 | separate PR #301 | real Windows runtime proof and level-triggered reconciliation before WTS work |

## Canonical event model

Every physical effect is reconstructed from immutable events with one `effect_id` and ordered `ledger_sequence`:

- `INTENT`: `effect_id`, domain, generation, idempotency key, `plan_digest`, `policy_hash`, immutable plan material. Written before effect authority.
- `CAPABILITY`: signed/verified decision material scoped to exact subject/device/task/claim/context/target/incarnation/action/deadline.
- `ATTEMPT`: actuator identity and one-attempt receipt. Non-idempotent effects may have at most one attempt.
- `READBACK`: independent observation material and evidence digest. Executor self-attestation is not sufficient.
- `OUTCOME`: `CONFIRMED`, `ABSENT_PROVEN`, `CONFLICT`, `CORRUPT`, `AMBIGUOUS`, or `RECONCILE`.
- Projection: deterministic reducer output. Projections are rebuildable caches, never a second authority source.

`AMBIGUOUS` is a state, not a retry policy. A later reconciliation can classify exact positive state or authoritative absence. Queue redelivery, Realtime notifications, process restart, timeout, or controller wake-up do not reopen a non-idempotent effect.

## Capability contract

The minimum capability material is deliberately narrower than a generic bearer token. It binds:

- issuer + audience;
- subject workload + device identity;
- task id + claim generation;
- BrowserContext id;
- target id + target incarnation;
- exact action;
- idempotency key;
- policy hash;
- not-before and expiry;
- bounded restrictions.

The PEP must compare every expected field before calling the actuator and must invoke a cryptographic verifier. Co-location on the same Windows machine is not trust. Queue receipt is not authorization.

A future production implementation can encode the contract as SPIFFE/SVID-derived JWT, Macaroon-like caveats, or another signed capability format, but the engine-neutral material and exact matching rules should remain stable.

## BrowserCell domain model

### Human Cell

Persistent user profile, explicit local-user actions only, never counted as fleet capacity.

### Authenticated Worker Cell

Dedicated persistent partition, exactly one active claim, scoped capability required for authenticated irreversible page effects, exact target/incarnation lifecycle. A cell failure affects at most one claim.

### Ephemeral Research Cell

Fresh non-persistent context per job, network allowlist, read-only effect policy, bounded TTL, destroyed after evidence upload. It is the preferred lane for research/verification that does not need user secrets or authenticated page effects.

### Recovery Probe Cell

Fresh context without user data. Health/version/readback only. It never receives prompt material and has no Send/task authority.

The V1 CDP plan uses `Target.createBrowserContext`, `Target.createTarget`, and `Target.disposeBrowserContext` only for the ephemeral/recovery types. An actual Browser integration follows after this contract is proven against two isolated contexts.

## Guardian recovery microkernel and A/B slots

The Browser process cannot own recovery of the Browser process. Guardian therefore remains outside Browser lifecycle and admits candidates only after independent release evidence is proven.

A candidate must have exact digest+size, provenance, platform/signature evidence, transparency evidence where available, freshness evidence, and rollback protection. It is staged into the inactive slot without overwriting the active slot. Guardian then runs a bounded health challenge that proves runtime identity, durable owner/session identity, and control-plane handshake. Promotion is an atomic active-pointer switch; rollback is a pointer switch to the last-known-good slot. It is never “retry the installer.”

Historical `SUCCESSOR_BOOTED` ambiguity is not rewritten into absence. Recovery reasons about the current bytes/slot/readback only.

## Verified-release authority gate

Integration ancestry is necessary but not sufficient for live authority. Authority advancement is a separate candidate only when an immutable release binds the exact source revision and proves:

- non-draft immutable release identity;
- exact artifact SHA-256 and size;
- verified manifest;
- physical update evidence;
- provenance verification;
- signature verification;
- freshness verification.

The gate itself does not mutate authority. An external authority executor remains responsible for the effect and exact post-effect readback.

## Postgres pilot and strangler migration

The audit recommends Postgres ledger + queue before any Temporal/Kubernetes big bang. V1 follows that path. `devos_effect_event_v1` is append-only and service-role scoped; the delivery outbox carries only `effect_id` and correlation metadata. The projection view is rebuildable.

Existing Browser/Guardian journals are **not deleted** in this slice. They are trusted boundary adapters already protecting physical effects. Migration is one domain at a time:

1. dual-write or import a typed projection into the new event contract without changing the physical effect owner;
2. compare old and new projections and require deterministic equivalence;
3. make ledger intent/capability/readback mandatory while the old journal remains the one-attempt boundary;
4. only after unattended recovery and equivalence evidence, retire redundant snapshots.

This avoids the audit risk “migration doubles state models” becoming permanent split-brain.

## Live SECURITY DEFINER follow-up

A fresh read-only catalog check on 2026-09-05 confirmed that these legacy functions are still `SECURITY DEFINER` and executable through `PUBLIC`:

- `public.devos_transport_promotion_lease_v1(text,text,integer,text,text,integer,integer)`;
- `public.devos_transport_promotion_release_v1(text,text,text)`.

No live ACL was changed. The source tree now contains three explicit change-window artifacts:

- read-only preflight;
- guarded revoke of `PUBLIC`/`anon`/`authenticated` with service-role grant and catalog proof;
- guarded emergency rollback.

The revoke script requires the operator to set `metaengine.promotion_rpc_caller_migration_proven=on` in that session. It must not be run until legacy callers are replaced and smoke-tested. This preserves the audit rule that production DDL/ACL remediation is a separate, reviewable operation.

## SLO contract

The system is not healthy merely because Browser heartbeat is fresh. Foundation V1 encodes the audit outcomes as machine-checkable metrics:

| SLI | Gate |
| --- | --- |
| READY → CLAIM p95 | `< 30 s` with healthy upstream |
| verified recovery | `< 5 min` |
| duplicate irreversible effects | `0` |
| AMBIGUOUS / attempted effect | `< 1%` per domain; every ambiguity has reconciliation owner |
| source ↔ live drift | `< 10 min` |
| integration → verified artifact | `< 30 min` |
| full task→claim→effect→target→release→readback traces | `100%` |
| open PR age p90 | `< 3 days` |
| claims affected by one BrowserCell failure | `<= 1` |

Correlation ids are first-class ledger material so OpenTelemetry trace/span/log context can follow the full causal chain.

## Delivery and governance

The target operating model keeps one active authority-changing PR stack per effect domain. Stale heads are evidence, not merge candidates. Current-base reconstruction and fresh exact-head gates are mandatory after integration moves. Merge queue is desirable once repository rules are configured, but this repository currently does not expose an enforced merge-queue/ruleset through the available automation connection, so V1 does not falsely claim it is enabled.

Branch TTL and patch-equivalence census should be automated as a follow-up repository-maintenance workflow; deletion remains an explicit recoverable action rather than an automatic destructive cleanup.

## Research matrix — primary sources and strong analogs

The implementation was cross-checked against more than twenty independent primary projects/specifications. The conclusion is convergence rather than imitation: small authority surfaces, append-only causal state, exact compare/readback, replaceable execution, and explicit release identity repeatedly outperform implicit “smart retry.”

| Source / analog | Property used | Consequence for METAENGINE |
| --- | --- | --- |
| Kubernetes Controllers — https://kubernetes.io/docs/concepts/architecture/controller/ | desired/current control loops and narrow controllers | level-triggered reducers/controllers; Browser worker does not own desired state |
| Temporal — https://docs.temporal.io/activities | activity retry/re-execution model | do not place non-idempotent Browser effects behind blind workflow retries |
| AWS Builders’ Library — https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/ | explicit idempotency identifiers | idempotency key is intent material, not inferred from transport |
| Supabase Queues — https://supabase.com/docs/guides/queues | durable Postgres delivery + visibility windows | queue is wake-up/delivery, not authority |
| PostgreSQL WAL reliability — https://www.postgresql.org/docs/current/wal-reliability.html | committed transaction durability and WAL flush | use Postgres for causal history instead of inventing another multi-file ledger |
| FoundationDB — https://apple.github.io/foundationdb/developer-guide.html | `commit_unknown_result` can duplicate non-idempotent work | model uncertainty explicitly; reconcile instead of blind replay |
| Consul transactions — https://developer.hashicorp.com/consul/api-docs/txn | CAS and check-not-exists | guarded transitions are explicit preconditions |
| etcd transactions — https://etcd.io/docs/v3.6/learning/api/ | atomic compare/then/else | reducers/authority checks must be one coherent state transition |
| CockroachDB — https://www.cockroachlabs.com/docs/stable/transactions.html | serializable conflicts/retries | conflict is a typed outcome, distinct from effect retry |
| Redis WATCH — https://redis.io/docs/latest/develop/using-commands/transactions/ | conditional execution on unchanged state | optimistic concurrency belongs at commit boundary |
| TUF — https://theupdateframework.io/docs/security/ | rollback/freeze/mix-and-match defense | freshness + rollback protection before A/B admission |
| Uptane — https://uptane.org/docs/latest/standard/uptane-standard | compromise-resistant update/recovery roles | recovery/update authority stays separate from Browser/page authority |
| SLSA — https://slsa.dev/spec/v1.2/ | provenance and hardened build requirements | exact release must carry verifiable provenance |
| in-toto — https://in-toto.io/docs/getting-started/ | signed authorized supply-chain steps/materials/products | bind source→build→release→install as attestable chain |
| Sigstore — https://docs.sigstore.dev/cosign/verifying/verify/ | identity/signature/transparency verification | verify release identity independently from Git ancestry |
| OCI Image Spec — https://specs.opencontainers.org/image-spec/descriptor/ | digest+size content identity | release/artifact identity always includes digest and size |
| Playwright BrowserContext — https://playwright.dev/docs/browser-contexts | cheap isolated cookie/storage/session environments | BrowserCell isolation is a domain invariant |
| Chrome DevTools Protocol Target — https://chromedevtools.github.io/devtools-protocol/tot/Target/ | browser-context and target lifecycle identities | context/target/incarnation become capability bindings |
| NIST SP 800-207 — https://csrc.nist.gov/pubs/sp/800/207/final | no implicit trust from network/location | same-machine processes still need explicit identity and authorization |
| SPIFFE — https://spiffe.io/docs/latest/spiffe-about/overview/ | short-lived cryptographic workload identity | future capability issuer can bind workload/device identity without machine-location trust |
| OPA — https://www.openpolicyagent.org/docs/deploy | PDP/PEP separation | policy decision is distinct from physical actuator enforcement |
| OpenTelemetry — https://opentelemetry.io/docs/concepts/context-propagation/ | context across traces/logs/metrics | one correlation context spans task→claim→effect→readback |
| NixOS — https://nixos.org/manual/nixos/stable/ | generations and rollback | preserve last-known-good immutable runtime generation |
| OSTree — https://ostreedev.github.io/ostree/ | atomic deployment model | stage immutable runtime before switching active reference |
| Mender — https://docs.mender.io/ | A/B / rollback-oriented device updates | candidate health before commit; keep recovery path independent |
| RAUC — https://rauc.readthedocs.io/ | slot state and mark-good/rollback | explicit slot lifecycle/readback, no reinstall-as-recovery |
| DBOS — https://docs.dbos.dev/ | durable workflow/state tied to transactional persistence | future workflows can consume the stable effect abstraction without owning actuator retries |
| Apache Kafka — https://kafka.apache.org/documentation/#semantics | exactly-once scope is bounded to transaction/stream semantics | never infer exactly-once external Browser effects from queue guarantees |
| Google Omaha — https://github.com/google/omaha | updater separated from application UI | Guardian update/recovery remains outside Browser UI authority |

## Rejected shortcuts

- **A second/third ad-hoc effect journal:** increases split-brain risk. New effect domains target the canonical ledger contract; existing journals remain temporary boundary adapters.
- **Big-bang Temporal:** postponed until idempotency/capability/readback contracts are stable and benchmarked.
- **Kubernetes/browser cluster now:** premature operational surface; BrowserContexts give the isolation primitive without introducing a cluster control plane.
- **Automatic retry for Send/install/WTS/SCM/tab creation:** forbidden. Only authoritative `ABSENT_PROVEN` can justify a new effect generation.
- **Queue/Realtime as authority:** forbidden.
- **Git SHA as promotion unit:** insufficient; immutable verified release is the promotion unit.
- **Browser-owned recovery:** recursion; Guardian must be independently recoverable.

## Implementation sequence after this foundation

1. Merge current-base owner enrollment hardening only after exact-head Windows gates (#301).
2. Pilot one existing transport/session effect domain through the new ledger as a strangler projection while retaining its current one-attempt journal boundary.
3. Wire the two-Context BrowserCell pilot and record useful-work latency/blast-radius evidence.
4. Build Guardian A/B staging/health/pointer actuator behind the existing machine-effect journal and verified-release gate; keep planner pure.
5. Introduce a real signed capability issuer/PDP and PEP verification at actuator boundaries.
6. Run the transport-promotion ACL change only in its separate production window after caller migration proof.
7. Add causal OpenTelemetry propagation and SLO dashboard; make useful-work gates release criteria.
8. Add branch TTL / patch-equivalence census and configure repository merge queue/rules once admin controls are available.

## Exit criteria

Foundation V1 is complete when its exact-head contract CI is green and code review confirms no authority-bearing actuator entered these modules. It is **not** evidence that production ledger/BrowserCells/A-B recovery are deployed. Those are separate effect-bearing slices with physical gates and rollback evidence.
