# W1 DEV-CYCLE-001 — create-once SSM IID document provisioning

Status: **IMPLEMENTED OFFLINE CONTRACT / NOT DEPLOYED / NON-AUTHORITY**

Canonical Level-1 milestone: **C1 — First Real Linux Worker**  
Level-2 milestone: `W1_PERSISTENT_LINUX_WORKER_SAFETY`

## Same-World boundary

This slice remains on CP072 under Supervisor directive #22. The current security recheck is performed under W1 claim #23. No F1 federation/provider/signature source is modified.

## Purpose

The runtime SSM transport requires an account-owned, parameterless document named `Metaengine-W1-IID-Capture-H205F22` and is pinned to execution version `1`. The provisioning controller therefore builds a narrowly scoped create/read IAM **policy template** and a deterministic `CreateDocument` request from the reviewed repository JSON.

The controller itself never calls AWS. Its CLI is JSON stdin -> JSON stdout only; repository document bytes are bounded strict base64, so callers cannot select filesystem paths.

## Research and corrected trust boundary

AWS Systems Manager supports custom document versioning and lets callers address a specific version; the default version can change independently. `CreateDocument` supports the SSM `document` resource type together with request-tag / tag-key and document-type condition keys, so the generated statement can be scoped to the exact account/Region document ARN and exact H205F22 tags.

A second adversarial pass found an important IAM semantics issue in the earlier wording. An identity-based policy that contains only narrow `Allow` statements does **not** prove the effective permissions of the principal to which it is attached: effective authorization can also depend on other identity/resource policies, permissions boundaries, session policies, service control policies, and explicit denies. Therefore this offline module must not claim that a real provisioning role "cannot" update/delete/share/execute merely because this generated template omits those allows.

The contract now states only what it can prove:

- the generated template allows `ssm:CreateDocument` on the exact document ARN with `DocumentType=Command` and exact request tags;
- the generated template allows only `ssm:DescribeDocument` and `ssm:GetDocument` for readback;
- this template contains no allow for update/delete/share/send-command/session surfaces;
- `effective_principal_permissions_verified=false` until an independent live IAM/effective-permission check exists.

The partition logic is also aligned with the runtime guard: commercial=`aws`, GovCloud=`aws-us-gov`, China=`aws-cn`.

References:

- https://docs.aws.amazon.com/systems-manager/latest/userguide/documents.html
- https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_CreateDocument.html
- https://docs.aws.amazon.com/service-authorization/latest/reference/list_ssm.html
- https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html
- https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html
- https://docs.aws.amazon.com/IAM/latest/UserGuide/reference-arns.html

## Deterministic provisioning plan

`controller/w1/aws_ssm_iid_document_provision_guard.py` builds:

- exact account/Region/partition document ARN;
- exact parameterless `Command` document content derived from repository bytes;
- exact H205F22 request tags;
- create/read policy template;
- repository source digest;
- hard non-authority flags.

Verify mode treats the supplied plan as untrusted and rebuilds the only acceptable plan from account, Region and raw repository document bytes. Any ARN, policy, tag, digest or flag substitution fails structural equality.

## AWS response transport validation

The `create_response`, `describe_response` and `get_document_response` objects supplied to offline verify mode are **caller-supplied transport**, not authenticated AWS provenance. Their successful validation proves only internal consistency with the contract:

- expected account owner;
- type `Command`;
- `DocumentVersion=1`;
- `LatestVersion=1`;
- `DefaultVersion=1`;
- active DescribeDocument state;
- SHA-256 metadata shape;
- exact remote-content equality to repository source.

The receipt now explicitly records:

- `aws_api_response_provenance=CALLER_SUPPLIED_AWS_RESPONSE_TRANSPORT_NON_AUTHORITY`;
- `live_aws_api_provenance_verified=false`;
- `effective_principal_permissions_verified=false`;
- `document_provisioning_observation_validated=true`;
- `document_provisioned=false`;
- `document_provisioned_authoritatively_verified=false`.

The historical classification string remains `W1_AWS_SSM_IID_DOCUMENT_PROVISIONED_NON_AUTHORITY` for schema compatibility, but it must not be interpreted as live AWS evidence.

Hard nonclaims remain false: runtime execution authority, provider identity verification, reboot completion, persistent worker proof, W1 verification, canonical, authority effect.

## Negative tests

The suite covers:

- invalid account/Region and type confusion;
- commercial/GovCloud/China partition mapping, including `aws-cn`;
- arbitrary/unknown stdin fields and path-like fields;
- malformed/oversized base64;
- exact policy-template action set;
- no claim of effective principal permissions;
- second/latest/default version drift;
- wrong owner;
- remote content drift;
- local digest and arbitrary plan substitution;
- explicit caller-supplied AWS response provenance and non-authority outcome.

## Next live boundary

This contract does **not** provision AWS resources. A future live step requires an independently authorized AWS channel and independent provenance/readback of the actual account state. Only then may the runtime SSM capture path verify the exact version-1 document, prove the target is an Online Linux SSM managed EC2 node, capture real IID bytes, and pass them to the pinned off-host cryptographic verifier.

No worker admission, W1 verification, canonical checkpoint advancement or synthetic live evidence is performed here.
