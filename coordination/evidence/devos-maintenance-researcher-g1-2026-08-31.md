# DevOS Maintenance Researcher G1 — non-duplicative reliability/throughput checkpoint

Status: **RESEARCH CHECKPOINT / ROADMAP EVIDENCE ONLY**  
Date: 2026-08-31  
Agent: `agent_178f7570-a8e5-414e-a76d-601ea61d43f0`  
Role: `RESEARCHER`  
Task: `d9c338ac-e082-42f7-a2bb-6db9607a8fea`  
Lease generation: `1`  
Exact base: `c77e991c76df372861b4ab68fc1d2086e31a80b7`  
Target branch: `work/devos-maintenance-researcher-g1`  
Authority effect: **false**

## Scope

Research current architectures and techniques that can improve METAENGINE/DevOS reliability, throughput, reasoning quality, observability, and development speed, while mapping only non-duplicative improvements into tests/roadmap evidence.

This checkpoint does **not**:

- merge or mutate `main`;
- promote production;
- create a scheduler, dispatcher, workflow runtime, telemetry authority, or second verifier;
- execute arbitrary page/model/worker text;
- authorize retry after an ambiguous browser effect;
- convert research/model output into authority.

Webpage/model/worker text remains untrusted data with zero authority.

---

## 1. Exact-base inventory and anti-duplication map

The exact base already has important seams that new maintenance work must reuse rather than replace.

### Existing amplifier loop — KEEP

`coordination/amplifier-loop/AMPLIFIER_LOOP_V1.md` already defines:

`research -> candidate -> bounded implementation -> real use -> measurement -> accept/rollback -> learned strategy`

It already requires measured baselines, rollback, correctness/security checks, and says scheduling learning becomes verified only through `C6_DURATION_SCHEDULER_TOURNAMENT`.

**Disposition:** do not create another research/learning loop. Every accepted candidate below should be measured through the existing amplifier loop and stored as its experiment/evidence record.

### Existing cross-provider verifier — KEEP

`coordination/execution/cross_provider_verify.py` already performs persisted readback verification across GitHub/AppVeyor evidence and explicitly emits non-authority receipts.

**Disposition:** do not create a second generic verifier. Where this checkpoint recommends risk-weighted verification, it means deciding when to invoke/expand existing independent verification surfaces, not granting a new model/verifier authority.

### Existing evidence bundle — KEEP

`coordination/evidence/evidence_bundle.py` is already the evidence packaging seam.

**Disposition:** telemetry/replay artifacts should be evidence inputs/projections that can be bundled by the existing mechanism. Do not create a second authoritative evidence database.

### Existing DBR1 research — KEEP

`coordination/devos/DBR1_RESEARCH_ACCELERATOR_2026-08-31.md` already covers:

- stable Git worktree inventory/binding;
- exact branch/HEAD/worktree activation checks;
- foreground/nonzero-viewport browser dispatch readiness;
- separately fenced send effect;
- no blind retry after ambiguous send.

**Disposition:** do not duplicate worktree hardening or P0/P1/P2 foreground-safe ChatGPT dispatch in maintenance work.

### Existing supervisor planes in authoritative Supabase — KEEP

Read-only schema inspection on project `xpeibufgzjknrhbhpffp` shows existing Browser supervisor command/state, actuation lease, and supervisor mesh-instance tables. Commands already carry typed status, idempotency key, effect binding, effect-binding digest, receipt, and authority-effect fields.

**Disposition:** do not add another scheduler/lease/command authority. New maintenance components are projections, test harnesses, or shadow recommendations only.

---

## 2. Live failure evidence motivating this slice

Read-only aggregate queries of `compute_fabric_a2_browser_supervisor_command_h205f22` found the following current signal.

### Last 7 days: browser-effect outcome evidence

- `PROVEN_GENERATING`: 8 commands
- `AMBIGUOUS_AFTER_ENTER`: 7 commands
- no effect-state field: 169 commands

This is not a claim that every row is a dispatch attempt; it is evidence that ambiguous irreversible browser effects are frequent enough to deserve first-class replay/observability treatment.

### Last 24 hours: command latency sample

The small current sample included:

