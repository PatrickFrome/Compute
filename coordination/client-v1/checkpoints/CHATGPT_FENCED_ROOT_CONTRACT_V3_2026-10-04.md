# ChatGPT fenced installer V3: Root Transport contract correction

Status: **RUNTIME SOURCE QUALIFIED / NEW PHYSICAL MATRIX PENDING / LIVE NOT QUALIFIED**.

Candidate `0634bed33afa150f2f8f29af123b292ce2c63cde` cannot be promoted or presented as qualified. Its Root Transport workflow [37204978351](https://github.com/PatrickFrome/Compute/actions/runs/37204978351), job `111444169815`, passed all 25 behavioral tests but failed the inline static fence with `enter_lane_submit_contract_missing`. That fence still asserted the retired GLM single-phase Enter path. The failure is retained as evidence, not bypassed.

Package version `0.7.0-dev.37220000001.1` has been consumed by sole producer [37204978252](https://github.com/PatrickFrome/Compute/actions/runs/37204978252). Its reservation artifact is `11304666555`, 861 bytes, archive digest `sha256:83a4607a5926df592a6c5f8fc86226cd7aa94a744bf17c0f059db5d689c12bdb`. Do not rerun that producer, rebuild the version or relabel its output.

The replacement `tests/browser-root-transport-static-fence.mjs` retains scheduler/eval, preconversation, unverified dispatch and canonical upgrade fences, then verifies the new contract: both task-cycle entry paths use the shared fenced helper; type never submits; a fresh capture must prove exact tab, target, conversation, draft length and digest; exactly one semantic Send is selected; active Enter/single-phase lanes are absent; legacy GLM is read-only. The Root Transport workflow watches the helper/core/readiness and the new fence. Linux/Windows source qualification also runs this static contract so it cannot escape the source gate again.

Local verification after the workflow change: new static contract PASS; all six Root Transport behavioral suites 25/25 PASS, zero failures/skips; both modified YAML files parse; source-only authority guard PASS. Runtime files are unchanged from `59f24cf78faf6fe38fa2b9b2d00b68c9149ce445`, whose Linux/Windows source qualification [37204436247](https://github.com/PatrickFrome/Compute/actions/runs/37204436247) is terminal SUCCESS. The full local Browser proof remains 4087/4087 PASS, SHA-256 `71a7f7d17a71f22d80458fba7ae2d51afe01ce74a8d9cb2c14c09981109013f8`.

Fresh version **0.7.0-dev.37230000001.1** was checked through the public GitHub artifact API: HTTP 200, zero existing artifacts named `metaengine-browser-package-version-0.7.0-dev.37230000001.1`. Workflow correction, package version, both lockfile version fields and the first convergence reservation are committed atomically. The physical producer must repeat the real reservation gate. PR #1104 remains draft and every physical consumer must bind the same exact head, version and installer digest.

No cloud deployment, Supabase mutation, release publication, merge or installation was performed. The inspected installed copy still reports `0.7.0-dev.37153249506.1`; Supabase catalog readback remains permission denied. Live connection, authenticated ChatGPT tabs, four independent roles and one useful-work cycle still need fresh proof after installation.

Next: rerun complete exact-head source and physical matrix once; download immutable candidate and evidence; verify archive and EXE digests and source/version/producer bindings; deliver the installer; then read back the updated live client before fleet effects.
