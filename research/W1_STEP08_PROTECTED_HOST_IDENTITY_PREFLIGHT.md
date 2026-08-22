# W1 STEP08 — protected host identity preflight

Status: IMPLEMENTED / PREPARE_ONLY pending independent CI, mandatory research-after and exact-final-head gate  
Canonical target: C1 — First Real Linux Worker  
Level-2 milestone: `W1_PERSISTENT_LINUX_WORKER_SAFETY`

## Goal

Eliminate the last operator-substitutable identity inputs from the W1 live AWS preflight before any real reboot is considered.

The existing W1 reboot workflow already has a strong protected-environment/OIDC boundary, but its manual dispatch still accepts `instance_id` and `worker_id`. Production continuity/control state currently contains no Linux backend binding and no accepted reboot receipt that could independently resolve those values. Therefore a human-supplied instance/worker pair must not become the next authority boundary.

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

GitHub Actions environments support protection rules, required reviewers, Prevent self-review and deployment branch restrictions. Environment variables are available through the `vars` context to jobs that reference that environment. The environment is already independently validated before its name is supplied to the credential-bearing job.

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
- https://docs.github.com/en/actions/learn-github-actions/contexts#vars-context

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
4. branch protection;
5. exact main-branch workflow dispatch;
6. exact environment-provided instance identity;
7. exact environment-provided worker identity;
8. exact current W1 implementation SHA tag;
9. exact AWS account and region;
10. one exact instance ARN;
11. six resource-tag conditions;
12. 15-minute OIDC credentials;
13. credentials exported as action step outputs only;
14. only two AWS-calling steps receive those credentials;
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

Pure, credential-free guard with two contracts.

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
2. `preflight-environment`: main-ref + confirmation gate, read-only GitHub environment metadata validation, no AWS credentials.
3. `host-preflight`: protected environment, W1 SHA resolution, exact session-boundary construction, 15-minute output-only OIDC, read-only host surface capture, existing W1 host validation, one `RebootInstances --dry-run`, credential-free final binding, direct evidence upload.

The workflow contains no CloudTrail lookup and no provider-reboot receipt creation because no reboot occurs.

## Tests before first independent CI

Adversarial tests cover:

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
- exactly one `reboot-instances` command and it contains `--dry-run`;
- one OIDC credential configuration;
- no AWS credential outputs after the DryRun step.

## Strict nonclaims before research-after

At implementation time:

- the new workflow has not been manually dispatched;
- the connected GitHub tool cannot dispatch it;
- existence/values of `W1_AWS_INSTANCE_ID` and `W1_WORKER_ID` are not claimed;
- existence of a real W1 EC2 host is not claimed;
- no AWS API call or DryRun has occurred from STEP08;
- no EC2 reboot has occurred;
- no provider reboot receipt exists;
- no Linux backend binding has been created;
- no live Linux safety observation/verification has been created;
- `persistent_worker_proof=false`;
- `w1_verified=false`;
- canonical C1 is not promoted.

## Mandatory research after implementation before merge

After the first independent PR CI signal, merge remains forbidden until all are rechecked:

1. inspect every failing CI step and distinguish static-test defects from contract defects;
2. verify the final workflow contains no non-DryRun reboot path;
3. recheck current GitHub environment-variable/protection semantics;
4. recheck EC2 DryRun and `aws:ResourceTag` support for `RebootInstances`;
5. audit the exact inline session policy and prove the worker/SHA tags cannot be removed by a recomputed receipt hash;
6. review the residual capability inherent in granting Reboot permission for DryRun and confirm credential scope/lifetime/job isolation remain minimal;
7. verify provider credentials appear only in host-surface and DryRun steps;
8. verify environment/identity receipts contain no secret material;
9. recheck production DB backend-binding, reboot-receipt, safety-observation and safety-verification counts remain unchanged;
10. confirm all live jobs are skipped on PR CI;
11. do not claim protected environment variable readiness because the connected tool cannot read their values;
12. rerun W1 STEP08 + existing W1 controller/guard regressions and Compute Fabric Governance on the exact final head after recording research-after.

Only exact-final-head green CI after research-after may be used as a merge signal. Merge remains PREPARE_ONLY; the next live action is an externally initiated **preflight-only** dispatch and Supervisor review of its artifacts, not a reboot.
