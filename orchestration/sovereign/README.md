> **ChatGPT/OpenAI-only runtime policy (2026-10-04):** the active V4 executors are independent logical roles **PRIMARY** and **CRITIC**, both backed by hosted OpenAI models on separate API request contexts. Historical DB fields/actors named `gpt_*` / `glm_*` and votes `WIN_GPT` / `WIN_GLM` remain wire-compatibility identifiers only until the durable schema migration; they no longer imply a ZAI/GLM provider. Canonical runtime configuration is `SOVEREIGN_PRIMARY_*` / `SOVEREIGN_CRITIC_*`. The legacy V2 runner entry is retired.

# METAENGINE H205F22 Sovereign SAME_POINT_DUEL_V4 Runner

The active runner implements a two-wave, same-semantic-point adversarial development protocol using two independent OpenAI agents. Browser ChatGPT sessions and this API daemon use separate authentication; the runner requires an OpenAI API credential and incurs API usage charges.

## Core invariant

PRIMARY (Agent A) and CRITIC (Agent B) receive the same semantic point and run concurrently in each wave. The historical database actor labels `GPT` and `GLM` and votes `WIN_GPT`/`WIN_GLM` remain wire aliases for A/B so saved checkpoints, event hashes and deterministic arbitration stay readable:

`checkpoint N -> (Agent A PROPOSE || Agent B PROPOSE) -> atomic pair -> (Agent A REBUT || Agent B REBUT) -> atomic pair + deterministic arbitration -> ONE resulting_action`

Private chain-of-thought is never shared. Every engineering-relevant rationale intended for the peer is persisted as observable structured data: `claim`, `reasoning_summary`, `evidence_used`, `assumptions`, `peer_claims_addressed`, `counterexample`, `falsifier`, `tests_required`, and the proposed/resulting action.

The REBUT wave sees both persisted PROPOSE events. Each agent must address the exact peer PROPOSE event hash. A stale or wrong peer hash fails closed.

## Low-latency path

`PostgreSQL INSERT -> pg_notify(h205f22_same_point_v4_ready) -> persistent V4 runner -> Agent A || Agent B PROPOSE -> submit_pair_v3 -> Agent A || Agent B REBUT -> submit_rebut_finalize_v4 -> immutable decision`

The second REBUT pair and deterministic arbitration execute through one database RPC/transaction, removing a separate post-rebut orchestration round trip.

PostgreSQL remains the durable source of truth. `LISTEN/NOTIFY` is only the low-latency wake signal; periodic recovery leasing handles missed notifications after reconnects.

## Protocol isolation

V4 sessions are stamped with:

- `debate_protocol=SAME_POINT_DUEL_V4`
- `wave_plan=[PROPOSE,REBUT]`
- `reasoning_visibility=OBSERVABLE_ENGINEERING_REASONING_V1`
- `arbitration_policy=EVIDENCE_FIRST_ONE_ACTION_V1`
- `executor_class=SOVEREIGN_V4_PERSISTENT`
- `max_ticks=2`

Only workers with the `sovereign:v4:*` identity prefix may lease a V4 session. Legacy `sovereign:*` workers and `cf-workflow:*` workers are fenced from V4. The V4 runner is also fenced from legacy microstep sessions.

## Arbitration

The database emits exactly one immutable `resulting_action` and one `decision_sha256`.

Outcomes:

- `WIN_GPT`: both rebuttals select Agent A's final action.
- `WIN_GLM`: both rebuttals select Agent B's final action.
- `SYNTHESIS`: both rebuttals independently converge on the identical final action hash.
- `NO_ACTION`: both reject mutation.
- `CANARY_REQUIRED`: security veto, explicit canary request, or unresolved action disagreement.
- `BLOCKED_EXECUTOR`: either actor fails to produce a real valid model step.

On unresolved disagreement the database does not choose by rhetoric. It emits `RUN_CANARY` with the collected `tests_required` and both candidate action hashes.

The decision row is append-only/immutable, `canonical=false`, and `authority_effect=false`. A duel decision is therefore a proposed engineering action, not roadmap/mainline authority.

## Active inference policy

Both agents default to `gpt-6.1-sol`, independently configurable with `SOVEREIGN_PRIMARY_MODEL` and `SOVEREIGN_CRITIC_MODEL`. `ME2_OPENAI_MODEL` supplies a common configured default.

Requests go only to `https://api.openai.com/v1/chat/completions`; redirects are refused. `SOVEREIGN_OPENAI_API_KEY` or `OPENAI_API_KEY` is required. A ChatGPT browser login, old GLM token, or legacy inference server token does not satisfy this requirement.

Each call carries its own messages and `agent_id` metadata. No shared server-side conversation or response ID is used, and `store=false` is enforced. Calls retain the same durable lease, generation and peer hash fencing as before.

Old `SOVEREIGN_GPT_URL`, `SOVEREIGN_GLM_URL`, `SOVEREIGN_GLM_MODEL` and GLM token settings do not select active inference. Saved `gpt_model`/`glm_model` fields remain readable: hosted OpenAI model names may be honored; old GLM and local GPT-OSS model hints resolve to the actor's configured OpenAI model. New active non-OpenAI model selections fail closed.

The model's availability for a specific account is confirmed by `/readyz`, not by configuration alone. No paid inference call is made by the source tests.

Official request contracts: [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol). Chat Completions supports this structured public step without tool calling. The API budget uses `max_completion_tokens`, including reasoning tokens, and excludes unsupported sampling temperature for GPT-5/6 and o-series models.

## Sovereign HTTP gateway

`npm start` now starts both the V4 coordinator and the local endpoint gateway. The gateway binds to `127.0.0.1:8090` by default.

Operational endpoints:

