# METAENGINE R96 release convergence audit

Date: 2026-09-27

## Exact inputs

- R95C.1 geometry hardening: `19ca6863658eab11eb7d4e5c9ef04de85f6db94e`
- R95F exact AgentChat drill revalidation: `209e4669707151e0665a0bb3f9a43c6eacbf1d4b`
- R96D Peek/accessibility stack: `364c5f88ccf8252b6b0cb95db543b738cbdfb26a`
- Common proven ancestor: `4e88bc049903ab098c3fc59f1d00c122ec546dd5` (R95C)

## Convergence method

The three stacks touch disjoint production file sets:
- R95C.1: RUN BrowserPage + native shell-layout telemetry breakpoint.
- R95F: COMMAND context drill + Command Palette exact AgentChat binding + session refresh contract.
- R96D: Task/Agent Peek presentation plane and keyboard semantics.

No history was blindly merged. The convergence tree starts from the full R96D tree and selectively takes the exact changed blobs from R95C.1 and R95F. The commit records all three exact heads as parents so ancestry remains explicit.

## Invariants preserved

- UI/Peek remains zero-authority.
- Native Browser pixels stay protected by main-process geometry.
- Agent.id is never treated as AgentChatSession.id.
- stale/in-flight AgentChat data cannot grant an exact chat binding.
- Space Peek is focus-scoped and does not steal nested native controls.
- retry/reflection SVG actions remain the same existing callbacks; keyboard support adds no new effect route.
- no scheduler, DB, Edge, self-update, release, signing or production authority is introduced.

## Remaining release gates

This convergence head is not release-qualified until exact-head Critical Audit, Shell, Package Smoke, Installed Chat, Final Runtime Activation, Autonomous Soak and Self Update E2E are all terminal green.

A separate lineage audit is required for the four Guardian-only commits unique to `integration/metaengine-development-os-v1`; they are not silently ported here because process-effect authority deserves an isolated falsifiable convergence slice.


## Run-attempt artifact identity

A physical qualification rerun exposed a provenance defect that the earlier single-attempt tests did not cover. GitHub keeps multiple artifacts with the same name under one workflow run after reruns, while the workflow run identity advances through `run_attempt`. The consumer listed artifacts by run and selected the first matching name, so an attempt-2 consumer could download the attempt-1 installer and then correctly fail provenance verification with `producer_run_attempt_mismatch`.

GitHub's REST API documents workflow-run artifact listing as a collection and gives every artifact a unique `artifact_id`; reruns are separate attempts of the same workflow run. Therefore name + run_id is not a sufficient immutable locator once a run has been rerun.

R96 release hardening:
- when downloading by name from a completed producer, choose the newest same-name artifact by `created_at` with artifact id as a deterministic fallback, then keep the existing provenance verification;
- when an in-progress producer resolution already observed an exact `artifact_id`, carry that id into download so later same-name artifacts cannot silently replace the resolved object;
- fail closed if the exact artifact id disappears or the downloaded provenance does not match source head / run id / run number / run attempt;
- regression tests cover both duplicate same-name artifacts across attempts and exact artifact-id pinning.

Primary sources:
- GitHub REST Actions Artifacts: https://docs.github.com/en/rest/actions/artifacts
- GitHub workflow reruns: https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs

This changes artifact selection only. It does not grant signing, publishing, update, scheduler, Browser, or production authority.
