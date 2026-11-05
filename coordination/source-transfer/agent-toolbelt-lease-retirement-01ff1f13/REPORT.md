# METAENGINE source-only: bounded retirement of completed agent tool leases

Date: 2026-11-05. Scope: `agent-toolbelt-core.mjs` and a separate, non-merged `devos-native-task-cycle-core.mjs` integration hunk. No durable dispatcher journal edits.

## Exact inputs

- User-provided Space Library file `libfile_c846c6cdca908191b8b853e3e48359f5` (`METAENGINE-agent-count-free-tools-source.zip`, 16,392,035 bytes).
- Materialized ZIP SHA256 **`3d10cdc8c7801870cd33b5bed1f9b8efee1bb597fd412f401407fec7d247e68a`**, matching supplied pin.
- Extracted 4,407 regular files under `source/`. ZIP Unix mode bits were preserved (4,333 mode 100644, 74 mode 100755); no symbolic links or nonregular entries.
- Fresh disposable Git index `git write-tree` **`01ff1f13e9a8723f7d631c075ea49f55d51ed405`**, matching supplied target tree. This is the source identity, not a claim that an unpublished commit is on GitHub.
- Public e30 patch-transfer branch: `work/integrated-e30-source-patch-20261103`, GitHub commit `d53ccd4135f28206d91d6804cf0626095565e6af`. It holds reconstructed-source artifacts, not an identical checked-out `01ff1f13...` source tree; therefore the proposed Draft PR distributes precise applyable patches, NOT an overwrite of the public repo's source files.

## Confirmed defect versus preliminary hypothesis

The supplied candidate already has `MAX_ACTIVE_LEASE_CACHES = 128` and `MAX_SERVED_RESULTS = 128`; `#budgetWitnesses` is maintained as a subset of `#byLease`. An unlimited map-count leak was **NOT reproduced** in this exact tree.

A real unsafe eviction *was* reproduced: the old `#leaseRows` eligible-victim predicate excludes `PENDING` and `effect_unknown` but ignores `row.custody_pending===true`, which is set when an original budget-result resolution fails. Under pressure from 128 further settled leases, the original uncommitted local row disappeared despite not having confirmed durable settlement. Reproduction: `baseline-eviction-proof.json` shows `before_pressure_original_uncommitted` populated and `after_pressure_original_uncommitted=[]` on the unmodified source. This is not evidence that the durable journal itself lost data.

Completed leases also retained their local cache until the 128-entry LRU pressure threshold, even when their successful completion was independently known to the task-cycle. This is bounded but avoidable retained lifetime state.

## Minimal repair

1. `AgentToolbelt.#locallySettled`: a cache row is eligible for eviction/retirement only when its status is `COMPLETED`, `FAILED` or `UNAVAILABLE`, and neither `effect_unknown` nor `custody_pending` is true.
2. LRU victim selection includes every row, the separately stored budget witness and outstanding synchronous reservation counts. When all 128 leases remain unresolved, a new lease gets `TOOL_ACTIVE_READBACK_PRESSURE`; no entry is discarded to make room.
3. `canRetireSettledLease` and `retireSettledLease`: no request, identity, command, budget or scheduler effect. Only deletes local settled lease rows, reservations and associated budget witness. Global bounded `#results` remains available for the next agent message.
4. **Separate integration hunk**, NOT co-edited durable dispatcher: task-cycle invokes retirement after an authenticated completion ACK and a separate exact-generation signed task-status readback. In an uncertain ACK case, it reuses the existing status readback. `RUNNING`, `AMBIGUOUS`, generation mismatch, failed status read, PENDING, UNKNOWN, or noncommitted budget resolution never retire. The extra GET is issued **only** if the toolbelt has a locally settled cache to reclaim.
5. Restart or a later duplicate request still passes through existing `beginToolBudgetRequest` / `beginToolEffect` original journal readback, not through local cache authority; no tool issue is triggered without original durable custody. No new authority/signer/trust root/scheduler introduced.

## Tests and evidence

- Before repair: `baseline-toolbelt.tap` = 15 PASS / 0 FAIL / 0 SKIP for existing selected tests. Baseline standalone probe: unresolved `custody_pending` evicted at cache pressure (negative proof).
- New regression suite alone, with BOTH patches applied: 12 PASS / 0 FAIL / 0 SKIP; includes 3,000 settled leases, PENDING, UNKNOWN, uncommitted budget receipts, pressure, late responses, restart, and real task-cycle authenticated status/generation fences using inert mocks.
- **Core patch alone** on a clean clone of the exact verified tree: 42 PASS / 0 FAIL / 0 SKIP (`core-only.tap`). The 4 cycle integration cases are intentionally not in this core-only patch.
- **Core + separate task-cycle hunk** on the same clean tree: 68 PASS / 0 FAIL / 0 SKIP (`replay-qualification.tap`), including all selected previously existing toolbelt and cycle suites.
- `git apply --check` and `node --check`: PASS for all altered modules and added tests. `git diff --check`: PASS. No unresolved production tests were silently counted as PASS.
- NOT RUN: real PostgreSQL 17, Windows process/ACL tests, installer/package, service, PC, browser/provider network, exact installed lifetime. This source-only task intentionally forbids them.

## Artifact application

Apply core patch first against the verified `01ff1f13...` tree. Independently reconcile `INTEGRATION_TASK_CYCLE.patch` with the owner of shared `devos-native-task-cycle-core.mjs`; no wholesale replacement and no modification to dispatcher durable journal.

```bash
sha256sum METAENGINE-agent-count-free-tools-source.zip
# Must match: 3d10cdc8c7801870cd33b5bed1f9b8efee1bb597fd412f401407fec7d247e68a
cd source
git init -q
git add --all
git write-tree
# Must match: 01ff1f13e9a8723f7d631c075ea49f55d51ed405
git apply --check AGENT_TOOLBELT_RETIREMENT_CORE.patch
git apply AGENT_TOOLBELT_RETIREMENT_CORE.patch
node --test --test-concurrency=1 \
 apps/metaengine-browser/test/agent-toolbelt.test.mjs \
 apps/metaengine-browser/test/agent-toolbelt-concurrency.test.mjs \
 apps/metaengine-browser/test/agent-toolbelt-long-run-audit.test.mjs \
 apps/metaengine-browser/test/agent-toolbelt-lease-retirement.test.mjs
# Owner integration review only, then:
git apply --check INTEGRATION_TASK_CYCLE.patch
git apply INTEGRATION_TASK_CYCLE.patch
node --test --test-concurrency=1 \
 apps/metaengine-browser/test/agent-toolbelt-lease-retirement-integration.test.mjs \
 apps/metaengine-browser/test/devos-native-task-cycle.test.mjs
```

## Constraints and remaining risks

- This artifact does not alter or qualify the separately developed dispatcher durable journal. Inert `toolbeltCustodyModel` uses original-custody semantics but does not prove an installed database's correctness.
- Local `#results` is still capped at 128; the durable project journal is required to recover older results. Retirement is memory reclamation, not durable-result deletion.
- Unresolved lease caches remain conservatively pinned; if 128 leases retain uncertainty, admission receives explicit backpressure. This is intentional until an independently authorized readback/repair path exists.
- Task-cycle has other lifetime structures (`#attempted`, telemetry/context maps) outside this narrow issue. They were not touched.
- The Draft PR, if opened, is a source-review artifact against the public e30 transfer branch; it does not assert that the unpublished candidate has been merged, deployed or physically qualified.
