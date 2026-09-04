# METAENGINE Guardian Reconciler Architecture v2

Status: proposed, additive, no runtime authority change.

This ADR defines the next architecture after durable `expected_owner_sid` enrollment. It deliberately does **not** authorize WTS execution, process creation, SCM mutation, Browser/task effects, retry timers, or a second effect journal.

## 1. Problem

Guardian currently has strong local pieces (owner evidence, a pure enrollment planner, typed effect journal, SCM host, session broker), but the pieces should converge on one explicit controller model before session-change execution is enabled.

The principal failure mode to avoid is event-driven imperative orchestration: `event -> immediately execute effect -> retry on error`. That model couples observation, policy, durability and execution; it is especially unsafe when a non-idempotent effect can return an unknown result.

The target model is a **level-triggered reconciler**:

`event -> mark dirty -> read fresh desired state -> read fresh observed state -> pure plan -> typed journal gate -> narrow effect adapter -> exact readback -> reconcile again`

Events are hints that state may have changed. They are not authority and they are not durable truth.

## 2. Non-negotiable invariants

1. **Fresh-state planning.** Every effect plan is derived from a fresh durable desired snapshot and fresh observed snapshot. Event payloads may trigger work but cannot substitute for authoritative reads.
2. **Pure planners.** A planner cannot mutate files, journal, SCM, WTS, Browser state, tasks, processes, timers, or network state.
3. **One execution ledger.** All machine/bootstrap/process effects converge into the existing typed Guardian effect journal. No per-subsystem retry journal and no third execution ledger.
4. **Effect barrier discipline.** Once an adapter may have crossed a non-idempotent effect barrier, a returned error is not proof of `NO_EFFECT`.
5. **Readback before retry.** An ambiguous result must be reconciled against durable/physical state before any later attempt can become eligible.
6. **Identity layering.** Durable owner identity is a Windows SID. Session IDs and PIDs are transient incarnations and must never replace durable identity.
7. **Authority minimization.** Observation, planning, persistence and execution are separate capabilities. Each adapter receives only the authority required for its one domain.
8. **Level-triggered convergence.** Repeating reconciliation against already-correct state yields `NOOP`, not another effect.
9. **No timer-driven replay of ambiguity.** Backoff is permitted only for operations whose previous attempt is proven not to have produced the guarded effect, or whose effect is idempotent by contract.
10. **Transitive artifact identity.** Release pointer, manifest, downloaded bytes and installed executable must remain linked by digest/size/provenance rather than by mutable names alone.

## 3. Common effect outcome algebra

All effect adapters should map native outcomes into one controller-level algebra:

| Outcome | Meaning | Retry eligibility |
| --- | --- | --- |
| `NO_EFFECT_PROVEN` | Readback proves the guarded effect did not occur | Planner may later schedule a new attempt under policy |
| `EFFECT_EXACT` | Readback proves the desired effect is present exactly | Never repeat; converge to `NOOP` |
| `CONFLICT` | A valid but different durable/physical winner exists | Fail closed; explicit policy/replacement protocol required |
| `CORRUPT` | State exists but violates format/security/integrity invariants | Hold; repair through a separately authorized effect |
| `AMBIGUOUS` | Effect may have happened and readback cannot classify it | Hold; never ordinary retry |

Recommended envelope:

```text
{
  domain,
  intent_id,
  desired_generation,
  expected_before,
  effect_identity,
  barrier_crossed,
  native_error,
  observed_after,
  outcome
}
```

`success=true/false` is insufficient for a distributed/durable effect boundary.

## 4. Controller topology

### 4.1 Event ingestion

Sources such as SCM startup, `SERVICE_CONTROL_SESSIONCHANGE`, named-pipe owner evidence, heartbeat drift, update completion and journal state changes enqueue a **reason**, not a command.

`HandlerEx` must remain non-blocking. It records/coalesces a dirty reason and returns. It never calls WTS, launches a process, writes enrollment state, or waits for Browser readiness.

### 4.2 Single coalescing worker

One worker owns reconciliation for a Guardian instance. Multiple equivalent events collapse into one pending reconciliation. The worker must re-read state after every effect/readback transition, so event ordering does not become correctness-critical.

