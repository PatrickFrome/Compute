# W1 AWS SSM Safety Capture — research checkpoint

Status: implementation contract, non-authoritative. No live `SendCommand`, reboot, admission, or Supabase evidence mutation is implied by this document.

## Problem

W1 needs host-originated Linux safety evidence from a persistent EC2/SSM managed node without turning the evidence channel into a general remote shell or allowing host output to self-assert safety, persistence, or project authority.

## Current implementation

The capture path is intentionally split into two trust domains:

1. **Provisioning plane** installs an immutable runtime package at `/opt/metaengine/w1/safety/<source-commit>`, owned by root and not group/world writable, and creates the dedicated non-root `metaengine-w1` workspace.
2. **Capture plane** uses only `Metaengine-W1-Safety-Capture-H205F22`, an account-owned, parameterless version-1 SSM Command document. It verifies the pinned package before dropping from SSM/root transport context to `metaengine-w1` via `runuser`.
3. **Off-host validation** decodes the courier, verifies transport/self hashes, exact source identity and execution context, then recomputes the safety decision with `host_safety_envelope_validator.py`.
4. A valid courier is still non-authoritative: `host_safety_verified=false`, `persistent_worker_proof=false`, `w1_verified=false`. Production safety verification and persisted readback remain separate gates.

## AWS research findings

### Restrict Run Command to an exact document and exact targets

AWS Systems Manager Run Command supports IAM policies that restrict `ssm:SendCommand` to specific SSM documents and managed nodes selected through resource tags. This maps directly to W1's exact account-owned document + exact EC2 instance + `metaengine:*` tag conditions.

Reference: https://docs.aws.amazon.com/systems-manager/latest/userguide/run-command-setting-up.html

### Pin document version and SHA-256

`SendCommand` supports `DocumentVersion`, `DocumentHash`, and `DocumentHashType=Sha256`. The W1 command plan therefore carries exact document version `1` and the AWS-reported system SHA-256 for that reviewed remote document. SHA-1 is not used.

Reference: https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_SendCommand.html

### Do not allow nested/remote document execution

AWS documents that `AWS-RunDocument` / `aws:runDocument` can execute documents from remote locations and can bypass restrictions intended for a specific document. The W1 capture role and document therefore reject `AWS-RunDocument`, `aws:runDocument`, URL/S3 fetches, and caller parameters.

Reference: https://docs.aws.amazon.com/systems-manager/latest/userguide/documents-running-from-remote.html

### Keep the capture document small and fixed

SSM document content is limited to 64 KB and AWS recommends schema 2.2 for new Command documents. W1 keeps the document parameterless and delegates the larger reviewed runtime to a separately provisioned content-addressed package instead of embedding mutable code or fetching "latest" code during capture.

References:
- https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_CreateDocument.html
- https://docs.aws.amazon.com/systems-manager/latest/userguide/documents-creating-content.html

## Security invariants

- No arbitrary SSM command parameters.
- No StartSession, SSH, port forwarding, S3 output, CloudWatch output, reboot, Secrets Manager, or KMS decrypt authority in the capture session policy.
- No network code/package fetch from the capture document.
- No nested/generic SSM document execution.
- SSM/root context may validate immutable package metadata but must not execute the worker safety probe as root.
- The actual safety bundle must execute as the fixed non-root user `metaengine-w1` in `/var/lib/metaengine/w1/workspace`.
- The package source revision intentionally predates the transport commits so the transport cannot self-select or rewrite the code that it is supposed to verify.
- Host/courier output is untrusted transport. Off-host recomputation can establish deterministic consistency, not AWS provenance or production DB verification.
- A safety-eligible result is still only `SAFETY_ENVELOPE_ELIGIBLE_NON_PERSISTENT`.

## Remaining live gate

The next real W1 step requires a genuinely bound persistent managed node plus a separately authorized provisioning operation. Only after the reviewed package is installed on that node should the exact safety capture document be dispatched. The resulting courier must then enter a dedicated persisted verification path before it can satisfy `compute_fabric_linux_worker_safety_status_h205f22`.
