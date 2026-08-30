# METAENGINE Autonomous Fleet Dispatch Synthesis V1

Status: branch-local evidence checkpoint only  
Task: `63d22620-85de-4129-bb75-c87aa5c1f7ee`  
Role: `SYNTHESIZER`  
Source/base: `work/devos-elastic-fleet-bootstrap-v1` @ `724612235eb7ceb4534c13d126425b274d876394`  
Target: `work/fleet-synth-autonomous-dispatch-v1`  
Observed: 2026-08-30  
Production/main mutation: **none**

## 1. Executive convergence decision

The Browser fleet lines are not divergent implementations that should be merged together. Git ancestry is linear:

```text
PR #100 gate proof
work/federated-autonomy-v1 @ e8f3a482831c541237e05f1f8ee0be8a84539031
        |
        | +11 commits
        v
work/federated-autonomy-runtime-v1 @ a21c9e241718274433531aaaa702c9d9748abaa6
        |
        | +38 commits
        v
work/devos-elastic-fleet-bootstrap-v1 @ 724612235eb7ceb4534c13d126425b274d876394
        |
        v
work/fleet-synth-autonomous-dispatch-v1  (this evidence-only checkpoint)
```

GitHub compare reports `a21c9e...` is 11 commits ahead of `e8f3a4...` with zero commits behind, and `724612...` is 38 commits ahead of `a21c9e...` with zero commits behind. Therefore `724612...` is 49 commits ahead of the frozen PR #100 head and already contains the federated-autonomy runtime lineage.

**Disposition:** do not merge/cherry-pick PR #100 or `work/federated-autonomy-runtime-v1` into the elastic-fleet source again. Treat PR #100 as a frozen safety/gate proof, treat `work/federated-autonomy-runtime-v1` as an inherited historical runtime checkpoint, and implement only the missing DB-native Browser dispatch wiring on top of `724612...`.

The smallest safe convergence is one existing Browser supervisor cycle driving four operations in order:

1. heartbeat/state observation;
2. DevOS DB lease / backlog read;
3. Browser transport dispatch with exact physical binding and transport proof;
4. exact-fenced DB state transition / completion evidence.

Do **not** add a second polling scheduler.

## 2. Authoritative facts reread

### GitHub

- `main` is protected and was observed at `0d1c074c7f513f25000d967761c7bb13912dacaa`. It is outside this task and remains untouched.
- `work/devos-elastic-fleet-bootstrap-v1` is exactly `724612235eb7ceb4534c13d126425b274d876394`, matching the task `base_sha`.
- PR #100 is open + draft, titled **Add owner-overridable METAENGINE safety gate control plane**. Its frozen head is `e8f3a482831c541237e05f1f8ee0be8a84539031` on `work/federated-autonomy-v1`, based on `work/self-update-session-resume-v1` @ `912d9f0a4b922b69a2fd545b2df18d622fc5a073`.
- PR #100 body explicitly freezes `e8f3a482...` as the gate proof and sends further runtime work to stacked `work/federated-autonomy-runtime-v1`.
- PR #100 head had green AppVeyor PR and branch statuses at observation.
- `work/federated-autonomy-runtime-v1` is `a21c9e241718274433531aaaa702c9d9748abaa6` and also had green AppVeyor PR + branch statuses.
- Source `724612...` AppVeyor branch status was still pending at observation. This source must not be promoted until exact CI is green.

### Browser runtime inherited by source

`724612...` already contains:

- `autonomy-governor.mjs`: backlog-driven `ELASTIC_BACKLOG_DRIVEN` target derivation, complementary vs implementation claim policy, base-SHA conflict policy, and optional operational resource budgets.
- `fleet-provisioner.mjs`: Browser-owned fleet lifecycle, physical tab/target/generation binding, durable transport proof, `BOUND_UNVERIFIED -> ACTIVE`, tab-loss generation bump, elastic target setting and burst-limited reconcile.
- `fleet-task-dispatcher.mjs`: exact `agent_id + point_id + base_sha + generation_epoch` validation, live `tab_id + target_id` incarnation check, unique ChatGPT composer requirement, semantic submit, readback, `AMBIGUOUS_AFTER_ENTER` fail-closed behavior, prompt hashing, no blind automatic retry, and `page_data_authority:false`.
- native supervisor heartbeat/cycle: one recursive `setTimeout` scheduling source with cycle serialization; this is the scheduler to extend rather than duplicate.
- supervisor lifecycle/mesh + self-update continuity/resilience inherited after the federated runtime checkpoint.

