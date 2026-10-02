# Browser package-lock materialization checkpoint — 2026-10-02

Branch: `work/build-lockfile-material-v1`  
Base qualified one-producer source: `8409fb249887dd4636b3bd6fab40bfe30fa4b085`  
Current branch head after one-shot materializer removal: `6a667a2f01686ac7eacb550d5fb86599367fd5be`  
Reserved successor package identity: `0.7.0-dev.36980000001.1`

This checkpoint is branch-local development evidence. No Package Smoke producer has started for this successor identity, so the version remains reserved but not physically consumed.

## New frozen dependency material

Committed:
`apps/metaengine-browser/package-lock.json`

Generated under the exact lockfile toolchain:
- Node: `v24.21.0`
- npm: `11.19.0`
- lockfileVersion: **3**

Lockfile material proof:
- schema: `metaengine.browser.package-lock-material.v1`
- package: `@metaengine/browser-shell`
- version: `0.7.0-dev.36980000001.1`
- lockfile SHA-256: `9d398b577fbfe1ec6bce39550b69b467491dee44e08c9a253dd3e4f8427dfd69`
- lockfile bytes: **19170**
- direct runtime dependencies: **2**
- direct dev dependencies: **3**
- lockfile package entries: **43**
- entries with integrity: **43**
- entries with resolved source: **43**
- optional entries: **1**
- authority effect: false

The lockfile root name/version and every direct dependency/devDependency spec are verified against package.json before the material proof is emitted.

## Clean frozen install proof

One-shot workflow:
- `Browser Lockfile Materialize V1`
- run id: `36977511250`
- conclusion: **SUCCESS**

The workflow:
1. pinned Node 24.21.0;
2. required npm 11.19.0;
3. generated the lock using `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`;
4. validated the exact lock bytes;
5. removed node_modules;
6. ran `npm ci --ignore-scripts --no-audit --no-fund`;
7. recomputed the installed dependency-resolution proof;
8. ran package-lock material tests;
9. committed only package-lock.json.

Clean `npm ci` installed-tree proof:
- dependency count: **55**
- dependency-resolution SHA-256: `e8d6611559e74091c9b9e8c2d54fd98bc456f1748c7709a5432978439a830036`

Lockfile tests:
- **10/10 PASS**
- 0 fail
- 0 skipped

Generated lockfile commit:
`d6964416de8b3413b4f90fb7ad4c3a1db1b8b6d8`

The temporary contents-write materializer workflow was then removed. It is not intended as permanent build authority.

## Added source verifier

New:
`apps/metaengine-browser/scripts/package-lock-material.mjs`

It:
- hashes exact lockfile bytes;
- rejects missing/invalid lockfile;
- accepts lockfileVersion 2 or 3 only;
- binds top-level and root package name/version;
- compares dependencies/devDependencies/optionalDependencies/peerDependencies against package.json;
- records integrity/resolved/optional/platform metadata counts;
- uses a Windows-safe npm version probe through cmd.exe;
- emits zero-authority evidence only.

Tests:
`apps/metaengine-browser/test/package-lock-material.test.mjs`

The package check script also syntax-checks the new verifier.

## Important distinction

The committed lockfile is the **declared frozen dependency input**.

The existing `dependency_resolution_sha256` remains the **observed installed dependency output**.

They must stay independent:
- package-lock SHA proves what npm was instructed to install;
- dependency-resolution SHA proves what was actually installed.

The next Build Identity successor must include both digests.

## Remaining work before physical qualification

1. Extend Build Identity successor with:
   - package_lock_sha256
   - npm_version
2. Independent pre-build readback must verify exact lockfile SHA.
3. electron-builder beforePack must receive and package the same identity.
4. installer-provenance successor must carry lockfile SHA.
5. qualified installer consumer must reverify it.
6. Package Smoke must switch from `npm install --no-package-lock` to full `npm ci --no-audit --no-fund`.
7. Physical downstream workflows must converge to npm ci.
8. Only after source tests pass should the branch open a PR and consume `0.7.0-dev.36980000001.1`.

No release/promotion/live-install authority is introduced.
