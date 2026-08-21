# AOP1 Cloudflare runtime

This directory implements the runtime half of `NO_MANUAL_HANDOFF_V1`.

## Trust boundaries

- Supabase roadmap/claims/directives/checkpoints remain authoritative.
- Cloudflare Durable Object state is an idempotency/serialization cache only.
- Queue delivery is treated as at-least-once.
- No model tool can execute arbitrary SQL.
- GitHub mutations are fenced to the role-owned branch. `main` is explicitly rejected.
- Public-repository GitHub reads used by the Integration Analyst may run without a GitHub credential; unauthenticated GitHub REST limits therefore apply.
- GitHub mutations still require a dedicated runtime credential and fail closed when it is absent.
- Supervisor authority RPCs require the separately provisioned `AOP_SUPERVISOR_TOKEN` secret.
- No checkpoint-seal or main-merge tool exists in AOP1 v1.

## Runtime secrets

Configure through Wrangler or an equivalent secret manager:

- `SUPABASE_SERVICE_ROLE_KEY`
- `AOP_WAKE_SECRET`
- `AOP_SUPERVISOR_TOKEN`
- `CF_ACCOUNT_ID`
- `CF_AI_TOKEN`

Required only for GitHub mutations:

- `GITHUB_TOKEN`

Optional:

- `GITHUB_WEBHOOK_SECRET`
- `AOP_AI_GATEWAY_ID`

`AOP_MODEL` is a non-secret variable and may be changed per deployment.

## Runtime

1. `/wake`, GitHub webhook, cron, or `/signal` sends an idempotent wake to Cloudflare Queue.
2. Queue consumer RPCs the singleton roadmap Durable Object.
3. Durable Object de-duplicates wake IDs and starts a Workflow.
4. Workflow leases one AOP run from Supabase using lease-generation fencing.
5. Deterministic Supervisor authority-rebind runs do not require an LLM.
6. Other roles execute through Cloudflare AI Responses with allowlisted tools.
7. Result is committed through the AOP Supabase RPC; the DB state machine enqueues the next role.
8. Missing execution credentials defer the run to `WAITING_EVENT/EXECUTOR_AVAILABLE`; no synthetic completion is created.

## Live evidence boundary

The Cloudflare orchestration runtime is LIVE as of 2026-08-21. A GitHub OIDC -> Supabase Vault one-time bootstrap was consumed by the deployment workflow, and real `cf-workflow:*` leases are recorded in the authoritative AOP event ledger. W1, F1 and R1 legacy chat-holder claims were automatically rebound to `aop1:*` holders.

This does **not** make any roadmap milestone VERIFIED. Semantic authority remains in Supabase and the semantic head remains independently governed. The GitHub mutation executor is still blocked until a dedicated runtime credential is provisioned; read-only Integration Analyst work is designed to proceed against the public repository without that credential.