# METAENGINE Compute Unified V1 — C1–C6 Acceleration Research Checkpoint

Date: 2026-08-29
Branch: `work/convergence-research-v1`
Base integration head: `03684f0731e6d12dc477c09f217ea2bca3aa29db`
Control point: `coordination/convergence/COMPUTE_UNIFIED_V1.md`
Authority effect: **false**
Mode: independent research / branch-local evidence only

## 1. Scope and source-of-truth read

This checkpoint researches only accelerators that fit the already-established Compute Unified V1 architecture. It does **not** introduce a parallel browser-agent framework, a second browser pool, a second workflow authority plane, a second WebMCP stack, or a second trace/benchmark system.

The convergence control point already assigns:

- R16 as the semantic/control-plane base;
- Native METAENGINE Browser as the physical execution edge;
- B6/B7 as the browser-node/pool substrate;
- Development Plane as candidate/evidence/sandbox verification only;
- typed lease-holding actuation as the only path to physical effect;
- no blind retry after an ambiguous effect.

GitHub/Supabase re-read also confirms that the existing R-line already contains the relevant primitives:

- R5 semantic action cache;
- R6 WebMCP discovery/catalog/routing;
- R7 isolated skill/runtime work;
- R8 durable action graph + actuation fences;
- R10 context compiler;
- R11 same-point swarm;
- R12 trust/taint graph;
- R13 deterministic trace verification;
- R14 safety-first benchmark;
- R15 remote browser pool;
- R16 adaptive pre-effect router.

B6 is the current Compute Browser pool foundation and explicitly leaves remote-node probing to B7. DP2 already defines a typed, PREPARE_ONLY sandbox plan and requires a later physical backend binding with ephemeral/resource-bounded/deny-by-default semantics.

No Supabase mutation, provider mutation, secret change, production authority change, mainline merge, PR close, or main branch write was performed by this research checkpoint.

## 2. External research — useful deltas only

### 2.1 WebMCP

Chrome's 2026 WebMCP guidance treats tool definitions and outputs as untrusted agent input. The browser agent may operate inside the user's authenticated session, while malicious tool names/descriptions and contaminated tool outputs remain prompt-injection vectors. The WebMCP security/privacy work also notes that tool registration is document-lifetime scoped and that tools can expose sensitive or high-privilege operations.

This validates the current R6/R12 direction. The useful delta is **not** another WebMCP adapter. The useful delta is stronger source binding for the existing catalog/cache: origin + document epoch + toolset digest + tool-definition digest, with every metadata/output field remaining R12-tainted. Consequential/risk annotations from WebMCP can be consumed only as untrusted hints, never as authority.

Primary sources:
- https://developer.chrome.com/docs/agents/security
- https://developer.chrome.com/docs/ai/webmcp/secure-tools
- https://github.com/webmachinelearning/webmcp/blob/main/security-privacy-questionnaire.md
- https://github.com/webmachinelearning/webmcp/blob/main/index.bs

### 2.2 Stagehand / Browserbase

Stagehand v4 moved target/state/CDP dispatch closer to the browser through an extension and advertises lower round-trip time and fewer CDP races. Its configurable cache can skip model inference for repeated `act`, `observe`, and `extract` operations. Browserbase's earlier cache design explicitly caches resolved selectors and validates that the page still matches before reuse. Browserbase Contexts persist authentication/session data across sessions but recommend avoiding simultaneous use of the same context.

The useful delta is **not** to replace R5/R6/R8 with Stagehand. The useful pattern is a resolver-only self-healing/caching lane:

`intent -> cached/AI resolution candidate -> fresh target/document/toolset revalidation -> R8 lease/fence -> typed actuation`

A cache hit may reduce inference but can never create actuation eligibility.

Primary sources:
- https://www.browserbase.com/changelog/stagehand-v4
- https://www.browserbase.com/changelog/caching-configurable
- https://www.browserbase.com/blog/stagehand-caching
- https://docs.browserbase.com/platform/browser/core-features/contexts

### 2.3 Playwright / CDP / WebDriver BiDi

Playwright documents that `connectOverCDP()` is Chromium-only and significantly lower fidelity than the Playwright protocol connection. BrowserContext remains the strong isolation primitive. WebDriver BiDi is a W3C Working Draft as of 2026-06-29 and provides a bidirectional remote-control protocol intended to span user agents.

The useful delta is a **transport-neutral capability envelope inside C3**, not a transport rewrite:

- Playwright-native adapter where the Native Browser can own the process;
- CDP adapter for existing Chromium attachment/compatibility paths;
- WebDriver BiDi adapter initially shadow/read-only/canary, promoted only when capability/equivalence tests pass.

