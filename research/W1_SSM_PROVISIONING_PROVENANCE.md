# W1 SSM Provisioning Provenance — research checkpoint

Date: 2026-08-27
Scope: H205F22 / W1_PERSISTENT_LINUX_WORKER_SAFETY

## Goal

Prove that the exact deterministic W1 safety package was installed on the exact intended persistent AWS EC2 host without allowing the host, the provisioning command, or a single AWS role to self-assert canonical authority.

This is a narrow proof only. Even a successful result MUST remain below host-safety capture, persistence/reboot proof, worker admission, and W1 VERIFIED.

## Official-source findings

### AWS Systems Manager SendCommand

AWS `SendCommand` supports `DocumentName`, exact `DocumentVersion`, `DocumentHash`, `DocumentHashType`, explicit `InstanceIds`, and `Parameters` in the request. SHA-1 is deprecated; SHA-256 is the correct document-hash type.

Source:
- https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_SendCommand.html

Design consequence:
- production provisioning must send the account-owned W1 document by exact name;
- version must be literal `1`, not `$LATEST` or `$DEFAULT`;
- the AWS system document hash must be supplied as `Sha256`;
- the target must be the exact instance ID;
- parameters must be `{}`.

### GetCommandInvocation

AWS documents `GetCommandInvocation` as eventually consistent. It exposes the command ID, instance ID, document name/version, plugin/step name, response code, execution timestamps, stdout/stderr and status.

Source:
- https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_GetCommandInvocation.html

Design consequence:
- a live workflow must use bounded retry with an overall deadline;
- it must require exact `DocumentVersion=1`, plugin `installPinnedSafetyPackage`, `ResponseCode=0`, status `Success`, empty stderr, and the exact courier on stdout;
- one early not-found response is not proof of failure.

### CloudTrail

AWS Systems Manager control-plane operations, including `SendCommand`, are CloudTrail management events. CloudTrail records caller identity, event time, request parameters, and response elements for API calls. Management events are logged by default.

Sources:
- https://docs.aws.amazon.com/systems-manager/latest/userguide/monitoring-cloudtrail-logs.html
- https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-record-contents.html

Design consequence:
- command success must not be trusted from host stdout alone;
- an independent verifier must correlate exactly one `SendCommand` event to the expected provisioning role/session, account, region, document version/hash, instance ID and empty parameters;
- the CloudTrail response command ID is then bound to `GetCommandInvocation`.

### EC2 instance identity document

AWS explicitly recommends cryptographically verifying an EC2 Instance Identity Document when its contents are used for an important purpose. RSA-2048/SHA-256 signatures are available through IMDS and can be verified with the corresponding AWS public certificate.

Source:
- https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/verify-iid.html

Design consequence:
- reuse the existing `aws_instance_identity_verifier.py` instead of inventing another host identity scheme;
- cross-bind the signed IID instance/account/region/image/AZ to EC2 API preflight and the SSM managed-node identity.

### EC2 provider-side binding

`DescribeInstances` exposes provider-observed instance ID, image ID, IAM instance profile, launch time, state, metadata options and tags. It can address one exact instance ID.

Source:
- https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeInstances.html

Design consequence:
- keep the existing W1 preflight checks for exact tags, running state, IMDSv2 required with hop limit 1, encrypted gp3 root volume and zero ingress;
- do not accept only host-reported identity.

### Run Command IAM restriction

AWS supports restricting `ssm:SendCommand` to specific documents and tagged managed nodes.

Source:
- https://docs.aws.amazon.com/systems-manager/latest/userguide/run-command-setting-up.html

Design consequence:
- retain the existing narrow mutating provisioning session;
- do NOT add CloudTrail/EC2 audit reads to that mutating role merely for convenience.

## Architecture decision: split provisioner and verifier roles

### Provisioner session

Existing role boundary remains narrow:
- may execute only the exact account-owned W1 provisioning document;
- may target only the exact tagged W1 host;
- no generic `AWS-ConfigureAWSPackage`;
- no capture document;
- no StartSession/SSH/port forwarding;
- no reboot or EC2 lifecycle mutation;
- no database authority.

