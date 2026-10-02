# METAENGINE Browser Build Supply Chain V4 research — 2026-10-02

Analysis base: `7e58af841be1e6be840d0b1d13bc95d95af23b0f`  
Qualified predecessor: PR #1092 / `8409fb249887dd4636b3bd6fab40bfe30fa4b085`  
Active implementation line: `work/build-lockfile-material-v1`

This document is research/architecture only. It does not authorize release, promotion, live install, Supervisor admission, Guardian enrollment, task execution, or any physical retry.

## Current implemented boundary

The active V3 line already separates two dependency identities:

1. **Frozen declared input**
   - committed `apps/metaengine-browser/package-lock.json`
   - exact lockfile SHA-256
   - Node version
   - npm version

2. **Observed installed output**
   - normalized `npm ls --all --json` tree
   - `dependency_resolution_sha256`
   - concrete installed dependency count

Build Identity V3 binds both.

Package Smoke is wired to:
- reserve source/version before dependency install;
- require exact Node/npm toolchain;
- derive lockfile material;
- run `npm ci`;
- derive installed-tree proof;
- build one installer;
- carry lockfile + installed-tree material into provenance;
- make downstream physical consumers reverify the same producer.

## Research finding: npm ci is the right CI primitive

Primary source:
https://docs.npmjs.com/cli/commands/npm-ci/

npm documents that `npm ci`:
- requires an existing lockfile;
- fails if package.json and lockfile disagree;
- removes pre-existing node_modules;
- never rewrites package.json or package-lock.json.

That maps directly to METAENGINE's fail-closed package producer contract.

The practical implication is that **plain `npm install` should not remain in any workflow that claims exact Browser dependency identity**.

## Research finding: package-lock is a build input, not enough by itself

Primary source:
https://docs.npmjs.com/files/package-lock.json/

npm describes package-lock as a committed representation of the dependency tree intended to make CI/deployment dependency resolution stable.

However, METAENGINE should continue to distinguish:
- what the lockfile declares;
- what the runner physically installs.

Therefore `package_lock_sha256` must not replace `dependency_resolution_sha256`.

## Empirical defect found: raw lockfile byte hash was checkout-EOL sensitive

Observed on the same logical lockfile/toolchain before normalization:

Ubuntu materialization:
- lockfile bytes: **19170**
- SHA-256: `9d398b577fbfe1ec6bce39550b69b467491dee44e08c9a253dd3e4f8427dfd69`

Windows checkout before the EOL fence:
- lockfile bytes: **19714**
- SHA-256: `bc105147a62bceb512f63c2a50604e7a97814377b9694ee8853c2288f9a0db9c`

The installed dependency tree was identical:
- dependency count: **55**
- `dependency_resolution_sha256`:
  `e8d6611559e74091c9b9e8c2d54fd98bc456f1748c7709a5432978439a830036`

Root cause: exact working-tree bytes can differ by Git line-ending normalization even when JSON semantics are identical.

Fix implemented on active branch:
`apps/metaengine-browser/.gitattributes`
contains:

`package-lock.json text eol=lf`

Required acceptance:
- future Windows and Linux source qualification must report the same exact lockfile byte SHA.

This is stronger than switching to a canonical-JSON hash because the project intentionally wants exact source material bytes as part of build provenance.

## Research finding: dependency cache must remain non-authoritative

Primary sources:
- https://github.com/actions/setup-node/blob/main/README.md
- https://github.com/actions/setup-node/blob/main/docs/advanced-usage.md

setup-node documents:
- cache keys can use the lockfile hash;
- `cache-dependency-path` should point at subdirectory lockfiles;
- node_modules is not cached.

METAENGINE policy:
- caching may accelerate downloads;
- cache hit/miss must not alter dependency identity;
- node_modules must never become provenance authority;
- the build must still run `npm ci` and rederive installed-tree proof.

Do **not** add cache optimization until V3 physical qualification is terminal green.

## Research finding: native npm SBOM is sufficient for the npm layer

Primary source:
https://docs.npmjs.com/cli/v11/commands/npm-sbom/

npm can produce:
- CycloneDX
- SPDX

It can also generate lockfile-only views.

Recommended METAENGINE use:
- generate an npm-layer CycloneDX SBOM after the exact `npm ci`;
- hash the SBOM;
- treat it as evidence/byproduct, not authority;
- compare its root package/version with Build Identity V3;
- do not claim it is the full Browser SBOM.

