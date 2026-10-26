# Stream 4: bounded dependency applicability review

Source reviewed: `9d7527683060e314eb1d39fec9ce2304a57103c4` (the immutable anchor from #1354).
Review date: 2026-10-27 (Europe/Moscow).
This is source/lock applicability evidence, not a fresh bulk audit or a packaged-runtime acceptance result.

## Evidence and limits

The exact input is `apps/me2-ui/bun.lock`, Git blob `c51f89848075baca6701fcd65e2b572573ff9611`, SHA-256 `a679ce0049ba42eb9513c58407a546b01028e723d7e7159e59356c6d6e94a31d`.
`apps/me2-ui/package.json` SHA-256 is `050c5ce374ea51b9e6d521197aedda794e53ab086bd808fe9e12e7675442af70`.
Both workspace root maps match the manifest: 61 production declarations, 9 development declarations, 714 resolved package records. Major pinned components include Next 16.4.1, React/ReactDOM 19.2.3 and pg 8.23.0.

### Local graph algorithm

Parse the text lock as JSON after removing trailing commas, without running package code. Start separate breadth-first traversals at `workspaces[""].dependencies` and `devDependencies`. For each visited record, follow its `dependencies`, `optionalDependencies`, and peer dependencies that resolve to records in this lock. Resolve a dependency name first beneath the issuer's nested lock key, then each enclosing package key, then the root key. A scoped `@scope/name` is one package segment when walking toward the root; never invent a parent package at `@scope`. Preserve one shortest path for each record and separately report any unresolved edge.

The result is 339 production-declared reachable records, 395 development-declared reachable records, and 714 in their union (20 overlap). All unresolved edges are 11 explicitly optional peers; there are no unresolved required or optional-dependency edges. Platform-specific optional packages are deliberately retained in this graph, so these counts are not an installed-platform payload count. Machine-readable paths and limits are in the [dependency graph evidence](evidence/preinstall-20261027/dependency-applicability-graph.json).

A separate local semver 7.8.5 check validates the 70 root declarations, 1,390 required dependency edges, 110 optional dependency edges, and the 312 peer edges whose targets exist. There are zero missing required targets or observed numeric range violations. The peer expression `tailwindcss-animate → tailwindcss >=3.0.0 || insiders` contains a non-semver dist-tag alternative; `tailwindcss@4.1.18` satisfies its independent numeric `>=3.0.0` alternative. This is explicitly recorded rather than treating the entire expression as a valid semver range. See [range evidence](evidence/preinstall-20261027/dependency-applicability-ranges.json). These graph/range checks do not execute package code, prove package integrity, or establish final standalone reachability.

The seven GHSA identifiers explicitly linked by `docs/audits/metaengine-20261026/UI_DEPENDENCY_REFRESH.md` were fetched individually from GitHub advisories, with upstream maintainer advisories or fixes checked. Additional published advisories were checked for the exact package families named in that report. No dependency graph was sent to an audit endpoint. No audit, install, dependency update or application execution was performed by this reviewer.

The old 37-entry registry response is **not present in the checkout**: the historical report supplies a private local pathname and hash, not the underlying JSON. This review therefore must not be labelled an independent replay of all 37 entries, a complete new vulnerability scan, or a zero-advisory guarantee. The separate repository-root `bun.lock` is outside this application's graph and was not substituted.

## Actual blocker / closed / not applicable / maintenance debt

| Classification | Observation | Consequence |
| --- | --- | --- |
| Actual blocker, dependency-specific | None established by this bounded review | No dependency change is justified by the reviewed evidence. This does not establish absence of other vulnerabilities. |
| Actual qualification blocker | Exact integrated-source installer and its packaged inventory have not been supplied to this reviewer | Production graph presence and prior Linux standalone results cannot qualify a new installed Windows runtime. |
| Closed by already-present source | Versions in the matrix below meet the cited fixes | Preserve compatible pins; do not repeat mass updates. |
| Not applicable to this graph | Prisma, `@prisma/client`, `@prisma/config`, `deepmerge-ts`, `effect`, `defu` have zero package records | The two historically unresolved Prisma descendants do not remain current UI findings. Own-PG `pg` remains present and imported. |
| Maintenance debt / unsupported runtime path | Manifest `start` and explicit `ME2_UI_BIN=bun` retain the previously demonstrated Bun/Next wrapper incompatibility | Do not classify that path as the default packaged Node failure. It remains an explicit path limitation, unless separately repaired and verified. |
| Maintenance debt / evidence limit | Historical 37-entry source JSON unavailable; deprecated-package warnings alone identify no exploit path | Retain the limit explicitly; do not infer a security blocker solely from `npm WARN deprecated`. |

## Advisory matrix

“Build/lint” means reachable from `devDependencies` by dependency/optional/already-present peer edges. “Production-declared” means reachable from declared production roots; this is deliberately broader than the traced standalone payload. No newly built artifact is assumed.

| Package and exact current pin | Graph path / applicability | Advisory and fixed version | Assessment |
| --- | --- | --- | --- |
| `deepmerge-ts`: absent | Former `prisma → @prisma/config → deepmerge-ts` path removed | [GHSA-ggr8-5vv4-36mx](https://github.com/RebeccaStevens/deepmerge-ts/security/advisories/GHSA-ggr8-5vv4-36mx), fixed 8.0.0 | Not applicable to current UI graph. Advisory requires recursive object graphs; ordinary JSON alone does not establish the trigger. |
| `effect`: absent | Former Prisma-config descendant removed | [GHSA-38f7-945m-qr2g](https://github.com/Effect-TS/effect/security/advisories/GHSA-38f7-945m-qr2g), fixed 3.20.0 | Not applicable to current UI graph. Historical issue concerns cross-request AsyncLocalStorage context under concurrent Effect scheduling. |
| `defu`: absent | Removed with orphaned Prisma chain | [GHSA-737v-mqg7-c878](https://github.com/unjs/defu/security/advisories/GHSA-737v-mqg7-c878), affected through 6.1.4, fixed 6.1.5 | Not applicable to current UI graph. |
| `@babel/core@7.29.6` | Build/lint: `eslint-config-next → eslint-plugin-react-hooks → @babel/core` | [GHSA-4x5r-pxfx-6jf8](https://github.com/babel/babel/security/advisories/GHSA-4x5r-pxfx-6jf8), fixed 7.29.6 | Closed by existing pin. Source-map disclosure needs attacker-controlled compilation input plus output access. |
| `flatted@3.4.4` | Build/lint: `eslint → file-entry-cache → flat-cache → flatted` | [GHSA-rf6f-7fwh-wjgh](https://github.com/WebReflection/flatted/security/advisories/GHSA-rf6f-7fwh-wjgh), affected through 3.4.1, fixed 3.4.2 | Closed by existing pin. The application already carries a bounded forged-reference canary. |
| `nanoid@3.3.20` | Production-declared: `next → postcss → nanoid`; build: `@tailwindcss/postcss → postcss → nanoid` | [GHSA-28wg-ghj8-5hjv](https://github.com/advisories/GHSA-28wg-ghj8-5hjv), fixed 3.3.16 on this major; [upstream fix](https://github.com/ai/nanoid/commit/e835c9b71eab832bc6106944bdd26ea96cf2c66d) | Closed by existing pin. A negative-size non-secure-generator canary already exists. Do not call this dev-only simply because typical use is CSS tooling. |
| `source-map-js@1.2.2` | Production-declared: `next → postcss → source-map-js`; build: `@tailwindcss/postcss → @tailwindcss/node → source-map-js` | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), fixed 1.2.2; [upstream release](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2) | Closed by existing pin. Oversized indexed-map offset canary already exists. |
| `@humanfs/node@0.16.8` | Build/lint: `eslint → @humanfs/node` | [GHSA-p498-v437-472g](https://github.com/advisories/GHSA-p498-v437-472g), fixed 0.16.8 | Closed for cited symlink-following file-copy issue. |
| `ajv@6.14.0` | Build/lint: `eslint → ajv` | [GHSA-2g4f-4pwh-qvx6](https://github.com/advisories/GHSA-2g4f-4pwh-qvx6), fixed 6.14.0 on Ajv 6 | Closed for cited `$data`-enabled regex issue. No forced major override needed. |
| `minimatch@3.1.4`, nested `minimatch@10.2.6` | Build/lint: ESLint and TypeScript-ESLint | [GHSA-23c5-xmqv-rm74](https://github.com/isaacs/minimatch/security/advisories/GHSA-23c5-xmqv-rm74), fixed 3.1.4 / 10.2.3 | Both pins are outside cited nested-extglob affected ranges. |
| `brace-expansion@1.1.21`, nested `brace-expansion@5.0.12` | Build/lint: minimatch descendants | [GHSA-q2hr-2g5m-vwhr](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-q2hr-2g5m-vwhr), fixed 1.1.21 / 5.0.12 | Both pins meet cited quadratic-rewrite fixes. |
| `js-yaml@4.3.2` | Build/lint: `eslint → @eslint/eslintrc → js-yaml` | [GHSA-h67p-54hq-rp68](https://github.com/nodeca/js-yaml/security/advisories/GHSA-h67p-54hq-rp68), fixed 4.2.0; [GHSA-2883-xcg3-v3hh](https://github.com/nodeca/js-yaml/security/advisories/GHSA-2883-xcg3-v3hh), fixed 4.3.2 | Current pin meets both cited repeated-alias / empty-merge-source fixes. |
| `picomatch@4.0.7`, nested `picomatch@2.3.2` | 4.x production-declared via `next-intl → @parcel/watcher`; also build via TypeScript resolver. 2.x build/lint via fast-glob/micromatch | [GHSA-c2c7-rcm5-vvqj](https://github.com/micromatch/picomatch/security/advisories/GHSA-c2c7-rcm5-vvqj), [GHSA-3v7f-55p6-f55p](https://github.com/micromatch/picomatch/security/advisories/GHSA-3v7f-55p6-f55p), fixed 4.0.4 / 2.3.2 | Both extglob ReDoS and POSIX-class method-injection advisories are closed for these pins. No 3.x copy exists in this lock. |
| `postcss@8.5.23` | Production-declared through Next; build through Tailwind | [GHSA-fxqj-rqcc-2cmp](https://github.com/postcss/postcss/security/advisories/GHSA-fxqj-rqcc-2cmp), fixed 8.5.23 | Existing pin closes cited source-map path-read residual. Presence in a declared runtime graph is not proof an attacker can submit CSS to it. |
| `baseline-browser-mapping@2.11.33` | Production-declared through Next; build via Babel/browserslist | [GHSA-w5vr-8v7q-w6rv](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv), fixed 2.11.0; [upstream release](https://github.com/web-platform-dx/baseline-browser-mapping/releases/tag/v2.11.0) | Existing pin closes cited process termination on invalid input. |
| `browserslist@4.29.4` | Build/lint via Babel helper-compilation-targets; requires `baseline-browser-mapping ^2.11.29` | Historical refresh includes required compatible children | No separate unresolved browserslist advisory was established by this review; its dependency now satisfies the baseline-browser-mapping fix above. |

## Runtime and privacy distinction

Current `apps/me2-ui/next.config.ts` explicitly sets `experimental.agentUpgrade: false`, `experimental.isrFlushToDisk: false`, and `cacheMaxMemorySize: 50 * 1024 * 1024`. Existing `offline-build-config.test.mjs` loads the effective config and instruments `fetch` while exercising Next's assessment/nudge functions; existing `runtime-cache-config.test.mjs` exercises the installed cache implementations. Their existence and source are confirmed here; their execution belongs to the root agent's verification record.

`apps/metaengine-browser/src/me2/me2-ui-host.mjs` selects `process.execPath`/embedded Electron-as-Node with `ELECTRON_RUN_AS_NODE=1`, `NODE_ENV=production`, loopback hostname, and direct `server.js` when a production standalone directory exists and `ME2_UI_BIN` is absent. The host does not attempt Bun first in that branch. By contrast, `apps/me2-ui/package.json` and the packer's explicit override script still say Bun. The historical report documents a Bun 1.3.3/Next 16.4.1 CommonJS-wrapper failure under both default build and webpack diagnostic build. No new Bun-runtime test or Bun update has been performed by this reviewer.

No dependency source repair is recommended from this review. Preserve the current pins and run the existing functional dependency/config tests when exact installed dependencies are available. The central producer's final inventory must still establish which libraries and versions are actually shipped, plus after-exit immutability and source/artifact identity.
