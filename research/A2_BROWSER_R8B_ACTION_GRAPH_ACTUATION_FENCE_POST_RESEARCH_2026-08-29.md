# A2 Browser R8B — Action Graph Actuation Fence — Post-Implementation Research

Date: 2026-08-29
Parent verified milestone: R8A `c7d8fa332f83310b81098611ff8c6f8664a03122`
Pre-seal implementation head: `437ce95645d0cc70d2fbe9adeeab14f0b8354a7c`

## What the implementation proved

R8B adds a durable, non-authoritative actuation fence around the R8A append-only causal action graph.

The verified candidate path establishes the order:

1. declare action;
2. run fresh preflight;
3. durably append and fsync `EFFECT_INTENT_SEALED`;
4. invoke the supplied actuator at most once for the action ID;
5. persist exactly one typed terminal outcome: `COMMITTED`, `NO_EFFECT`, or `AMBIGUOUS`.

Preflight rejection occurs before the durable effect seal and before actuator invocation. Untyped exceptions or malformed post-seal actuator results are classified conservatively as `AMBIGUOUS`. Automatic retry is disabled. A terminal-persistence failure after actuator return is recovery-required and does not cause an alternative terminal write or actuator retry.

R8B remains a state/fencing layer only: `authority_effect=false` and `actuation_eligible=false`.

## Additional hardening found before seal

The first green R8B candidate (`4ce6e43a912f40d9cab8f88733c51939d7c3f074`) exposed a review gap before checkpoint promotion: causal namespace fields were still read from an external object at multiple points in the fence lifecycle.

The follow-up implementation `afadf6fa63c5362f632b82d5e384e741414387f0` snapshots the namespace once before preflight/seal/terminal bookkeeping. This applies the same external-input rule used elsewhere in A2: snapshot once, validate once, then operate only on the captured immutable values. A stateful getter or proxy can therefore not change target/context/conversation/document identity between checks.

The exact-head run for that hardening failed only in an inherited R7K launcher fixture with Linux `ETXTBSY` while the Rust test harness was running tests in parallel. R8B typed tests and the complete R8A graph regressions were green. Production R7/R8 code was not changed to hide the failure. The R8B verifier was made deterministic by running the inherited Rust regression suite with `--test-threads=1`.

Exact head `437ce95645d0cc70d2fbe9adeeab14f0b8354a7c` then passed the complete R8B gate, including inherited R7M/R7K Rust and Node boundaries, deterministic evidence, provenance, and artifact upload.

## Comparison with strong analogues

### Playwright

Playwright locators resolve an up-to-date DOM element for each action and perform actionability checks before acting. Its `trial` mode can perform actionability checks without the action. This supports the R8B separation between fresh preflight and physical effect, but does not imply that a browser effect is safely retryable after dispatch uncertainty.

### Chrome DevTools Protocol Input

A physical mouse click is not one indivisible transaction. CDP exposes separate `Input.dispatchMouseEvent` event types including `mousePressed` and `mouseReleased`. Once the first physical dispatch has begun, a transport or acknowledgement failure cannot generally prove that the page observed no effect.

### Transactional outbox / durable-intent systems

Transactional outbox patterns solve durable intent and ordering, but duplicate downstream delivery remains possible unless the receiver implements idempotency. R8B intentionally provides durable pre-effect intent and terminal ambiguity handling, not a false exactly-once claim for arbitrary webpages.

### Idempotency-key APIs

Idempotency tokens make retries safe only when every relevant downstream consumer participates in the idempotency contract. An arbitrary webpage does not generally provide such a contract for a UI click. An A2 action/request ID therefore supports correlation, graph deduplication, and control-plane replay protection; it is not a page-level idempotency key.

## Decision after implementation

Keep the R8B architecture unchanged after the snapshot-once hardening and deterministic inherited verifier fix.

The next highest-value semantic slice is not more graph machinery. It is the first typed physical extension boundary for one action kind: CLICK.

## R8C boundary derived from the evidence

`R8C_TYPED_EXTENSION_CLICK_OUTCOME_V1` should implement only CLICK and must preserve these rules:

- live semantic/AX/DOM/hit-target revalidation occurs inside the trusted extension immediately before dispatch;
- `NO_EFFECT` is valid only when trusted extension evidence proves that the first physical input dispatch did not begin;
- once the first `Input.dispatchMouseEvent` starts, any transport loss, extension restart, missing acknowledgement, or uncertain completion is `AMBIGUOUS` unless effect completion is positively proven;
- `COMMITTED` requires the full intended click dispatch sequence plus a controlled acknowledgement contract;
- the same action ID is retained across the boundary for correlation, but never authorizes automatic resend;
- no automatic retry/redelivery after a post-dispatch uncertainty;
- real-Chrome verification must use a controlled page with a monotonic effect counter so a second dispatch is observable;
- typing, select, navigation, download, and WebMCP invocation remain out of scope.

## Explicit non-claims

R8B does **not** claim:

- real MV3/CDP actuation integration;
- exactly-once external browser effects;
- distributed/multi-host graph durability;
- safe retry after a physical dispatch may have begun;
- that a control-plane action ID is a page-level idempotency key;
- that `NO_EFFECT` can be inferred from a generic exception or missing acknowledgement.

## Next milestone

`R8C_TYPED_EXTENSION_CLICK_OUTCOME_V1`

The objective is to connect the durable R8B fence to exactly one real physical action while preserving conservative ambiguity semantics and all existing authority/actionability gates.
