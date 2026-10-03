# METAENGINE Browser — Client V1 Admission Readiness Submit Fence Checkpoint

Date: 2026-10-03
Authority: evidence/checkpoint only
Promotion/release/install authority: false
Automatic physical retry authority: false

## Fresh state

The prior physical admission-recovery candidate was:

- source: `d9aab89f55d119f9fb9f5660872c8627104fc591`
- package version: `0.7.0-dev.37136054065.1`
- physical branch: `physical/build-slsa-provenance-v1`
- Package Smoke run: `37136652433` / #3159 / attempt 1

The package-version reservation was successfully published before the build:
- artifact id: `11278758934`
- artifact name: `metaengine-browser-package-version-0.7.0-dev.37136054065.1`

That identity is consumed and MUST NOT be retried or rebuilt.

## Exact physical failure

Package Smoke did not reach NSIS packaging.

The terminal source was the R97 primary UI visual qualification:
- job: `111242541429`
- failed step: `Capture R97 primary chat-fleet visual evidence`
- phase: `SUBMIT_TYPED_GOAL`
- error: wait timeout for `client-goal-readback` to contain `Queued`

Upstream steps were green through:
- exact checkout
- package identity preflight
- immutable reservation
- frozen Node/Bun
- lock material
- frozen Browser dependency install
- dependency resolution
- npm/composed SBOM
- expected Build Identity
- Browser parse/tests
- shell-only visual evidence
- ME2 UI build/staging

All installer-dependent workflows failed later at exact immutable Package Smoke acquisition. They are derivative failures, not independent product defects.

No installer, SLSA bundle, candidate artifact, release, tag, installation, or promotion was produced from the failed physical attempt.

## Root cause

The new GoalComposer kept its own 5-second cached work-readiness state and used that cached value to disable the Run button.

The R97 harness had already switched the authoritative fixture from recovery-blocked to READY and the global readiness badge had observed READY, but the GoalComposer cache could still contain the older BLOCKED value.

Result:
- the Run button remained disabled;
- the click produced no goal submission;
- `goalSubmitCount` stayed unchanged;
- visual qualification timed out waiting for `Queued`.

This is a real product race, not a test-only timing issue: a newly recovered workspace could remain locally submission-blocked until the GoalComposer polling interval catches up.

## Successor fix

Source-only successor:
- branch: `work/client-v1-admission-readiness-submit-fence-v1`
- exact head: `ba5ce72775186fa79995728261ddf4e1f8644549`

Behavioral change:
1. cached readiness remains presentation-only;
2. Run is no longer disabled solely by cached BLOCKED readiness;
3. every explicit submit performs a fresh typed `workReadiness()` read immediately before the goal effect;
4. if fresh readiness is unavailable or not execution-ready, no `submitGoal` effect occurs;
5. only a fresh `execution_ready=true` read can precede `submitGoal`;
6. no scheduler, retry loop, DB write, or alternate execution authority was added.

Contract test now proves:
- fresh readiness read exists in the submit path;
- `submitGoal` is ordered after the fresh read;
- a false fresh readiness blocks the effect;
- Run is not permanently gated by stale cached readiness.

Source qualification workflow now includes the successor branch and still runs:
- full Browser regression on Linux and Windows;
- ME2 UI production build on Linux;
- physical-topology/source-only guards;
- Windows updater consumer verification under the push-event fixture.

Current source-only qualification:
- run: `37139234564` / #10
- exact source: `ba5ce72775186fa79995728261ddf4e1f8644549`
- status at checkpoint creation: queued/in progress; terminal result must be re-read before claiming qualification.

## Safety / next step

Do not rerun Package Smoke for `d9aab89...` or reuse `0.7.0-dev.37136054065.1`.

Before another physical attempt:
1. wait for exact source-only successor CI to finish;
2. inspect any failure rather than rerun;
3. only after source qualification is terminal green, allocate a fresh package version;
4. move the exact qualified successor onto the physical producer line once;
5. preserve one producer / exact downstream artifact consumption;
6. if physical execution starts, any later source modification requires another fresh package identity.

No Supabase admission mutation is performed by this checkpoint.
No Edge deployment is performed by this checkpoint.
