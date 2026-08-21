# W1 Step 06 — GitHub OIDC provider reboot controller

Date: 2026-08-21
Milestone: `W1_PERSISTENT_LINUX_WORKER_SAFETY` → canonical `C1 — First Real Linux Worker`
Classification: CROSS-CUTTING IMPLEMENTATION / SECURITY RESEARCH

## Trigger

The W1 implementation is code-ready but still lacks the only evidence that matters for the persistent-host gate: a real provider-correlated reboot of a real enrolled Linux host. The existing W1 branch correctly refuses to promote worker-produced boot IDs without an independent controller/provider observation.

This step creates the controller side of that proof without moving AWS credentials into the repository and without letting the controller itself mark W1 verified.

## Current authoritative nonclaims

- no EC2 host is created by this step;
- no real reboot is executed merely by merging the controller;
- no Supabase service-role credential is exposed to GitHub Actions;
- a CloudTrail event is not reboot completion proof;
- a provider receipt candidate is not `persistent_worker_proof`;
- W1 stays `IN_PROGRESS` until the existing heartbeat + provider correlation and H1–H13 gates pass.

## Research findings adopted

### GitHub OIDC instead of long-lived AWS keys

GitHub documents OIDC federation for AWS using `https://token.actions.githubusercontent.com` and audience `sts.amazonaws.com`. The workflow needs `id-token: write`; AWS IAM should constrain the `sub` condition so untrusted repositories/jobs cannot assume the role.

The repository was created after GitHub's 2026-07-15 immutable-subject rollout. Its immutable identifiers are:

- owner: `PatrickFrome@20597814`
- repository: `Compute@1341371143`

The provider-controller job uses the GitHub environment `w1-persistent-host-proof`, therefore the intended immutable AWS trust subject is:

```text
repo:PatrickFrome@20597814/Compute@1341371143:environment:w1-persistent-host-proof
```

Do not replace this with a wildcard repository trust.

### Immutable action pin

`aws-actions/configure-aws-credentials` current release researched for this step is `v6.2.3` (2026-07-22). The workflow pins the exact release commit:

```text
e6de054238d6b7531b4efff3b6587d9aade6a06c
```

This version also exposes GitHub run information into AWS client telemetry, while the controller additionally fixes an explicit role-session name `w1-<run_id>-<attempt>` for CloudTrail correlation.

### Reboot semantics

AWS documents `RebootInstances` as **asynchronous**: the API queues a reboot request. CloudTrail records the API event, but that event does not by itself prove that the guest completed a reboot.

Therefore the evidence model is deliberately split:

1. **provider request plane** — exact OIDC session calls `RebootInstances`; CloudTrail event is bound to the target instance and role session;
2. **worker outcome plane** — Supabase later observes the same machine/witness identity with a distinct Linux boot ID;
3. only the existing two-plane DB verifier may correlate them and promote the host proof.

The legacy DB receipt column `completed_at` is populated from the CloudTrail provider-event time because the schema requires a closed action point, but the candidate explicitly labels its semantics as:

```text
PROVIDER_REQUEST_ACCEPTED_AT_NOT_REBOOT_COMPLETION
```

No consumer may reinterpret it as guest reboot completion.

### Provider identity amplifier

AWS EC2 exposes an Instance Identity Document and signed forms including RSA-2048/SHA-256. AWS recommends verifying the document if it is used for an important purpose. That remains a higher-assurance amplifier for a later W1 step; it is not required to turn the controller request into baseline provider-neutral evidence because the existing gate already requires an independent worker post-reboot transition.

## Controller implementation

Files:

- `.github/workflows/w1-aws-provider-reboot-proof.yml`
- `controller/w1/aws_provider_reboot_controller.py`
- `tests/test_w1_aws_provider_reboot_controller.py`

The workflow has two paths.

### Preflight-only path

Default `workflow_dispatch` behavior is `execute_reboot=false`.

It:

