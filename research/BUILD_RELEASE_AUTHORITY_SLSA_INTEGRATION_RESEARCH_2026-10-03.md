# METAENGINE Browser — Release Authority / SLSA Provenance Integration Research

Date: 2026-10-03
Branch: `analysis/build-release-attestation-verification-v1`
Authority: research/evidence only
Promotion authority: false

## Executive decision

Do **not** create a new canonical release manifest and do **not** retroactively label the already-built Browser installer with SLSA build provenance.

METAENGINE already has the relevant product contracts:

- `verified-self-update-manifest.json`
- schema `metaengine.browser.self-update-e2e-manifest.v2`
- resolver output `metaengine.trusted-dev-release.v1`
- `metaengine.browser-fabric.release-authority-gate.v1`
- `metaengine.browser-fabric.provenance-evidence.v1`

The correct next physical supply-chain step is to make a **future Package Smoke producer** emit SLSA build provenance for the exact installer it actually builds, then independently verify that provenance into the already-existing Browser Fabric evidence schema.

The currently qualified installer remains valid physical evidence, but it cannot honestly satisfy the existing SLSA-provenance requirement because its Package Smoke producer did not emit a SLSA build-provenance attestation at build time.

## Fresh exact anchors

Physically-qualified subject:

- source: `694b106925cb7a1ce9b4d7918962821b152c0583`
- package: `0.7.0-dev.37006000001.1`
- installer SHA-256: `631dc5751e9ea731d3575a3263b0d54ce264564a060133002d9f38130d7ebc14`
- Package Smoke producer: run `37006158040`, run number `3149`, attempt `1`
- Build Identity V3: `c06711d023ffb4fd3c35d827fdd9d3ca4b44f869d659e524fffb7f901c330201`
- composed SBOM raw SHA-256: `09d456784fa9a469b13d6081041f423f756f4cdfc0a74c7019472000095ac663`
- composed semantic inventory SHA-256: `8173986ff547f418c5c1ee6d572bbb5732450f80380f329d5c43fd87097c93df`
- physical matrix: 10/10 SUCCESS

Current release-attestation verification source:

- PR #1098
- branch `work/build-release-attestation-verification-v1`
- exact source-qualified head `72dec6367e89a2cbde24f3bd057e7e7eb6a320e5`
- Source Qualification push run `37065847144`: SUCCESS
- Source Qualification PR run `37065851353`: SUCCESS
- Admission Qualification run `37065851339`: SKIPPED by intended stacked-PR base guard

No signed release attestation has been generated yet.

## Existing product contracts discovered

### 1. Trusted release manifest already exists

`apps/metaengine-browser/src/trusted-dev-release-resolver.mjs` already expects:

`verified-self-update-manifest.json`

with schema:

`metaengine.browser.self-update-e2e-manifest.v2`

It binds, among other things:

- release version;
- exact Git SHA;
- dev channel;
- installer name + SHA-256;
- installed executable SHA-256 where supported;
- physical N→N+1;
- durable successor binding;
- forced successor;
- profile continuity;
- single install directory;
- physical singleton.

After resolving a published release, it emits:

`metaengine.trusted-dev-release.v1`

with the exact release tag, source SHA, installer SHA, manifest SHA, dev.yml SHA and installed executable binding.

Conclusion: a new generic `canonical-release-manifest.json` would be a second partially-overlapping policy plane. Do not create it.

### 2. Release Authority Gate already defines the convergence target

`apps/metaengine-browser/src/browser-fabric-release-authority-gate.mjs` already requires four evidence classes:

1. trusted release;
2. immutable release evidence;
3. SLSA provenance evidence;
4. source ancestry evidence.

Its provenance contract is:

`metaengine.browser-fabric.provenance-evidence.v1`

and requires:

- `verified=true`
- `builder_trusted=true`
- valid `builder_id`
- exact source SHA
- exact installer subject name
- exact installer SHA-256
- predicate type exactly `https://slsa.dev/provenance/v1`
- `authority_effect=false`.

Even a positive gate result does not mutate authority. It only emits an `AUTHORITY_ADVANCE_CANDIDATE` and explicitly requires a separate journaled promotion effect.

Conclusion: new supply-chain work must satisfy this existing contract instead of inventing a parallel release authority model.

## External research

### GitHub artifact attestations

GitHub's artifact-attestation documentation says that generation alone does not provide the security benefit; consumers must verify attestations and apply their own policy.

References:
- https://docs.github.com/en/actions/concepts/security/artifact-attestations
- https://cli.github.com/manual/gh_attestation_verify

Current `gh attestation verify` supports policy constraints that map well to METAENGINE's trust model:

- repository;
- signer workflow;
- signer digest;
- source digest;
- source ref;
- predicate type;
- OIDC issuer;
- deny self-hosted runners;
- local Sigstore bundle;
- custom trusted root.

### Offline / durable verification

GitHub explicitly supports:

`gh attestation trusted-root`

plus local bundle verification with:

`--bundle ... --custom-trusted-root ...`

Reference:
https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/verify-attestations-offline

Important limitation: a trusted-root snapshot is dated evidence, not eternal authority. GitHub notes that Sigstore key material can rotate/revoke, so old trusted-root snapshots should not be treated as permanently current trust state.

