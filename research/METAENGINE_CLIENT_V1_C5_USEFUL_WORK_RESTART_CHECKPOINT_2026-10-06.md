# METAENGINE Client V1 C5 — Useful-Work Restart Continuity Checkpoint

Date: 2026-10-06  
Status: **EVIDENCE_READY — PREPARE_ONLY DURABILITY**  
Branch: `work/client-v1-c5-useful-work-restart-v1`  
Qualified implementation head: `fed0fba82b67eb49cad4a3a2f72927c6e4068882`

## Roadmap reconciliation

Canonical Level-1 owner: **C2 — First Serial Coding Loop**.

This checkpoint does not prove canonical C2 and does not bypass:

`R1 → C1 → C2`.

It advances only the Client-side continuity semantics required after a useful-work result already exists.

Client roadmap relation:

- C4: physical Agent-origin proof remains distinct.
- C5 contract: useful-work evidence shape exists.
- C5 reference producer: real repo/edit/test/artifact mechanics proved as SYNTHETIC.
- This slice: useful-work evidence survives Client restart only under exact durable binding and is never replay authority.
- C5 LIVE: still NOT_PROVEN.

## Problem

Before this change, the Client durable goal journal could persist:

- submission receipt;
- progress;
- Agent/result execution proof.

It did not persist the new C5 useful-work proof.

Therefore a future accepted useful-work result had two bad options across restart:

1. lose the artifact/provenance acceptance state; or
2. reconstruct/infer it outside the durable journal, creating replay/staleness risk.

The correct invariant is:

> restart rehydrates already-proven state; restart does not replay the external effect that created that state.

## Implementation

### Durable journal extension

`apps/metaengine-browser/src/client-goal-journal.mjs`

Each journal entry may now contain:

`useful_work_proof`

The field is optional and backward-compatible with older `metaengine.client.goal-journal.v1` snapshots.

Old snapshots load with:

`useful_work_proof=null`.

### Full restore revalidation

`apps/metaengine-browser/src/client-useful-work-proof.mjs`

New helper:

`clientUsefulWorkProofMatchesExecution(...)`

does not trust the stored object directly.

On restart it first runs the full:

`normalizeClientUsefulWorkProof(storedProof, currentExecutionProof)`

and only retains the proof if full normalization succeeds and the exact execution binding still matches.

A corrupted or structurally stale stored proof is discarded instead of becoming current evidence.

### Exact execution binding

A persisted useful-work proof remains valid only while these fields still match the execution proof:

- request ID;
- workspace ID;
- roadmap ID;
- plan generation;
- alignment epoch;
- baseline SHA;
- plan SHA-256;
- point ID;
- task ID;
- task-spec SHA-256;
- lease generation;
- result SHA-256;
- result-claim SHA-256;
- Agent-origin conversation SHA-256.

Any progress update that invalidates the execution proof also invalidates useful-work proof.

### Evidence replacement fence

A second useful-work readback for the same execution binding cannot silently replace the first accepted evidence chain.

The journal compares:

Repository identity:
- repository identity digest;
- checkout SHA;
- source snapshot digest.

Edit identity:
- patch digest;
- changed-file manifest digest;
- file count;
- edit-operation count.

Verification identity:
- command contract digest;
- pre-repair receipt + exit;
- post-repair receipt + exit.

Artifact identity:
- artifact digest + bytes;
- provenance digest;
- independent verification receipt digest.

Review identity:
- review receipt digest;
- accepted artifact digest.

Classification:
- evidence class;
- evidence origin;
- C5 verified boolean.

If any of these changes while the same execution binding remains current:

`client_goal_journal_useful_work_proof_collision`

is raised.

A new artifact/evidence chain therefore requires an honest execution-state transition that first invalidates the old proof.

### Identical readback is idempotent

If the same proof is observed again after restart:

- no second effect is created;
- no journal state changes;
- no new disk write occurs;
- `updated_at` remains unchanged.

This makes repeated readback reconciliation cheap and deterministic.

## Restart / replay boundary

