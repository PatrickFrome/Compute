# METAENGINE Browser — Step 7 isolated Development Plane physical smoke

Date: 2026-08-29
Branch: `work/metaengine-browser-shell-v1`

## Falsified hypotheses

Three exact-head CI iterations established:
1. Linux full shell + Development Plane succeeds.
2. Windows `windows-latest` times out before any METAENGINE receipt.
3. Windows Server 2022 behaves identically, so the fault is not specific to the rolling Server 2025 image.
4. Cooperative utility shutdown did not change the Windows pre-receipt hang, so the failure cannot be attributed solely to utility-process termination.

The Windows artifacts do contain early Chromium verbose output but no application stdout. This makes stdout an unreliable observability channel for the Windows GUI-subsystem process and shows that the existing physical test mixes the Development Plane boundary with unrelated full-browser bootstrap.

## Research basis

Electron's headless-CI guidance states that Windows/macOS do not require the Xvfb configuration needed on Linux. Electron also defines `utilityProcess` as a main-process API and documents the physical `exit` event as the termination proof. Therefore a minimal Electron entrypoint is a more precise test of the DP0 process boundary than starting the complete browser shell.

Sources:
- https://www.electronjs.org/docs/latest/tutorial/testing-on-headless-ci
- https://www.electronjs.org/docs/latest/api/utility-process

## Implementation decision

Introduce `src/development-plane-smoke.mjs` as a dedicated physical test entrypoint. It exercises only:

`module load -> app.ready -> utilityProcess.fork -> exact READY handshake -> HEALTH/CAPABILITIES/REPO_HEAD_READ -> cooperative SHUTDOWN -> observed exit -> app.exit`

For Windows it writes append-only stage markers to a runner-temporary JSONL file. The file is outside the repository and contains no credentials or page data. The required Windows gate consumes those markers instead of relying on stdout.

The full browser integration remains tested by unit/static contracts and the Linux shell/renderer smoke. A later Windows release milestone must separately prove the packaged full browser; DP0 does not claim that broader release certification.

## Security impact

None of these diagnostics expand runtime authority. The dedicated entrypoint is CI/development plumbing, not a remote page API. It does not expose arbitrary evaluation, shell execution, browser actuation, source mutation, or current-runtime promotion.
