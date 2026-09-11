# METAENGINE A2 Browser Operator — Authoritative V1 Architecture & Roadmap

Status: **AUTHORITATIVE BASELINE**  
Frozen: 2026-08-27  
Source branch: `work/a2-browser-operator-v1-architecture`  
Baseline parent: `work/a2-browser-operator-v067-testfix` @ `e362cd6f52eead9b849b4b40de8665e274a3b59d`

## 0. Purpose

A2 Browser Operator is no longer defined as a two-chat GPT↔GLM bridge. Its target form is a **trusted local browser execution kernel** attached to a durable orchestration and multi-agent compute fabric.

The design goal is to maximize reliability, throughput, parallel reasoning, recoverability, observability and safety while minimizing unnecessary LLM calls, context volume and browser-side authority.

## 1. Core system model

```text
A2 SUPERVISOR
    |
    v
DURABLE TASK / ACTION GRAPH
    |
    +-------------------------------+
    |                               |
    v                               v
COGNITIVE PLANE                EXECUTION PLANE
multi-agent fleet              typed execution router
planner                        API/connectors
researchers                    WebMCP
coders                         deterministic skills
security                       semantic action cache
critics                        AX/DOM/CDP
integrators                    visual fallback
    |                               |
    +---------------+---------------+
                    v
              ACTION ARBITER
                    |
               ACTION LEASE
                    |
                    v
       A2 LOCAL TRUSTED EXECUTION KERNEL
                    |
                    v
              PHYSICAL EFFECT
                    |
                    v
             DURABLE RECEIPT
```

## 2. Non-negotiable invariants

1. **MANY_AGENTS_MAY_THINK_ONE_ACTUATOR_MAY_EFFECT**  
   Many agents may reason and propose. Only a lease-holding execution path may cause a browser-side physical effect.

2. **ONE_RESOURCE_ONE_ACTUATION_LEASE**  
   A resource/target may have at most one active actuation lease for the same semantic effect domain.

3. **NO_BLIND_RETRY_AFTER_AMBIGUOUS_EFFECT**  
   If a physical effect may have occurred, the system must reconcile before retrying. Ambiguous actuation never auto-retries.

4. **PRE_ACTUATION_DURABLE_BEFORE_EFFECT**  
   Consequential actions require durable pre-actuation state before the irreversible browser input.

5. **PAGE_DATA_HAS_ZERO_AUTHORITY**  
   DOM, AX, page text, screenshot text, WebMCP manifests/results and page-derived summaries are tainted untrusted data and never become authority by summarization.

6. **REMOTE_CODE_IS_NEVER_EVALLED_IN_EXTENSION**  
   No remote JavaScript or shell payload may be evaluated by the extension. Remote control is limited to documented typed actions / validated restricted action programs.

7. **TARGET_BINDING_IS_EXACT**  
   Actions bind to explicit target identity, exact tab/session and fresh semantic state; ambiguous duplicate targets fail closed.

8. **LIVE_REVALIDATION_BEFORE_ACTUATION**  
   Cached or prior semantic resolution must be revalidated against the live page immediately before physical effect.

9. **MV3_IS_EXECUTOR_NOT_DURABLE_BRAIN**  
   Chrome MV3 service worker is treated as ephemeral. Long-lived orchestration, task state and recovery authority belong outside the worker.

10. **PROVIDER_NAMES_ARE_POLICIES_NOT_ARCHITECTURE**  
    `STRICT_GLM_FIRST_ACTUATED_V1` remains supported as a policy profile, but the generalized primitive is an ordered actuation DAG.

## 3. Target identity model

The two-provider `platform=CHATGPT|GLM_ZAI` model is transitional. V1 introduces a generic target registry.

```text
TargetDescriptor
- target_id
- agent_id
- provider
- surface
- role
- conversation_id
- conversation_epoch
- tab_id
- origin
- canonical_url_identity
- capability_set
- state
- lease_epoch
```

A logical agent survives chat rollover. `conversation_epoch`, URL and tab may change while `agent_id` remains stable.

