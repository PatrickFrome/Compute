# A2 lockstep deliberation, full action visibility, and autonomous roadmap development

Date: 2026-08-24

Scope: draft PR #49, noncanonical A2 collaboration plane

Operator constraint: no 30-minute canary

## Decision

A2 now uses a database-enforced, two-peer bulk-synchronous protocol rather than two independent polling loops. GPT and GLM must join the same immutable frontier, publish one result each, and complete the same deliberation phase before another round can open. The three phases are:

1. `PROPOSE`: independent, simultaneous, falsifiable roadmap actions;
2. `CHALLENGE`: each model must bind its critique to a persisted peer event hash;
3. `DECIDE`: each model commits one executable action or requests a duel.

Matching `DECIDE` action kinds admit reversible autonomous execution after a fresh authority read. A mismatch becomes a semantic conflict and proceeds to the existing `SAME_POINT_DUEL_V4` two-wave adversarial protocol. No model event, consensus, or duel result silently becomes canonical.

## Why the previous design was insufficient

The previous workspace snapshot showed an objective asymmetry: GPT had applied through commit 5 while GLM remained at commit 0. Advisory locking serialized individual writes, but did not guarantee that both models began a reasoning step from the same frontier. A fast stream could interrupt stale work, yet it could not prove simultaneous base selection.

The replacement makes shared-base selection a database invariant:

- at most one `OPEN` round per workspace;
- both exact-model sessions occupy fixed GPT/GLM slots;
- the round records one base commit/GPT/GLM frontier and hash;
- every model-authored result carries the signed round ID and sequence;
- its VisibilityProof must equal the round base exactly;
- late P0/P1 peer events fail closed;
- the round seals only after both result events persist;
- an expired or interrupted round is explicitly `ABANDONED`, never silently skipped.

This follows the bulk-synchronous pattern in which parallel computation is separated by global barriers, as described by Google's Pregel paper: <https://research.google/pubs/pregel-a-system-for-large-scale-graph-processing/>.

## Qualitatively stronger model interaction

Multi-agent debate can improve reasoning when agents first form independent proposals and then exchange reasons over multiple rounds. The original multi-agent debate work reports gains from proposal-and-debate iterations: <https://arxiv.org/abs/2305.14325>.

Naive free-form debate is not enough. Recent controlled work identifies persuasive-but-wrong adoption and sycophancy as failure modes: <https://arxiv.org/abs/2509.05396> and <https://arxiv.org/abs/2509.23055>. A2 therefore does not prompt for polite consensus. It preserves productive disagreement through:

- simultaneous `PROPOSE`, so neither model anchors on the other's current answer;
- hash-bound `CHALLENGE`, so criticism must address an observable peer claim;
- explicit evidence, assumptions, counterexample, falsifier, and tests;
- `DECIDE`, which demands an action instead of indefinite discussion;
- a formal duel when actions differ, rather than forced consensus;
- mutation admission only after matching actions or a duel decision.

Private chain-of-thought is neither requested nor stored. All engineering-relevant reasons needed for collaboration are structured public fields.

## Full action visibility and traceability

Every cognition, model, tool, file, patch, test, authority, backpressure, checkpoint, and error event receives an `a2_action` envelope:

- globally unique `action_id`;
- W3C-compatible `trace_id`, `span_id`, and `traceparent`;
- actor, action kind, round ID, and round sequence;
- permanent `canonical=false` and `authority_effect=false` markers.

The trace ID is stable across one round; every action gets a separate span ID. This follows the W3C Trace Context contract and OpenTelemetry span/event model: <https://www.w3.org/TR/trace-context/> and <https://opentelemetry.io/docs/concepts/signals/traces/>.

`PEER_EVENT_APPLIED` now acknowledges every peer action, not a selected event-type subset. Receipts are chunked at 64 hashes and never receipt other receipts, preventing both loss and acknowledgment storms. The observer projects an event-by-event GPT/GLM origin/applied/pending matrix from those persisted receipts.

## Low-latency path

Postgres remains the source of truth. `LISTEN/NOTIFY` wakes runtimes, coordinator, and SSE observers immediately after commit; reconnect always replays durable rows by commit sequence. PostgreSQL explicitly delivers notifications after commit and is not itself a durable message store, so treating it as a wake plane avoids dual-write inconsistencies: <https://www.postgresql.org/docs/current/sql-notify.html>.

