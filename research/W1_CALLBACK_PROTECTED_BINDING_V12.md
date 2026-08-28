# W1 Callback Protected Binding V12 — Architecture and Security Research

Date: 2026-08-28
Scope: read-only W1 callback readiness evidence. This design does **not** provision the callback plane, mutate AWS/Supabase, admit a worker, prove persistence, or verify W1.

## Decision

V12 replaces the two previous live callback readback entrypoints with one protected pipeline:

`credential-free GitHub policy readback -> Environment approval gate -> post-gate policy drift check -> one GitHub OIDC token -> local immutable-identity checks -> same token submitted to AWS STS -> exact IAM role trust readback -> authenticated Supabase/AWS inventory -> final self-hashed non-authority binding receipt`

The older v1/v2 workflows remain only as historical unit/contract test runners and have no `workflow_dispatch`, `id-token: write`, provider secrets, STS exchange, or provider API execution.

## 1. GitHub Environment as the credential-release boundary

GitHub Environments can require reviewers and prevent self-review. Environment protection rules must pass before a job referencing that environment starts and before environment secrets become available. V11 already validates:

- exact Environment `w1-callback-readback`;
- independent reviewer(s);
- `prevent_self_review=true`;
- admin bypass disabled;
- exact main-only deployment routing;
- protected `main`;
- no unreviewed custom deployment-protection apps.

V12 reuses that receipt and reads the same Environment metadata again after the approval gate. A byte-different normalized receipt is a hard failure, closing approval-time configuration drift.

Official reference:
- https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
- https://docs.github.com/en/rest/deployments/environments

## 2. Immutable GitHub OIDC identity, not mutable repository names alone

GitHub changed the default `sub` format for repositories created after 2026-07-15 so immutable owner/repository IDs can be included. `PatrickFrome/Compute` was created on 2026-08-21 and its authoritative GitHub metadata is:

- repository id: `1341371143`
- owner id: `20597814`

Therefore V12 requires the immutable environment subject:

`repo:PatrickFrome@20597814/Compute@1341371143:environment:w1-callback-readback`

It rejects the older name-only subject. It also requires the repository OIDC customization endpoint to report the default subject configuration and rejects a custom claim template or an explicit opt-out from immutable subjects.

The OIDC token is bound to:

- issuer `https://token.actions.githubusercontent.com`;
- audience `sts.amazonaws.com`;
- immutable `sub` above;
- repository name + repository id + owner id;
- Environment;
- exact `refs/heads/main`;
- `workflow_dispatch` event;
- exact workflow path/ref;
- `workflow_sha == GITHUB_SHA`;
- run id + run attempt from the already sealed Environment gate;
- GitHub-hosted runner;
- `jti` and bounded token lifetime.

The local guard does **not** pretend to verify the JWT signature. It explicitly records `jwt_signature_locally_verified=false`. Cloud-provider acceptance is required as the independent cryptographic verification boundary.

Official references:
- https://docs.github.com/en/actions/reference/security/oidc
- https://docs.github.com/en/rest/actions/oidc
- https://token.actions.githubusercontent.com/.well-known/openid-configuration

### Time semantics

GitHub's documented token example has `nbf < iat < exp`; a validator must not require `iat <= nbf`. V12 includes a regression test for this exact ordering and bounds total validity rather than inventing a different JWT timing model.

## 3. Submit the same checked token directly to AWS STS

The prior workflow locally decoded one token but then let `aws-actions/configure-aws-credentials` request/exchange its own token. That created an avoidable provenance gap: local checks and cloud acceptance were not demonstrably over identical JWT bytes.

V12 requests **one** GitHub token, hashes it, validates its claims, and submits those exact bytes directly to:

`sts:AssumeRoleWithWebIdentity`

using an on-disk `file://` parameter. The raw JWT and STS credential response are temporary files with restrictive permissions and are removed before the final receipt is produced.

AWS returns `SubjectFromWebIdentityToken`, `Audience`, `Provider`, `AssumedRoleUser`, and `PackedPolicySize`. V12 binds these fields to the locally checked token hash and run-specific role session name.

Official references:
- https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRoleWithWebIdentity.html
- https://docs.aws.amazon.com/cli/latest/reference/sts/assume-role-with-web-identity.html
- https://docs.aws.amazon.com/cli/latest/userguide/cli-usage-parameters-file.html

## 4. Session policy can only narrow the role