Important current wiring fact: at `724612...`, normal `main.mjs` imports/wires `FleetProvisioner` and `NativeSupervisorClient`, but contains no reference/import for `AutonomyGovernor` or the `fleet-task-dispatcher` task path. `package.json` syntax-checks these modules, but syntax coverage is not runtime integration evidence. Thus DB-native autonomous task intake/dispatch is not yet proven in the normal Browser path.

### Development Plane

At this source head the embedded Development Plane remains deliberately prepare/verify-only. Its exposed capabilities are health, process metrics, repo-head read, candidate capsule create/verify, verification-sandbox plan create/verify and advisory evidence verification. It explicitly reports:

- `candidate_capsules_executable:false`
- `verification_sandbox_execution:false`
- `sandbox_backend_bound:false`
- `advisory_evidence_network_dispatch:false`
- `advisory_evidence_promotion_authority:false`
- `direct_promote_current:false`
- `arbitrary_eval:false`

Therefore Browser-local Development Plane output is not sufficient proof of a self-sustaining development loop. Terminal development completion must be proven by an authoritative out-of-band source such as GitHub branch/commit/CI evidence plus exact-fenced DevOS DB completion, never by page/model prose.

## 3. DevOS DB coordination — authoritative current contract

Supabase project `xpeibufgzjknrhbhpffp` (`METAENGINE_H205F22_RECOVERY`, ACTIVE_HEALTHY) contains the current DevOS fleet coordination plane:

- `destruktion_meta.devos_fleet_task_h205f22`
- `destruktion_meta.devos_fleet_claim_h205f22`
- `destruktion_meta.devos_fleet_event_h205f22`
- public RPCs:
  - `devos_fleet_enqueue_v1`
  - `devos_fleet_lease_v1`
  - `devos_fleet_mark_running_v1`
  - `devos_fleet_complete_v1`
  - `devos_fleet_snapshot_v1`

The DB contract already has the core safety properties required for Browser-native dispatch:

1. **Idempotent enqueue** by `idempotency_key` plus task-spec SHA-256.
2. **Serialized lease** via `FOR UPDATE SKIP LOCKED`.
3. **One active claim per agent**.
4. **Mutating point/base exclusion**: a new mutating task is not leased while an active mutating claim already exists for the same `workspace + point_id + base_sha`.
5. **Exact lease identity** persisted as `agent_id + tab_id + target_id + agent_generation_epoch + lease_generation`.
6. **Expired in-flight effects fail closed**: expired `LEASED/RUNNING` tasks are converted to `AMBIGUOUS` with `LEASE_EXPIRED_EFFECT_UNKNOWN`, not silently requeued.
7. **No automatic retry** is returned in the lease contract.
8. **Transport proof required before RUNNING**: `prompt_sha256`, `conversation_url_sha256`, and a proven effect state are mandatory.
9. **Exact-fenced completion** rejects stale agent/generation/tab/target/epoch/expiry.
10. **Page/model content has zero authority** in the event plane (`page_data_authority:false`); prompt text is not included in events.
11. DB task/claim/event operations report `authority_effect:false`; Browser page actuation remains separately evidenced by the Browser transport receipt.

The live DevOS snapshot at observation showed six active fleet tasks on base `724612...`: one `MUTATING` IMPLEMENTER claim and five `ADVISORY` complementary claims. All six had corresponding `TASK_TRANSPORT_PROVEN` events. This proves the DB lease + transport-proof contract is currently usable, but does **not** yet prove the Browser itself continuously leases new work without an external dispatcher.

### Critical DB liveness gap

No `devos_fleet_renew_*` function exists in the current RPC set. Lease duration is clamped to 60..3600 seconds. For a genuinely self-sustaining fleet, a long-running task needs one of:

- an exact-fenced lease-renew RPC bound to the same task/agent/tab/target/epoch/generation; or
- a hard contract that every task completes within the lease horizon, which is not credible for general development work.

**Disposition:** add a renewal contract before claiming long-duration autonomy. Renewal must never change task identity, generation, tab or target and must fail closed after expiry/ambiguity.

