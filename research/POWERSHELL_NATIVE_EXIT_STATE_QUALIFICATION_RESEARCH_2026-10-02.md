# PowerShell native exit-state research for Self Update qualification — 2026-10-02

## Trigger

Build Identity V2 source `2a0022d1e0119620f7badff4621cb5ff1ed5ab7c` passed Package Smoke, Installed Chat, Final Runtime, Dirty Profile, Critical Audit, Shell and Autonomous Soak. Self Update #3594 failed in its pre-physical fixture after the fixture printed its complete success JSON.

The final expected refusal was a native Node-backed provenance rejection. Its non-zero native exit code remained in PowerShell's `$LASTEXITCODE` after the rejection had been semantically caught.

## Primary-source findings

Microsoft PowerShell `about_Automatic_Variables`:
https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_automatic_variables

It documents that `$LASTEXITCODE` contains the exit code of the last native program or PowerShell script and, for a directly invoked script, is not reset unless that script invokes another native program/script exit or explicitly exits.

Microsoft PowerShell `about_Error_Handling`:
https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_error_handling

It documents that native programs report failure through non-zero exit codes stored in `$LASTEXITCODE`; they do not inherently participate in PowerShell exception handling.

Microsoft PowerShell `about_Pwsh`:
https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_pwsh

It documents how process exit codes are derived from command/script success state and explicit native/script exits.

## Implication for CI fixtures

A negative test that *expects* a native non-zero result has two independent outcomes:
1. semantic outcome — refusal matched the expected fail-closed code;
2. process outcome — the enclosing test process must itself return success.

Catching the semantic refusal is insufficient if the stale native exit code survives into the CI wrapper.

## Adopted repair

Only inside the test helper `Require-Refusal`:
- verify the exception matches an expected refusal code;
- if it matches, clear the handled fixture-local `$LASTEXITCODE`;
- after the final negative case, assert `$LASTEXITCODE == 0` before emitting success.

This does **not** modify production error handling, installer behavior, updater authority, or provenance fail-close semantics. Unexpected refusal codes still throw and fail the job.

## Rejected alternatives

- weakening the workflow to ignore a non-zero step: rejected because it would hide real failures;
- adding `continue-on-error`: rejected for the same reason;
- blind Self Update rerun on the same package identity: rejected because the source change requires a new package identity;
- changing the production verifier to return zero for refusal: rejected because refusal must remain a real failure to production consumers.

## Next gate

The corrected source must create a new one-built Package Smoke artifact under a new package identity and all physical consumers, especially Self Update, must succeed on the exact same producer artifact before qualification.
