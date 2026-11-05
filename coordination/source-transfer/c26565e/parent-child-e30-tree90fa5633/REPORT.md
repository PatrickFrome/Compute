# METAENGINE — parent/child coordination audit on exact e30 tree

**Status:** SOURCE-ONLY, review candidate. No merge, installation, service, real PostgreSQL, PC, network listener, model/API billing, or secrets used.

## Exact source identity (verified)

- Repository-only origin: `PatrickFrome/Compute`; original c265 transfer commit `accb28e72c87c059e780efb8e6681886b33e9b4f`; integrated patch source commit `d53ccd4135f28206d91d6804cf0626095565e6af`.
- Official Space Library file `libfile_67e248dedc1081918003c1514194a6f7`: `METAENGINE-e30-github-only-source.zip`.
- Exact SHA-256: `169f4dc6379605d68d34360c9d28d687b4da3dc856aea6fc1fb27e6bc6d3ba06` — **PASS**.
- Independent Git blob + tree hashing from ZIP bytes: `90fa5633d7926dd71a7303266073e0625325e740` — **PASS**.
- Separate `git write-tree` after mode-preserving extraction: `90fa5633d7926dd71a7303266073e0625325e740` — **PASS**.
- 4,346 file blobs, 74 with executable mode `100755`; all others regular `100644`. No symlink or unsafe `..` ZIP path was found.
- This patch is **against reconstructed e30 tree** `90fa5633...`, not against GitHub commit `d53ccd...` working tree; do not apply it as a direct GitHub merge to the archive-transfer branch.

## Actual producer/consumer path

`/v1/devos/cycle` in `apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/devos-routes.mjs`
→ `createMetaDevosSuperstep()` in `meta-devos-superstep.mjs`
→ `meta_orchestrator_authoritative_inputs_v1` + `devos_fleet_capacity_snapshot_v1` via existing RPC
→ `MetaOrchestratorPrivilegedAdapter.readAuthoritativeBundle()`
→ `projectDevosTasksForMetaPlan()` / `buildMetaAuthoritativeSnapshot()`
→ existing `reconcileContinuousMetaOrchestrator()`
→ bounded `meta_orchestrator_frontier_admit_v2` only for warranted, zero-authority `PROPOSE_TASK` actions
→ existing DevOS scheduler and its own lease/effect machinery.

**Correction to earlier draft:** production superstep **already** invoked the continuous reconciler. The real gap on this tree was that `safetyState` checked only the expected `CRITIC`/`FALSIFIER` nodes and only the latest state for each. Non-verifier plan-linked children and older ambiguous incarnations did not affect convergence. Separately, `reconcileMetaAuthoritativeSnapshot()` and `MetaOrchestratorPrivilegedAdapter.reconcile()` called the base reconciler directly and skipped even the fixed companion gate. The latter paths are real functions, but their use for durable production completion is **not proven**; no invented claim is made about additional runtime callers.

### Spawn, cancellation and errors

- `meta-orchestrator-core.mjs` emits *proposals*; actual child/task admission uses the existing source-side RPC and scheduler. The R86 `RESULT_READY`→verifier→acceptance ordering remains intact. Proposals must not be mistaken for actual spawned task IDs or permits.
- The task projection is filtered by roadmap, authority alignment, plan generation, parent plan point, parent-child prefix, and source baseline; scheduler identity and worker text are omitted.
- The continuous reconciler now blocks advisory convergence if an observed plan-linked child is `READY`/`LEASED`/`RUNNING`/`RESULT_READY`, requests reconciliation for `AMBIGUOUS`, and reports `BLOCKED` for failed/cancelled/fenced/unknown child outcomes. An older observed `AMBIGUOUS` child or parent record is not hidden by a newer `COMPLETED` row.
- No cancellation fan-out is performed by this patch. No new scheduler, authority, permit, signer, budget, effect retry or trusted completion receipt has been introduced.
- The original DevOS trusted completion path `devos-native-task-cycle-core.mjs` → `/v1/devos/complete` → `devos_fleet_complete_v1` remains separate. It has **NOT** been proven to enforce an atomic durable parent/descendant effect-settlement barrier. An advisory `CONVERGED` value must not authorize durable task completion.

## The 512-row completeness hole

Two source SQL definitions (the initial `20260831200500...` and later overriding `20260929133000...`) use `ORDER BY ... LIMIT 512` to project current-plan tasks. They do not provide a trusted cursor, `has_more`, or full enumeration witness. The older definition also has a receipt window bounded at 512; the newer definition emits an empty receipt list. A returned window of exactly 512 rows might omit an unresolved child.

