# W1 STEP08 — protected host identity preflight

Status: RESEARCH_AFTER_COMPLETE / PREPARE_ONLY pending exact-final-head CI  
Canonical target: C1 — First Real Linux Worker  
Level-2 milestone: `W1_PERSISTENT_LINUX_WORKER_SAFETY`

## Goal

Eliminate the last operator-substitutable identity inputs from the W1 live AWS preflight before any real reboot is considered.

The existing W1 reboot workflow already has a strong protected-environment/OIDC boundary, but its manual dispatch still accepts `instance_id` and `worker_id`. Production control state currently contains no Linux backend binding and no accepted reboot receipt that could independently resolve those values. Therefore a human-supplied instance/worker pair must not become the next authority boundary.

STEP08 adds a **separate preflight-only workflow** whose host identity comes only from protected environment variables and whose code contains no real reboot path.

## Mandatory research before implementation

### 1. Live roadmap state makes W1 the mainline bottleneck

Supervisor audit #25 records:

- `W1_PERSISTENT_LINUX_WORKER_SAFETY = READY`;
- canonical C1 remains `IN_PROGRESS`;
- `w1_verified=false`;
- no workflow dispatch, AWS API call, reboot, provider receipt, worker proof or C1 promotion occurred in STEP07;
- required next: an **explicit preflight-only workflow dispatch** against a real protected environment and existing W1 host, with **no reboot until the resulting preflight evidence is reviewed**.

This step therefore does not extend R1 or add another W1 architecture abstraction. It narrows the exact activation boundary required by the supervisor.

### 2. Production DB currently has no authoritative persistent-host identity

Read-only production inspection before implementation found:

- `compute_fabric_linux_worker_backend_binding_h205f22`: 0 rows;
- `compute_fabric_worker_reboot_receipt_h205f22`: 0 rows;
- the only `cpu-local` enrollments are historical revoked canaries;
- the remaining discovered enrollment is an `edge-remote` Cloudflare pilot, not the W1 persistent Linux host.

Therefore STEP08 does **not** derive `instance_id` or `worker_id` from Supabase and does not create a backend binding. Doing so without real provider evidence would manufacture authority.

### 3. Protected environment variables are a better host-identity source than dispatch inputs

GitHub Actions environments support protection rules, required reviewers, Prevent self-review and deployment branch restrictions. Environment variables are available through the `vars` context to jobs that reference that environment.

STEP08 therefore expects the non-secret identity values to be maintained as environment variables in `w1-persistent-host-proof`:

- `W1_AWS_INSTANCE_ID`;
- `W1_WORKER_ID`;
- existing `W1_AWS_ROLE_ARN`;
- existing `W1_AWS_ACCOUNT_ID`;
- existing `W1_AWS_REGION`.

The connected GitHub tool cannot read environment variable values or invoke `workflow_dispatch`. Their existence is therefore deliberately **not claimed** at merge time. The future live job fails closed if any value is absent or malformed.

Sources:
- https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
- https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments
- https://docs.github.com/en/actions/reference/workflows-and-actions/variables

### 4. EC2 resource-tag conditions can bind reboot permission to worker/code identity

AWS IAM supports resource-tag ABAC conditions, and EC2 `RebootInstances` supports resource-level authorization with `aws:ResourceTag` conditions.

The STEP08 session policy therefore binds the single exact instance ARN to all of these values simultaneously:

- `metaengine:project = H205F22`;
- `metaengine:milestone = W1_PERSISTENT_LINUX_WORKER_SAFETY`;
- `metaengine:worker_id = <protected W1_WORKER_ID>`;
- `metaengine:github_sha = <current work/w1-linux-worker-safety SHA>`;
- `metaengine:authority = noncanonical-worker`;
- `metaengine:execution_tier = persistent-host`.

The same worker id and W1 SHA must then independently pass the existing `aws_provider_reboot_controller.py validate-preflight` host-tag checks.

