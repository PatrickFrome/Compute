# METAENGINE Client V1 C5 — Useful-Work Restart Continuity Checkpoint

Date: 2026-10-06  
Status: **EVIDENCE_READY — PREPARE_ONLY / NON-LIVE CONTINUITY**  
Branch: `work/client-v1-c5-restart-continuity-v1`  
Qualified code head: `71cce19dcb36ccd8ec9546362d0ef49d8c5e0dd1`

## Roadmap reconciliation

Canonical Level-1 owner: **C2 — First Serial Coding Loop**.

This slice advances the continuity of Client-side C5 evidence after a useful-work result has already been accepted. It does not execute a live Agent task and does not promote canonical C2.

The canonical spine remains:

`R1 → C1 First Real Linux Worker → C2 First Serial Coding Loop`.

Client sequence now has the following bounded evidence:

1. Windows real install/runtime/uninstall mechanics — EVIDENCE_READY.
2. C5 useful-work verifier contract — EVIDENCE_READY / PREPARE_ONLY.
3. C5 physical repo/edit/test/build/artifact reference — EVIDENCE_READY / SYNTHETIC.
4. C5 restart continuity contract — this checkpoint.
5. Live Client Agent-driven useful work — still NOT_PROVEN.

## Problem

Before this slice, `ClientGoalJournal` persisted:

- request correlation;
- goal submission receipt;
- task progress;
- Agent/result execution proof.

It did not persist the derived C5 useful-work proof.

Therefore a future live useful-work proof could be independently valid at one instant but lose its accepted artifact/provenance state after Client restart, or be restored without a durable check that it still matched the exact task/execution binding.

The required behavior is:

- restart restores an already accepted proof;
- restart never replays the original goal/effect;
- newer task/progress/execution state invalidates obsolete useful-work evidence;
- failed persistence never publishes a state that did not reach durable storage;
- evidence class remains unchanged across restart;
- persistence never creates roadmap or release authority.

## Implementation

### Useful-work ↔ execution binding helper

`apps/metaengine-browser/src/client-useful-work-proof.mjs`

New helper:

`clientUsefulWorkProofMatchesExecutionProof(proof, executionProof)`

It reuses the full useful-work normalizer and returns a boolean only when the proof:

- is structurally valid;
- is bound to the exact completed execution proof;
- still has `user_goal_to_verified_artifact_readback=true`;
- keeps `canonical_c2_promotion_authorized=false`;
- keeps `automatic_retry_allowed=false`;
- keeps `authority_effect=false`.

The helper deliberately returns `false` rather than throwing during journal restore. A stale derived proof is discarded without making the whole goal journal unreadable.

### Durable journal field

`apps/metaengine-browser/src/client-goal-journal.mjs`

Each entry may now contain:

`useful_work_proof`

The field is retained only if:

1. the entry still has an execution proof;
2. that execution proof still matches current progress;
3. the useful-work proof still matches that execution proof.

Older snapshots without the field remain compatible.

### Record operation

New journal operation:

`recordUsefulWorkProof(proof)`

It accepts only:

- schema `metaengine.client-v1.useful-work-proof.v1`;
- zero authority;
- zero automatic retry;
- canonical C2 promotion explicitly false;
- exact binding to the currently durable execution proof.

A late proof from an older lease/result is rejected.

### Progress drift invalidation

`recordProgress` now derives the surviving chain in order:

`progress → execution_proof → useful_work_proof`

If progress invalidates execution proof, useful-work proof is also cleared in the same durable update.

### Execution drift invalidation

`recordExecutionProof` retains a previous useful-work proof only when it still validates against the new execution proof.

This prevents a result/claim change from leaving an artifact acceptance projection attached to the wrong execution.

## Restart semantics

Positive test:

1. durable goal entry exists;
2. COMPLETED progress is stored;
3. accepted Agent/result execution proof is stored;
4. normalized useful-work proof is stored;
5. a new `ClientGoalJournal` instance loads the same durable snapshot;
6. the useful-work proof is restored exactly;
7. evidence class remains `SYNTHETIC` in the controlled fixture;
8. C5 remains false;
9. canonical C2 promotion remains false;
10. authority/retry remain false.

No journal API exists for goal submit, retry, or effect replay.

This checkpoint therefore models:

`restore/readback ≠ replay`.

## Adversarial coverage