Raw transport must remain internal to the physical adapter; planners/agents receive typed capability/evidence only.

Primary sources:
- https://playwright.dev/docs/api/class-browsertype
- https://playwright.dev/docs/browser-contexts
- https://www.w3.org/TR/webdriver-bidi/

### 2.4 Durable workflow / Temporal-like patterns

Temporal's useful architecture is event-history durability: deterministic workflow logic is rebuilt from an append-only history, while side-effecting operations live in Activities. Temporal explicitly distinguishes idempotent/retryable side effects from non-retryable ones; its architecture documentation states that activity code should be idempotent or non-retryable. Current Temporal also emphasizes worker versioning and queue priority/fairness.

Compute Unified V1 already has durable state, claims, receipts, outbox-like structures, R8 effect fencing and R13 history verification. Therefore adopting Temporal itself would duplicate authority/orchestration. The useful delta is to import only these patterns:

- versioned workflow state transitions;
- durable task/assignment history;
- deterministic re-drive of pure steps;
- explicit activity/effect boundary;
- no automatic retry when the browser effect may have happened;
- bounded history with summarized/continued epochs rather than unbounded logs.

Primary sources:
- https://github.com/temporalio/documentation/blob/main/docs/encyclopedia/workflow/workflow-execution/event.mdx
- https://github.com/temporalio/documentation/blob/main/docs/encyclopedia/retry-policies.mdx
- https://github.com/temporalio/temporal/blob/main/docs/architecture/README.md
- https://temporal.io/changelog

### 2.5 Remote browser pools and persistent contexts

Browserbase shows the practical value of persistent browser contexts for avoiding repeated authentication, but also warns against simultaneous use of one context. Playwright's isolation guidance prefers fresh BrowserContexts and warns that best-effort context reuse is weaker isolation.

R15/B6 already own the pool. The useful delta for B7 is therefore only:

- transport-ready probe before node admission;
- exact browser-process incarnation in the admission receipt;
- context isolation proof;
- optional logical `auth_context_affinity` constraint for workflows that must reuse state;
- never concurrently attach one persistent auth context to multiple active leases;
- never copy/migrate auth state to another node automatically.

This extends the existing pool instead of creating a Browserbase-like parallel scheduler.

Primary sources:
- https://docs.browserbase.com/platform/browser/core-features/contexts
- https://docs.browserbase.com/optimizations/concurrency/overview
- https://playwright.dev/docs/browser-contexts

### 2.6 Isolated sandbox backends

Vercel Sandbox uses Firecracker microVMs, supports fast startup and filesystem/package snapshots. Cloudflare Sandbox runs each sandbox in a separate VM-backed container environment, exposes explicit lifecycle identity, and documents keeping external credentials outside the sandbox via outbound handlers. Cloudflare's current lifecycle documentation also makes the sandbox-ID/container-incarnation distinction explicit and says process/terminal handles should fail closed after container replacement in the 1.0 preview.

DP2 already defines the correct typed planning boundary. The useful delta is one minimal physical backend adapter whose receipt binds:

- requested backend policy;
- observed backend kind;
- exact sandbox/container incarnation;
- image or snapshot digest;
- candidate source digest;
- bounded CPU/memory/time envelope;
- effective network policy;
- output artifact manifest digest;
- teardown proof.

Provider credentials must not be candidate-visible. Snapshot use is an acceleration technique only when the snapshot digest is independently bound and its age/policy is acceptable.

Primary sources:
- https://vercel.com/docs/sandbox
- https://vercel.com/docs/vercel-sandbox/concepts/snapshots
- https://developers.cloudflare.com/sandbox/concepts/security/
- https://developers.cloudflare.com/sandbox/concepts/sandboxes/

### 2.7 Trace and benchmark

Playwright traces can capture DOM snapshots, screenshots, network activity and sources. BrowserGym provides reproducible web-agent benchmark environments including WebArena, WebArenaVerified, WorkArena, AssistantBench and others.

R13 must remain the canonical effect-safe trace verifier and R14 must remain correctness-first. Rich browser traces should therefore be **sidecar evidence by digest**, not replay programs. External web-agent benchmarks should be a **non-authoritative physical canary lane**, not a replacement for R14 safety gates.

Primary sources:
- https://playwright.dev/docs/api/class-tracing
- https://github.com/ServiceNow/BrowserGym

## 3. Concrete decisions for C1–C6

