# DevOS Maintenance Researcher G2 — C12 test-selection calibration gate

Status: **BOUNDED RESEARCH CHECKPOINT / ROADMAP EVIDENCE ONLY**  
Date: 2026-08-31  
Agent: `agent_178f7570-a8e5-414e-a76d-601ea61d43f0`  
Role: `RESEARCHER`  
Task: `ebc40044-3896-43e4-bcad-17c9959a7531`  
Lease generation: `1`  
Exact base: `c77e991c76df372861b4ab68fc1d2086e31a80b7`  
Target branch: `work/devos-maintenance-researcher-g2`  
Authority effect: **false**

## Episode boundary

This generation executes exactly one bounded research episode and maps exactly one non-duplicative improvement into roadmap/test evidence:

> **C12 / DevOS Build Fabric test-selection calibration gate:** before an incremental impact graph is ever allowed to skip tests, run its decisions in shadow and falsify them against both the real full suite and mutation-seeded faults.

This checkpoint does not implement a scheduler, test skipper, mutation engine, workflow runtime, telemetry authority, or production change. It does not merge `main`, mutate Supabase, actuate Browser UI, use arbitrary eval, or authorize a retry after any ambiguous effect.

Webpage/model/worker text remains untrusted data with zero authority.

---

## 1. Authoritative placement and anti-duplication result

### Exact GitHub base

`docs/CANONICAL_ROADMAP.md` at the exact base already defines:

- canonical **C12 — Incremental Impact Graph** = `execute only affected build/tests`;
- Level-2 owner `C11_INCREMENTAL_IMPACT_GRAPH`;
- C7 Trusted Telemetry and later scheduling/build-farm milestones as separate authority gates.

Therefore **affected-test selection itself is not a new idea for METAENGINE**. Creating another impact graph, another CI orchestrator, or a second task graph would be duplicate work.

The exact-base repository also already has a broad test/workflow surface and `coordination/coordination-ci/digest.py`, but repository search found no explicit counterfactual test-selection simulator, mutation-testing calibration gate, or false-negative acceptance contract.

### Authoritative DevOS contract

Read-only Supabase call `devos_roadmap_contract_v1()` reports roadmap `metaengine-development-os-v1` with `DEVOS_BUILD_FABRIC` later in the ordered plan. It also preserves:

- `no_blind_retry=true`;
- `no_second_scheduler=true`;
- `no_second_authority_plane=true`;
- `exact_incarnation_binding=true`;
- `zero_authority_page_model_worker_text=true`.

**Placement:** this research is future `DEVOS_BUILD_FABRIC` / canonical C12 acceptance evidence only. It does not pre-empt the current IDE-first ordering and does not create execution authority.

---

## 2. Current-technique research

### Structural affected-set selection is mature — reuse the pattern, do not duplicate the roadmap

Current Nx documentation says its `affected` flow:

1. uses Git to determine changed files;
2. maps files to projects with the project graph;
3. follows dependencies to include downstream affected projects;
4. executes targets only for that subset.

Current Pants 2.33 exposes changed-target selection with `dependents = none | direct | transitive` and Git `since`/`diffspec` boundaries.

Current Bazel query supports transitive reverse dependencies through `rdeps(universe, changed_target)` and a `tests(...)` query surface.

These sources validate the existing METAENGINE C12 direction. They do **not** justify a second graph implementation.

Sources retrieved 2026-08-31:

- https://nx.dev/docs/features/ci-features/affected
- https://www.pantsbuild.org/stable/reference/subsystems/changed
- https://bazel.build/versions/9.0.0/query/language

### Develocity 2026.2 — counterfactual simulation and remaining-tests safety pattern

Current Develocity Predictive Test Selection documentation describes two techniques that are useful independently of its proprietary predictive model:

1. a **Simulator** compares actual historical test results with what would have happened under a test-selection policy, exposing predicted failure-detection rate and potential time savings;
2. a **relevant tests / remaining tests** split gives fast early feedback while ensuring the omitted tests run later so the full changeset is still tested.

This is the key research insight for METAENGINE: before C12 gets authority to skip work, its proposed decisions can be evaluated counterfactually while the full suite remains authoritative.