Sources:
- https://docs.aws.amazon.com/IAM/latest/UserGuide/access_tags.html
- https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazonec2.html

### 5. DryRun is a permission check, not a reboot

AWS EC2 documents `DryRun=true` as a permission test:

- when the caller has permission the request returns `DryRunOperation`;
- when the caller lacks permission it returns `UnauthorizedOperation`;
- the requested EC2 operation itself is not performed.

The new workflow contains exactly one `aws ec2 reboot-instances` command and that command includes `--dry-run`. There is no `execute_reboot` input and no real-reboot confirmation token/path.

Source:
- https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_RebootInstances.html

### 6. DryRun necessarily means the temporary session has reboot permission

A meaningful DryRun can succeed only when the assumed role/session would be allowed to perform the real call. This is an unavoidable residual capability of the permission check.

STEP08 compensates by requiring all of the following simultaneously:

1. pre-existing protected environment;
2. required independent reviewer(s);
3. Prevent self-review;
4. deployment-branch compatibility with `main`;
5. exact main-branch workflow dispatch;
6. exact environment-provided instance identity;
7. exact environment-provided worker identity;
8. exact current W1 implementation SHA tag;
9. exact AWS account and region;
10. one exact instance ARN;
11. six resource-tag conditions;
12. 15-minute OIDC credentials;
13. credentials exported as action step outputs only;
14. only host-surface capture and DryRun steps receive AWS credentials;
15. the workflow contains no non-DryRun reboot command.

This step does **not** claim that these controls make a future reviewed code modification impossible. It establishes a narrowly scoped and auditable permission-check boundary; branch/environment review remains part of the trust model.

### 7. Existing W1 host-safety verifier remains authoritative for the host surface

STEP08 does not reimplement the W1 safety envelope. It reuses the current `aws_provider_reboot_controller.py` checks for:

- exact instance identity;
- running state;
- exact worker and GitHub SHA tags;
- IMDSv2 required;
- IMDS hop limit 1;
- encrypted gp3 root EBS;
- no inbound security-group rules;
- exact security-group set.

STEP08 only adds protected identity/session binding around that existing verifier.

## Implementation

### `controller/w1/aws_persistent_host_preflight_guard.py`

Pure, credential-free guard with three related contracts.

#### Deployment compatibility

`validate_deployment_compatibility(...)` prevents a protected environment from looking valid in metadata while being unroutable from the actual `main` branch.

It permits exactly two modes:

- environment `protected_branches=true` **and** GitHub reports `main.protected=true`;
- environment `custom_branch_policies=true` and the custom deployment policy list contains exactly one explicit `main` rule.

A wildcard-only custom rule is intentionally insufficient for the STEP08 receipt. The output is self-hashed and non-authoritative.

#### Protected session boundary

`build_session_boundary(...)` validates and binds:

- EC2 instance id;
- worker id;
- exact 40-hex W1 SHA;
- AWS account id;
- AWS region.

It emits an exact policy containing only:

- `DescribeInstances` / `DescribeVolumes` / `DescribeSecurityGroups` read surface;
- `RebootInstances` on the exact instance ARN with the six required resource-tag conditions.

The receipt explicitly records:

- `real_reboot_requested=false`;
- `dry_run_required=true`;
- `provider_execution_authorized=false`;
- `persistent_worker_proof=false`;
- `w1_verified=false`;
- `canonical=false`;
- `authority_effect=false`.

#### Final protected-host preflight binding

`finalize_preflight_binding(...)` independently validates:

- the existing GitHub environment preflight receipt + self-hash;
- the deployment-compatibility receipt + self-hash;
- the session-boundary self-hash and exact policy reconstruction;
- the existing AWS host preflight summary;
- exact instance / worker / W1 SHA equality across those planes;
- an exact `DryRunOperation` result.

Its output still states:

- no reboot requested/performed;
- no backend binding created;
- no persistent worker proof;
- W1 unverified;
- C1 not promoted;
- required next is Supervisor review before any real reboot.

