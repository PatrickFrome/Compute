# A2 Browser R13 — Trace Replay — Post-Implementation Research

Date: 2026-08-29
Parent authoritative milestone: R12 `2c61104b7eb27e56c9955e602f12bc6b2ea68302`
Initial implementation head: `cec67a9cfc0d0ad52ae747fbe96c3e59e39cf368`
Initial workflow: `33237709610` SUCCESS

## Result

R13 implements a pure deterministic trace recorder/verifier. It binds a trace id and source commit, enforces causal parent ordering, hash-chains every event, permits only one terminal assignment per subject, requires prior effect intent for effectful terminal outcomes, and preserves `AMBIGUOUS` exactly as recorded.

The replay API has no actuator callback and imports no browser, network, process, model, or remote transport capability. Its output is a derived verification summary only.

## Primary-source re-check

OpenTelemetry defines traces as causally related spans with parent relations and explicit links for related work. R13 adopts the structural lesson—explicit causal references and stable trace identity—but uses a smaller security-specific event schema whose events are additionally hash chained.

Playwright tracing records browser operations, DOM snapshots, screenshots and network activity and is explicitly useful for debugging after execution. R13 treats such rich traces as optional evidence references rather than an execution program. Browser observations may inform an `evidence_digest`; replay never turns them into another browser action.

Temporal demonstrates the reliability value of rebuilding workflow state from persisted history after failures. R13 intentionally stops short of general workflow re-execution: Browser Operator external effects are not assumed deterministic or idempotent, so replay verifies the recorded history without reissuing them.

## Verification result

The first exact implementation gate passed:
- exact R12 ancestry;
- zero source dependency packages;
- static zero-effect checks;
- R13 adversarial tests;
- R12/R11/R10/R9/R8 regression fence;
- deterministic evidence build;
- provenance attestation.

Adversarial coverage confirms:
- future/missing causal parents fail closed;
- tampered evidence/hash chain is rejected;
- source-commit switching inside a trace is rejected;
- non-terminal outcome smuggling is rejected;
- a subject cannot receive two terminal outcomes;
- effectful terminal outcomes require a prior effect intent;
- `ABORTED` may terminate before effect intent;
- `AMBIGUOUS` survives verification unchanged;
- trace envelopes cannot claim actuation, authority effect, or replay execution.

## Confirmed invariants

- `TRACE_REPLAY_NEVER_EXECUTES_EFFECTS`.
- `TRACE_EVENTS_ARE_HASH_CHAINED`.
- `CAUSAL_PARENTS_MUST_PRECEDE_CHILDREN`.
- `SOURCE_COMMIT_IS_TRACE_BOUND`.
- `TERMINAL_OUTCOME_IS_SINGLE_ASSIGNMENT`.
- `AMBIGUITY_IS_PRESERVED_DURING_REPLAY`.
- `REPLAY_OUTPUT_IS_DERIVED_ONLY`.
- `TRACE_CORE_HAS_ZERO_BROWSER_NETWORK_PROCESS_MODEL_AUTHORITY`.

## Explicit non-claims

R13 does not reproduce arbitrary webpage state, external network responses, or model generations. It does not convert historical `COMMITTED` into an exactly-once page-effect claim, and it never retries historical `NO_EFFECT` or `AMBIGUOUS` operations.

## R14 handoff

R14 should benchmark the already-built Browser Operator contracts without creating a new authority plane. Benchmarks must bind fixture version and source commit, separate correctness from throughput, measure percentiles rather than only averages, include adverse/ambiguous cases, retain deterministic machine-readable results, and never let a faster-but-unsafe implementation win merely on latency.