Pseudo-flow:

```text
while dirty:
  dirty = false
  desired = read_desired_authority()
  observed = observe_machine_and_session_state()
  journal = read_typed_effect_journal()
  plan = pure_plan(desired, observed, journal)
  result = execute_at_most_one_guarded_effect(plan)
  if result changed observable state:
      dirty = true
```

“At most one guarded effect” keeps causality auditable and prevents a single stale plan from chaining several physical effects.

### 4.3 Narrow adapters

- `OwnerEvidenceObserver`: named-pipe/impersonation/`TokenUser`; read-only evidence.
- `OwnerEnrollmentStore`: machine-secure create-if-absent durable owner binding; no execution authority.
- `GuardianRootAdapter`: provision/repair `%ProgramData%\METAENGINE\Guardian` only through the existing typed journal.
- `SessionObserver`: enumerate/read sessions; no token acquisition.
- `WtsExecutor`: acquire the token and execute only an already journal-authorized exact intent.
- `ProcessObserver`: validate process incarnation using process handle/creation identity, not PID alone.
- `BrowserObserver`: read heartbeat/readiness only; cannot issue continuity work.
- `ArtifactVerifier`: verify digest, size and provenance before installation/activation.

## 5. Identity model

The controller must not collapse different identity layers:

| Layer | Durable? | Canonical identity |
| --- | --- | --- |
| Device | yes | device key / attested key fingerprint |
| Expected owner | yes | canonical Windows SID |
| Interactive session | no | session ID + owner SID + logon/incarnation evidence |
| Process | no | process handle identity + creation time/image identity |
| Artifact | yes | digest + size + provenance identity |
| Effect intent | yes | domain + intent ID + desired generation + effect identity |

A Windows `session_id` is an observation, not ownership. A PID is an observation, not process identity.

## 6. Retry policy

Retry policy is separate from reconciliation.

- Pure reads: bounded exponential backoff + jitter is allowed.
- Idempotent state application: retry is allowed only by the adapter's explicit idempotency contract.
- Non-idempotent effect before barrier: retry may be allowed if `NO_EFFECT` is proven.
- Non-idempotent effect after/around barrier: classify with readback first.
- `AMBIGUOUS`: no timer retry; remain held until stronger observation resolves the state.
- `CONFLICT`/`CORRUPT`: no automatic retry; route to explicit repair/replacement policy.

## 7. Durable storage threshold

A single immutable create-if-absent owner record is appropriately implemented as a narrow file CAS with security verification and exact readback.

Do **not** proliferate independent mutable JSON/files as Guardian state grows. If the next design requires two or more correlated mutable records to change atomically, migrate that state to a transactional local store (SQLite is the default candidate) rather than inventing cross-file transaction semantics.

The existing typed effect journal remains the execution ledger; a transactional store would be for correlated controller state, not a second effect ledger.

## 8. Supply-chain upgrade

The Browser release chain should evolve from digest-only verification to transitive provenance:

`source revision -> isolated hosted build -> signed provenance -> release descriptor(digest,size) -> downloaded bytes -> installed executable digest -> running process image identity`

Minimum next steps:

- emit SLSA provenance for hosted builds;
- sign/verify release artifacts with Sigstore-compatible bundles or equivalent key-backed signatures;
- preserve digest + size in release descriptors (OCI-style content identity);
- make updater activation depend on provenance verification, not only transport/TLS;
- keep rollback/freeze protection metadata separate from artifact bytes (TUF/Uptane design lesson).

## 9. Observability without authority

Emit structured reconciliation/effect lifecycle events using a stable OpenTelemetry-style schema:

```text
guardian.reconcile.started
guardian.plan.selected
guardian.effect.barrier_crossed
guardian.effect.readback
guardian.effect.outcome
guardian.reconcile.converged
```

Useful attributes: `domain`, `intent_id`, `desired_generation`, `outcome`, `reason`, `native_error`, `latency_ms`, `artifact_digest` (when applicable). Do not emit secrets, access tokens, raw private-key material, or personally unnecessary session data.

