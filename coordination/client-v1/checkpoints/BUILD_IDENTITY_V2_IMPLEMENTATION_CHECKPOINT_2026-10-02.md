# Build Identity V2 implementation checkpoint — 2026-10-02

Implementation source before checkpoint: `d8e17c51155d67d54d778afa4fb79893a47a9360`  
Branch: `work/build-identity-v2-v1`  
Stacked base: `bf21d71b6dc674c376bd396487b5efc134d0a3e9` / PR #1090

No pull request exists for this branch at checkpoint time, so no Package Smoke physical build has been triggered and the inherited package version has not been consumed by this branch.

## Implemented

Build Identity V2:
- deterministic canonical `metaengine.browser.build-identity.v2`;
- exact repository + repository id;
- exact source SHA;
- Package Smoke workflow;
- GitHub run id + run attempt;
- package version;
- platform/arch;
- builder-config SHA-256;
- installed dependency-resolution SHA-256;
- electron-builder version;
- Node version;
- zero authority.

Dependency resolution:
- actual installed npm name/version tree is canonicalized;
- Node/npm versions included;
- proof schema `metaengine.browser.dependency-resolution.v1`;
- proof is tamper-evident;
- explicitly not claimed to freeze package bytes.

Packaging:
- independent expected identity computed before packaging;
- before-pack recomputes and injects `metaengineBuildIdentity`;
- after-all-artifact hook reads app.asar and verifies packaged identity;
- mismatched expected/before-pack/packaged identity fails closed.

Installer provenance:
- v1 remains readable for historical compatibility;
- Package Smoke now emits `metaengine.browser.installer-provenance.v2`;
- v2 binds build identity + dependency resolution to source/run/attempt/version/config/installer/blockmap;
- downstream consumers require v2 and reverify external identity/dependency proof before physical use;
- terminal producer proof carries Build Identity and dependency digest.

Tests:
- deterministic invocation identity;
- source/run/rerun/config/dependency drift;
- malformed digest/binding rejection;
- dependency proof tampering;
- installer provenance v2 write/verify roundtrip;
- external identity tamper;
- dependency-resolution tamper;
- qualified installer consumer v2 fixture;
- static Package Smoke / before-pack / after-artifact / consumer wiring.

## Editing incident closed before CI

During early workflow/PowerShell edits, JavaScript replacement text containing a regex end anchor followed by a quote (`$'`) was interpreted by `String.replace` as a special replacement token. That duplicated file suffixes.

Evidence that caught it:
- Package Smoke workflow expanded from ~698 to ~2476 lines;
- same build/upload blocks appeared 3-4 times;
- qualified installer consumer expanded from ~211 to ~987 lines.

Repair:
- reconstructed both files from exact qualified base `bf21d71…`;
- applied intended modifications with literal callback replacement;
- committed full-file Git tree replacement in `43b46af227c9943099f94572ea1cd3745bffa8cb`.

Post-repair:
- Package Smoke build step count = 1;
- candidate upload count = 1;
- evidence upload count = 1;
- consumer Acquire block = 1;
- consumer Verify block = 1;
- consumer binding block = 1.

No CI/package effect occurred while files were duplicated because the branch had no PR and no matching push trigger.

## Current source changes vs qualified base

Expected files only:
- `.github/workflows/browser-windows-package-smoke.yml`
- `apps/metaengine-browser/package.json` (check script only; version not yet advanced)
- `scripts/build-identity.cjs`
- `scripts/build-identity-cli.mjs`
- `scripts/dependency-resolution-digest.mjs`
- `scripts/electron-builder-before-pack.cjs`
- `scripts/electron-builder-after-all-artifact-build.cjs`
- `scripts/installer-provenance.mjs`
- `scripts/qualified-installer-consumer.ps1`
- `test/build-identity.test.mjs`
- `test/installer-provenance-v2.test.mjs`
- `test/qualified-installer-consumer-verify.ps1`
- research/checkpoint documents.

## Research decisions

Primary sources:
- GitHub Actions variable reference for repository/run/attempt identity;
- electron-builder v26 hooks and extraMetadata;
- SLSA provenance buildDefinition/runDetails separation;
- npm package-lock + npm ci frozen-install semantics;
- actions/upload-artifact immutable v4 artifacts and artifact digests;
- GitHub artifact attestations.

Adopted now:
- deterministic invocation identity;
- source-scoped immutable candidate remains the single physical carrier;
- dependency-resolution evidence from actual install;
- v2 provenance verification in all physical consumers.

Deferred:
- committed Browser lockfile + npm ci;
- dependency integrity/byte-level reproducibility;
- GitHub artifact attestation at release boundary;
- any automatic semantic-version allocator.

## Remaining pre-PR gates

1. Perform final source audit for syntax/schema/wiring drift.
2. Ensure no existing downstream workflow requires v1-only provenance.
3. Freeze source.
4. Re-read current GitHub workflow ids.
5. Reserve one fresh package version higher than observed physical build sequence.
6. Update `CONVERGENCE_CANDIDATE.md` and machine checkpoint in the same final commit.
7. Open stacked draft PR against `work/guardian-status-semantic-hardening-v1`.
8. After Package Smoke begins, treat that package identity as consumed.
9. Require exact-head Browser tests, Package Smoke, Installed Chat, Runtime, Soak and Self Update to all pass on one producer artifact.

## Future hardening boundary

The current dependency digest proves which name/version tree npm actually installed. It does not include registry tarball integrity. Before making reproducibility claims, add a reviewed lockfile with integrity data and use `npm ci`.

GitHub attestations should be added only at release-candidate/published-release boundary, not used as a substitute for physical Windows qualification or installer SHA-256.

Promotion authority remains false.
