# METAENGINE Browser Checkpoint — Second SLSA Physical Candidate 9/10 + Self Update V3 Fix

Date: 2026-10-03
Authority: evidence only
Promotion authority: false
Automatic physical retry allowed: false

## Exact second physical candidate

Branch:
`physical/build-slsa-provenance-v1`

Exact source:
`c80e0fb46dc8c701462beb7f74dd8ff45867ac74`

Package:
`0.7.0-dev.37084599153.1`

The same exact SHA is also the head of:
`work/build-slsa-physical-fix-v2`.

Supabase installed-qualification function is ACTIVE at version 8 and imports source:
`fae5eae066576a6cdd30f4f336769c2b1b4787ac`.

The deployed policy now admits the dedicated physical push subject only when repository, immutable repository/owner IDs, workflow path, source SHA, run id, run attempt and push binding all match. It still rejects unauthorized event/subject combinations fail-closed.

## Physical matrix result

All runs are attempt 1 on exact source `c80e0fb46dc8c701462beb7f74dd8ff45867ac74`.

SUCCESS:
- Package Smoke — `37085197260` / #3156
- Shell-First Dirty Profile — `37085197355` / #1043
- Autonomous Soak — `37085197298` / #2686
- Final Runtime Activation — `37085197253` / #2015
- Installed Chat Qualification — `37085197296` / #2434
- Shell — `37085197339` / #3557
- Critical Audit — `37085197332` / #2610
- Host Resilience — `37085197254` / #520
- Workspace Reincarnation — `37085197399` / #572

FAILURE:
- Self Update E2E — `37085197258` / #3605

Result:
`9/10 physical workflow families terminal SUCCESS`.

The fixes from V2 are therefore physically proven:
- installed-qualification OIDC physical push is accepted;
- Dirty Profile token/terminal producer verification is fixed;
- stale package-identity and SLSA permission tests are fixed;
- Linux/Windows contract drift is fixed.

## Remaining Self Update failure

Self Update contract job itself is SUCCESS.

Failure is in:
`windows-published-n-to-one-build-target`

at step:
`Parse and behaviorally qualify the installer re-verification boundary`.

Exact error:
PowerShell StrictMode attempted to read missing property `producer_event` from a synthetic local consumer-binding fixture.

Root cause:
`qualified-installer-consumer.ps1` automatically inferred `ExpectedProducerEvent=push` from ambient GitHub physical branch context even in `Mode Verify`.

That is semantically too broad.

`Verify` rechecks local installer/provenance bytes and does not select or wait for a remote Package Smoke producer. Event auto-fencing belongs to `Acquire` and `Wait`, while callers may still pass an explicit event to Verify if they need that binding.

## V3 source fix

Created:
`work/build-slsa-physical-fix-v3`

Base:
`c80e0fb46dc8c701462beb7f74dd8ff45867ac74`

Current source-fix head:
`7428380f19f0d244723f6a1ebeb9241a237f6fa5`

Change:
the automatic physical-branch event fence now applies only when:
`$Mode -ne 'Verify'`.

Added:
- contract assertion that physical auto-fencing excludes local re-verification;
- dedicated Linux + Windows source qualification;
- direct execution of `qualified-installer-consumer-verify.ps1` under simulated physical push environment;
- full Browser Node regression on both OSes;
- zero-authority source boundary.

Source qualification run:
`37086471765`

At checkpoint creation:
- helper parsing PASS on Windows and Linux;
- local re-verification under physical push environment PASS on Windows and Linux;
- shared consumer contract PASS on Windows and Linux;
- full regression still running;
- no new package identity has been created;
- no physical branch was moved;
- no physical retry was attempted.

## Physical retry rule

Do not rerun Self Update on `c80e0fb4...`.

If V3 source qualification becomes fully green, create a new source SHA with a fresh monotonic package version and move the dedicated physical branch only once.

The next physical attempt must again be attempt 1 for its source/version pair.

## Hard fences

- no rerun of `37085197258`;
- no reuse of package `0.7.0-dev.37084599153.1`;
- no release/tag/merge;
- no production promotion;
- no user-machine install/update;
- no weakening of OIDC/SLSA exact-source checks;
- no second installer producer.
