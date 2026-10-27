# UI dependency audit continuation — 2026-10-26

## Result and scope

`apps/me2-ui` audit: **16 affected packages / 37 advisory entries → 2 affected
packages / 2 high advisory entries**. Counts are registry audit entries, not
distinct CVEs. The remaining findings are disclosed below; this is not a clean
audit claim.

Isolated source baseline: `19694ae244849dfa7ca3f8c79786867aa616af78`.
Canonical contribution: **C2**, reproducible source → build/test → artifact;
Level-2 workstream: the assigned UI dependency-audit continuation. This report is
`EVIDENCE_READY` source/build evidence, not a roadmap-state promotion or installed
client qualification. No roadmap claim, database, service, release, app version,
credential or publication was changed.

## Compatible lock refresh

`package.json`, its direct dependency requirements and all resolved direct
dependency versions remain unchanged. There are no overrides. Only vulnerable
transitives and their required compatible children were refreshed:

| Package | Old affected version | New version |
| --- | --- | --- |
| `@babel/core` | 7.28.6 | 7.29.6 |
| `@humanfs/node` | 0.16.7 | 0.16.8 |
| `ajv` | 6.12.6 | 6.14.0 |
| `baseline-browser-mapping` | 2.9.15 | 2.11.33, deduplicated |
| `brace-expansion` | 1.1.12 | 1.1.21 |
| `browserslist` | 4.28.1 | 4.29.4 |
| `defu` | 6.1.4 | 6.1.7 |
| `flatted` | 3.3.3 | 3.4.4 |
| `js-yaml` | 4.1.1 | 4.3.2 |
| `minimatch` | 3.1.2 | 3.1.4 |
| `nanoid` | 3.3.11 | 3.3.20 |
| `picomatch` | 2.3.1 / 4.0.3 | 2.3.2 / 4.0.7 |
| `postcss` | 8.5.6 | 8.5.23, deduplicated |
| `source-map-js` | 1.2.1 | 1.2.2 |

The Babel 7, Ajv 6, minimatch 3, brace-expansion 1, js-yaml 4 and both Picomatch
major lines were preserved. PostCSS uses Next 16.4.1's existing exact 8.5.23 pin,
also valid under Tailwind's `^8.4.41` requirement. All **1,547 required/optional
dependency edges** in the resulting lock were checked against parent ranges.
The normalized diff changes 30 package records (including one new required
`@humanfs/types` child) and removes three duplicate records.

Bun 1.3.3's named-transitive update dry run attempted to introduce unrelated
latest-major direct dependencies; that route was rejected. Selected compatible
versions were resolved in a disposable manifest with lifecycle scripts disabled.
Their registry-produced records, plus only the children required by new ranges,
were transferred into the existing graph and normalized by Bun 1.3.3. A frozen
install verified the resulting lock and package integrity.

## Unresolved Prisma constraints

`prisma@6.19.2` requires `@prisma/config@6.19.2`, which pins:

- `deepmerge-ts@7.1.5`: [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx),
  fixed in 8.0.0. The advisory requires recursive object graphs; ordinary parsed
  JSON alone does not create them. A forced major override is not a compatible
  lock refresh.
- `effect@3.18.4`: [GHSA-38f7-945m-qr2g](https://github.com/advisories/GHSA-38f7-945m-qr2g),
  fixed in 3.20.0. The upstream exact pin excludes that version; no unvalidated
  override was introduced.

Both remain in the declared production dependency graph because Prisma is a
regular dependency. No UI source import of Prisma was found, and the inspected
Linux standalone build contains no Prisma, deepmerge-ts or Effect packages among
its 21 named/versioned package identities. That is evidence about this artifact,
not proof that the findings are universally unreachable. A parent-supported
Prisma update or separately reviewed removal/migration of its database tooling
remains necessary to remove the findings without violating its pins.

## Verification

Environment: Linux, Node 24.22.1, Bun 1.3.3. Commands below run in `apps/me2-ui`.

| Check | Result |
| --- | --- |
| `bun install --frozen-lockfile --ignore-scripts` | PASS; 635 packages installed |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` | PASS |
| `node node_modules/eslint/bin/eslint.js .` | PASS; no diagnostics |
| `node --test src/lib/*.test.mjs` | PASS; 65 tests |
| `node --test scripts/dependency-security.test.mjs` | PASS; 4 canaries |
| `next build` with telemetry disabled, then `node scripts/postbuild-standalone.mjs` | PASS |
| `node scripts/pack-me2-ui.mjs` | PASS; local standalone package |
| `bun audit --json` | 2 high entries above; expected nonzero exit |
| Parent-range/manifest compatibility check | PASS; 1,547 edges, direct manifest unchanged |

The new bounded subprocess canaries check negative inputs and normal operations
against installed libraries: defu prototype defaults, flatted forged prototype
references, nanoid non-secure negative/zero sizes, and oversized indexed source
map offsets. All four fail against the previous cached dependency versions and
pass with the final lock. The subprocess timeout and memory limit prevent a
regression from hanging or exhausting the test runner.

Upstream references for these canaries:
[defu](https://github.com/advisories/GHSA-737v-mqg7-c878),
[flatted](https://github.com/advisories/GHSA-rf6f-7fwh-wjgh),
[nanoid](https://github.com/advisories/GHSA-28wg-ghj8-5hjv),
[source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
The [Babel advisory](https://github.com/babel/babel/security/advisories/GHSA-4x5r-pxfx-6jf8)
also confirms the compatible 7.29.6 fix.

### Exact audit provenance

- The baseline actually read for this continuation was
  `/workspace/shared/metaengine-python-evidence/ui-dependency-audit-current.json`,
  the assigned 04:25 UTC snapshot (file modification time 04:25:30 UTC):
  11,942 bytes, SHA-256
  `9aa9fae9c7a6ea630b416e8228a8289a006278eeee51a57ae07d94200e9e4d2e`.
  The older `ui-dependency-audit-final.json` in that same directory is
  byte-identical, but was not substituted as this continuation's baseline.
- The after-result is
  `/workspace/shared/metaengine-ui-dependency-evidence/audit-after.json`,
  from `bun audit --json`, observed complete at 04:30:08 UTC, exit 1:
  SHA-256 `6016d50b93f7055b143b813e82f6f9ab35ee4cf7bc7340137cf08dafdc5901b4`.
  Its command, working directory, Bun version and stderr path are recorded in
  `audit-provenance.json` alongside it. No registry audit was repeated after
  the later metadata-transmission approval became pending.

Other local logs, graph proof and artifact package list are under
`/workspace/shared/metaengine-ui-dependency-evidence/`; the baseline audit JSON
is at the separate path above. These are local evidence, not published artifacts.
No install lifecycle scripts or Prisma generation,
migration, database reset or push command ran. No installed Windows, Electron,
native PostgreSQL, live-server or release verification is claimed.