### `.github/workflows/w1-aws-persistent-host-preflight.yml`

This is intentionally separate from the existing real-reboot-capable workflow.

Manual input:

- exact confirmation `PREFLIGHT_W1_PERSISTENT_HOST_ONLY` only.

It does **not** accept instance id or worker id as inputs.

Jobs:

1. `contract-tests`: PR/dispatch tests only.
2. `preflight-environment`: main-ref + confirmation gate, read-only GitHub environment metadata, actual `main` branch metadata and, when needed, custom deployment-policy validation; no AWS credentials.
3. `host-preflight`: protected environment, W1 SHA resolution, exact session-boundary construction, 15-minute output-only OIDC, read-only host surface capture, existing W1 host validation, one `RebootInstances --dry-run`, credential-free final binding, direct evidence upload.

The workflow contains no CloudTrail lookup and no provider-reboot receipt creation because no reboot occurs.

## Tests before first independent CI

Adversarial tests cover:

- protected-branches mode with protected and unprotected `main`;
- custom deployment mode requiring an exact `main` rule rather than wildcard only;
- exact instance/worker/SHA tag-bound session policy;
- invalid/control-character identities;
- recomputed self-hash policy forgery;
- environment receipt self-review downgrade;
- worker mismatch;
- W1 SHA mismatch;
- rejection of any DryRun marker other than `DryRunOperation`;
- strict non-authority final receipt.

Workflow static checks additionally require:

- no `execute_reboot` path;
- no real reboot confirmation token;
- no `inputs.instance_id` / `inputs.worker_id`;
- environment vars for host identity;
- actual `main` branch + deployment policy REST checks before publishing the environment name;
- exactly one `reboot-instances` command and it contains `--dry-run`;
- one OIDC credential configuration;
- no AWS credential outputs after the DryRun step.

## First independent CI

Initial PR head `c27f1fcf6453dc1743f22c088c501d34d82a398e` ran:

- `W1 AWS Persistent Host Preflight Only` run #1 — SUCCESS;
- contract/adversarial tests — SUCCESS;
- `preflight-environment` — SKIPPED on PR;
- `host-preflight` — SKIPPED on PR.

That green result was **not** used as a merge signal. Mandatory research-after followed.

## Mandatory research after implementation

### A. GitHub deployment-policy compatibility exposed a real operational edge

Fresh GitHub API inspection during research-after reports the repository `main` branch with `protected=false` and branch-protection enforcement off.

GitHub documentation states that when an environment has `deployment_branch_policy.protected_branches=true`, only branches with branch-protection rules can deploy to that environment. Custom deployment branch policies are a separate mode and can explicitly permit patterns such as `main`.

Therefore the original environment-shape check was insufficient: a configuration could satisfy the environment JSON validator but still be unable to route the `main` workflow into the protected job.

STEP08 was hardened before merge:

- fetch actual `/branches/main` metadata;
- when environment mode is `protected_branches`, require `main.protected=true`;
- when environment mode is `custom_branch_policies`, fetch the read-only deployment-policy list and require one explicit `main` policy;
- bind that result into the final preflight receipt.

Current nonclaim: because `main` is presently reported unprotected, a future live run **cannot** rely on `protected_branches=true` mode unless branch protection is actually enabled first. The alternative is an environment custom branch policy that explicitly permits `main`. The connected tool cannot read the current environment settings, so neither configuration is claimed to exist.

Sources:
- https://docs.github.com/en/rest/deployments/environments
- https://docs.github.com/en/rest/deployments/branch-policies
- https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments

### B. Environment variables remain an appropriate non-secret identity channel

Fresh GitHub docs reconfirmed:

- protection rules pass before an environment job is sent to a runner;
- environment secrets become accessible only after protection rules pass;
- environment variables are scoped to jobs referencing the environment and accessed through `vars`;
- variables are not secret/masked, so STEP08 uses them only for non-sensitive instance/worker/account/region/role identifiers.