Telemetry is an observer. It never authorizes or retries effects.

## 10. Windows-specific trust rules

- Security decisions use opened handles, final-path verification and security descriptors, not pathname strings alone.
- A trusted root must be fenced across the effect boundary against rename/delete TOCTOU.
- `ReplaceIfExists=FALSE` is mandatory for first-writer-wins owner enrollment.
- `FILE_FLAG_WRITE_THROUGH` + explicit `FlushFileBuffers` improves persistence, but durable success is still gated by exact readback.
- Any rename/commit error after the effect barrier must reconcile the final record before returning `NO_EFFECT`.
- A post-barrier readback failure is `AMBIGUOUS`, not ordinary `FAILED`.

## 11. Branch/PR development conveyor

The repository has a large divergent branch population, so architecture work must avoid wholesale merges of old product branches.

Every development slice should record:

- exact base SHA;
- authority-impact set;
- intended files/domains;
- diff budget;
- exact-head CI gates;
- whether the branch is additive, reconstructive, or superseding.

Old divergent branches should be selectively reconstructed onto current integration, then explicitly marked superseded/closed. This prevents architecture from becoming encoded in historical merge topology.

## 12. Sequenced implementation plan

| Priority | Slice | Exit condition |
| --- | --- | --- |
| P0-A | Durable owner CAS | all post-barrier failures read back; runtime Windows CAS tests green; no ambiguity retry |
| P0-B | Guardian root provision/repair | typed existing-journal machine-state effect; DACL/owner/final-path readback |
| P0-C | SCM owner-enrollment wiring | evidence -> pure plan -> store; still no WTS/process effect |
| P0-D | Session reconciliation | non-blocking `HandlerEx` + startup reconciliation -> single coalescing worker |
| P0-E | WTS execution | exactly one journal-gated attempt for exact ACTIVE session whose SID matches durable owner; readback-driven outcome |
| P1 | Shared Win32 trust primitives | extract reusable handle/final-path/owner/DACL/reparse helpers after P0 store settles |
| P1 | Unified effect outcome contract | all adapters expose `NO_EFFECT_PROVEN/EFFECT_EXACT/CONFLICT/CORRUPT/AMBIGUOUS` |
| P1 | Provenance chain | SLSA + signature/transparency verification + digest/size activation gate |
| P1 | Reconcile telemetry | stable OTel event schema; zero authority |
| P2 | Explicit owner replacement | fenced/monotonic replacement protocol; never implicit overwrite |
| P2 | Device attestation | TPM/CNG-backed device identity if threat model justifies it |
| P2 | Model checking | property/state-machine tests for crash/reorder/concurrent-writer cases; consider TLA+ for replacement/session protocol |

## 13. Research matrix (30+ primary analogs/sources)

The design above was checked against primary documentation rather than secondary summaries.