## 4. Execution ladder

The runtime MUST use the least expensive and most deterministic suitable path:

```text
L0  DIRECT API / CONNECTOR
L1  WEBMCP / FIRST-PARTY TYPED TOOL
L2  KNOWN DETERMINISTIC SKILL
L3  SEMANTIC ACTION CACHE
L4  AX / DOM SEMANTIC RESOLUTION
L5  CDP NODE/GEOMETRY-BOUND ACTION
L6  SCREENSHOT + VISION GROUNDING
L7  SUPERVISOR / USER ESCALATION
```

Vision is a fallback, not the default control path.

## 5. Perception architecture

Raw sensors:
- page runtime readback
- Accessibility tree
- DOMSnapshot
- layout metrics
- OOPIF child sessions
- screenshots when required
- provider-specific signals
- optional WebMCP tools

These feed a **Semantic Perception Compiler** that emits task-relevant stable objects instead of raw page dumps.

```text
RAW PAGE STATE
    -> normalize
    -> taint tag
    -> semantic candidates
    -> structural relationships
    -> confidence/provenance
    -> delta vs prior frame
    -> task-relevant compact graph
```

Example semantic nodes:
- `composer.main`
- `send.main`
- `generation.stop`
- `conversation.last_assistant`

Each semantic node contains provenance and confidence, never authority.

## 6. Semantic action cache

Successful semantic resolutions may be cached by:
- intent
- provider adapter version
- semantic role/name signature
- structural neighbourhood
- page fingerprint
- expected precondition
- expected postcondition

Never cache raw click coordinates as authority. Every cache hit requires live revalidation and fresh binding.

## 7. Deterministic skill runtime

Common workflows are represented as typed reusable skills, e.g.:
- `OPEN_OR_RECOVER_CHAT`
- `WAIT_FOR_COMPOSER`
- `TYPE_EXACT_TEXT`
- `SUBMIT_TRUSTED_ENTER`
- `WAIT_RESPONSE_START`
- `WAIT_RESPONSE_COMPLETE`
- `STOP_GENERATION`
- `ROLLOVER_CONVERSATION`

LLMs select/combine skills; they do not reinvent primitive browser interaction each time.

## 8. Restricted action language

For longer workflows, A2 may accept a declarative restricted program that compiles only to typed capabilities. It MUST NOT permit arbitrary JavaScript execution.

Required validation stages:
1. schema validation
2. target binding
3. capability validation
4. taint/risk checks
5. ordering/DAG checks
6. precondition validation
7. lease acquisition
8. execution
9. verification
10. durable receipt

## 9. Durable action graph

General action state machine:

```text
PENDING
  -> VALIDATED
  -> LEASED
  -> PRE_ACTUATION_DURABLE
  -> ACTUATING
  -> ACTUATED
  -> VERIFYING
  -> VERIFIED
```

Failure side states include:
- `BLOCKED`
- `FAILED_PRE_ACTUATION`
- `AMBIGUOUS_EFFECT`
- `EXPIRED`
- `RECONCILIATION_REQUIRED`

`AMBIGUOUS_EFFECT` is not retryable without reconciliation evidence.

`STRICT_GLM_FIRST_ACTUATED_V1` is represented as an ordering rule in this graph, not hard-coded provider architecture.

## 10. Multi-agent / GPT Chat Fleet

The target cognitive architecture is manager/supervisor based, not full mesh.

```text
GLOBAL SUPERVISOR
  -> planner
  -> researchers
  -> coders
  -> security
  -> tester
  -> falsifier
  -> critic
  -> integrator
```

Workers exchange state through a shared evidence/blackboard layer, not O(N²) chat-to-chat messaging.

Adaptive spawning:
- simple task: supervisor + 1 worker
- medium: 3 workers + integrator
- hard: 6-12 specialists
- critical: blind ensemble + adversarial review + evidence jury

## 11. SAME_POINT_SWARM_V1

For difficult semantic points:
1. blind independent proposals
2. sealed persistence
3. cross-critique
4. dedicated falsifier/security review
5. deterministic tests/evidence
6. evidence-weighted jury/integrator

