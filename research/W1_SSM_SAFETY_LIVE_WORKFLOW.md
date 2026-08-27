# W1 — Split-role live SSM safety provisioning workflow

Status: **IMPLEMENTED / CONTRACT VERIFIED / LIVE AWS EXECUTION NOT YET PERFORMED**

Canonical Level-1 execution focus: **C1 — First Real Linux Worker**  
Level-2 milestone: `W1_PERSISTENT_LINUX_WORKER_SAFETY`

## Purpose

This slice converts the deterministic W1 safety package and its immutable SSM transport contracts into a production-oriented live execution path without collapsing document authority, host mutation authority, provider identity verification, reboot authority, or database authority into one principal.

The workflow can prove only that the exact reviewed safety package was provisioned onto the exact tagged persistent EC2 candidate. It cannot prove the host safety envelope, reboot persistence, worker admission, W1 verification, or canonical checkpoint authority.

## Research-before implementation

### AWS Run Command is eventually consistent

AWS Systems Manager documents `GetCommandInvocation` as eventually consistent. A successful `SendCommand` can therefore be followed temporarily by `InvocationDoesNotExist` or an invocation state that has not converged yet.

Adopted design:

- bounded retries, never unbounded polling;
- only `InvocationDoesNotExist` is treated as a retryable AWS CLI error;
- `Pending`, `InProgress`, and `Delayed` are retryable invocation states;
- `AccessDenied`, malformed identity, wrong Region/instance/plugin, terminal failure states, and all other CLI errors fail immediately;
- a successful invocation is independently re-read in the verifier session.

Official source: AWS Systems Manager API Reference, `GetCommandInvocation`.

### CloudTrail is an independent control-plane witness

AWS documents that Systems Manager API calls are captured by CloudTrail and that `SendCommand` is a Systems Manager management event. CloudTrail itself is distributed/eventually consistent, so absence of the exact event immediately after the API call is an observation state, not proof that the request did not occur.

Adopted design:

- query `SendCommand` only in a bounded time window derived from the exact request timestamps;
- require event source `ssm.amazonaws.com`, event category `Management`, type `AwsApiCall`, no error code, the exact account/Region, the exact assumed-role issuer/session, document name/version/hash, singleton instance target, timeout and empty parameter/output/notification surfaces;
- zero exact matches is retryable for a bounded period;
- more than one exact match is fatal ambiguity;
- after convergence, the exact CloudTrail command ID must bind to the independent `GetCommandInvocation` result.

Official sources: AWS Systems Manager CloudTrail logging documentation and AWS CloudTrail data consistency documentation.

### Full SendCommand semantics must be pinned

The AWS `SendCommand` API supports more semantics than document name + target, including timeout, Targets fanout, S3 output, CloudWatch output, notifications, alarms, comments, service roles, concurrency, and error thresholds.

A proof that checks only document/version/instance can therefore accept a semantically different execution of the same document.

Adopted contract:

- `TimeoutSeconds = 120` for safety package provisioning;
- exact singleton `InstanceIds`;
- exact document name/version/hash;
- no parameters;
- no `Targets`;
- no S3 output;
- no CloudWatch output;
- no SNS notification configuration;
- no alarms;
- no service role;
- no comment;
- default-only `MaxErrors` / `MaxConcurrency` semantics.

The strict v2 compositor verifies these surfaces in both the `SendCommand` service response and the CloudTrail request.

Official source: AWS Systems Manager API Reference, `SendCommand`.

### GitHub OIDC is authentication capability, not cloud mutation authority

GitHub documents that `id-token: write` permits a workflow to request an OIDC JWT; it does not itself grant write permission to GitHub or external resources. Cloud authority is determined by the cloud trust relationship and resulting short-lived credentials. GitHub also recommends environment protection rules for OIDC workflows and provides deployment environments as approval/branch/policy gates.

Adopted design:

- no long-lived AWS access keys in workflow secrets or repository variables;
- pinned `aws-actions/configure-aws-credentials` commit;
- 15-minute OIDC sessions;
- `output-env-credentials: false` and explicit step-local credentials;
- protected GitHub environment `w1-persistent-host-proof` on all three cloud jobs;
- live workflow can execute cloud jobs only on an explicit `workflow_dispatch` from `main` with exact confirmation text;
- credentials are never uploaded as artifacts and never passed as job outputs.

Official sources: GitHub OIDC cloud-provider documentation, GitHub OIDC reference, and deployment-environment documentation.

## Authority decomposition

The live path uses four phases and three independent AWS sessions.

### 1. `live-gate` — no AWS authority

Checks:

- event is explicit `workflow_dispatch`;
- exact Git ref is `refs/heads/main`;
- exact confirmation is `PROVISION_W1_SAFETY_PACKAGE`;
- instance and worker identifiers have accepted shapes;
- checkout equals `GITHUB_SHA`;
- embedded W1 package source commit equals the reviewed immutable source commit.

It has only `contents: read` and cannot obtain an OIDC token.

### 2. `provision` — narrow package installation authority

The session policy is generated from the reviewed provisioning guard and permits only:

- `ssm:DescribeInstanceInformation`;
- `ssm:DescribeDocument` / `ssm:GetDocument` for the exact account-owned provisioning document;
- `ssm:SendCommand` for that exact document and the exact tagged EC2 candidate;
- `ssm:GetCommandInvocation`.

It cannot:

- create/update/delete SSM documents;
- invoke generic `AWS-RunShellScript`;
- start SSM sessions or port forwarding;
- execute the IID capture document;
- reboot the instance;
- access S3/KMS/Secrets Manager;
- mutate the database.

The workflow validates the exact remote version-1 document before `SendCommand`, sends the parameterless command with timeout 120, validates the service echo, captures request timestamps and command ID, then waits only through the bounded eventual-consistency states described above.

