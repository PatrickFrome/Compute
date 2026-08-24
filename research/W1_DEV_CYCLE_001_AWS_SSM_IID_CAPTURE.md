# W1 DEV-CYCLE-001 — AWS SSM IID capture transport contract

Status: CONTRACT HARDENED / LIVE SSM EXECUTION NOT YET PERFORMED / NON-AUTHORITY

Canonical Level-1 milestone: **C1 — First Real Linux Worker**  
Level-2 milestone: `W1_PERSISTENT_LINUX_WORKER_SAFETY`

## Same-World precondition

Before this slice:

- semantic head remained CP072;
- roadmap definition integrity remained true;
- W1 claim #19 remained active with Supervisor directive #22 `CONTINUE`;
- live W1 evidence remained: reboot receipts `0`, backend bindings `0`, dedicated safety verifications `0`, safety observations `18`;
- no canonical advancement and no synthetic live evidence were created.

## Why Systems Manager rather than SSH

Current AWS documentation was rechecked on 2026-08-23. Systems Manager can manage EC2 nodes without opening inbound ports, bastions, or SSH keys. Run Command is the non-interactive command primitive and can be restricted by IAM and managed-node tags. `DescribeInstanceInformation` exposes managed-node `Online`/Linux/EC2 state. `GetCommandInvocation` returns at most 24,000 stdout characters and 8,000 stderr characters.

Interactive Session Manager is unnecessary for W1 and is not granted.

## Rejected first design: AWS-RunShellScript

The first implementation draft restricted the execution role to the AWS-managed `AWS-RunShellScript` document and exact W1 instance tags. Adversarial review identified a blocking capability gap before any live execution:

**`ssm:SendCommand` + `AWS-RunShellScript` still lets the caller supply arbitrary shell commands through document parameters.**

Validating the echoed parameters after `SendCommand` is too late: arbitrary code would already have been authorized for delivery to the host. This would turn a narrow evidence courier into a general remote-root execution capability.

That design is rejected and superseded by this hardened v2 contract.

## Adopted design: parameterless account-owned immutable document

Repository source:

`infra/w1/ssm/Metaengine-W1-IID-Capture-H205F22.json`

The document:

- is SSM schema 2.2;
- has **zero parameters**;
- has exactly one `aws:runShellScript` step;
- contains a fixed IMDSv2 IID collector;
- accepts no interpolation or caller-supplied command text;
- contacts only fixed link-local `169.254.169.254` through Python `http.client`;
- captures exact raw `document` and `rsa2048` bytes;
- emits the existing courier schema with `HOST_UNTRUSTED_TRANSPORT`;
- hard-codes all authority-sensitive claims false.

The document is intended to be provisioned once in the protected AWS account as version `1` under name:

`Metaengine-W1-IID-Capture-H205F22`

SSM document updates create new versions. The execution contract always requests **version 1**, so later default/latest versions cannot silently alter the executed content.

## Runtime remote-content verification

Before SendCommand, the execution workflow must call both `DescribeDocument` for version 1 and `GetDocument` for version 1.

The guard requires:

- exact account-owned document name;
- owner = exact protected AWS account ID;
- type = `Command`;
- status = `Active`;
- document version = `1`;
- SHA-256 hash type and structurally valid AWS document hash;
- Linux platform support;
- `GetDocument.Content` parses to exactly the reviewed repository JSON semantics;
- remote document remains parameterless and satisfies the fixed transport surface.

Only after remote content equals the repository version does the workflow obtain the AWS SHA-256 from the description and pass **both version 1 and that SHA-256** to `SendCommand`. This closes a TOCTOU/content-substitution path: if the document selected for execution does not match the reviewed version/hash, AWS rejects it.

## Least-privilege execution session

The short-lived OIDC execution session may only:

- `ssm:DescribeInstanceInformation`;
- `ssm:DescribeDocument`;
- `ssm:GetDocument`;
- `ssm:SendCommand`;
- `ssm:GetCommandInvocation`.

It cannot:

- create/update/delete SSM documents;
- pass arbitrary command parameters;
- start Session Manager sessions;
- open SSH or port forwarding;
- perform EC2 write operations;
- use S3/CloudWatch output;
- read Secrets Manager;
- decrypt KMS secrets.

`SendCommand` is restricted to the exact account-owned document ARN and exact EC2 instance ARN. The instance permission additionally requires six exact W1 resource tags: project, milestone, worker ID, W1 Git SHA, noncanonical authority, and persistent-host tier.

## Managed-node and result gates

The target must resolve through `DescribeInstanceInformation` to exactly one node with:

- exact EC2 instance ID;
- `PingStatus=Online`;
- `PlatformType=Linux`;
- `ResourceType=EC2Instance`;
- structurally valid SSM Agent version.

The SendCommand response may contain **no parameters** and must bind exact instance/document/version.

The invocation is accepted only with exact command/instance/document identity, `Success`, response code zero, empty stderr, stdout below the 24,000-character direct-output cap, and stdout that passes the existing strict courier-envelope decoder.

Even then, the classification is only:

`W1_AWS_SSM_IID_CAPTURE_UNTRUSTED_TRANSPORT_RECEIPT`

with next required gate:

`OFFHOST_PINNED_AWS_IID_CRYPTOGRAPHIC_VERIFICATION`.

## AWS research implications

Current AWS documentation supports:

- remote node management without inbound SSH ports;
- Run Command IAM/tag restrictions;
- managed-node `Online`/platform state;
- direct stdout/stderr limits;
- document versioning and SHA-256 hashes;
- sending a command with an explicit document version and document hash;
- using document hashes to detect content changes.

AWS also warns that Run Command parameters are visible/auditable and should not contain secrets. This W1 document has no parameters, so the execution role has no shell-text injection surface through SendCommand.

## Next live gate

This code still does not provision or execute the document. Live progress now requires an independently privileged provisioning step that creates **only version 1** of the reviewed account-owned SSM document. The W1 execution role must not receive document-mutation permissions.

After provisioning, the protected main execution can:

1. prove the exact EC2 host is an `Online` Linux SSM managed node;
2. prove remote version-1 document content equals the repository source;
3. execute the parameterless version/hash-pinned document on the exact tagged instance;
4. validate the resulting untrusted courier envelope;
5. perform off-host pinned AWS IID cryptographic verification;
6. only then bind the verified provider identity to the real provider reboot-request chain.

No real reboot should occur until this capture path and the pre-reboot persisted probe/backend-binding chain are ready.
