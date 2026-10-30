# METAENGINE — critical review before client installation

**Decision: the collected source is not yet an install-qualified autonomous client.** The reviewed baseline and small fixes are preserved, but the real chain “chat → native CLI → independent critic → repair → accepted checkpoint → next task” has not passed as one installed system. Test totals from different source trees and fixtures must not be added up as proof of that chain.

## What is actually collected

- Public baseline: `5d7ec74db1c72b15921a6e00a2826a09a72f4fb2`, Draft PR #1385. It contains the reviewed activation, physical-settlement, setup, capacity and UI-reliability source work, with explicit closed default gates.
- Safe source snapshot inputs: fixture/schema merge `614d13c2279c244eebfcb52f498adab54561a401`; native helper fixes `3e6bcb3fc769b3358e4b82d7aa033249c3ec377f` (PR #1387); source-seal producer `352ac6ae7fc08c40ac7b1cf78aeb4a464a000e2a` (PR #1388). Their original histories are retained. The source-seal producer is collected, **not applied** to manufacture a passing seal.
- Active Owner WIP: `1cfbcdfc14e55449d5aa8c71e12f7887eb30ff3c`, PR #1390, based on initial Owner overlay `104c25185bb841fe82e957f704373e6ee92bebcf` (PR #1386). Kept separate from the safe snapshot.
- Shared-ticket WIP: `da0924351828d61e9ff373ce9bce5c5665ee84a3`, PR #1389, including separate fixture commit `74d52127414e202b59a05ef1eb606da0f1ce94ab`. Kept separate from the safe snapshot.
- UI application source is already represented in the public baseline. The exact narrow W23 workflow patch is now collected and applied: frozen Bun install adds `--ignore-scripts` and a `git diff --exit-code -- package.json bun.lock` guard. Its source patch SHA256 is `784d36f3cf25e215043cc42c7ec446f01e052921fc64a8b077e197ef23a45821`. No application or lockfile bytes changed; no child commit SHA was invented.

Owner and ticket WIP both change `apps/metaengine-browser/src/native-coding-host-ipc-client.mjs` and `infra/client-state-runtime/native-coding-host-ipc.mjs`. They require deliberate joint review; a clean textual merge would not establish lifecycle correctness.

## Improvements with real supporting evidence

1. Same-root activation and Save/Activate separation, retained unknown outcomes, physical request settlement, shutdown ordering and setup/capacity source contracts now have extensive negative tests. Their default refusal states remain honest.
2. The two integration repairs address reproduced failures without weakening production authority: six admission/route fixture failures and a missing **already-registered** capacity-v2 entry in the current fresh-schema inventory. Callback-publication SQL is still unregistered. Real disposable PG17 migration/replay and message-parent checks passed on that repair.
3. Native work supplied five source fixes around the PowerShell continuation/parser boundary and Windows fixture behavior. **208 Windows cases were reported across three runs**, not one complete run of the new unified tree. This is useful Windows evidence, not a substitute for final installed qualification.
4. On exact public baseline 5d7, UI work reported **242 passed / 11 platform skips**, exact-lock/dependency and build checks passed, and **16 browser scenarios** passed with a synthetic bridge. This closes previously observed dependency uncertainty for that tested UI source. It does not prove native webcontents, real Main/Host coupling, IME or installed behavior.
5. A reviewed source-seal producer can describe a new current source honestly. It has not regenerated a historical ledger, signed a release or qualified an installer.

## P0 — installation and execution blockers

### 1. Genuine current Owner/control composition is incomplete

The active-project Owner PG path ended with **`leased:false`**, not successful native admission. Its broader IPC selection was **102 passed / 3 failed**. Other positive reader/control tests exercise useful separate parts but do not establish the complete active-project path. Native loaded-code/provenance qualification remains explicitly false or unavailable.

**Specific next reproduction:** static review of `active-run-owner-pg-fixture.mjs` found provider registration followed immediately by W30 leasing, without a visible fresh v2 service-heartbeat/capacity publication in that fixture. Missing current service proof is a **probable, not confirmed** cause of `leased:false`. Compare its exact SQL refusal/readback with the existing real capacity-PG positive path before changing anything. Do not remove the admission gate or infer a cause from the boolean alone.

**Required evidence:** actual current loaded identity, original sealed Owner record, runtime-control generation, exact Host/PG incarnation and protected project/reservation must agree through the same operation lifetime; signed activation → legitimate W30 CLI lease → reservation → fresh read must pass. Stop/reset, revocation, two runs, timeout and explicit quit must remain fail-closed. No resealing, enrollment or constructor booleans may stand in for this proof.

### 2. Publication/single-ticket lifecycle still fails

Shared-ticket tests report **17 passed / 2 failed** in standalone transport and **131 passed / 11 failed** in the combined selection. These are separate selections with possible overlap, not thirteen uniquely established defects. Failures include timeout/unhandled-rejection and lost-ACK cases, a settlement-send-failure expectation, and Windows protected-path refusals. PG17 **55 passed** and parser **274 passed** do not resolve those transport/path failures.

**Required evidence:** one original admission ticket must cover durable prefix publication and operation send, with no release/reacquire oversubscription. Publication ACK plus exact original physical settlement and independently authenticated current Owner/control must precede send. Lost ACK, crash, rollback poison, forged/late terminal, cancellation and shutdown must preserve custody and prevent resend. Resolve failures without relaxed deadlines, permission bypass or caller-supplied proof. **The default gate remains closed; the adapter is unmounted and SQL unregistered.**

### 3. Historical cleanup/capacity release is not attested

`HISTORICAL_SETTLEMENT_UNVERIFIED` is a real blocker to continuous next-task autonomy. A valid result, SQL terminal row, helper PID/exit, locally readable hash chain or boolean shutdown witness is not complete durable proof of all callbacks and effects. The helper/local-output receipt does not by itself join Host callback settlement.

**Required evidence:** extend the existing protected receipt/authority path with exact run/request digest, original helper/child birth, checked process-tree/output cleanup, original Host callback settlement and PG/control lineage. Restart, PID reuse, missing/corrupt receipt, changed worktree and lost acknowledgment must hold capacity unless independent proof resolves the original run. Do not require current artifact equality as a substitute for historical custody proof. Keep release disabled until this chain is reviewed.

### 4. First-run materialization and long-job capacity handoff are unbound

Setup discovery and retained intents exist, but the production materializer still returns unavailable/unbound. A short transaction/ACK is not a completed cold setup job. Existing task allocation must remain W30; setup must not manufacture task leases or introduce a second allocator.

**Required evidence:** bind the actual producer under fresh repository-scoped ADMIN authorization and existing physical admission. Reserve before handoff, retain the exact operation through lost commit/ACK, and revalidate current authority before each effect. Prove crash between ledger and custody registration is HOLD, cancellation is monotonic, and readback never restarts ambiguous work. Descriptor publication must follow genuine successful preparation and validation, not predeclare readiness.

### 5. Probe and runner do not yet prove the same effective environment

The published probe still derives home from ambient `CODEX_HOME`/`USERPROFILE`, uses ambient `LOCALAPPDATA` scratch and invokes `--include-managed-config`; the runner requires explicit home, protected temporary storage and uses `--ignore-user-config`. Explicit home alone would not bind physical identity, effective policy or protected storage.

**Required evidence:** a versioned receipt must bind the actual home, temporary root, repository/worktree, ACL/physical identities, CLI version and effective configuration/policy used by the real runner. W68 must measure source in the trusted Electron process, not copy a requested hash or treat NodeHost as equivalent. Authentication remains a genuine external prerequisite. Worktree isolation is not a security sandbox.

### 6. One exact integrated Windows source/build/installer has not been qualified

Existing CI failures include stale current-source seals, fixture/schema failures addressed only in later local commits, Windows helper/callback issues and a deployed-canary equivalence mismatch. Package-dependent installed lanes consequently do not establish installation success. A green W68 **source** lane does not prove loaded installed bytes or production signing.

**Required evidence:** after selecting and integrating reviewed fixes, qualify the exact source SHA/tree and pinned dependencies on the intended Windows path; run the native failure matrix and own-PG17 tests; produce immutable package provenance and required genuine signing/sidecar evidence through the existing release mechanism. Requalify the new source with the new producer—do not overwrite old ledgers or mark skipped/blocked cases passed. Match installer, loaded runtime and qualification source exactly.

### 7. Upgrade, restart and end-to-end recovery remain acceptance work

A normal fresh installer is not evidence of safe update/rollback. The required socket lane is still blocked in the current Linux environment, and no new integrated installed acceptance replaces it. Current source defaults deliberately cannot complete autonomous execution.

**Required evidence:** an authorized disposable Windows installation must preserve Owner/data, prevent duplicate Host/PG, support backup restore and controlled rollback, and recover without replay after stop/restart or lost ACK. Prove the actual Stop UI contract distinguishes pausing future leases from cancellation/draining of already-running effects; a button label or a stopped scheduler is not evidence that effects stopped. Then run one real small project through chat → CLI → independent critic rejection → immutable repair → accepted checkpoint → next task. Validate changed Host, expired profile, missing worktree, corrupt artifact and UNKNOWN slot retention. Only that establishes the promised vertical workflow.

## P1 — product and architecture improvements after the P0 boundaries

- Keep drafts scoped to genuine current device/workspace identity and freshness. Existing navigation/restart work is valuable; still qualify real installed Back/Forward, selection, keyboard, IME, 200% zoom and native webcontents layering rather than extrapolating synthetic browser scenarios.
- Make the main view task-centered: project/attention navigation, plan and progress, changes/tests/critic/repair lineage/checkpoint/artifacts. Keep technical IDs and raw events expandable; distinguish the chat roster from CLI execution capacity and stale observations from LIVE.
- Finish structured multiline goal criteria/scope/context through the validated contract, not UI alone. Expose typed stop/pause with requested/stopped/unknown states and no optimistic completion.
- Consolidate operation envelopes, generated registrations and artifact links incrementally. Remove code only after installed entrypoint reachability evidence; do not add another broker, scheduler or trust root to hide the missing proof chain.
- Extend existing admission with measured RAM/disk/PG/provider budget and fairness feedback. Keep logical graph size separate from active physical capacity; do not impose an arbitrary history/agent ceiling.
- Measure accepted-checkpoint latency, repair cycles, UNKNOWN fraction and recovery time. Independent critic acceptance and combined-worktree conflict checks matter more than raw pass counts or agent count.

## Minimum ordered closure path

1. **Preserve and select source.** Collect every exact ref and its failed/passed/skipped evidence. Keep Owner/ticket WIP separate. Review their shared IPC state machine before integrating either.
2. **Close Owner and ticket failures together under existing custody.** Demonstrate the real W30/PG Owner path and one-ticket publication/operation sequence, including quit ordering and unknown outcomes. Keep the default gate closed until complete.
3. **Bind the genuine environment and durable settlement producers.** Align probe/runner home/temp/policy and source identity; complete original Host/PG callback lineage and crash-durable publication anchoring. Only then review historical capacity release.
4. **Bind first-run materialization to that authority and existing capacity.** Validate cold setup, cancellation, crash/readback and descriptor publication with no fabricated claims or automatic resend.
5. **Qualify one final exact source and package.** Run the integrated source/PG/Windows/native tests, apply the new current-source producer honestly, obtain real required provenance/signing and exercise installation/update/rollback.
6. **Accept the real vertical workflow.** Complete the small project and failure-recovery matrix above. Record exact source, installer, environment and independently accepted checkpoint artifacts.

Until those gates have concrete evidence, the correct status is **source preserved, partially validated, execution/install qualification incomplete**—not “ready to install” or “fully autonomous.”
