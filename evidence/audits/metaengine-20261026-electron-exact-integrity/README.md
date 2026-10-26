# Qualified Electron exact-integrity hardening — 2026-10-26

Base: `9d0939589f85e1abd3fbc6d5ff5b23a8a2f7979f`.
Scope: isolated source-only follow-up to the Browser dependency review; no
milestone, release or installed-runtime qualification is advanced.

## Finding and change

`qualified-electron-runtime.mjs` previously checked that the locked integrity was
SHA-512-shaped, but did not compare it to the reviewed Electron tarball integrity.
A different valid-looking SHA-512 could pass that gate and reach the package
resolver, unlike the stricter existing W78 qualification.

The resolver now imports W78's frozen `PIN` and compares exact version, official
registry URL and integrity before invoking package code. There is one shared pin,
not an additional independently maintained digest. W78, the dependency manifest,
lockfile and workflows are unchanged in this follow-up.

Synthetic qualification fixtures now carry the exact pin. Two adversarial cases
substitute a different well-formed 64-byte SHA-512 value and require the precise
locked-version rejection before a resolver marker can be written, for both
`materialize=false` and `materialize=true`.

## Validation

- Before the resolver change, both new tests fail: the nonmaterializing path
  reaches its missing-binary check and the materializing path accepts the
  substitution. See `regression-before.log` (expected negative-control failures).
- After the fix, the same 13 focused files listed in the preceding dependency
  audit evidence pass **113 tests, 0 failed, 0 skipped**. The valid exact pin,
  source-override prohibitions, path confinement, workflow contracts and W78
  integrity checks remain covered. See `focused-tests.log`.
- `node scripts/check-source.mjs`: **240 source checks passed**.
- Explicit `node --check` on the changed script/test and `git diff --check`: pass.
- Real Electron `path.txt` and `dist` remain absent. No real Electron resolver,
  installer script, GUI, Windows binary or packaging operation was executed.
- Frozen integration stays clean at `19694ae244849dfa7ca3f8c79786867aa616af78`.

All checks here are local. No npm/bun audit request, dependency inventory
transmission, public metadata request, publication or deployment was made.
The separate external-audit authorization remains pending; this report does not
claim a newly rerun network audit or Windows runtime qualification.
