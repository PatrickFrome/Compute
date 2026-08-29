# A2 Browser R16 — Adaptive Router — Pre-Implementation Research

Date: 2026-08-29
Parent candidate milestone: R15 `2561499f427be084cd24ecf4ed229b69b8c1e367`
Roadmap milestone: `R16_ADAPTIVE_ROUTER`

## Goal

Choose the safest eligible browser execution surface before effect execution without allowing latency/cost preferences to weaken authority, isolation, privacy or exact-incarnation constraints.

## Research findings

Kubernetes scheduling is structurally split into filtering and scoring: infeasible nodes are removed first, and only feasible nodes participate in ranking. This is the correct model for A2 routing because a performance score must never make an unsafe executor feasible.

Cloudflare Load Balancing similarly starts steering from pool/endpoint health and availability. Dynamic steering then compares RTT among available pools. This reinforces health-first selection and treating latency as a secondary optimization signal.

Least-outstanding-request algorithms used by large load balancers are useful for balancing heterogeneous load, but only after endpoint eligibility/health. R16 therefore uses capacity/load as a score input, not a security gate replacement.

## Architecture decision

R16 is a pure pre-effect router. It does not dispatch browser work and rejects routing requests whose effect state is not `PRE_EFFECT`.

Executor eligibility requires:
- `HEALTHY` state;
- exact executor incarnation identity;
- required typed capabilities;
- caller-policy allowed surface, trust class and session class;
- `raw_engine_exposed=false`;
- available capacity;
- locality/privacy policy satisfaction.

Only after filtering, deterministic ranking considers:
1. valid sticky executor, when still eligible;
2. policy surface preference;
3. preferred locality/region;
4. load ratio;
5. observed latency;
6. executor id as deterministic tie breaker.

Trust class is never a score. It is a hard eligibility filter.

## Invariants

- `ROUTER_FILTERS_SECURITY_BEFORE_SCORING_PERFORMANCE`.
- `FAST_INELIGIBLE_EXECUTOR_CAN_NEVER_WIN`.
- `ROUTING_OCCURS_PRE_EFFECT_ONLY`.
- `ROUTER_NEVER_RETRIES_AMBIGUOUS_EFFECTS`.
- `RAW_ENGINE_EXPOSED_EXECUTOR_IS_INELIGIBLE`.
- `PRIVACY_LOCALITY_POLICY_IS_HARD_FILTER`.
- `STICKINESS_NEVER_OVERRIDES_CURRENT_ELIGIBILITY`.
- `ROUTING_DECISION_BINDS_EXACT_EXECUTOR_INCARNATION`.
- `ROUTER_OUTPUT_REQUIRES_FRESH_AUTHORITY_AND_LEASE`.
- `ROUTER_HAS_ZERO_BROWSER_NETWORK_PROCESS_MODEL_AUTHORITY`.