| System/source | Adopt | Avoid / boundary |
| --- | --- | --- |
| Microsoft `CreateFile` / `FILE_FLAG_WRITE_THROUGH` | explicit persistence semantics | treating a normal successful write as crash-durable proof |
| Microsoft `FlushFileBuffers` | explicit buffer flush | using flush as substitute for post-effect readback |
| Microsoft `FILE_RENAME_INFO` | fail-if-exists rename semantics | overwrite for owner enrollment |
| Microsoft `GetFinalPathNameByHandle` | verify resolved object identity | pathname-only trust |
| Microsoft `GetSecurityInfo` | owner/DACL from handles | inferred ACL trust |
| SQLite atomic commit | journal/transaction boundary discipline | ad-hoc multi-file transactions |
| FoundationDB | explicit unknown-commit semantics | blind retry after unknown result |
| CockroachDB | ambiguous-result classification | assuming client error means transaction did not commit |
| etcd transactions | compare -> then/else CAS | read-then-write without atomic guard |
| Consul transactions | atomic conditional multi-op state | partial multi-key mutation |
| Redis WATCH/CAS | optimistic compare-and-set | overwrite without version/condition |
| Kubernetes controllers | desired/observed reconciliation | imperative event handlers as truth |
| Argo CD | drift/self-heal as reconciliation | repeated effects for already-synced state |
| Flux | separate reconcile interval and retry interval | conflating observation cadence with retry authority |
| AWS Systems Manager State Manager | declared desired state + compliance | treating telemetry/compliance as write authority |
| NixOS generations | explicit generations/rollback | in-place mutable deployment without recoverable identity |
| Docker restart policy | bounded policy choices | hidden infinite retry defaults |
| Nomad restart/reschedule policy | explicit attempts/window/backoff | unbudgeted restart storms |
| Fly Machines | bounded `max_retries` | infinite generic restart for all failure classes |
| DBOS | atomic durability record with DB transaction | claiming exactly-once for external side effects without atomic record |
| Cadence | durable workflow history + explicit retry policy | retries without side-effect idempotency analysis |
| Dapr Workflow | durable workflow/retry state | transient in-memory retry ownership |
| ZooKeeper recipes | versioned/fenced coordination | identity-free lock/retry semantics |
| TUF | separated update roles, freshness/rollback resistance | trusting mutable latest pointers alone |
| Uptane | compromise resilience / split trust | single compromised update authority controlling everything |
| Sigstore/Rekor | signed artifact identity + transparency | digest with no signer/provenance identity |
| SLSA | build provenance and isolation | trusting release artifact without builder provenance |
| in-toto | transitive step attestations | disconnected stage-local checks |
| OCI descriptors | digest + size content identity | mutable filename as artifact identity |
| OpenTelemetry | stable semantic events/attributes | telemetry as execution authority |
| SPIFFE/SPIRE | attested workload identity separation | session/process IDs as durable identity |
| Litestream | explicit durability/replication boundary lessons | confusing replica/telemetry with primary authority |
| Chromium/Omaha updater | updater protocol separation, integrity checks | unlimited retries for non-idempotent local effects |

Primary references:

- https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew
- https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers
- https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_rename_info
- https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfinalpathnamebyhandlew
- https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo
- https://www.sqlite.org/atomiccommit.html
- https://apple.github.io/foundationdb/developer-guide.html
- https://www.cockroachlabs.com/docs/stable/transaction-retry-error-reference.html
- https://etcd.io/docs/v3.6/learning/api/
- https://developer.hashicorp.com/consul/api-docs/txn
- https://redis.io/docs/latest/develop/using-commands/transactions/
- https://kubernetes.io/docs/concepts/architecture/controller/
- https://argo-cd.readthedocs.io/en/stable/user-guide/auto_sync/
- https://fluxcd.io/flux/components/kustomize/kustomizations/
- https://docs.aws.amazon.com/systems-manager/latest/userguide/state-manager-about.html
- https://wiki.nixos.org/wiki/NixOS
- https://docs.docker.com/reference/cli/docker/container/run/
- https://developer.hashicorp.com/nomad/docs/job-declare/failure/restart
- https://fly.io/docs/machines/guides-examples/machine-restart-policy/
- https://docs.dbos.dev/golang/tutorials/transaction-tutorial
- https://cadenceworkflow.io/docs/concepts/activities
- https://docs.dapr.io/developing-applications/building-blocks/workflow/workflow-features-concepts/
- https://zookeeper.apache.org/doc/current/recipes.html
- https://theupdateframework.io/docs/metadata/
- https://uptane.org/docs/latest/standard/uptane-standard
- https://docs.sigstore.dev/
- https://slsa.dev/spec/v1.2-rc1/build-requirements
- https://in-toto.io/docs/getting-started/
- https://specs.opencontainers.org/image-spec/descriptor/?v=v1.1.0
- https://opentelemetry.io/docs/specs/semconv/general/events/
- https://spiffe.io/docs/latest/deploying/svids/
- https://litestream.io/
- https://chromium.googlesource.com/chromium/src/+/main/docs/updater/protocol_4.md

## 14. Decision

Adopt a single level-triggered Guardian reconciler with pure planners, narrow authority adapters, one typed effect ledger, explicit effect-outcome algebra, and readback-driven recovery. Complete durable owner enrollment before enabling session/WTS execution. Treat ambiguity as durable control state, not as a transient exception to be retried.