1. acquires short-lived AWS credentials through GitHub OIDC;
2. resolves the exact current `work/w1-linux-worker-safety` Git SHA;
3. verifies the target instance is tagged for H205F22/W1 and that its `metaengine:github_sha` equals that exact W1 head;
4. verifies running state, IMDSv2 required, metadata hop limit 1, encrypted gp3 root volume;
5. verifies every attached security group has zero ingress rules;
6. runs `RebootInstances --dry-run` and requires AWS `DryRunOperation`;
7. emits only `LIVE_AWS_OIDC_PREFLIGHT_ONLY` with `persistent_worker_proof=false`.

### Real provider request path

Requires both:

```text
execute_reboot=true
confirmation=REBOOT_W1_PERSISTENT_HOST
```

After the same preflight it:

1. records controller request time;
2. calls EC2 `RebootInstances`;
3. polls bounded CloudTrail `LookupEvents` results;
4. accepts only `ec2.amazonaws.com / RebootInstances` events containing the exact instance ID and exact OIDC role-session;
5. emits a deterministic, SHA-256-addressed `LIVE_PROVIDER_CONTROLLER_RECEIPT_UNINGESTED` artifact;
6. leaves `persistent_worker_proof=false` and `w1_verified=false` until Supabase ingestion/correlation occurs.

## Required GitHub repository variables

The controller intentionally uses fixed repository variables instead of workflow-supplied arbitrary AWS roles:

```text
W1_AWS_ROLE_ARN
W1_AWS_ACCOUNT_ID
W1_AWS_REGION
```

No `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` is supported.

## Recommended AWS trust policy

Replace `<ACCOUNT_ID>` and `<ROLE_NAME>` as appropriate. The important part is the immutable GitHub environment subject.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:PatrickFrome@20597814/Compute@1341371143:environment:w1-persistent-host-proof"
        }
      }
    }
  ]
}
```

## Recommended least-privilege controller policy

`RebootInstances` supports instance resource-level permission and EC2 resource-tag conditions. Describe APIs and CloudTrail lookup require broader read scope, but they do not mutate resources.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadW1HostSurface",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "ec2:DescribeVolumes",
        "ec2:DescribeSecurityGroups"
      ],
      "Resource": "*"
    },
    {
      "Sid": "RebootOnlyTaggedW1PersistentHosts",
      "Effect": "Allow",
      "Action": "ec2:RebootInstances",
      "Resource": "arn:aws:ec2:<REGION>:<ACCOUNT_ID>:instance/*",
      "Condition": {
        "StringEquals": {
          "aws:ResourceTag/metaengine:project": "H205F22",
          "aws:ResourceTag/metaengine:milestone": "W1_PERSISTENT_LINUX_WORKER_SAFETY",
          "aws:ResourceTag/metaengine:authority": "noncanonical-worker",
          "aws:ResourceTag/metaengine:execution_tier": "persistent-host"
        }
      }
    },
    {
      "Sid": "ReadProviderAuditEvent",
      "Effect": "Allow",
      "Action": "cloudtrail:LookupEvents",
      "Resource": "*"
    }
  ]
}
```

The role deliberately receives no `RunInstances`, `TerminateInstances`, `StopInstances`, IAM, Secrets Manager, SSM, SSH, or security-group mutation permissions.

## Independent negative tests

Unit tests cover:

- ingress-bearing security group rejected;
- mismatched W1 Git SHA rejected;
- unrelated CloudTrail instance rejected;
- unrelated OIDC role-session rejected;
- final receipt remains non-authoritative;
- asynchronous request semantics are explicit.

The PR workflow also rejects any accidental introduction of static AWS access-key variable names.

## Sources checked 2026-08-21

- GitHub Docs — Configuring OpenID Connect in Amazon Web Services
- GitHub Docs — OpenID Connect reference / immutable subject claims
- AWS EC2 API — RebootInstances
- AWS EC2 User Guide — reboot and CloudTrail behavior
- AWS CloudTrail API — LookupEvents
- AWS EC2 — Instance Identity Document signature verification
- AWS Service Authorization Reference — RebootInstances resource/condition support
- aws-actions/configure-aws-credentials release `v6.2.3`

## Required next gate

After this controller is merged, the remaining external prerequisite is not more control-plane code. It is an **authorized AWS account plane with an existing W1 reference host** and the three fixed repository variables. Then run preflight-only first; only after it passes execute the explicit real reboot and feed the resulting candidate into the existing Supabase provider-receipt correlation path.
