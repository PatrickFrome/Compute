# Browser frozen npm dependency rollout research — 2026-10-02

Analysis base: `8409fb249887dd4636b3bd6fab40bfe30fa4b085`  
Branch: `analysis/npm-ci-lockfile-rollout-v1`

This branch is analysis/checkpoint only. It does not change the exact source currently undergoing PR #1092 physical qualification and does not create a new Browser package identity.

## Current state

`apps/metaengine-browser/package.json` pins all direct dependencies, but the Browser package has **no committed `package-lock.json`** and no project/root `.npmrc`.

Package Smoke currently installs with:

`npm install --no-audit --no-fund --no-package-lock`

Build Identity V2 records the **actual installed dependency tree** after that install. This is strong post-resolution evidence, but it does not freeze the input resolution before install.

Repository search shows Browser dependency installation is repeated across multiple workflows. Exact current consumers include at least:

- `.github/workflows/browser-critical-audit-v1.yml`
- `.github/workflows/metaengine-browser-shell-v1.yml`
- `.github/workflows/browser-windows-autonomous-soak-v1.yml`
- `.github/workflows/browser-final-runtime-activation-v1.yml`
- `.github/workflows/browser-shell-first-dirty-profile-v1.yml`
- `.github/workflows/metaengine-browser-analysis-stack-v1.yml`
- `.github/workflows/metaengine-browser-release-evidence-gate.yml`
- `.github/workflows/browser-windows-package-smoke.yml`
- `.github/workflows/browser-windows-installed-chat-qualification.yml`
- `.github/workflows/metaengine-browser-self-update-e2e.yml`
- `.github/workflows/metaengine-browser-self-update-fast-e2e.yml`
- `.github/workflows/metaengine-browser-bootstrap-autostart-e2e.yml`
- `.github/workflows/metaengine-browser-dp2-windows.yml`
- `.github/workflows/windows-fleet-chaos-convergence.yml`
- `.github/workflows/browser-supervisor-rebuild-fixed.yml`
- `.github/workflows/browser-live-supervisor-compute-convergence-repair.yml`

Some use `--no-package-lock`; others run plain `npm install`, so today the Browser dependency material is not guaranteed to be identical across all CI families.

## Primary-source findings

npm documentation:
- package-lock is intended to be committed and describes the exact generated dependency tree:
  https://docs.npmjs.com/files/package-lock.json/
- `npm ci` is the CI/deployment command for frozen installs:
  https://docs.npmjs.com/cli/commands/npm-ci/

npm documents these relevant `npm ci` properties:
- requires an existing package lock;
- fails if package.json and lockfile disagree;
- removes an existing node_modules first;
- never rewrites package.json or the lockfile.

GitHub setup-node documentation:
- dependency caching uses the lockfile hash as the cache key;
- the cache is the package-manager download cache, not `node_modules`;
- monorepo/subdirectory lockfiles should be supplied via `cache-dependency-path`.

References:
- https://github.com/actions/setup-node/blob/main/docs/advanced-usage.md
- https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching

## Required architecture

Frozen dependency input and observed installed dependency output must remain **separate evidence planes**.

### Declared/frozen input

New material:
- `apps/metaengine-browser/package-lock.json`
- exact byte SHA-256 of that lockfile
- npm major/version used to generate/consume it
- optionally project npm config if any tree-shaping flag is required

### Observed installed output

Keep the existing:
- normalized `npm ls --all --json`-derived dependency tree
- `dependency_resolution_sha256`
- concrete installed dependency count

The lockfile digest must **not replace** `dependency_resolution_sha256`.

The resulting build evidence should prove both:
1. the installer was built from an exact frozen dependency input;
2. npm actually installed the exact observed dependency tree.

## Rollout order

### Stage BI3-A1 — generate and qualify Browser lockfile

Generate with the same Node/npm family as the qualified Package Smoke environment:
- Node 24
- npm 11.x (qualified run used npm 11.19.0)

Expected lockfile format is lockfileVersion 3.

Before committing:
- verify `npm ci --no-audit --no-fund` succeeds from an empty node_modules;
- verify package.json/lock mismatch fails;
- verify the normalized installed dependency-resolution digest is stable across two clean installs on Windows runner;
- verify optional/platform dependencies do not create false failures.

No production package workflow change until this lockfile-only qualification passes.

