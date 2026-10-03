# METAENGINE Browser — Release Publisher / SLSA Convergence Research

Date: 2026-10-03
Authority: research/evidence only
Promotion authority: false
Release publication authorized: false

## Starting evidence baseline

The P0 physical supply-chain baseline is frozen at:

- source: `a68774eb6ad5a0fe8014501163b0c67f608bed09`
- package: `0.7.0-dev.37086632570.1`
- installer SHA-256: `937936bc51d431540762d170b7cc970fdfe1575b9879b885efdc22089e3f2455`
- Package Smoke: `37087347663` / #3157 / attempt 1 / SUCCESS
- SLSA attestation: `52339986`
- physical matrix: 10/10 SUCCESS
- Self Update: `37087347623` / #3606 / attempt 1 / SUCCESS

This document does not authorize moving the release branch or publishing a GitHub Release.

## Fresh upstream research

GitHub documents ordinary artifact attestations as SLSA v1 Build Level 2.

GitHub also documents a stronger Level 3 direction: move both the build and attestation generation into a reusable workflow containing known, vetted build instructions. The reusable workflow becomes the signer identity.

For reusable-workflow attestations, `gh attestation verify` can constrain:
- signer repository;
- exact signer workflow;
- signer digest;
- source digest;
- source ref;
- predicate type;
- OIDC issuer;
- self-hosted runner policy.

METAENGINE should retain its current semantic verifier after cryptographic verification. GitHub verification establishes signature and actor identity; the repository verifier binds those claims to the exact METAENGINE installer/source/build contract.

## Current publisher topology

Current effectful publisher:

`.github/workflows/metaengine-browser-fast-autorelease.yml`

Trigger:

`push -> release/self-update-ambiguity-live-v2`

It has:
- `actions: read`
- `contents: write`

It waits for:
1. `metaengine-browser-release-evidence-gate.yml`;
2. `metaengine-browser-self-update-fast-e2e.yml`.

It then downloads the immutable fast-E2E evidence artifact, verifies the manifest/installer/Guardian material, creates a draft GitHub Release, verifies uploaded GitHub asset digests, publishes the prerelease, and advances a dev hint.

This is an effectful plane and must remain untouched by this research slice.

## Current central release-evidence gate

`.github/workflows/metaengine-browser-release-evidence-gate.yml`

is read-only and currently waits for twelve exact-SHA workflows:

- bootstrap autostart;
- fast N-to-N+1;
- full Self Update;
- Critical Audit;
- analysis stack;
- emergency native path;
- parent-progress durability;
- self-update durability;
- Package Smoke;
- autonomous soak;
- final runtime;
- installed chat.

It emits:

`metaengine.browser.release-evidence-gate.v1`

with `authority_effect=false`.

However, it does not currently read or cryptographically verify the new Package Smoke SLSA evidence artifact. It treats workflow success as sufficient for its own gate.

The field `installer_publication_authorized=true` is legacy publisher-oriented evidence. It is not Browser Fabric release authority and must not be reused as a shortcut around the newer release-authority gate.

## Current Browser Fabric release-authority gate

`browser-fabric-release-authority-gate.mjs`

already has a stronger and orthogonal contract.

It requires:
- `metaengine.trusted-dev-release.v1`;
- `metaengine.browser-fabric.immutable-release-evidence.v1`;
- `metaengine.browser-fabric.provenance-evidence.v1`;
- `metaengine.browser-fabric.source-ancestry-evidence.v1`.

The provenance evidence must bind:
- exact SLSA v1 predicate;
- trusted builder;
- exact source SHA;
- exact installer name;
- exact installer digest;
- zero authority effect.

Even a positive result returns only:

`AUTHORITY_ADVANCE_CANDIDATE`

and explicitly requires a separate journaled promotion effect.

Therefore the new physical SLSA evidence fits an existing canonical release-authority contract. A second release authority plane is unnecessary.

## Gap 1 — publisher gate does not consume the SLSA proof

The P0 Package Smoke produces and independently verifies:

`metaengine.browser-fabric.provenance-evidence.v1`.

The current release-evidence gate only checks that Package Smoke completed successfully.

That leaves a semantic gap between:
- “Package Smoke workflow succeeded”
and
- “the installer selected for release has a cryptographically verified SLSA statement whose source/builder/subject are exact”.

P1 release convergence should make the read-only release gate consume the actual provenance artifact and exact installer identity.

## Gap 2 — release publisher consumes Self Update evidence, not the provenance bundle

The publisher correctly reuses exact tested bytes from the Self Update evidence artifact and does not rebuild them.

But the Self Update evidence artifact is optimized for update qualification. The portable Package Smoke SLSA bundle lives with the Package Smoke candidate and its independent verification artifact.

