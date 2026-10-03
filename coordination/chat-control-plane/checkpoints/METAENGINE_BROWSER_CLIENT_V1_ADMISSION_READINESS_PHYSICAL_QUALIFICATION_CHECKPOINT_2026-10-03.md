# METAENGINE Browser — Client V1 Admission Readiness Physical Qualification Checkpoint

Date: 2026-10-03
Authority: evidence/checkpoint only
Release/tag/merge/install authority: false
Automatic rerun authority: false

## Exact source qualification

Source branch:
- `work/client-v1-admission-readiness-submit-fence-v1`
- exact qualified head: `219ebe989a4f7ce2adfeb205a394a47ee55037cf`
- package identity: `0.7.0-dev.37139234564.1`

Exact source qualification:
- run `37140337749` / #14 / attempt 1
- conclusion: SUCCESS
- Linux contract: SUCCESS
- Windows contract: SUCCESS
- Windows R97 source visual flow: SUCCESS
- source checkout isolation: SUCCESS
- full Browser regression: SUCCESS on Linux and Windows
- ME2 production build: SUCCESS
- one-producer/SLSA topology checks: SUCCESS
- qualified-installer consumer verification: SUCCESS
- exact-source unchanged gate: SUCCESS

The final source-only gate now reproduces the complete R97 visual harness before any physical package build and builds ME2 UI from an isolated runner-temp copy so Next.js trace material cannot dirty the checkout.

## Prior consumed predecessor

Do not rerun:
- source `d9aab89f55d119f9fb9f5660872c8627104fc591`
- package `0.7.0-dev.37136054065.1`
- Package Smoke `37136652433` / #3159 / attempt 1

That predecessor failed before NSIS packaging in the R97 typed-goal phase and its package-version reservation is consumed.

## New physical activation

The canonical physical producer branch was fast-forwarded once:

- branch: `physical/build-slsa-provenance-v1`
- from: `d9aab89f55d119f9fb9f5660872c8627104fc591`
- to: `219ebe989a4f7ce2adfeb205a394a47ee55037cf`
- force update: false

This is a new source SHA and a new package identity, not a rerun of the predecessor.

Exact ten-workflow matrix:
- Package Smoke `37144386164` / #3160
- Installed Chat `37144386186` / #2438
- Final Runtime `37144386182` / #2019
- Autonomous Soak `37144386167` / #2690
- Self Update E2E `37144386260` / #3609
- Shell `37144386185` / #3561
- Critical Audit `37144386165` / #2614
- Dirty Profile `37144386177` / #1047
- Host Resilience `37144386219` / #524
- Workspace Reincarnation `37144386171` / #576

All are attempt 1. Never rerun any of these runs in place.

## Package identity is now consumed

Package Smoke preflight succeeded and published the immutable reservation before physical build:

- artifact id: `11282081303`
- artifact name: `metaengine-browser-package-version-0.7.0-dev.37139234564.1`
- digest: `sha256:e307b8c8b95923fd30d22443dd4a5fd1c4350730630a9324b1af2f29a1246da1`
- expired: false

Therefore `0.7.0-dev.37139234564.1` is now consumed even if later physical steps fail.

Package Smoke currently passed:
- exact source checkout;
- exact source-head proof;
- frozen Node/Bun setup;
- duplicate source/version refusal gate;
- immutable package-version reservation;
- reservation seal;
- frozen package-lock proof.

The Windows producer is currently in physical dependency installation at this checkpoint.

## Current matrix state at checkpoint creation

Already terminal green:
- Host Resilience #524
- Workspace Reincarnation #576

Still active:
- Package Smoke
- Installed Chat
- Final Runtime
- Autonomous Soak
- Self Update
- Shell
- Critical Audit
- Dirty Profile

No downstream failure is classified until the exact Package Smoke producer reaches a terminal state.

## Fresh live Browser readback

Supabase read-only state at approximately 2026-10-03 18:28 UTC:
- live client version: `0.7.0-dev.37103459439.1`
- keepalive: `PARKED`
- admission: `CLOSED`
- fleet: 4 `BOUND_UNVERIFIED`, 0 `ACTIVE`
- transport promotion: `UNOBSERVED`
- Guardian: `HOLD`, `GUARDIAN_OWNER_OBSERVATION_FAILED`
- Guardian pipe error: `connect EPERM \\.\pipe\METAENGINEBrowserGuardianUpdateV1`

No admission mutation, Edge deployment, user-machine install or Guardian bootstrap effect was performed while starting this physical candidate.

## Research checkpoint

New analysis note:
- `research/BUILD_SUPPLY_CHAIN_AND_IDEMPOTENCY_NEXT_RESEARCH_2026-10-03.md`

Key retained directions:
1. finish current one-shot candidate before builder topology churn;
2. future reusable producer workflow can be a separate SLSA Build L3 migration;
3. keep provenance verification policy explicit and machine-readable;
4. preserve an offline-verifiable attestation packet;
5. implement admission retry only after a database-transaction idempotency ledger exists;
6. current P0 `automatic_retry_allowed=false` remains correct.

## Next safe action

1. wait for the current attempt-1 matrix to reach terminal state;
2. diagnose first independent red failures only;
3. never rerun this exact SHA/version;
4. if source changes are required, fork a source-only successor and allocate another package identity after qualification;
5. if the matrix is fully green, record exact installer SHA, candidate artifact, SLSA attestation, SBOM/build identity and all ten terminal runs before any release/promotion decision.
