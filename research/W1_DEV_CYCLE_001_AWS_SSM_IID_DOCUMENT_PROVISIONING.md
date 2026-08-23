# W1 DEV-CYCLE-001 — create-once SSM IID document provisioning

Status: **IMPLEMENTED CONTRACT / NOT DEPLOYED / NON-AUTHORITY**

Canonical Level-1 milestone: **C1 — First Real Linux Worker**  
Level-2 milestone: `W1_PERSISTENT_LINUX_WORKER_SAFETY`

## Same-World boundary

Immediately before this step the persisted control plane reported CP072, roadmap definition integrity true, Supervisor directive #22 `CONTINUE`, and W1 claim #19 active with no base-head drift or expiry risk. The W1 branch exact pre-step head was `178cb3a8f3ab73c4ad9b4095f09bd2a14c668fe6`.

No F1 federation/provider/signature source is modified by this step.

## Problem

The hardened SSM transport deliberately requires an account-owned, parameterless document named `Metaengine-W1-IID-Capture-H205F22` at immutable execution version `1`. The W1 execution role is not allowed to create or mutate that document. Without a separately reviewed provisioning boundary, a future operator could accidentally provision it with a broad administrative role or silently update the command content.

## Research

AWS Systems Manager stores custom SSM documents in the account and Region where they are created. Schema 2.2 documents support automatic versioning: changing document content creates a new document version. AWS APIs allow callers to address a specific version, and the default version can be changed independently.

This means the safest W1 contract is not to pretend the document can never acquire another version. Instead:

1. provision version 1 with a create-only principal;
2. make that principal unable to update/delete/share or execute the document;
3. keep the W1 runtime pinned to `DocumentVersion=1`;
4. before any live execution, require remote version-1 content to canonically equal repository source;
5. fail this provisioning receipt if readback already shows `LatestVersion != 1` or `DefaultVersion != 1`.

AWS Service Authorization documentation lists `CreateDocument` as a write action supporting the SSM `document` resource type and request-tag / document-type condition keys, allowing the provisioning policy to be scoped to the exact account-owned document ARN plus H205F22 tags.

References:

- https://docs.aws.amazon.com/systems-manager/latest/userguide/documents.html
- https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_CreateDocument.html
- https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_UpdateDocument.html
- https://docs.aws.amazon.com/service-authorization/latest/reference/list_ssm.html

## Adopted provisioning boundary

`controller/w1/aws_ssm_iid_document_provision_guard.py` builds a credential-free plan for an independent provisioning principal.

The role can only:

- `ssm:CreateDocument` on the exact account/Region document ARN, constrained to `DocumentType=Command` and the exact H205F22 request-tag set;
- `ssm:DescribeDocument` and `ssm:GetDocument` on that exact ARN.

It cannot:

- `ssm:SendCommand`;
- `ssm:UpdateDocument`;
- `ssm:DeleteDocument`;
- `ssm:ModifyDocumentPermission`;
- `ssm:StartSession`.

The CreateDocument request is derived directly from the reviewed repository JSON and contains no caller command parameters. If the document already exists, the intended create-only operation fails rather than mutating the existing resource.

## Persisted-readback validation

A provisioning receipt is possible only after AWS readback proves:

- owner equals the expected AWS account;
- type is `Command`;
- `DocumentVersion=1`;
- `LatestVersion=1`;
- `DefaultVersion=1`;
- active document state on DescribeDocument;
- AWS SHA-256 metadata is present;
- exact remote version-1 content canonically equals repository content.

Even a successful receipt is only:

`W1_AWS_SSM_IID_DOCUMENT_PROVISIONED_NON_AUTHORITY`

and keeps these false:

- runtime execution authority;
- provider identity verification;
- reboot completion;
- persistent worker proof;
- W1 verification;
- canonical/authority effect.

## Negative tests

The suite rejects:

- invalid account/Region;
- any provisioning policy with runtime/mutation actions by exact-action assertion;
- any second/latest/default document version other than 1;
- wrong AWS account owner;
- remote document content drift;
- local repository digest substitution.

## Next boundary

This contract does **not** provision AWS resources. The next live action still requires an independently authorized AWS provisioning channel to create exactly version 1. After that, the existing SSM capture guard must read the remote document back, prove content equality, capture IID bytes, and pass them to the pinned off-host cryptographic verifier.

No worker admission, W1 verification, canonical checkpoint advancement or synthetic live evidence is performed here.