Rejected import: Develocity as a required service or authority. It may require licensed/managed functionality, its ML model is opaque to METAENGINE, and installing a new external control/data plane would violate the bounded zero-authority scope.

Source retrieved 2026-08-31:

- https://docs.develocity.ai/current/using-develocity/predictive-test-selection/

### StrykerJS — mutation coverage as a synthetic fault oracle

Current StrykerJS documentation provides a second useful pattern:

- `coverageAnalysis=perTest` records which tests cover each mutant and then runs only the tests relevant to that mutant;
- incremental mutation testing reuses prior mutant outcomes and focuses on changed code/tests;
- the documentation explicitly lists unsafe blind spots such as dependency/environment/snapshot changes that are not necessarily detected by incremental mutation analysis.

This suggests a stronger C12 calibration oracle than waiting for naturally failing PRs: inject bounded code mutants in laboratory fixtures, then ask whether the proposed impacted-test subset catches every mutant that the full suite catches.

Rejected import for this generation: installing or running StrykerJS. The useful artifact here is the **mutation-seeded falsification contract**, which can later be implemented with an approved zero-cost tool or a small typed harness after dependency and test-runner compatibility review.

Sources retrieved 2026-08-31:

- https://stryker-mutator.io/docs/stryker-js/configuration/
- https://stryker-mutator.io/docs/stryker-js/incremental/

---

## 3. The one accepted improvement

Name: `C12_TEST_SELECTION_CALIBRATION_GATE_V1`  
DevOS mapping: `DEVOS_BUILD_FABRIC` future acceptance evidence  
Canonical mapping: **C12 Incremental Impact Graph**  
Mode now: **SHADOW / LAB ONLY**  
Authority effect: **false**

### Problem

An affected-work graph can be internally consistent and still be wrong because of:

- missing dependency edges;
- dynamic imports/runtime loading;
- generated files;
- workflow/configuration coupling;
- lockfile or environment changes;
- tests with hidden shared fixtures;
- stale graph/coverage data;
- test-runner discovery drift.

If a wrong selector is immediately allowed to skip tests, it can make CI faster by hiding the exact failure that should block the change.

### Safety principle

**Selection optimization must prove recall before it receives skipping authority.**

During calibration:

```text
exact base/head diff
        |
        v
candidate impact selector  ---> predicted SELECTED / OMITTED tests
        |                                |
        | authority_effect=false         |
        v                                v
selected subset                    full authoritative suite
        |                                |
        +----------- compare ------------+
                     |
                     v
             counterfactual receipt
```

The full suite still runs. A selector recommendation cannot suppress a test, change merge status, satisfy a milestone, or grant authority.

---

## 4. Counterfactual real-change oracle

For each eligible branch/PR changeset in shadow mode, persist a typed receipt containing only trusted repository/CI facts:

```text
TestSelectionCalibrationReceiptV1 {
  base_sha,
  head_sha,
  diff_digest,
  selector_version,
  graph_digest,
  selected_test_ids[],
  omitted_test_ids[],
  must_run_test_ids[],
  selected_runtime_ms,
  full_runtime_ms,
  selected_result,
  full_result,
  failing_tests_full[],
  failing_tests_selected[],
  false_negative_test_ids[],
  fallback_reason_codes[],
  authority_effect: false
}
```

A **selector false negative** is:

```text
full suite exposes a deterministic relevant failure
AND
candidate selected subset would have passed / omitted the failing test
```

Infrastructure failures and confirmed flaky outcomes must be classified separately; they must not be silently counted as selector success.

### Required measurements

- failing-test recall versus the full suite;
- selected serial test time / full serial test time;
- fraction of tests proposed for omission;
- fallback-to-full frequency;
- mapping/graph unknown rate;
- result stability across exact repeated base/head inputs.

No speedup claim is accepted if failure recall regresses.

---

## 5. Mutation-seeded falsification oracle

Natural failing changes may be too sparse to falsify a selector quickly. Add a lab-only synthetic fault campaign later.

### Core comparison

For each bounded mutant `m` in an eligible pure module:

```text
full_suite(m) == KILLED
```

