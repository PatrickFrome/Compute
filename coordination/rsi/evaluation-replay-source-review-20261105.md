# RSI materialized evaluation delivery: source-only review (2026-11-05)

## Scope and provenance
Read-only source review of PatrickFrome/Compute with no candidate execution, no self-update activation, no listener, no DB or installed-client activity. GitHub transfer branch \`work/source-transfer-c26565e-20261103\` points to \`accb28e72c87c059e780efb8e6681886b33e9b4f\`. Its \`coordination/source-transfer/c26565e/README.txt\` advertises split-archive SHA256 \`4200e492828dbb857aaa737a7ce56d0aeda3c97c84f7743b1501ef2f229d3636\`, source revision \`c26565e58ab92dcbcda9663c4d231bdf4a9a7ee6\`, and tree \`2dbe253e97379532f6f4b52ef7edf26109a9266d\`. The integration commit \`d53ccd4135f28206d91d6804cf0626095565e6af\` includes \`coordination/source-transfer/c26565e/integrated-c265-to-e30.patch\` (blob \`79d40bf024a6553656b86fb1a29c1313dd458a0e\`, 1,269,917 bytes, 138 paths, none named RSI).

**Source identity limitation:** GitHub's textual connector could read this integration patch but could not materialize the three binary archive parts. GitHub returned 404 for independent Git objects \`c26565e58...\`, \`2dbe253...\`, and the requested target tree \`90fa5633d7926dd71a7303266073e0625325e740\`. Thus the archive SHA and target tree are **NOT VERIFIED**. This narrowly scoped code change is based on the published source tree \`06e9bc45dc3882e342a8e26394e0a2e30c537086\` of \`d53ccd...\`, **not** a claim to have applied or tested the unavailable reconstructed \`90fa...\` tree. Rebase/qualification against the reconstructed tree is required before integration.

## Actual producer / consumer join observed in this published source
1. \`rsi-bounded-revision-devos-bridge.mjs\`: \`createRsiBoundedRevisionArtifactReceipt\` verifies bounded bridge, build plan and materialization receipt; returns an artifact receipt with \`artifact_receipt_digest\`.
2. \`rsi-materialized-candidate-evaluation-handoff.mjs\`: \`verifyArtifact\` calls \`verifyRsiBoundedRevisionArtifactReceipt\`; \`createRsiMaterializedCandidateEvaluationHandoff\` produces an existing \`createRsiArtifactEvaluationRoutingRequest\`, bound to artifact digest, policy, generation and epoch. It does not run evaluation.
3. \`createRsiMaterializedCandidateExperimentIntent\` verifies a freshly selected budget plan and builds an existing \`createRsiCandidateExperimentIntent\`.
4. \`rsi-candidate-experiment-ledger.mjs\`: \`RsiCandidateExperimentLedger.add\` verifies an intent and external receipt before persisting materialized outcome and generation history; \`rsi-bounded-revision-proposal.mjs\` reads supported receipts for another bounded proposal. In this published tree, these source APIs are joined by regression tests. A production owner callback that atomically hands current handoff + exact artifact bytes to the experiment ledger was **not established** from this review.

## Reproducible ordering defect addressed
Before this patch, both ledgers checked for an already-known digest and returned \`IDEMPOTENT\` *before* enforcing current evaluator generation/epoch; an older exact handoff/receipt could be redelivered after a new generation was durably appended and still be labeled idempotent. The patch rejects these old duplicate deliveries before the idempotency fast-path while keeping current-epoch idempotence and append-only historical rows. It adds inert Node regression tests for post-rotation replay, post-restart replay and same-generation earlier-epoch replay.

## Explicitly unclosed boundaries
- No real candidate bytes were read. \`artifact_digest\` and the external attestor fields are claims in a structured receipt; this review cannot establish readback of current artifact bytes or candidate immutability.
- The experiment ledger's newest outcome is not a substitute for the handoff ledger's current generation: rotation without a new outcome can leave inter-ledger staleness undetected. Need an exact trusted readback/consumer join contract (not a new boolean field).
- No security audit of rejected unrelated subtasks; no rewrite of shared Main, installer, trust root, authority, or self-update.
- Build/qualification on reconstructed tree \`90fa...\`: NOT RUN. Actual Node tests against this published patch: NOT RUN in connector-only source workspace. Static, exact GitHub source and branch/PR metadata: PASS.

## Reviewer checklist
- Materialize the three GitHub archive parts in an isolated disposable environment, verify the advertised SHA256, reconstruct source tree, apply the integration patch, verify \`90fa5633...\`.
- Check cherry-pick overlap and exact function context; **do not** assume this draft PR's published-tree source is the reconstructed source.
- Run only the source-only test file \`apps/metaengine-browser/test/rsi-bounded-revision-devos-bridge.test.mjs\` (no candidate execution, installer, service or network listeners).
- Implement a separate guarded, exact artifact-byte readback + current handoff/experiment generation join before qualifying evaluation outcome acceptance.
