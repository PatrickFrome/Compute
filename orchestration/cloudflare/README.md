# AOP1 Cloudflare runtime

This directory implements the runtime half of `NO_MANUAL_HANDOFF_V1`.

## Trust boundaries

- Supabase roadmap/claims/directives/checkpoints remain authoritative.
- Cloudflare Durable Object state is an idempotency/serialization cache only.
- Queue delivery is treated as at-least-once.
- No model tool can execute arbitrary SQL.
- GitHub mutations are fenced to the role-owned branch. `main` is explicitly rejected.
- Public-repository GitHub reads used by execution roles may run without a GitHub credential; unauthenticated GitHub REST limits therefore apply.
- GitHub mutations still require a dedicated write capability and fail closed when that capability is absent.
- Supervisor authority RPCs require the separately provisioned `AOP_SUPERVISOR_TOKEN` secret.
- No checkpoint-seal or main-merge tool exists in AOP1 v1.

## Runtime secrets

Configure through Wrangler or an equivalent secret manager:

- `SUPABASE_SERVICE_ROLE_KEY`
- `AOP_WAKE_SECRET`
- `AOP_SUPERVISOR_TOKEN`
- `CF_ACCOUNT_ID`
- `CF_AI_TOKEN`

Required only for direct GitHub mutations:

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
8. Infrastructure unavailability remains fail-closed; no synthetic completion is created.

## Staged mutation mode

An IMPLEMENTER is no longer prevented from reasoning merely because `GITHUB_TOKEN` is absent. In that state it receives read-only repository tools, performs the semantic work, and may return `WAITING_EVENT` with `wake_condition=GITHUB_WRITE_EXECUTOR_AVAILABLE` and a deterministic `output.mutation_plan`.

A mutation plan contains full UTF-8 file contents plus commit messages and verification instructions. It is evidence of intended work only: it does **not** mean the files were written or the tests passed. The direct `github_write_file` tool is not exposed unless a dedicated GitHub credential exists, and the mutation API itself still rejects unauthenticated writes. This keeps planning and mutation authority separate while avoiding wasted implementer leases during credential outages.

## Live evidence boundary

The Cloudflare orchestration runtime is LIVE as of 2026-08-21. A GitHub OIDC -> Supabase Vault one-time bootstrap was consumed by the deployment workflow, and real `cf-workflow:*` leases are recorded in the authoritative AOP event ledger. W1, F1 and R1 legacy chat-holder claims were automatically rebound to `aop1:*` holders. T0 was independently audited and returned to `aop1:T0_IMPLEMENTER` for reproducible migration lineage and CI remediation.

This does **not** make any roadmap milestone VERIFIED. Semantic authority remains in Supabase and the semantic head remains independently governed. Direct GitHub mutation still requires a dedicated runtime credential; staged mutation plans allow implementation work to progress without falsely claiming that repository writes occurred.
