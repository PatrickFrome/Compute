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

## Source implementation and exact CI

Source branch: `work/main-roadmap-accelerators-v13`.

Semantic source commit:
- commit `a5785e114cab5702dc67d19ebb37fd21f2f7fd10`;
- tree `57591c7a68ff566e8f2dd9b02bd436fbb318f3b6`.

Implemented:
- `controller/w1/w1_supabase_management_credential_provenance_guard.py`;
- `tests/test_w1_supabase_management_credential_provenance_guard.py`;
- `.github/workflows/w1-supabase-management-credential-provenance-contract.yml`.

The workflow is source-only: no `workflow_dispatch`, no OIDC permission, no secrets/vars, no Supabase endpoint, no provider call.

Exact CI:
- run `33191345822`;
- workflow `W1 Supabase Management Credential Provenance V13`;
- head SHA `a5785e114cab5702dc67d19ebb37fd21f2f7fd10`;
- conclusion `success`.

The tests cover PAT non-verification, Free-plan IDJAG blocking, Team-plan IDJAG non-promotion, exact read-only OAuth scope, write/compound-scope rejection, short-lived access-token local cap, raw-token redaction, receipt tamper rejection and all authority fields remaining false.

## Provider API inventory post-research

A second provider/documentation search did not find a documented read-only Management API endpoint for listing OAuth applications and their configured scopes. The connected Supabase tool surface also exposes no OAuth-app inventory action.

Supabase documents OAuth app creation/configuration through the Dashboard, and scopes are configured on the OAuth app. Therefore V13 does not invent an OAuth-app readback or infer the app's granted scopes from a token request.

This creates a real boundary:
- operations can be proven GET-only;
- requested OAuth scope can be proven exact;
- access-token type/lifetime can be observed from a token response;
- configured/granted provider scope cannot currently be independently introspected by this automation.

## Live control-plane post-audit

Read-only Supabase audit at `2026-08-28T16:45:03.140152Z` confirms V13 caused no runtime/control-plane drift:

- W1 `effective_status = READY`;
- W1 `verified_checkpoint_id = null`;
- safety verifications: `0`;
- backend bindings: `0`;
- reboot receipts: `0`;
- admitted non-revoked `cpu-local`: `0`;
- callback key table: absent;
- callback receipt table: absent;
- roadmap definition integrity: true;
- current/sealed roadmap definition digest remains `96068a842c7dcb37d216aad6defc7b51e291394e916f76beed447be630024925`.

Thus V13 is a trust-model improvement only. It does not create false W1 or callback progress.

## Next safe implementation

The next safe step is NOT automatic OAuth app creation. The next implementation should first define a separately approved OAuth provisioning/handoff boundary:

1. Prefer an OAuth app configured only for Edge Functions Read if the current tier/dashboard permits it.
2. Keep OAuth-app provisioning and initial interactive authorization outside the callback collector trust domain.
3. Store any refresh credential only in the protected GitHub Environment and mint a short-lived access token per approved run.
4. Never persist access-token bytes into Actions artifacts.
5. Treat `edge_functions:read` as requested/configured intent, not independently verified granted scope, until Supabase exposes a trustworthy scope readback/introspection surface.
6. On Team/Enterprise, re-evaluate IDJAG and prefer workload federation to eliminate the refresh-secret dependency.

W1 remains READY, not VERIFIED. V13 has no authority to change that state.