The existing `reconcileClientGoal(...)` path was re-audited.

It reads:

- `clientGoalProgress`;
- `clientGoalExecutionProof`.

It contains no call to:

- `clientGoalSubmit(...)`;
- `submitClientGoal(...)`.

The new restart tests pin this as a regression canary.

The journal itself owns no:

- provider authority;
- scheduler authority;
- browser actuation authority;
- release authority;
- automatic retry authority.

All remain false.

## Adversarial tests

New suite:

`apps/metaengine-browser/test/client-v1-c5-useful-work-restart.test.mjs`

Cases:

1. accepted useful-work proof survives durable restart;
2. evidence class/origin survive unchanged;
3. identical readback after restart is a no-op write;
4. new lease generation invalidates execution + useful-work proof;
5. new result digest invalidates old useful-work proof;
6. same execution cannot replace accepted artifact/provenance;
7. same artifact with different patch chain is also a collision;
8. failed disk write cannot publish in-memory useful-work state;
9. corrupted stored proof is discarded on restart after full revalidation;
10. restart reconciliation cannot submit the goal again;
11. journal owns no provider/scheduler/browser/release authority.

The workflow also re-runs:

- C5 useful-work contract tests;
- execution-proof integrity tests;
- Agent-origin/result proof tests.

## Exact CI

Workflow:

`Client V1 C5 Useful Work Restart`

Run:

`37395355634`

Job:

`112049911799`

Exact head:

`fed0fba82b67eb49cad4a3a2f72927c6e4068882`

Conclusion:

**SUCCESS**

Aggregate tests:

- tests: **48**
- pass: **48**
- fail: **0**
- skipped: **0**

Source checkout unchanged:

**PASS**

## Amplifier research

### Durable state should reconstruct progress, not replay external effects

Temporal documents durable execution as reconstruction of workflow state from durable history after failures. During replay, previously executed external operations are represented by recorded results instead of being executed again.

Sources:

- https://docs.temporal.io/temporal
- https://docs.temporal.io/tasks

Applied inference for METAENGINE:

The Client journal should reconstruct the accepted proof state from durable exact evidence. It must not reinterpret restart as permission to call the external Agent/browser/provider effect again.

This project is not claiming to implement Temporal. The relevant design principle is replay safety.

### Read-only reconciliation is distinct from writes

Temporal's message-passing documentation distinguishes read-only Queries from state-changing Signals/Updates.

Source:

https://docs.temporal.io/encyclopedia/workflow-message-passing

Applied inference:

Client restart/reconciliation should prefer bounded readback of current authoritative state. A read failure does not convert into permission to repeat the original goal effect.

### Artifact state is evidence, not a cache hint

GitHub describes workflow artifacts as persistent outputs suitable for passing build/test material between jobs, with digest validation available during upload/download.

Sources:

- https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts
- https://docs.github.com/en/actions/tutorials/store-and-share-data

Applied inference:

The useful-work proof is content-addressed durable evidence. It is not a disposable cache entry that can be replaced under the same execution identity.

## Non-claims

This checkpoint does not prove:

- a live Agent completed useful work;
- a real provider session survived restart;
- Windows process restart;
- OS reboot/login restart;
- live signed C5 readback endpoint;
- A1 ACTIVE workspace authority;
- canonical C2 completion;
- production promotion.

## Next safe gap

The next safe implementation step is a **read-only C5 readback path**:

`Supervisor read-only useful-work proof → native client normalization → durable journal recordUsefulWorkProof → UI projection`.

That path must:

- contain no submit/mutation fallback;
- reject raw patch/log/model/page payloads;
- preserve LIVE/SYNTHETIC classification;
- never turn missing readback into automatic work replay.

Deploying or exercising a live provider/Agent mutation remains a separate authority boundary.

## Checkpoint

Client useful-work restart durability: **EVIDENCE_READY / PREPARE_ONLY**.

C5 LIVE useful work: **NOT_PROVEN**.  
Canonical C2: **NOT_PROVEN**.  
Authority effect: **false**.
