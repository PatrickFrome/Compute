# METAENGINE H205F22 Sovereign SAME_POINT_DUEL_V4 Runner

The default sovereign runtime implements a two-wave, same-semantic-point adversarial development protocol without managed inference billing gates.

## Core invariant

Actor A and Actor B are independent ChatGPT/OpenAI agents; they do not develop separate branches or take sequential turns. They receive the same semantic point and run concurrently in each wave:

`checkpoint N -> (ACTOR_A PROPOSE || ACTOR_B PROPOSE) -> atomic pair -> (ACTOR_A REBUT || ACTOR_B REBUT) -> atomic pair + deterministic arbitration -> ONE resulting_action`

Private chain-of-thought is never shared. Every engineering-relevant rationale intended for the peer is persisted as observable structured data: `claim`, `reasoning_summary`, `evidence_used`, `assumptions`, `peer_claims_addressed`, `counterexample`, `falsifier`, `tests_required`, and the proposed/resulting action.

The REBUT wave sees both persisted PROPOSE events. ACTOR_A must address ACTOR_B's exact PROPOSE event hash and ACTOR_B must address ACTOR_A's. A stale or wrong peer hash fails closed.

## Low-latency path

`PostgreSQL INSERT -> pg_notify(h205f22_same_point_v4_ready) -> persistent V4 runner -> GPT || GLM PROPOSE -> submit_pair_v3 -> GPT || GLM REBUT -> submit_rebut_finalize_v4 -> immutable decision`

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

- `WIN_GPT`: historical V4 DB vote meaning ACTOR_A wins; `GPT` is a compatibility slot, not provider identity.
- `WIN_GLM`: historical V4 DB vote meaning ACTOR_B wins; `GLM` is a compatibility slot, not provider identity.
- `SYNTHESIS`: both rebuttals independently converge on the identical final action hash.
- `NO_ACTION`: both reject mutation.
- `CANARY_REQUIRED`: security veto, explicit canary request, or unresolved action disagreement.
- `BLOCKED_EXECUTOR`: either actor fails to produce a real valid model step.

On unresolved disagreement the database does not choose by rhetoric. It emits `RUN_CANARY` with the collected `tests_required` and both candidate action hashes.

The decision row is append-only/immutable, `canonical=false`, and `authority_effect=false`. A duel decision is therefore a proposed engineering action, not roadmap/mainline authority.

## Active model pair

- ACTOR_A: OpenAI/ChatGPT, default `openai/gpt-oss-20b`.
- ACTOR_B: OpenAI/ChatGPT, default `openai/gpt-oss-20b`.

The two actors must have independent session/context identities even when they use the same model SKU. Active GLM/Z.ai inference is disabled.

For physical concurrency, two independent devices/workers are preferred. Logical `Promise.all` on one saturated GPU is not equivalent to independent physical inference.

## Inference servers

The V4 runner expects OpenAI-compatible endpoints and defaults to:

- ACTOR_A: `http://127.0.0.1:8001`
- ACTOR_B: `http://127.0.0.1:8002`

Each model server must implement `GET /v1/models` and `POST /v1/chat/completions`.

Example:

```bash
vllm serve openai/gpt-oss-20b \
  --served-model-name openai/gpt-oss-20b \
  --host 127.0.0.1 --port 8001

vllm serve openai/gpt-oss-20b \
  --served-model-name openai/gpt-oss-20b \
  --host 127.0.0.1 --port 8002
```

Keep model servers on loopback/private LAN. **Do not expose raw vLLM to the public Internet.** If a model lives on another machine or Colab runtime, put an authenticated private tunnel/reverse proxy in front of it and set `SOVEREIGN_ACTOR_A_URL` or `SOVEREIGN_ACTOR_B_URL` to that private endpoint.

## Sovereign HTTP gateway

`npm start` now starts both the V4 coordinator and the local endpoint gateway. The gateway binds to `127.0.0.1:8090` by default.

Operational endpoints:

- `GET /healthz` — process liveness.
- `GET /readyz` — fail-closed readiness: PostgreSQL + both exact model inventories must be reachable.
- `GET /status` — detailed DB/ACTOR_A/ACTOR_B readiness and latency.
- `GET /metrics` — Prometheus-style process counters.
- `GET /v1/models` — logical ACTOR_A/ACTOR_B OpenAI model inventory.
- `GET /actor-a/v1/models` and `GET /actor-b/v1/models` — actor-specific upstream OpenAI model inventory.
- `POST /actor-a/v1/chat/completions` and `POST /actor-b/v1/chat/completions` — streaming actor proxies. The gateway overwrites the client-supplied `model` with the configured exact OpenAI identity.
- Legacy `/gpt/*` and `/glm/*` inference routes return HTTP 410 and never proxy inference.
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
export SOVEREIGN_ACTOR_A_URL='http://127.0.0.1:8001'
export SOVEREIGN_ACTOR_B_URL='http://127.0.0.1:8002'
export SOVEREIGN_CONTROL_TOKEN='replace-with-a-random-secret'
npm start
```

Commands:

- `npm start` / `npm run start:all` — V4 coordinator + HTTP gateway under one process supervisor.
- `npm run start:v4` — coordinator only.
- `npm run start:control` — HTTP gateway only.
- `npm run start:legacy` — previous multi-tick runner only.

Optional variables:

- `SOVEREIGN_OPENAI_MODEL`, or per-actor `SOVEREIGN_ACTOR_A_MODEL` / `SOVEREIGN_ACTOR_B_MODEL`
- `SOVEREIGN_INFERENCE_TOKEN`, or per-actor `SOVEREIGN_ACTOR_A_TOKEN` / `SOVEREIGN_ACTOR_B_TOKEN`
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
  'openai/gpt-oss-20b',
  'openai/gpt-oss-20b'
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

## Tariff independence

`SOVEREIGN_ONLY` V4 sessions never use Cloudflare/Vercel managed inference. Cloudflare/Vercel/OpenAI hosted APIs may be optional accelerators or control surfaces, but the local V4 executor is independent of them.

This removes managed inference tariff gates. It does not remove the physical cost of GPU/CPU, RAM, storage, electricity, or network capacity.


## Legacy DB-slot compatibility

The immutable V4 schema predates the ChatGPT-only migration and stores the two pair positions as `GPT` and `GLM`. These labels are now **storage coordinates only**:

- legacy DB slot `GPT` = active `ACTOR_A`;
- legacy DB slot `GLM` = active `ACTOR_B`;
- both active actors are `provider=OPENAI`, `platform=CHATGPT`;
- a recovered historical row whose model is a GLM/Z.ai model fails closed before inference;
- new interactive relays use `h205f22_duel_create_chatgpt_relay_v1` and `h205f22_duel_submit_chatgpt_peer_v1` with truthful `chatgpt:actor-a:*` / `chatgpt:actor-b:*` peer IDs.

Historical migrations/evidence are preserved and remain readable. They do not grant active GLM routing authority.