### 3. `iid-capture` — separate signed identity transport authority

A different OIDC role may execute only the exact account-owned parameterless `Metaengine-W1-IID-Capture-H205F22` document against the exact tagged host.

The host output is explicitly `HOST_UNTRUSTED_TRANSPORT`. It contains only EC2 IID document + rsa2048 signature bytes fetched from IMDSv2. It cannot self-assert provider identity, persistence, W1 status, canonical authority, or database authority.

### 4. `postverify` — fresh independent read-only verifier

A third OIDC role has only:

- `ec2:DescribeInstances`;
- `ec2:DescribeVolumes`;
- `ec2:DescribeSecurityGroups`;
- `ssm:DescribeInstanceInformation`;
- exact-document `ssm:DescribeDocument` / `ssm:GetDocument`;
- `ssm:GetCommandInvocation`;
- `cloudtrail:LookupEvents`.

It has **no `ssm:SendCommand`** and no provider mutation surface.

It independently:

1. reads EC2 host/root-volume/security-group state;
2. verifies the transported EC2 signed IID off-host through the existing pinned-certificate verifier;
3. re-reads SSM managed-node, remote document and command invocation state;
4. correlates one exact CloudTrail `SendCommand` management event;
5. composes the strict provisioning provenance receipt.

The successful receipt may set:

- `package_install_observed = true`;
- `package_provisioning_verified = true`;
- `provider_api_mutation_observed = true`;
- `host_filesystem_mutation_observed = true`;
- `strict_send_command_semantics_verified = true`.

It must keep false:

- `capture_executed` for the safety-envelope capture phase;
- `host_safety_verified`;
- `reboot_completion_proven`;
- `persistent_worker_proof`;
- `worker_admitted`;
- `w1_verified`;
- `database_mutation`;
- `canonical`;
- `authority_effect`.

## Separate create-once document control plane

The safety provisioning document is not created or updated by the runtime workflow.

`aws_ssm_safety_document_provision_guard.py` defines a separate create-once control-plane contract:

- exact `Metaengine-W1-Safety-Provision-H205F22` name;
- Command document;
- EC2 target type;
- exact generated bytes/package hash;
- required request tags;
- version 1 must remain latest and default;
- only `CreateDocument`, `DescribeDocument`, and `GetDocument` in the policy template;
- no Update/Delete/SendCommand runtime authority.

Contract CI for this layer is independently green.

## File-oriented live validation CLI

`controller/w1/aws_ssm_safety_live_cli.py` deliberately contains only local JSON validation/composition. It does not import an AWS SDK, invoke subprocess/network clients, reboot a host, or connect to Supabase.

This keeps provider transport in the auditable GitHub workflow while preserving the security-critical evidence logic as ordinary adversarially tested Python.

The CLI has explicit return semantics:

- `0` — accepted validation/composition;
- `2` — only `CloudTrailEventNotYetVisible`, which the workflow may retry inside its finite loop;
- `1` — all other failures, which must stop the workflow.

## Verification evidence

Exact contract baseline after implementation:

- branch: `work/main-roadmap-accelerators-v5`;
- exact source commit: `84a420ddac185b5781569008a1b4a9ded5b2daf0`;
- exact source tree: `4715feddfee9d9496fca337e6c7bb5d97e89c8ab`;
- workflow: `W1 AWS SSM Safety Provision Live`;
- run: `33127145875`;
- result: **SUCCESS**;
- contract tests: **64/64 PASS**;
- live-gate/provision/iid-capture/postverify jobs: **SKIPPED on push**, as required.

Supporting independent contract CI:

- strict SendCommand semantics commit `eef86435623e725235fc218a3d89ce8b831fd773`, run `33121722500`: **SUCCESS**;
- create-once SSM safety document contract commit `ade5fda45980581aaed4a0113d9ac5ec5d208269`, run `33121678860`: **SUCCESS**.

## Live roadmap readback after the contract pass

Supabase readback at `2026-08-27T23:41:33.571526Z` showed:

- roadmap definition integrity = true;
- canonical alignment integrity = true;
- roadmap drift = false;
- W1 effective status = `READY`;
- T1 and A1 remain blocked by W1;
- active claim alignment is empty;
- no EVIDENCE_READY claim exists;
- expired persisted claim #32 remains cleanup debt but lease-truth v2 gives stale rows `authority_effect=false`.

## Explicit nonclaims

This slice did **not**:

- dispatch the live workflow against AWS;
- create the safety SSM document in AWS;
- call live `SendCommand`;
- mutate an EC2 instance;
- reboot a worker;
- capture a real host-safety envelope;
- insert live W1 evidence into Supabase;
- admit a worker;
- verify W1;
- advance the canonical checkpoint.

Therefore W1 remains **READY, not VERIFIED**.

## Research-after: next minimum useful slice

The contract surface is no longer the dominant blocker. Adding more offline guards now has sharply diminishing value.

The minimum next slice should be a **credential-free / read-only live readiness preflight** that proves the external prerequisites without provisioning anything:

1. protected GitHub environment exists and enforces the expected deployment/branch-review boundary;
2. all required non-secret environment variables are structurally present;
3. the three distinct AWS role ARNs are configured, without exposing credentials;
4. the exact account/Region/instance/worker binding is readable;
5. the exact safety provisioning and IID capture documents already exist as active version 1 and match reviewed repository bytes;
6. the W1 EC2 candidate is an online Linux SSM managed node;
7. the read-only verifier role can perform all independent reads;
8. no `SendCommand`, document authoring, reboot, admission or DB mutation occurs.

Only after that readiness receipt is green should an explicitly approved main-branch dispatch be considered for the first real `provision -> signed IID -> independent provenance` cycle.
