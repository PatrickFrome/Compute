# Installed first-run negative fixture repair — 2ff9

Scope: Client installed-runtime qualification; canonical C2 remains unpromoted.
No installer/artifact execution, user-PC interaction, database, credential, ACL,
network-audit, publication, package rerun, version or source-seal mutation occurred.

## Immutable evidence

- Candidate: `2ff9dc2aa6587520d2804ff75847e192eed9f7c5`, package
  `0.7.0-dev.1359740117434.1` (consumed; do not reuse).
- Package Smoke run `40324805522`, job `121578712352`; unqualified candidate artifact
  `12651931138`.
- Evidence ZIP SHA256 independently verified:
  `0519514dd6f2e7a3e1eeca1fa7f25de8bb1ce91573b2d5f6ba85cd30077e2068`.
- Evidence-reported installer SHA256:
  `8549c1ce59a5171685979795cb2ae7b3e53ceb6c2e109480b6916d2dc95ee97b`.
- Evidence-reported installed EXE SHA256:
  `b29bf10e78e76341cf0716da9e86427e876c4c92c1296e32e5174408a072a628`.

## Observed failure chain (not a guessed crash cause)

1. Installed offline successor `PROBE_ONLY` passed its narrow receipt/cleanup
   fence. It did not establish normal UI, Owner or fresh provisioning readiness.
2. At 13:02:14.893Z the qualifier entered **FIRST_RUN**, its negative missing
   descriptor phase, not the positive Owner/UI phase.
3. It launched the exact installed normal entry in an isolated empty profile,
   then waited 90 seconds for `LOCAL_PROVIDER_STARTUP_BLOCKED` with legacy reason
   `local_state_packaged_owner_not_ready`.
4. At 13:03:45.448Z that expected row remained absent. Failure was
   `installed_launch_readback_timeout_unavailable`; the saved log contains only
   `ACTIVATION_HOOK_INSTALLED`.
5. This phase did not supply a PID/journal to progress snapshots. Therefore
   `primary_pid:null`, `UNOBSERVED` and an empty startup-state list do **not** prove
   process death, runtime-import failure or deadlock. The negative test expressly
   required the runtime journal to remain absent. Child exit/native dialog
   readback was not captured, so the original terminal wait stage is unknown.

## Proven source/fixture mismatch

The same source's admitted normal first run now routes `NO_DESCRIPTOR` to the
verified fresh-provider operator. That operator requests genuine native Yes/No
consent before any private setup, protected device identity or database mutation.
It does not promise an immediate missing-descriptor rejection. The old fixture
neither declined that dialog nor understood this consent boundary.

A hermetic subprocess reproducer runs both real main entrypoints with only the
native setup boundary held pending: top-level ESM finishes before `app.ready`,
consent waits after readiness, and runtime/ME2/Host/network/Owner/journal remain
unadmitted. No immediate legacy blocked row is emitted. This proves the fixture
expectation is obsolete; it does **not** prove the original installed process
actually reached a native dialog. Bundle verification/readiness/consent stages
were previously silent, so bounded phase diagnostics are added.

## Repair and safety boundary

- Preserve the native No result only when the actual consent subprocess returns
  exact declined sentinel, exit 2 and no kill/signal. Other native outcomes remain
  unconfirmed. Preserve that category through the real operator only before all
  mutation/owned-resource state, still running mandatory cleanup.
- Intentional No exits through the existing denied-admission cleanup path, without
  opening a second error dialog. No consent, Guardian, first-owner, source,
  admission, shutdown or readiness gate is bypassed.
- Negative first run remains a newly generated disposable CI profile. The helper
  is restricted to GitHub CI and a nonce-bound non-alias namespace under runner
  temp. It retains exact process handles and rechecks PID/birth/executable/parent
  bindings for qualifier, Browser and direct native PowerShell child.
- The only interaction is No (ID 7) on the exact visible native dialog: class,
  title, generated state/Owner paths in body, control parent/PID/class/label,
  enabled/visible state and default-No must all match. Ambiguity is HOLD.
- PASS additionally requires the production native-denial receipt and exact
  provider-block reason, clean Browser exit 1, absent Owner/setup/device identity/
  runtime journal/host artifacts, closed selected ports and process cleanup.
  Generic failure, click delivery or missing dialog is never PASS.
- A single original 90-second deadline covers native readback and denial/exit.
  No timeout was widened. Liveness, exit and allowlisted setup phases are persisted
  separately from runtime startup-journal evidence.

Win32 semantics were checked against primary Microsoft documentation:
[DM_GETDEFID](https://learn.microsoft.com/en-us/windows/win32/dlgbox/dm-getdefid),
[button messages](https://github.com/MicrosoftDocs/win32/blob/docs/desktop-src/Controls/button-messages.md).
These references inform source implementation only, not a Windows execution claim.

## Verification limits

Hermetic tests cover entrypoint deferral, genuine-vs-unconfirmed denial parsing,
real operator and installed mapper propagation, post-mutation refusal, negative
qualification predicates, process readback construction and source safety
contracts. Source syntax checks run locally. Native Windows UI automation,
installed executable launch, real provisioning and normal UI qualification are
**NOT RUN** here and remain gates for the next distinct immutable candidate.

Local verification result: **110 passed / 1 skipped / 0 failed** across the 10
focused test files (111 tests). The skipped test is the existing Windows-only
nested-ASAR readback test. The final helper/qualification/progress recheck was
**31 passed / 1 same skip / 0 failed**. Browser source checker: **243 passed**;
explicit `node --check` for changed/new JS and `git diff --check` passed. The
complete repository aggregate suites were not run.