- `CAPTURE` completed: n=2, average ~8.037s, p95 ~9.571s
- `SELECT_TAB` completed: n=2, average ~5.221s, p95 ~6.646s
- `SEMANTIC_TYPE` completed: n=2, average ~7.946s, p95 ~11.820s
- `FLEET_RECONCILE` failed: n=1, ~76.071s
- `SEMANTIC_TYPE` failed: n=1, ~4.029s
- `TYPED_CLICK` completed: n=1, ~6.349s

The sample is intentionally not treated as a benchmark because n is tiny. It is sufficient to identify two high-value maintenance questions:

1. can a failed/ambiguous execution be reconstructed deterministically without re-actuating it?
2. can anomalous long/failed flows be retained and correlated without storing every healthy event forever?

### Lease evidence caveat

The actuation-lease table had no rows in the queried seven-day window. Do not infer lease health from absence of data. This itself is an observability gap: a projection must distinguish `NO_EVENTS_OBSERVED` from `HEALTHY`.

---

## 3. External architecture research

Only patterns are imported; external systems do not become METAENGINE authority.

### Temporal: event history + deterministic replay pattern

Temporal's documented reliability model persists workflow event history and reconstructs state by replay after failures. Its AI-agent reference architecture also keeps non-deterministic I/O outside replayed workflow logic because repeating an LLM/tool side effect during replay breaks determinism.

Useful pattern for METAENGINE:

- persist/consume typed transition facts;
- reduce them through pure deterministic state transitions;
- represent external effects as recorded inert outcomes during replay;
- use replay to find non-determinism/regressions, never to repeat side effects.

Rejected import: **Temporal runtime/control plane itself**. METAENGINE already has supervisor/command/lease mechanisms; adding Temporal now would create a second orchestration authority.

Sources retrieved 2026-08-31:

- https://docs.temporal.io/
- https://go.temporal.io/platform-hub/ai-engineering/ai-reference-architecture

### OpenTelemetry: projection + tail-based anomaly retention pattern

OpenTelemetry documents tail sampling as making retention decisions after observing most/all spans in a trace, with policies such as retaining errors, slow traces, or traces with selected attributes. Current Collector guidance warns that all spans of a trace must reach the same tail-sampling decision point for accurate decisions.

Useful pattern for METAENGINE:

- project existing typed events into a trace-like correlation model;
- retain 100% of ambiguous effects, fencing violations, incarnation mismatches, duplicate terminals, and high-latency failures;
- downsample ordinary healthy flows;
- keep bounded-cardinality identity attributes and redact raw prompt/page/model content.

Rejected import: OpenTelemetry as project source-of-truth or authority. Until trusted telemetry gates are satisfied, it is a derived evidence projection only.

Sources retrieved 2026-08-31:

- https://opentelemetry.io/docs/concepts/sampling/
- https://opentelemetry.io/docs/collector/deploy/other/agent-to-gateway/
- https://opentelemetry.io/docs/collector/components/processor/

### Envoy: latency-gradient adaptive concurrency pattern

Envoy's adaptive concurrency filter changes a concurrency limit using sampled request latency versus measured minimum/ideal RTT and adds headroom; it exposes controller statistics and documents that the controller requires control over the concurrency it limits.

Useful pattern for METAENGINE:

- calculate a **shadow recommendation only** from observed queue/latency/error/ambiguity pressure;
- bound recommendation floors/ceilings and add hysteresis/jitter;
- let the existing authoritative scheduler decide whether to use it only after its own roadmap gate/tournament.

Rejected import: an Envoy-derived second scheduler or direct concurrency actuator. The existing C6 scheduler path remains sole future scheduler authority.

Source retrieved 2026-08-31:

- https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/adaptive_concurrency_filter.html

### Adaptive test-time compute for reasoning

Snell et al., published at ICLR 2025, found that the best use of additional test-time compute varies with prompt difficulty and reported >4x efficiency improvement over a best-of-N baseline for their compute-optimal strategy on the studied math setting.

Useful pattern for METAENGINE:

- allocate extra independent verification/research effort by measured task risk/difficulty/evidence deficit;
- do not spend the same verification budget on every trivial change;
- cap all budgets and keep model/verifier output advisory.

