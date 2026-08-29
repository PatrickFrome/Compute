# METAENGINE Compute Unified V1 — Convergence Critic V1

Date: 2026-08-29
Role: independent adversarial architecture/code critic
Status: **BLOCKED_FOR_DIRECT_REJOIN**
Authority effect: **false**
Production mutation: **none**
Supabase mutation: **none**
Main merge: **none**

## 1. Review scope

Adversarial convergence review of:

- R16 adaptive-router/control-plane lineage;
- Native METAENGINE Browser physical supervisor/action edge;
- Compute Browser B6 repair/foundation;
- AOP1 autonomous orchestration;
- SAME_POINT_DUEL_V4.

Primary threat model: a mechanically clean merge that compiles/tests but silently weakens authority separation, one-actuation-lease, taint monotonicity, ambiguous-effect semantics, exact target/incarnation identity, source provenance, or CI admission.

This checkpoint is evidence/review only. No production code, runtime authority, Supabase control-plane state, branch authority, or `main` was changed.

## 2. Live GitHub topology reviewed

Review base:

- `integration/compute-unified-v1` @ `03684f0731e6d12dc477c09f217ea2bca3aa29db`.
- critic branch was created exactly from that SHA: `work/convergence-critic-v1`.

Live source heads at review time:

| Lineage | Live branch head | Evidence/control marker relevant to convergence | Critic interpretation |
|---|---|---|---|
| R16 | `work/a2-browser-r16-adaptive-router` @ `03684f0731e6d12dc477c09f217ea2bca3aa29db` | convergence control-point marker `898fc22d06c7a0fcf0bb455ae28aaa264e9d9169`, sealed R16 code/CI head `5fcd79c4b37e862c8fb8466dae7a9e182501b559` | symbolic branch head is not the exact verified R16 code unit; it now includes convergence metadata on top |
| Native Browser | `work/metaengine-browser-native-supervisor-v1` @ `0a3d9300959b6220f24b3014b0359c9566b2f169` | same exact head in convergence control point | exact source is identifiable, but safety semantics are not R16-complete |
| Compute Browser B6 lineage | `work/a2-compute-browser-b4-parity` @ `b3fe90cb77531222ba67797ab3b0d11282cb7eaa` | B6 repair marker `3eccaee205c70d15eae004c6e2a42767fce0bacb` | **branch name is unsafe as a merge unit**: live head is 3 commits ahead and already contains B7-PRE1 action/effect-ledger changes |
| AOP1 | `work/aop1-autonomous-orchestration` @ `879258640969b58db1c08f9622d5cff9c1ef72d7` | non-authority duel/orchestration plane | its lease is orchestration fencing, not browser actuation authority |
| Same-Point | `work/same-point-duel-v4-mainline` @ `7d69093278377bfd298aa939b2c994e318df36b4` | V4 executor lease/finalization line | also explicitly non-canonical/non-authority; its `lease_generation` must not be promoted into browser authority |

The B6 branch delta from `3eccaee...` to `b3fe90...` is not cosmetic: it modifies `action-kernel.mjs`, `runtime.mjs`, `node-registry.mjs`, RPC/protocol files and adds effect-ledger/action-seam code and tests. Therefore `merge work/a2-compute-browser-b4-parity` is not equivalent to `rejoin verified B6`.

## 3. Live Supabase facts reviewed read-only

The authoritative browser architecture ledger currently records both R16 and B6 as superseded architecture checkpoints but preserves their safety invariants/evidence.

R16 evidence/invariants include:

- `ONE_RESOURCE_ONE_ACTUATION_LEASE`;
- `NO_BLIND_RETRY_AFTER_AMBIGUOUS_EFFECT`;
- `PRE_ACTUATION_DURABLE_BEFORE_EFFECT`;
- `PAGE_DATA_HAS_ZERO_AUTHORITY`;
- `TARGET_BINDING_IS_EXACT`;
- `TAINT_PROVENANCE_IS_MONOTONIC_ACROSS_DERIVATION`;
- R15/R16 exact node/executor incarnation binding;
- fresh authority + lease required at routing output;
- post-effect routing forbidden;
- automatic retry false.

