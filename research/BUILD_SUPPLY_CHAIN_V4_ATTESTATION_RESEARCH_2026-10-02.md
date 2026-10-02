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


## Research finding: npx builder resolution is another unfrozen input

Primary sources:
- https://docs.npmjs.com/cli/v11/commands/npx/
- https://www.electron.build/v26/docs/

Before this finding, Package Smoke invoked:

`npx --yes electron-builder@26.15.7`

npm documents that when the requested package is not already present locally, npx installs it into the npm cache and places it on PATH. Pinning only the top-level version therefore does **not** freeze electron-builder's own transitive dependency graph in the Browser package-lock.

electron-builder's v26 documentation recommends installing electron-builder as a development dependency.

Required correction before V3 physical qualification:
- add `electron-builder: 26.15.7` to Browser devDependencies;
- regenerate the same committed package-lock under Node 24.21.0/npm 11.19.0;
- run the builder from `node_modules/.bin`, never an npx remote fallback;
- verify the installed builder package version equals the Build Identity field;
- include builder transitive dependencies in the same observed dependency-resolution digest.

This changes the meaning of the V3 lockfile from “application dependency graph frozen” to “application + package-build JS toolchain graph frozen”.

Remaining external inputs still exist (for example Electron runtime downloads, hosted runner image, OS tooling and NSIS resources). Therefore even after this correction METAENGINE should claim **stronger frozen provenance**, not hermetic or bit-reproducible builds.


## Research finding: Bun CI is frozen only when both runtime and lock are pinned

Primary sources:
- https://bun.sh/docs/pm/cli/install
- https://bun.sh/docs/pm/lockfile
- https://github.com/oven-sh/setup-bun/tree/0c5077e51419868618aeaa5fe8019c62421857d6

Bun documents that `bun ci` is equivalent to `bun install --frozen-lockfile`: it installs the exact versions from the committed `bun.lock` and fails when `package.json` and the lockfile disagree.

The setup-bun action also makes an important distinction that METAENGINE should preserve:
- `bun-version` is the requested semantic version;
- `bun-revision` is the runtime revision reported by the executable;
- `bun-path` is the exact downloaded executable;
- `bun-download-url` identifies the source of that executable.

Current V3 implementation pins:
- setup-bun action commit `0c5077e51419868618aeaa5fe8019c62421857d6`;
- Bun `1.3.3`;
- ME2 UI raw `bun.lock` SHA-256;
- `bun ci` rather than mutable `bun install`.

This closes version/lock drift, but it is not yet a hermetic runtime-byte proof.

Recommended V4 runtime-material extension:
- record `bun --revision`;
- hash the exact Bun executable path on the Windows package runner;
- hash the exact Electron runtime executable used by packaging;
- treat those as builder/runtime material evidence;
- keep them separate from source dependency lock semantics.

Do not retrofit these additional binary digests into Build Identity V3 after a V3 physical artifact exists. Introduce them as a versioned V4 material proof or before the first V3 physical producer if the schema is intentionally re-opened.

## Source-qualification workspace isolation

A Windows source qualification run exposed a useful distinction between build outputs and repository evidence.

The ME2 UI build writes `.next` output. This repository historically contains tracked generated UI files, so running `bun run build` in the same checkout can delete or replace paths that repository-wide integrity tests expect to inspect.

The stronger qualification pattern is:
- keep the exact checked-out source immutable;
- copy the ME2 UI source into `RUNNER_TEMP`;
- run `bun ci`, build, pack and bundle verification there;
- run the full Browser regression against the untouched source checkout;
- retain a final `git diff --exit-code` fence.

This avoids teaching repository integrity tests to ignore missing tracked files and preserves their original semantics.


## 2026-10-02 follow-up: attestation boundary confirmed by current primary docs

Current GitHub documentation explicitly recommends signing software that is being released and that consumers are expected to verify, while recommending **not** signing frequent builds used only for automated testing.

For a public repository, GitHub's artifact attestations use the Sigstore Public Good Instance and record the bundle in a public immutable transparency log. GitHub also supports associated SBOM attestations and verification via `gh attestation verify`.

This confirms the earlier METAENGINE boundary:
- ordinary draft Package Smoke remains unsigned qualification evidence;
- the exact installer that has already passed the one-built physical qualification chain becomes the attestation subject at release/promotion boundary;
- attestation verification becomes a promotion policy input, never a substitute for tests or an assertion that the binary is secure.

SLSA v1.2 continues to separate:
- `buildDefinition` — requested inputs;
- `runDetails` — builder and execution metadata;
- artifact subjects — output digests.

For METAENGINE this preserves the non-circular split:
- Build Identity = pre-output invocation/input identity;
- installer SHA-256 = output subject;
- package/build proofs and SBOM = byproducts/evidence;
- GitHub/Sigstore attestation = external authenticity envelope.

The next V4 supply-chain slice should therefore be implemented only after V3 physical qualification:
1. deterministic npm-layer SBOM;
2. composed METAENGINE installer SBOM;
3. release-boundary artifact/SBOM attestations;
4. promotion verifier that validates repository/workflow/source/subject identity.


## Candidate pinned GitHub attestation actions

For a later V4 release-boundary implementation, current v3 tags resolve to these immutable commits:

- `actions/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a`
- `actions/attest-sbom@4651f806c01d8637787e274ac3bdf724ef169f34`
- `actions/attest@daf44fb950173508f38bd2406030372c1d1162b1`

These are research candidates, not yet adopted dependencies. Re-resolve and re-review them at implementation time because the release-boundary slice intentionally follows V3 physical qualification.

METAENGINE should pin immutable action commits rather than floating major tags, consistent with the existing source-supply-chain policy.


## 2026-10-02 current GitHub attestation action update

Fresh primary-source check after V3 qualification changes the recommended implementation detail.

GitHub's current `actions/attest-build-provenance` README states that, as of v4, it is a wrapper over `actions/attest`, and new implementations should use `actions/attest` directly.

Current `actions/attest` release observed:
- tag: `v4.2.2`
- exact commit: `1e69f48acb82d1966a394da916b4c1698aa569d6`

For METAENGINE, pin the exact commit rather than the floating `@v4`.

Current required permissions documented by the action:
- `id-token: write`
- `attestations: write`
- `artifact-metadata: write`

The action supports:
- default SLSA build provenance when given a subject;
- SBOM attestation when `sbom-path` is supplied;
- custom predicates when a predicate type/body is supplied.

### METAENGINE adoption refinement

Do not add these write permissions to Package Smoke.

Create a separate release-boundary attestation workflow/job which:
1. has no package/build steps;
2. downloads the already-qualified exact installer subject;
3. verifies the internal installer provenance / Build Identity / physical qualification checkpoint;
4. grants the attestation permissions only in the attestation job;
5. invokes `actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6`;
6. records returned attestation id/url/bundle path in release evidence;
7. performs no release/promotion automatically merely because attestation succeeded.

This preserves least privilege and ensures a failing draft candidate is never given release-style authenticity merely by reaching Package Smoke.

### SLSA interpretation

SLSA Provenance keeps `buildDefinition`, `runDetails`, and the attested subject separate.

METAENGINE should preserve the same split:
- Build Identity V3 = exact bounded build request/invocation identity;
- GitHub hosted workflow/run identity = execution context;
- installer SHA-256 = subject;
- SBOM = byproduct/attested inventory.

Artifact attestation strengthens authenticity of the already-qualified subject; it does not make the build hermetic or reproducible.
