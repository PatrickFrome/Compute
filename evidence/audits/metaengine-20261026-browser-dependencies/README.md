# Browser dependency audit remediation — 2026-10-26

**Source-only evidence; not Windows/Electron runtime qualification.**
Base: `19694ae244849dfa7ca3f8c79786867aa616af78`.
Worktree: `audit/browser-dependency-fixes`, isolated from the frozen integration.
Cross-cutting continuity/security maintenance; no roadmap milestone or release
qualification is advanced by these results.

## Result

Browser npm audit changes from **4 vulnerable package names (3 high, 1 moderate)**
to **0**. Exactly five dependency package records changed; no unrelated upgrade,
new direct dependency, override, lockfile-wide refresh, or product version bump.
The Browser product remains `0.7.0-dev.1107139874594.1`.

| Dependency | Before | After | Dependency path / compatibility |
|---|---|---|---|
| electron | 44.0.0 | 44.9.3 | Exact direct dev/runtime pin, same major |
| fast-uri | 3.1.8 | 3.1.9 | electron-builder → app-builder-lib → ajv (`^3.0.1`) |
| http-cache-semantics | 4.2.0 | 4.3.0 | electron-builder → app-builder-lib → @electron/get 3 → got → cacheable-request (`^4.0.0`) |
| undici | 6.29.0 | 6.29.1 | electron-builder → app-builder-lib → @electron/rebuild → node-gyp (`^6.25.0`) |
| undici | 7.30.0 | 7.30.1 | electron → @electron/get 5 (`^7.24.4`, optional) |

All updated transitive versions satisfy their existing parent ranges. Every lock
entry keeps its official npm registry URL and registry-supplied SHA-512 integrity.

## Upstream evidence and limits

- [Electron certificate advisory](https://github.com/advisories/GHSA-jr5w-w6x2-84p9)
  requires a runtime update; 44.9.3 also includes upstream Chromium-family fixes
  in its [release notes](https://github.com/electron/electron/releases/tag/v44.9.3).
- [fast-uri scheme advisory](https://github.com/advisories/GHSA-w74x-v6f9-j3xg)
  identifies 3.1.9 as the patched 3.x version. The other three fast-uri findings
  in the before-audit use the same patched boundary.
- [undici excessive content-encoding advisory](https://github.com/advisories/GHSA-xjj6-f33q-929c)
  and [6.29.1](https://github.com/nodejs/undici/releases/tag/v6.29.1) /
  [7.30.1](https://github.com/nodejs/undici/releases/tag/v7.30.1) release notes
  cover the patched versions and EventSource/SRI fixes.
- **Do not describe http-cache-semantics as a proven exploit fix.** Its
  [advisory](https://github.com/advisories/GHSA-ch52-4w7c-c8xp) currently flags
  versions through 4.2.0; 4.3.0 is outside that range. The maintainer
  [disputes the report](https://github.com/kornelski/http-cache-semantics/issues/56)
  and closed it as not planned. Local inspection confirms 4.3.0 can still honor
  max-stale on zero-age entries. It is a compatible unflagged update, not evidence
  that those semantics changed. This transitive package is development tooling;
  no production shared-cache exposure was established.

## Electron contract coherence

Updated package.json/package-lock, W78's exact tarball URL and SHA-512 pin,
qualified runtime resolver, both active Windows workflow version guards and their
unit fixtures. Package Smoke now rejects nonzero/noncanonical PE revisions just
as Live Mechanics does; accepted strings are only `44.9.3` / `44.9.3.0`.
Official installer ownership, override prohibitions, binary SHA-256 readback,
PE metadata checking, and non-authority receipts remain intact. Historical
convergence notes and unrelated synthetic old-version fixtures were not rewritten.

No `require('electron')` against the installed real package, Electron GUI launch,
binary download, install script, sandbox bypass, package build, publication,
workflow dispatch, deployment, or runtime qualification occurred. After testing,
`node_modules/electron/path.txt` and `dist` are absent. Source tests exercise
synthetic qualification fixtures, not a Windows executable.

## Verification

Host: Linux; Node `v24.22.1`, npm `11.9.0`. These are local-source results, not
substitutes for the workflows' pinned Windows toolchain.

- `npm install --package-lock-only --ignore-scripts --no-audit --no-fund --save-dev --save-exact electron@44.9.3`
- `npm update fast-uri http-cache-semantics undici --package-lock-only --ignore-scripts --no-audit --no-fund`
- `npm ci --ignore-scripts --no-audit --no-fund`: passed, 317 packages.
- `npm audit --json`: passed, zero findings; raw before/after attached.
- `npm ls --all --json`: exit 0; all four existing parent semver ranges checked.
- `npm run check --ignore-scripts`: **240 source checks passed**.
- `node scripts/package-lock-material.mjs --root . --out <evidence-file>`: passed;
  lock digest `6582a21be620b86025e8d6ad345a6bceb9809ef8d032782ecc6b52c78db07084`.
- Focused dependency, Windows contract, provenance, source identity, package-lock,
  build identity and SBOM suites: **111 passed, 0 failed, 0 skipped**.
- Explicit `node --check` on both modified Electron scripts and the new security
  test; `git diff --check`: passed.
- Safe negative controls read the old dependency tree without changing it. Old
  fast-uri decodes the encoded scheme; new fast-uri rejects resolution. Old
  undici 7 accepts bad uppercase SRI; new undici rejects it. Both old undici majors
  terminate on the local truncated excessive-encoding response; both new versions
  reject the response and exit normally. See `negative-controls.json`.

Focused command (run from `apps/metaengine-browser`):

```sh
node --test --test-concurrency=2 \
  test/browser-dependency-security.test.mjs \
  test/browser-windows-electron-materialization-contract.test.mjs \
  test/live-mechanics-native-probe-workflow.test.mjs \
  test/r97-electron-provisioning-w78.test.mjs \
  test/windows-capture-fixture-qualification.test.mjs \
  test/package-lock-material.test.mjs \
  test/installer-provenance-v3.test.mjs \
  test/client-windows-source-identity.test.mjs \
  test/local-build-identity.test.mjs test/build-identity.test.mjs \
  test/npm-sbom-evidence.test.mjs test/npm-sbom-package-smoke.test.mjs \
  test/composed-sbom-evidence.test.mjs
```

Not run: the full Browser suite (some tests can lazily materialize Electron),
Windows package smoke/PE readback, native GUI/IPC qualification and installed
runtime behavior. Those remain independent gates for this new runtime version.
