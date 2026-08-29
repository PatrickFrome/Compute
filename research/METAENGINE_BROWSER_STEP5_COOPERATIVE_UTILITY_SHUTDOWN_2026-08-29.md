# METAENGINE Browser — Step 5 cooperative UtilityProcess shutdown

Date: 2026-08-29
Branch: `work/metaengine-browser-shell-v1`
Scope: repair the remaining Windows Development Plane lifecycle failure without weakening the execution boundary.

## Evidence before change

Exact-head run `33246141424` at `f1f228c727e3fcf7ed124f94068538e0f7e9f158` produced a fully green Linux `shell-contract`, including the Development Plane launch/shutdown diagnostic, while the `windows-latest` physical Development Plane gate again timed out. This proves the remaining fault is platform/runtime lifecycle specific rather than a parser, unit-contract, security-policy, or B-line regression.

## Research finding

Electron documents `UtilityProcess.kill()` as graceful termination and documents the `exit` event as the proof that the process ended. However, Electron issue #47228 is a confirmed cross-platform `utilityProcess` bug: utility processes can remain alive when no more work is scheduled; the issue specifically reports Windows and macOS and states that an explicit `process.exit()` is required as a workaround.

Sources:
- https://www.electronjs.org/docs/latest/api/utility-process
- https://github.com/electron/electron/issues/47228

## Design correction

The Development Plane now has an internal typed lifecycle control that is not part of its public capability list:

`main -> {type: CONTROL, control: SHUTDOWN} -> utility`

The worker responds with `SHUTDOWN_ACK`, then performs the Electron-required explicit exit. The main process resolves `stopAndWait()` only after the physical `exit` event. A bounded `kill()` fallback remains for a wedged worker, and timeout still becomes `LOST` rather than being silently treated as success.

Security properties are unchanged:
- remote ChatGPT cannot send Development Plane control messages;
- `SHUTDOWN` is not an exposed Development Plane capability;
- no arbitrary shell/eval/source mutation is added;
- no direct current-runtime promotion is added;
- automatic restart remains false;
- exit must still be physically observed before the smoke receipt is accepted.

## Why this helps self-development

A self-developing browser needs deterministic worker lifecycle boundaries. Candidate builders/testers must be stoppable and replaceable without leaving an ambiguous process incarnation alive. The cooperative ACK + observed-exit fence is therefore a prerequisite for later candidate build, verification, rollback, and promotion planes.

## Next gate

The exact-head Windows CI must complete with exit code 0 and the existing smoke receipt containing `ok=true` and `shutdown.state=STOPPED`. No authoritative DP0 checkpoint is allowed before that proof.
