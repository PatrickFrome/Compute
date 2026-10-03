# METAENGINE Browser Checkpoint — SLSA Physical 10/10 Qualified Candidate

Date: 2026-10-03
Authority: evidence only
Promotion authority: false
Automatic physical retry allowed: false

## Exact candidate

Physical branch:
`physical/build-slsa-provenance-v1`

Exact source:
`a68774eb6ad5a0fe8014501163b0c67f608bed09`

Package:
`0.7.0-dev.37086632570.1`

Source qualification:
- Browser SLSA Physical Fix V3 Source Qualification run `37087134491` / #4 / attempt 1 — SUCCESS on Linux and Windows.

## Physical matrix

All ten workflow families are terminal SUCCESS on the exact source and attempt 1:

- Package Smoke — `37087347663` / #3157
- Installed Chat Qualification — `37087347662` / #2435
- Final Runtime Activation — `37087347653` / #2016
- Autonomous Soak — `37087347631` / #2687
- Self Update E2E — `37087347623` / #3606
- Shell — `37087347652` / #3558
- Critical Audit — `37087347661` / #2611
- Shell-First Dirty Profile — `37087347656` / #1044
- Host Resilience Login Start — `37087347640` / #521
- Workspace Reincarnation — `37087347643` / #573

Result:
`10/10 physical workflow families terminal SUCCESS`.

The Self Update V3 regression is physically closed. Its exact resident-upgrade path, one-built installer acquisition, installed ME2 UI/daemon/Guardian staging, physical evidence contract, real Sentinel resident upgrade and terminal producer gate all completed SUCCESS.

## Package identity and one-built producer

Package Smoke producer:
- run id `37087347663`
- run number `3157`
- attempt `1`

Installer:
`METAENGINE-Browser-Test-Setup-0.7.0-dev.37086632570.1-x64.exe`

Installer SHA-256:
`937936bc51d431540762d170b7cc970fdfe1575b9879b885efdc22089e3f2455`

Installer bytes:
`156364268`

Build Identity V3 SHA-256:
`f7d78fdaf7b89028341cc4d0ceb7a7f73ead9b3a323fc15d1560563d7d0c478c`

Dependency-resolution SHA-256:
`e099165be494af2f8d16a3e5b7d675fcbbe369f16bebf16ce182cf8bb7dfcb09`

Package-lock SHA-256:
`4f4fb5e3d6f44d9dc9dfd55054fb2aed8845a83de82a013727b45ea9d0f52059`

Composed SBOM semantic inventory SHA-256:
`cce189f978bc27d0175b2a431ebb4f771f05a0fa334d3d95af1390363f4b176c`

Composition aggregate remains:
`incomplete`

## Producer-side SLSA provenance

Package Smoke produced a Sigstore/Rekor SLSA provenance attestation:
- attestation id `52339986`
- predicate type `https://slsa.dev/provenance/v1`
- builder workflow `browser-windows-package-smoke.yml`
- source `a68774eb6ad5a0fe8014501163b0c67f608bed09`
- subject installer digest `937936bc51d431540762d170b7cc970fdfe1575b9879b885efdc22089e3f2455`

Independent Package Smoke verifier produced:
`metaengine.browser-fabric.provenance-evidence.v1`

with:
- `verified=true`
- `builder_trusted=true`
- verifier `github-slsa-package-smoke:37087347663:1`
- `authority_effect=false`

Immutable SLSA verification artifact:
- artifact id `11261401099`
- artifact digest `sha256:6614a8fa2ccd358bbe1d423845912578d6a194c997eeb736a6222fd610d20331`

## Installed qualification backend proof

Supabase function:
`metaengine-client-installed-qualification-h205f22`

Deployment:
`jhriwwsryeqsvvvufkok_add28328-d282-4942-9fa1-c2302da1e23f_8`

During Installed Chat physical qualification, logs show:
- HTTP 202 waiting-for-exact-enrollment stage;
- HTTP 200 exact approval stage.

This is evidence that the dedicated physical push OIDC policy and exact run/source/attempt binding worked for this candidate.

## Next development frontier

Do not create a second release manifest.

The next source-only convergence slice is to bind the already-verified producer-side SLSA provenance into the existing release-attestation chain:

1. the release qualification predicate must bind the exact SLSA builder, source, subject digest, producer run and immutable SLSA evidence artifact;
2. the independent release verifier must cryptographically re-verify the SLSA provenance for the exact installer and fail closed on builder/source/run drift;
3. the resulting release-attestation proof must remain evidence-only and preserve `promotion_authorized=false`, `release_published=false`, `authority_effect=false`.

No release/tag/promotion/live user install is authorized by this checkpoint.
