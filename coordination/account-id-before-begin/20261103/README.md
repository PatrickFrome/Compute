# Codex account observation before BEGIN — source-only result

The authentic selected-account producer is absent. This patch exposes the exact gap and prevents a typed or stale account ID from being accepted as an observed account. It does not make Main or Codex authentication ready.

## Verified base and patch

- Transfer commit: `accb28e72c87c059e780efb8e6681886b33e9b4f`, branch `work/source-transfer-c26565e-20261103` in `PatrickFrome/Compute`.
- Concatenate `coordination/source-transfer/c26565e/archive.part00`, `archive.part01`, `archive.part02`, in that order.
- Archive SHA256: `4200e492828dbb857aaa737a7ce56d0aeda3c97c84f7743b1501ef2f229d3636`.
- Supplied source label: `c26565e58ab92dcbcda9663c4d231bdf4a9a7ee6`; verified tree: `2dbe253e97379532f6f4b52ef7edf26109a9266d`.
- The earlier four incremental patches are already represented in this snapshot; do not apply them again.
- Patch: `codex-account-before-begin-c26565e.patch`.
- Patch SHA256: `c3407baa7a7ddef0e5440456efcd7ba163b778c9936c06fb65814990fe8e7514`.
- Patched tree: `0d56f49a42ec442a2fe362ea6f0143c79d992111`.

`git apply --check` and `git apply --index` both passed on a fresh reconstruction of the verified source tree. ZIP extraction must preserve the archived executable modes to reproduce the Git tree. The local qualification commit is a reconstructed root commit, not original history. The snapshot contains no `AGENTS.md` or `.agents/skills`.

## Exact missing producer

`apps/metaengine-browser/src/main.mjs:1311` still contains:

```js
const readCodexAuth = async () => null;
```

Its private-facts consumer is `native-coding-initial-setup-composition.mjs:91`. The resulting state is now `PRODUCER_UNAVAILABLE`, with `account_id: null`; confirmation and retained-selection BEGIN refuse with `native_initial_selection_codex_account_producer_unavailable`.

The missing component is a genuine existing Main-owned Codex account/authentication observer and its lifetime/handoff into the controlled Codex authentication context ultimately used as `CODEX_HOME`. It must observe the actual selected account, account switches and logout, expose only current non-secret metadata, and maintain/revoke that binding through BEGIN. The supplied source has no such owner or handoff. The existing callback seam is not evidence of a producer. No token decoding, credential copying, unrelated home, tab metadata, PID, user label, synthetic response, new transport or trust root was used to fill the gap.

## Changes

- Distinguish an absent producer from an observed signed-out account.
- Remove the editable account ID from the confirmation form; derive it from Main's current authenticated projection.
- Reject raw/stale account selections in Main before confirmation ID allocation or persistence.
- Observe the current account after asynchronous operation readbacks, before root preparation and again before provider/BEGIN dispatch.
- Reobserve account drift after confirmation persistence/readbacks before advertising BEGIN.

The patch changes ten files, including four test files. `report.json` lists each file and every executed command; `checks.json` and logs retain the results.

## Verification

- Initial setup: **89 PASS**, zero failures/skips across nine suites. Negative cases include missing producer, logout, wrong account, raw account injection, account switch during root preparation/final operation readback, stale confirmation and forged projection flags. All account observations in these tests are generated fixtures, not real authentication.
- Protocol/owner/ticket: **17 PASS**.
- General source checks: **292 PASS**.
- BEGIN model: **9 PASS** normally and **9 PASS** with ASAN/UBSAN.
- Owner-wait model: **13 PASS** normally and **13 PASS** with ASAN/UBSAN.
- Requester-session model: **15 PASS** normally and **15 PASS** with ASAN/UBSAN.
- Original Main launch source: **81 PASS, 1 expected FAIL**, `wire_route_authenticates_then_launches`; the guarded route remains HOLD.
- Original Main source verifier: **23 PASS, 0 FAIL, 5 NOT RUN**.
- `git diff --check`: PASS.

The five NOT RUN checks are the pinned OpenSSL regression, pinned BoringSSL regression, exact Electron/Node source interface, official Electron/patched Node header syntax, and Win64 cross-builds. Required pinned sources/builds/headers or an existing cross compiler were not supplied. No tools or dependencies were installed.

Real Windows process/pipe/Job/WTS/ACL qualification, custom Electron build, production grant/release positive path, continuous code custody and real Codex-account/context handoff remain unproven. LeakSanitizer is disabled by the existing runner on this ptrace host. Reobservation closes the tested readback windows; it does not prove atomic continuous account custody.

## Remaining boundaries

Production confirmation and BEGIN remain blocked by the absent account producer. Original requester/token/package/Job/worker/I/O custody code is untouched. Clean-install enrollment authority, upgrade authority/data-preserving handoff, pre-Main connection authentication, durable recovery and native Windows qualification remain separate unresolved work from the source task.

No installation, application launch, user PC/DB/service modification, merge, shared-branch update, new trust root, protection weakening, secret collection or real account-ID collection occurred. The original Library input transfer failed, but the separately authorized Git transfer succeeded and was verified. No accessible Space was returned by the complete Space inventory; no Space was created. Results are delivered through the authorized separate Git branch/draft PR and Library artifact.