The publisher currently does not bring that bundle into the release asset set.

A release must not regenerate provenance after the fact. It should transport the already generated producer bundle.

## Gap 3 — trusted release resolver has an exact asset-count contract

`trusted-dev-release-resolver.mjs` currently supports:
- four legacy assets; or
- seven current Guardian-aware assets.

For the seven-asset profile it expects exactly:
- `dev.yml`
- installer
- blockmap
- `verified-self-update-manifest.json`
- `guardian-native-staging-manifest.json`
- `METAENGINEBrowserGuardian.exe`
- `METAENGINEBrowserGuardianConfigure.exe`

It rejects any other asset count.

Therefore simply attaching SLSA bundle/evidence files to a GitHub Release would make the current runtime resolver reject that release.

This is a concrete compatibility blocker.

## Gap 4 — post-publication release evidence is distinct from build provenance

Build provenance proves where/how the installer was built.

Immutable release evidence must prove that the published tag and GitHub Release assets are the same immutable bytes that were qualified.

Those are separate facts.

Do not treat SLSA provenance as proof that the GitHub Release itself is immutable and exact.

The existing Browser Fabric gate correctly requires both.

## Recommended convergence sequence

### RPV1 — source-only resolver V3 asset profile

Add a new release asset profile while retaining the existing four/seven-asset profiles for historical releases.

Proposed additional evidence assets:
- `installer-slsa-provenance.bundle.json`
- `browser-package-slsa-provenance-evidence.json`

Do not include a second authority document.

The resolver should:
- hash-bind both files using GitHub release asset digests;
- require the evidence schema to be `metaengine.browser-fabric.provenance-evidence.v1`;
- require source SHA = tag commit;
- require subject name/digest = installer asset;
- require `verified=true`, `builder_trusted=true`, `authority_effect=false`;
- preserve legacy release compatibility.

The portable bundle remains the cryptographic evidence material; the JSON evidence is the independently verified semantic projection.

### RPV2 — read-only release gate consumes exact Package Smoke provenance

Before any publisher effect, the central release gate should:
- resolve exact Package Smoke run by source SHA + push event;
- require attempt 1;
- download the exact SLSA verification artifact;
- verify artifact digest/readback;
- verify the provenance-evidence schema and exact installer/source binding;
- compare installer SHA against Self Update manifest installer SHA;
- carry those exact identities into release-gate evidence.

No OIDC or write permission is required.

### RPV3 — publisher transports, never regenerates

The publisher should download:
- exact qualified Self Update release material;
- exact Package Smoke SLSA bundle/evidence.

It must prove both identify the same installer bytes.

It may then publish those already-existing files as release assets.

It must never invoke `actions/attest` during release publication for build provenance.

### RPV4 — post-publication immutable release evidence

After GitHub reports the exact uploaded asset digests and tag target, create:

`metaengine.browser-fabric.immutable-release-evidence.v1`

as readback evidence.

That evidence should bind:
- tag;
- commit SHA;
- installer digest;
- installed executable digest;
- manifest digest;
- attestation/bundle asset presence and digest;
- `authority_effect=false`.

This is still not live promotion authority.

### RPV5 — existing release-authority gate

Only after trusted-release resolution + immutable release evidence + SLSA provenance evidence + ancestry evidence should the existing pure gate return:

`AUTHORITY_ADVANCE_CANDIDATE`.

A separate journaled promotion effect remains mandatory.

## SLSA Level 3 direction

After RPV1–RPV5 are proven without weakening P0, isolate the Package Smoke build+attest core inside a reusable workflow.

The trusted builder should:
- own deterministic build instructions;
- generate the installer and attestation in one reusable workflow;
- expose only bounded inputs;
- avoid caller-controlled shell/build steps affecting the trusted path;
- preserve fresh package reservation and exact source identity.

Verification should then pin the reusable signer workflow, and preferably signer digest, in addition to the source repository/ref.

This should be a separate successor, not mixed into release-publisher convergence.

## Why not modify the effectful publisher now

The current 10/10 physical candidate is a valuable frozen baseline.

Moving the release branch would trigger:
- legacy release evidence workflows;
- the current effectful publisher.

Changing that plane before the new provenance assets are supported by the runtime resolver could produce a release that current clients reject or a partial publication state.

Therefore the next implementation should begin with source-only resolver/gate contracts and tests, not a release-branch push.

## Hard fences

- no release branch movement;
- no GitHub Release/tag creation;
- no publisher workflow execution;
- no live dev-hint movement;
- no user-machine install;
- no production authority promotion;
- no new build provenance generation for already-built installer bytes;
- no duplicate release-authority schema.
