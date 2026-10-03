# SLSA physical closure V2 checkpoint — 2026-10-03

Exact candidate: `c80e0fb46dc8c701462beb7f74dd8ff45867ac74`, branch `physical/build-slsa-provenance-v1`,
version `0.7.0-dev.37084599153.1`.

Status: PHYSICAL_QUALIFICATION_RUNNING. This is not a release seal or user-machine proof.
The consumed predecessor `b8f2f438… / 0.7.0-dev.37076000001.1` was not rerun.

## Implemented and qualified

The existing fix branch was continued from `129b941d…`; no parallel product
line was created. Functional source `fae5eae066576a6cdd30f4f336769c2b1b4787ac`
passed source run 37084599153. The final versioned candidate passed source run
37084981634 on Linux and Windows before physical activation.

Full Node suite: Windows 3966 passed / 0 failed / 0 skipped; Linux 3964 passed /
0 failed / 2 platform skips. Focused contracts: 76 passed on each platform.
Physical topology: 6 passed. Frozen dependency installation and clean checkout
checks passed. Local policy/topology checks: 37 passed.

Changes close stale package/SLSA/checkout assumptions, Windows CRLF matching,
missing Dirty Profile terminal token, and qualification's exact physical-push
admission gap. Token wiring uses the ephemeral job token; no secrets were embedded.
No installer is built by a consumer.

## Qualification backend

Only `metaengine-client-installed-qualification-h205f22` changed, in Meta
`jhriwwsryeqsvvvufkok`: V8, immutable source pin `fae5eae066576a6cdd30f4f336769c2b1b4787ac`.
Deployment digest: `3c8c50a03d33b98d61fc9f724d6305cb83f73a2ed0b080cfb9366bc563f67dd4`.
Readback confirms ACTIVE and the exact pin. Missing OIDC returns 401; malformed
JWT returns 403 with `authority_effect=false`. Positive enrollment remains
pending the installed physical gate. Stable Edge V10 and canary V26 did not change.
V7 rollback pin: `719febc00bd8879715a0633e8fe9d85acacead41`.

## One-shot physical matrix

Every row below is push / attempt 1 / the exact candidate SHA.

| Workflow | Run ID | Number | Initial state |
|---|---:|---:|---|
| METAENGINE Browser Shell V1 | 37085197339 | 3557 | in_progress |
| METAENGINE Browser Self Update E2E | 37085197258 | 3605 | in_progress |
| METAENGINE Browser Shell-First Dirty Profile V1 | 37085197355 | 1043 | in_progress |
| Browser Workspace Reincarnation V1 | 37085197399 | 572 | in_progress |
| METAENGINE Browser Final Runtime Activation V1 | 37085197253 | 2015 | in_progress |
| METAENGINE Browser Critical Audit V1 | 37085197332 | 2610 | in_progress |
| METAENGINE Browser Host Resilience Login Start V1 | 37085197254 | 520 | in_progress |
| Browser Windows Installed Chat Qualification | 37085197296 | 2434 | queued |
| METAENGINE Browser Windows Autonomous Soak V1 | 37085197298 | 2686 | queued |
| Browser Windows Package Smoke | 37085197260 | 3156 | queued |

The sole Package Smoke producer is 37085197260 / #3156. Consumers must bind
that exact producer, its event, run, attempt, source and bytes, then wait for
terminal success. Failed qualification requires a new source/version, never a rerun.

## Research and next boundary

GitHub CLI verifier reference: https://cli.github.com/manual/gh_attestation_verify
SLSA 1.2 verification: https://slsa.dev/spec/v1.2/verifying-artifacts

Signature verification must be followed by expected artifact, builder, source,
build type and parameter checks. The existing semantic verifier enforces these
after gh verification. This does not certify application behavior or grant release
authority. Authentic provenance and a qualified installer remain distinct from
a real z.ai Agent task completing through durable result verification.

Next: collect terminal results and installer/provenance evidence for all ten rows;
offer these exact bytes only after the matrix passes. Continue Agent-origin useful
work qualification on the existing Native Supervisor authority, with no API model
fallback or second scheduler.
