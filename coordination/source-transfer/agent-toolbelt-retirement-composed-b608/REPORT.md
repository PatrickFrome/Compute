# METAENGINE source-only — composed lease-retirement integration review

**Date:** 2026-11-05. **Scope:** `AgentToolbelt` and the existing DevOS task-cycle consumer, plus a read-only consumer of the original project journal. No real Windows PC, installer, service, network listener, PostgreSQL, agent or browser process was touched. No existing dispatcher durable-journal file was modified. No merge.

## 1. Exact source identity

- Space Library ID: `libfile_cedb7d932e488191b676c21b12accf86` (`METAENGINE-composed-review-source.zip`, 16,404,221 bytes).
- ZIP SHA256 **`63c667fb53355c9c99073eba4a31a79b85cb42a5238cdf4a82400ef41f26a72d`** — PASS.
- Safe extraction: 4,413 regular files under `source/`, with original ZIP mode bits preserved; 4,339 files `100644`, 74 files `100755`, no executable-mode normalization, symlink or path-traversal extraction.
- Clean disposable Git index: `git write-tree` = **`b608c19fe130938d64550be4ade14393595e6023`** — PASS.
- The public GitHub e30 transfer commit is `d53ccd4135f28206d91d6804cf0626095565e6af` on `work/integrated-e30-source-patch-20261103`. Its commit stores source-transfer artifacts, *not* an identical checkout of this unpublished composed source tree. The additional locally integrated commits cannot be inferred from a ZIP without `.git` history.
- Prior source-only Draft PR [#1459](https://github.com/PatrickFrome/Compute/pull/1459) was confirmed OPEN, draft, head `87dd5def1115f71c96f2c258b4ff50de9db3e539`. Its two source patches apply cleanly to `b608c19…`; they were **not already integrated** in the supplied tree.
- The combined repaired tree is **`d5bc084a71c2c8287a1db69e9d06969e788a8cff`**, reproducible both from `b608c19…` with cumulative patches and from #1459 with incremental deltas.

## 2. Actual producer–consumer chain inspected

1. `AgentToolbelt.serveToolRequests` reserves local request slots, calls `AutonomousProjectTaskRuntime.beginToolBudgetRequest`, then (for command-plane effects) `beginToolEffect`, the signed `/v1/commands/issue-tool`, and the original `ackToolEffect`. A lost ACK does not authorize a second issue.
2. Project runtime's `beginToolBudgetRequest` reads `autonomous-project-journal`'s original debit/effect/accepted receipts. `RESOLVED`, `PENDING`, `UNKNOWN`, and a fresh, separately authorized `NEW` are distinct states. `resolveToolBudgetRequest` persists a final result before a local row becomes eligible for retirement.
3. `AgentToolbelt.harvestResults` reads the signed command receipt and awaits original effect and budget resolution before changing a local PENDING result to terminal.
4. `DevOsNativeTaskCycle.#serveAgentTools` re-harvests the same transcript and original custody after restart; no deserialized Toolbelt snapshot is used as an issue permit. `#postCompletionWithReadback` performs task completion, with exact-generation signed status readback on uncertainty and before local retirement.
5. New **read-only** `AutonomousProjectTaskRuntime.readToolCustodyForCompletion` consumes existing `journal.hasPendingTaskEffect` and returns a typed, JSON-safe current-lease projection. No table/function/new authority/journal mutation is introduced. This consumer is tracked by the existing shutdown/drain barrier. An original pending result returns `PENDING`, not invented `CLEAR`.

## 3. Confirmed regressions against #1459 on this candidate

| ID | Reproduction before correction | Narrow correction |
|---|---|---|
| CR-01 | With 127 settled per-lease rows, eight concurrent custody reads await then resolve; `#byLease` grows to 135 entries, despite the nominal cap of 128 | Reserve an actual row slot *synchronously* against rows + active reservations before the first `await`; evict only definitely settled rows, otherwise explicit backpressure |
| CR-02 | Two concurrent `harvestResults` both read the same PENDING command, resolve it twice and increment terminal counters twice | Reuse the original synchronous per-request reservation while signed GET and both durable settlements run; release in `finally` |
| CR-03 | A different agent with the same task ID and lease generation can call `retireSettledLease`, clearing the original agent's local rows | Bind cache identity to agent/tab/target/agent-generation; reject stale/foreign serve, read and retirement; delete binding with its bounded cache |
| CR-04 | `UNKNOWN` from an original durable budget lookup appears as presentation `UNAVAILABLE`; the previous task-cycle sees zero PENDING commands and can post `RESULT_READY` | Preserve separate unresolved-custody count; hold completion before posting and on trusted completion requests; a restarted, empty local cache consumes the existing journal's read-only pending-effect witness |

CR-01…03 were demonstrated before the corrections by `red-composed.tap`: 2 PASS / 3 FAIL, specifically the three assertions above. CR-04 was reproduced separately on the previous #1459 cycle hunk: `RESULT_READY` returned instead of `TOOL_EFFECT_READBACK_REQUIRED` when the original budget lookup said `UNKNOWN`.

## 4. Lifecycle and serialization rules

| State of original tool/debit effect | Local cache | Completion/retirement |
|---|---|---|
| `PENDING` signed command/ledger, or active original reservation | Keep | No retirement; task observes pending |
| `UNKNOWN` lost issue/ACK, unknown durable debit, ambiguous continuation | Keep | No blind reissue, completion HOLD if observed |
| Terminal display row with `custody_pending=true` | Keep | Not settled; no retirement |
| Original journal `hasPendingTaskEffect=true` after restart | Reconstruct by original read | `TOOL_EFFECT_READBACK_REQUIRED` before `/complete` |
| Original journal read fails or malformed | No `CLEAR` claim | HOLD when typed consumer is wired |
| Signed completion ACK, original journal CLEAR, and exact-generation signed task-status terminal readback | Only definitely settled rows can retire | Delete in-process lease rows, owners, overflow witness and reservations; retain globally bounded next-agent result ring |
| Late command receipt after simultaneous harvest | Per-request reservation serializes | One result settlement; other read is no-op |
| Stale agent/target/generation or old task status | No cross-incarnation reuse | No retirement |

Important limitation: an in-memory snapshot is **observation, not a durable effect record**. The real project journal is authoritative for restart. The read-only runtime consumer and task-cycle integration must be merged together; a stand-alone old runtime without this method is not independently qualified for the restart guarantee. Physical cross-process timing and applied SQL transaction behavior are **NOT RUN**.

## 5. Changes, ownership and test evidence

**Core-only patch** (`LEASE_RETIREMENT_CORE_B608.patch`): `agent-toolbelt-core.mjs`, the original #1459 retirement test and new composed regression suite. No shared cycle or journal files.

**Separate integration patch** (`INTEGRATION_TASK_CYCLE_AND_RUNTIME_B608.patch`): the original #1459 task-cycle hunk plus the new conditional durable readback and guards; one read-only method in `autonomous-project-task-runtime.mjs`; three inert integration/readback test files. This file remains an **integration hunk**, not a replacement of a concurrently edited shared file.

Two additional `DELTA_AFTER_PR1459_*.patch` files contain only the corrections for a coordinator who already integrated #1459. All four patches produce the same target tree when applied to their corresponding base.

- Baseline old #1459 regressions: **2 PASS, 3 expected FAIL** (`red-composed.tap`) demonstrating CR-01…03.
- Original #1459 tests applied to exact composed candidate before new fixes: **12 PASS, 0 FAIL**.
- Final targeted + adjacent inert tests on replayed combined source: **211 PASS, 0 FAIL, 0 SKIP, 0 CANCELLED, 0 TODO** (`REPLAY_TAP_211.txt`). Executed via Node `22.16.0` on isolated Linux container.
- `git apply --check` for both cumulative patches against original `b608c19…`: PASS. `git write-tree` after replay: `d5bc084…`: PASS.
- `git apply --check` for both incremental patches against the old #1459 applied tree: PASS. Resulting tree: same `d5bc084…` — PASS.
- `node --check` for all three edited modules and five added test files: PASS. `git diff --check`: PASS.
- **NOT RUN:** installed Windows client, native ACL/protected policy, real PostgreSQL 17, services, actual browser/device, installer, release signing or automatic GitHub CI qualification. No tests are silently reported as physically qualified.

## 6. Reproduce (disposable source-only)

```bash
sha256sum METAENGINE-composed-review-source.zip
# Must match 63c667fb53355c9c99073eba4a31a79b85cb42a5238cdf4a82400ef41f26a72d
# Extract with ZIP Unix modes preserved, into a fresh source/ directory.
cd source
git init -q
git add --all
git write-tree
# Must match b608c19fe130938d64550be4ade14393595e6023

git apply --check /path/to/LEASE_RETIREMENT_CORE_B608.patch
git apply /path/to/LEASE_RETIREMENT_CORE_B608.patch
# Integrator reviews and merges the shared hunk separately:
git apply --check /path/to/INTEGRATION_TASK_CYCLE_AND_RUNTIME_B608.patch
git apply /path/to/INTEGRATION_TASK_CYCLE_AND_RUNTIME_B608.patch
git add --all
git write-tree
# Must match d5bc084a71c2c8287a1db69e9d06969e788a8cff

node --test --test-concurrency=1 \
  apps/metaengine-browser/test/agent-toolbelt.test.mjs \
  apps/metaengine-browser/test/agent-toolbelt-concurrency.test.mjs \
  apps/metaengine-browser/test/agent-toolbelt-long-run-audit.test.mjs \
  apps/metaengine-browser/test/agent-toolbelt-lease-retirement.test.mjs \
  apps/metaengine-browser/test/agent-toolbelt-lease-retirement-integration.test.mjs \
  apps/metaengine-browser/test/agent-toolbelt-retirement-composed.test.mjs \
  apps/metaengine-browser/test/agent-toolbelt-retirement-composed-integration.test.mjs \
  apps/metaengine-browser/test/agent-toolbelt-retirement-runtime-readback.test.mjs \
  apps/metaengine-browser/test/agent-tool-durable-debit.test.mjs \
  apps/metaengine-browser/test/agent-tool-continuous-runtime.test.mjs \
  apps/metaengine-browser/test/agent-tool-result-json-preservation.test.mjs \
  apps/metaengine-browser/test/agent-tool-result-bounded-delivery.test.mjs \
  apps/metaengine-browser/test/devos-native-task-cycle.test.mjs \
  apps/metaengine-browser/test/autonomous-project-task-runtime.test.mjs
```

### Coordinator integration condition

Do not deploy or accept local memory retirement as proof of task completion. Ensure **both** core and shared integration are landed on the exact current tested tree; re-run source-only tests after three-way merging other stream changes. Preserve HOLD for unresolved tool debit/unknown delivery and never count a serialized in-memory cache as a proof of effect absence.