B6 evidence records a concrete prior fail-open integration defect: the extension lease-gate implementation existed in source but was not loaded by the MV3 service worker, so `assertLeaseValid()` silently no-op'ed until the B6 repair. The same repair also records that zero matching Actions coverage had allowed a syntactically broken runtime and other defects to survive. This is direct evidence that source presence is not enforcement and source-green CI cannot be assumed after branch composition.

AOP1 schema/code was separately inspected. It explicitly describes itself as a **Non-authority co-development plane** and constrains duel/tick/runtime-registration records to `canonical=false` and `authority_effect=false`. Its `lease_owner` / `lease_generation` exists to fence duel execution, not physical browser actuation.

No Supabase writes were made during this review.

## 4. Ranked blockers

### P0-1 — Post-dispatch failures are falsely downgraded to `FAILED_NO_EFFECT` in verified Compute Browser B6

**Evidence.** At exact B6 marker `3eccaee...`, `ActionKernel.executeAction()` writes the durable pending intent, dispatches `_navigate`, `_click`, `_type`, or `_submit`, then catches nearly every thrown error and rewrites it to:

```text
status = FAILED_NO_EFFECT
effect_evidence.dispatched = false
```

But the physical helpers cross an effect boundary before all awaited operations complete. Examples:

- CLICK: `mousePressed` can succeed and `mouseReleased` can fail/lose its response;
- SUBMIT: Enter `keyDown` can effect submission before `keyUp` fails;
- NAVIGATE: `Page.navigate` can be accepted while a later frame-tree/readback operation fails;
- TYPE: `Input.insertText` can be accepted while the transport acknowledgement is lost.

Once the first effect-bearing CDP command may have reached Chromium, lack of a successful completion acknowledgement does **not** prove no effect. The current generic catch launders an unknown/post-effect state into retryable-looking `FAILED_NO_EFFECT`. That contradicts the R8/R15/R16 contract that untyped post-seal/post-dispatch failure is `AMBIGUOUS` and never automatically retried.

**Impact.** A convergence layer can double-click, double-submit, duplicate navigation-side effects, or duplicate typed content after a transport/process failure while believing the first attempt had no effect.

**Smallest safe fix.** Add an explicit physical-dispatch boundary in the action kernel. Before the boundary, failures may be `FAILED_NO_EFFECT`. From the first effect-bearing CDP send onward, every unproven outcome must become terminal `AMBIGUOUS` with `dispatched=true|unknown`, retain the durable intent, and block blind retry. Add deterministic fault-injection tests immediately after first effect dispatch for CLICK, SUBMIT, NAVIGATE and TYPE.

**Admission gate.** B6/B7 may not be rejoined into a unified actuator until those fault-injection cases prove `AMBIGUOUS` and retry denial.

### P0-2 — Native Browser can actuate under `CONTROL + armed` without the R16 authority/lease/taint/incarnation fence

**Evidence.** Native supervisor client state defaults to `#supervisorMode = 'CONTROL'` and `#armed = true`. For non-read-only commands, `#executeLocalOrRemote()` gates on mode/armed and then calls the command executor. The Native semantic command implementation then directly sends CDP input/focus/scroll commands. The command path shown here does not carry or verify an R16 fresh-authority proof, one-resource actuation lease, taint/revalidation decision, executor-incarnation lease, or pre-actuation durable fence.

This is not a claim that Native supervisor authentication is absent: the client does signed device requests. The defect is **authority-domain incompleteness**. Authenticated command transport and local arm are not equivalent to the R16 physical-effect authorization contract.

**Impact.** A naive C1 port can accidentally make the Native supervisor an independent browser-authority source, violating the convergence rule that Native is the physical edge and not a competing authority source.

