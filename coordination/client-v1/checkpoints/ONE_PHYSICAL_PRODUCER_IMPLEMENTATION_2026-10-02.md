# One physical Package Smoke producer implementation checkpoint — 2026-10-02

Branch: `work/build-one-physical-producer-fence-v1`  
Qualified base: `4c3dd26f9d89bb5e5b04c1eb4a21a5c434dba86b`  
Implementation source before final reservation: `12ac3757e2a3868d4516a402ad51dd39e453b277`  
Reserved package identity: `0.7.0-dev.36977000001.1`

## Purpose

Build Identity V2 intentionally binds GitHub run id and run attempt and embeds that identity into packaged app metadata. A second physical workflow invocation for the same source/package version would therefore be distinguishable by Build Identity but could still create different installer bytes under one updater version.

This slice turns the existing operational rule “never rebuild the same package identity” into an executable Package Smoke producer fence.

## Implemented producer fence

Before any dependency install or electron-builder effect:

1. `package_identity_preflight` checks the exact source and rejects `GITHUB_RUN_ATTEMPT != 1`.
2. The physical Windows job depends on that preflight and uses package-version-scoped job concurrency with `cancel-in-progress:false`.
3. `package-build-reservation.mjs` queries GitHub repository artifact history using exact names for:
   - `metaengine-browser-package-version-<version>`;
   - `metaengine-browser-windows-candidate-<source_sha>`.
4. Any prior artifact from another run is a fail-closed collision.
5. API unavailability/invalid response is fail closed.
6. The current run uploads an immutable version-reservation artifact before dependency install.
7. Its artifact id and SHA-256 digest are sealed into `package-version-reservation-seal.json`.
8. Reservation proof/seal are carried into candidate and package-evidence artifacts.

No reservation grants release, update, task, Guardian, or Supervisor authority.

## Concurrency correction

The previous workflow-level:
`browser-windows-package-smoke-${{ github.ref }} / cancel-in-progress:true`
was removed.

That old policy could cancel an already-running physical producer after a later PR commit. The physical build is now protected by package-version job concurrency. A same-version later run waits; after the first run creates the reservation marker, the later run refuses before physical packaging.

## Parser incident

Intermediate workflow heads created Package Smoke validation records #3139-#3142. Each had:
- workflow name displayed as the raw YAML path;
- conclusion FAILURE;
- jobs = 0;
- artifacts = 0.

Root cause was one duplicate `timeout-minutes: 35` mapping key introduced around the new job-level concurrency block.

Corrective commit:
`98b60bbca79b1e4fa5c7843a952f495588e2ff1c`

After correction, pushes to the development branch no longer created parser-failure runs, consistent with its valid push filters. No package identity was physically consumed by #3139-#3142.

## Tests

Added:
- `test/package-build-reservation.test.mjs`
  - first build admitted;
  - rerun attempt refused;
  - prior version reservation refused;
  - prior source candidate refused;
  - expired historical metadata remains collision evidence;
  - current-run artifacts ignored;
  - malformed input fails;
  - repository artifact API ambiguity fails closed;
  - exact artifact-name queries.
- `test/package-build-reservation-workflow.test.mjs`
  - reservation precedes dependency install and electron-builder;
  - one physical build step;
  - one candidate upload;
  - one evidence upload;
  - no workflow-level cancellation;
  - one timeout key;
  - immutable reservation artifact id/digest sealed.

## External research used

GitHub primary documentation confirms:
- `jobs.<job_id>.concurrency` can use the `needs` context;
- concurrency groups serialize jobs;
- repository Actions artifact records include producing workflow run/head metadata;
- upload-artifact v4+ artifacts are immutable and expose artifact-id/artifact-digest;
- workflow reruns preserve source/ref but advance run attempt.

Research is preserved on `analysis/build-identity-v2-next-stage-4c3dd26`.

## Version discipline

Latest repository Actions run id observed before reservation:
`36975111718`.

Reserved successor:
`0.7.0-dev.36977000001.1`.

The previous fully qualified package `0.7.0-dev.36974000001.1` is consumed.

The four parser-failure runs did not run any job and produced zero artifacts, so they did not create physical successor bytes.

Once the draft PR starts Package Smoke for this exact source, `0.7.0-dev.36977000001.1` becomes consumed regardless of whether NSIS is reached. Any later source fix must advance package identity before another physical build.

## Qualification required

- exact-head Browser Shell/Critical Audit;
- Package Smoke reservation preflight + marker + one installer;
- v2 Build Identity/provenance;
- Installed Chat;
- Final Runtime;
- Autonomous Soak;
- Self Update;
- exact producer run/attempt and reservation evidence shared by all physical consumers.

Promotion remains unauthorized.
