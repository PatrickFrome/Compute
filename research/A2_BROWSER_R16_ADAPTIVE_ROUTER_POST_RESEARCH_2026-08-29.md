# A2 Browser R16 — Adaptive Router — Post-Implementation Research

Date: 2026-08-29
Authoritative parent milestone: R15 `65b0a8d24ff418bfbc2ebdec8d2700f8f253b22f`
Roadmap milestone: `R16_ADAPTIVE_ROUTER`

## Result

R16 is a pure pre-effect routing policy. It first rejects executors that fail health, raw-engine, capacity, surface, trust, session, locality/privacy or capability requirements. Only the surviving set participates in ranking. The router has no browser, network, process or model callback and returns `authority_effect=false` and `actuation_eligible=false`.

The R16 work line originally branched from an earlier R15 candidate. Before final promotion, its history was non-destructively merged with authoritative hardened R15 `65b0a8d24ff418bfbc2ebdec8d2700f8f253b22f`; no force-push was used. Final R16 CI is bound to that authoritative R15 head.

## Primary-source research re-check

Amazon Route 53 latency routing chooses based on latency among configured resources and can pair latency routing with health checks so an unhealthy lower-latency endpoint does not continue winning. This supports A2's separation between hard availability eligibility and performance preference.

Envoy's weighted least-request documentation treats active request count as a load-balancing signal among available hosts, while Envoy's request lifecycle documents draining listeners as accepting no new connections while existing connections continue. This independently supports both R15 graceful draining and the R16 rule that `DRAINING` is never a new-route candidate.

A2 is intentionally stricter than generic traffic routing: it has no last-resort fail-open route to an executor that failed a safety/privacy eligibility gate. Empty eligibility fails closed.

## Determinism hardening

Post-implementation review found two avoidable nondeterministic score paths:

1. `localeCompare()` could make executor-id tie breaking dependent on locale/runtime configuration.
2. `active_leases / max_leases` used a floating-point ratio when exact ordering can be computed using integer arithmetic.

The hardened router removes both. String ordering uses an explicit lexical comparator, while load ratios are compared with integer cross multiplication. Observed latency must be a bounded integer. Rejected executors are sorted canonically, so equivalent executor snapshots produce the same decision receipt regardless of input enumeration order.

The routing receipt exposes only bounded scoring inputs after safety filtering and remains non-authoritative. A routing decision still requires fresh downstream authority and an R15/R8 lease before any effect.

## Drain / ambiguity semantics

`DRAINING` is a hard rejection for new routing even if that executor is sticky or has the lowest latency. R16 never migrates an in-flight effect: any request not in `PRE_EFFECT` state is rejected before filtering/scoring. Existing leases remain governed by R15 exact-incarnation semantics; ambiguous external effects remain terminal and are never automatically retried.

## Confirmed invariants

- `ROUTER_FILTERS_SECURITY_BEFORE_SCORING_PERFORMANCE`.
- `FAST_INELIGIBLE_EXECUTOR_CAN_NEVER_WIN`.
- `DRAINING_EXECUTOR_CAN_NEVER_RECEIVE_NEW_ROUTE`.
- `ROUTING_OCCURS_PRE_EFFECT_ONLY`.
- `ROUTER_NEVER_RETRIES_AMBIGUOUS_EFFECTS`.
- `RAW_ENGINE_EXPOSED_EXECUTOR_IS_INELIGIBLE`.
- `PRIVACY_LOCALITY_POLICY_IS_HARD_FILTER`.
- `STICKINESS_NEVER_OVERRIDES_CURRENT_ELIGIBILITY`.
- `ROUTING_DECISION_BINDS_EXACT_EXECUTOR_INCARNATION`.
- `ROUTER_OUTPUT_REQUIRES_FRESH_AUTHORITY_AND_LEASE`.
- `ROUTER_ORDERING_IS_LOCALE_INDEPENDENT`.
- `ROUTER_LOAD_COMPARISON_IS_EXACT_INTEGER_ARITHMETIC`.
- `ROUTER_RECEIPT_IS_INPUT_ORDER_INDEPENDENT`.
- `ROUTER_HAS_ZERO_BROWSER_NETWORK_PROCESS_MODEL_AUTHORITY`.

## Canonical roadmap closure condition

R16 may be promoted only after an exact-head workflow proves the authoritative R15 ancestor, all R16 adversarial/determinism tests, R15-through-R8 regressions, dependency boundary, deterministic retained evidence and provenance attestation.

After that promotion, R0 through R16 are complete at the canonical Browser Operator roadmap level. This does not expand typed browser actuation beyond separately verified R8 scope and does not claim arbitrary page-level exactly-once semantics.
