# W1 Supabase Management Credential Provenance V13

Date: 2026-08-28
Scope: source-only credential provenance contract for the W1 callback read-only Management API collector. No provider exchange, secret use, callback deployment, database mutation, worker admission, reboot, or W1 verification is performed by this milestone.

## Problem discovered after V12

V12 correctly limits its Supabase Management API operations to GET endpoints, but HTTP method choice is not credential least privilege. Supabase documents two materially different credential classes:

- Personal Access Tokens carry the same privileges as the user account.
- OAuth2 access tokens are short-lived and tied to explicit scopes.

The Edge Functions read endpoints used by V12 require only `edge_functions:read` (fine-grained permission `edge_functions_read`), while deploy/write endpoints require `edge_functions:write`.

Official references:
- https://supabase.com/docs/reference/api/introduction
- https://supabase.com/docs/reference/api/v1-list-all-functions
- https://supabase.com/docs/reference/api/v1-get-a-function
- https://supabase.com/docs/reference/api/v1-get-a-function-body
- https://supabase.com/docs/reference/api/v1-deploy-a-function
- https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration/oauth-scopes

## Actual provider-plan constraint

A live read-only Supabase organization readback on 2026-08-28 reports the current project organization on the `free` plan.

Supabase's Management token endpoint supports `authorization_code`, `refresh_token`, and beta `urn:ietf:params:oauth:grant-type:jwt-bearer` (IDJAG). The documented IDJAG grant is Team/Enterprise only. Therefore the strongest zero-long-lived-secret workload-identity design is not currently available on this organization tier and MUST NOT be assumed in CI.

Official reference:
- https://supabase.com/docs/reference/api/v1-exchange-oauth-token

## Architectural decision: provenance lattice

V13 models three mechanisms without contacting Supabase:

### 1. `PAT_TRANSITIONAL`

Evidence semantics:
- mechanism is usable only as a transitional secret source;
- no scope may be claimed for the PAT;
- `credential_scope_status = UNVERIFIED_USER_ACCOUNT_AUTHORITY`;
- `provider_credential_scope_verified = false`;
- a long-lived/custom-expiry secret is required;
- recommended migration target on Free/Pro is scoped OAuth.

A PAT is never upgraded merely because the caller uses only GET endpoints.

### 2. `OAUTH_REFRESH_SCOPED`

Evidence semantics:
- requested scope MUST be exactly `edge_functions:read`;
- write or compound scopes are rejected;
- a successful sanitized exchange response may prove only that a Bearer access token was issued and its TTL is within the project's local one-hour cap;
- raw access/refresh token bytes are never emitted into the receipt;
- the documented token response does not include a granted-scope field, so `provider_credential_scope_verified` remains false;
- a refresh token remains a long-lived secret dependency.

This is strictly better than PAT for intended permission design but is not misrepresented as independently introspected least privilege.

### 3. `IDJAG_WORKLOAD_SCOPED`

Evidence semantics:
- Free/Pro: `BLOCKED_PLAN_TIER`; an observed exchange is rejected as contradictory evidence;
- Team/Enterprise: workload-identity exchange is structurally available and requested scope must still be exactly `edge_functions:read`;
- even an exchange response does not by itself prove granted scope because the documented response lacks scope introspection;
- no long-lived refresh secret is required by the mechanism when it is available.

This is the preferred future mechanism because it is closest to GitHub OIDC -> AWS STS and Sigstore keyless federation: short-lived workload identity rather than stored user authority.

## Why no negative write probe

V13 explicitly rejects the idea of issuing a deploy/update/delete request merely to see whether the token returns 403.

Reasons:
- a mutating endpoint can perform work if the credential is unexpectedly broad;
- validation/order-of-operations can produce a non-auth error before authorization is evaluated;
- absence of a successful mutation is not a durable proof of scope;
- no documented Management API dry-run permission simulator for this purpose was found.

Least privilege must be established from provider-issued credential provenance, not by attempting a forbidden mutation.

## Secret minimization

The guard accepts only synthetic/sanitized token response structure and emits:
- `access_token_observed` boolean;
- `refresh_token_observed` boolean;
- token type;
- `expires_in_seconds`;
- whether the token falls within a local 3600-second TTL cap.

It never emits raw token values or token hashes. Token hashes are unnecessary for this source-only contract and would create additional correlation material without proving scope.

## Comparison with stronger analogues

### AWS STS + GitHub OIDC
AWS can bind a workload identity to an exact role trust policy and intersect a session policy with role permissions. V12 already uses this property for AWS readback. Supabase Free currently lacks the equivalent documented Management workload-federation path because IDJAG is plan-gated.

### Sigstore keyless
Sigstore treats ephemeral identity as one component of a verification bundle and binds it to exact artifact digests. The transferable lesson is that identity/token issuance metadata must not be promoted to authority without independent verification of what that identity is allowed to do.

### OAuth scoped refresh
This is the best documented migration available without assuming Team/Enterprise IDJAG. It reduces intended Management API scope and access-token lifetime, but retains a refresh-secret dependency and lacks a documented granted-scope introspection field in the token response.

## Hard invariants

Every V13 receipt must keep these false:
- `provider_credential_scope_verified`;
- `provider_scope_introspection_observed`;
- `write_scope_requested`;
- `database_mutation_authorized`;
- `edge_deployment_authorized`;
- `supabase_management_write_authorized`;
- `provider_mutation_authorized`;
- `worker_admitted`;
- `w1_verified`;
- `canonical`;
- `authority_effect`.

The contract is self-hashed and fails closed on receipt tampering.

## Next implementation after source CI

If V13 source CI is green, the next safe step is NOT automatic OAuth app creation. The next step is a credential-migration readiness design that first proves which provider-supported mechanism can be configured on the actual organization without increasing authority:

1. Prefer a scoped OAuth app with only Edge Functions Read if it can be created under the current tier.
2. Keep initial authorization/refresh-secret provisioning separate from the callback collector.
3. Mint a short-lived access token only inside the protected GitHub Environment job.
4. Never persist access-token bytes into artifacts.
5. Treat requested scope as requested, not independently verified, until a provider introspection/readback surface exists.
6. If the organization later moves to Team/Enterprise, re-evaluate IDJAG as the preferred no-refresh-secret workload-identity path.

W1 remains READY, not VERIFIED. V13 has no authority to change that state.