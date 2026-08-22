# W1 STEP09 — Ephemeral Dispatch Transport Research Before / After

Date: 2026-08-22
Target: `W1_PERSISTENT_LINUX_WORKER_SAFETY -> C1 First Real Linux Worker`
Semantic head: `metaengine-h205f22-recovery-dev-20260821-cp072`
Exact main: `a6d33bfc5b85a3efce16c15620240e1ff0b1acb8`
Active W1 authority at execution gate: claim `#18`, holder `aop1:W1_IMPLEMENTER`.

## Research Before

### Why this transport exists

The persistent AOP1 W1 dispatch bridge is deployed, but its live health correctly reports `github_configured=false` / `github_auth_mode=none` because GitHub App runtime credentials and the new `Actions: write` installation permission are not yet configured. Waiting for that administrative gate would not improve W1 safety evidence.

This one-shot transport uses only the repository-native, job-scoped `GITHUB_TOKEN` to invoke the already-reviewed STEP08 workflow. It does not alter STEP08, does not add AWS credentials, and does not expose any real-reboot capability.

### Findings before execution

1. GitHub creates a repository-scoped `GITHUB_TOKEN` for each Actions job and expires it after the job.
2. Workflow permissions can be narrowed explicitly; the dispatcher needs only `actions: write` to create the workflow-dispatch event and `contents: write` to persist a sanitized one-shot receipt on its isolated branch.
3. Events created with `GITHUB_TOKEN` normally do not recursively start workflows, but `workflow_dispatch` and `repository_dispatch` are documented exceptions.
4. GitHub REST API `2026-03-10` supports `return_run_details=true` for workflow dispatch and returns the exact run id/URLs.
5. STEP08 on `main` remains PREPARE_ONLY: it contains only `EC2 RebootInstances --dry-run`, not a real reboot request. Environment policy, GitHub deployment compatibility, protected host identity, AWS OIDC and DryRun authorization remain independent fail-closed gates inside STEP08.

### One-shot safety design

- Branch pinned from exact `main` at `a6d33bfc5b85a3efce16c15620240e1ff0b1acb8`.
- Dispatcher triggered only by adding its own workflow file on `ops/w1-step08-one-shot-20260822`.
- Job guard required `github.actor_id == '20597814'` and the exact branch ref.
- Target workflow fixed to `w1-aws-persistent-host-preflight.yml`.
- Target ref fixed to `main`.
- Confirmation fixed to `PREFLIGHT_W1_PERSISTENT_HOST_ONLY`.
- Existing one-shot receipt causes fail-closed refusal before dispatch.
- Successful dispatch persists a sanitized receipt containing target run id/URL and explicit nonclaims.
- No arbitrary workflow, ref, input, AWS call or real-reboot capability is exposed by the transport.

## Execution Evidence

Dispatcher source SHA: `fffc07d105bf33ffc41053be79280a10421b993b`.

Durable dispatch receipt: `evidence/w1-step08-one-shot-dispatch.json`.

Target STEP08:

- workflow run id: `32596677443`;
- event: `workflow_dispatch`;
- exact head: `a6d33bfc5b85a3efce16c15620240e1ff0b1acb8` (`main`);
- run number: `6`;
- final conclusion: `failure`.

Observed job sequence:

1. `contract-tests`: **SUCCESS**.
   - exact workflow checkout: success;
   - protected-host preflight tests: success;
   - preflight-only trust-zone contract validation: success.
2. `preflight-environment`: **FAILURE**.
   - exact main checkout: success;
   - exact `PREFLIGHT_W1_PERSISTENT_HOST_ONLY` confirmation guard: success;
   - first credential-free request to `GET /repos/PatrickFrome/Compute/environments/w1-persistent-host-proof`: HTTP `404`;
   - environment validation, deployment compatibility artifacts, AWS OIDC and host-preflight jobs did not proceed.

No AWS credential configuration ran. No AWS API call or EC2 DryRun ran. No real reboot was requested or performed.

## Research After

### 404 classification

Current GitHub REST documentation says `Get an environment` can be used by anyone with repository read access; fine-grained tokens need only repository `Actions: read`, and public environment metadata can be requested without authentication. The failed STEP08 job had `Actions: read`, `Contents: read`, and `Metadata: read` on a public repository.

Therefore the observed HTTP `404` is not explained by insufficient STEP08 token permission. The evidence is consistent with the exact environment `w1-persistent-host-proof` not existing at execution time (or not existing under that exact name).

### Empty auto-created environment is rejected

The checked-in W1 live boundary guard requires all of the following before AWS credentials can be released:

- exact environment identity `w1-persistent-host-proof`;
- exactly one `required_reviewers` protection rule;
- a non-empty reviewer list;
- `prevent_self_review=true`;
- a `branch_policy` protection rule;
- a valid deployment branch policy with exactly one of `protected_branches` or `custom_branch_policies` enabled.

Therefore auto-creating an empty environment would not satisfy the W1 safety contract and is not an acceptable workaround.

### Administrative boundary

Current GitHub REST documentation requires repository `Administration: write` to create/update an environment, and `Environments: write` to create/update environment variables/secrets. The job-scoped `GITHUB_TOKEN` cannot be elevated to repository Administration permissions through workflow `permissions`.

The connected GitHub connector currently exposes no environment-administration or branch-protection mutation action. The existing GitHub App installation is visible, but its environment administration surface is not exposed to this session. Consequently this semantic step correctly stops before modifying repository administration state rather than weakening STEP08.

## Production Truth After Execution

- STEP08 was genuinely dispatched against exact `main`.
- STEP08 contract tests passed.
- Physical GitHub environment gate was reached and failed closed before AWS credentials.
- The missing required environment is now an observed external blocker rather than a hypothesis.
- No W1 live evidence row should be promoted from this run.

## Required Next Physical Configuration

Create/configure GitHub Environment `w1-persistent-host-proof` with:

1. at least one independent required reviewer;
2. `prevent_self_review=true`;
3. deployment branch policy compatible with exact `main`;
4. protected environment variables required by STEP08: `W1_AWS_INSTANCE_ID`, `W1_WORKER_ID`, `W1_AWS_ROLE_ARN`, `W1_AWS_ACCOUNT_ID`, `W1_AWS_REGION`;
5. AWS role trust/resource tags matching the existing W1 protected-host guard.

After this administrative configuration is externally present, rerun the exact STEP08 preflight-only workflow and review environment + AWS DryRun evidence before any real reboot is considered.

## Strict Nonclaims

`STEP08_DISPATCHED=true`, but `AWS_API_CALL=false`, `EC2_DRYRUN=false`, `NO_EC2_REBOOT`, `NO_BACKEND_BINDING`, `NO_PERSISTENT_WORKER_PROOF`, `W1_VERIFIED=false`, `NO_C1_PROMOTION`, `NO_CP073_SEAL`.
