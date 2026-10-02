# METAENGINE Browser — SLSA Producer Event Identity Research

Date: 2026-10-03
Branch: `analysis/build-slsa-provenance-producer-v1`
Authority: research/evidence only
Promotion authority: false

## Question

Can the current pull-request Package Smoke simply add `actions/attest` with no predicate inputs and thereby produce the exact SLSA provenance already required by `metaengine.browser-fabric.release-authority-gate.v1`?

## Answer

No — not without changing the producer event identity.

The default GitHub SLSA predicate is derived from OIDC claims. For GitHub Actions provenance, `@actions/attest` builds:

- predicate type: `https://slsa.dev/provenance/v1`
- build type: `https://actions.github.io/buildtypes/workflow/v1`
- workflow ref/path/repository from OIDC;
- resolved source dependency digest from OIDC claim `sha`;
- builder id from `job_workflow_ref`;
- invocation id from workflow run id + attempt.

The exact source code in current `@actions/attest` lineage uses `claims.sha` for:

`buildDefinition.resolvedDependencies[0].digest.gitCommit`.

For a GitHub Actions `pull_request` event, GitHub documents:

- `GITHUB_REF=refs/pull/<PR>/merge`;
- `GITHUB_SHA` is the synthetic merge-branch merge commit;
- testing the actual PR head requires explicit checkout of `github.event.pull_request.head.sha`.

The current METAENGINE Package Smoke intentionally does exactly that explicit head checkout and uses the PR head SHA as the physical Browser source identity.

Therefore a default SLSA provenance attestation generated inside that pull-request run would describe the synthetic merge commit in its source dependency, while the installer/build identity/package reservation describe the PR head SHA.

That is an identity split and must fail closed.

## Fresh upstream evidence

### actions/attest v4.2.2

Current immutable release:
`actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6`

GitHub marks the release commit verified.

The action supports three modes:

- provenance: no SBOM/predicate inputs;
- SBOM: `sbom-path`;
- custom: explicit predicate type + predicate.

For provenance mode, supplying only `subject-path` auto-generates SLSA build provenance.

Outputs include:

- `attestation-id`
- `attestation-url`
- `bundle-path`

The bundle is a JSON Sigstore bundle suitable for portable verification.

### Exact dependency implementation

At the pinned action commit, `package.json` depends on:

`@actions/attest ^3.2.0`.

Current toolkit provenance implementation generates:

`https://slsa.dev/provenance/v1`

with GitHub workflow build type:

`https://actions.github.io/buildtypes/workflow/v1`.

Its source dependency is:

`git+<github-server>/<repository>@<claims.ref>`

with digest:

`gitCommit: claims.sha`.

Its builder id is derived from:

`claims.job_workflow_ref`.

Its invocation id is:

`<repo>/actions/runs/<run_id>/attempts/<run_attempt>`.

## METAENGINE consequence

The current Package Smoke cannot honestly add default provenance while remaining a `pull_request` provenance producer.

The build step can still check out the head SHA, but auto-provenance cannot be told that this manually checked-out commit replaces the OIDC `sha` claim.

Do not solve this by fabricating a custom SLSA predicate. That would replace GitHub's OIDC-derived build statement with caller-supplied data and weaken the intended trust boundary.

## P0 producer event decision

The next physical SLSA candidate should use an exact-source event where GitHub's own OIDC `sha` equals the physical source SHA.

Preferred P0 event:

`push` to one dedicated provenance-candidate branch.

Requirements:

1. `GITHUB_SHA` must equal `git rev-parse HEAD`;
2. physical source identity must equal that same SHA;
3. provenance must be generated after the installer exists in the same producer job;
4. provenance subject must be that exact installer;
5. no custom provenance predicate;
6. producer must run on GitHub-hosted runner;
7. package identity must be fresh and unused;
8. one-attempt package reservation remains before physical build;
9. pull-request duplicate Package Smoke for the same candidate must be structurally suppressed;
10. all downstream physical consumers may still operate from the exact immutable push-produced candidate artifact and must remain fenced on terminal producer success.

A carefully constrained `workflow_dispatch` on an exact branch ref could also align `GITHUB_SHA`, but it adds an operator-dispatch input surface. P0 should prefer deterministic push identity unless a later design proves dispatch materially safer.

## P0 verifier contract

