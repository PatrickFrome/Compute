# AOP1 delivery authentication decision — 2026-08-21

Status: IMPLEMENTED_FOR_LIVE_CANARY

## Decision

AOP1 repeated Worker code deployments use a deploy-only exchange:

GitHub-hosted Actions push job -> GitHub OIDC JWT -> Supabase deploy broker -> Cloudflare deploy credential -> Wrangler deploy.

The exchange does not return Supabase service-role, Supervisor, wake, AI, GitHub App, or other runtime secrets to the GitHub job.

## GitHub OIDC identity

GitHub repositories created after 2026-07-15 use immutable default subject identity. The broker therefore binds the deploy job to both explicit claims and the immutable subject:

- repository: `PatrickFrome/Compute`
- repository_id: `1341371143`
- repository_owner_id: `20597814`
- ref: `refs/heads/work/aop1-autonomous-orchestration`
- workflow_ref: the exact AOP1 live-deploy workflow on that branch
- event: `push`
- runner: `github-hosted`
- repository visibility: `public`
- immutable subject contains both owner and repository numeric IDs

Each OIDC JWT can be exchanged at most once because the database stores only a SHA-256 digest of its `jti` in an append-only receipt.

## Truth boundary

This transitional path still exposes a Cloudflare deploy credential transiently to a GitHub-hosted job. It does not claim credential-free delivery. The preferred end state is Cloudflare Workers Builds Git integration, after its one-time Cloudflare GitHub App authorization, so builds and deployments remain within Cloudflare's native delivery plane.

`canonical=false`; `authority_effect=false`.