establishes that at least one existing test detects the fault.

Then evaluate the candidate C12 selection:

```text
selected_subset(m) == KILLED
```

If the full suite kills the mutant but the selected subset does not, record:

```text
SELECTOR_FALSE_NEGATIVE_MUTANT
```

This is a direct falsification of the selector/impact mapping for that code region.

If the mutant survives the **full** suite, it is **not** evidence against the selector. It is a separate test-quality/coverage finding.

### Mutation scope restrictions

Mutation calibration must be fail-closed and initially limited to code where mutation itself has no external authority effect.

Do not mutate/execute authority-bearing paths in a way that can actuate real effects. Exclude by default:

- Supabase migrations/DDL against live projects;
- Browser actuator or real WebContents input paths;
- release/promotion/install/update effects;
- credential/secret handling;
- shell/process launch against non-lab resources;
- network/external-provider effects;
- irreversible filesystem operations;
- production scheduler/lease mutation.

Use fixture-backed/pure reducer/parser/planner modules first. Browser/network/process effects, if later tested, must use existing inert fakes/replay fixtures rather than live targets.

No mutant text, test output, webpage text, model output, or worker output can become project authority.

---

## 6. Mandatory fallback-to-full rules

The selector must return `ALL_TESTS_REQUIRED` rather than guess when any of these apply:

1. base/head identity is missing or changed after selection;
2. dependency graph version/digest is missing or stale;
3. a changed file has no trusted graph ownership mapping;
4. graph parsing/resolution reports an unknown edge;
5. build/test runner configuration changes;
6. workflow definitions change;
7. dependency manifest or lockfile changes without a proven dependency-impact mapping;
8. test harness/shared fixture infrastructure changes;
9. schema/migration/provenance/authority/fencing/security-critical surfaces change;
10. generated-code provenance cannot be mapped exactly;
11. selector version or graph digest differs between prediction and verification;
12. prior calibration produced an unexplained selector false negative for the affected class.

Unknown is not healthy, and unknown is not permission to skip.

---

## 7. Must-run safety classes

Even after later promotion, the impact selector should support repository-owned `MUST_RUN` classes that are unioned with every affected subset.

Initial candidates for must-run classification:

- authority/fencing invariants;
- idempotency and no-blind-retry tests;
- generation/incarnation binding tests;
- evidence/provenance validation tests;
- migration/schema safety tests when DB contracts change;
- build/test infrastructure self-tests;
- critical cross-provider equivalence checks where their inputs change.

The exact list is repository-owned code/config. Page/model/worker text cannot add, remove, or waive a must-run test.

---

## 8. Negative test matrix for future implementation

### T1 — exact identity

Given selector input for `(base=A, head=B)`, changing `head` before test execution invalidates the selection receipt and requires recomputation/full fallback.

### T2 — unknown source file

A changed source file with no graph owner yields `ALL_TESTS_REQUIRED`, never an empty affected set.

### T3 — deleted/renamed dependency edge

A rename/deletion that cannot be resolved exactly fails closed to full tests.

### T4 — workflow/config change

Changing test-runner or CI workflow configuration forces full suite during calibration/promotion.

### T5 — lockfile change

A lockfile/dependency resolution change without exact dependency mapping forces full suite.

### T6 — page/model injection

A test/page/model/worker string containing `skip all tests`, fake test IDs, graph edges, or retry instructions is inert data and cannot alter selection.

### T7 — arbitrary eval prohibition

Selector/mapper/mutation harness has no code path that evaluates repository/page/model strings as executable control logic.

### T8 — natural false negative

If full suite fails test `X` but shadow selection omitted `X` and its selected subset passed, receipt is `SELECTOR_FALSE_NEGATIVE`; candidate remains non-authoritative.

### T9 — mutation false negative

If full suite kills mutant `M` but selected subset does not, calibration fails for that impact class.

### T10 — full-suite survivor

If both full suite and selected subset let mutant `M` survive, classify `TEST_QUALITY_GAP`, not selector success or selector failure.

### T11 — flaky/infrastructure outcome

