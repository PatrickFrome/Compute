# Build Identity V2 implementation research — 2026-10-02

Implementation source before this note: `2c4503b48749b027170feda7343f16a7ede89793`  
Base qualified runtime: `bf21d71b6dc674c376bd396487b5efc134d0a3e9` (Guardian semantic hardening, PR #1090)

## Problem being solved

The Browser already had strong one-built installer provenance: exact source SHA, Package Smoke run/attempt, installer SHA-256, blockmap SHA-256 and builder-config SHA-256 were recorded, while Installed Chat / Final Runtime / Soak / Self Update consumed the source-scoped Package Smoke artifact instead of rebuilding it.

The remaining weakness was semantic package identity. During rapid source iteration, the same package version could accidentally survive across two different source heads before CI started. The source-scoped GitHub artifact name prevented cross-head artifact discovery, but the same runtime version string could still refer to different bytes. Manual per-commit version reservation is too race-prone to be the only defense.

Build Identity V2 makes the build invocation itself first-class and tamper-evident. It does not replace installer SHA-256, updater version ordering, or release authority.

## Primary-source findings

### GitHub Actions invocation identity

GitHub documents:
- `GITHUB_REPOSITORY_ID` as the stable numeric repository id;
- `GITHUB_RUN_ID` as unique for a workflow run within the repository and unchanged by rerun;
- `GITHUB_RUN_ATTEMPT` as a number that increments for every rerun;
- `GITHUB_RUN_NUMBER` as scoped to one workflow.

Reference:
https://docs.github.com/en/actions/reference/workflows-and-actions/variables

Implementation consequence:
- Build Identity binds repository name + repository id + exact source SHA + workflow + run id + run attempt.
- It does not use `GITHUB_RUN_NUMBER` as a repository-global identity.
- A rerun is deliberately a distinct invocation because `run_attempt` is part of the identity.

### electron-builder metadata and lifecycle

electron-builder v26 documents:
- `extraMetadata` for injecting properties into packaged package.json;
- `beforePack` before app files are copied into the bundle;
- `afterAllArtifactBuild` after all artifacts are built.

References:
https://www.electron.build/v26/docs/configuration/
https://www.electron.build/v26/docs/features/build-lifecycle/

Implementation consequence:
- Existing `electron-builder-before-pack.cjs` injects `metaengineBuildIdentity` next to the already-qualified emergency trust root and Guardian bootstrap binding.
- Existing `electron-builder-after-all-artifact-build.cjs` re-opens packaged app.asar and independently verifies that identity against exact CI/source/config/dependency inputs.
- No second packaging framework is introduced.

### SLSA provenance model

SLSA provenance separates:
- build definition / resolved dependencies;
- per-run details / invocation id;
- final artifact subjects and their digests.

Reference:
https://slsa.dev/spec/v1.2/build-provenance

Implementation consequence:
- `build_identity_sha256` is a pre-artifact invocation identity.
- Installer/blockmap SHA-256 remain post-build artifact subjects.
- Installer SHA is intentionally **not** an input to Build Identity, avoiding a circular identity in which changing the embedded identity would change the installer hash again.

### npm dependency resolution

npm documents that package-lock records the exact generated dependency tree, including integrity metadata, and that `npm ci` requires a lock, fails on package.json/lock drift, removes an existing node_modules tree and does not rewrite package metadata.

References:
https://docs.npmjs.com/files/package-lock.json/
https://docs.npmjs.com/cli/commands/npm-ci/

Current repository reality:
- Browser Package Smoke still uses `npm install --no-audit --no-fund --no-package-lock`;
- no committed Browser package-lock is present;
- direct Browser dependencies are exact-pinned, but transitive package bytes are not frozen.

Bounded V2 adoption:
- Package Smoke records a canonical digest of the **actual installed dependency name/version tree** before packaging.
- Node and npm versions are part of the dependency proof; Node version is also part of Build Identity.
- This gives exact resolution provenance for the physical build but **does not claim byte-for-byte dependency reproducibility**.

Future hardening:
- commit a reviewed Browser lockfile;
- move Package Smoke to `npm ci`;
- bind lockfile SHA-256 / integrity-bearing resolution into Build Identity;
- only then claim a frozen dependency input.

### GitHub immutable workflow artifacts

actions/upload-artifact v4 exposes artifact id and SHA-256 digest and documents uploaded v4 artifacts as immutable.

Reference:
https://github.com/actions/upload-artifact/blob/main/README.md

Implementation consequence:
- the existing source-SHA-scoped candidate artifact remains the one physical carrier for downstream qualification;
- Build Identity JSON and dependency-resolution JSON are included inside that immutable candidate;
- downstream verification checks them before physical execution.

### GitHub artifact attestations

GitHub artifact attestations create signed provenance that includes workflow/repository/commit/event identity. GitHub recommends attesting binaries people will actually consume, and notes that an attestation links an artifact to source/build instructions but is not itself proof that the artifact is safe.

References:
https://docs.github.com/en/actions/concepts/security/artifact-attestations
https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations

Decision:
- do **not** add attestation to every draft Package Smoke candidate in this slice;
- after Build Identity V2 is qualified, add attestation at release-candidate/published-release boundary if repository permissions and release flow support it;
- keep local physical qualification and exact installer digest as independent gates.

## Build Identity V2 contract

`metaengine.browser.build-identity.v2` binds:

- repository + repository id
- exact source SHA
- Package Smoke workflow identity
- GitHub run id
- GitHub run attempt
- package version
- platform + architecture
- electron-builder config SHA-256
- installed dependency-resolution SHA-256
- electron-builder version
- Node version

A canonical key-sorted JSON payload is SHA-256 hashed into `build_identity_sha256`.

Properties:
- deterministic for the same exact invocation inputs;
- different source, run, rerun attempt, config or dependency tree produces a different identity;
- zero authority;
- version string alone is never sufficient provenance.

## Implementation mapping

No parallel provenance service was created.

Existing paths evolved:
- `scripts/installer-provenance.mjs`
- `scripts/qualified-installer-consumer.ps1`
- `scripts/electron-builder-before-pack.cjs`
- `scripts/electron-builder-after-all-artifact-build.cjs`
- `.github/workflows/browser-windows-package-smoke.yml`

New bounded helpers:
- `scripts/build-identity.cjs`
- `scripts/build-identity-cli.mjs`
- `scripts/dependency-resolution-digest.mjs`

Tests:
- `test/build-identity.test.mjs`
- `test/installer-provenance-v2.test.mjs`
- updated `test/qualified-installer-consumer-verify.ps1`

## Independent readback geometry

Package Smoke now has three views of the same identity:

1. pre-build expected identity from `build-identity-cli.mjs`;
2. identity independently recomputed in the before-pack hook and injected into packaged package.json;
3. after-artifact hook extracts packaged package.json from app.asar and validates it against the current checkout/CI/dependency/config state.

A mismatch fails the producer before the candidate is accepted.

`installer-provenance.v2` then binds the resulting identity to:
- exact installer bytes;
- exact blockmap;
- exact config digest;
- exact producer run/attempt/source.

Downstream consumers require:
- provenance v2;
- external build-identity proof;
- external dependency-resolution proof;
- exact run/attempt/source;
- installer/blockmap/config hash verification.

Terminal producer gates carry the Build Identity/dependency digest into downstream physical proof.

## Defects found during implementation

A tooling-side editing incident duplicated large YAML/PowerShell suffixes because JavaScript string replacement interpreted the regex text `$'` inside replacement strings as a special replacement token. This was detected from an anomalous diff (+1778 workflow lines and repeated Package Smoke steps), not allowed to reach CI, and repaired by reconstructing both files from the qualified base through exact full-file tree writes.

Post-repair invariants:
- one Package Smoke build step;
- one candidate upload;
- one evidence upload;
- one Acquire block;
- one Verify block;
- one consumer binding block.

This incident did not trigger any physical build because the Build Identity branch still had no pull request.

## Explicit non-goals of V2

Build Identity V2 does not:
- authorize release/promotion;
- sign the installer;
- open Supervisor admission;
- change Guardian authority;
- make npm dependency bytes reproducible without a lockfile;
- replace installer SHA-256;
- create a new mutable version-allocation service;
- solve semantic version ordering by itself.

## Next qualification sequence

Before opening a PR:
1. freeze implementation/tests/research/checkpoint;
2. reserve one new package identity in the final source commit;
3. open one stacked draft PR on qualified Guardian PR #1090;
4. allow Package Smoke to build exactly once for that exact head;
5. require full Browser regression + Package Smoke + Installed Chat + Runtime + Soak + Self Update on the same producer artifact.

If any source change is required after Package Smoke begins, the package version is consumed and must advance before the next physical build.
