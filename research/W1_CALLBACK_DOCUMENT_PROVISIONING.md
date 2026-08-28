# W1 Callback SSM Document Provisioning Contract

Status: source-only provisioning/readback contract. No AWS mutation performed by this slice.

## Scope

This slice turns the two callback-auth SSM documents into explicit create-once provisioning objects without granting runtime execution authority:

1. `Metaengine-W1-Callback-Key-Enroll-H205F22`
2. `Metaengine-W1-Execution-Marker-H205F22`

`controller/w1/aws_ssm_callback_document_provision_guard.py` builds the only acceptable `CreateDocument` request/policy template and validates caller-supplied create/describe/get response transport against reviewed repository bytes.

## Research rechecked 2026-08-28

### AWS CreateDocument

AWS `CreateDocument` accepts document content, name, type, format, tags and `TargetType`. AWS documents `/AWS::EC2::Instance` as the target type for EC2-only documents and caps document content at 64 KB. Its response `DocumentDescription` exposes `DocumentVersion`, `LatestVersion`, `DefaultVersion`, `Hash`, `HashType`, owner and other state used by this guard.

- https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_CreateDocument.html
- https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_DescribeDocument.html
- https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_GetDocument.html

Design consequence: both documents are create-once, account-owned version `1`; version `1` must also remain latest and default, be active, retain a SHA-256 AWS document hash, and read back as exact reviewed semantic JSON. Any update creates a version/state mismatch and fails closed.

### IAM surface

The AWS Systems Manager Service Authorization Reference lists `CreateDocument` on the `document` resource type and supports request-tag/tag-key and `ssm:DocumentType` conditions. `DescribeDocument` and `GetDocument` are read actions on the document resource.

- https://docs.aws.amazon.com/service-authorization/latest/reference/list_ssm.html

Design consequence: the provisioning policy template contains only:
- `ssm:CreateDocument` for the exact account/region/name ARN with exact request tags and `ssm:DocumentType=Command`;
- `ssm:DescribeDocument` and `ssm:GetDocument` for the same ARN.

It deliberately does not contain `UpdateDocument`, `UpdateDocumentDefaultVersion`, `DeleteDocument`, `ModifyDocumentPermission`, `PutResourcePolicy`, `SendCommand` or `StartSession`.

The template is not a claim about effective IAM permissions. SCPs, permissions boundaries, session policies, other identity policies and resource policy state are outside this offline contract.

### Runtime parameter safety

AWS documents `interpolationType=ENV_VAR` for String parameters, which exposes values as `SSM_<parameter-name>` environment variables and reduces command-injection risk when combined with `allowedPattern`. AWS notes that agents before `3.3.2746.0` ignore this interpolation feature and recommends fallback substitution for compatibility.

- https://docs.aws.amazon.com/systems-manager/latest/userguide/documents-syntax-data-elements-parameters.html
- https://docs.aws.amazon.com/systems-manager/latest/userguide/documents-creating-content.html
- https://docs.aws.amazon.com/systems-manager/latest/userguide/documents-schemas-features.html

For W1 the compatibility fallback is intentionally rejected: the execution document references `SSM_*` variables directly and must fail on an old agent rather than reintroduce raw `{{parameter}}` shell substitution. The provisioning guard therefore requires the exact reviewed five non-secret parameter definitions, `ENV_VAR`, strict patterns, and the no-fallback script literal. The callback-key enrollment document remains parameterless.

### Runtime dispatch remains a separate authority boundary

AWS `SendCommand` can select a specific `DocumentVersion`, exact managed-node IDs, and a document hash/hash type. That is the correct later dispatch boundary, but provisioning must not grant it.

- https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_SendCommand.html

Design consequence: this provisioning slice produces no SendCommand request and grants no runtime authority. A later protected runtime guard must independently pin exact document name/version/hash and exact W1 instance identity/tags.

## Fail-closed invariants

The provisioning guard rejects:
- any third document kind or name;
- callback-key document parameters;
- any execution parameter addition/removal or weakened interpolation/pattern;
- non-Linux/non-EC2 target shape;
- wrong owner, document type, version, latest/default version, status or SHA-256 hash metadata;
- remote document content that differs from reviewed repository JSON;
- any caller-tampered provisioning plan;
- source that introduces `AWS-RunDocument`, `aws:runDocument`, GitHub/S3 remote source, secret-bearing callback parameters, or raw SSM parameter substitution.

## Trust statement

A successful offline receipt means only that caller-supplied AWS-shaped response transport is internally consistent with the create-once reviewed-document contract. It deliberately emits:

- `document_provisioned=false`
- `document_provisioned_authoritatively_verified=false`
- `runtime_execution_authority=false`
- `provider_identity_verified=false`
- `persistent_worker_proof=false`
- `worker_admitted=false`
- `w1_verified=false`
- `canonical=false`
- `authority_effect=false`

No result from this source/CI slice is live W1 evidence.
