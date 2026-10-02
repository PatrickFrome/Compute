# METAENGINE Browser — Release Attestation Verification Research

Date: 2026-10-03
Branch: `analysis/build-release-attestation-verification-v1`
Implementation base: `c95606cb09e81f509b4ee371fcd4cedca84a0bc8`
Physically-qualified Browser source: `694b106925cb7a1ce9b4d7918962821b152c0583`
Package: `0.7.0-dev.37006000001.1`
Package Smoke producer: run `37006158040`, run number `3149`, attempt `1`

## Question

What is the smallest next supply-chain step after release-boundary attestation generation that materially increases assurance without creating a second release authority, rebuilding the Browser, or changing the physically-qualified subject?

## Current local evidence

PR #1097 already has two terminal-green non-promotion checks on exact head
`c95606cb09e81f509b4ee371fcd4cedca84a0bc8`:

- Browser Release Attestation Source Qualification — run `37062226517`
- Browser Release Attestation Admission Qualification — run `37062226651`

The admission proof re-read the existing one-built Package Smoke artifact and bound:

- installer SHA-256 `631dc5751e9ea731d3575a3263b0d54ce264564a060133002d9f38130d7ebc14`
- installer bytes `156364533`
- Build Identity V3 SHA-256 `c06711d023ffb4fd3c35d827fdd9d3ca4b44f869d659e524fffb7f901c330201`
- dependency resolution SHA-256 `9c50170ae3c01773d0ae9c9d434aafe9fdc8c12b75ad68c008da7bff9fe66cdd`
- package-lock SHA-256 `696aa182389d7cf02bef8b2dcb313ff0813465708fcc9878bfbf92cc8776ded0`
- composed SBOM raw SHA-256 `09d456784fa9a469b13d6081041f423f756f4cdfc0a74c7019472000095ac663`
- composed semantic inventory SHA-256 `8173986ff547f418c5c1ee6d572bbb5732450f80380f329d5c43fd87097c93df`
- ten required physical workflows terminal `SUCCESS`
- `attestation_created=false`
- `promotion_authorized=false`
- `authority_effect=false`

The attestation producer uses `actions/attest` pinned to exact upstream commit
`1e69f48acb82d1966a394da916b4c1698aa569d6` (v4.2.2).

## External research

### 1. Generation without verification is not a security boundary

GitHub explicitly states that artifact attestations only provide security value when consumers verify them. Attestations link a subject to source/build identity; they are not themselves a claim that the artifact is safe.

Reference:
https://docs.github.com/en/actions/concepts/security/artifact-attestations

Implication for METAENGINE:
the current producer is necessary but incomplete. The next step should be a consumer/verifier on the exact generated bundles before any later release-authority gate is allowed to consume them.

### 2. GitHub CLI can enforce actor identity, not only subject digest

Current `gh attestation verify` supports enforcement of:

- repository or owner identity;
- exact predicate type;
- signer workflow;
- signer repository;
- source repository digest;
- source repository ref;
- OIDC issuer;
- denial of self-hosted runners;
- local Sigstore bundle input;
- custom trusted-root input.

Reference:
https://cli.github.com/manual/gh_attestation_verify

Implication:
METAENGINE should not stop at "signature valid". Verification should fail closed unless the bundle is bound to the expected repository, exact signer workflow, exact workflow source digest/ref, expected predicate type, and expected installer digest.

### 3. Offline verification is a supported first-class path

GitHub documents a durable offline path:

1. retain/download the attestation bundle;
2. acquire a current trusted-root snapshot;
3. verify the artifact with the local bundle plus `--custom-trusted-root`.

Reference:
https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/verify-attestations-offline

Implication:
the attestation run should retain both the Sigstore bundles and a hash-bound trusted-root snapshot. This prevents future verification from depending solely on GitHub API availability and makes the release evidence portable.

The trusted-root snapshot is evidence material, not permanent trust authority. GitHub notes that root material can rotate/revoke, so the captured root must be treated as a dated verification input, not as an eternal root of trust.

### 4. SLSA verification requires expectations

SLSA 1.2 verification guidance says verification should include:

- trusted builder identity;
- signature verification;
- expected build type;
- expected external parameters.

References:
https://slsa.dev/spec/v1.2/verifying-artifacts
https://slsa.dev/spec/v1.2/build-provenance

Implication:
METAENGINE's custom release-qualification predicate is useful only if the verifier enforces its expected fields. The verifier should independently re-check source SHA, package version, installer digest, Package Smoke run identity, qualification matrix, and zero-authority flags.

### 5. CycloneDX has a canonical predicate URI

CycloneDX recognizes `https://cyclonedx.org/bom` as the official in-toto predicate type for CycloneDX BOM variants.

Reference:
https://cyclonedx.org/specification/overview/

Implication:
the verifier should explicitly require that predicate URI for the SBOM attestation rather than accepting an arbitrary non-default predicate.

### 6. `composition.aggregate=incomplete` must remain honest

CycloneDX defines `incomplete` as an explicit statement that the inventory is not complete.

Reference:
https://cyclonedx.org/guides/sbom/lifecycle_phases/

Implication:
verification must require the exact aggregate currently emitted by the composed-BOM producer. It must not silently upgrade `incomplete` to `complete` merely because signing succeeded.

## Decision

Implement **post-generation self-verification** inside the release-attestation workflow.

The attestation workflow should:

1. create the custom release-qualification attestation;
2. create the CycloneDX SBOM attestation;
3. export a fresh GitHub/Sigstore trusted-root snapshot;
4. verify each local bundle with `gh attestation verify`;
5. enforce:
   - `PatrickFrome/Compute` repository identity;
   - exact signer workflow `.github/workflows/browser-release-attestation-v1.yml`;
   - exact signer/source commit `GITHUB_SHA`;
   - exact `GITHUB_REF`;
   - `--deny-self-hosted-runners`;
   - exact custom predicate URI for qualification;
   - exact `https://cyclonedx.org/bom` for SBOM;
6. semantically re-check the verified statements with a repository-owned Node verifier;
7. emit a compact verification proof with only evidence fields and:
   - `cryptographic_verification=true`
   - `semantic_binding_verified=true`
   - `promotion_authorized=false`
   - `release_published=false`
   - `authority_effect=false`.

## Non-goals

This slice must not:

- rebuild the installer;
- create a second package producer;
- alter the physically-qualified source;
- publish a GitHub Release or tag;
- merge PRs;
- update production Edge/DB;
- install anything on the user's machine;
- authorize fleet/task/Supervisor/Guardian effects;
- convert attestation evidence into automatic release authority.

## Expected value

This closes the largest evidence gap in PR #1097: the system will no longer merely generate attestations; it will prove that the exact generated bundles are independently consumable under the exact identity policy METAENGINE expects.

It also creates a clean foundation for a later canonical release-evidence manifest without introducing a competing release contract now.
