# Remove orphaned UI Prisma starter tooling — 2026-10-26

## Decision and ownership

This is a separate cleanup after `8c7a5a2710f10ed9620a8c97e0b9da057dad7ef5`
and its provenance correction `5dbb02a54ad4e5470bef4d17e4a3c9f0369bc3cd`.
Prisma is an unused starter dependency, not the client's own-PostgreSQL runtime.
Removing it avoids an incompatible upgrade solely to silence advisories.
Canonical contribution: **C2**, source/build hygiene; Level-2 scope: the assigned
UI orphan-dependency audit continuation. Evidence is source/local-test only;
no roadmap state, service, database, release or installed client was changed.

## Orphan proof

- Repository-wide tracked-reference inspection found only the UI's two Prisma
  dependencies, four `db:*` scripts, starter schema, pack-script cleanup and
  historical documentation. No CI, application, migration or packaging consumer
  invokes those commands or consumes that schema.
- TypeScript AST inspection covered **61 UI source/config/script modules and 156
  imports**. There are zero Prisma or `lib/db` imports. All five dynamic imports
  are literal: four UI pages and the watchdog; none loads arbitrary package names.
- The SQLite schema is the unused template `User`/`Post` model, not own-PG state.
  `coordination/client-v1/checkpoints/UI_1_WORKBENCH_HARDENING_2026-09-30.md`
  and `research/METAENGINE_CLIENT_UI_RESEARCH_2026-09-30.md` explicitly record
  removal of its sole unused `src/lib/db.ts` module after a Windows clean-build
  failure. No historical Git object was fetched for this proof.
- Independent review checked imports, CI and Windows package-smoke: they operate
  on `apps/me2-ui` and its app-local lockfile. The separate repository-root
  `bun.lock` has no root `package.json` and is legacy orphan data; it is unchanged.
  This cleanup and the advisory comparison apply only to **`apps/me2-ui`**.

## Removal and offline lock proof

Removed `prisma`, `@prisma/client`, `db:push`, `db:generate`, `db:migrate`,
`db:reset`, `prisma/schema.prisma`, and the packer's now-unnecessary deletion of
those scripts. No destructive database command was executed.

Local graph traversal included dependency, optional-dependency and installed
peer edges. Exactly **33 package records** were reachable only through the two
removed roots, including `deepmerge-ts`, `effect` and `defu`. They were pruned
without registry resolution. All **714 retained records** are byte-equivalent
as parsed records to their previous versions; all **70 remaining direct
dependency versions** are unchanged. All **1,500 required/optional edges** still
satisfy their parent ranges, and the workspace declarations match `package.json`.
`bun pm ls --all` accepted the resulting lock using its read-only local parser.

The 33 orphaned installed package directories were also removed from this
isolated worktree before testing, so stale installed Prisma cannot mask an
application import. `pg`, the UI's `src/lib/pg.ts`, Browser, daemon and
`infra/client-state-runtime` are unchanged.

The previous 04:30 UTC audit's two unresolved advisory packages are absent.
An offline comparison against all 37 entries in the exact 04:25 UTC baseline
also finds no retained affected versions. **No fresh registry audit was run**;
this is a cached-advisory applicability result, not a new zero-advisory audit.
The earlier refresh report remains an accurate historical snapshot.

## Verification and limits

- Typecheck: PASS (`tsc --noEmit --incremental false`).
- ESLint: PASS, no diagnostics.
- UI/security regression tests: **69 PASS**. The removed defu canary is replaced
  by a guard against reintroducing the orphaned Prisma scripts/schema/packages,
  while checking that the own-PG dependency remains.
- UI artifact content-integrity tests: **13 PASS**.
- Local lock parsing, graph/range/manifest checks: PASS.
- Fresh frozen installation: **not run**, while registry metadata permission is
  pending. No install/audit command or denied operation was retried.
- Production build: compilation, TypeScript and static rendering completed in
  the local log, but **terminal success is unverified**. Completion was blocked
  by Next 16.4.1's unexpected background npm advisory request. Installed source
  shows `experimental.agentUpgrade: 'security'` as its default and a background
  upgrade assessment during `next build`; telemetry disabling does not disable
  that separate network operation. The denied build was not resumed/retried.
  No new pack, runtime-smoke, Windows or installed-client success is claimed.

Raw proof is under `/workspace/shared/metaengine-ui-prisma-evidence/`, including
`import-inventory.json`, `removal-graph.json`, `offline-removal-proof.json`, the
local lock tree and exact test logs. A separately authorized offline-build
configuration can close the terminal build/pack verification gap without
transmitting registry metadata.

**Subsequent verified result:** the separate supported configuration change at
`0e661cb83c7a360ecfd1f99d1acf0a50c8b036a2` closed that build/pack gap. Its one
revised build, postbuild, pack and SHA/content verification all exited 0; the
packaged manifest has no Prisma dependencies or `db:*` scripts and retains `pg`.
See [the privacy change and final evidence](OFFLINE_BUILD_PRIVACY.md).
Fresh registry audit/installation and installed-runtime qualifications remain
outside this result.
