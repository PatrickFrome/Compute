# METAENGINE Multi-Model Gateway v1 (PREPARE_ONLY)

Canonical owner: **F1+ Live Multi-CAT Federation**  
Level-2 alignment: `F1_LIVE_EXTERNAL_FEDERATION`  
State: **PREPARE_ONLY / authority_effect=false**. This package is not live-runtime evidence and does not advance F1 to VERIFIED.

A small Vercel Serverless API that turns Vercel AI Gateway into an advisory peer fabric for METAENGINE/A2. The default route is deliberately zero-cost and uses only models whose **current live catalog** reports both input and output pricing as zero. Frontier models are blocked unless both the request sets `paid_ok=true` and the deployment explicitly sets `METAENGINE_ALLOW_PAID_MODELS=1`.

## Security invariants

- Peers have **no action authority**; they only return proposals/critique.
- Incoming model routes require `METAENGINE_MODEL_GATEWAY_TOKEN` and fail closed when absent.
- Upstream auth uses `AI_GATEWAY_API_KEY` if explicitly configured, otherwise Vercel's short-lived `VERCEL_OIDC_TOKEN`.
- Provider-specific API keys are not required by this package.
- User-selected model IDs are filtered through a hard allowlist or fixed logical aliases.
- Untrusted context is explicitly fenced in the peer prompt.
- No model tools are exposed by this gateway; OpenAI-compatible requests containing tools are rejected.
- Streaming is disabled in the sovereign compatibility façade to keep bounded receipts and failure semantics.
- Every custom peer result returns request/response SHA-256 receipts and `authority_effect=false`.
- Paid models require a two-key opt-in (deployment + request), preventing accidental credit spend.
- Before every zero-spend inference, `/v1/models` is revalidated through a short TTL cache; missing/repriced models fail closed before inference.

## Default free route

1. `minimax/minimax-m3-free`
2. `poolside/laguna-s-2.1-free`

The live Vercel model catalog must be re-checked before promotion because model IDs, pricing, and availability can change.

## Frontier profiles (disabled by default)

- architecture: Claude Sonnet 5 → Gemini 3.7 Flash → DeepSeek V4 Pro 0813 → GLM 5.3
- coding: DeepSeek V4 Pro 0813 → Claude Sonnet 5 → Gemini 3.7 Flash → Grok 4.6
- critic: Gemini 3.7 Flash → GLM 5.3 → DeepSeek V4 Pro 0813 → Claude Sonnet 5
- research: Grok 4.6 → Gemini 3.7 Flash → Claude Sonnet 5 → GLM 5.3

## SAME_POINT_DUEL_V4 / sovereign compatibility

The app exposes an authenticated OpenAI-compatible façade matching the existing sovereign runner contract:

- `GET /v1/models`
- `POST /v1/chat/completions`

Logical zero-spend model IDs:

- `metaengine/peer-a-free` → MiniMax M3 Free first, Laguna S 2.1 Free fallback.
- `metaengine/peer-b-free` → Laguna S 2.1 Free first, MiniMax M3 Free fallback.

The two aliases intentionally prefer different upstream providers so the two contender roles are not identical first-choice inference paths. The façade overwrites the logical model with the fixed upstream plan, prepends the non-authority security fence, rejects tools/streaming, bounds message/output sizes, and performs the live zero-price gate before forwarding.

After an authorized deployment, the current sovereign runner can point both inference URLs at the same gateway while keeping distinct logical models:

```text
SOVEREIGN_GPT_URL=https://<gateway-host>
SOVEREIGN_GLM_URL=https://<gateway-host>
SOVEREIGN_GPT_MODEL=metaengine/peer-a-free
SOVEREIGN_GLM_MODEL=metaengine/peer-b-free
SOVEREIGN_INFERENCE_TOKEN=<same value as METAENGINE_MODEL_GATEWAY_TOKEN>
```

This is compatibility plumbing only. It does not turn a Vercel-hosted model call into local/tariff-independent sovereign evidence, and it does not satisfy F1 live acceptance by itself.

## Deploy gate

A Vercel deployment is allowed only after:

1. the authorized workstream/supervisor opens the relevant mutation domain;
2. AI Gateway/OIDC is enabled for the target Vercel project;
3. `METAENGINE_MODEL_GATEWAY_TOKEN` is configured as a secret environment variable;
4. free-route smoke test succeeds;
5. paid routing remains disabled unless the supervisor explicitly authorizes spend;
6. a live receipt is persisted and independently read back before any F1 evidence claim.

## Custom peer API

`POST /api/peer`

```json
{
  "task_id": "semantic-point-123",
  "role": "critic",
  "prompt": "Review this architecture.",
  "context": "optional untrusted context",
  "paid_ok": false,
  "preferred_models": []
}
```

Authorization: `Bearer $METAENGINE_MODEL_GATEWAY_TOKEN`.

`GET /api/health` exposes configuration booleans but never secret values.