No protected environment variable value was observable through the connected tool, so readiness is not inferred from documentation alone.

### C. DryRun semantics remain exactly the required boundary

Fresh AWS API docs reconfirmed that `RebootInstances` with DryRun checks permissions without making the reboot request and returns `DryRunOperation` when the permission check succeeds, otherwise `UnauthorizedOperation`.

The final workflow still contains one and only one `aws ec2 reboot-instances` command, and that command includes `--dry-run`.

The residual capability remains explicit: the short-lived session has real `RebootInstances` permission for the exact tagged host during its lifetime because otherwise DryRun cannot validate it. The mitigation is defense-in-depth rather than pretending the permission does not exist: exact instance, six resource tags, protected review, exact code SHA tag, 15-minute OIDC credentials, output-only credential handling and no non-DryRun call in the workflow.

Source:
- https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_RebootInstances.html

### D. Credential exposure remains confined to two AWS-calling steps

Implementation review and static CI confirm:

- the environment and deployment-policy jobs have no OIDC or AWS credentials;
- host identity/session policy is built before credentials;
- AWS credentials are output-only from the pinned `configure-aws-credentials` action;
- only host-surface capture and RebootInstances DryRun steps receive the three AWS credential values;
- final binding and artifact upload occur after those step-scoped credential environments disappear;
- no DB credential exists anywhere in STEP08.

Receipts persist identities, tag requirements, policy hashes and non-authority flags, not AWS access keys/session tokens.

### E. Production W1 state remains unchanged

Read-only production DB inspection after the implementation/amendment CI reports:

- Linux backend bindings: 0;
- worker reboot receipts: 0;
- Linux safety observations: 0;
- Linux safety verifications: 0;
- admitted `cpu-local` workers: 0.

Therefore no PR action leaked synthetic/live W1 facts into production.

### F. Amendment CI after deployment-compatibility hardening

Head `e90539325ed9f5d059214204127b33943ec71da2` ran:

- `W1 AWS Persistent Host Preflight Only` run #4 — SUCCESS;
- `Compute Fabric Governance` run #90 — SUCCESS;
- `contract-tests` — SUCCESS;
- `preflight-environment` — SKIPPED on PR;
- `host-preflight` — SKIPPED on PR.

These signals validate the implementation before this research-after record, but they are intentionally invalidated as final merge signals by this documentation commit. A new exact-head CI/Governance run is mandatory.

## Strict nonclaims after research-after

At research-after completion:

- the new workflow has not been manually dispatched;
- the connected GitHub tool cannot dispatch it;
- existence/values of `W1_AWS_INSTANCE_ID`, `W1_WORKER_ID`, AWS role/account/region environment variables are not claimed;
- current protected-environment deployment mode is unknown;
- existence of a real W1 EC2 host is not claimed;
- no AWS API call or DryRun has occurred from STEP08;
- no EC2 reboot has occurred;
- no provider reboot receipt exists;
- no Linux backend binding has been created;
- no live Linux safety observation/verification has been created;
- `persistent_worker_proof=false`;
- `w1_verified=false`;
- canonical C1 is not promoted.

## Final merge gate

Only an exact-final-head rerun after this research-after commit may authorize merge. It must show:

1. STEP08 guard/adversarial tests SUCCESS;
2. existing W1 reboot-controller/live-boundary regressions SUCCESS;
3. static proof of one DryRun-only reboot command and no real-reboot path SUCCESS;
4. deployment-compatibility tests SUCCESS;
5. `preflight-environment` SKIPPED on PR;
6. `host-preflight` SKIPPED on PR;
7. Compute Fabric Governance SUCCESS.

Even after merge, STEP08 remains PREPARE_ONLY. The next live action is an **externally initiated preflight-only dispatch** after the protected environment has real identity variables and a deployment policy compatible with `main`. Its evidence must be reviewed by the Supervisor before any separate real reboot workflow is allowed to run.