- `GET /healthz` — process liveness.
- `GET /readyz` — fail-closed readiness: PostgreSQL + both exact model inventories must be reachable.
- `GET /status` — detailed DB and independent OpenAI Agent A/B readiness and latency.
- `GET /metrics` — Prometheus-style process counters.
- `GET /v1/models` — logical OpenAI Agent A/B model inventory.
- `GET /primary/v1/models` and `GET /critic/v1/models` — role-specific OpenAI model inventory. Provider-shaped `/gpt/*` and `/glm/*` routes return HTTP 410.
- `POST /primary/v1/chat/completions` and `POST /critic/v1/chat/completions` — streaming role proxies pinned to the configured OpenAI model. Legacy `/glm/*` and `/gpt/*` execution returns `410 legacy_provider_endpoint_retired`; it does not activate GLM.
- `POST /v4/duels` — create one `SAME_POINT_DUEL_V4` session.
- `GET /v4/duels/:duel_id` — full observable debate, hashes, ticks and decision.
- `GET /v4/duels/:duel_id/decision` — final immutable V4 decision only.
- `POST /v4/duels/:duel_id/wake` — re-signal an existing READY/RUNNING V4 session without mutating its checkpoint.

`/healthz` and `/readyz` are probe endpoints. All control/model-proxy endpoints require `Authorization: Bearer $SOVEREIGN_CONTROL_TOKEN` when a token is configured. A non-loopback bind is refused at startup unless `SOVEREIGN_CONTROL_TOKEN` is present.

Example:

```bash
export SOVEREIGN_CONTROL_TOKEN='replace-with-a-random-secret'
curl -fsS http://127.0.0.1:8090/readyz
curl -fsS -H "Authorization: Bearer $SOVEREIGN_CONTROL_TOKEN" http://127.0.0.1:8090/status
```

## Start the complete runtime

```bash
cd orchestration/sovereign
npm install
npm run check

export DATABASE_URL='postgresql://...'
export DUEL_RUNNER_ID='linux-worker-01'
export OPENAI_API_KEY='replace-with-an-openai-api-key'
export SOVEREIGN_PRIMARY_MODEL='gpt-6.1-sol'
export SOVEREIGN_CRITIC_MODEL='gpt-6.1-sol'
export SOVEREIGN_CONTROL_TOKEN='replace-with-a-random-secret'
npm start
```

Commands:

- `npm start` / `npm run start:all` — V4 coordinator + HTTP gateway under one process supervisor.
- `npm run start:v4` — coordinator only.
- `npm run start:control` — HTTP gateway only.
- `npm run start:legacy` — previous multi-tick runner only.

Optional variables:

- `SOVEREIGN_PRIMARY_MODEL` / `SOVEREIGN_CRITIC_MODEL`
- `ME2_OPENAI_MODEL`
- `SOVEREIGN_OPENAI_API_KEY` / `OPENAI_API_KEY`
- `SOVEREIGN_HTTP_HOST` / `SOVEREIGN_HTTP_PORT`
- `SOVEREIGN_CONTROL_TOKEN`
- `SOVEREIGN_UPSTREAM_TIMEOUT_MS`
- `SOVEREIGN_HTTP_MAX_BODY_BYTES`
- `DUEL_MODEL_TIMEOUT_MS`
- `DUEL_MAX_OUTPUT_TOKENS`
- `DUEL_RECOVERY_MS` (recovery only; not the normal hot path)

## Create one same-point duel through HTTP

```bash
curl -fsS \
  -H "Authorization: Bearer $SOVEREIGN_CONTROL_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "duel_key":"MY-SAME-POINT-DUEL",
    "milestone_key":"F1_LIVE_EXTERNAL_FEDERATION",
    "base_github_sha":"<40-char-git-sha>",
    "subject":{"semantic_point":"exact engineering decision to develop"},
    "execution_policy":"SOVEREIGN_ONLY"
  }' \
  http://127.0.0.1:8090/v4/duels
```

The equivalent SQL API remains:

```sql
select public.h205f22_duel_create_same_point_v4(
  'MY-SAME-POINT-DUEL',
  'F1_LIVE_EXTERNAL_FEDERATION',
  '<40-char-git-sha>',
  '{"semantic_point":"exact engineering decision to develop"}'::jsonb,
  'SOVEREIGN_ONLY',
  'gpt-6.1-sol',
  'gpt-6.1-sol'
);
```

## Cloudflare optional control endpoint

Cloudflare remains outside the V4 execution path. It exposes authenticated, optional control-only routes:

- `GET /v4/health`
- `POST /v4/duels`
- `GET /v4/duels/:duel_id`
- `GET /v4/duels/:duel_id/decision`

These use the existing AOP bearer secret. Cloudflare has only V4 create/read RPCs in its allowlist; V4 lease, submit and finalize RPCs are deliberately absent, so it cannot become an accidental executor.

## Read the complete observable debate

```sql
select public.h205f22_duel_read_same_point_v4('<duel-id>'::uuid);
```

The readback contains the persisted low-level event/tick ledger and the immutable V4 decision. This exposes all structured public engineering reasoning and event hashes, but never hidden model chain-of-thought.

## Historical protocol compatibility

`SOVEREIGN_ONLY` and `SOVEREIGN_V4_PERSISTENT` remain historical database worker/lease protocol labels. They no longer claim a self-hosted or tariff-independent inference backend. New executor evidence records `provider=OPENAI`, `platform=OPENAI_API`, independent `agent_id`, the actual model and `tariff_dependency=true`.

Historical migrations and immutable evidence are not rewritten by this source slice. Older records with `tariff_dependency=false` describe their original executor and must not be interpreted as current OpenAI runtime evidence. Database deployment and live qualification remain separate gates.
