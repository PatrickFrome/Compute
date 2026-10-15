# W82 — GitHub Actions applicability and exact-head CI train (SOURCE)

**Base:** W66 #1291 `61534c1228b81b063b48082c3cdbcbfd2921fe63`. **Owner:** W82. This is an operations/CI applicability note, NOT a replacement for the single living architecture roadmap (owned by W81). No installed state or release authority.

## Bounded live readback, 2026-10-15 03:45–03:49 UTC

Repository last 100 runs at initial read: 92 QUEUED, 3 PENDING, 5 COMPLETED/CANCELLED, created 03:03–03:05 UTC. Prior 100: 66 QUEUED and 34 CANCELLED (03:01–03:03 UTC). W66 exact head run 38674461246 had 3 QUEUED jobs (Ubuntu, Windows, ME2); companion W59 run 38674461358 had 6 QUEUED (Ubuntu, Windows, ME2, multiple disposable PG17). Job metadata showed runner_id=0, blank runner_name, empty steps. GitHub public status page reported Actions operational on October 15, without proving account-level capacity. **Do not assert quota, paid-tier exhaustion, concurrency limit or global outage without direct evidence.**

Later repository job readback shows prior run 38673630824 actually STARTED on Ubuntu 03:44:57 UTC and Windows 03:46:20 UTC, both SUCCESS (runner IDs 1000081778 and 1000081803), indicating at least some GitHub-hosted Linux and Windows runner assignment resumed. It does NOT mean W66 final jobs ran or passed. `QUEUED` and `PENDING` remain NOT PASS. No cancellation, force rerun, release or install authorized by this note.

## Actual source fix

W43/W51 historical source seals were unnecessarily triggered by `apps/metaengine-browser/**`, `apps/me2-ui/**` and `infra/client-state-runtime/**` in EVERY component PR. W59's six-job suite repeated on broad application changes as well. These three historical workflows now automatically trigger only for changes to their exact workflow/manifest contract; their `workflow_dispatch` entrypoints and jobs remain intact. W66 retains exact-current-source W43/W51/W59/W66 separate tests on Ubuntu/Windows plus ME2. A filtered-out workflow is **NOT a successful check**.

No change to W72 ACL PUSH+PR security obligations, W73 integration-owned current workflow, W75 compiled native Guardian, W78 package/R97 or SelfUpdate; no change to branch protection/rulesets or packages. No blanket `cancel-in-progress`: queued runs may include ambiguous package/version or mutation effects.

## W73 current-final-SHA handoff (one reviewed CI train)

1. Component PRs: focused source/unit tests only; W75 Guardian C++ and W72 ACL retain their mandatory independent dual-event qualification. Avoid adding broad `apps/**` or `infra/**` matching to old historical workflows.
2. Integrate exact published component SHAs via W73's sole final candidate/manifest. W73 must run frozen W43/W51/W59 ancestor tests independently from the W73 CURRENT ledger, plus Ubuntu/Windows native Owner/Guardian/ACL/security/source-sync and ME2/R97.
3. On ONE frozen current-final source SHA, explicitly invoke W59 via its retained `workflow_dispatch` for physical PG17 and complementary checks (or subsume its exact physical commands into the W73 current workflow with equivalent event/run/job receipts); run W45 host cap, W61 two new PG17 clusters restore, W64 restart and W71 C2 authenticated gate on same SHA, using uniquely disposable fixtures.
4. Require actual current SHA Windows NSIS/Guardian/ACL and full SelfUpdate/R97 package gate from W78, with no version reuse and no installed proof by inference. Keep W72 Windows/Ubuntu ACL both PUSH and PR event evidence. Any required check absent/skipped/cancelled/queued/failed => FINAL NOT ACCEPTED.
5. Record exact HEAD, workflow IDs, job IDs, actual start/end, runner labels, test outcomes and independent Owner/readback UNKNOWN status in W73 candidate ledger. Do not dispatch all historical workflows on every component PR and do not run duplicate push+PR for optional source-only jobs.

This only reduces future applicability fanout; it does not make already queued runs complete. Cancellation is NOT performed without exact supersession, source-only/never-started/no package-artifact proof. If runner queue persists after narrowly scoped source reduction, escalate precise job metadata to GitHub Support instead of asserting a guessed root cause.
