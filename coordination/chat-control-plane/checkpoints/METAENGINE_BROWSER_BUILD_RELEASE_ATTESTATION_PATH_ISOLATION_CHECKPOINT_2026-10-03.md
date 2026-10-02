# METAENGINE Browser Build/Release Checkpoint — Verification Path Isolation V2

Date: 2026-10-03
Authority: evidence only
Promotion authority: false
Automatic retry allowed: false

## Triggered regression discovered

The first implementation layout placed the release-attestation verifier under:

- `apps/metaengine-browser/scripts/release-attestation-verification.mjs`
- `apps/metaengine-browser/test/release-attestation-verification.test.mjs`

That was semantically wrong even though the verifier itself is zero-authority.

Why: multiple physical Browser workflows intentionally use broad pull-request path filters such as `apps/metaengine-browser/**`. Opening PR #1098 therefore triggered physical exact-head workflows for a **source-only attestation successor**.

Observed exact head:
`dab7cb29b103f579db16f37f858f55cc7b817cfe`

Observed runs included:

- Package Smoke `37064866854`
- Installed Chat `37064866834`
- Self Update `37064866891`
- Autonomous Soak `37064866860`
- Critical Audit `37064866823`
- Shell `37064866818`
- Release Attestation Source Qualification `37064866843`
- Release Attestation Admission Qualification `37064866923`

## Safety result

The package-identity fence worked exactly as designed.

Package Smoke failed before dependency installation or any physical build:

- error: `PACKAGE_IDENTITY_VERSION_ALREADY_RESERVED`
- requested package: `0.7.0-dev.37006000001.1`
- source-only successor: `dab7cb29...`
- prior reserved producer run: `37006158040`
- prior physical source: `694b106925...`

Every actual build/install step after the reservation gate was skipped.

Installed Chat also failed at exact-head installer acquisition rather than inventing a new installer.

Admission Qualification was correctly skipped on the stacked PR after its new base guard.

This is a useful proof that the one-built package identity invariant remains fail-closed, but the fan-out itself is unnecessary CI cost/noise and should not recur.

## Research finding

GitHub evaluates `pull_request.paths` against the PR's three-dot changed-file diff. Therefore a zero-authority verifier placed beneath a product subtree such as `apps/metaengine-browser/**` legitimately activates every workflow whose filter treats that subtree as a physical Browser change.

The correct boundary is structural, not another runtime boolean:
release-evidence tooling that must not cause Browser physical qualification should live outside Browser product paths.

## Repair

PR #1098 was temporarily closed before file movement so cleanup commits could not repeatedly create pull-request physical runs.

The verifier was moved to:

- `scripts/release-attestation-verification.mjs`
- `tests/release-attestation-verification.test.mjs`

The release-attestation source qualification was updated to watch those exact root paths.

The manual attestation workflow now invokes the isolated root verifier.

The verification policy was also strengthened with:

- `--signer-digest $GITHUB_SHA`
- explicit `--cert-oidc-issuer https://token.actions.githubusercontent.com`

in addition to the existing exact signer workflow, source digest/ref, repository, predicate, trusted-root, and no-self-hosted constraints.

## Current implementation head after isolation

`2a423b549168efe54ece5d688ba2ed9a2d11514f`

Important: PR #1098 remains temporarily closed while the final source-only diff is validated. It is intended to be reopened after confirming the net diff no longer contains `apps/metaengine-browser/**` verifier/test files.

## Invariants retained

- physically-qualified Browser source remains `694b106925cb7a1ce9b4d7918962821b152c0583`
- physical package remains `0.7.0-dev.37006000001.1`
- no new installer was built
- no replacement Package Smoke producer exists
- no manual attestation was invoked
- no GitHub Release/tag/promotion occurred
- no production Edge/DB write occurred
- no user-machine install/update occurred
- `promotion_authorized=false`
- `release_published=false`
- `authority_effect=false`
