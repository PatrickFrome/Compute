# Guardian first run source patch and verification

First Owner enrollment and ORIGINAL Main remain HOLD. This patch fixes two independently actionable source defects: Guardian status could initialize a device identity, and a published fresh Owner could restart the Host after an interrupted terminal journal write.

## Verified source and patch

- Source transfer: public commit `accb28e72c87c059e780efb8e6681886b33e9b4f`, [ordered archive parts](https://github.com/PatrickFrome/Compute/tree/accb28e72c87c059e780efb8e6681886b33e9b4f/coordination/source-transfer/c26565e).
- Original source revision: `c26565e58ab92dcbcda9663c4d231bdf4a9a7ee6`.
- Joined archive SHA256: `4200e492828dbb857aaa737a7ce56d0aeda3c97c84f7743b1501ef2f229d3636`.
- Verified base tree: `2dbe253e97379532f6f4b52ef7edf26109a9266d`.
- Incremental patch: [guardian-first-run-enrollment-c26565e.patch](guardian-first-run-enrollment-c26565e.patch).
- Patch SHA256: `e4579a569bb338d638c26a8486850427b8fca95934f4cc29e5e272a7870e026d`.
- Result tree: `2e00ee9976fcc939ee3021bf2cde31eccbb50f08`.
- Reconstructed local verification commit: `f0bbb447b6dfd9d4cae05dac2b6572c302f54e0d`. This is not original Git history.

Apply from the root of the clean extracted `Compute/` tree. Earlier e6-to-c265 patches are already included in the source archive.

```sh
git apply --check /path/to/guardian-first-run-enrollment-c26565e.patch
git apply --index /path/to/guardian-first-run-enrollment-c26565e.patch
git write-tree
```

A separate clean base checkout passed both apply commands and produced the exact result tree above. [Applicability evidence](patch-apply-evidence.json) and [machine-readable results](result.json) retain the hashes and commands.

## Changes

1. Main's cached status reads use the existing loaded-only signer and fixed read pipe. The observer holds one original source read and its original generation across diagnostic timeout. Forced refresh cannot reopen or reinterpret the old read; quiesce waits for actual source settlement.
2. Fresh-provider restart admission checks the original descriptor's reserved path claims and an exact terminal journal before Host startup. Pending, unknown, missing, damaged or aliased evidence remains blocked without repair or retry. Attached and upgrade profiles keep their existing admission paths. Current runtime and health checks remain mandatory after the veto clears.
3. The source-check inventory covers the new fence and status observer. Regressions cover physical journal read, post-publication terminal-write failure, raw path normalization, unrelated parent names, timeout/invalidation races and Main wiring.

## Final validation

All final commands ran against the clean frozen source commit and result tree above. No source changes followed.

| Check | Result |
| --- | --- |
| Selected JS and portable native contract suites | 102 PASS, 0 FAIL, 0 SKIP |
| Source checks | 294 PASS |
| Native BEGIN, normal and ASAN/UBSAN | 9 PASS each |
| Native Owner wait, normal and ASAN/UBSAN | 13 PASS each |
| Native requester session, normal and ASAN/UBSAN | 15 PASS each |
| Original Main launch source | 81 PASS, 1 FAIL |
| Aggregate original Main source | 23 PASS, 0 FAIL, 5 NOT RUN |
| Clean-base patch application and resulting tree | PASS |

The unchanged launch failure is `wire_route_authenticates_then_launches`. The genuine sender composition is missing and the route intentionally remains HOLD; this patch does not change that test or route.

The aggregate NOT RUN checks are `w77-pinned-openssl-regression`, `w77-boringssl-regression`, `electron-source-interface`, `official-electron-header-syntax` and `win64-cross-builds`: their optional exact source/build inputs or compiler were not supplied. Its nested Node suite also skips actual Windows pipe/process mechanics. Windows execution, full custom Electron build, production launch grant, production release/W77 positive evidence and LeakSanitizer remain NOT RUN.

Exact logs, command lines, exit codes and hashes are under [evidence](evidence).

## Remaining authority blockers

The existing original install-origin/W77 Genesis authorizes policy publication only. There is no independently authenticated pre-Main first-Owner setup scope binding packaged Electron identity and a continuous singleton handoff. The native Guardian-to-owned-Host installed-code bridge is also absent. Own PostgreSQL `DB_TICKET_CONSUMED` explicitly keeps `guardian_ready:false` and `native_bridge_authenticated:false`; it cannot supply native Owner acceptance.

[Authority review](authority-review.md) identifies the actual existing producers and minimum missing joins. First installation and upgrade are not qualified. Upgrade must preserve existing Owner/device/PGDATA and use its original upgrade authority; fresh Genesis refuses existing roots.

No installer, real Browser/Guardian, production database or service was started. No production credentials, new trust roots, security weakening or merge were introduced. Existing signing tests used only isolated temporary fixture keys which are absent from these deliverables.