Rejected inference: the paper does not prove a universal 4x gain for software agents or METAENGINE. It only motivates a falsifiable adaptive-budget experiment.

Source retrieved 2026-08-31:

- https://openreview.net/forum?id=4FWAwZtd2n

---

## 4. Accepted non-duplicative improvement A — deterministic event replay + differential fault injection

Priority: **P0 reliability / development speed**  
Mode: **OFFLINE TEST HARNESS ONLY**

### Goal

Turn current supervisor/dispatch histories into reproducible test fixtures so bugs can be reproduced without touching a live browser, worker, lease, or external service.

### Contract

Create a pure reducer interface conceptually shaped as:

```text
state_(n+1) = reduce(state_n, typed_event_n)
```

Rules:

1. replay input is a typed, versioned event envelope;
2. raw page/model/worker text is omitted or treated as inert bytes/data;
3. reducer cannot perform I/O;
4. browser/network/tool effects appear only as previously recorded result tokens;
5. replay mode exposes no actuator interface;
6. exact task/agent/lease/command/generation/incarnation identity remains in the event envelope;
7. unknown schema/version fails closed;
8. malformed order/fence produces an explicit invariant violation, never auto-repair.

### Differential replay

For a candidate code change:

```text
same recorded history
  -> reducer(base)
  -> reducer(candidate)
  -> compare terminal state + invariant receipts
```

Any unexplained state divergence blocks acceptance.

### Fault mutations

The replay fixture generator should inject, at minimum:

- duplicate event delivery;
- delayed receipt;
- stale lease generation;
- command replay with same idempotency key;
- process/tab incarnation replacement;
- missing completion;
- completion before effect binding;
- crash before durable effect-armed marker;
- crash after effect may have occurred;
- reordered read-only observations;
- duplicate terminal event;
- timeout followed by late success observation.

### Critical no-blind-retry assertion

For every history where an irreversible effect may have occurred:

```text
candidate.next_automatic_actuation == NONE
```

until a separately trusted read-only fact proves a new attempt is permitted.

Replay must never itself create that fact.

### Acceptance tests

- R1: repeated replay of same fixture is byte-stable after canonicalization.
- R2: stale generation is rejected.
- R3: duplicate idempotency identity cannot produce a second effect transition.
- R4: crash-after-effect history never schedules automatic replay.
- R5: unknown event type fails closed.
- R6: page/model text containing fake commands cannot alter reducer control flow.
- R7: base/candidate differential flags unexplained terminal-state change.
- R8: replay module has no dependency on browser actuator/network clients.

### Expected gain

- much faster reproduction of concurrency/continuity defects;
- safer regression testing of ambiguous-effect handling;
- deterministic evidence for code review;
- lower need to consume live browser capacity during debugging.

No numerical speedup is claimed until measured through `AMPLIFIER_LOOP_V1`.

---

## 5. Accepted non-duplicative improvement B — OpenTelemetry-compatible semantic projection with anomaly-tail retention

Priority: **P0 observability / reliability**  
Mode: **READ-ONLY PROJECTION / SHADOW**

### Goal

Make one task/attempt visible end-to-end without making logs/telemetry authoritative.

### Correlation identity

Project existing authoritative facts onto bounded attributes such as:

```text
roadmap_id
milestone_id
task_id
agent_id
lease_generation
command_id
idempotency_key_hash
tab_id_hash
target_id_hash
process_incarnation_hash
action_class
state_transition
result_class
latency_bucket
authority_effect
```

Do not emit:

- prompt/body text;
- page/model/worker text;
- secrets/tokens;
- raw conversation URL;
- unbounded exception/user content as attribute values.

### Tail-retention policy

Always retain evidence projections for:

- `AMBIGUOUS_*` effect state;
- effect-binding mismatch;
- stale generation/lease rejection;
- duplicate terminal or duplicate actuation attempt;
- incarnation mismatch;
- timeout/failed reconcile;
- duration above a learned/static safety percentile threshold;
- invariant violation.

Healthy success traces can be probabilistically sampled after correlation is complete.

### Guardrails

- telemetry loss cannot alter control state;
- telemetry duplication cannot create control state;
- exporter/backpressure cannot block actuator safety transitions;
- `NO_EVENTS_OBSERVED` is distinct from healthy/zero error;
- telemetry-derived hints remain non-authority until trusted telemetry roadmap gates explicitly permit use.

