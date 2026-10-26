# UI runtime immutability repair

## Finding and repair

The package built from `3f31d18b447b43674816aa2fd7408c6ce782cf92`
passed its first Node HTTP smoke but failed its next strict content verification.
Next 16.4.1 promoted the prerender seed into six new files under
`.next/server/route-cache/APP_PAGE/`. The original 1,254 files remained present
and byte-identical; this was an **addition**, not deletion or corruption.

Installed Next source establishes the cause and supported control:

- `server/lib/incremental-cache/file-system-cache.js`: seed promotion and cache
  writes return before filesystem writes when `flushToDisk` is false. In-memory
  cache updates remain available, and immutable build seeds remain readable.
- `server/next-server.js` passes `experimental.isrFlushToDisk` to that cache.
- `server/image-optimizer.js`: disk-LRU initialization, reads and writes are also
  guarded by `experimental.isrFlushToDisk`.

The application now explicitly sets `experimental.isrFlushToDisk: false` and
keeps the existing default 50 MiB incremental-cache memory bound explicit.
Mutable cache state is process-local, not executable package content. No new
persistent authority, custom cache store, inventory exclusion, or runtime
manifest resealing is introduced. The already-reviewed `agentUpgrade: false`
privacy/reproducibility setting remains unchanged.

The package smoke now verifies expected source identity before launch, pins the
original manifest bytes and digest, waits for its owned child to close (with a
bounded SIGKILL fallback), and compares the complete post-exit inventory against
that same original manifest. It rejects additions, deletions, same-size changes,
and a rewritten manifest that attempts to bless changed content. The child uses
the browser host's `ME2_HOSTED_BY_BROWSER=1` / `ME2_WATCHDOG=off` environment, so a
disposable smoke cannot start the standalone daemon watchdog.

## Local verification and provenance

Worktree: `/workspace/shared/metaengine-ui-runtime-cache`, isolated from the
frozen integration. Dependencies were copied from the already-installed local
UI dependency worktree; no installer, registry audit, or download was run.

Development-snapshot evidence lives in
`/workspace/shared/metaengine-ui-runtime-evidence/`:

- `baseline-mutation.json`: reproduction of six additions with zero original
  files missing or changed.
- `ui-tests.txt`: 71 UI tests pass; `typecheck.txt` and `lint.txt` pass.
- `browser-focused-tests.txt`: 23 host/content/runtime-integrity tests pass.
- `runtime-matrix.json`: repeated real Node 24.22.1 launches preserve exact
  manifest and inventory; repeated launches also pass after removing write
  permissions from the owned package tree. An explicit write probe fails with
  `EACCES`, so the read-only case is not merely nominal.
- The cache-config regression executes the installed Next cache implementations:
  fetch data round-trips in bounded memory, seed promotion makes no writes, and
  image cache operations leave the temporary directory empty.

These precommit generated artifacts identify the base SHA, not the uncommitted
source snapshot; **they are development evidence, not exact-source package
qualification**. Separate exact-commit evidence is recorded below.

Independent review evidence is in
`/workspace/shared/metaengine-ui-runtime-review-evidence/`. The reviewer approved
the scoped source change and independently passed 20 focused tests, shutdown
mutation/manifest-forgery/forced-kill fixtures, repeated Node HTTP/RSC/static/404
requests, and successful image optimization on a separately sealed synthetic
PNG fixture. Complete file/directory/mode snapshots remained unchanged. That
synthetic fixture is not represented as the actual release package.

## Separate unresolved runtime compatibility finding

The locally available, CI-pinned Bun 1.3.3 starts the server but cannot render the
Next 16.4.1 app-page runtime: `Expected CommonJS module to have a function wrapper`.
Actor and independent reviewer both reproduce the failure. A supported
`next build --webpack` diagnostic build passes under Node but fails under Bun
with the same error (`webpack-probe-runtime.json`); it is **not** established as
a Turbopack-only failure. No ineffective bundler or dependency changes were made.

The normal packaged browser host directly launches standalone `server.js` using
its embedded Node/Electron runtime whenever production standalone is selected
and `ME2_UI_BIN` is absent; it does not first try Bun. Explicit overrides are
preserved, not silently replaced. The explicit Bun override and Bun-based package
start script remain affected. CI's Bun 1.3.3 build-tool pin and `bun run build`
script invocation are distinct from using Bun to execute the production server.
The immutability repair is not a claim of production completeness for that Bun
runtime path. No new Bun download/upgrade has been authorized or tested here.

## Exact committed-source qualification

Repair commit: `9233241d3cd4240e1e47f2466f701fd64089c1c1`. From a clean tracked
tree, `.next` was removed and the default production build, postbuild and pack
were run with `ME2_BUILD_SHA` set to this commit. No Webpack probe output was reused.

- Build ID: `08JptTgspP-MKleCfYLMO`; files: 1,254; content bytes: 56,862,881.
- Manifest SHA-256:
  `076bd72ced5eb114cab0472772634e82de4fedbc8148eb5f247d7b66d20851e6`.
- Content SHA-256:
  `603d90a090ea79fbbc41f6f95c4def4661f8a9021a46f13db333dc410cf01f9e`.
- Actor receipts: `exact-9233241d-build.txt`, `exact-9233241d-pack.txt`, and
  `exact-9233241d-runtime-matrix.json` in the actor evidence directory above.
  Node 24.22.1 passes two writable and two read-only launches. The read-only write
  probe returns `EACCES`. Every post-exit check preserves original manifest bytes,
  strict inventory, and directory/file modes. Modes are restored afterward.
- Bun 1.3.3 is attempted twice at this exact source and fails rendering with the
  known wrapper error; inventory remains unchanged even after each failed probe.
- Independent reviewer copies this exact artifact and passes two Node smoke and
  two HTTP/RSC matrix launches with the full tree unchanged. Separate independent
  Bun attempts also fail twice without mutation. Receipts:
  `actual-package-review-Node.json` and `exact-9233241-bun-review.json` in the review
  evidence directory above. All four reviewed source hashes match the commit.

This qualifies the standalone Node launch mechanism locally, not an installed
Electron binary or Windows package. Subsequent comment/report-only changes do
not relabel these artifact receipts as another source SHA; final integration
requires its own build and expected-source verification.

All runtime evidence above is Linux-local. Installed Windows behavior, Windows
TCP ownership verification, and release-package qualification remain unproven.