**Smallest safe fix.** Keep signed Native transport, but make every effectful Native command enter one shared R16/B6 `ActuationPermit` verifier immediately before effect. Permit must bind at minimum: command/action id, authority generation, actuation lease id/resource, exact browser/process/executor incarnation, target/document identity, taint/live-revalidation result, expiry, and pre-effect durable intent id. `CONTROL + armed` is necessary local policy, never sufficient authority.

**Admission gate.** No Native effectful command may reach `Input.*`, `DOM.focus`, navigation, download, or any future WebMCP actuator without this shared verifier.

### P0-3 — Native Browser repeats the ambiguous-effect bug independently

**Evidence.** Native `clickBackendNode()` performs `mouseMoved -> mousePressed -> mouseReleased`; `SEMANTIC_TYPE` performs focus/key dispatches then `Input.insertText`. If an awaited operation fails after an earlier effect-bearing dispatch, `executeSemanticCommand()` throws. `NativeSupervisorClient.#runCommand()` then posts a generic `ok=false` result and records command status `FAILED`. There is no explicit `AMBIGUOUS` terminal state in this seam.

**Impact.** Even if Compute Browser B6 is repaired, direct Native actuation can still reintroduce blind-retry risk through a separate implementation.

**Smallest safe fix.** Do not maintain two effect classifiers. Route Native and Compute physical actions through the same typed effect-boundary state machine (`PRE_EFFECT -> EFFECT_DISPATCH_STARTED -> COMMITTED | AMBIGUOUS`), with the same durable-before-effect record and retry policy.

### P0-4 — Branch-name provenance is not an admissible convergence source

**Evidence.** The convergence control point pins B6 to `3eccaee...`; the live B6-named branch is now `b3fe90...`, three commits ahead with material B7-PRE1 code. R16 similarly has three relevant identities: sealed code/CI `5fcd79...`, control marker `898fc22...`, and live branch/integration head `03684f...` after convergence bookkeeping.

**Impact.** “Merge the R16 branch” or “merge the B6 branch” is ambiguous and can silently import unreviewed future-milestone code or treat metadata-only descendants as verified code heads.

**Smallest safe fix.** Convergence manifest must name exact source SHA + allowed path set + expected tree/blob hashes for every imported slice. Review/CI should fail if live branch heads drift without explicit manifest update. Never resolve a source milestone from symbolic branch HEAD at execution time.

### P1-1 — AOP1/Same-Point leases are distinct fencing domains and must never satisfy browser actuation lease checks

**Evidence.** AOP1 declares `authority_effect=false`; Same-Point model/executor payloads explicitly set `canonical=false`, `authority_effect=false`. Same-Point requires `duel_id` + `lease_generation` when submitting/finalizing pairs, proving that its lease is real and important — but it fences one duel executor, not a browser resource. Same-Point itself instructs models never to claim canonical/merge/live authority.

**Impact.** Reusing a generic field name such as `lease_id`, `lease_owner`, or `lease_generation` across layers can accidentally turn “I own this duel/work item” into “I may actuate this browser target.” This is a classic confused-deputy collapse during protocol unification.

**Smallest safe fix.** Namespace lease types and make them non-interchangeable: `OrchestrationLease`, `DuelExecutorLease`, `BrowserNodePoolLease`, `ActuationLease`. Physical effect requires conjunction of the required upstream claims plus a fresh `ActuationLease`; no upstream lease can be cast/promoted to it.

### P1-2 — Exact target identity can be weakened at both B6 and Native seams

**B6 evidence.** `_liveRevalidate({ ..., framePath })` accepts `framePath` but does not use it. It searches the current AX tree with `.find()` for either lower-cased accessible name equal to `semanticId` or AX node id equal to it; it does not prove uniqueness of an accessible-name match in that function. The target binding checks process incarnation, which is good, but the semantic node selection is weaker than exact frame/document/node identity.

**Native evidence.** Native resolves a fresh unique `(role, accessible_name)` at execution time. That avoids acting on an ambiguous current page, but a stale command can still bind to a *different* newly unique element with the same role/name after navigation or DOM replacement because command identity is not tied to the perception snapshot/document epoch/process incarnation.