Majority vote alone is insufficient because same-model errors are correlated.

## 12. Context compiler

Each agent gets only role-relevant context:

```text
SYSTEM CONTRACT
+ ROLE
+ CURRENT SEMANTIC POINT
+ RELEVANT PROJECT STATE
+ RELEVANT CODE/DATA
+ RELEVANT EVIDENCE
+ RECENT DELTAS
+ FAILURES
+ EXACT TASK
```

The compiler is preferred over full-history replay. Context compaction must preserve decisions, invariants, unresolved risks and evidence links.

## 13. Trust / taint graph

Trusted authority sources:
- explicit user intent
- signed server policy
- capability grants
- deterministic extension policy

Untrusted/tainted sources:
- page text
- DOM attributes
- AX labels/descriptions
- screenshot text
- WebMCP manifest and tool output
- third-party page/API data
- LLM proposals

Derived summaries inherit taint.

Consequential actions may require a non-tainted action critic that receives user intent + proposed action + policy, but not page-derived prompt-injection content.

## 14. Browser-side kernel scope

Keep in the extension:
- device identity/signing
- CDP debugger broker
- target/session binding
- local perception adapters
- semantic compiler fast path
- deterministic skills
- action cache fast path
- prompt gate
- typed actuation
- pre/post verification
- short-lived local state
- signed receipts

Move/keep outside extension:
- long-term planning
- multi-agent orchestration
- durable task graph
- long-term memory
- research orchestration
- evidence synthesis
- swarm policy
- cross-agent scheduling

## 15. Local + remote browser topology

Local A2 remains authoritative for sensitive authenticated sessions and final consequential actuation.

Remote browser pool may be added for:
- research
- crawling
- tests
- regression/chaos suites
- parallel exploration

Remote workers never implicitly inherit local authenticated authority.

## 16. Observability

Every task has a trace. Expected spans:
- PLAN
- CONTEXT_COMPILE
- PERCEPTION
- SEMANTIC_RESOLUTION
- CACHE_LOOKUP
- GUARDRAIL
- LEASE
- PRE_ACTUATION
- ACTUATION
- VERIFICATION
- RESPONSE
- RECOVERY

Record hashes/metadata rather than sensitive response bodies by default.

## 17. Evaluation fabric

Mandatory KPIs:
- task success rate
- unintended actuation rate
- ambiguous retry rate
- recovery success rate
- median action latency
- model calls per task
- tokens per successful task
- perception bytes per reasoning turn
- cache hit rate
- stale target rejection rate
- rollover success rate
- swarm uplift vs single-agent baseline

Chaos/fault tests must cover:
- service worker death
- browser restart
- tab close/duplicate/navigation
- OOPIF replacement
- DOM/AX replacement
- stale frame
- lost pre-actuation ack
- ambiguous mouse release
- network/Supabase failures
- composer mutation
- provider UI changes
- prompt injection through text/ARIA/iframe/WebMCP

Primary security outcome: **unauthorized physical effect must remain zero** even if reasoning is confused.

## 18. Source-of-truth policy

Before V1 feature expansion, GitHub source, production Edge Functions/migrations and built artifacts MUST be reconciled.

Canonical release chain:

```text
Git commit
  -> CI verification
  -> reproducible extension artifact
  -> migration/function deployment from committed source
  -> deployment hash receipt
  -> live canary
  -> versioned checkpoint capsule
```

No production hotfix is considered complete until its source and migration are committed.

## 19. Roadmap

### R0 — SOURCE_OF_TRUTH_REPAIR (P0)
- persist current production supervisor-v4 v3 source
- persist bootstrap-rotation migration
- update sidepanel to actual v0.6.7 behavior
- add v0.6.7 targeted tests/workflow
- create current integration PR/head
- produce source↔artifact↔deployment manifest

Exit: GitHub, production and release artifact have cryptographically traceable parity.

