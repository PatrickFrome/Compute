# One-source / one-build collision research — 2026-10-02

Base source reviewed: `4c3dd26f9d89bb5e5b04c1eb4a21a5c434dba86b`

This is analysis only. No change is made to the running PR #1091 qualification.

## New risk found after Build Identity V2

Build Identity V2 deliberately includes:
- GitHub run id;
- GitHub run attempt.

It is embedded into packaged `package.json`, so it contributes to final installer bytes.

That is correct provenance behavior: two build invocations are distinguishable.

It also means a GitHub **re-run of the same source and package version will intentionally produce a different Build Identity and potentially different installer bytes under the same semantic package version**.

This is not a Build Identity digest defect. It is a missing one-build policy fence.

## GitHub primary-source behavior

GitHub documents that a workflow can be re-run using the original run, preserving the original `GITHUB_SHA` and `GITHUB_REF`, with previous attempts separately reviewable.

Reference:
https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs

The METAENGINE Build Identity already observes `run_attempt`, so a re-run cannot impersonate the first invocation.

But updater/package identity uses the Browser package version, not Build Identity SHA, so two physical builds with:
- same source SHA;
- same package version;
- different run attempt/run id;
can still be semantically colliding runtime identities.

## Existing consumer behavior

`installer-provenance.mjs resolveRun()`:
- finds Package Smoke runs for an exact `head_sha`;
- binds the selected run id/number/attempt;
- when acquiring from an in-progress producer, pins the exact artifact id;
- `qualified-installer-consumer.ps1` persists that exact producer run + attempt;
- downstream `Wait` rechecks the same binding.

Therefore downstream consumers cannot silently substitute a different attempt after acquisition.

This is strong **consumer binding**, but it does not itself prevent two different producer attempts from manufacturing two sets of bytes for the same package version.

## Required invariant

For releasable Browser bytes:

> one semantic package version + one source SHA -> at most one physical Package Smoke build invocation.

A second physical producer invocation must fail **before packaging** and instruct development to advance source/package identity.

## Minimal successor fence

### Gate A — rerun attempt fence

Before dependency install/package build in the official Package Smoke producer:

- require `GITHUB_RUN_ATTEMPT == 1`;
- if attempt > 1: fail with a typed `package_identity_rerun_requires_new_source_and_version`;
- do not run electron-builder;
- do not upload a candidate artifact.

This converts the current social rule “never blind-rerun a physical build” into executable policy.

### Gate B — duplicate-run/source fence

A run-attempt fence is necessary but not sufficient: a second independent workflow run can theoretically target the same head/version with attempt 1.

Before physical packaging, query Package Smoke history for the exact source SHA and inspect prior runs/artifacts.

Fail if another run id for the exact head already has the source-scoped candidate artifact:
`metaengine-browser-windows-candidate-<head>`.

The current run id is excluded.

This detects that physical bytes have already been materialized for this source even if a second event creates another run object.

### Gate C — version/source collision fence

The stronger invariant is semantic package version uniqueness across source heads.

Before packaging:
- parse the reserved package version;
- search prior Package Smoke provenance/evidence for that version;
- if the same version was already physically materialized by a different source SHA, fail before package build.

Existing historical collision evidence in `CONVERGENCE_CANDIDATE.md` shows this can occur during fast source iteration; the guard should be mechanical, not documentation-only.

A bounded implementation should prefer immutable GitHub Package Smoke artifacts/provenance as the read source. It should **not** create another mutable database authority plane.

## API/permissions boundary

GitHub workflow-run and artifact REST APIs provide the evidence needed for the read-only collision check.

The Package Smoke job should be granted only the minimal read permission needed for its own Actions metadata/artifacts. No write permission is needed for collision observation beyond the existing artifact upload mechanism.

If the API is unavailable:
- fail closed before physical package build;
- do not assume uniqueness from absence of readback.

## Why this should precede dependency-lock hardening

The next planned supply-chain slice was lockfile + `npm ci`.

That remains important, but one-build collision fencing is logically earlier because:
- Build Identity V2 itself makes invocation identity part of packaged bytes;
- re-running an exact source can therefore create different bytes under the same updater version;
- a lockfile does not solve semantic package-version collision.

Recommended order:

1. qualify Build Identity V2;
2. add **one-source / one-version / one-physical-build** producer fence;
3. then add committed lockfile + `npm ci` + lockfile SHA;
4. then release-boundary artifact attestation/SBOM.

## Consumer rule remains unchanged

Downstream physical workflows should continue:
- acquiring exactly one Package Smoke artifact;
- pinning exact run id/number/attempt/artifact;
- re-verifying Build Identity/dependency/config/installer digest;
- waiting for the same producer to become terminal SUCCESS.

Do not make consumers “pick a winner” among colliding physical producer runs. Collision must be stopped at the producer.

## Test plan

Add unit/static tests that prove:
- run attempt 1 passes the pre-build invocation fence;
- run attempt 2+ fails before electron-builder;
- an older candidate artifact for the same source causes duplicate-run refusal;
- same package version previously materialized under another source causes version/source refusal;
- API ambiguity/error is fail-closed;
- no collision check has release/promotion authority;
- no candidate upload happens before the collision gate.

## Authority

This proposal is build-safety only:
- no release authority;
- no updater effect;
- no Supervisor authority;
- no Guardian authority;
- no scheduler/task authority;
- no automatic retry.


## GitHub repository artifact lookup refinement

GitHub's Actions Artifacts REST API supports repository-wide artifact listing with an exact `name` query and returns each artifact's workflow-run id and head SHA.

Reference:
https://docs.github.com/en/rest/actions/artifacts

This makes the same-source duplicate check cheaper and more direct:
- query exact source-scoped candidate artifact name;
- reject any live artifact whose workflow run id differs from the current run.

It also suggests a possible future lightweight version-evidence artifact, but that is **not yet sufficient as an atomic version reservation** because artifact names are scoped to runs rather than globally unique. Two concurrent runs could theoretically both observe absence before uploading their own same-name marker.

Therefore:
- repository artifact lookup is suitable as **collision evidence**;
- it should not be mislabeled as a globally atomic semantic-version allocator.

The immediate mechanizable hard gate remains `GITHUB_RUN_ATTEMPT == 1` plus prior same-source candidate-artifact refusal. Cross-head semantic-version uniqueness still requires either a stronger reservation mechanism or continued source-side reservation discipline until a bounded atomic design is qualified.
