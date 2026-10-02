# METAENGINE Browser Build/Release Checkpoint — Attestation Verification V1

Date: 2026-10-03
Authority: evidence only
Promotion authority: false
Automatic retry allowed: false

## Fresh anchors

- repository: `PatrickFrome/Compute`
- physically-qualified source: `694b106925cb7a1ce9b4d7918962821b152c0583`
- package: `0.7.0-dev.37006000001.1`
- installer SHA-256: `631dc5751e9ea731d3575a3263b0d54ce264564a060133002d9f38130d7ebc14`
- Build Identity V3: `c06711d023ffb4fd3c35d827fdd9d3ca4b44f869d659e524fffb7f901c330201`
- composed SBOM raw SHA-256: `09d456784fa9a469b13d6081041f423f756f4cdfc0a74c7019472000095ac663`
- composed semantic inventory SHA-256: `8173986ff547f418c5c1ee6d572bbb5732450f80380f329d5c43fd87097c93df`
- Package Smoke producer: run `37006158040`, run number `3149`, attempt `1`
- physical matrix: `10/10 SUCCESS`

## Release-attestation source line

- PR #1097
- source branch: `work/build-release-attestation-v1`
- exact head: `c95606cb09e81f509b4ee371fcd4cedca84a0bc8`
- source qualification run `37062226517`: SUCCESS
- read-only admission qualification run `37062226651`: SUCCESS
- admission evidence artifact `11251116782`
- admission artifact digest `sha256:47f0733350c223e77728a2874cfd901114ad4dc62ca5380df1e13014b7572b05`

No signed release attestation has been created yet.

## Research decision

The next implementation slice is post-generation cryptographic and semantic verification of the exact local Sigstore bundles using explicit repository/signer/source/predicate expectations, plus a dated trusted-root snapshot.

Research file:
`research/BUILD_RELEASE_ATTESTATION_VERIFICATION_RESEARCH_2026-10-03.md`

## Branches opened

- analysis: `analysis/build-release-attestation-verification-v1`
- implementation: `work/build-release-attestation-verification-v1`

Both started from:
`c95606cb09e81f509b4ee371fcd4cedca84a0bc8`

## Required invariants

- one physical package producer only;
- no rebuild in attestation/verification workflows;
- exact installer SHA is immutable;
- exact Package Smoke run identity is immutable;
- Build Identity V3 and composed SBOM stay bound;
- CycloneDX aggregate remains `incomplete`;
- verification must enforce signer workflow identity and source identity;
- attestation success does not imply promotion;
- `promotion_authorized=false`;
- `release_published=false`;
- `authority_effect=false`;
- no blind retry.

## Next implementation

Add a repository-owned semantic verifier for `gh attestation verify --format json`, unit tests, and self-verification steps to the manual release-attestation workflow. Keep PR #1097 untouched as the proven predecessor; stack a new draft PR on top of it.
