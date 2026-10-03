# METAENGINE Browser Checkpoint — Release Attestation SLSA Binding Qualified

Date: 2026-10-03
Authority: evidence only
Promotion authority: false
Release publication authority: false

## Physical source of truth

Exact physically qualified candidate:
- source: `a68774eb6ad5a0fe8014501163b0c67f608bed09`
- package: `0.7.0-dev.37086632570.1`
- Package Smoke producer: run `37087347663` / #3157 / attempt 1
- installer: `METAENGINE-Browser-Test-Setup-0.7.0-dev.37086632570.1-x64.exe`
- installer SHA-256: `937936bc51d431540762d170b7cc970fdfe1575b9879b885efdc22089e3f2455`
- 10/10 physical workflow families terminal SUCCESS.

Producer SLSA evidence:
- predicate: `https://slsa.dev/provenance/v1`
- builder: `https://github.com/PatrickFrome/Compute/.github/workflows/browser-windows-package-smoke.yml@refs/heads/physical/build-slsa-provenance-v1`
- producer verification artifact id: `11261401099`
- producer verification artifact digest: `sha256:6614a8fa2ccd358bbe1d423845912578d6a194c997eeb736a6222fd610d20331`
- producer verification material SHA-256: `001eec5c0c7309bb2f1785f974e60fc068377d570168c5295840608bbac97a97`
- producer provenance evidence SHA-256: `60ba1405451fc1dc13e870143775ed827ca82e6f41bb5aa4b8b90c4bd8023218`.

## Release-attestation SLSA binding implementation

Branch:
`work/build-release-attestation-slsa-binding-v1`

Exact qualified head:
`96c6688db0b1538dd8bf2258665a0df0f325f402`

The existing release-attestation chain was hardened without creating a second release manifest.

Implemented:
- release qualification predicate binds the exact Package Smoke SLSA builder, physical source SHA, installer subject digest, producer run/attempt, immutable SLSA evidence artifact id/digest, provenance-evidence SHA and producer-verification-material SHA;
- semantic verifier fails closed on builder, source dependency, invocation, workflow/ref, certificate, subject or material drift;
- independent release verifier reconstructs the exact producer Sigstore bundle from immutable producer verification material and runs `gh attestation verify` with exact repository, SLSA predicate, signer workflow, signer/source digest, physical source ref, GitHub OIDC issuer and self-hosted-runner denial;
- copied producer evidence is independently hashed and bound before use;
- signer/verifier permission split remains intact;
- all resulting proof surfaces retain `promotion_authorized=false`, `release_published=false`, `authority_effect=false`.

## Final source qualification

Workflow:
`Browser Release Attestation SLSA Binding Source Qualification`

Run:
`37097449367` / #10 / attempt 1

Exact head:
`96c6688db0b1538dd8bf2258665a0df0f325f402`

Result:
SUCCESS on Linux and Windows.

The qualifier covers:
- JavaScript parse;
- release attestation semantic tests;
- signer/verifier permission separation;
- exact SLSA verifier constraints;
- read-only admission workflow contract;
- zero release/promotion authority;
- exact checkout unchanged.

## Read-only SLSA admission qualification

Workflow:
`Browser Release Attestation SLSA Admission Qualification`

Final run:
`37097449504` / #3 / attempt 1

Exact source:
`96c6688db0b1538dd8bf2258665a0df0f325f402`

Result:
SUCCESS.

The workflow:
- reacquired the exact one-built physical installer;
- reverified its local provenance and terminal Package Smoke producer;
- downloaded immutable SLSA artifact `11261401099` from exact producer run;
- checked artifact identity/digest and exact material hashes;
- reconstructed the exact producer Sigstore bundle;
- cryptographically reverified that bundle against the exact installer;
- semantically rebound the verified statement to physical source/run/attempt/builder;
- used only `actions: read` and `contents: read`;
- performed no signing or release effect.

Admission artifact:
- id: `11265150089`
- name: `metaengine-browser-release-slsa-admission-a68774eb6ad5a0fe8014501163b0c67f608bed09`
- digest: `sha256:681ae7a9839126f2feb3bd3332d5fa57ff9664936d19e9bc2de69b3cf3b51d2e`.

Admission proof:
- schema: `metaengine.browser.release-attestation-slsa-admission.v1`
- SLSA statement SHA-256: `f74d397ca029419005c99fe55332975c1d936f8d2a2e90f0ecf1bd3356c2a4f6`
- `cryptographic_verification=true`
- `semantic_binding_verified=true`
- `builder_trusted=true`
- `independent_verifier_no_signing_authority=true`
- `promotion_authorized=false`
- `release_published=false`
- `authority_effect=false`.

## Superseded source-only failures

Admission #1 failed before cryptographic verification because a PowerShell interpolation expression produced an incorrect expected verifier id.

Admission #2 successfully completed cryptographic and semantic verification, then a self-referential static zero-authority check falsely matched its own forbidden-token literals.

Both were corrected by new source commits. Neither run performed signing, release publication, promotion, physical packaging, user-machine installation or production authority changes. They are retained as audit history and MUST NOT be rerun.

## Next safe frontier

The release boundary is now source-qualified and read-only-admission-qualified against the exact physical SLSA producer evidence.

A manual `METAENGINE Browser Release Attestation V1` workflow dispatch has NOT been performed. Therefore no release-qualification/SBOM attestation generated by that workflow is claimed on this line.

Any later signing invocation must use the exact physically qualified tuple:
- source `a68774eb6ad5a0fe8014501163b0c67f608bed09`
- package `0.7.0-dev.37086632570.1`
- producer run `37087347663`

and must remain separate from release publication/promotion.