### Stage BI3-A2 — bind lockfile to Build Identity successor

Extend Build Identity with:
- `package_lock_sha256`

Build Identity must fail if:
- lockfile missing;
- lockfile bytes drift after independent pre-build readback;
- packaged Build Identity does not contain the exact expected lockfile SHA;
- package-lock and package.json disagree.

Keep:
- repository id;
- source SHA;
- workflow/run/attempt;
- config SHA;
- dependency-resolution SHA;
- Node version;
- builder version.

### Stage BI3-A3 — Package Smoke uses npm ci

Only after A1/A2 tests are green:
- replace Package Smoke `npm install --no-package-lock` with `npm ci --no-audit --no-fund`;
- do not change one-producer reservation topology;
- compute lock SHA before dependency install;
- compute installed dependency-resolution SHA after `npm ci`;
- carry both into provenance and all physical consumers.

### Stage BI3-A4 — converge non-producer Browser CI

Convert all Browser CI consumers to the same `npm ci` contract.

Do this as a separate sweep so a Package Smoke qualification defect is not hidden inside mass CI churn.

Recommended sequence:
1. Shell + Critical Audit
2. Dirty Profile
3. Installed Chat / Final Runtime / Soak / Self Update
4. analysis/release/support workflows
5. old/rare Browser workflows after proving they are still active

## Caching policy

Caching is optional optimization, not part of dependency authority.

If enabled:
- use the pinned setup-node action already used by the repo; do not upgrade action versions as part of this slice;
- set `cache: npm`;
- set `cache-dependency-path: apps/metaengine-browser/package-lock.json`;
- never cache `node_modules`;
- lockfile + npm ci remain the authority even on cache hits.

A cache miss must only affect speed, not dependency identity.

## Tests required before physical packaging

Add source-level tests that prove:
- package-lock exists;
- package-lock name/version matches Browser package;
- lockfile SHA is valid and independently reproducible;
- package.json/lock mismatch is rejected;
- Build Identity includes lockfile SHA;
- lockfile SHA cannot be substituted by installed-tree SHA;
- Package Smoke performs `npm ci` after one-producer reservation and before Build Identity dependency output capture;
- downstream consumers verify the same lockfile SHA from provenance;
- no workflow silently falls back to `npm install` in the qualified physical chain.

Add a repository audit test that scans the required physical chain and fails if Browser dependency install regresses from `npm ci`.

## Risk: cross-platform optional dependencies

The lockfile can contain packages that npm conditionally installs by OS/CPU/optional rules. The installed-tree digest is intentionally concrete and platform-specific.

Therefore:
- hash the lockfile bytes as declared material;
- keep installed-tree digest as observed material;
- do not require every lockfile package to exist in the Windows installed tree;
- do not invent a custom dependency resolver.

If a later lockfile-to-installed-tree structural verifier is desired, it must model npm platform/optional semantics explicitly and get its own tests.

## Risk: npm CLI drift

Because npm can change lockfile handling across major versions:
- bind or record npm version in Build Identity/provenance;
- generate the first committed lockfile using the same npm major used in CI;
- do not silently regenerate the lockfile on a newer npm major during an unrelated feature branch.

A deliberate npm-major update should be treated as a toolchain-equivalence change with its own qualification.

## Interaction with one-physical-producer fence

PR #1092's package-version reservation remains earlier than any dependency install.

Required ordering after BI3:
1. exact source/version preflight;
2. immutable version reservation;
3. lockfile SHA readback;
4. `npm ci`;
5. installed dependency-resolution digest;
6. Build Identity;
7. electron-builder;
8. one candidate artifact;
9. downstream physical consumers.

A lockfile failure must happen before electron-builder and must not permit a blind rerun under the same consumed package identity once physical producer execution has begun.

## Recommended next implementation slice

After PR #1092 exact-head qualification completes:

1. create a dedicated branch from that qualified head;
2. generate `apps/metaengine-browser/package-lock.json` under Node 24/npm 11;
3. add lockfile-only determinism tests first;
4. run Shell/Critical Audit without physical package production;
5. only then advance package identity and wire Build Identity + Package Smoke to `npm ci`;
6. run the full one-built physical matrix.

Do not combine artifact attestation/SBOM with this slice. First freeze inputs; then add release-boundary provenance layers.
