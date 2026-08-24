# METAENGINE H205F22 Sovereign SAME_POINT_DUEL_V4 Runner

The default sovereign runner implements a two-wave, same-semantic-point adversarial development protocol without managed inference billing gates.

## Core invariant

GPT and GLM do not develop separate branches or take sequential turns. They receive the same semantic point and run concurrently in each wave:

`checkpoint N -> (GPT PROPOSE || GLM PROPOSE) -> atomic pair -> (GPT REBUT || GLM REBUT) -> atomic pair + deterministic arbitration -> ONE resulting_action`

Private chain-of-thought is never shared. Every engineering-relevant rationale intended for the peer is persisted as observable structured data: `claim`, `reasoning_summary`, `evidence_used`, `assumptions`, `peer_claims_addressed`, `counterexample`, `falsifier`, `tests_required`, and the proposed/resulting action.

The REBUT wave sees both persisted PROPOSE events. GPT must address the exact GLM PROPOSE event hash and GLM must address the exact GPT PROPOSE event hash. A stale or wrong peer hash fails closed.

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

- `WIN_GPT`: both rebuttals select GPT's final action.
- `WIN_GLM`: both rebuttals select GLM's final action.
- `SYNTHESIS`: both rebuttals independently converge on the identical final action hash.
- `NO_ACTION`: both reject mutation.
- `CANARY_REQUIRED`: security veto, explicit canary request, or unresolved action disagreement.
- `BLOCKED_EXECUTOR`: either actor fails to produce a real valid model step.

On unresolved disagreement the database does not choose by rhetoric. It emits `RUN_CANARY` with the collected `tests_required` and both candidate action hashes.

The decision row is append-only/immutable, `canonical=false`, and `authority_effect=false`. A duel decision is therefore a proposed engineering action, not roadmap/mainline authority.

## Default model pair

- GPT side: `openai/gpt-oss-20b`
- GLM side: `zai-org/GLM-4.7-Flash`

For physical concurrency, two independent devices/workers are preferred. Logical `Promise.all` on one saturated GPU is not equivalent to independent physical inference.

## Inference servers

The V4 runner expects OpenAI-compatible `/v1/chat/completions` endpoints and defaults to:

- GPT: `http://127.0.0.1:8001`
- GLM: `http://127.0.0.1:8002`

Example:

```bash
vllm serve openai/gpt-oss-20b \
  --served-model-name openai/gpt-oss-20b \
  --host 127.0.0.1 --port 8001

vllm serve zai-org/GLM-4.7-Flash \
  --served-model-name zai-org/GLM-4.7-Flash \
  --host 127.0.0.1 --port 8002
```

Keep model servers on loopback/private LAN. Do not expose raw inference endpoints directly to the public Internet.

## Start the V4 runner

```bash
cd orchestration/sovereign
npm install
npm run check

export DATABASE_URL='postgresql://...'
export DUEL_RUNNER_ID='linux-worker-01'
export SOVEREIGN_GPT_URL='http://127.0.0.1:8001'
export SOVEREIGN_GLM_URL='http://127.0.0.1:8002'
npm start
```

`npm start` and `npm run start:v4` run `same_point_v4.ts`. The previous multi-tick runner remains available only as `npm run start:legacy`.

Optional variables:

- `SOVEREIGN_GPT_MODEL`
- `SOVEREIGN_GLM_MODEL`
- `SOVEREIGN_INFERENCE_TOKEN`, or per-model `SOVEREIGN_GPT_TOKEN` / `SOVEREIGN_GLM_TOKEN`
- `DUEL_MODEL_TIMEOUT_MS`
- `DUEL_MAX_OUTPUT_TOKENS`
- `DUEL_RECOVERY_MS` (recovery only; not the normal hot path)

## Create one same-point duel

```sql
select public.h205f22_duel_create_same_point_v4(
  'MY-SAME-POINT-DUEL',
  'F1_LIVE_EXTERNAL_FEDERATION',
  '<40-char-git-sha>',
  '{"semantic_point":"exact engineering decision to develop"}'::jsonb,
  'SOVEREIGN_ONLY',
  'openai/gpt-oss-20b',
  'zai-org/GLM-4.7-Flash'
);
```

The runner wakes from PostgreSQL, executes both simultaneous waves, and terminates the session with exactly one decision object.

## Read the complete observable debate

```sql
select public.h205f22_duel_read_same_point_v4('<duel-id>'::uuid);
```

The readback contains the persisted low-level event/tick ledger and the immutable V4 decision. This exposes all structured public engineering reasoning and event hashes, but never hidden model chain-of-thought.

## Tariff independence

`SOVEREIGN_ONLY` V4 sessions never use Cloudflare/Vercel managed inference. Cloudflare/Vercel/OpenAI/Z.ai hosted APIs may later be implemented as optional native V4 accelerators, but a legacy hosted executor is explicitly fenced today.

This removes managed inference tariff gates. It does not remove the physical cost of GPU/CPU, RAM, storage, electricity, or network capacity.