The full METAENGINE installer also contains:
- Electron runtime;
- ME2 UI bundle;
- ME2 daemon;
- Guardian native binaries/bootstrap;
- first-party Browser source/resources.

Therefore a complete installer SBOM must be a **composed artifact**, not just `npm sbom`.

## Research finding: GitHub artifact attestations are the correct next authenticity layer

Primary sources:
- https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations
- https://docs.github.com/en/actions/concepts/security/artifact-attestations

GitHub attestation can cryptographically bind a binary to:
- repository;
- workflow;
- commit SHA;
- triggering event;
- GitHub-hosted builder identity.

Current repository is public, so GitHub documents artifact attestations as available on current plans for public repositories.

Important architecture rule:
- Build Identity remains the deterministic internal invocation identity.
- Installer SHA remains the output subject.
- GitHub attestation is an external authenticity envelope over the already-qualified output.
- Attestation must not become a second scheduler, release authority, or automatic promotion signal.

## SLSA mapping

Primary sources:
- https://slsa.dev/spec/v1.2/build-provenance
- https://slsa.dev/spec/v1.0/requirements

SLSA provenance separates:
- `buildDefinition` — what was requested;
- `runDetails` — how/where it ran;
- `subject` — output artifact digest.

METAENGINE maps naturally:

### Build definition inputs
- repository + repository id
- source SHA
- workflow
- package version
- builder config SHA
- package-lock SHA
- dependency-resolution SHA
- Node/npm/electron-builder versions

### Run details
- GitHub run id
- run attempt
- hosted runner/build platform identity

### Subject
- exact installer SHA-256
- optionally blockmap SHA-256 as an additional subject/byproduct

Do not put installer SHA into Build Identity itself; that would make the pre-build identity circular.

## Proposed V4 architecture

### V4-A — finish V3 physical qualification first

Required before any attestation feature:
- same LF-normalized lockfile SHA on Windows and Linux;
- two clean Windows npm-ci installs produce the same dependency-resolution SHA;
- full Browser Windows regression passes under npm ci;
- Package Smoke creates exactly one physical installer;
- all physical consumers reverify Build Identity V3 and lock material;
- Self Update passes using the exact one-built installer.

### V4-B — deterministic npm SBOM evidence

Generate after npm ci:
- `npm sbom --sbom-format=cyclonedx --sbom-type=application`
- persist exact JSON bytes + SHA-256;
- record npm version;
- bind root name/version to Browser package;
- preserve as Package Smoke evidence.

Do not yet put SBOM SHA into Build Identity V3. It is post-install derived evidence.

### V4-C — composed installer SBOM

Compose:
- npm dependency SBOM;
- Electron executable/runtime;
- ME2 UI bundle manifest;
- ME2 daemon manifest;
- Guardian native manifest;
- Guardian bootstrap binding;
- Browser installer subject digest.

Use stable package URLs or deterministic local component refs where possible.

### V4-D — attestation at release-candidate / published-release boundary

Only after exact Package Smoke and all physical downstream consumers are terminal success:
- request `id-token: write`;
- request `attestations: write`;
- attest exact installer subject digest;
- optionally attach SBOM attestation.

This should occur in a separate release-boundary workflow, not in ordinary draft Package Smoke.

Reason:
- avoids giving every development producer attestation authority;
- avoids creating signed provenance for known-failing candidates;
- keeps the physical qualification and release authority planes separate.

### V4-E — verifier integration

Before an installer can be promoted:
- verify Build Identity/provenance internally;
- verify exact installer SHA;
- verify GitHub attestation against PatrickFrome/Compute;
- verify expected source SHA/workflow;
- verify SBOM digest if present.

A missing/invalid attestation should block **promotion**, not developer-local test installation.

## Cache rollout recommendation

After V3 physical qualification:
- enable setup-node `cache: npm`;
- use:
  `cache-dependency-path: apps/metaengine-browser/package-lock.json`

Guardrail:
- run npm ci regardless of cache status;
- rederive lockfile material and dependency-resolution proof after install;
- no cache artifact is accepted as provenance.

## Next implementation priority

1. Finish exact-head source qualification after the EOL fix.
2. Physically qualify Build Identity V3 and npm ci through one Package Smoke producer.
3. Seal V3 qualification checkpoint.
4. Add npm SBOM as evidence-only byproduct.
5. Add composed installer SBOM.
6. Add GitHub artifact attestation only at release/promotion boundary.

Do not combine attestation with the current V3 physical qualification slice.
