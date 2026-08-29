# A2 Browser R5D — Provider-Neutral Planning Broker Deep Research

Date: 2026-08-28
Milestone: R5_SEMANTIC_ACTION_CACHE_V1 / R5D_EXTERNAL_PLANNING_BROKER

## Research question

How should A2 eliminate redundant browser-agent inference across concurrent workers while preserving the existing hard boundary that browser perception is non-authority and every physical effect must be freshly revalidated?

## Current analogs

### Playwright — semantic locators plus fresh actionability

Primary sources:
- https://playwright.dev/docs/locators
- https://playwright.dev/docs/actionability

Playwright recommends user-facing semantic locators such as role/label/text and resolves the underlying DOM element again whenever the locator is used. Locator operations that imply one element are strict: multiple matches fail rather than silently selecting an arbitrary element. Before a click, Playwright additionally checks uniqueness, visibility, stability, event reception and enabled state.

A2 consequence: a cached planning result must never become a cached physical node authority. Cache/broker output is only a candidate; current perception and the actuator remain responsible for a fresh resolution/actionability fence.

### Stagehand v4 — inference skipping is the high-value acceleration

Primary/current sources:
- https://www.browserbase.com/changelog/caching-configurable
- https://www.browserbase.com/blog/stagehand-caching

Stagehand v4 exposes configurable server-side caching for `act()`, `observe()` and `extract()`. Browserbase states that a hit skips inference entirely (no model call/tokens). Their caching write-up describes selector/action-result reuse and reports up to about 80% speedup in a repeated two-run benchmark, while also noting that dynamic pages can invalidate the assumptions behind reuse.

A2 consequence: the largest steady-state gain comes from making a safe cache HIT terminate before model inference. A2 deliberately does not copy Stagehand's selector-as-execution-authority shape. A2 persists semantic/locator fingerprints only and obtains a fresh node reference from the current perception envelope.

### Go singleflight — one expensive computation per key

Primary source:
- https://pkg.go.dev/golang.org/x/sync/singleflight

`singleflight` is explicitly a duplicate function-call suppression mechanism: only one execution is in flight for a key while duplicate callers share/wait for the result.

A2 consequence: R5C already applies this inside one planner process. R5D must extend the same property across external planner clients without moving provider credentials into the browser daemon.

### Redis cache-stampede protection — expiring ownership lease

Primary source:
- https://redis.io/docs/latest/develop/use-cases/cache-aside/nodejs/

Redis documents cache-stampede protection using an atomic short-lived `SET NX PX` lock: one caller becomes loader, other callers wait, and release is accepted only when the caller still owns the lock.

A2 consequence: a cold semantic key elects one `MISS_LEADER` with an opaque expiring lease. Other clients receive `WAIT_FOR_PROMOTION` without the lease token. Promotion/abort requires the exact lease. Expiration makes a new leader possible.

## Chosen architecture

```text
external agent / GPT / GLM / future planner
                    |
                    v
             planning.lookup
                    |
          +---------+----------+
          |                    |
   HIT_REVALIDATED        cache MISS
          |                    |
   no model call          lease election
          |              +-----+------+
          |              |            |
          |        MISS_LEADER   WAIT_FOR_PROMOTION
          |              |            |
          |       exactly one          |
          |       external model       |
          |              |            |
          |      planning.promote      |
          |              |            |
          |     fresh daemon-owned     |
          |       perception capture   |
          |              |            |
          +--------------+------------+
                         |
                 semantic candidate
                         |
                 existing actuator
                 actionability fence
```

### Ownership split

Browser runtime owns:
- current target/context/conversation identity;
- fresh perception capture;
- document epoch;
- semantic cache;
- cold-miss planning leases;
- promotion revalidation;
- sanitized metrics.

External planner owns:
- model/provider choice;
- model credentials;
- inference execution;
- private reasoning/context required to choose a candidate.

Actuator owns:
- live target binding;
- final actionability/effect checks;
- effect/no-retry semantics.

## R5D protocol decisions

1. `planning.lookup(profileId,targetId,intentId,actionKind)` captures perception inside the daemon. Clients cannot supply or forge the fresh envelope.
2. `HIT_REVALIDATED` returns a current candidate and says `model_call_required=false`.
3. First cold miss returns `MISS_LEADER`, an opaque `flight_id`, lease token, and the current non-authority planning envelope needed by the external model.
4. Concurrent misses return `WAIT_FOR_PROMOTION`; no lease token and no duplicate model call are required.
5. `planning.promote(...)` performs another daemon-owned perception capture, then verifies the leader-selected old candidate semantics against that fresh envelope before warming the cache.
6. Document/context/conversation/target drift is a hard failure and releases the flight for replanning.
7. Browser process incarnation changes discard profile broker state.
8. Planning RPC is local coordination, not actuation. It never becomes web authority.

## Rejected alternatives

### Model execution inside Compute Browser
Rejected: couples runtime to providers, puts model secrets into a browser-adjacent daemon and makes scaling/provider routing harder.

### Cache raw CDP/backend node IDs
Rejected: engine identities are process/session ephemeral and become stale across renderer/navigation changes.

### Cache XPath/CSS as authority
Rejected: DOM-structure selectors are brittle under page churn; Playwright explicitly recommends semantic/user-facing locators over structural XPath/CSS chains.

### Let `planning.promote` accept a client-provided fresh envelope
Rejected: the leader could accidentally or maliciously present stale evidence. Promotion must recapture inside the daemon.

### Put planning calls on the global effect serialization queue
Rejected: planning is non-authority coordination. Serializing unrelated semantic keys would unnecessarily reduce swarm throughput. Per-key lease/singleflight provides the required contention boundary.

### Cache action payloads / typed values
Rejected: unnecessary for inference avoidance and creates privacy/secret-retention risk. R5 stores no execution payload.

## Performance model

For N concurrent identical cold requests:

- without collapse: up to N planner/model calls;
- R5D cold path: 1 leader model call + N-1 waiters;
- after promotion: subsequent equivalent requests can be model-free HITs.

For N=64, theoretical duplicate planner-call suppression on the cold burst is 63/64 = 98.4375%, before considering model latency or provider-side prompt caching.

This is a call-count property, not a claim of 98.4% wall-clock speedup. Real speedup depends on perception time, IPC, provider latency and hit rate.

## Benchmark gates for R14

Record at minimum:
- model calls per successful semantic action;
- cache HIT ratio;
- cold-miss collapse ratio (`waiters / cold requests`);
- p50/p95 `planning.lookup` latency;
- p50/p95 promotion recapture/revalidation latency;
- freshness/namespace rejection rate;
- ambiguous-target rate;
- planner lease expiration rate;
- bytes exposed to external planner on MISS versus HIT;
- wrong-target physical effects: target = 0;
- provider credentials or execution payload retained by browser daemon: target = 0.

## Post-step assessment

R5D is preferable to immediately adding more browser workers. Horizontal browser scaling before inference deduplication multiplies repeated model work. R5A-R5D first reduce model-seconds per useful action; later R15 Remote Browser Pool and R16 Adaptive Router can then increase concurrency without proportionally multiplying planning calls.

The next scaling amplifier after verified R5D should be a distributed form of the same lease/cache semantics only when multiple Compute Browser daemon processes become necessary. Until then, in-daemon leases are simpler and avoid distributed-lock failure modes.
