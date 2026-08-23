# W1 DEV-CYCLE-001 — create-once SSM IID document provisioning

Status: **IMPLEMENTED CONTRACT / NOT DEPLOYED / NON-AUTHORITY**

Canonical Level-1 milestone: **C1 — First Real Linux Worker**  
Level-2 milestone: `W1_PERSISTENT_LINUX_WORKER_SAFETY`

## Same-World boundary

The provisioning slice started from CP072 and remains bound to Supervisor directive #22 `CONTINUE`. The original implementation was produced on W1 claim #19. During the security recheck after that lease expired, GPT reacquired a fresh W1 lease before changing source; no F1 federation/provider/signature source is modified by this step.

## Problem

The hardened SSM transport deliberately requires an account-owned, parameterless document named `Metaengine-W1-IID-Capture-H205F22` at immutable execution version `1`. The W1 execution role is not allowed to create or mutate that document. Without a separately reviewed provisioning boundary, a future operator could accidentally provision it with a broad administrative role or silently update the command content.

A second problem was found during adversarial review of the first provisioning implementation: its CLI accepted caller-selected `--document`, `--plan`, readback-response and `--output` filesystem paths. The core AWS contract was fail-closed, but the controller process itself unnecessarily inherited filesystem read/write authority from untrusted CLI path strings.

## Research

AWS Systems Manager stores custom SSM documents in the account and Region where they are created. Schema 2.2 documents support versioning: changing document content creates a new document version. AWS APIs allow callers to address a specific version, and the default version can be changed independently.

AWS Service Authorization documentation lists `CreateDocument` as a write action supporting the SSM `document` resource type and request-tag / document-type condition keys. This allows the provisioning policy to be scoped to the exact account-owned document ARN plus H205F22 tags.

The controller I/O hardening follows a separate security principle. OWASP ASVS V5.3.2 recommends internally generated/trusted file paths instead of user-submitted filenames where possible; the OWASP Path Traversal guidance likewise recommends avoiding user input in filesystem calls. Because this controller does not need filesystem selection at all, the stronger design is to remove path arguments rather than try to sanitize them. The Python subprocess security guidance was also rechecked: W1's separate OpenSSL verifier continues to use an argv sequence with the shell disabled; this provisioning module launches no subprocesses.

References:

- https://docs.aws.amazon.com/systems-manager/latest/userguide/documents.html
- https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_CreateDocument.html
- https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_UpdateDocument.html
- https://docs.aws.amazon.com/service-authorization/latest/reference/list_ssm.html
- https://owasp.org/www-community/attacks/Path_Traversal
- https://cornucopia.owasp.org/taxonomy/asvs-5.0/05-file-handling/03-file-storage
- https://docs.python.org/3/library/subprocess.html#security-considerations

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

The CLI boundary is now JSON stdin -> JSON stdout only. Raw repository-document bytes are transported as bounded validated base64. There are no caller-controlled input/output path arguments in this provisioning controller.

Verify mode also treats the supplied plan as untrusted: it deterministically rebuilds the only acceptable plan from the exact account, Region and raw repository document bytes, and requires full structural equality. A caller cannot substitute the document ARN, IAM statements, tags, digest or non-authority flags while preserving a superficially valid schema.

## Persisted-readback validation

A provisioning receipt is possible only after AWS readback proves:

- owner equals the expected AWS account;
- type is `Command`;
- `DocumentVersion=1`;
- `LatestVersion=1`;
- `DefaultVersion=1`;
- active document state on DescribeDocument;
- AWS SHA-256 metadata is present;
- exact remote version-1 content canonically equals repository content;
- the complete provisioning plan exactly equals the deterministic locally rebuilt plan.

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

- invalid account/Region and type confusion;
- arbitrary/unknown stdin request fields, including path-like fields;
- malformed or oversized base64 document transport;
- any provisioning policy with runtime/mutation actions by exact-action assertion;
- any second/latest/default document version other than 1;
- wrong AWS account owner;
- remote document content drift;
- local repository digest substitution;
- arbitrary plan-field substitution, including ARN/policy/tag/flag drift.

## Next boundary

This contract does **not** provision AWS resources. The next live action still requires an independently authorized AWS provisioning channel to create exactly version 1. After that, the existing SSM capture guard must read the remote document back, prove content equality, capture IID bytes, and pass them to the pinned off-host cryptographic verifier.

No worker admission, W1 verification, canonical checkpoint advancement or synthetic live evidence is performed here.
