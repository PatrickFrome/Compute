# W1 STEP07 — live preflight credential/session hardening

Status: IMPLEMENTED / PREPARE_ONLY pending mandatory research-after and exact-final-head CI  
Milestone: `W1_PERSISTENT_LINUX_WORKER_SAFETY` → canonical `C1 — First Real Linux Worker`  
Authority boundary: this step can make a future AWS preflight safer; merge does not execute AWS, prove a reboot, prove persistence, ingest provider evidence, or verify W1.

## Trigger

W1 STEP06 correctly established the provider-side reboot evidence model and GitHub OIDC trust subject, but its first implementation still had a live-execution boundary weaker than the now-established R1 production pattern:

- `configure-aws-credentials` used its default environment export behavior, so short-lived AWS credentials remained job-wide after acquisition;
- no inline session policy narrowed the assumed role to the exact requested W1 instance and the small read/reboot surface needed by this workflow;
- the protected GitHub environment was referenced but its required-reviewer / prevent-self-review / branch-policy shape was not independently validated before the OIDC job;
- `workflow_dispatch` did not independently require `refs/heads/main` before OIDC;
- provider evidence still used an older `upload-artifact` pin.

These are operational security gaps directly on the first-live-W1 path, not new authority semantics. STEP07 hardens them before any real provider call is attempted.

## Mandatory research before implementation

### 1. GitHub OIDC credentials can and should remain step-scoped

Current `aws-actions/configure-aws-credentials` v6.2.3 documents:

- `output-env-credentials` defaults to `true` when a profile is not used;
- `output-credentials: true` exposes temporary credentials as action step outputs;
- `output-env-credentials: false` prevents job-environment export;
- `inline-session-policy` further restricts the permissions of the assumed role session;
- `unset-current-credentials` can remove inherited AWS credential variables before authentication.

STEP07 therefore sets:

```yaml
output-env-credentials: false
output-credentials: true
unset-current-credentials: true
inline-session-policy: ${{ steps.session-policy.outputs.policy }}
```

Only four AWS-calling steps receive `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` from those outputs:

1. caller/instance/volume/security-group preflight;
2. `RebootInstances --dry-run`;
3. the explicit reboot step when separately confirmed;
4. CloudTrail lookup when a real reboot was requested.

The Git SHA resolver, receipt builder, summary and artifact uploader do not receive AWS credentials.

Sources:
- https://github.com/aws-actions/configure-aws-credentials
- https://github.com/aws-actions/configure-aws-credentials/blob/main/action.yml
- release v6.2.3 / exact repo pin `e6de054238d6b7531b4efff3b6587d9aade6a06c`

### 2. Exact least-privilege session policy is feasible

AWS documents `RebootInstances` as asynchronous and supports `DryRun`. Successful permission-only validation returns `DryRunOperation`; insufficient permission returns `UnauthorizedOperation`.

The session policy generated before OIDC includes only:

- `ec2:DescribeInstances`
- `ec2:DescribeVolumes`
- `ec2:DescribeSecurityGroups`
- `ec2:RebootInstances`
- `cloudtrail:LookupEvents`

The three `Describe*` calls use `Resource:"*"` because EC2 Describe APIs do not support useful resource-level scoping. CloudTrail `LookupEvents` likewise uses `Resource:"*"` for its read API. `RebootInstances` is bound to one exact instance ARN and the already-required H205F22/W1 resource tags.

The policy does **not** include `RunInstances`, `StartInstances`, `StopInstances`, `TerminateInstances`, security-group mutation, SSM sessions, IAM, Secrets Manager, SSH, or any unrelated EC2 write.

`sts:GetCallerIdentity` remains a runtime account amplifier; AWS documents that it requires no explicit permission, so no STS allow statement is added to the session policy.