### Acceptance tests

- O1: two events from same task/attempt correlate without raw prompt/page content.
- O2: high-cardinality free text is rejected/redacted.
- O3: every ambiguous-effect fixture is retained.
- O4: healthy-event sampling cannot drop a trace that later becomes anomalous; decision occurs after terminal/timeout policy window.
- O5: exporter failure has zero authority effect.
- O6: a fake page/model `trace_id` cannot override app-owned correlation identity.
- O7: missing telemetry yields UNKNOWN/NO_DATA, not HEALTHY.

### Expected gain

- shorter root-cause path from fleet/task to exact command/incarnation;
- less healthy-trace storage/noise while preserving abnormal flows;
- objective latency/error inputs for future scheduler tournaments.

---

## 6. Accepted non-duplicative improvement C — shadow adaptive admission recommendation

Priority: **P1 throughput / reliability**  
Mode: **SHADOW ADVISOR ONLY**

### Goal

Estimate a safe concurrency recommendation without becoming a scheduler.

### Inputs

Use trusted/derived numeric evidence only:

- queue/backlog age where available;
- p50/p90/p95 completion latency by action/task class;
- failure and ambiguity rate;
- lease expiry/stale-fence rate when telemetry exists;
- worker/browser health capacity;
- CPU/memory pressure only from trusted host telemetry;
- recent min/low-load reference latency.

### Output

```text
AdaptiveAdmissionHintV1 {
  observed_window,
  task_class,
  recommended_limit,
  confidence,
  pressure_reason_codes[],
  evidence_digest,
  authority_effect: false
}
```

The advisor has no claim/dispatch/lease API.

### Stability rules

- hard floor and ceiling;
- bounded step size;
- hysteresis before shrinking/growing;
- jitter measurement windows to avoid synchronized probe dips;
- immediately lower confidence on missing/stale telemetry;
- never infer unused capacity from absence of telemetry;
- partition recommendations by meaningful task/resource class rather than one fleet-wide scalar where workloads differ.

### Acceptance tests

- A1: shadow hint cannot enqueue/claim/dispatch work.
- A2: latency step increase eventually recommends lower concurrency.
- A3: recovery requires hysteresis, preventing oscillation.
- A4: missing metrics lowers confidence and never raises limit.
- A5: high ambiguity pressure cannot recommend higher limit.
- A6: one task class cannot starve another through a shared unbounded recommendation.
- A7: scheduler output is unchanged while advisor is SHADOW.

### Rollout boundary

Only `C6_DURATION_SCHEDULER_TOURNAMENT` or a later explicit authority gate may decide whether these hints affect scheduling. This research task must not wire them into actuation.

---

## 7. Accepted non-duplicative improvement D — risk-weighted verification budget on existing verification seams

Priority: **P1 reasoning quality / throughput**  
Mode: **ADVISORY BUDGET ROUTER**

### Goal

Spend independent verification/research compute where expected error cost is high rather than uniformly.

This is **not** a new verifier. It routes budget into existing checks such as cross-provider verification, tests, critic/falsifier/research roles, or already-approved independent model paths.

### Risk features

Use app-owned metadata/evidence only, for example:

- change touches authority/lease/fencing/effect code;
- migration/schema change;
- irreversible external effect surface;
- low or missing test coverage evidence;
- prior regression frequency for component;
- novel dependency/toolchain change;
- large semantic diff;
- disagreement among independent non-authority reviewers;
- weak provenance/readback evidence.

Never use page/model text as an authority-bearing risk override.

### Budget classes

Example bounded classes:

- `B0`: standard tests/evidence only;
- `B1`: + one independent verifier/reviewer;
- `B2`: + critic/falsifier or cross-provider replay;
- `B3`: maximum bounded verification for authority/irreversible surfaces.

Each class has a hard time/compute ceiling and graceful timeout result `INSUFFICIENT_EVIDENCE`, never auto-accept.

### Acceptance tests