## 4. Duplicate work / duplicate scheduler map

| Area | Existing owner | Duplicate to avoid | Convergence decision |
|---|---|---|---|
| Owner safety gates / self-update gate proof | PR #100 frozen head | Reimplementing gate registry or replaying PR #100 into source | Keep PR #100 as immutable evidence; source already inherits it |
| Federated autonomy policy | `autonomy-governor.mjs` | New parallel capacity/claim governor | Reuse existing governor; only feed it authoritative DB backlog/claims |
| Browser fleet lifecycle | `fleet-provisioner.mjs` | New DB-side Browser tab lifecycle state machine | Browser owns physical tab lifecycle; DB owns work lease lifecycle |
| Browser prompt transport | `fleet-task-dispatcher.mjs` | New Enter/submit dispatcher | Reuse existing dispatcher and its no-blind-retry semantics |
| Supervisor cadence | `NativeSupervisorClient` recursive cycle | New DevOS interval/poll loop | Add DB coordination as a phase of the existing cycle only |
| Task lease serialization | `devos_fleet_lease_v1` | Browser-local competing claim mutex as authority | DB is the cross-agent authority; Browser mutex may only prevent local reentrancy |
| Task queue | `devos_fleet_task_h205f22` | Reusing legacy `destruktion_meta.federated_task` as a second live queue | DevOS fleet table is canonical for this convergence; no dual-write/dual-lease |
| Completion authority | GitHub/DB evidence | Trusting ChatGPT page/model text as DONE | Completion only from out-of-band verified evidence and exact-fenced DB transition |
| Elastic desired count | `AutonomyGovernor.deriveTarget` + `FleetProvisioner.setTargetAgents/reconcile` | Separate autoscaler | Wire existing modules to DB snapshot, do not create another controller |
| Supervisor mesh | source mesh runtime | Making every peer run its own DB scheduler | Peers may coordinate/observe; only the existing Browser cycle owns DB scheduling for its instance |

## 5. Required integration order

### I0 — preserve frozen safety proof

Keep PR #100 head `e8f3a482...` unchanged. Re-run/retain its exact green gate evidence as a regression anchor. Do not stack new runtime changes into that proof branch.

### I1 — one-cycle DevOS coordinator

On a dedicated implementation branch from `724612...`, add a small `DevosFleetCoordinator` (name illustrative) that is invoked from the existing native-supervisor cycle. It may perform read/lease/mark/complete RPCs but must not own a timer.

Acceptance invariant: source scan shows one authoritative recurring scheduler for supervisor + DevOS work; no second `setInterval`/recursive timeout dedicated to fleet tasks.

### I2 — exact lease -> Browser transport -> mark RUNNING

For an ACTIVE Browser fleet agent with exact `tab_id + target_id + generation_epoch`:

1. lease one role-compatible DB task;
2. verify the DB lease tuple equals the live Browser agent binding;
3. dispatch through existing `fleet-task-dispatcher`;
4. if transport proof is exact and proven, call `devos_fleet_mark_running_v1` with the same tuple;
5. on any ambiguous Browser submit/readback, do not lease/retry another copy; preserve ambiguity for explicit recovery.

Never accept task/page/model text as authority. The DB task spec may be transported as data, but cannot expand Browser capabilities or bypass the typed action set.

### I3 — backlog-driven elastic reconcile

Use `devos_fleet_snapshot_v1` as the authoritative backlog/claim input to `AutonomyGovernor.deriveTarget`, then apply the result through `FleetProvisioner.setTargetAgents/reconcile` in the same supervisor cycle.

Required properties:

- seed/warm floor remains explicit;
- backlog can expand capacity;
- optional operational budgets can bound resources without resurrecting legacy hidden hard caps;
- ambiguous Browser effects consume capacity by default;
- owner-gate overrides may alter project policy but must never disable the exact DB task/agent/tab/target/generation fence.

### I4 — durable renewal + completion oracle

Add exact-fenced renewal for long work. Terminal completion must be based on external authoritative evidence, for example:

- target branch exists at the expected base/lineage;
- expected commit/checkpoint SHA exists;
- CI/test evidence is green when required by task type;
- artifact/evidence hashes match expected claims;
- then `devos_fleet_complete_v1` is called with the same active lease tuple.

Model/page text may suggest a result but cannot make the terminal transition authoritative.

