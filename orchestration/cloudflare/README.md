# AOP1 Cloudflare runtime

This directory implements the runtime half of `NO_MANUAL_HANDOFF_V1`.

## Trust boundaries

- Supabase roadmap/claims/directives/checkpoints remain authoritative.
- Cloudflare Durable Object state is an idempotency/serialization cache only.
- Queue delivery is treated as at-least-once.
- No model tool can execute arbitrary SQL.
- GitHub writes are fenced to the role-owned branch. `main` is explicitly rejected.
- Supervisor authority RPCs require the separately provisioned `AOP_SUPERVISOR_TOKEN` secret.
- No checkpoint-seal or main-merge tool exists in AOP1 v1.

## Required secrets

Configure through Wrangler or an equivalent secret manager:

- `SUPABASE_SERVICE_ROLE_KEY`
- `AOP_WAKE_SECRET`
- `AOP_SUPERVISOR_TOKEN`
- `GITHUB_TOKEN`
- `GITHUB_WEBHOOK_SECRET`
- `CF_ACCOUNT_ID`
- `CF_AI_TOKEN`

Optional: `AOP_AI_GATEWAY_ID`.

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

## Provisioning boundary

The repository intentionally contains no secrets and no claim that the Cloudflare runtime is already deployed. Deployment becomes LIVE only after bindings, Queue/DLQ, Workflow, Durable Object and all required secrets are provisioned and `/health` plus an end-to-end run succeed.