### SLSA provenance semantics

SLSA defines build provenance as verifiable information describing **where, when and how an artifact was produced**. In its build-provenance model, a build platform produces artifacts through execution of the `buildDefinition`; `builder.id` identifies the platform trusted to execute the build and record provenance.

References:
- https://slsa.dev/spec/v1.2/provenance
- https://slsa.dev/spec/v1.2-rc2/build-provenance
- https://slsa.dev/spec/v1.2/build-requirements

SLSA build requirements state that the build platform is responsible for provenance generation and that provenance must unambiguously identify the output package by digest and describe how it was produced.

Consequence for METAENGINE:

A release-attestation workflow that runs later and merely downloads an already-built installer is **not the honest place to claim that it built the installer**. It can create qualification/SBOM attestations about the existing subject, but build provenance should originate from the physical build producer.

### GitHub SLSA levels

GitHub states that normal artifact attestations can provide SLSA Build Level 2, while building and attesting through a reusable workflow can help reach SLSA Build Level 3 by isolating trusted build instructions.

References:
- https://docs.github.com/en/actions/concepts/security/artifact-attestations
- https://docs.github.com/en/enterprise-cloud@latest/actions/how-tos/secure-your-work/use-artifact-attestations/increase-security-rating

This creates two sensible horizons for METAENGINE:

- **P0 / minimal honest convergence:** emit and verify SLSA provenance from the existing exact Package Smoke producer path.
- **P1 / stronger builder isolation:** move the physical build + provenance generation into a pinned reusable workflow and make the caller a thin orchestrator.

Do not block the current Client V1 convergence on the P1 refactor unless P0 cannot satisfy the existing release-authority contract safely.

## Current Package Smoke gap

`.github/workflows/browser-windows-package-smoke.yml` currently has only:

- `actions: read`
- `contents: read`

It already produces:

- exact installer;
- blockmap;
- installer provenance v3;
- Build Identity V3;
- dependency resolution;
- npm SBOM;
- composed SBOM;
- package lock material;
- frozen toolchain evidence;
- package-version reservation.

It then publishes one immutable candidate artifact for downstream consumers.

It does **not** currently create a GitHub/Sigstore SLSA build-provenance attestation for the installer.

This is the missing evidence class required by `browser-fabric-release-authority-gate.mjs`.

## Recommended future physical slice

### P0 — Package Smoke SLSA producer

On a **fresh source SHA with a fresh unused package version**:

1. keep current package-version reservation before any physical build;
2. build installer exactly once;
3. compute installer SHA + Build Identity as today;
4. create SLSA build-provenance attestation for that exact installer in the Package Smoke producer path;
5. materialize the Sigstore bundle into the immutable candidate artifact;
6. do not grant promotion/release authority;
7. run the existing full physical qualification matrix on the same one-built installer.

The attestation action must be pinned by immutable action SHA.

### P0 verifier

Add a read-only downstream verifier that:

- reacquires the exact one-built Package Smoke artifact;
- verifies the SLSA bundle with exact:
  - repository;
  - signer workflow;
  - signer digest;
  - source digest/ref;
  - OIDC issuer;
  - predicate `https://slsa.dev/provenance/v1`;
  - hosted-runner policy;
- validates exact installer name/digest;
- extracts builder identity from the verified statement;
- emits exactly:
  `metaengine.browser-fabric.provenance-evidence.v1`.

This evidence must remain `authority_effect=false`.

### P1 — reusable builder

After P0 is stable, assess migrating the package-producing steps into a pinned reusable workflow. GitHub documents this as the stronger pattern for SLSA Build Level 3 because the reusable workflow supplies vetted build instructions and isolates them from the calling workflow.

This should be a separate architecture change, not mixed into the first provenance rollout.

## Release publication integration

Current project already has:

`.github/workflows/metaengine-browser-fast-autorelease.yml`

which consumes physical evidence and publishes:

- installer;
- blockmap;
- `dev.yml`;
- `verified-self-update-manifest.json`;
- Guardian manifest/binaries.

Future provenance work should extend this existing release asset set only if the release consumer needs a portable provenance bundle. It should not replace the current v2 self-update manifest.

## Required future acceptance gates

Before any release-authority consumer can use a new candidate:

1. fresh package identity;
2. one Package Smoke producer / one installer;
3. exact build-provenance subject digest equals installer SHA;
4. exact build-provenance source SHA equals physical source SHA;
5. trusted builder identity verified;
6. existing Build Identity V3 remains exact;
7. composed SBOM remains exact and honest `incomplete`;
8. all physical workflow consumers use the one-built artifact;
9. full terminal physical matrix succeeds;
10. release attestation verification succeeds;
11. trusted release resolver succeeds after publication;
12. immutable release evidence succeeds;
13. ancestry proof succeeds;
14. Browser Fabric release gate may emit only an authority-advance **candidate**;
15. actual authority mutation remains a separate journaled effect.

## Explicit non-goals

Do not:

- backfill fake SLSA provenance for `694b106...`;
- regenerate the current installer;
- reuse package `0.7.0-dev.37006000001.1` for changed source;
- create a competing release manifest;
- make SBOM/attestation evidence itself a promotion signal;
- merge or publish from an analysis/research workflow;
- weaken one-producer or no-blind-retry fences.