New suite:

`apps/metaengine-browser/test/client-v1-c5-useful-work-restart-continuity.test.mjs`

### Progress drift

All of the following durably clear execution + useful-work proof and stay cleared after restart:

- lease generation change;
- task state change;
- result digest change;
- current progress becomes unknown.

### Execution drift

A new completed execution proof with a different result digest does not inherit the old useful-work proof.

### Corrupt/stale snapshot

If a durable snapshot contains a useful-work proof whose lease binding no longer matches the otherwise valid execution proof:

- execution proof is retained;
- stale useful-work proof is dropped.

This is fail-closed derived-state repair rather than total journal loss.

### Late proof

A useful-work proof from the previous execution binding cannot overwrite newer task state.

### Durable-write failure

If persistence fails while recording useful-work proof:

- in-memory journal does not publish the proof;
- restarted journal does not contain the proof.

The pre-existing journal invariant remains: state is published in memory only after `saveState` succeeds.

### Concurrent progress vs late proof

The journal's serialized write chain guarantees that a queued late useful-work proof observes the newer progress binding and is rejected.

## Exact CI

Workflow:

`Client V1 C5 Useful Work Restart Continuity`

Run:

`37396755881`

Job:

`112054458908`

Exact head:

`71cce19dcb36ccd8ec9546362d0ef49d8c5e0dd1`

Conclusion:

**SUCCESS**

Tests:

- total: **40**
- passed: **40**
- failed: **0**
- skipped: **0**

The run included:

- new restart continuity tests;
- existing C5 useful-work proof adversarial tests;
- existing execution-proof durability/integrity tests.

Exact checkout remained unchanged.

## Amplifier research

### Temporal durable execution

Temporal documents durable execution as preserving workflow state/progress across failures using recorded history.

It also documents replay semantics where previously completed operations return recorded results instead of performing the side effect again.

Sources:

- https://docs.temporal.io/temporal
- https://docs.temporal.io/tasks

Applied principle:

A Client restart should restore verified state and continue reconciliation from recorded evidence. It must not treat reconstruction as permission to resubmit the goal or repeat an external Agent/provider effect.

METAENGINE does not claim to implement Temporal; this is an applied durability principle.

### Electron durable state location

Electron documents `app.getPath('userData')` as the location conventionally used for application configuration/user data and now recommends using an app-specific subdirectory under `userData`.

Source:

https://www.electronjs.org/docs/latest/api/app

Applied principle:

The existing Client journal belongs in the durable Client profile boundary, not a temporary execution directory. This slice does not change the existing filesystem location; it strengthens the semantic content stored there.

### Durable write ordering

The journal already publishes new in-memory state only after the injected `saveState` succeeds.

The new proof follows the same ordering.

This is important because restart evidence must describe durable state rather than optimistic memory state.

## Evidence classification

This checkpoint is:

**PREPARE_ONLY / NON-LIVE**

The positive tests use controlled proof fixtures.

They prove restart semantics and fail-closed binding, not a live z.ai Agent/provider effect.

No positive fixture may be cited as live Client C5 evidence.

## Non-claims

This checkpoint does not prove:

- live Client goal submission;
- live z.ai Agent origin;
- live repo edit by an Agent;
- live signed Supervisor C5 readback;
- mid-effect crash recovery;
- provider outage recovery;
- installed Windows reboot/login continuity;
- A1 ACTIVE workspace authority;
- canonical C2 completion;
- release promotion.

## Next safe step

The next safe, non-provider slice is **installed Client journal persistence qualification**:

- use the real packaged Electron profile on Windows;
- seed a bounded synthetic accepted C5 journal entry through a test-only probe;
- terminate the installed process;
- relaunch the same installed binary/profile;
- read the same durable entry;
- prove no goal/effect submission occurs;
- inject a stale binding and prove fail-closed removal.

That would turn this in-memory/storage-adapter contract into physical installed-process restart evidence while remaining non-live.

After that, the remaining material boundary is the live Agent-driven useful-work run itself.

## Checkpoint

Client C5 useful-work restart continuity: **EVIDENCE_READY / PREPARE_ONLY**.

Installed-process restart continuity: **NOT_PROVEN**.  
Client C5 LIVE useful work: **NOT_PROVEN**.  
Canonical C2: **NOT_PROVEN**.  
Canonical promotion authority: **false**.
