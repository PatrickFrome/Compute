# W1 Callback Protected Provider Readback

Status: protected read-only collection contract; no provider mutation performed by this source slice.

## Goal

v8 intentionally left provider provenance outside the pure readiness guard. v9 adds the next boundary: a protected workflow and offline normalizer that collect actual provider state and turn it into the exact v8 readiness input without granting mutation authority.

The protected collector is manual-only and, once merged, must execute only from `main` through a dedicated `w1-callback-readback` GitHub Environment.

## Research refreshed 2026-08-28

### GitHub OIDC → AWS

GitHub and AWS require a constrained OIDC trust policy. AWS recommends matching `token.actions.githubusercontent.com:aud=sts.amazonaws.com` plus a constrained `sub`; GitHub documents that jobs referencing an Environment use an Environment-based subject context. GitHub also introduced immutable owner/repository-ID-based default subjects for repositories created after July 15, 2026 or repositories that opt in, so the AWS trust policy must match the repository's actual configured subject format rather than a guessed legacy string.

Repository `PatrickFrome/Compute` was created on 2026-08-21. Its immutable repository identifiers observed through GitHub are:
- repository ID `1341371143`
- repository owner ID `20597814`

References:
- https://docs.github.com/en/actions/reference/security/oidc
- https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws
- https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html
- https://docs.aws.amazon.com/IAM/latest/UserGuide/access-analyzer-reference-policy-checks.html

The workflow does not embed a guessed `sub`. The protected Environment supplies `W1_AWS_OIDC_SUB`; before AWS STS is invoked, the job requests an actual GitHub OIDC token with audience `sts.amazonaws.com`, never prints the token, decodes only its claims locally, and requires exact matches for:
- `aud=sts.amazonaws.com`
- `sub=$W1_AWS_OIDC_SUB`
- `repository=PatrickFrome/Compute`
- `repository_id=1341371143`
- `repository_owner_id=20597814`
- `environment=w1-callback-readback`
- `ref=refs/heads/main`

The temporary OIDC token response is deleted immediately after the claim check. AWS independently verifies the signed OIDC token when `AssumeRoleWithWebIdentity` occurs. The AWS role still needs an independently reviewed trust-policy readback before any protected live run is treated as provider evidence.

The job additionally supplies an inline session policy, `allowed-account-ids`, a 900-second role duration, output-only credentials, and an exact read-only SSM action set.

### AWS SSM readback and document sharing

`DescribeDocument` and `GetDocument` provide the version/state/hash/content surfaces needed by the existing v7/v8 contracts. `DescribeDocumentPermission` separately reports private account sharing and public sharing (`all`). An unshared document returns empty `AccountIds` and `AccountSharingInfoList`.

- https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_DescribeDocument.html
- https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_GetDocument.html
- https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_DescribeDocumentPermission.html
- https://docs.aws.amazon.com/service-authorization/latest/reference/list_ssm.html

v9 requires both W1 callback documents to be unshared. The AWS inline session policy contains only:
- `ssm:DescribeDocument`
- `ssm:GetDocument`
- `ssm:DescribeDocumentPermission`

for the two exact account/region document ARNs. It contains no `CreateDocument`, update/delete/share mutation, `SendCommand`, `StartSession`, or EC2 action.

### Supabase Edge readback

Supabase Management API exposes Edge metadata through a GET endpoint requiring `edge_functions:read`; the function-body read endpoint uses the same read scope, while the separate deploy endpoint requires `edge_functions:write`.

- https://supabase.com/docs/reference/api/v1-get-a-function
- https://supabase.com/docs/reference/api/v1-get-a-function-body
- https://supabase.com/docs/reference/api/v1-deploy-a-function

The v9 workflow currently expects a dedicated fine-grained secret `W1_SUPABASE_MGMT_READ_TOKEN`. Its source contract performs only Edge read operations; no Edge deploy/write permission is present. A follow-up collector slice should prefer the direct function-body GET endpoint over executing a package-manager/CLI download path, reducing supply-chain surface while preserving exact source comparison.

### Postgres readback

`controller/w1/w1_callback_db_readback.sql` starts with `BEGIN READ ONLY` and performs only catalog/privilege reads. It measures effective role privileges using PostgreSQL privilege functions and checks PUBLIC function ACL state explicitly with `aclexplode`.

The protected workflow expects a dedicated `W1_SUPABASE_DB_READONLY_URL`. Even if the credential were accidentally broader, the collector session itself is read-only and contains no DDL/DML statements.

- https://www.postgresql.org/docs/18/sql-begin.html
- https://www.postgresql.org/docs/18/functions-info.html
- https://www.postgresql.org/docs/18/ddl-priv.html

## New normalizer

`controller/w1/w1_callback_provider_readback_guard.py`:
- recomputes all reviewed Git blob identities from the checked-out source;
- validates the database readback through the v8 database contract;
- validates Edge metadata and exact downloaded source bytes;
- validates AWS owner/version/latest/default/status/SHA-256 metadata;
- semantically compares AWS `GetDocument.Content` against reviewed repository JSON;
- rejects any public/private SSM document sharing or permission pagination;
- composes the v8 readiness input and invokes the existing readiness guard.

The normalizer remains pure/offline and cannot cryptographically prove that arbitrary input files came from the named provider. That provenance comes from the protected workflow execution context; consequently its result remains non-authority.

## Protected workflow

`.github/workflows/w1-callback-protected-readback.yml` has two zones:

1. `contract-tests`: runs on the v9 development branch with `contents: read` only. No cloud credentials.
2. `protected-readback`: runs only on explicit `workflow_dispatch`, requires `READBACK_W1_CALLBACK_ONLY`, checks `refs/heads/main`, exact repository IDs and the `w1-callback-readback` Environment, validates actual GitHub OIDC claims, and only then obtains short-lived AWS credentials via OIDC.

AWS credentials are exposed as outputs and injected only into the single AWS capture step. Normalization happens after that step without AWS credential references.

Raw DB/Edge/AWS readback files, downloaded Edge source and the temporary GitHub OIDC token response are deleted before artifact upload. Only the normalized non-secret readiness receipt is uploaded.

## Fail-closed behavior

The collector rejects:
- source blob drift;
- Edge slug/state/JWT/source drift;
- malformed or unexpected DB privilege readback;
- AWS owner/version/default/latest/hash/content drift;
- public or private SSM document sharing;
- paginated document-sharing readback;
- malformed provider response JSON;
- GitHub OIDC audience/subject/repository/repository-ID/owner-ID/environment/ref drift.

A provider authentication/network error fails the workflow instead of being accepted as provider evidence.

## Known follow-up

The current v9 provider normalizer treats an absent Edge function or absent AWS SSM document as a collection failure because the raw provider command fails before normalization. The v8 readiness schema already supports explicit `present=false` and `NOT_READY`. The next bounded slice should distinguish authenticated provider-level absence (`HTTP 404` for Edge; AWS `InvalidDocument`) from authentication/network failures and normalize only the former into non-authority `NOT_READY` evidence.

## Authority statement

The normalized result always remains:
- `database_mutation_authorized=false`
- `edge_deployment_authorized=false`
- `aws_mutation_authorized=false`
- `send_command_authorized=false`
- `worker_admitted=false`
- `w1_verified=false`
- `canonical=false`
- `authority_effect=false`

The collector does not deploy the callback plane. It only makes a later live readiness assertion auditable once the dedicated protected environment, read-only Supabase credentials and exact AWS OIDC role exist.
