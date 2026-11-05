# METAENGINE: first-run UI diagnostics, historical c265 + e30

**Status: DRAFT, SOURCE-ONLY, NOT QUALIFIED FOR INTEGRATION.**

## Provenance (not the latest version)
- GitHub-only source-transfer commit: `accb28e72c87c059e780efb8e6681886b33e9b4f` on `work/source-transfer-c26565e-20261103`.
- Manifest: `coordination/source-transfer/c26565e/README.txt`; parts 7,200,000 + 7,200,000 + 1,657,953 bytes (16,057,953).
- Manifest **claims**, not independently verified: archive SHA256 `4200e492828dbb857aaa737a7ce56d0aeda3c97c84f7743b1501ef2f229d3636`, source revision `c26565e58ab92dcbcda9663c4d231bdf4a9a7ee6`, tree `2dbe253e97379532f6f4b52ef7edf26109a9266d`.
- Integration patch commit `d53ccd4135f28206d91d6804cf0626095565e6af`; patch blob `79d40bf024a6553656b86fb1a29c1313dd458a0e`. Target tree `90fa5633d7926dd71a7303266073e0625325e740` **not independently verified**.

## Findings
The e30 patch context shows that B's `native-coding-initial-setup-panel.mjs` directly appends `errorText` and invokes `statusText()` on both readbacks. This is a display boundary for diagnostic text; an actual leak from backend to renderer is **not proven**, because source archive binary parts could not be materialized to inspect upstream assignments. No confirmed false READY was observed in the accessible e30 hunks.

The e30 patch already distinguishes account `PRODUCER_UNAVAILABLE` from observed `AUTHENTICATION_REQUIRED` and prohibits confirmation without a true observed account. Existing e30 test hunks cover no provider/BEGIN on account drift, preparation failure, and HOLD/AMBIGUOUS. Those test hunks have **not** been run against the full historical source.

Actual installed `apps/me2-ui` package, Guardian and PostgreSQL components were **not** inspectable from the available text patch. Do not call them verified.

## Source-only mitigation
The attached candidate patch (SHA256 `c07deeaac950fdb11989fb68367dbc6607087a1ed27db2b3e086841a67dda978`) adds a display-only allowlist formatter, pure inert Node tests, and narrow B-panel error/readback rendering changes. Unknown errors do not echo raw stderr, credentials, private paths or evidence; HOLD/AMBIGUOUS/COMPLETED cannot become READY; missing account producer does not suggest login as repair. Native authority logic is unchanged.

Tests: **32 PASS, 0 FAIL** under `node --test`; Node syntax check PASS; `git apply --check` PASS **only** on a synthetic context fixture derived from e30 hunks, not on the complete source tree. Actual archive SHA, integrated tree, full build, installed UI/browser, Windows, services, PostgreSQL and ACL: **NOT VERIFIED / NOT RUN**.

## Next gate
Materialize approved GitHub archive parts; compare concatenated SHA256 and Git tree, apply e30 exactly, verify tree 90fa..., then apply candidate patch, run actual `apps/me2-ui` build/browser tests with no user data, and review status-code ownership and recovery advice. Do not relax HOLD, substitute ACK/boolean for authority, launch real services/installers, or merge this draft until qualified. The repository branch contains review artifacts only, not a modified installed source tree.

**No merge, no client installation, no signing, no model/API billing, no cloud or GLM.**