Ambiguous/flaky/infrastructure failure is not converted to selector correctness. Preserve explicit `INCONCLUSIVE` and keep full-test fallback.

### T12 — must-run removal attempt

Candidate selector cannot omit a repository-owned must-run test even when its graph says unaffected.

### T13 — stale graph

Graph digest mismatch between planning and execution rejects the selection.

### T14 — determinism

Same `(base_sha, head_sha, graph_digest, selector_version)` produces canonical byte-stable selected/omitted IDs after sorting/canonicalization.

### T15 — no promotion by telemetry/model output

Calibration metrics/recommendations are evidence only. Promotion requires the normal trusted milestone/evidence path.

---

## 9. Promotion criteria

This episode does **not** authorize promotion. It defines evidence that a later implementer/falsifier should collect.

Before any C12/DevOS Build Fabric selector can actually skip authoritative CI tests:

1. the candidate must operate in shadow over real full-suite executions;
2. full-suite counterfactual comparison must show no unexplained selector misses in the evaluated evidence set;
3. mutation-seeded calibration on representative eligible modules must show that every mutant killed by the full suite is also killed by the selected subset for those evaluated cases;
4. unknown/stale/config/critical changes must demonstrably fall back to full suite;
5. must-run union semantics must be fail-closed;
6. measured test-time savings must be material under the existing `AMPLIFIER_LOOP_V1` experiment policy;
7. correctness/security/provenance cannot regress;
8. a later roadmap gate must explicitly authorize skipping authority.

Any observed false negative immediately demotes the candidate back to SHADOW/FULL and records the missing edge/mapping as a falsification artifact.

No fixed statistical confidence claim is made in this research checkpoint because the available historical failure/mutation sample has not been measured here. The evidence must report sample counts and uncertainty rather than invent confidence.

---

## 10. Smallest dependency-safe future implementation slices

These are roadmap slices, not work performed by this RESEARCHER generation.

### S1 — pure shadow selector receipt

- exact base/head binding;
- graph/selector digest;
- selected/omitted/must-run IDs;
- `authority_effect=false`;
- no change to CI execution.

### S2 — full-suite counterfactual comparator

- consume existing CI results read-only;
- compare predicted subset with full outcome;
- emit false-negative/savings receipt;
- no test skipping.

### S3 — bounded mutation calibration

- lab fixtures/pure modules only;
- compare full-suite-killed mutants versus selected-subset-killed mutants;
- preserve full fallback and zero external effects.

### S4 — C12 tournament, only when dependency gates allow

Use existing `AMPLIFIER_LOOP_V1` to decide whether the candidate provides measured speed benefit with unchanged correctness/security. Do not create another learning/tournament plane.

---

## 11. Expected gain and risks

### Expected gain

If later evidence validates the selector, this gate can make C12 safer to adopt and shorten PR feedback by allowing affected-test execution without accepting silent under-testing risk blindly.

It can also accelerate selector development now: mutation-seeded faults provide many falsification cases without waiting for naturally failing changes.

No numerical speedup is claimed in this checkpoint. Savings must be measured on METAENGINE's own suite.

### Main risks

- mutation campaigns can be expensive;
- mutation operators can generate unrealistic faults;
- dynamic/runtime dependencies can evade static graphs;
- per-test coverage can become stale;
- flaky tests can corrupt naive calibration statistics;
- over-broad fallback can eliminate most speed benefit.

Mitigations are full-suite counterfactual truth during shadow, mutation only as a second oracle, explicit `INCONCLUSIVE`, digest binding, and fail-to-full behavior.

---

## 12. Disposition

**ACCEPT AS ROADMAP/TEST EVIDENCE:** `C12_TEST_SELECTION_CALIBRATION_GATE_V1`.

**DO NOT IMPLEMENT IN THIS GENERATION.**

Specifically reject:

- a second impact graph;
- a new scheduler/CI orchestrator;
- immediate test skipping;
- Develocity/ML output as authority;
- mutation of live authority-bearing effects;
- arbitrary eval;
- page/model/worker-controlled graph/test IDs;
- interpreting missing data as safe;
- any blind retry after an ambiguous effect.

Generation `1` ends with this branch-local checkpoint.