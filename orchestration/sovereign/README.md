# METAENGINE H205F22 Sovereign Duel Runner

This runner removes managed inference billing plans from the duel critical path.

## Execution path

`PostgreSQL INSERT -> pg_notify(h205f22_duel_ready_v1) -> persistent Linux runner -> GPT + GLM concurrently -> h205f22_duel_submit_pair_v3 -> next checkpoint`

The PostgreSQL row is the durable source of truth. `LISTEN/NOTIFY` is only the low-latency wake signal. A periodic recovery scan handles missed notifications after reconnects.

`SOVEREIGN_ONLY` sessions are fenced from `cf-workflow:*` leases and do not enqueue the Cloudflare `pg_net` wake. Vercel, Cloudflare AI Gateway, OpenAI API, and Z.ai API are therefore not required to execute these sessions.

## Default model pair

- GPT side: `openai/gpt-oss-20b`. OpenAI publishes the weights under Apache 2.0. The model is intended for local/self-managed inference and is designed to fit in roughly 16 GB of memory.
- GLM side: `zai-org/GLM-4.7-Flash`. Z.ai publishes the model under the MIT license and documents local vLLM/SGLang serving. A Q4 GGUF build is roughly 17 GB if lower-memory llama.cpp deployment is preferred.

For real simultaneous inference, two independent devices/workers are preferred (for example 2 x 24 GB GPUs). A single larger device or CPU/GPU offload also works but reduces concurrency.

## Inference servers

The runner expects OpenAI-compatible `/v1/chat/completions` endpoints and defaults to:

- GPT: `http://127.0.0.1:8001`
- GLM: `http://127.0.0.1:8002`

Example GPT server with vLLM:

```bash
vllm serve openai/gpt-oss-20b \
  --served-model-name openai/gpt-oss-20b \
  --host 127.0.0.1 --port 8001
```

Example GLM server with vLLM:

```bash
vllm serve zai-org/GLM-4.7-Flash \
  --served-model-name zai-org/GLM-4.7-Flash \
  --host 127.0.0.1 --port 8002
```

A lower-memory GLM option can be served with llama.cpp from a compatible GGUF quantization. Keep model servers on loopback/private LAN. Do not expose raw vLLM to the public Internet: vLLM documents that its built-in API key does not protect every inference-capable endpoint, so public deployment requires an authenticated reverse proxy.

## Runner

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

Optional variables:

- `SOVEREIGN_GPT_MODEL`
- `SOVEREIGN_GLM_MODEL`
- `SOVEREIGN_INFERENCE_TOKEN`, or per-model `SOVEREIGN_GPT_TOKEN` / `SOVEREIGN_GLM_TOKEN`
- `DUEL_MODEL_TIMEOUT_MS`
- `DUEL_MAX_OUTPUT_TOKENS`
- `DUEL_RECOVERY_MS` (recovery only; not the hot path)

## Create a tariff-independent duel

Use:

```sql
select public.h205f22_duel_create_sovereign_v1(
  'MY-SOVEREIGN-DUEL',
  'F1_LIVE_EXTERNAL_FEDERATION',
  '<40-char-git-sha>',
  '{"purpose":"example"}'::jsonb,
  'openai/gpt-oss-20b',
  'zai-org/GLM-4.7-Flash',
  64
);
```

The wrapper stamps `execution_policy=SOVEREIGN_ONLY`, `tariff_dependency=false`, and `inference_class=OPEN_WEIGHT_SELF_HOSTED` into the immutable duel subject.

## Hosted accelerators

Cloudflare/Vercel rails remain useful for optional acceleration or independent shadow verification on `ANY` sessions. They are not fallback requirements for `SOVEREIGN_ONLY`. If every hosted account is suspended, unfunded, rate-limited, or deleted, the sovereign runner still executes as long as the local PostgreSQL and model workers are available.

This removes provider tariff gates; it does not remove the physical cost of hardware, electricity, storage, or bandwidth.
