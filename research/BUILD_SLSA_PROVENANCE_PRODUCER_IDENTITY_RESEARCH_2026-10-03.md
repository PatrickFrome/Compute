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