**Impact.** A valid old command/lease can select a semantically similar but causally different node after page replacement, navigation, frame change or UI mutation.

**Smallest safe fix.** Bind planned action to exact target identity tuple: browser/process incarnation + target id + frame/document epoch + semantic snapshot/hash + stable node binding where available. Revalidation must compare the whole tuple, reject stale/changed identity, and treat page-derived names only as tainted selectors/hints, never authority.

### P1-3 — Taint can be laundered by restart/reassignment unless terminal uncertainty is identity-bound and monotonic

**Evidence.** R12 requires taint provenance monotonicity and R8/R15/R16 preserve ambiguity/no retry. AOP1/Same-Point recovery can reacquire executor leases; Native can reconnect/enroll/heartbeat; Compute Browser can rotate context/process incarnations. Those are availability/recovery mechanisms, not evidence that a previous physical effect did not occur.

**Impact.** If a fresh worker lease/session/incarnation creates a fresh command state without importing the old terminal taint/AMBIGUOUS record, convergence turns restart into an uncertainty eraser.

**Smallest safe fix.** Key taint/ambiguous-effect tombstones by durable logical action/resource plus prior incarnation and causal parent. New leases/incarnations must inherit the block until an explicit reconciliation receipt proves a safe terminal disposition. Never clear ambiguity merely because ownership changed.

### P1-4 — Enforcement wiring needs an activation guard, not only implementation tests

**Evidence.** Supabase B6 history records a real fail-open: lease-gate source existed, but MV3 did not load it. The B6 repair CI had to add an explicit static ordering check that `operator-lease-gate.js` is imported before `operator-actions.js`.

**Impact.** C3 “unified supervisor protocol” can produce correct modules that are not actually wired into one of Native/MV3/Compute entrypoints, recreating fail-open behavior without obvious code failure.

**Smallest safe fix.** Add a generated/checked runtime authority-surface manifest and entrypoint activation tests. Every effectful entrypoint must prove that the shared authority/lease/taint/effect classifier is loaded and invoked before actuator construction. A missing verifier must make startup fail closed.

### P1-5 — Current CI does not establish convergence safety, and the integration PR is presently red

**Evidence.** Source workflows are branch/path scoped:

- R16 push gate: only `work/a2-browser-r16-adaptive-router`;
- B6 gate: only `work/a2-compute-browser-b4-parity*`;
- Same-Point push gate: its own branch/main and path filters;
- legacy METAENGINE Browser shell push gate: `work/metaengine-browser-shell-v1` (Native has a separate exact-head Windows gate, but this still does not compose R16/B6/Same-Point semantics).

At integration head `03684f...`, GitHub Actions shows `Compute Fabric Governance Preview` run `33254823673` failed in step `Validate target-only governance shape`. The workflow's branch classifier allows several historical work branches and `analysis/integration` but does **not** allow `integration/compute-unified-v1`; therefore this convergence branch cannot satisfy the current preview policy as written. Other source-specific green runs do not compensate for that red admission state.

Known exact-source green evidence still exists:

- R16 `5fcd79...`: run `33238333180`, success;
- B6 repair `3eccaee...`: run `33241395941`, success;
- Native current `0a3d930...`: Windows Native Supervisor gate run `33253249309`, success.

**Impact.** A combined branch can skip the strongest source gates, while historical green artifacts are incorrectly interpreted as proof for the composed tree.

**Smallest safe fix.** First make governance preview consciously recognize the new integration/convergence branch class without weakening target-only governance. Then add a convergence matrix workflow triggered on `integration/compute-unified-v1`, `work/convergence-*`, and PRs touching any seam. It must run R8-R16 regressions, B6/B7 full suite, Native tests/physical smoke, Same-Point/AOP1 contracts, activation guards, provenance manifest validation, and the new cross-layer adversarial fault-injection cases.