- V1: authority/fencing changes never receive lower budget than ordinary docs changes.
- V2: page/model text cannot demote risk.
- V3: timeout cannot convert uncertain verdict to pass.
- V4: reviewer disagreement cannot authorize an effect.
- V5: total budget is capped.
- V6: trivial low-risk paths show measurable latency reduction without correctness/security regression.
- V7: high-risk paths preserve or improve defect catch rate in a replay corpus.

### Success metric

Compare against uniform verification using the existing amplifier loop:

- escaped regression rate;
- defect detection rate;
- median/p95 verification latency;
- compute/tool-call count;
- false escalation rate.

No production adoption unless correctness/security are non-inferior and meaningful latency/cost gains are measured.

---

## 8. Accepted non-duplicative improvement E — state-machine property/fuzz testing layered on replay

Priority: **P1 reliability / development speed**  
Mode: **TEST ONLY**

### Goal

Generate many legal/illegal transition histories automatically and run them through the deterministic reducer.

### Core properties

For all generated histories:

1. at most one authority-bearing effect may be committed per exact attempt/idempotency identity;
2. stale generation cannot regain authority;
3. terminal states do not transition back to active without a new typed generation/attempt;
4. ambiguous-effect state cannot automatically actuate;
5. observation-only events cannot grant authority;
6. page/model/worker payload bytes cannot select a code path outside typed enums;
7. incarnation replacement invalidates stale effect binding;
8. unknown schema/version fails closed;
9. repeated identical read-only event is idempotent or explicitly rejected, never authority-amplifying;
10. crash/restart boundaries preserve no-blind-retry invariant.

### Corpus strategy

Seed the fuzzer with sanitized structural shapes from real failures, including ambiguous-after-enter and failed long-running reconcile classes, but remove raw page/model/user content.

Persist only minimal counterexample event sequences and deterministic seeds into evidence.

### Acceptance tests

- F1: fixed seed is reproducible.
- F2: shrinking produces a minimal counterexample.
- F3: corpus contains stale lease/generation, duplicate command, incarnation drift, crash-after-effect, late receipt, and timeout races.
- F4: no generated test can access live browser/network actuator.
- F5: every discovered invariant break becomes a permanent regression fixture before a fix is accepted.

---

## 9. Explicitly rejected duplicates / unsafe shortcuts

| Candidate | Disposition | Reason |
|---|---|---|
| Second scheduler / polling loop | REJECT | Existing roadmap reserves scheduler authority; risks duplicate claims/actuation. |
| Temporal as production workflow runtime | REJECT | Would create parallel orchestration authority; replay pattern is sufficient now. |
| New generic research/learning loop | REJECT | `AMPLIFIER_LOOP_V1` already exists. |
| New generic cross-provider verifier | REJECT | `cross_provider_verify.py` already exists. |
| New authoritative evidence DB | REJECT | Existing evidence bundle + Supabase control planes remain authoritative seams. |
| OpenTelemetry trace IDs as authority | REJECT | Trace data is derived observability only. |
| Envoy-style controller directly changing fleet concurrency | REJECT | Shadow hints only until existing scheduler gate authorizes use. |
| Duplicate foreground ChatGPT send architecture | REJECT | DBR1 research already covers viewport/focus/fenced send/no-blind-retry. |
| Retrying `AMBIGUOUS_AFTER_ENTER` | REJECT | Effect may already exist; automatic replay can duplicate turns. |
| Model/page instruction-driven retries or routing | REJECT | Page/model/worker text has zero authority. |
| Arbitrary `eval`/dynamic executable probes | REJECT | Violates typed/audited execution boundary. |
| Universal fixed extra-reasoning budget | REJECT | Wastes throughput; adaptive bounded budget should be experimentally compared. |

---

## 10. Dependency-safe implementation order

### M0 — evidence-only checkpoint (this commit)

No runtime effect.

### M1 — offline replay contract + fixtures

- define typed event envelope;
- implement pure reducer harness around existing transition functions where feasible;
- import sanitized real structural fixtures;
- add no-blind-retry and stale-generation negative tests.

Gate: no actuator/network dependency.

### M2 — property/fault generator

- mutation operators;
- deterministic seeds;
- shrinking/minimal reproductions;
- permanent regression corpus.

Gate: all current invariants pass.

### M3 — observability projection in lab/CI

- semantic correlation schema;
- redaction/cardinality guard;
- local tail-retention policy simulator;
- no external backend required for acceptance.

