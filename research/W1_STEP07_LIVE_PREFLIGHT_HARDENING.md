# W1 STEP07 — live preflight credential/session hardening

Status: IMPLEMENTED / PREPARE_ONLY; mandatory research-before and research-after complete, pending exact-final-head CI  
Milestone: `W1_PERSISTENT_LINUX_WORKER_SAFETY` → target canonical `C1 — First Real Linux Worker`  
PR workstream binding: `analysis/integration` → canonical Level-1 `CROSS-CUTTING`  
Authority boundary: this step makes a future AWS preflight safer; merge does not execute AWS, prove a reboot, prove persistence, ingest provider evidence, or verify W1.

## Trigger

W1 STEP06 correctly established the provider-side reboot evidence model and GitHub OIDC trust subject, but its first implementation still had a live-execution boundary weaker than the now-established production pattern:

- `configure-aws-credentials` used its default environment export behavior, so short-lived AWS credentials remained job-wide after acquisition;
- no inline session policy narrowed the assumed role to the exact requested W1 instance and the small read/reboot surface needed by the workflow;
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
- `unset-current-credentials` removes inherited AWS credential variables before authentication.

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

The Git SHA resolver, preflight-only receipt builder, live provider-receipt builder, summaries and artifact uploader do not receive AWS credentials.

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

The policy does **not** include `RunInstances`, `StartInstances`, `StopInstances`, `TerminateInstances`, security-group mutation, SSM sessions, IAM, Secrets Manager, SSH, or unrelated EC2 write access.

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

GitHub's current `Get an environment` REST endpoint can be used with repository read access; fine-grained access requires `Actions: read`. The response includes `protection_rules` and `deployment_branch_policy`.

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

An environment-based OIDC subject contains the environment name rather than branch information. GitHub environments can restrict deployment branches, but STEP07 independently requires:

```bash
[[ "$GITHUB_REF" == 'refs/heads/main' ]]
```

both before the environment lookup and again immediately before session-policy construction/OIDC. A manual dispatch from another ref therefore fails before cloud authentication even if future environment configuration drifts.

### 5. Immutable OIDC subject remains the STEP06 contract

Current GitHub documentation confirms that repositories created after July 15, 2026 use immutable default `sub` claims containing owner and repository IDs, and environment jobs include the environment context.

The established STEP06 trust subject remains:

```text
repo:PatrickFrome@20597814/Compute@1341371143:environment:w1-persistent-host-proof
```

STEP07 does not modify AWS trust policy or claim that the external role is currently configured correctly. A future live OIDC exchange is itself part of the runtime proof that the external trust relationship accepts the expected subject/audience.

Sources:
- https://docs.github.com/en/actions/reference/security/oidc
- https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws

### 6. Provider evidence upload is moved to the current pinned artifact action

Current `actions/upload-artifact` latest stable researched for this step is v7.0.1, exact pin:

```text
043fb46d1a93c77aae656e7c1c64a875d1fc6a0a
```

The W1 evidence path contains multiple files, so it remains an archived artifact rather than using `archive:false`. The security change is the current immutable pin and the fact that the upload step receives no AWS credentials.

Sources:
- https://github.com/actions/upload-artifact/releases
- https://github.com/actions/upload-artifact/blob/main/action.yml

## Implementation

### `controller/w1/aws_provider_reboot_live_guard.py`

Network-free and credential-free guard with two contracts.

#### `validate-environment`

- validates exact environment `w1-persistent-host-proof`;
- requires the reviewer/self-review/branch protection shape above;
- emits a deterministic self-hashed non-authoritative receipt;
- never marks provider execution authorized or W1 verified.

#### `build-session-policy`

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

## Adversarial tests implemented before first PR CI

The guard suite covers:

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

A real dispatch still requires all of the following at runtime:

1. `w1-persistent-host-proof` exists and passes the new protection-rule preflight;
2. environment variables `W1_AWS_ROLE_ARN`, `W1_AWS_ACCOUNT_ID`, `W1_AWS_REGION` exist;
3. the external AWS role trust accepts the immutable GitHub environment OIDC subject/audience;
4. the role's base permissions intersect successfully with the generated session policy;
5. the specified EC2 instance exists in the account/region and passes all W1 tag/IMDS/root-volume/security-group checks;
6. `work/w1-linux-worker-safety` still exists and the host tag binds to its exact current SHA.

None of those runtime facts is claimed merely because STEP07 code exists.

## Mandatory research after implementation

### A. First independent W1 PR CI passed; live jobs were skipped

Initial PR head:

```text
f45901f31388b68a2e1e7fd68777e12336a876a7
```

W1 workflow run `32545652935` completed with:

- `validate-controller` — SUCCESS;
- controller compile/tests — SUCCESS;
- new live-boundary guard tests — SUCCESS;
- static credential/trust-zone contract — SUCCESS;
- `preflight-environment` — SKIPPED on pull_request;
- `provider-controller` — SKIPPED on pull_request.

Therefore PR CI performed no environment REST preflight and no AWS operation.

### B. Initial Governance failure was PR workstream metadata, not code

Compute Fabric Governance run `32545652950` initially failed before architecture checks because branch `analysis/integration` is registered as canonical Level-1 `CROSS-CUTTING`, while the first PR body incorrectly stated `Canonical Level-1 milestone: C1 — First Real Linux Worker`.

The PR body was corrected to:

```text
Canonical Level-1 milestone: CROSS-CUTTING
Level-2 milestone: W1_PERSISTENT_LINUX_WORKER_SAFETY
Target canonical outcome: C1 — First Real Linux Worker.
```

A rerun of the *same original workflow event* still saw the old PR body because GitHub reruns reuse the original pull-request event payload. Its log explicitly showed the old C1 line. That rerun is therefore not a second implementation failure. The research-after commit creates a new `pull_request synchronize` event and must be the first governance signal evaluated against the corrected body.

### C. Final workflow credential scopes were manually re-read after implementation

The workflow itself, not only its static test, was re-read from `analysis/integration`.

Confirmed:

- only one job has `id-token: write`;
- `preflight-environment` has only `actions: read` and `contents: read` and no AWS vars/secrets;
- `configure-aws-credentials` uses exact pin `e6de054238d6b7531b4efff3b6587d9aade6a06c`;
- `output-env-credentials:false`, `output-credentials:true`, `unset-current-credentials:true`, 900-second role duration, allowed account ID and the generated inline session policy are all present;
- the temporary AWS credential outputs occur only in four AWS-calling step environments;
- `Resolve exact W1 implementation head`, the preflight-only receipt, the live provider-receipt builder, summaries and artifact upload do not receive AWS credential outputs;
- the final upload uses exact `actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`.

### D. Current action contracts still support the chosen boundary

Research-after rechecked current upstream documentation. `aws-actions/configure-aws-credentials` 6.2.3 still documents:

- environment credential output defaults to true without a profile;
- step credential output defaults to false unless requested;
- inline session policies further restrict the role session.

`actions/upload-artifact` v7.0.1 remains the latest stable release observed for this step, with exact commit `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`.

Sources:
- https://github.com/aws-actions/configure-aws-credentials
- https://github.com/aws-actions/configure-aws-credentials/blob/main/action.yml
- https://github.com/aws-actions/configure-aws-credentials/blob/main/CHANGELOG.md
- https://github.com/actions/upload-artifact/releases

### E. AWS permission semantics were re-audited after implementation

Current AWS documentation still confirms:

- `RebootInstances` supports `DryRun`; authorized dry-run returns `DryRunOperation`, unauthorized returns `UnauthorizedOperation`;
- EC2 Describe APIs used by this workflow are read operations and require wildcard resource scope where resource-level permission is not supported;
- CloudTrail `LookupEvents` is read-only event-history access and is the only CloudTrail action in the generated policy;
- `sts:GetCallerIdentity` does not require adding a broad STS permission.

Manual policy inspection found no mutation action other than exact-instance `ec2:RebootInstances`. There is no Run/Start/Stop/Terminate, security-group mutation, SSM, IAM or secret-read action.

Sources:
- https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_RebootInstances.html
- https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeInstances.html
- https://docs.aws.amazon.com/ec2/latest/devguide/ec2-api-permissions.html
- https://docs.aws.amazon.com/awscloudtrail/latest/userguide/view-cloudtrail-events.html
- https://docs.aws.amazon.com/STS/latest/APIReference/API_GetCallerIdentity.html

### F. Production supervisor/W1 evidence state did not advance during implementation or PR CI

A read-only production inspection used the actual relation names after two earlier read-only queries failed closed on stale guessed names/signature and performed no mutation.

Observed after the initial PR CI:

- supervisor `active_claims=[]`;
- `evidence_ready=[]`;
- Level-2 `W1_PERSISTENT_LINUX_WORKER_SAFETY` effective status = `READY`;
- canonical C1 `First Real Linux Worker` remains `IN_PROGRESS`;
- worker enrollment rows = 3;
- worker heartbeat rows = 1;
- worker reboot receipt rows = **0**;
- Linux safety observation rows = **0**;
- Linux safety verification rows = **0**.

The existing enrollment/heartbeat rows predate STEP07; this PR did not create them. The zero reboot/observation/verification counts prove that implementation/PR CI did not create the evidence needed for persistent-host authority.

### G. Research-after conclusion

No authority or runtime defect requiring broader permissions was found. The only independent-CI issue was the initial PR body binding, which is corrected for the next synchronize event. No code permission expansion is justified.

The next and only merge signal is a new exact-final-head run after this research-after commit where:

- W1 validation succeeds;
- `preflight-environment` and `provider-controller` remain skipped on PR;
- Compute Fabric Governance succeeds using the corrected `CROSS-CUTTING` PR binding.

## Strict nonclaims after research-after

- no W1 `workflow_dispatch` has been executed by STEP07;
- no GitHub environment configuration was created or modified;
- no environment runtime preflight was executed by PR CI;
- no AWS role/trust policy/credential was created or modified;
- no AWS API call was executed by STEP07 PR CI;
- no EC2 instance was created, changed, rebooted, stopped or terminated;
- no live provider reboot receipt exists from STEP07;
- worker reboot receipt rows remain zero at the recorded inspection point;
- Linux safety observation/verification rows remain zero at the recorded inspection point;
- no post-reboot worker heartbeat/correlation was produced;
- `persistent_worker_proof=false` and W1/C1 remain unverified;
- readiness of the external AWS role, protected environment variables and target EC2 host remains a runtime fact to be proven only by a later explicitly authorized dispatch.

Only exact-final-head green W1 + Governance CI may permit merge. Merge remains **PREPARE_ONLY**; the first possible live evidence is a later explicit `workflow_dispatch`, preflight-only first.
