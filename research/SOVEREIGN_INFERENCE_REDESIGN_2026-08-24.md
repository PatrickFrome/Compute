# METAENGINE H205F22 — Sovereign Inference Redesign

Date: 2026-08-24

## Decision

Managed inference APIs are accelerators, never availability dependencies. The tariff-independent core is:

`PostgreSQL durable row -> LISTEN/NOTIFY -> persistent Linux runner -> two local OpenAI-compatible model servers -> atomic pair commit -> checkpoint chain`.

`SOVEREIGN_ONLY` sessions never enqueue the Cloudflare pg_net wake and Cloudflare worker identities are fenced from their leases.

## Default debate pair

### GPT side

`openai/gpt-oss-20b`

Research basis:
- OpenAI publishes gpt-oss-20b as open weights under Apache 2.0.
- OpenAI states gpt-oss models can run on infrastructure controlled by the operator and are not served through the OpenAI API, so OpenAI API pricing/rate limits do not apply.
- OpenAI states gpt-oss-20b can run with about 16 GB of memory.

Sources:
- https://openai.com/index/introducing-gpt-oss/
- https://help.openai.com/en/articles/11870455-openai-open-weight-models
- https://developers.openai.com/api/docs/models/gpt-oss-20b

### GLM side

`zai-org/GLM-4.7-Flash`

Research basis:
- Z.ai publishes GLM-4.7-Flash under the MIT license.
- The model is approximately 30B-class MoE and supports local OpenAI-compatible vLLM serving.
- Lower-memory GGUF quantizations are available; a Q4-class build is about 17 GB.

Sources:
- https://huggingface.co/zai-org/GLM-4.7-Flash
- https://huggingface.co/unsloth/GLM-4.7-Flash-GGUF

## Why not a free managed API

A managed "free" endpoint still has one or more of: request quota, daily quota, plan gate, payment verification, provider availability, account suspension, rate limit, or model allowlist. It therefore cannot satisfy the invariant `tariff_dependency=false`.

## PostgreSQL wake design

`NOTIFY` is a low-latency hint, not the durable queue. The READY duel row is durable. PostgreSQL documents that notifications generated inside a transaction are delivered only after commit. It also recommends inspecting database state after establishing LISTEN to cover the initial race. The runner follows this pattern by combining LISTEN with recovery reconciliation.

Sources:
- https://www.postgresql.org/docs/current/sql-listen.html
- https://www.postgresql.org/docs/current/sql-notify.html

## Serving security

Local model servers should bind to loopback/private LAN. vLLM documents that `--api-key` does not authenticate every inference-capable endpoint, so a raw vLLM server must not be treated as a safe public perimeter. If remote access is required, use a private network or authenticated reverse proxy/mTLS boundary.

Source:
- https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/

## Concurrency

For true simultaneous debate, run GPT and GLM on independent devices/workers when possible. A practical tariff-independent baseline is two 24 GB-class GPUs: one for gpt-oss-20b and one for a quantized GLM-4.7-Flash. A single larger GPU or CPU/GPU offload remains functional but reduces concurrency and latency quality.

## Escalation policy

Hosted GPT-5.6 Sol / GLM-5.x may be used only on `ANY` sessions or as explicit shadow/adjudication rails. No sovereign session may become BLOCKED merely because a hosted account has no balance, card, paid plan, model entitlement, or rate-limit capacity.

## Truth boundary

This redesign removes managed inference tariff gates. It does not make physical compute free: hardware, power, storage, network transit, and operator maintenance still have real costs.

The current live database is Supabase-hosted. The persistent runner uses a standard PostgreSQL `DATABASE_URL`, so the execution process itself is portable to self-hosted PostgreSQL. Full removal of every hosted control-plane dependency requires replaying the Compute Fabric schema/data onto operator-controlled PostgreSQL; that migration is separate from the inference redesign and must not be claimed complete until restore/readback evidence exists.
