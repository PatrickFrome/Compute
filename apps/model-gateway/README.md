# METAENGINE Multi-Model Gateway v1 (PREPARE_ONLY)

Canonical owner: **F1+ Live Multi-CAT Federation**  
Level-2 alignment: `F1_LIVE_EXTERNAL_FEDERATION`  
State: **PREPARE_ONLY / authority_effect=false**. This package is not live-runtime evidence and does not advance F1 to VERIFIED.

A small Vercel Serverless API that turns Vercel AI Gateway into an advisory peer fabric for METAENGINE/A2. The default route is deliberately zero-cost and uses only current AI Gateway models with `pricing.input=0` and `pricing.output=0`. Frontier models are blocked unless both the request sets `paid_ok=true` and the deployment explicitly sets `METAENGINE_ALLOW_PAID_MODELS=1`.

## Security invariants

- Peers have **no action authority**; they only return proposals/critique.
- Incoming `/api/peer` requires `METAENGINE_MODEL_GATEWAY_TOKEN` and fails closed when absent.
- Upstream auth uses `AI_GATEWAY_API_KEY` if explicitly configured, otherwise Vercel's short-lived `VERCEL_OIDC_TOKEN`.
- Provider-specific API keys are not required by this package.
- User-selected model IDs are filtered through a hard allowlist.
- Untrusted context is explicitly fenced in the peer prompt.
- No model tools are exposed by this gateway.
- Every result returns request/response SHA-256 receipts and `authority_effect=false`.
- Paid models require a two-key opt-in (deployment + request), preventing accidental credit spend.

## Default free route

1. `minimax/minimax-m3-free`
2. `poolside/laguna-s-2.1-free`

The live Vercel model catalog must be re-checked before promotion because model IDs, pricing, and availability can change.

## Frontier profiles (disabled by default)

- architecture: Claude Sonnet 5 → Gemini 3.7 Flash → DeepSeek V4 Pro 0813 → GLM 5.3
- coding: DeepSeek V4 Pro 0813 → Claude Sonnet 5 → Gemini 3.7 Flash → Grok 4.6
- critic: Gemini 3.7 Flash → GLM 5.3 → DeepSeek V4 Pro 0813 → Claude Sonnet 5
- research: Grok 4.6 → Gemini 3.7 Flash → Claude Sonnet 5 → GLM 5.3

## Deploy gate

A Vercel deployment is allowed only after:

1. AI Gateway/OIDC is enabled for the target Vercel project.
2. `METAENGINE_MODEL_GATEWAY_TOKEN` is configured as a secret environment variable.
3. Free-route smoke test succeeds.
4. Paid routing remains disabled unless the supervisor explicitly authorizes spend.
5. A live receipt is persisted and independently read back before any F1 evidence claim.

## API

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
