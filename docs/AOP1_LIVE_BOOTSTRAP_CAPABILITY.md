# AOP1 live bootstrap capability

Status: `BOOTSTRAP_CAPABILITY_REQUIRED / NO_RUNTIME_HANDOFF_REQUIRED_AFTER_BOOTSTRAP`

This document defines the only external bootstrap boundary that remains before AOP1 can become a live autonomous orchestration runtime.

## Why this boundary exists

Cloudflare cannot accept an unauthenticated deployment or mint authority for itself. A user- or organization-authorized Cloudflare capability must exist before any machine can create Workers/Queues or upload Worker secrets. This is an authority bootstrap, not a development handoff.

Once the repository secrets below exist, `.github/workflows/aop1-live-deploy.yml` handles provisioning, deploy, health verification and the first autonomous wake on subsequent pushes to `work/aop1-autonomous-orchestration`.

## Required repository secrets

| Secret | Purpose | Runtime exposure |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Deploy Worker and provision Cloudflare resources | GitHub deployment job only |
| `CLOUDFLARE_ACCOUNT_ID` | Select Cloudflare account; also bound as `CF_ACCOUNT_ID` | Deployment job + Worker |
| `AOP1_SUPABASE_SERVICE_ROLE_KEY` | Call the allowlisted AOP Supabase RPCs | Worker only |
| `AOP1_SUPERVISOR_TOKEN` | Existing H205F22 supervisor capability for explicit rebind/return bridge | Worker only |
| `AOP1_GITHUB_TOKEN` | Read PR/workflow state and write only role-owned branches | Worker only |
| `AOP1_CF_AI_TOKEN` | Call Cloudflare AI Gateway / Responses | Worker only |
| `AOP1_WAKE_SECRET` | Authenticate explicit `/wake` and `/signal` requests | Worker + deploy canary |

Optional later:

- `AOP1_GITHUB_WEBHOOK_SECRET` if GitHub webhook delivery is enabled. Periodic reconciliation does not require it.
- An AI Gateway identifier if a dedicated gateway is configured.

## Least-privilege requirements

- Cloudflare deploy token: only the account/resources needed by this Worker, Queues, Workflows and Durable Objects.
- AOP GitHub token: repository contents read/write, pull-request read, Actions read; no organization administration and no unrelated repositories.
- Supervisor token is never printed, returned by an RPC, put in Git, or passed to model text. It is consumed only by deterministic authority bridge functions/tools.
- No Colab/GCP credential receives supervisor authority.

## Automatic sequence after capability appears

1. Validate that all mandatory secret values are non-empty.
2. Install the pinned Wrangler toolchain.
3. Create the wake Queue and DLQ if absent.
4. Deploy the Worker and bind secrets.
5. Resolve the deployment URL.
6. Poll `/health` until it proves:
   - AOP snapshot is readable;
   - AI executor configured;
   - GitHub executor configured;
   - supervisor capability configured;
   - invariant is `NO_MANUAL_HANDOFF_V1`.
7. POST an authenticated `LIVE_DEPLOY_ACTIVATION` wake.
8. Queue -> Durable Object -> Workflow begins leasing AOP runs.
9. Legacy W1/F1/R1 holders are rebound only through supervisor-gated RPCs.
10. T0 is independently audited by `INTEGRATION_ANALYST` before Supervisor can progress toward seal.

## Fail-closed behavior

If any required capability is missing, the deploy workflow reports `NOT_LIVE_DEPLOYED` and performs no partial deployment. If `/health` fails, activation wake is not sent. If executor credentials disappear later, runs move to `WAITING_EVENT/EXECUTOR_AVAILABLE` instead of fabricating completion.

## Nonclaims

Configuring these secrets does not verify any roadmap milestone. A successful Worker deployment does not verify W1/T0/F1/R1 and does not seal a semantic checkpoint. Mainline merge and checkpoint seal remain outside AOP1 v1 executor tools.