AWS documents that an inline session policy for `AssumeRoleWithWebIdentity` is intersected with the role's identity policy; it cannot grant permissions the role does not already possess. The plaintext inline policy is also limited to 2,048 characters.

V12 builds a deterministic <=2048-character policy containing only:

- `iam:GetRole` on the exact readback role;
- `ssm:ListDocuments` for authenticated inventory;
- `ssm:DescribeDocument`, `ssm:GetDocument`, `ssm:DescribeDocumentPermission` on the two exact W1 callback SSM documents.

No `SendCommand`, `StartSession`, reboot, IAM mutation, document mutation, instance mutation, or provider write appears.

## 5. Read back the role's trust, not just its permissions

A locally correct token is not enough if the AWS role itself trusts a broad wildcard subject. After STS succeeds, the short-lived intersected session reads its own exact role with `iam:GetRole` and V12 validates the trust policy:

- exactly one Allow statement;
- exact GitHub OIDC provider ARN for the account/partition;
- action exactly `sts:AssumeRoleWithWebIdentity`;
- condition operator exactly `StringEquals`;
- audience exactly `sts.amazonaws.com`;
- subject exactly the immutable Environment subject;
- no `StringLike`, wildcard, second principal, second trust statement, branch wildcard, pull-request wildcard, or organization-wide trust.

This is deliberately stricter than a typical GitHub/AWS sample because this role exists only for one narrow evidence collector.

Official reference:
- https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws
- https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc_verify-thumbprint.html

## 6. Supabase readback stays GET-only and inventory-first

Supabase Management API exposes read scopes for listing Edge Functions, reading one function, and retrieving its body. V12 uses those GET endpoints directly; it does not run the Supabase CLI, npm/npx, package installers, migrations, deployments, or function writes.

The database side runs the existing callback introspection SQL inside `BEGIN READ ONLY` and additionally supplies `default_transaction_read_only=on`, statement timeout, and lock timeout through `PGOPTIONS`.

Authenticated absence is accepted only after successful inventory:

- Edge: list all functions; exact slug absent => `NOT_READY`;
- AWS: `ListDocuments Owner=Self + Name`; exact document absent => `NOT_READY`.

Transport/auth/provider errors are not normalized into absence.

Official references:
- https://api.supabase.com/api/v1#tag/edge-functions/GET/v1/projects/{ref}/functions
- https://api.supabase.com/api/v1#tag/edge-functions/GET/v1/projects/{ref}/functions/{function_slug}
- https://api.supabase.com/api/v1#tag/edge-functions/GET/v1/projects/{ref}/functions/{function_slug}/body

## 7. Comparison with stronger supply-chain patterns

Sigstore keyless signing is the closest useful analogue: a short-lived OIDC identity is bound to an artifact/digest and verification relies on an evidence bundle rather than long-lived signing secrets. V12 borrows the transferable pattern, not Sigstore's signing authority:

- ephemeral workload identity;
- immutable identity fields;
- exact source SHA/tree binding;
- provider acceptance independent of local decoding;
- content/evidence digests;
- one final portable receipt;
- no authority upgrade from identity proof alone.

References:
- https://docs.sigstore.dev/cosign/signing/signing_with_blobs/
- https://docs.sigstore.dev/about/system_config/identity-provider/
- https://docs.sigstore.dev/about/bundle/

## 8. Authority boundary

Even a fully successful V12 manual run proves only that:

1. the reviewed Environment gate was stable;
2. a GitHub OIDC identity for the exact main workflow was accepted by AWS;
3. the AWS readback role's trust is exact;
4. authenticated read-only provider observations were collected and bound to one source revision.

It does **not** prove:

- callback plane deployment authority;
- provider identity of a Linux host;
- SendCommand execution;
- a reboot;
- persistence across reboot;
- safety verification;
- worker admission;
- canonical C1 promotion;
- W1 verification.

All final authority fields remain false. `READY_CANDIDATE_NON_AUTHORITY` is still only callback-plane readiness; `NOT_READY` is a valid successful evidence result when authenticated inventory proves missing components.

## Post-research conclusion

Compared with v9/v10, V12 removes four trust gaps simultaneously:

1. mutable/name-only OIDC subject assumptions;
2. separate locally-inspected vs STS-exchanged JWTs;
3. unverified broad IAM role trust;
4. alternate legacy manual callback workflows that could bypass the newer gate.

The next safe action after source CI is exact manual preflight on `main` only after the required GitHub Environment is known to exist and is independently approved. No provider mutation should be added to this workflow.