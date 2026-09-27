# METAENGINE R92 — Result Verification + Immutable Installer Convergence

Date: 2026-09-27

Parent exact head: `075288de192503c7418726b0461a7bdb285d8d6a`
Parent PR: #996 — qualified installer consumer binding
Donor exact head: `19b552a5c4c2929dcb053b66e1e01f50306d6054`
Donor PR: #995 — bound agent-result verification loop

## Why this convergence exists

The current Browser line had two independently-qualified R91 increments on the same R90 ancestor:

1. the immutable Package Smoke consumer protocol, with a single exact-head installer producer and three physically-qualified downstream consumers;
2. the post-RESULT_READY verification loop, with digest-bound primary results and independent critic/falsifier verification.

Their changed file sets do not overlap semantically. R92 therefore converges them by taking the fully-qualified #996 head as the parent and porting the exact #995 result-verification files without importing divergent branch history.

## Inherited exact-head evidence from #996

Parent `075288de192503c7418726b0461a7bdb285d8d6a` is terminal-green for:

- Browser Windows Package Smoke;
- Browser Windows Installed Chat Qualification;
- METAENGINE Browser Final Runtime Activation V1;
- METAENGINE Browser Windows Autonomous Soak V1;
- METAENGINE Browser Critical Audit V1;
- METAENGINE Browser Shell V1;
- METAENGINE Browser Self Update E2E;
- R84 Desktop Convergence V1.

The exact Package Smoke artifact contains installer
`METAENGINE-Browser-Test-Setup-0.7.0-dev.3.1-x64.exe`
with SHA-256
`07710874b5fe7eb1a2da18c9b909ae90df714ebe10e3c60fe711b9772bc9e44a`.

The visual proof on that exact parent confirms:

- primary ME2 UI captured;
- legacy shell not captured;
- ports 3042/3043 blocked during deterministic visual qualification;
- browser cast and CDP fallback images have zero natural width and zero opacity;
- no remote browser pixels are visible;
- broken browser image fallback is hidden;
- drawer interaction and control-room geometry are verified.

The installed package proof confirms normal UI boot, second-instance activation, installed ME2 UI and installed ME2 daemon.

## Ported result-verification semantics from #995

R92 carries the exact #995 implementations/tests for:

- `agent-result-protocol.mjs`;
- digest-bound `RESULT_CLAIM_V1`;
- exact task + lease-generation primary binding;
- exact subject-task + result-digest verifier binding;
- `RESULT_READY` as verification boundary;
- critic after primary result exists;
- critic + falsifier for CRITICAL work;
- no verifier preallocation before RESULT_READY;
- missing/invalid/ambiguous claim -> fail-closed;
- acceptance only after all required verifier results exist;
- no second scheduler and no fabricated authority.

## Additional parent reliability fixes preserved

R92 retains the later #996 physical fixes:

- Windows-safe daemon lock path through `tmpdir()`, not hard-coded `/tmp`;
- Browser-owned UI sets `ME2_HOSTED_BY_BROWSER=1`;
- Browser-owned UI forces legacy `ME2_WATCHDOG=off`;
- Next instrumentation refuses to start the standalone watchdog when hosted by Browser;
- centralized immutable installer consumer binding;
- exact Package Smoke trigger closure.

## Qualification rule

R92 is a new source head and cannot inherit terminal acceptance merely because both parents were independently green.

It must run its own exact-head matrix. In particular:

1. full Critical Audit / Node regression;
2. Meta Orchestrator result-protocol tests;
3. Shell;
4. Package Smoke;
5. Installed Chat;
6. Final Runtime;
7. Autonomous Soak;
8. Self Update.

Until those are terminal-green, the latest installer safe to hand to an operator remains the qualified #996 artifact above.

No signing, publication, production promotion, scheduler expansion, arbitrary execution, Browser command authority, or update-authority bypass is introduced by this convergence.