Before changing Package Smoke, implement and source-qualify a zero-authority verifier for the exact GitHub SLSA predicate.

It should accept only a cryptographically verified `gh attestation verify --format json` statement and require:

- predicate type `https://slsa.dev/provenance/v1`;
- build type `https://actions.github.io/buildtypes/workflow/v1`;
- exact installer name + SHA-256;
- exact repository URL;
- exact Package Smoke workflow path;
- exact source ref;
- event `push`;
- runner environment `github-hosted`;
- exactly one resolved Git dependency;
- exact `gitCommit = physical source SHA`;
- exact builder id;
- exact run id + run attempt in invocation id.

Output must be exactly the already-existing release-gate schema:

`metaengine.browser-fabric.provenance-evidence.v1`

with no extra keys, because the release authority gate uses an exact-key contract.

The output remains:

- `verified=true`
- `builder_trusted=true`
- `authority_effect=false`

and is evidence only.

## Why implement verifier before producer

This gives us an executable target contract without consuming a new package identity.

A future Package Smoke change can then be accepted only if the actual GitHub-generated predicate passes the already-proven verifier.

It also avoids discovering provenance-shape mismatches only after an expensive one-shot physical build.

## P1 horizon

GitHub documents reusable build workflows + artifact attestations as a path toward SLSA Build Level 3.

That is a stronger later architecture because `job_workflow_ref` can identify a vetted reusable builder workflow.

Do not mix that refactor into P0. First prove exact-source P0 provenance with the current producer topology; then evaluate reusable builder isolation as a separate convergence slice.

## References

GitHub artifact attestations:
https://docs.github.com/en/actions/concepts/security/artifact-attestations

GitHub artifact attestation usage:
https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations

GitHub pull-request merge branch semantics:
https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows

GitHub OIDC claims:
https://docs.github.com/en/actions/reference/security/oidc

GitHub CLI attestation verification:
https://cli.github.com/manual/gh_attestation_verify

actions/attest:
https://github.com/actions/attest

SLSA provenance:
https://slsa.dev/spec/v1.2/provenance


## Downstream consumer compatibility research

Fresh readback of the current immutable-installer consumer found a second event-identity issue that must be fixed in the physical rollout.

`apps/metaengine-browser/scripts/installer-provenance.mjs` resolves Package Smoke with:

`/actions/workflows/<workflow>/runs?head_sha=<head>&per_page=30`

and `pickNewestRun()` selects the highest `run_number` for that head SHA.

It does **not** filter by event.

This matters because the intended P0 SLSA producer is a `push` run. If a PR for the same source SHA later creates a newer Package Smoke workflow run, even a deliberately skipped/fail-closed PR producer can eclipse the valid push producer simply because its run number is newer.

Current `qualified-installer-consumer.ps1` carries exact run id/number/attempt once resolved, so the ambiguity exists only at initial producer discovery.

### Required P0 repair

Do not rely on "newest run for SHA" for a dual-event workflow.

The physical SLSA slice should extend producer resolution with an **optional exact producer-event fence**:

- add `--event <push|pull_request|workflow_dispatch>` to `installer-provenance.mjs resolve/acquire`;
- filter workflow runs by exact event before selecting the newest run;
- persist `producer_event` in `resolved.json` and the consumer binding;
- make `wait` re-check the exact run event as well as SHA/workflow/run number/attempt;
- expose an optional `ExpectedProducerEvent` through `qualified-installer-consumer.ps1`;
- retain backward compatibility when the option is omitted so the already-qualified PR-produced `694b106...` installer remains consumable by current release-attestation evidence workflows;
- require `ExpectedProducerEvent=push` for the new SLSA physical line.

This is preferable to creating a second Package Smoke workflow or proxy artifact because it preserves one producer workflow and one candidate artifact naming contract.

### PR workflow implication

A newer pull-request Package Smoke run for the same SHA must not be allowed to hijack consumers of the push producer.

The event fence makes that structurally impossible even if GitHub creates another workflow run for the same head SHA.

A separate optimization may later skip unnecessary duplicate PR producer work, but correctness must come from exact run-event binding, not from assuming the duplicate run never exists.

## Source-only verifier result

The new verifier branch is now source-qualified:

- branch `work/build-slsa-provenance-verifier-v1`
- exact head `db73c387130d80755271ed8492e5183c68fabe63`
- push Source Qualification run `37070014769`: SUCCESS
- PR #1099 Source Qualification run `37070117772`: SUCCESS
- 10 adversarial semantic tests: PASS
- no Browser product subtree change
- no physical workflow fan-out

This establishes the expected SLSA statement contract before consuming a fresh package identity.


## Producer-event fence implementation result

The event ambiguity is now closed in a source-qualified successor without starting a physical package build.

Implementation branch:

`work/build-package-producer-event-fence-v1 @ ebc8db27304b06e8e08163b04498726d9201785d`

Changes relative to the SLSA verifier base are limited to:

- `apps/metaengine-browser/scripts/installer-provenance.mjs`
- `apps/metaengine-browser/scripts/qualified-installer-consumer.ps1`
- `apps/metaengine-browser/test/installer-provenance.test.mjs`
- `apps/metaengine-browser/test/qualified-installer-consumer-contract.test.mjs`
- source-only qualification workflow.

No package version or Package Smoke workflow changed.

### Resolver semantics

`installer-provenance.mjs` now accepts an optional exact producer event:

`--event push|pull_request|workflow_dispatch`

When present it:

1. sends both `head_sha` and `event` to GitHub's list-workflow-runs endpoint;
2. independently filters returned rows by both exact head SHA and exact event before newest-run selection;
3. persists the observed `producer_event` in resolved evidence;
4. makes `wait` re-read the exact run and reject event drift with `producer_event_mismatch`.

The GitHub REST documentation explicitly supports both `event` and `head_sha` as narrowing parameters for "List workflow runs for a workflow". Local filtering remains in place as defense in depth rather than trusting query filtering alone.

### Shared consumer semantics

`qualified-installer-consumer.ps1` now exposes optional:

`-ExpectedProducerEvent push|pull_request|workflow_dispatch`

If supplied, both Acquire and Wait carry the exact event fence and the consumer binding persists `producer_event`.

If omitted, existing consumers retain their previous behavior. This preserves compatibility with the already-qualified PR-produced `694b106...` installer while allowing the future SLSA line to require `push`.

### Tests

The hermetic installer-provenance suite now proves:

- a newer same-SHA pull-request run cannot eclipse an older valid push producer when `event=push`;
- no fallback to a different event occurs when the requested event is absent;
- unsupported producer events fail before network access;
- Wait rejects an exact run whose event drifts;
- existing resolver/download/wait/provenance tests remain green.

The shared consumer contract also proves event fencing is optional by default but exact when requested.

Source Qualification:

- first run `37070756887`: implementation tests PASS; static contract failed on an incorrect checker literal only;
- checker source corrected without rerunning the failed attempt;
- exact-head run `37070823699`: SUCCESS.

This closes the producer-discovery race before any fresh package identity is consumed.


## Live GitHub attestation runtime proof

The source-only design has now been exercised against the real GitHub attestation service without consuming a Browser package identity.

Probe branch:

`work/build-slsa-attest-runtime-probe-v1`

### Ubuntu proof

Run:
`37074394998` — SUCCESS

Exact source:
`7b615bb63915bed3ee0ce60e3505fb5b01e04c88`

A deterministic non-release text subject was attested with the immutable action pin:

`actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6`

The workflow then verified the portable bundle with `gh attestation verify` and passed the project's exact semantic verifier.

Observed attestation:
`52309047`

Observed subject SHA-256:
`c76902f1f228d50f3805fd3212a13f3c98ca882c25df849eba96b1fa2c6742be`

The resulting evidence was exactly:

`metaengine.browser-fabric.provenance-evidence.v1`

with `verified=true`, `builder_trusted=true`, and `authority_effect=false`.

### Windows producer proof

The same path was then exercised on `windows-2025`.

Run:
`37074940435` — SUCCESS

Exact source:
`ebf7affadd85832cf295283b844a14624b241b9c`

Both Ubuntu and Windows jobs were terminal SUCCESS in the same workflow run.

Windows attestation:
`52309904`

Windows subject:
`metaengine-slsa-runtime-probe-windows.txt`

Windows subject SHA-256:
`420dbcb36613459b379fb498c765fabe106de26c573c10a3e66fd19942e627c0`

Windows evidence artifact:
- artifact id `11256585039`
- digest `sha256:50a24a828de4011610b0a3c2b4a7500de030d69aca244c351c36cd3c4b38836d`
- not expired at observation

