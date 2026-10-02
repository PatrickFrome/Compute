# METAENGINE Browser supply-chain hardening research after Build Identity V2 — 2026-10-02

Base source: `4c3dd26f9d89bb5e5b04c1eb4a21a5c434dba86b`  
Analysis branch: `analysis/build-identity-v2-next-stage-4c3dd26`

This research plans the next slice only. It does not alter Package Smoke, release authority, updater behavior, or the current Build Identity V2 qualification source.

## Current boundary

Build Identity V2 already binds:
- repository + repository id;
- exact source SHA;
- Package Smoke workflow;
- GitHub run id and attempt;
- package version;
- platform/arch;
- builder config SHA-256;
- actual installed dependency-resolution SHA-256;
- electron-builder version;
- Node version.

The physical installer remains a post-build subject with its own SHA-256, and downstream Installed Chat / Runtime / Soak / Self Update consume one exact Package Smoke artifact.

The remaining dependency weakness is that Package Smoke currently runs:
`npm install --no-audit --no-fund --no-package-lock`

Direct dependency versions are pinned, but transitive resolution is still recomputed against the registry on each clean build.

## npm lockfile / npm ci findings

Primary sources:
- https://docs.npmjs.com/files/package-lock.json/
- https://docs.npmjs.com/cli/commands/npm-ci/

npm documents package-lock.json as the exact generated dependency tree intended to be committed to source control. Lockfile package entries can carry `resolved` and SRI `integrity` metadata for the unpacked artifact.

npm documents `npm ci` as the CI/deployment path for a frozen install:
- requires an existing lockfile;
- fails if package.json and lockfile disagree;
- removes an existing node_modules before install;
- does not rewrite package.json or package-lock.json.

### Recommended next implementation

1. Generate and review one Browser package-lock using the same npm major/version family used by CI.
2. Commit it with the Browser package.
3. Replace Package Smoke's `npm install --no-package-lock` with `npm ci --no-audit --no-fund`.
4. Bind `package-lock.json` SHA-256 into Build Identity V2 successor.
5. Preserve the current actual-installed-tree digest as post-install readback; do **not** replace it with lockfile hash.
6. Add a gate:
   - package.json / lockfile drift -> fail before packaging;
   - lockfile digest drift from Build Identity -> fail;
   - installed-tree digest remains a separate post-install check.
7. Add a clean second resolution proof on another runner/step only if needed for a determinism audit; do not rebuild the installer.

This creates two complementary materials:
- **declared/frozen material**: lockfile SHA-256 and integrity-bearing entries;
- **observed material**: installed dependency tree SHA-256.

A mismatch between them is a build failure.

## SLSA mapping

Primary source:
https://slsa.dev/spec/v1.2-rc2/build-provenance

SLSA Provenance separates:
- `buildDefinition`: inputs and resolved dependencies;
- `runDetails`: details of the concrete build execution;
- artifact `subject`: output digest(s).

METAENGINE mapping:
- Build Identity payload ~= bounded buildDefinition + invocation identity;
- lockfile + config + exact source are resolved build inputs/materials;
- GitHub run id/attempt + builder/node versions are run-specific details;
- installer/blockmap SHA-256 are output subjects.

Important constraint:
- do not include installer SHA-256 inside the pre-build Build Identity digest, because that creates a circular identity;
- bind installer SHA-256 to Build Identity in installer-provenance v2/v3 after the build.

## GitHub artifact attestation findings

Primary sources:
- https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations
- https://docs.github.com/en/actions/concepts/security/artifact-attestations
- https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/increase-security-rating

GitHub artifact attestations can bind a binary to:
- repository;
- workflow;
- commit SHA;
- triggering event;
- OIDC-backed provenance metadata.

GitHub also supports attestation verification and recommends reusable workflows + attestations for stronger SLSA build guarantees.

### Recommended METAENGINE adoption point

Do not attest every draft Package Smoke artifact yet.

First qualify:
- Build Identity V2;
- committed lockfile + npm ci;
- one-built exact-artifact physical chain.

Then add attestation at the **release-candidate / published release boundary**:
1. only after exact-head required CI is terminal green;
2. attest the exact installer that already passed Package Smoke, Installed Chat, Runtime, Soak and Self Update;
3. verify attestation before publication/promotion;
4. include attestation verification result in the release checkpoint;
5. keep installer SHA-256 and internal Build Identity verification as independent local gates.

Attestation must not become a bypass around physical qualification.

## SBOM

GitHub supports attestations associated with SBOM material. For METAENGINE, the lockfile first gives a strong dependency inventory. A later release-only SBOM should be generated from the exact qualified source/dependency set and bound to the same release artifact.

Avoid adding an always-on SBOM generator to every draft build until its runtime/cost and schema are measured.

## Suggested roadmap

### BI3-A — Frozen dependency input
- committed Browser package-lock;
- npm ci;
- lockfile SHA-256 bound into Build Identity;
- actual installed tree digest retained;
- full existing physical qualification.

### BI3-B — Release attestation
- exact installer artifact attestation;
- signer workflow pinning during verification;
- attestation result stored in release checkpoint;
- no release if digest/workflow/source binding drifts.

### BI3-C — SBOM / dependency transparency
- exact-source SBOM;
- attach/attest SBOM at release boundary;
- compare SBOM dependency set to lockfile/installed-tree materials.

## Explicit non-goals

- no second provenance database;
- no mutable build-id allocation service;
- no replacement for installer SHA-256;
- no automatic release authority;
- no weakening of one-builder/one-artifact topology;
- no Supervisor or Guardian authority change;
- no claim of reproducible installer bytes merely because dependencies are frozen.

## Decision

The next engineering slice after Build Identity V2 qualification should be **lockfile + npm ci + lockfile SHA binding**, not artifact attestation first.

Reason: attestation can prove which workflow produced bytes, but it does not itself make the dependency inputs deterministic. Frozen dependency input removes a real remaining source of build variance before adding cryptographic release provenance.
