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

GitHub's documented token example has `nbf < iat < exp`; a validator must not require `iat <= nbf`. The corrected V12 guard accepts `nbf <= iat <= exp`, bounds the complete `exp - nbf` validity window to 1200 seconds, and includes a regression test for the documented ordering.

The first adversarial CI run intentionally exposed the earlier incorrect ordering and was kept as evidence rather than hidden or rerun unchanged.

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
- https://supabase.com/docs/reference/api/v1-list-all-functions
- https://supabase.com/docs/reference/api/v1-get-a-function
- https://supabase.com/docs/reference/api/v1-get-a-function-body

### Credential-scope limitation discovered in post-research

GET-only application code does **not** prove that the bearer token itself is read-scoped. Supabase documents that Personal Access Tokens inherit the privileges of the user account, while OAuth2 tokens can be short-lived and restricted by scopes. The three V12 Edge endpoints require only `edge_functions:read` / `edge_functions_read`.

Therefore V12 records no claim that `W1_SUPABASE_MGMT_READ_TOKEN` is provider-verifiably least privilege. That is a separate credential-provenance property and becomes the next hardening milestone. A future V13 must prefer a provider-issued scoped/short-lived credential and must fail closed if the credential's scope cannot be independently established. It must not infer least privilege merely from HTTP method choice.

## 7. Comparison with stronger supply-chain patterns

Sigstore keyless signing is the closest useful analogue: a short-lived OIDC identity is bound to an artifact/digest and verification relies on an evidence bundle rather than long-lived signing secrets. V12 borrows the transferable pattern, not Sigstore's signing authority:

- ephemeral workload identity;
- immutable identity fields;
- exact source SHA/tree binding;
- provider acceptance independent of local decoding;
- content/evidence digests;
- one final portable receipt;
- no authority upgrade from identity proof alone.

Sigstore's verification model additionally checks the artifact digest, identity/issuer and a verification bundle containing certificate/signature/log proof. This reinforces the V12 rule that identity evidence is meaningful only when bound to exact content and independently verified.

References:
- https://docs.sigstore.dev/cosign/signing/signing_with_blobs/
- https://docs.sigstore.dev/cosign/verifying/verify/
- https://docs.sigstore.dev/quickstart/quickstart-cosign/

## 8. Exact source CI evidence

Initial adversarial V12 run:

- run `33188032949`: `failure` in `contract-tests` only;
- `credential-free-preflight`: skipped;
- `protected-binding`: skipped;
- no protected Environment/OIDC/AWS/Supabase credential path executed.

It exposed the JWT temporal-order bug plus legacy test migration debt.

After fixes:

- semantic fix commit: `29b70b0572bb882c13981b47646e2c72df6f5949`;
- legacy-v2 standalone run `33190303230`: success;
- latest source head before this documentation seal: `dcd803fc9a28f2fe1079747fc58f18a57ab1753a`;
- legacy-v1 run `33190426700`: success;
- protected-binding run `33190426781`: success;
- on `33190426781`, `contract-tests` succeeded while both manual-only jobs (`credential-free-preflight`, `protected-binding`) were skipped.

Thus source contracts are green without exercising or claiming live provider readiness.

## 9. Live Supabase read-only post-audit

Observed at approximately `2026-08-28T16:33:51Z` using explicit read-only SQL against project `xpeibufgzjknrhbhpffp`:

- authoritative H205F22 control-plane objects are in `destruktion_meta`, not `public`;
- roadmap definition integrity: true;
- roadmap drift detected: false;
- canonical integrity: true;
- W1 `effective_status = READY`;
- W1 `verified_checkpoint_id = null`;
- safety observations: 18;
- safety verifications: 0;
- backend bindings: 0;
- reboot receipts: 0;
- non-revoked worker enrollments: 2;
- admitted non-revoked workers: 0;
- non-revoked `cpu-local`: 1;
- admitted `cpu-local`: 0;
- callback key table: absent;
- callback receipt table: absent;
- callback RPC count: 0.

The active CPU/GPU/cache safety policy remains:

- policy: `linux-h1-h13-v1`;
- SHA-256: `3dba3ce69e945e52ff1a2ab23e2981dd543296c72f229673bcc44c94c9e70122`;
- enabled: true;
- `authority_effect=false`.

This is consistent with the hard boundary: W1 remains READY, not VERIFIED, and callback readiness remains absent rather than inferred.

Roadmap lease truth remains v2 with no fresh active claims; one expired persisted W1 claim remains cleanup debt with `stale_rows_authority_effect=false`. No reconciliation mutation was executed.

## 10. Advisor post-audit

No DDL was performed in V12. Security advisors nevertheless surface pre-existing project-wide hardening debt that must not be silently conflated with this source change:

- many `destruktion_meta` tables have RLS enabled with no policies; this can be intentional for a closed schema but should be normalized/documented rather than left ambiguous;
- `public.coordination_read_barrier_h205f22()` is `SECURITY DEFINER` and executable by both `anon` and `authenticated` — WARN, separate security-hardening lane;
- leaked-password protection is disabled — WARN for Auth;
- performance advisors primarily report currently-unused indexes; no index is removed based on this snapshot alone because low-use/new tables can legitimately have zero scans.

Relevant Supabase remediation:
- https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
- https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
- https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## 11. Authority boundary

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

## Post-research conclusion and next step

Compared with v9/v10, V12 removes four trust gaps simultaneously:

1. mutable/name-only OIDC subject assumptions;
2. separate locally-inspected vs STS-exchanged JWTs;
3. unverified broad IAM role trust;
4. alternate legacy manual callback workflows that could bypass the newer gate.

Post-research adds a fifth hardening target rather than weakening V12: provider-verifiable Supabase credential scope. The next safe implementation is a V13 credential-provenance contract that accepts only a short-lived/scoped Management API credential with the minimum Edge read capability when provider support allows it. Until then, V12 must say only that its **operations** are GET-only, not that its Management bearer credential is proven least privilege.

No manual provider run, provider mutation, callback provisioning, worker admission, reboot, W1 verification, roadmap reconciliation, DDL, or Edge deployment is authorized by this checkpoint.