# METAENGINE e30 data-preservation audit — exact execution results

**Date:** 2026-11-05. **Status:** 48 PASS / 0 FAIL / 0 SKIP (**portable source/fixture only**). **Installation:** HOLD.

## Archive/tree verification

| Operation | Observed result |
|---|---|
| Official Library materialization | `libfile_67e248dedc1081918003c1514194a6f7`, 16,336,912 ZIP bytes |
| `sha256sum METAENGINE-e30-github-only-source.zip` | `169f4dc6379605d68d34360c9d28d687b4da3dc856aea6fc1fb27e6bc6d3ba06` — MATCH |
| Git object hash reconstructed directly from ZIP member bytes | `90fa5633d7926dd71a7303266073e0625325e740` — MATCH |
| `git write-tree` after preserving original ZIP executable bits | `90fa5633d7926dd71a7303266073e0625325e740` — MATCH |
| File mode count | 4,272 `100644`; 74 `100755`; total 4,346 regular files |
| Test-only patch `git apply --cached --check` on exact e30 baseline | PASS |

## Real tests run against exact e30 production source

One combined command from the extracted `Compute` root:

```bash
node --test --test-concurrency=1 --test-reporter=tap \
  apps/metaengine-browser/test/self-update-transaction-cas.generated.test.mjs \
  apps/metaengine-browser/test/self-update-transaction-journal.test.mjs \
  apps/metaengine-browser/test/self-update-install-effect-barrier.test.mjs \
  apps/metaengine-browser/test/self-update-transaction-fail-closed.test.mjs \
  apps/metaengine-browser/test/self-update-dp01-e30.test.mjs \
  coordination/reviews/data-preservation-c265-e30-20261105/tests/concurrent-begin.regression.manual.mjs \
  coordination/reviews/data-preservation-c265-e30-20261105/tests/fixture-data-preservation.test.mjs \
  coordination/reviews/data-preservation-c265-e30-20261105/tests/source-contracts.manual.mjs
```

Exact TAP footer:

```text
1..48
# tests 48
# suites 0
# pass 48
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Suite counts: prior production CAS/journal/effect/fail-closed **24 PASS**; new production DP01 regression **4 PASS**; concurrent-first-begin original regression **1 PASS**; five-surface synthetic fixtures **9 PASS**; updated e30 source contracts **10 PASS**. The previously reported `9 PASS / 1 FAIL` was a *text-only inspection of older public-parent source*, **not** a failing test on exact e30. That result is superseded.

`DP-01`: not reproduced on exact e30, already guarded by `withTransactionLock`, `expectedPreimage` and exact prior transaction identity. No additional production patch is necessary; the only new e30 patch adds four inert regression tests. This does not attest installed Windows disk durability.

## Not run, no authority

| Category | Result | Reason |
|---|---|---|
| Windows installed profile/upgrade/installer | NOT RUN | Explicit prohibition, no installed client access |
| Windows directory persistence, ACL, UserData continuity | NOT RUN | No physical Windows input |
| PostgreSQL 17 physical backup, restore or migrations | NOT RUN | No PG process or DB permitted |
| Actual projects/messages/results after real rollback | NOT RUN | No real data, services or effects permitted |
| End-to-end restored-data qualification / predecessor approval | NOT RUN | Outside source-only scope |
| Previously rejected security reviews and symlink races | NOT RUN | Explicit exclusion |

No CI or GitHub Actions runs are claimed. No build, EXE, installer, network listener, client, service, real DB, credentials or billing used. This is a **source-only** result; `production_qualified=false`, `physical_restore_proven=false`, `installation_authorized=false`.