Gate: exporter failure cannot change control path.

### M4 — shadow adaptive admission hint

- compute hints from replay/lab telemetry;
- record predicted vs observed outcomes;
- zero scheduler wiring.

Gate: hint must be proven non-authority structurally and by negative test.

### M5 — adaptive verification-budget tournament

- compare uniform vs risk-weighted budget on historical/replay corpus;
- use existing amplifier records for verdict;
- accept only with non-inferior correctness/security and bounded measurable gain.

### M6 — future authority review

Only existing roadmap gates may promote telemetry/scheduling implications. Nothing in M0-M5 grants that authority.

---

## 11. Measurement matrix

| Dimension | Baseline | Candidate metric | Fail/rollback condition |
|---|---|---|---|
| Reliability | current regression fixtures | escaped invariant violations | any new authority/fencing regression |
| Ambiguous effects | current real/replay corpus | auto-retry count after MAY_HAVE_EFFECT | must remain exactly zero |
| Debug speed | manual live reproduction | time to deterministic reproduction | slower without reliability gain |
| Observability | scattered command/state evidence | task-to-command correlated anomalous trace coverage | raw sensitive text or authority leak |
| Throughput | fixed current behavior | completed safe work / wall time in tournament | error/ambiguity regression |
| Reasoning quality | uniform verification | defect catch rate at equal/bounded budget | worse catch rate on high-risk corpus |
| Storage/noise | retain-everything simulation | anomaly retention + healthy sample volume | anomalous trace dropped |
| Scheduler safety | current scheduler output | shadow hint divergence only | hint changes dispatch before gate |

---

## 12. Severity-ranked falsification targets

### P0

1. **Replay accidentally actuates a side effect.** Fix: compile/runtime dependency boundary; no actuator imports.
2. **Telemetry becomes implicit authority.** Fix: typed `authority_effect:false`, negative tests, control code cannot depend on exporter success.
3. **Shadow advisor becomes a second scheduler.** Fix: no enqueue/claim/lease APIs; compare outputs only.
4. **Ambiguous history replays a browser effect.** Fix: `MAY_HAVE_EFFECT => automatic_actuation=NONE` invariant.
5. **Correlation identity can be injected by page/model text.** Fix: app-owned IDs only; raw content rejected from identity fields.

### P1

6. Tail sampler drops a trace before late failure arrives. Fix: terminal/timeout decision window and anomaly override.
7. Risk router under-allocates authority changes. Fix: static minimum-risk floors for authority/fencing/DDL/effect surfaces.
8. Adaptive concurrency hint oscillates. Fix: hysteresis, bounded step, confidence decay, jitter.
9. Fuzz generator creates unrealistic histories only. Fix: seed from sanitized real transition structures plus grammar constraints.
10. Missing telemetry is mistaken for zero errors. Fix: three-valued `HEALTHY / UNHEALTHY / NO_DATA` projection semantics.

---

## 13. Expected portfolio impact

The strongest non-duplicative portfolio is deliberately narrow:

1. **Replay/fault harness** raises reliability and drastically shortens safe debugging loops.
2. **Semantic anomaly projection** makes long/ambiguous failures diagnosable without creating telemetry authority.
3. **Shadow adaptive admission** provides evidence for future throughput improvements without a second scheduler.
4. **Risk-weighted verification budget** targets reasoning/verification compute where it has the highest expected value.
5. **Property/fuzz testing** turns newly discovered race conditions into permanent executable regressions.

These components reinforce rather than replace the existing amplifier loop, verifier, evidence bundle, supervisor state/command planes, DBR1 transport research, and C6 scheduler roadmap.

## Final research disposition

**ACCEPT FOR BRANCH-LOCAL FOLLOW-UP:** M1 replay harness, M2 property/fault tests, M3 semantic observability projection.  
**KEEP SHADOW / TOURNAMENT ONLY:** M4 adaptive admission hint, M5 risk-weighted verification budget.  
**REJECT AS DUPLICATE OR UNSAFE:** second scheduler, second research loop, second verifier, Temporal runtime migration, telemetry authority, blind retry, arbitrary eval, page/model authority.

No production acceptance is claimed by this checkpoint.