The narrow patch fails closed when a raw task/receipt input window has **512 or more** rows. It never treats a full page as proof of exhaustion. This is a *readback completeness hold*, **not** a fleet/global number-of-agents or commands cap; resource budgets, proposal per-cycle limits and existing replay controls are unchanged. A future bounded keyset pagination + generation-stable completion witness is still required; this patch does not pretend to implement one or treat caller JSON as original source authority.

## Reproduced bugs and narrow patch

1. Snapshot and privileged reconcile called `reconcileMetaOrchestrator` directly, bypassing the existing continuous safety gate → route both through the continuous reconciler.
2. Production continuous safety gate only consulted fixed R86 verifiers and selected latest observed state → also consult every **observed, directly plan-linked** child; preserve old ambiguity, cancellation and partial failure; deduplicate by semantic point with ambiguity/failure precedence.
3. R86 returned `VERIFYING`/`ACCEPTANCE_PENDING` before checking observed child ambiguity → check the ambiguous/failure barrier before returning the existing R86 state; keep verifier sequencing and immutable zero-authority outputs.
4. A full, unproven 512-row SQL read could still yield `CONVERGED` → refuse such source input before reconciliation.
5. Existing test fixtures that asserted legitimate completion without a required R86 critic were corrected to include a completed critic. The old ambiguous-verifier test now asserts the **stronger** `RECONCILING` + `REQUEST_RECONCILIATION` + no-retry contract; no assertions were removed to force a pass.

## Test record (source-only; no real resources)

| Test/verification | Result |
| --- | --- |
| Baseline existing seven scoped modules, before changes | **82 PASS, 0 FAIL** |
| New exact-tree red reproduction on untouched `90fa...` source | **4 PASS, 17 FAIL** (expected defects; all failures captured in `red-21-tests.tap`) |
| New exact-tree tests after patch | **21 PASS, 0 FAIL** |
| 16-source-file inert integrated suite on patched checkout | **165 PASS, 0 FAIL, 0 SKIP** |
| Fresh **second** checkout from ZIP: independent `git write-tree`, `git apply --check`, `git apply`, 165-test rerun | **PASS**; 165 PASS, 0 FAIL |
| `git diff --check`, Node syntax checks, preserved original executable modes | **PASS** |
| `meta-orchestrator-local-endpoint.test.mjs` and `meta-orchestrator-native-provider-client.test.mjs` | **NOT RUN** — both create HTTP listeners |
| Windows, installer, production PostgreSQL, actual services, real cancellation/spawn, network listeners, external CI | **NOT RUN** |
| GitHub merge | **NOT RUN** (forbidden) |

### Exact reproducibility

Extract the supplied verified ZIP with Unix execute modes preserved; independently check original tree `90fa5633d7926dd71a7303266073e0625325e740`. Then from the resulting `Compute/` root:

```sh
git apply --check METAENGINE-e30-parent-child-tree90fa5633.patch
git apply METAENGINE-e30-parent-child-tree90fa5633.patch
node --test apps/metaengine-browser/test/meta-orchestrator-parent-child-exact-tree.test.mjs
# Full approved inert suite: all meta-orchestrator*.test.mjs plus meta-devos-superstep.test.mjs,
# except local-endpoint and native-provider-client, which start HTTP listeners.
```

Patch SHA-256: `92093f722a90be107f1f28f9c183571bc96efdfe2363880c3031bb60b7a9c8fd`.

## Remaining HOLD / blockers

- **Durable parent completion:** production SQL `devos_fleet_complete_v1` has not been shown to require final proof of all descendants, all attempts, and unknown/aborted effects; this patch protects the read-only orchestrator projection only.
- **Incomplete history:** SQL filters to the *current* plan generation. An unresolved effect belonging to a prior plan generation is not guaranteed to appear; direct readback cannot prove it settled.
- **Pagination:** source-backed, keyset paginated reading with a stable plan/lineage epoch and a verified exhaustion condition is necessary to safely process 512+ observed tasks. Do not replace the original witness with a caller boolean.
- **Cancellation propagation:** no demonstrated parent cancel → child cancel → effect readback → durable acknowledgement barrier. Keep cancellation and partial outcomes as non-success until original scheduler reconciliation proves otherwise.
- **Live qualification:** no actual installed instance, Windows, real DB or external CI was tested. The local test evidence cannot be treated as approval for installation or merge.

**Disposition:** narrow patch is reproducible and useful for review; durable end-to-end parent/child completion remains **HOLD**.