The runner exposed GitHub CLI `2.101.0`.

The Windows logs confirmed:
- Public Good Sigstore certificate signing;
- upload to the Rekor transparency log;
- repository attestation publication;
- local bundle verification;
- exact source SHA verification;
- exact signer workflow verification;
- self-hosted runner denial;
- semantic mapping into the existing Browser Fabric provenance evidence schema.

This removes the remaining uncertainty that the chosen `actions/attest` + portable bundle + `gh attestation verify` sequence behaves differently on the actual Windows build runner.

## One physical installer producer convergence

A fresh physical-workflow audit found that Shell-First Dirty Profile was still invoking its own `electron-builder` NSIS build.

That violated the one-producer / one-built-bytes invariant even though the main installed-chat, final-runtime, soak and self-update consumers had already converged on `qualified-installer-consumer.ps1`.

The duplicate producer was removed on:

`work/build-one-producer-dirty-profile-v1 @ 8a03e0f8f2e70dcf6d3870ef050ceed49aaccf8b`

Dirty Profile now:
- acquires the exact Package Smoke candidate;
- carries exact producer run id/number/attempt;
- binds `producer_event`;
- runs its physical dirty-profile test on those bytes;
- waits for the exact Package Smoke producer to reach terminal success;
- performs no independent NSIS build.

Package Smoke trigger closure now includes the Dirty Profile workflow.

Source qualification:
`37074686671` — SUCCESS

No physical Browser package was built by this source-only branch.

## Physical SLSA source preparation

The next source-only preparation line is:

`work/build-slsa-physical-prep-v1 @ d45b0f0b8d40320f4b0c3ad5646541ecccf73d46`

The Browser package version remains unchanged:

`0.7.0-dev.37006000001.1`

The preparation adds the dedicated future physical branch:

`physical/build-slsa-provenance-v1`

to the complete ten-workflow physical matrix.

Package Smoke now has the source contract for:
- exact push-only SLSA creation;
- job-local `id-token: write` + `attestations: write`;
- immutable `actions/attest` pin;
- one exact installer subject;
- portable Sigstore bundle retained with the immutable candidate artifact;
- zero-authority package SLSA receipt;
- independent post-producer `gh attestation verify`;
- exact signer workflow, source SHA and source ref enforcement;
- `--deny-self-hosted-runners`;
- semantic projection into `metaengine.browser-fabric.provenance-evidence.v1`.

Shared physical consumers automatically set their Package Smoke producer event fence to `push` only when running on the dedicated physical branch. Legacy PR-produced evidence remains backward compatible elsewhere.

Source qualification:

`37075932409` — SUCCESS

It proved:
- YAML syntax for all modified workflow files;
- Node and PowerShell parser validity;
- SLSA semantic verifier tests;
- producer-event resolver tests;
- qualified installer consumer tests;
- complete ten-workflow physical topology;
- one Package Smoke NSIS build invocation;
- unchanged current package identity;
- zero-authority/source-only preparation boundary.

### Defect caught during preparation

An attempted exact-subject refactor accidentally expanded JavaScript replacement-string `$'` semantics while programmatically editing the YAML, duplicating workflow content and making Package Smoke invalid.

GitHub surfaced the corrupted revisions as zero-job failed workflow runs:
- `37075682592`
- `37075850189`
- `37075896292`

No Package Smoke job started and no package identity was reserved or built in those runs.

The workflow was reconstructed from the last known-good source and the edit was reapplied with function-based replacement semantics.

Final source:
`d45b0f0b8d40320f4b0c3ad5646541ecccf73d46`

The final source qualification is green and there is exactly one `slsa-provenance-verify` job and exactly one SLSA attestation step.

## Upstream SLSA horizon

Fresh GitHub guidance still places ordinary artifact attestations at SLSA Build Level 2.

GitHub documents a reusable workflow containing both build and attestation generation as a route toward SLSA Build Level 3 because the reusable builder can be isolated from the caller.

That remains P1 rather than P0.

P0 should first finish one exact-source physical candidate using the already-qualified single producer topology.

After that proof, move Package Smoke's build+attest core into a separately vetted reusable builder workflow and tighten verification from same-repository workflow identity to the reusable builder identity.

This ordering avoids mixing a build-system refactor with the first physical SLSA evidence transition.