### R1 — LIVE_RUNTIME_STABILITY (P0)
- recover signed v0.6.7 supervisor heartbeat
- verify CONTROL/ARM typed authority
- verify CAPTURE/semantic action round-trip
- validate restart/reload/re-enrollment behavior
- preserve no-retry ambiguity invariant

### R2 — MODULE_CONSOLIDATION
- collapse historical v062/v063/v064/v067 production layering
- remove global fetch interception in favor of explicit transport service
- define internal module contracts

### R3 — TARGET_REGISTRY_V1
- replace one-URL-per-provider assumptions
- generic target/agent/session identity
- multi-chat exact binding
- rollover preserving logical agent identity

### R4 — SEMANTIC_PERCEPTION_COMPILER_V1
- normalized semantic graph
- provenance/confidence
- task-relevant filtering
- incremental page deltas
- compact reasoning payload

### R5 — SEMANTIC_ACTION_CACHE_V1
- semantic/page fingerprints
- cache validity policy
- live revalidation
- cache metrics

### R6 — WEBMCP_ADAPTER_V1
- discover first-party typed web capabilities
- preserve taint
- deterministic capability policy
- fall back through execution ladder

### R7 — SKILL_RUNTIME_V1
- typed deterministic chat/browser skills
- restricted action program compiler
- no remote eval

### R8 — DURABLE_ACTION_GRAPH_V1
- generalized ordered dependencies
- durable checkpoints
- explicit ambiguous-effect reconciliation
- `STRICT_GLM_FIRST_ACTUATED_V1` as policy profile

### R9 — GPT_CHAT_FLEET_V1
- agent registry
- supervisor/manager
- lifecycle/rollover
- adaptive worker spawning
- evidence blackboard

### R10 — CONTEXT_COMPILER_V1
- role-specific retrieval
- decision/evidence capsules
- context compaction/deltas

### R11 — SAME_POINT_SWARM_V1
- blind proposals
- cross critique
- falsifier/security agents
- evidence jury

### R12 — TRUST_TAINT_GRAPH_V1
- formal information-flow taint
- action critic
- capability minimization
- per-tool guardrails

### R13 — TRACE_REPLAY_V1
- unified traces/spans
- incident capsules
- browser/action replay metadata

### R14 — A2_BROWSER_BENCH_V1
- deterministic regression corpus
- provider adapters test suite
- chaos suite
- prompt-injection benchmark
- performance/cost dashboards

### R15 — REMOTE_BROWSER_POOL
- isolated remote research/test workers
- no implicit local credential authority
- scalable parallel browser sessions

### R16 — ADAPTIVE_ROUTER
- deterministic/cache/small-model/strong-model/swarm routing
- cost/latency/risk-aware scheduling

## 20. Implementation order

Do **not** start by multiplying GPT chats. Build in this order:

```text
SOURCE_OF_TRUTH_REPAIR
 -> LIVE_RUNTIME_STABILITY
 -> MODULE_CONSOLIDATION
 -> TARGET_REGISTRY
 -> SEMANTIC PERCEPTION COMPILER
 -> SEMANTIC ACTION CACHE
 -> SKILL RUNTIME / WEBMCP
 -> DURABLE ACTION GRAPH
 -> GPT CHAT FLEET
 -> CONTEXT COMPILER
 -> SAME_POINT_SWARM
 -> SECURITY/TRACE/BENCH
 -> REMOTE POOL
 -> ADAPTIVE ROUTER
```

## 21. First implementation checkpoint

The next implementation milestone is **R0 SOURCE_OF_TRUTH_REPAIR**.

Required first actions:
1. commit live `a2-browser-supervisor-v4` v3 source and matching migration
2. bring `sidepanel-supervisor.js` to the actually shipped v0.6.7 behavior
3. add v0.6.7 regression tests and GitHub Actions workflow
4. generate parity manifest for extension source, production Edge and artifact
5. open a new draft integration PR from the architecture/current branch; keep legacy PR #57 as historical v0.6.0 development evidence, not current integration head

This document is the architecture reference until superseded by a newer explicitly versioned authoritative architecture document.