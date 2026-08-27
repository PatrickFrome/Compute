# W1 — Non-mutating external SSM safety readiness preflight

Status: **IMPLEMENTED / CONTRACT VERIFIED / LIVE READ-ONLY DISPATCH NOT YET PERFORMED**

Canonical focus: `C1 — First Real Linux Worker`  
Level-2 gate: `W1_PERSISTENT_LINUX_WORKER_SAFETY`

## Why this slice exists

The W1 live package-provisioning workflow is contract-green, but a contract-green workflow is not evidence that its real external prerequisites exist.

The next useful question is therefore not “can another offline guard be added?” but:

> Can a protected, independent read-only session prove that the real GitHub deployment boundary, candidate EC2 host, SSM managed-node registration, and both exact version-1 SSM documents are present and mutually consistent before any `SendCommand` is allowed?

The readiness preflight answers only that question.

## Research-before

### GitHub environment metadata is available through a read endpoint

GitHub's current REST environment API documents `GET /repos/{owner}/{repo}/environments/{environment_name}` and states that the fine-grained permission required is repository `Actions: read`. The response includes environment protection rules and deployment branch policy.

The readiness workflow therefore reads, but never updates:

- `w1-persistent-host-proof` environment metadata;
- current `main` branch metadata;
- custom deployment branch policies only when the environment is configured in custom-branch mode.

The existing W1 validators remain authoritative for interpretation:

- `aws_provider_reboot_live_guard.validate_environment()` requires one non-empty required-reviewer rule, `prevent_self_review=true`, and an environment branch-policy rule;
- `aws_persistent_host_preflight_guard.validate_deployment_compatibility()` requires either protected `main` or exactly one custom `main` deployment policy.

This avoids creating a second environment-policy implementation.

Official source: GitHub REST API endpoints for deployment environments.

### AWS read-only surface is sufficient for prerequisite verification

AWS documents:

- `DescribeInstanceInformation` for managed-node platform, SSM Agent and online registration state;
- `DescribeDocument` for SSM document identity/state/version/hash/owner/platform metadata;
- `GetDocument` for exact document content by version;
- EC2 Describe APIs for candidate instance, security groups and encrypted root volume state.

No command execution API is necessary to determine whether these prerequisites are ready.

Official sources: AWS Systems Manager `DescribeInstanceInformation`, `DescribeDocument`, and `GetDocument` API references.

## Implemented compositor

`controller/w1/aws_ssm_safety_readiness_guard.py`

The module is local-only. It imports no AWS SDK, HTTP client, subprocess runner or Supabase client.

It reuses:

- GitHub environment receipt validator;
- main deployment-route receipt validator;
- EC2 W1 host preflight validator;
- SSM managed-node validator;
- exact safety provisioning document validator;
- exact signed-IID capture document validator.

### Role separation proof

Readiness requires three configured IAM role ARNs in the same AWS account:

1. package provisioning role;
2. IID capture role;
3. independent verifier role.

They must be pairwise distinct.

The actual STS caller used by readiness must be an assumed-role session of the configured verifier role, not either execution role.

### Read-only inline session policy

The preflight OIDC session contains only:

- `ec2:DescribeInstances`;
- `ec2:DescribeVolumes`;
- `ec2:DescribeSecurityGroups`;
- `ssm:DescribeInstanceInformation`;
- `ssm:DescribeDocument` / `ssm:GetDocument` for exactly:
  - `Metaengine-W1-Safety-Provision-H205F22`;
  - `Metaengine-W1-IID-Capture-H205F22`.

It intentionally does not include:

- `ssm:SendCommand`;
- `ssm:StartSession`;
- SSM document create/update/delete;
- `ec2:RebootInstances`;
- Run/Stop/Terminate instances;
- CloudTrail lookup;
- S3/KMS/Secrets Manager;
- database operations.

## Workflow

`.github/workflows/w1-aws-ssm-safety-readiness.yml`

### Push / PR behavior

Only the `contract` job executes. Real GitHub/AWS jobs are skipped.

### Explicit live preflight behavior

A future `workflow_dispatch` requires exact confirmation:

`PREFLIGHT_W1_SSM_SAFETY_READINESS`

and exact `main` ref.

The live path is:

`contract -> github-environment -> protected aws-readonly`

`github-environment` has only GitHub read permissions and no OIDC token.

`aws-readonly` references `w1-persistent-host-proof`, so environment protection rules must pass before GitHub sends the job to a runner. It is the only readiness job with `id-token: write`.

Environment/repository variables provide immutable external binding:

- W1 instance ID;
- worker ID;
- AWS account/Region;
- provision role ARN;
- IID-capture role ARN;
- verifier role ARN.

The workflow does not accept the target host as arbitrary dispatch input.

## Readiness receipt semantics

A positive receipt may set:

- `github_environment_verified=true`;
- `main_deployment_route_verified=true`;
- `distinct_aws_roles_verified=true`;
- `readonly_verifier_identity_verified=true`;
- `provider_host_binding_verified=true`;
- `managed_node_online_verified=true`;
- `provision_document_verified=true`;
- `iid_capture_document_verified=true`;
- `readiness_preflight_passed=true`.

It must keep false:

- `send_command_executed`;
- `document_mutation`;
- `host_filesystem_mutation`;
- `reboot_performed`;
- `database_mutation`;
- `worker_admitted`;
- `persistent_worker_proof`;
- `w1_verified`;
- `canonical`;
- `authority_effect`.

The required next action is merely recorded as:

`EXPLICITLY_APPROVED_MAIN_BRANCH_W1_SSM_PROVISIONING_DISPATCH`

The receipt itself cannot authorize that action.

## Adversarial coverage

Tests cover:

- exact read-only policy including both SSM documents;
- absence of SendCommand/document mutation/reboot/secret surfaces;
- same-account requirement for all configured roles;
- pairwise role separation;
- exact verifier-role STS caller binding;
- deterministic composition through reused validators;
- all execution/W1/canonical nonclaims remaining false;
- workflow dispatch-only external jobs;
- exactly one OIDC job;
- protected environment usage;
- no provider/database mutation commands in workflow source;
- environment metadata validation before OIDC;
- read-only observation of both documents and managed node.

## Contract evidence

Exact initial readiness contract baseline:

- source commit: `8de2c6492784f738eac8234c5db4297b21604879`;
- source tree: `8d29fbae4dd243a38eda05d397d54c24842608ec`;
- workflow: `W1 AWS SSM Safety Readiness`;
- run: `33127518080`;
- result: **SUCCESS**;
- `github-environment`: skipped on push;
- `aws-readonly`: skipped on push.

No external AWS or GitHub environment configuration was mutated by this validation.

## Research-after

This preflight closes the last major contract gap before touching the real candidate: it can prove configuration/readiness without installing anything.

Further offline abstraction is now lower value than an actual read-only preflight. The next meaningful evidence should come from a separately approved `main` dispatch of this readiness workflow. If that receipt is green, the architecture can proceed to a separately approved package-provisioning dispatch.

A readiness failure must be treated as configuration evidence, not bypassed. In particular, missing document version 1, missing required reviewers, role aliasing, an offline/non-Linux managed node, an unsafe host surface, or a document-content mismatch must fail closed rather than trigger auto-repair from the execution role.