Sources:
- https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_RebootInstances.html
- https://docs.aws.amazon.com/cli/latest/reference/ec2/reboot-instances.html
- https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeInstances.html
- https://docs.aws.amazon.com/ec2/latest/devguide/ec2-api-permissions.html
- https://docs.aws.amazon.com/awscloudtrail/latest/userguide/view-cloudtrail-events.html
- https://docs.aws.amazon.com/awscloudtrail/latest/userguide/security_iam_id-based-policy-examples.html
- https://docs.aws.amazon.com/STS/latest/APIReference/API_GetCallerIdentity.html

### 3. Environment metadata can be checked before cloud credentials exist

GitHub's current `Get an environment` REST endpoint can be used by repository readers; for fine-grained tokens it requires `Actions: read`. The response includes `protection_rules` and `deployment_branch_policy`.

STEP07 adds a credential-free `preflight-environment` job with only:

```yaml
permissions:
  actions: read
  contents: read
```

It fetches `w1-persistent-host-proof` and fails closed unless the environment has:

- exactly one required-reviewers rule;
- at least one reviewer;
- Prevent self-review enabled;
- a branch-policy protection rule;
- a valid deployment branch-policy mode.

Only after that check does the provider job reference the validated environment name. Environment approval remains enforced by GitHub itself before the provider job can proceed.

Sources:
- https://docs.github.com/en/rest/deployments/environments
- https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments

### 4. `workflow_dispatch` is explicitly pinned to main before OIDC

An environment-based OIDC subject contains the environment name rather than branch information. GitHub environments can restrict deployment branches, but STEP07 also independently requires:

```bash
[[ "$GITHUB_REF" == 'refs/heads/main' ]]
```

both before the environment lookup and again immediately before session-policy construction/OIDC. A manual dispatch from another ref therefore fails before cloud authentication even if some future environment configuration drifts.

### 5. Immutable OIDC subject remains the STEP06 contract

Current GitHub documentation confirms that repositories created after July 15, 2026 use immutable default `sub` claims containing owner and repository IDs, and environment jobs include the environment context.

The established STEP06 trust subject remains:

```text
repo:PatrickFrome@20597814/Compute@1341371143:environment:w1-persistent-host-proof
```

STEP07 does not modify AWS trust policy or claim that the external role is currently configured correctly. The future live OIDC exchange is itself the runtime proof that the external trust relationship accepts the expected subject/audience.

Sources:
- https://docs.github.com/en/actions/reference/security/oidc
- https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws

### 6. Provider evidence upload is moved to the current pinned artifact action

Current `actions/upload-artifact` latest stable researched for this step is v7.0.1, exact pin:

```text
043fb46d1a93c77aae656e7c1c64a875d1fc6a0a
```

The W1 evidence directory contains multiple files, so it remains an archived artifact rather than using `archive:false`. The meaningful security change is the current immutable pin and the fact that the upload step no longer receives AWS credentials.

Sources:
- https://github.com/actions/upload-artifact/releases
- https://github.com/actions/upload-artifact/blob/main/action.yml

## Implementation

### `controller/w1/aws_provider_reboot_live_guard.py`

Network-free and credential-free guard with two contracts:

1. `validate-environment`
   - validates `w1-persistent-host-proof` protection shape;
   - emits a self-hashed non-authoritative environment receipt;
   - never marks provider execution authorized or W1 verified.

2. `build-session-policy`
   - validates instance/account/region syntax and rejects control characters;
   - emits an exact-instance/tag-constrained `RebootInstances` statement;
   - emits only the three required EC2 Describe calls plus CloudTrail LookupEvents on wildcard resources where those APIs require it;
   - explicitly records that Run/Stop/Terminate/SG mutation/SSM are not allowed;
   - records `credential_export_mode=STEP_OUTPUTS_ONLY`;
   - remains non-authoritative.

### `.github/workflows/w1-aws-provider-reboot-proof.yml`

The manual execution path becomes:

1. PR-safe controller/guard regression suite;
2. credential-free protected-environment metadata preflight;
3. protected environment approval;
4. exact main-ref + AWS var syntax validation;
5. exact session policy generation before credentials;
6. 15-minute OIDC credentials as outputs only;
7. exact W1 implementation-head resolution without AWS credentials;
8. AWS host/config preflight under scoped credentials;
9. `RebootInstances --dry-run` under scoped credentials;
10. preflight-only nonclaim, or separately confirmed reboot + CloudTrail lookup;
11. credential-free receipt construction and artifact upload.

The actual reboot remains separately gated by:

```text
execute_reboot=true
confirmation=REBOOT_W1_PERSISTENT_HOST
```

## Adversarial tests added before first PR CI

The new guard suite covers:

- valid environment reviewer/self-review/branch protection;
- missing self-review protection rejection;
- missing branch-policy rule rejection;
- exact instance ARN and exact allowed action set;
- required W1 tag conditions on reboot;
- absence of Run/Start/Stop/Terminate/security-group mutation/SSM permissions;
- invalid instance/account/region rejection;
- control-character rejection before shell/AWS transport;
- deterministic self-hashed non-authoritative receipts.

The workflow static contract additionally requires:

- exactly one `id-token: write` zone;
- exact configure-aws-credentials v6.2.3 pin;
- output-only credential mode and inline session policy;
- no repository/secret static AWS credential inputs;
- exactly four AWS-calling credential scopes;
- no AWS credentials in receipt-build/artifact-upload tail;
- exact upload-artifact v7.0.1 pin.

## Live prerequisites deliberately not assumed

This merge can succeed even if no AWS live prerequisites exist. A real dispatch still requires all of the following at runtime:

1. `w1-persistent-host-proof` exists and passes the new protection-rule preflight;
2. environment variables `W1_AWS_ROLE_ARN`, `W1_AWS_ACCOUNT_ID`, `W1_AWS_REGION` exist;
3. the external AWS role trust accepts the immutable GitHub environment OIDC subject/audience;
4. the role's base permissions intersect successfully with the generated session policy;
5. the specified EC2 instance exists in the account/region and passes all W1 tag/IMDS/root-volume/security-group checks;
6. `work/w1-linux-worker-safety` still exists and the host tag binds to its exact current SHA.

None of those runtime facts is claimed merely because STEP07 code exists.

## Strict nonclaims before research-after

- no workflow_dispatch was executed by this implementation step;
- no GitHub environment configuration was created or modified;
- no AWS role/trust policy/credential was created or modified;
- no AWS API call was executed by PR code;
- no EC2 instance was created, changed, rebooted, stopped or terminated;
- no provider receipt was generated from a real event;
- no post-reboot worker heartbeat was observed;
- no provider/worker correlation was ingested;
- `persistent_worker_proof=false` and W1/C1 remain unverified.

## Mandatory research after implementation before merge

Merge is forbidden until all of the following are completed and recorded:

1. inspect the first independent PR CI and distinguish static-check failures from runtime-contract failures;
2. re-read the final workflow and prove AWS credentials appear only in the four AWS-calling steps;
3. re-confirm current action release pins and `output-env-credentials` semantics;
4. re-audit `RebootInstances`, EC2 Describe, CloudTrail LookupEvents, and `GetCallerIdentity` IAM semantics against current AWS docs;
5. verify the session policy contains no accidental mutation permissions beyond exact-instance reboot;
6. verify environment preflight uses only `Actions: read` + `Contents: read` and cannot release cloud credentials itself;
7. verify PR event skips both environment preflight and provider-controller jobs;
8. inspect current production supervisor snapshot and confirm no W1 evidence/claim was promoted by implementation/CI;
9. append research-after findings and run W1 + Compute Fabric Governance again on the exact final head.

Only that exact-final-head green signal may be used for merge. Merge remains PREPARE_ONLY; a later explicit `workflow_dispatch` is the first possible live AWS evidence step.
