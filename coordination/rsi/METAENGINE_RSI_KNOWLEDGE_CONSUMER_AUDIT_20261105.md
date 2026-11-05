# METAENGINE RSI — verified knowledge consumer handoff source audit

Date: 2026-11-05. Scope: source-only, inert tests, no live consumers or authority effects.

## Exact source boundary

- Repository: `PatrickFrome/Compute`.
- Source-transfer branch: `work/source-transfer-c26565e-20261103`, commit `accb28e72c87c059e780efb8e6681886b33e9b4f`.
- Transfer README claims archive SHA-256 `4200e492828dbb857aaa737a7ce56d0aeda3c97c84f7743b1501ef2f229d3636` and source tree `2dbe253e97379532f6f4b52ef7edf26109a9266d`.
- Integration-patch commit: `d53ccd4135f28206d91d6804cf0626095565e6af`, blob `79d40bf024a6553656b86fb1a29c1313dd458a0e`, path `coordination/source-transfer/c26565e/integrated-c265-to-e30.patch`.
- Supplied integrated expected tree: `90fa5633d7926dd71a7303266073e0625325e740`. **Not independently reconstructed or verified.** The source archive is split into binary GitHub files inaccessible to the local execution environment; the expected tree is not published as a Git object. The integration patch does **not** list any RSI modules in its changed-file headers. For this patch, GitHub's exact RSI blob `2876b0c9421c8145be12b98bb93aee229fd6f7fe` was used unchanged as the text baseline, but the PR branch is not represented as the reconstructed integrated tree.

## Consumer chain and boundaries

1. `rsi-slow-knowledge-consolidation.mjs` produces the Phase 31 proposal, transfer validations, and admission. Source success is not a consumer verdict.
2. `rsi-validated-knowledge-consumer-handoff.mjs` binds model/environment, context, task set, harness, retrieval profile, evaluator generation/epoch, holdout, consumer plane, and (for recipes) the verified library. It produces consumer-local revalidation receipts and stores them in `RsiConsumerRevalidationArchive`.
3. `rsi-exact-existing-consumer-owner-review.mjs` verifies the Phase 32 bundle and may produce an owner precommit *review*, without appending to a skill library or changing retrieval exposure.
4. `rsi-consolidated-knowledge-skill-review.mjs` checks the existing `rsi-verified-skill-library.mjs`; separately, `rsi-runtime-skill-router.mjs` uses its own contextual credit evidence and thresholded negative-transfer veto. No direct archive-to-runtime selection integration was found in these source imports.
5. `rsi-experience-graph.mjs` and `rsi-adaptive-experience-retrieval.mjs` use verified graph/pool and query/feedback contracts. Phase 32 receipt persistence does not automatically update them. The handoff only specifies routes for future external owner review.

## Confirmed defect and narrow remediation

`RsiConsumerRevalidationArchive.add()` originally treated *any* second receipt for the same consumer identity as a conflict, including a later canonically verified `CONSUMER_NEGATIVE_TRANSFER` receipt. This prevents append-only recording of contradictory post-handoff evidence, leaving an earlier positive row preserved without a consumer-local veto. The new `rsi-consumer-evidence-frontier.mjs` defines a bounded, deterministic lifecycle rule:

- First canonically verified receipt: append.
- Same receipt ID + exact digest: idempotent (storage does not append again).
- Same identity + fresh adverse receipt: append; any adverse receipt vetoes a later positive owner-review eligibility result.
- Conflicting receipt ID, changed handoff/identity, duplicate persisted row, or subsequent fresh positive receipt: fail closed.
- `reviewFor()` compares observed consumer-owned context/task/harness/retrieval/evaluator/epoch/library/plane roots and refuses stale/unobserved states. It is read-only and returns **only** eligibility for *fresh external owner review*, never authorization for skill activation or execution.
- In-instance `add()` operations are serialized to avoid dropping a late adverse row during concurrent calls to the same archive object.

The original canonical Phase 31/32 verifiers are still invoked on every persisted row and incoming receipt. No new signer, scheduler, trust root, fake verifier, or executable authority is added.

## Evidence / limits

- **PASS**: 13/13 pure Node `node:test` cases for revision policy, same-receipt idempotency, negative after positive, no positive resurrection, changed identity, invalid binding, missing current state, context/task/profile/library/epoch drift, corrupted history, and no authority effect.
- **PASS**: Git blob SHA-1 of both test and helper files matches the local files exactly. The GitHub source transformation was guarded by the exact baseline blob SHA and seven unique in-place source regions.
- **NOT RUN**: full repository suite; direct `RsiConsumerRevalidationArchive` integration with Phase 31 evidence fixtures; real consumer skill/retrieval calls; OS/DB/service/installer/Windows tests.
- **NOT VERIFIED**: reconstructed c265 archive SHA or full integrated tree `90fa...`, as noted above.

## Residual blockers — do not infer activation

- No reliable source-level proof of end-to-end adoption by the live `rsi-runtime-skill-router`, skill lifecycle, experience graph or adaptive retrieval from Phase 32 archive rows. Their own governance and runtime evidence inputs must be reconciled by the existing external owners.
- `reviewFor()` compares supplied owner observations; it does not prove those observations reflect live state. Existing owners must bind them to their authenticated current snapshots. There is no new cryptographic attestation.
- No expiry clock/deadline is encoded in Phase 32; digest equality is not proof that evidence has not aged past a policy TTL. Freshness and revocation outside this local archive need an existing owner-controlled frontier.
- The archive remains a local file with no cross-process lock or directory fsync. In-process writes are serialized; cross-process concurrent writers could still lose information and need coordinator-owned storage fencing.
- Do not merge, promote or activate based on this audit. It is a source-only, review-only patch against the available GitHub text blob, not proof of the expected full integrated tree.
