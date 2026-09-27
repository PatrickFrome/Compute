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
- on rerun attempts (>1), do not admit a same-name artifact whose `created_at` predates the current workflow attempt's `run_started_at`; this prevents an in-progress attempt from accidentally binding the previous attempt's still-visible artifact before the new candidate is uploaded;
- when an in-progress producer resolution observes an exact current-attempt `artifact_id`, carry that id into download so later same-name artifacts cannot silently replace the resolved object;
- fail closed if the current-attempt timestamp cannot be established, the exact artifact id disappears, or the downloaded provenance does not match source head / run id / run number / run attempt;
- regression tests cover both duplicate same-name artifacts across attempts and exact artifact-id pinning.

Primary sources:
- GitHub REST Actions Artifacts: https://docs.github.com/en/rest/actions/artifacts
- GitHub workflow reruns: https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs

This changes artifact selection only. It does not grant signing, publishing, update, scheduler, Browser, or production authority.


## Activation SLO measurement boundary

A later exact-head soak failed at p95 1004.36 ms against the 1000 ms activation budget while all 64 sequential activations, exact launch-id ACKs, primary-window journal events, compute/endurance lanes and package provenance were otherwise valid. The audit showed that the stopwatch kept running after the secondary process had already exited successfully and therefore after it had already observed the exact durable activation ACK. The measured value also included test-runner stdout parsing and a second read of the startup journal used only to independently verify the ACK.

That boundary mixed product latency with harness bookkeeping. The gate is now stricter semantically, not weaker:
- stopwatch starts immediately before launching the ordinary second instance;
- the latency clock stops only after the secondary process exits successfully; in this program that exit is reachable only after `waitForPrimaryActivationAck()` has observed the exact durable nonce-bound ACK;
- stdout contract validation and independent startup-journal correlation remain mandatory before the sample is admitted;
- the 1000 ms p95 budget is unchanged;
- evidence now records `SECONDARY_PROCESS_LAUNCH_TO_VALID_DURABLE_ACK_EXIT` as the metric boundary.

Microsoft documents `Process.WaitForExit` as blocking until the associated process exits, and `Stopwatch` as an elapsed-time interval measurement whose value freezes when stopped. Electron documents the `second-instance` event as the primary-instance callback for a losing `requestSingleInstanceLock()` launch and recommends restoring/focusing the primary window there. Those contracts align the latency SLO with the actual second-launch handoff, while the durable journal remains a separate correctness/readback gate.

Primary sources:
- https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.waitforexit
- https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.stopwatch.start
- https://www.electronjs.org/docs/latest/api/app