The percentages below are engineering estimates for convergence acceleration, not measured production claims. They are meant to prioritize implementation order and must be replaced by R14/physical-canary measurements.

| # | Decision | Applies | Existing layer extended | Expected acceleration | Primary risk | Required guardrail |
|---|---|---|---|---|---|---|
| D1 | Add a transport-neutral browser capability envelope with Playwright-native, CDP and shadow BiDi adapters | C1, C3 | Native Browser + C3 typed supervisor | ~20–35% less duplicate adapter/plumbing work across C1/C3 | protocol capability drift, incomplete BiDi implementations | exact adapter/version/capability receipt; raw transport never reaches planner; BiDi starts shadow/read-only |
| D2 | Add Stagehand-like self-healing only as a resolver before R8 actuation | C1, C3 | R5/R6 semantic cache + R8 fence | repetitive flows can plausibly cut resolver/model time ~20–60%; vendor cases report larger cache wins | stale selector/tool resolution causes wrong-target action | cache key binds origin + document epoch + perception/toolset digest + action schema; mandatory fresh revalidation + lease before effect |
| D3 | Strengthen existing WebMCP catalog entries with origin/tool-definition/toolset digests and explicit R12 taint labels | C1, C3 | R6 + R12 | ~10–25% less fallback planning/context on WebMCP-capable pages and safer cache reuse | evolving WebMCP spec, malicious metadata/output | metadata/output never authority; document-lifetime invalidation; consequential hint is advisory only |
| D4 | Extend B7 admission with transport-ready probe and optional exclusive auth-context affinity | C2, C5 | B6 + R15/R16 | repeated authenticated jobs can remove substantial login/setup cost; estimated 20–50% on auth-heavy workflows | session leakage, simultaneous context use, affinity reducing pool utilization | one context -> one active lease; locality/privacy hard filter; no automatic auth-state migration |
| D5 | Implement Temporal-like durable assignment history over existing Supabase state, not a Temporal service | C5, C6 | existing claims/receipts/outbox + R8/R13 | ~25–45% less manual recovery/orchestration glue; faster restart/reassignment after worker failure | history growth, workflow-version mismatch, accidental side-effect retry | deterministic/versioned state machine; pure steps retry; effect steps terminalize NO_EFFECT/COMMITTED/AMBIGUOUS; AMBIGUOUS never auto-retries |
| D6 | Bind DP2 to one minimal incarnation-attested sandbox backend; use snapshots only as verified seed artifacts | C4 | DP2 | snapshot/warm seed can plausibly cut dependency-heavy sandbox setup ~30–70% | provider/API churn, stale snapshot, network/credential leakage, spend | one backend first; exact image/snapshot digest; deny-default/allowlist egress; credential broker outside candidate; teardown proof |
| D7 | Attach sampled/failure-only rich browser traces as sidecar artifacts referenced by R13 digests | C1–C5 | R13 | estimated 30–60% lower diagnosis/repair time on browser flakiness | PII/session leakage and large artifacts | redact/limit retention; store digest/reference in control plane; never execute or replay trace as authority |
| D8 | Add a non-authoritative physical canary benchmark lane using locked local fixtures plus a small BrowserGym subset | C1–C5 | R14 | estimated 20–40% faster architecture decisions by measuring task success, latency, tokens and repair rate instead of arguing from proxies | benchmark overfitting, flaky external dependencies, provider costs | correctness/safety remains gate zero; fixed fixture/image version; no aggregate score can compensate for safety failure |
| D9 | Require new transport/resolver/backend adapters to pass observe-only shadow equivalence before actuation eligibility | C1, C3, C4, C6 | R13 + R14 promotion evidence | estimated 20–40% less integration rework/rollback risk; allows C1/C3/C4 work to proceed in parallel | temporary extra compute and dual-path complexity | shadow output has `authority_effect=false`; compare typed decisions on identical fixtures; promotion separately evidence-gated |

## 4. Mapping to convergence workstreams

### C1 — Native R16 rejoin

Implement D1, D2 and D9 first. Native Browser should become another typed physical executor under the R16 control contracts, not a competing agent runtime. The fastest safe path is to keep semantic planning/cache/taint in R5–R16 and expose Native Browser through the same typed target/context/effect boundary.

### C2 — B6/B7 browser pool rejoin

Implement D4. B6 explicitly lacks remote probes; B7 should prove transport readiness, browser-process incarnation and context isolation before admission. Reuse R15/R16 draining/loss/ambiguity semantics unchanged.

### C3 — unified supervisor protocol