### Independent verifier session

New verifier boundary is read-only:
- `ec2:DescribeInstances`
- `ec2:DescribeVolumes`
- `ec2:DescribeSecurityGroups`
- `ssm:DescribeInstanceInformation`
- `ssm:DescribeDocument`
- `ssm:GetDocument` for the exact provisioning document
- `ssm:GetCommandInvocation`
- `cloudtrail:LookupEvents`

Explicitly absent:
- `ssm:SendCommand`
- `ssm:StartSession`
- SSM document mutation
- `ec2:RebootInstances`
- Run/Stop/Terminate instance operations
- S3/KMS/Secrets Manager
- Supabase/database mutation

This prevents the evidence verifier from manufacturing the provider mutation it is supposed to verify.

## Evidence composition

A package-provisioning proof requires all of the following to bind to the same instance/package:

1. verifier STS caller is an assumed role in the expected AWS account;
2. EC2 provider preflight passes the existing W1 hardening contract;
3. SSM reports exactly one online Linux EC2 managed node with the expected instance ID;
4. account-owned active SSM document version 1 has exact repository-generated content;
5. AWS document SHA-256 is the hash used by the CloudTrail `SendCommand` request;
6. exactly one CloudTrail `SendCommand` event matches the expected provisioner IAM role/session, account, region, document, version/hash, instance and empty parameters;
7. the CloudTrail response command ID binds to `GetCommandInvocation`;
8. invocation is version 1, plugin `installPinnedSafetyPackage`, response code 0, successful, empty stderr, monotonic execution timestamps;
9. stdout is the exact non-authority courier for the deterministic package SHA/payload lock;
10. the existing AWS-signed IID receipt binds instance/account/region/image/AZ to provider preflight.

Only after all ten checks may the compositor emit:
- `package_provisioning_verified=true`
- `provider_identity_verified=true`

It still MUST emit:
- `capture_executed=false`
- `host_safety_verified=false`
- `reboot_completion_proven=false`
- `persistent_worker_proof=false`
- `worker_admitted=false`
- `w1_verified=false`
- `canonical=false`
- `authority_effect=false`

## Alternatives considered

### Trust only SendCommand API response
Rejected. The same mutating session produced it, so it is not independent evidence.

### Trust only host courier stdout
Rejected. Host output is transport data and cannot authenticate its own provider identity or command provenance.

### Add S3 or CloudWatch output
Deferred. The courier is small enough for `StandardOutputContent`. Adding S3/CloudWatch increases permissions and cross-service evidence surface without solving a current limitation.

### AWS Distributor / AWS-ConfigureAWSPackage
Deferred for first W1. Distributor is useful at scale, but its generic parameterized installer is broader than the embedded immutable document currently required.

### EventBridge instead of CloudTrail LookupEvents
Deferred. EventBridge delivery of CloudTrail-originated service events is useful for asynchronous automation, but is unnecessary for the first one-host proof. Bounded CloudTrail lookup is simpler and retains a smaller implementation surface.

### Nitro attestation / NitroTPM
Deferred. These can strengthen a later hardware-rooted worker tier, but the first W1 proof already has independent provider APIs plus AWS-signed IID. They should not delay the first real worker.

## Supabase compatibility check

Supabase's 2026 breaking changes do not require a change to this implementation slice. In particular, new public-schema objects increasingly require explicit Data API grants. Any future provenance persistence should remain in the private `destruktion_meta` control schema with explicit ACLs rather than relying on public-schema defaults.

Sources:
- https://supabase.com/changelog?types=breaking-change
- https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically

## Implementation produced by this slice

- `controller/w1/aws_ssm_safety_provision_provenance.py`
- `tests/test_w1_aws_ssm_safety_provision_provenance.py`
- updated `.github/workflows/w1-ssm-safety-provision-contract.yml`

No AWS command, EC2 lifecycle mutation, reboot, Supabase write, worker admission, or canonical promotion is performed by this research/contract slice.