The conflict coordinator now listens to the A2 event channel and reacts immediately, with a two-second poll only as recovery fallback. SSE IDs preserve replay through `Last-Event-ID` according to the HTML standard: <https://html.spec.whatwg.org/multipage/server-sent-events.html>.

Transport latency is expected to be small relative to model inference. Adding a second mandatory broker would create more failure and ordering surfaces without shortening inference. The action ledger therefore measures the actual gaps so that a broker can be justified by evidence later.

## Free and open-source amplifier review

| Option | Cost | Decision | Reason |
|---|---:|---|---|
| PostgreSQL `LISTEN/NOTIFY` + SSE | already available | Adopted | Lowest operational complexity; commit-aware wake-up plus durable replay |
| Supabase Realtime Broadcast | Free quota: 2M messages, 200 peak connections; current free limit 100 messages/s | Optional observer fan-out | Useful for browsers, never authoritative peer delivery; limits: <https://supabase.com/docs/guides/realtime/limits>, pricing: <https://supabase.com/docs/guides/realtime/pricing> |
| Core NATS | Open source/self-hosted | Deferred | Very low latency, but Core NATS is at-most-once with no storage/ack; it would only duplicate the wake plane: <https://docs.nats.io/learn/core-nats/> |
| NATS JetStream | Open source/self-hosted | Deferred | Adds replay but duplicates the existing Postgres ledger and introduces dual durability: <https://docs.nats.io/concepts/jetstream> |
| OpenTelemetry Collector | Open source | Optional | Vendor-neutral export of A2 trace envelopes with no mandatory SaaS: <https://opentelemetry.io/docs/collector/> |
| Prometheus | Apache-2.0 | Optional local metrics | Appropriate for latency, abandonment, cursor-lag, and duel-rate alerts: <https://github.com/prometheus/prometheus> |
| Grafana Tempo | Open source | Optional local trace UI | Can render A2 trace IDs locally; development can use filesystem storage: <https://grafana.com/docs/tempo/latest/> |

The selected baseline has no new paid dependency. Supabase Realtime, NATS, Collector, Prometheus, and Tempo remain adapters behind the stable action/trace contract, not prerequisites.

## Autonomous power envelope

The user has pre-authorized autonomous roadmap development. Inside `REVERSIBLE_ROADMAP_DEVELOPMENT_V1`, the models do not ask for confirmation for research, code/schema edits, tests, commits, PR updates, and preview deployments. If a proposed step is fenced, they must choose another admissible action or persist a precise blocker.

Maximum power still has hard machine boundaries:

- no destructive data loss;
- no secret extraction or bypass of trusted ingress;
- no disabling security, CI, signing, or audit controls;
- no self-grant of canonical or merge authority;
- no mutation before matching `DECIDE` actions or a duel decision;
- every mutation re-reads the current authority digest immediately before execution.

This is two-key autonomous authority, not human-in-the-loop approval and not unconstrained unilateral execution.

## Deterministic acceptance gates

No duration-based canary is authorized. A2 acceptance requires exact, short, assertive scenarios:

1. both peers join the same base and complete `PROPOSE→CHALLENGE→DECIDE`;
2. each `CHALLENGE` addresses a real peer event hash;
3. every peer action receives a persisted acknowledgment;
4. disconnect/reconnect replays exactly from commit sequence;
5. a late P0/P1 event abandons or rejects the stale round;
6. matching decisions admit one reversible mutation after authority revalidation;
7. mismatched decisions open and complete `SAME_POINT_DUEL_V4`;
8. tampered Ed25519 input is rejected at HTTP ingress before receipt/event persistence;
9. all A2/duel records remain noncanonical and nonauthority;
10. TypeScript, native tests, pgTAP contract tests, TLC invariants, CodeQL, and Supabase advisors pass.

## Remaining production evidence

Implementation and local contract evidence do not substitute for independently hosted exact endpoints. A2 remains draft until exact `openai/gpt-5.6-sol` and `zai/glm-5.3` runtimes execute the deterministic scenario suite and the HTTP-only Ed25519 negative/positive path is observed. The deliberately excluded 30-minute canary is not a blocker.