### I5 — crash / replacement / stale-generation recovery

Prove:

- Browser crash/restart preserves enough task/agent identity to reconcile safely;
- missing/replaced physical tab increments Browser generation and invalidates old target bindings;
- stale old completions are rejected by DB fencing;
- expired unknown effects become `AMBIGUOUS`, not `READY`;
- duplicate heartbeat/cycle reentry does not dispatch a second prompt.

### I6 — soak and gate convergence

Only after I1-I5 pass:

- run multiple consecutive autonomous task generations;
- demonstrate at least one advisory and one mutating development task through lease -> transport -> authoritative GitHub evidence -> completion;
- demonstrate backlog expansion and contraction;
- demonstrate restart during active work;
- re-run PR #100 safety/gate regression evidence and full Browser CI;
- keep main/production promotion as a separate explicit decision.

## 6. Acceptance matrix for “self-sustaining development fleet”

Legend: **PASS-CONTRACT** = authoritative contract exists; **PASS-OBSERVED** = live evidence observed; **PENDING-WIRING** = building block exists but normal Browser path is not proven; **BLOCKER** = required capability/contract missing.

| ID | Acceptance property | Required evidence | Current state |
|---|---|---|---|
| A01 | Linear lineage / no duplicate branch merge | Git compare proves PR#100 -> federated runtime -> elastic source ancestry | **PASS-OBSERVED** |
| A02 | One authoritative scheduler | Static/runtime proof that DevOS work runs inside existing supervisor cycle and no second fleet timer exists | **PENDING-WIRING** |
| A03 | Concurrent lease exclusion | DB concurrency test: N claimers, one task/one agent/mutating point gets at most one active lease | **PASS-CONTRACT**, E2E concurrency proof required |
| A04 | Exact task-agent-tab-target-epoch-generation fence | Negative tests alter each tuple field independently and DB rejects mark/complete | **PASS-CONTRACT** |
| A05 | Transport proof before RUNNING | Browser receipt + DB `TASK_TRANSPORT_PROVEN`; no page prose | **PASS-OBSERVED** for current six tasks |
| A06 | No blind retry after Enter ambiguity | Inject ambiguous Enter/readback; no replacement prompt/task dispatch; terminal state is ambiguous/fenced | **PASS-CONTRACT**, Browser/DB integrated fault test required |
| A07 | Lease-expiry unknown-effect handling | Expired LEASED/RUNNING becomes AMBIGUOUS, never silently READY | **PASS-CONTRACT** |
| A08 | Long-running lease liveness | Exact-fenced renewal survives > lease period without changing binding | **BLOCKER** — no renew RPC yet |
| A09 | Backlog-driven elastic capacity | DB backlog change drives `deriveTarget -> setTargetAgents -> reconcile` in same cycle | **PENDING-WIRING** |
| A10 | Browser task dispatch runtime wiring | Normal main path invokes existing `fleet-task-dispatcher` from DB lease | **PENDING-WIRING** |
| A11 | Physical tab replacement fencing | Close/replace tab increments generation; stale DB completion and stale dispatch fail | Building blocks present; integrated fault test required |
| A12 | Duplicate heartbeat/cycle safety | Two overlapping/duplicate cycles yield no duplicate lease, prompt or completion | Integrated fault test required |
| A13 | Owner gates cannot weaken hard fence | With all project owner gates disabled, stale/mismatched task lease tuple still fails | Integrated negative test required |
| A14 | Legacy queue isolation | New path makes zero scheduling decisions/writes against legacy `federated_task` | Static + DB audit evidence required |
| A15 | Zero page/model authority | All event/receipt evidence retains `page_data_authority:false`; model text cannot complete work | **PASS-CONTRACT** |
| A16 | Development effect proof | Agent creates expected branch-local code/docs commit and CI result is independently read from GitHub | **BLOCKER for E2E claim**; embedded Development Plane itself is prepare/verify-only |
| A17 | Terminal completion oracle | DB completion follows verified GitHub/CI evidence and exact lease tuple, not page text | **PENDING** |
| A18 | Crash/restart continuity | Restart during active task resumes/reconciles without duplicate effect and stale target is fenced | Existing supervisor/self-update primitives present; integrated test required |
| A19 | Gate-line regression | Frozen PR #100 head exact checks remain green after convergence | **PASS-OBSERVED baseline**, must re-run on convergence candidate |
| A20 | Source CI | Full Browser syntax/tests/self-update gates green on exact convergence SHA | **PENDING** — source branch status was pending at observation |
| A21 | Main/production safety | No main merge, production deployment, secret request, or authority broadening during convergence | **PASS-OBSERVED for this checkpoint** |

