# A2 Browser R13 — Trace Replay — Pre-Implementation Research

Date: 2026-08-29
Parent authoritative milestone: R12 `2c61104b7eb27e56c9955e602f12bc6b2ea68302`
Roadmap milestone: `R13_TRACE_REPLAY_V1`

## Goal

Create a deterministic, audit-oriented replay format for Browser Operator history without re-executing browser/network/process/model side effects.

R13 must bind:
- source commit;
- trace id and ordered event ids;
- causal parent references;
- evidence digests rather than raw unbounded payloads;
- effect-intent observations;
- terminal action outcomes;
- a hash chain covering every replay event.

Replay is verification, not re-execution.

## Research findings

OpenTelemetry models a trace as causally related spans/events with immutable identifying context and explicit links. This supports A2's need for ordered causal references and compact evidence pointers, while A2 uses a stricter security-specific event schema rather than adopting arbitrary telemetry as authority.

Playwright trace recording demonstrates the operational value of preserving action chronology, DOM snapshots and network observations for debugging. R13 deliberately does not treat Playwright trace playback as an execution primitive; browser traces may be referenced as evidence only.

Event-sourced/deterministic workflow systems separate recorded history from side-effect execution. A replay interpreter should rebuild deterministic state from history while treating previously executed effects as observations. This matches R8's rule that ambiguous or externally visible effects are never blindly replayed.

## Architecture decision

R13 introduces a pure trace recorder/verifier with no injected actuator callback and no browser/network/process/model imports.

Canonical event types:
- `DECISION_RECORDED`;
- `EFFECT_INTENT_RECORDED`;
- `EFFECT_OBSERVATION_RECORDED`;
- `TERMINAL_RECORDED`.

Each event contains a bounded identity, subject id, causal parents, an evidence digest, global `prev_hash`, and `event_hash`. Only terminal events carry an outcome.

Terminal outcomes:
- `COMMITTED`;
- `NO_EFFECT`;
- `AMBIGUOUS`;
- `ABORTED`.

For `COMMITTED`, `NO_EFFECT`, or `AMBIGUOUS`, a prior effect intent for the same subject must exist. `ABORTED` may terminate before effect intent.

## Security properties

- Replay has no effect callback and cannot dispatch browser/network/process/model work.
- Parents must already exist; future-parent references are rejected.
- Hash chain and per-event hash are recomputed during verification.
- A subject can have at most one terminal event.
- `AMBIGUOUS` remains `AMBIGUOUS`; verifier never normalizes it to success or retryable state.
- Evidence is represented by digests/references, not copied raw secrets/page bodies.
- Source commit is bound in the trace envelope.

## Invariants

- `TRACE_REPLAY_NEVER_EXECUTES_EFFECTS`.
- `TRACE_EVENTS_ARE_HASH_CHAINED`.
- `CAUSAL_PARENTS_MUST_PRECEDE_CHILDREN`.
- `SOURCE_COMMIT_IS_TRACE_BOUND`.
- `TERMINAL_OUTCOME_IS_SINGLE_ASSIGNMENT`.
- `AMBIGUITY_IS_PRESERVED_DURING_REPLAY`.
- `REPLAY_OUTPUT_IS_DERIVED_ONLY`.
- `TRACE_CORE_HAS_ZERO_BROWSER_NETWORK_PROCESS_MODEL_AUTHORITY`.

## Non-goals

R13 does not claim deterministic reproduction of arbitrary webpages, network services or model generations. It verifies the recorded causal/evidence structure and deterministic terminal semantics around those external systems.
