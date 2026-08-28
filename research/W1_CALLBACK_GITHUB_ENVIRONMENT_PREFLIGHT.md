# W1 Callback GitHub Environment Preflight

Status: v11 credential-free GitHub control-plane boundary. This slice does not request GitHub OIDC, AWS credentials, Supabase credentials, environment secrets, or provider mutation authority.

## Purpose

v10 can safely normalize live callback provider readback, but its protected job must not be dispatched until the GitHub Environment that gates provider credentials is independently validated.

v11 validates the GitHub-only control plane first and, on a later explicit manual dispatch from `main`, can prove that a zero-provider-credential job actually crossed the configured Environment approval gate before any AWS or Supabase credential is involved.

## Current GitHub facts

Repository:
- `PatrickFrome/Compute`
- repository ID `1341371143`
- repository owner ID `20597814`

A live public branch readback on 2026-08-28 shows `main` is protected and currently points to `0d1c074c7f513f25000d967761c7bb13912dacaa`.

The connected GitHub app does not expose the repository Environment REST endpoint, so v11 does not claim the current `w1-callback-readback` Environment exists or is correctly configured. The workflow itself will fetch and validate that public metadata when explicitly dispatched from `main`.

## Research refreshed 2026-08-28

GitHub Environment protection rules are evaluated before a job referencing the environment is sent to a runner. Environment secrets are not made available until protection rules have passed.

Required reviewers can contain up to six users/teams; only one approval is needed. With `prevent_self_review` enabled, the user who initiated the deployment cannot approve it, providing an independent-review boundary.

GitHub deployment branch policies can use custom branch/tag name patterns. The REST API lists those policies and is readable for public repository resources. `custom_branch_policies=true` is required to use the custom deployment-branch-policy endpoints.

GitHub also exposes enabled custom GitHub-App deployment protection rules separately. v11 rejects them for this Environment because the callback readback gate is intended to have a small deterministic protection model: required reviewer + exact main-only branch policy, with an optional bounded wait timer.

References:
- https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
- https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments
- https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments
- https://docs.github.com/en/rest/deployments/environments
- https://docs.github.com/en/rest/deployments/branch-policies?apiVersion=2026-03-10
- https://docs.github.com/en/rest/deployments/protection-rules

## Required environment shape

`controller/w1/w1_callback_environment_preflight_guard.py` requires:

- exact environment name `w1-callback-readback`;
- `can_admins_bypass=false`;
- exactly one `required_reviewers` rule;
- 1–6 typed User/Team reviewers;
- `prevent_self_review=true`;
- exactly one `branch_policy` protection rule;
- optional single wait timer in the documented range;
- `deployment_branch_policy.protected_branches=false`;
- `deployment_branch_policy.custom_branch_policies=true`;
- exactly one custom deployment policy whose exact name is `main` and whose type, when exposed, is `branch`;
- repository branch `main` itself is protected;
- zero enabled custom GitHub-App deployment protection rules.

The guard deliberately does not accept the broader `protected_branches=true` environment mode. Although `main` is protected, that mode can allow any protected branch. The callback readback environment needs a directly auditable `main`-only route.

## Two-phase gate proof

`.github/workflows/w1-callback-environment-preflight.yml` has three zones:

1. `contract-tests` — push CI on the v11 development branch; source only.
2. `environment-preflight` — manual `main` dispatch only. It uses public GitHub GET endpoints, no Authorization header, no Environment reference, no OIDC and no provider secret. It validates the environment before any gated job exists.
3. `environment-gate-proof` — references `environment: w1-callback-readback` but still has no provider secret and no `id-token: write`. GitHub will not start the job until the Environment protection rules pass. Once it starts, it re-fetches the same public metadata and requires the post-gate self-hashed receipt to equal the pre-gate receipt exactly.

This detects Environment policy drift during the approval window. The resulting gate receipt proves only that the GitHub gate job reached execution under a stable reviewed configuration. It does not authorize AWS or Supabase access.

## Why no GitHub API bearer token is used for metadata

GitHub documents the environment and deployment branch-policy GET endpoints as readable without authentication for public resources. `Compute` is public, so v11 uses unauthenticated GET requests for the policy evidence. Checkout and artifact actions still operate inside GitHub Actions normally, but the Environment metadata proof does not depend on a privileged repository token.

## OIDC boundary

v11 does not request an OIDC token. It records only the expected protected context:
- repository `PatrickFrome/Compute`
- repository ID `1341371143`
- owner ID `20597814`
- environment `w1-callback-readback`
- ref `refs/heads/main`

The actual OIDC-token claim validation remains in the v10 protected provider-readback workflow immediately before AWS STS. This separation prevents the GitHub Environment preflight itself from becoming an AWS credential path.

## Authority statement

Every v11 receipt remains:
- `provider_credentials_used=false`
- `oidc_token_requested=false` for the gate proof
- `aws_execution_authorized=false`
- `supabase_mutation_authorized=false`
- `worker_admitted=false`
- `w1_verified=false`
- `canonical=false`
- `authority_effect=false`

No environment is created or modified by v11. If the environment does not exist or does not match the contract, the manual preflight fails closed.