## 7. Minimal evidence suite before autonomy can be called self-sustaining

The smallest credible evidence package is:

1. **single-scheduler static guard** — fails CI if a second DevOS/fleet recurring timer is added outside the native supervisor cycle;
2. **DB concurrent lease test** — many concurrent lease calls prove exactly-one claim and mutating point/base exclusion;
3. **transport fence test** — correct tuple marks RUNNING only after exact Browser proof;
4. **stale tuple matrix** — stale agent, tab, target, generation, epoch and expired lease each fail closed;
5. **ambiguous Enter fault injection** — effect ambiguity produces no blind retry and no compensating duplicate dispatch;
6. **duplicate cycle/heartbeat test** — replayed cycle cannot send the task twice;
7. **tab-replacement test** — target incarnation replacement invalidates old work authority;
8. **owner-gates-disabled hard-fence test** — project gates may be owner-overridable, but task identity fencing remains non-overridable;
9. **lease-renewal test** — long-running work renews only with the exact active tuple and never after ambiguity/expiry;
10. **elastic backlog test** — queue depth expands Browser agents, drained backlog contracts to warm floor, burst limits are honored;
11. **GitHub completion-oracle E2E** — a development task causes a branch-local commit, exact SHA and CI are read independently, then and only then DB completion succeeds;
12. **restart soak** — repeated supervisor/Browser restart while tasks are READY/LEASED/RUNNING/AMBIGUOUS produces no duplicate external effect;
13. **PR #100 regression + full Browser CI** on the final integration candidate.

A suggested minimum soak threshold is three full autonomous generations with at least one intentional crash, one duplicate-cycle injection and one ambiguous transport injection. This is an acceptance threshold, not a production rollout authorization.

## 8. Branch disposition

| Branch / line | Disposition | Reason |
|---|---|---|
| `work/federated-autonomy-v1` / PR #100 @ `e8f3a482...` | **FREEZE / EVIDENCE ANCHOR** | Stable green gate proof; source already descends from it |
| `work/federated-autonomy-runtime-v1` @ `a21c9e...` | **HISTORICAL STACKED RUNTIME / INHERITED** | Its autonomy/dispatcher modules are already ancestors of source; do not merge twice |
| `work/devos-elastic-fleet-bootstrap-v1` @ `724612...` | **CURRENT CONVERGENCE BASE** | Exact task base, contains both previous lines plus elastic/supervisor continuity work |
| `work/devos-native-task-dispatch-v1` | **PENDING IMPLEMENTER EVIDENCE** | Intended smallest DB-native wiring slice; only integrate exact reviewed commit after tests/CI |
| `work/fleet-synth-autonomous-dispatch-v1` | **EVIDENCE-ONLY CHECKPOINT** | This synthesis; no production/runtime mutation |
| `main` @ observed `0d1c074...` | **DO NOT TOUCH IN THIS TASK** | Promotion is outside authority and must remain separately gated |

## 9. Final synthesis

The architecture is close to a coherent self-sustaining fleet because the difficult safety primitives already exist on both sides of the boundary:

- Browser: exact physical incarnation binding, proven semantic transport, no blind retry, elastic lifecycle, supervisor continuity/self-update.
- DB: durable idempotent task queue, cross-agent lease serialization, exact lease fencing, transport-before-running, ambiguity-on-expiry and zero page-data authority.

The remaining work is **not another autonomy layer**. It is the narrow bridge between these two existing systems, run from exactly one scheduler, followed by durable lease renewal and an out-of-band completion oracle.

The convergence must preserve this hard rule even when owner development gates are disabled:

> `task_id + agent_id + tab_id + target_id + agent_generation_epoch + lease_generation + base_sha` is a non-overridable authority fence. Page/model text, owner gate overrides, supervisor mode changes and duplicate heartbeats cannot weaken it.

No main merge, production mutation, secret request, arbitrary eval, or page/model authority is authorized by this checkpoint.
