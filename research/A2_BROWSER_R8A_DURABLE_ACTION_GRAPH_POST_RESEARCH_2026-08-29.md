# A2 Browser R8A — Durable Action Graph — Post-Implementation Research

Date: 2026-08-29
Parent verified: R7M `e4da88a5c79d3e0c4f86c5378c5bfa19a93973cb`
Candidate implementation head before this seal: `cb2e633e625c5d2168deb5bff2406886a97ff307`
Candidate CI: `33232435884` — SUCCESS

## Measured result

R8A now has an append-only causal action graph with a durable JSONL journal and compact head receipt.

Exact candidate proof on Linux x86_64 / Node `v22.23.2`:

- R8A positive/negative/adversarial/real-filesystem tests: **14/14 PASS**;
- inherited R7M Node/package/registry regressions: **24/24 PASS**;
- inherited native R7 Rust suite: **PASS**, including helper protocol, cardinality, executable identity, helper process, positive seccomp allowlist, pre-exec launcher, Landlock and source confinement;
- 128 declared actions -> 128 events -> **67,476 bytes** journal;
- no dependency manifest or lockfile change;
- Sigstore provenance created for candidate tar `sha256:09baf0699b070a1dd7b8cf5b5cdf516f1855a6e719e8e2a6061b13cd7a04506b`;
- candidate artifact `9708900397`, ZIP digest `sha256:afbce77ab798ae210611dbbd9f38d0022a09a4df4ec1a52035f2aec48d6c8708`;
- candidate attestation `43805444`, Rekor log index `2632688804`.

The first CI run found a Node API misuse, not a durability-model failure: `Array.map(structuredClone)` passes the array index as the second argument, which Node interprets as `StructuredSerializeOptions`. The fix made the clone callback unary. No graph transition or authority invariant was changed.

A post-code audit also hardened a real crash-consistency edge: any journal open/write/fsync ambiguity now poisons the live store and requires reopen instead of allowing later mutations to proceed from uncertain durable state.

## Did the pre-research assumptions hold?

Yes.

### Append-only history was the right minimal source of truth

The hash-chained journal gave deterministic restart reconstruction and made corruption/truncation directly testable. A mutable-only snapshot would not preserve enough evidence to distinguish declaration, pre-effect sealing and ambiguous resolution.

### Durable history must not be replay authority

The implementation and tests preserve `authority_effect=false` and `actuation_eligible=false` for snapshots and receipts. `EFFECT_INTENT_SEALED` returns `fresh_authority_required=true`. `AMBIGUOUS` is terminal and has no retry transition.

This remains stricter than generic durable-workflow replay semantics for browser physical effects. Azure Durable Task documents event-sourced orchestrator replay and at-least-once activity execution; that is useful for durable computation, but an at-least-once browser click would be unsafe. AWS Step Functions Standard demonstrates the value of durable, auditable, exactly-once workflow transitions for non-idempotent work, yet browser-local target/actionability authority must still be freshly established at the effect boundary.

Primary sources:
- https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-orchestrations
- https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-types-features-overview
- https://docs.aws.amazon.com/step-functions/latest/dg/choosing-workflow-type.html

## Durability comparison after real implementation

### SQLite atomic-commit model

SQLite's durability documentation reinforces two R8A choices:

1. flushing file content alone is not the entire namespace durability story;
2. directory synchronization matters when durable files are created/renamed.

R8A performs file `sync()` on every appended journal event, then fsyncs the temporary head file, atomically renames it, and synchronizes the containing directory. The stale-head recovery test also proves the intended crash window: if journal history is durable but the compact head lags, reopen may advance the head only after validating the complete hash-chain suffix.

SQLite also explicitly warns that `fsync()` guarantees ultimately depend on the operating system, filesystem and storage device actually honoring synchronization requests. R8A therefore does **not** claim hardware-level exactly-once persistence under dishonest/broken storage.

Primary sources:
- https://www.sqlite.org/howtocorrupt.html
- https://www.sqlite.org/lockingv3.html
- https://www.sqlite.org/wal.html
- https://nodejs.org/api/fs.html#filehandlesync

### External workflow engines

Temporal/Azure/AWS remain useful analogues for later distributed durability, retention and operator-visible histories. They are still the wrong dependency for this first action model because:

- they enlarge the control plane and operational TCB;
- activity/integration retry semantics do not remove the need for browser-specific ambiguous-effect handling;
- R8A currently needs only single-host causal persistence and authority separation.

No new service or package is justified yet.

## What the tests changed in the architecture understanding

1. **Prepared events are an input boundary too.** Public `acceptPrepared()` now runs the same strict event-shape/hash verifier as disk replay; a caller cannot forge a correctly sequenced but incorrectly hashed event or smuggle extra payload fields.
2. **Any durable-write ambiguity poisons the instance.** Head failure was already treated this way; journal I/O ambiguity now follows the same rule.
3. **A stale compact head is recoverable, but a future/ahead head is not.** The journal is authoritative history; the head is an integrity/readback receipt.
4. **The local format is compact enough for the current bounded scope.** 128 declaration events use 67,476 bytes, well under the 256 KiB benchmark gate and far below the 32 MiB journal bound.

## Residual limitations / explicit non-claims

- no distributed or multi-process writer coordination;
- no malicious-parent-directory protection for the journal root itself;
- no automatic compaction/retention/GC yet;
- no hardware-level durability guarantee beyond OS/filesystem/device sync semantics;
- no browser actuator integration in R8A;
- no exactly-once claim for physical browser effects;
- no automatic recovery/retry from `AMBIGUOUS`;
- no payload or typed-text persistence by design.

A failed head temp-file write can leave an unreferenced random `.tmp` file; the store is poisoned and correctness is preserved, but cleanup/GC can be hardened later if operational evidence shows accumulation. This is a liveness/housekeeping issue, not an authority or history-integrity bypass.

## Comparison with best analogues

| System | Strong idea adopted | Unsafe/expensive idea not adopted yet |
|---|---|---|
| SQLite | append/journal durability, fsync discipline, directory sync, recovery from durable log | full SQL/storage engine dependency |
| Temporal | durable event history reconstructs state | treating replayed activity intent as browser authority |
| Azure Durable Task | deterministic event-sourced orchestration | at-least-once external activity semantics for physical browser effects |
| AWS Step Functions Standard | durable auditable transitions for non-idempotent work | remote workflow service dependency for local browser action state |
| Playwright | each physical action requires current target/actionability | caching historical graph state as current actionability proof |

## Decision after implementation

Keep R8A implementation. No architectural rewrite is justified.

The next highest-value R8 slice is **R8B_ACTION_GRAPH_ACTUATION_FENCE_V1**:

- integrate R8A with exactly one existing typed browser-effect boundary first;
- require `EFFECT_INTENT_SEALED` to be durably persisted before the actuator may run;
- actuator must independently perform its existing fresh target/document/lease/actionability checks;
- after a definite observed effect, append `ACTION_COMMITTED`;
- after an ambiguous transport/process boundary, append `ACTION_AMBIGUOUS`;
- never map an old sealed event directly to a retry;
- keep payload/text/secrets out of the graph;
- test crash windows with a fake actuator first, then one real Chrome action in a controlled local page;
- preserve R7 skill runtime as read-only and authority-free.

This yields more roadmap gain than adding graph compaction now: it proves the central R8 invariant at the actual effect boundary while keeping the integration slice auditable.

## Final seal requirement

This document changes the candidate head. R8A must therefore run the complete workflow again on the documentation-bound exact SHA before Supabase promotion. The previous `cb2e633e...` run is candidate evidence only, not the final VERIFIED checkpoint.
