# METAENGINE parent/child coordination: source-only audit (2026-11-05)

Status: **DRAFT / PROVISIONAL**, not an installer or durable-scheduler qualification.
No real PC, database, services, listeners, credentials, model calls, signing, or budget changes were used.

## 1. Source identity and evidence boundary

- Repository: `PatrickFrome/Compute`.
- Requested archive producer: branch `work/source-transfer-c26565e-20261103`, commit `accb28e72c87c059e780efb8e6681886b33e9b4f`.
- Producer README claims source revision `c26565e58ab92dcbcda9663c4d231bdf4a9a7ee6`, source tree `2dbe253e97379532f6f4b52ef7edf26109a9266d`, and joined archive SHA-256 `4200e492828dbb857aaa737a7ce56d0aeda3c97c84f7743b1501ef2f229d3636`.
- Archive is `archive.part00` (7,200,000 bytes), `archive.part01` (7,200,000 bytes), `archive.part02` (1,657,953 bytes). **NOT VERIFIED**: concatenated bytes and archive SHA-256. The connected GitHub text interface does not expose those binary file bytes, and the isolated executor has no direct GitHub network access.
- Requested integration patch: `coordination/source-transfer/c26565e/integrated-c265-to-e30.patch`, introduced by commit `d53ccd4135f28206d91d6804cf0626095565e6af`, Git blob `79d40bf024a6553656b86fb1a29c1313dd458a0e` (1,269,917 bytes). The text was inspected but **not** applied to the joined archive.
- Requested reconstructed tree `90fa5633d7926dd71a7303266073e0625325e740`: **NOT VERIFIED**. This branch is based on accessible GitHub commit `d53ccd4135f28206d91d6804cf0626095565e6af`, not a reconstructed c265/e30 checkout. Do not assume the two trees are identical.

## 2. Trace of the observed code (d53 source)

| Boundary | Producer / consumer | Observed behavior |
| --- | --- | --- |
| Spawn/proposal | `meta-orchestrator-core.mjs` / `meta-orchestrator-continuous-reconcile.mjs` | Emits zero-authority `PROPOSE_TASK` actions with `parent_point_id` for required CRITIC/FALSIFIER companions. Capacity and atomic-frontier policies constrain proposals; a proposal is not a child spawn acknowledgement. |
| Admission | `meta-orchestrator-devos-adapter.mjs`, `meta-orchestrator-native-provider.mjs` | Uses the existing native supervisor's durable `/v1/meta/admit-task` or `admit-frontier` path; errors and partial readback are classified `AMBIGUOUS` rather than blindly replayed. Existing scheduler retains permit/lease authority. |
| Parent/child projection | `meta-orchestrator-authoritative-snapshot.mjs` | Projects only current roadmap/alignment/plan-generation rows with matching parent plan point and canonical child prefix; strips scheduler identity and result text. Child rows outside this producer projection cannot be checked. |
| Aggregation | `meta-orchestrator-core.mjs` | Progress ledger is plan-node-centric. A base `CONVERGED` sees verified parent nodes but does not itself join child states. |
| Completion safety | `meta-orchestrator-continuous-reconcile.mjs` | Previously protected fixed safety companions. Patch adds observed plan-linked descendants and unresolved older observations; the snapshot adapter now calls this reconciler instead of the base one. This returns **advisory/zero-authority** progress, not a durable parent-task completion ACK. |
| Cancellation and error | `devos-native-task-cycle-core.mjs`, native supervisor `devos-routes.mjs` | A trusted task completion is bound to existing lease and forwarded to `devos_fleet_complete_v1`; effect ambiguity is journaled and replay is fenced. No source evidence here proves that cancelling a parent atomically cancels/joins every child or that the SQL completion RPC includes a descendant effect barrier. |

## 3. Reproduced failures and patch

Inert source execution on GitHub d53 modules before patch:

- Parent completed + receipt verified + HIGH child `RUNNING` -> snapshot reported `CONVERGED`; continuous reported `SAFETY_WAIT`.
- Same with child `AMBIGUOUS` -> snapshot `CONVERGED`; continuous `RECONCILING`.
- Same with child `CANCELLED` or `FAILED` -> snapshot `CONVERGED`; continuous `BLOCKED`.
- NORMAL-risk parent with a projected non-safety child `RUNNING` or `AMBIGUOUS` -> continuous `CONVERGED` before patch.
- A newer `COMPLETED` observation could hide an older `AMBIGUOUS` child incarnation in the same current plan generation.

Patch scope (source only):

1. Route `reconcileMetaAuthoritativeSnapshot` through the existing continuous reconciler.
2. Include every **observed, plan-linked** descendant and unresolved older observation in the continuous completion gate; deduplicate emitted point ids.
3. Upgrade the existing `CONVERGED` test fixture to include a completed required critic; add 18 inert tests for active, unknown, canceled, failed, incomplete, stale, ambiguous, partial-failure and 140-observed-child cases.

No new authority, permit, scheduler, retries, global agent count ceiling, tool budget, signing or runtime network behavior. Existing per-frontier transaction/policy/resource bounds are unchanged.

## 4. Critical open blockers (do NOT certify durable parent completion)

1. **Incomplete readback:** `supabase/migrations/20260831200500_meta_orchestrator_authoritative_inputs_v1.sql` returns tasks with `LIMIT 512` and receipts with `LIMIT 512`, without `has_more` or a stable cursor. A descendant beyond the projection can be omitted. The correct fix is bounded keyset pagination + complete/fenced snapshot identity, not a larger artificial cap or unbounded response. The current guard is conditional on complete authoritative input.
2. **No proven durable descendant/effect join:** A read-only `CONVERGED` must not be substituted for `devos_fleet_complete_v1` readback. Need original scheduler/Owner producer demonstrating that every child effect has a known terminal outcome, including cancellation, partial admission, ambiguous retries and process restart.
3. **Generation/restart lineage:** Projector filters to current plan generation. A still-ambiguous older-generation effect is not visible in that projection. Need original stable parent task id, child identity/incarnation, a generation-fenced effect ledger, and readback across handoffs without inventing new signer or permit.
4. **Cancellation fan-out:** No verified original parent-cancel -> child-cancel -> effect-settlement barrier. Treat this as **NOT PROVEN**, not automatic cancellation.
5. **Exact target tree:** The user-requested `90fa5633...` reconstruction could not be checked, so applicability to that exact checkout remains **NOT RUN**; reconcile this patch with the reconstructed tree before integration.

## 5. Test/operation status

| Test or action | Result |
| --- | --- |
| Red reproduction on accessible d53 source | **PASS** (observed unsafe convergence) |
| Green inert V8 evaluation of exact branch source and three test files | **40 PASS / 0 FAIL**: 18 new parent/child, 7 authoritative-snapshot, 15 continuous-reconcile |
| Node `--test` on reconstructed c265 + integrated patch | **NOT RUN** (binary archive unavailable to isolated runner) |
| SHA-256 of joined archive, tree `90fa...`, apply/rebase against it | **NOT RUN** |
| Real PostgreSQL, services, Windows, PC, installer, ACL/credential access, model billing | **NOT RUN**, forbidden |
| Branch publication | **PASS**, branch `work/audit-parent-child-snapshot-gate-20261105` |
| Draft PR | Created separately; verify PR metadata before claiming a number |
| Merge | **NOT RUN**, prohibited |

This is a useful, deliberately narrow mitigation to the observable projection, **not** proof that the durable scheduler can complete a parent only after every possible descendant effect is settled.
