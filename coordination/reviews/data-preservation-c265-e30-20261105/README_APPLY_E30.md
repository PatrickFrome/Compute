# Verification / regression handoff for exact e30 (no installation)

**Required base:** the separately supplied `METAENGINE-e30-github-only-source.zip`, SHA256 `169f4dc6379605d68d34360c9d28d687b4da3dc856aea6fc1fb27e6bc6d3ba06`, independently reconstructed Git tree `90fa5633d7926dd71a7303266073e0625325e740` with ZIP modes preserved (`4272×100644`, `74×100755`). Do **not** substitute the older public parent at `d53ccd413...` or the original c265 tree.

## DP-01 status

The production fix is **already present in e30**. This handoff changes no production runtime files. Its minimal patch adds one inert Node test file:

`apps/metaengine-browser/test/self-update-dp01-e30.test.mjs` (four test cases).

The `.patch` is a Git unified diff against the precise original e30 tree. The Draft PR is based on the public transfer-patch branch (which does not itself contain the complete reconstructed e30 tree); **do not merge the PR onto that branch as if it were a production patch**. A coordinator can review and apply the regression to the correct e30-derived checkout later.

Safe repeatability on **disposable source only** (download the patch from this review package, then replace `/path/to/review` with its actual location):

```bash
# From an isolated, Git-initialized checkout of the ZIP, after verifying SHA and tree:
git apply --check /path/to/review/patches/DP01_e30_inert_regression.patch
git apply /path/to/review/patches/DP01_e30_inert_regression.patch
node --test --test-concurrency=1 --test-reporter=tap \
  apps/metaengine-browser/test/self-update-transaction-cas.generated.test.mjs \
  apps/metaengine-browser/test/self-update-transaction-journal.test.mjs \
  apps/metaengine-browser/test/self-update-install-effect-barrier.test.mjs \
  apps/metaengine-browser/test/self-update-transaction-fail-closed.test.mjs \
  apps/metaengine-browser/test/self-update-dp01-e30.test.mjs
```

The other three review tests in this PR (`source-contracts.manual.mjs`, `concurrent-begin.regression.manual.mjs`, `fixture-data-preservation.test.mjs`) must be placed at `coordination/reviews/data-preservation-c265-e30-20261105/tests/` within the **same exact e30 checkout**. They do not require DB, services, network or installer. Combined source/fixture suite: 48 PASS, 0 FAIL, 0 SKIP in the reviewed Linux executor.

No fixed production code patch is proposed because e30 already implements `withTransactionLock`, `expectedPreimage` and retained transaction binding. Repeating the patch would be a redundant rewrite, not remediation. Windows/PG17 physical preservation and installation approval remain **NOT RUN / HOLD**.
