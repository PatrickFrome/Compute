# Package-build reservation workflow parser incident — 2026-10-02

Development branch: `work/build-one-physical-producer-fence-v1`  
Qualified base: `4c3dd26f9d89bb5e5b04c1eb4a21a5c434dba86b`

## Incident

Early one-build reservation workflow edits produced four GitHub workflow validation failures:

| Run | Head | Result | Jobs | Artifacts |
| --- | --- | --- | ---: | ---: |
| #3139 / 36974979671 | `0da7ab77901fc3cc806e5d176fda0a3ef659462f` | FAILURE | 0 | 0 |
| #3140 / 36975051625 | `71edf96202dd53c4f43ae7cc1446b6da17b36d71` | FAILURE | 0 | 0 |
| #3141 / 36975082570 | `4ff3bbd1fd033c80d669106a91a67ac2e2c4ccac` | FAILURE | 0 | 0 |
| #3142 / 36975111718 | `2d8a083c70ce8556f336cf4d0349aec259224429` | FAILURE | 0 | 0 |

GitHub surfaced the workflow path rather than the declared workflow name and created no job records. No runner, dependency install, reservation artifact, NSIS build, candidate artifact, installer execution, or other physical effect occurred.

The inherited package `0.7.0-dev.36974000001.1` was therefore **not rebuilt** on these source heads. It remains the already-consumed Build Identity V2 qualified package and must still be advanced before a successor physical build.

## Exact parser defect

The modified `windows-nsis-package-smoke` job accidentally declared `timeout-minutes: 35` twice at the same YAML mapping level:

- first declaration before `concurrency`;
- second declaration after `concurrency`.

The duplicate mapping key made the GitHub workflow invalid.

Corrective commit:
`98b60bbca79b1e4fa5c7843a952f495588e2ff1c`

It:
- removed the duplicate timeout key;
- removed the old workflow-level `concurrency: ... cancel-in-progress: true`;
- retained only the package-version-scoped job concurrency with `cancel-in-progress: false`;
- added static regression assertions for one timeout key and absence of workflow-level cancellation.

After the corrective push, GitHub did **not** create another invalid-workflow run for `98b60bb…`, consistent with the branch not matching the valid workflow's push filters.

## Why workflow-level cancellation was removed

The old workflow-level group was keyed by PR/ref and used `cancel-in-progress: true`. In the new one-build design this could abort a physical producer when a later source commit appears on the same PR.

The physical producer now uses job-level concurrency keyed by the package version. GitHub's current context reference explicitly allows the `needs` context in `jobs.<job_id>.concurrency`, so the preflight job can expose the exact package version used as the serialization key.

GitHub documentation:
- https://docs.github.com/en/actions/reference/workflows-and-actions/contexts
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
- https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency

The one-build design intentionally does not cancel an in-progress physical producer.

## Artifact reservation evidence

The reservation path uses `actions/upload-artifact` output:
- artifact id;
- artifact digest.

The upload-artifact project documents v4+ artifacts as immutable after creation and exposes both outputs. The repository artifact REST response carries the producing workflow run id and head SHA.

References:
- https://github.com/actions/upload-artifact
- https://docs.github.com/en/rest/actions/artifacts

This supports durable collision evidence, but it is not treated as release authority.

## Current source state after incident

Current source branch contains:
- zero-authority package-build reservation evaluator;
- rerun attempt refusal;
- prior same-version marker refusal;
- prior same-source candidate refusal;
- fail-closed API handling;
- package-version-scoped non-cancelling job concurrency;
- immutable reservation marker uploaded before dependency install/electron-builder;
- static and unit regressions.

No PR is open for this successor yet. No successor package version has been physically built.

## Next gate

Before opening the successor PR:
1. finish source/research audit;
2. freeze source;
3. re-read latest repository workflow run ids;
4. reserve a fresh package identity above all observed physical/build namespaces;
5. update convergence/checkpoint atomically;
6. open a stacked draft PR on Build Identity V2;
7. once its Package Smoke runner starts, treat that identity as consumed;
8. no workflow rerun is permitted as a way to obtain a second physical package for the same source/version.