Implement D1 + D3 + D9. The unified protocol should define typed capabilities/outcomes independent of Playwright/CDP/BiDi. WebMCP stays a planning/tool surface and never becomes a supervisor authority channel.

### C4 — DP2 physical sandbox

Implement D6 only; do not create a second Development Plane abstraction. Start with one backend selected by configuration and capability probe. A second provider is useful later only as portability/adversarial evidence, not as a simultaneous scheduler requirement.

### C5 — autonomous fleet runtime

Implement D4 + D5 + D7. Durable assignment must originate from durable project state. The browser pool provides exact-incarnation workers, while event-history-like receipts permit restart/reassignment without replaying ambiguous page effects.

### C6 — closure wave

Use D8 + D9 as evidence accelerators. Closure should consume existing R13/R14 evidence plus physical canary results; it should not introduce new runtime authority. Branches can be closed only after the convergence disposition record proves that unique code/evidence has been integrated, archived, or explicitly rejected.

## 5. Explicit non-adoptions

The following would duplicate existing layers and are **not recommended**:

1. **Do not adopt Stagehand as the primary browser runtime.** Import resolver/cache/self-heal techniques beneath R8 only.
2. **Do not adopt Browserbase as a new pool control plane.** If a managed remote browser is ever used, expose it as one R15/B7 node-provider adapter.
3. **Do not deploy Temporal as a second canonical workflow authority.** Import event-history/versioning/retry-boundary patterns into existing durable state.
4. **Do not replace Chromium/CDP immediately with WebDriver BiDi.** BiDi is a capability-gated compatibility/cross-browser adapter until equivalence is physically proven.
5. **Do not replay Playwright/Browserbase traces as browser actions.** Rich traces remain sidecar evidence; R13 remains effect-free verification.
6. **Do not migrate/copy persistent auth state automatically between browser nodes.** Use exclusive affinity or re-authentication.
7. **Do not let the sandbox provider API leak into candidate plans.** DP2 owns the typed plan; provider SDK lives behind the backend binding.
8. **Do not trust WebMCP risk/consequential annotations as policy.** They are page-authored tainted hints.

## 6. Recommended implementation order

Fastest dependency-respecting order from this research:

1. **D9 shadow-equivalence harness** using existing R13/R14 fixtures — unlocks parallel adapter work safely.
2. **D1 typed transport envelope** — unblocks C1/C3 Native Browser rejoin without raw-engine leakage.
3. **D4 B7 remote transport-ready probe** — converts B6 from local-only registry into schedulable remote-node substrate.
4. **D6 one DP2 physical sandbox backend** — closes the largest PREPARE_ONLY gap without changing promotion authority.
5. **D5 durable fleet assignment history** — lets C5 issue/recover work from durable state rather than chat context.
6. **D3 WebMCP digest/taint hardening** and **D2 resolver cache/self-heal** — performance accelerators once the authority plumbing is converged.
7. **D7 rich trace sidecars** + **D8 physical canary bench** — measure and shorten final C6 convergence/closure.

## 7. Acceptance checks for the next implementation slices

A candidate implementation should not be promoted merely because the feature works. At minimum:

- exact integration ancestor is recorded;
- no new raw browser/process/network/model authority leaks into planner/control-plane modules;
- every physical adapter binds exact process/browser/sandbox incarnation;
- every consequential action revalidates target immediately before effect;
- `AMBIGUOUS` remains terminal and non-retryable;
- WebMCP/page/model data remains tainted;
- persistent auth context is never concurrently leased or automatically migrated;
- sandbox candidate cannot receive provider credentials directly;
- rich traces are evidence-only and privacy bounded;
- benchmark correctness/safety gates run before performance ranking;
- branch-local CI/evidence is exact-head bound before any separate promotion decision.

## 8. Research conclusion

The highest-value acceleration is architectural compression, not adding frameworks. Compute Unified V1 already owns the semantic planner, WebMCP routing, safety fence, trace, benchmark, pool, adaptive router and Development Plane contract. Modern external systems mainly validate a small set of implementation techniques:

- move transport work close to the browser but keep raw transport private;
- cache **resolved candidates**, never authority;
- bind cache/tool data to fresh browser/document identity;
- model fleet state as durable versioned history;
- treat physical effects as explicit non-retryable ambiguity boundaries;
- schedule remote browsers only after exact readiness/isolation proof;
- use ephemeral VM-backed sandboxes with attested incarnation and credential isolation;
- collect rich traces as sidecar evidence and measure changes against reproducible task benchmarks.

Those techniques accelerate C1–C6 while preserving the R5–R16/B6/DP2 architecture instead of replacing it.