## 5. Cross-layer invariants that must survive composition

The following are **AND**, not “pick one implementation” contracts:

1. Page/model/WebMCP/tool output has zero authority; taint is monotonic through derivation.
2. Many planners/executors may reason; one physical resource has at most one valid actuation lease.
3. Orchestration/duel/node-pool ownership never grants physical browser authority.
4. Fresh authority and fresh actuation lease are checked immediately before effect, after durable intent seal and live target revalidation.
5. Exact identity binds browser/process/executor incarnation, logical target, document/frame epoch, and action/lease generation.
6. Any failure after possible effect dispatch is `AMBIGUOUS` unless positive evidence proves `COMMITTED`; it is never downgraded to `NO_EFFECT` from absence of an acknowledgement.
7. `AMBIGUOUS` and taint survive restart, reconnect, worker reassignment, process replacement, context rotation and lease reacquisition.
8. Routing/scheduling occur before effect only; post-effect rerouting/replay cannot silently issue a replacement actuation.
9. Every effectful runtime entrypoint must prove verifier activation, not merely verifier source presence.
10. Promotion provenance is exact SHA/tree/path-set + CI evidence; a branch name is not evidence.

## 6. Minimum safe convergence order

1. **Freeze exact source manifest** for C1/C2 slices (`sha + paths + expected blobs`).
2. **Extract one shared effect-state classifier** and prove post-dispatch fault semantics before importing any new actuator.
3. **Define typed authority lattice / ActuationPermit**; explicitly prohibit lease-type coercion.
4. **Bind exact target/incarnation identity and monotonic taint/ambiguity tombstones** across restart/reassignment.
5. **Port Native physical transport/identity/session shell only through that verifier**, never as an independent authority source.
6. **Rejoin B6 exact marker, not current branch head**, then separately review/admit B7-PRE1 deltas.
7. **Add convergence CI/activation/provenance gates** and repair the current governance-preview branch classifier.
8. Only after all above are green should C3 unify supervisor adapters behind one typed core.

## 7. Required adversarial tests before promotion

- CLICK: inject transport failure after `mousePressed`; assert terminal `AMBIGUOUS`, no automatic retry.
- SUBMIT: fail after Enter `keyDown`; assert `AMBIGUOUS`.
- TYPE: simulate accepted effect / lost response; assert `AMBIGUOUS`.
- NAVIGATE: accept navigation then fail readback/ack; assert `AMBIGUOUS`.
- Native equivalents for the same four effect classes.
- Expired/replaced authority between planning and physical dispatch => deny before effect.
- Valid Same-Point/AOP1 executor lease without browser actuation lease => deny.
- Valid browser lease with mismatched process/executor incarnation => deny.
- DOM/page replacement that produces a new unique same-name target => stale target deny.
- Frame-path/document-epoch mismatch => deny.
- Restart/reassignment after ambiguous action => inherited recovery-required block.
- Verifier module present but omitted/reordered from runtime entrypoint => startup/test failure.
- Branch head moves beyond pinned manifest SHA => convergence CI fails until explicit re-review.
- Every convergence PR must execute, not skip, R16 + B6/B7 + Native + AOP1/Same-Point seam gates.

## 8. Critic disposition

**Direct/simple union of R16 + Native Browser + Compute Browser B6/B7 + AOP1 + Same-Point is rejected.**

The two highest-risk issues are not merge conflicts; they are semantic conflicts that can remain invisible while compilation and historical source tests are green:

- both B6 and Native can misclassify post-dispatch uncertainty as ordinary failure/no-effect;
- Native local control/arm is not yet the R16 actuation-authority contract.

The convergence can proceed safely as small slices, but only with exact-SHA provenance, one shared effect classifier, a non-coercible authority/lease lattice, exact target/incarnation binding, monotonic taint/ambiguity, activation guards, and combined CI.

Checkpoint authority remains `false`. This document does not promote any milestone, alter production authority, close historical PRs, merge `main`, or mutate Supabase.