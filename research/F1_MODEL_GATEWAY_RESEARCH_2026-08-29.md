# F1+ Multi-Model Gateway research — 2026-08-29

Status: PREPARE_ONLY / authority_effect=false

## Question

Can METAENGINE/A2 obtain a broad advisory model fabric without provisioning and rotating a separate API credential for every model provider, while keeping accidental spend and model authority constrained?

## Current findings

Vercel AI Gateway exposes a unified OpenResponses-compatible endpoint and a live model catalog. On Vercel deployments, AI Gateway supports Vercel OIDC (`VERCEL_OIDC_TOKEN`) so provider-specific credentials are not required for the system-routed path.

Live catalog observations on 2026-08-29:

- `minimax/minimax-m3-free`: input=0, output=0; reasoning/tool-use/vision; 1,048,576 context on the free route.
- `poolside/laguna-s-2.1-free`: input=0, output=0; reasoning/tool-use; 256k context.
- `google/gemini-3.7-flash`: reasoning/tool-use/vision/file/video; 1M context; paid on Vercel Gateway.
- `anthropic/claude-sonnet-5`: reasoning/tool-use/vision/file/web-search; 1M context; paid on Vercel Gateway.
- `deepseek/deepseek-v4-pro-0813`: reasoning/tool-use; 1M context; paid on Vercel Gateway.
- `zai/glm-5.3`: reasoning/tool-use; paid on Vercel Gateway.
- `spacexai/grok-4.6`: reasoning/tool-use/vision/file/web-search; paid on Vercel Gateway.

Sources:

- https://ai-gateway.vercel.sh/v1/models (authoritative live catalog; re-check before deployment/promotion)
- https://vercel.com/docs/ai-gateway
- https://vercel.com/docs/ai-gateway/authentication-and-byok/oidc

## Architecture choice

Use the Gateway as an **advisory peer plane**, not an execution plane.

1. Default to only explicit zero-price model IDs.
2. Require two independent opt-ins before a request may use paid models:
   - deployment: `METAENGINE_ALLOW_PAID_MODELS=1`
   - request: `paid_ok=true`
3. Keep a hard model allowlist. A caller cannot inject an arbitrary provider/model string.
4. Send no tools to peer models.
5. Prepend a trusted instruction that external content is untrusted and that the peer has no execution authority.
6. Bind each request to a stable task ID and return request/response SHA-256 receipts.
7. Treat model availability/pricing as runtime facts: re-check the live catalog before any deployment promotion.

## Why not use Gemini Pro subscription as the API plane?

Google AI/Gemini consumer subscriptions and API billing/credentials are separate control planes. The gateway design therefore does not claim to consume the user's Gemini Pro quota. Gemini Pro UI can remain a Browser Operator peer transport later; the API plane is independent.

## Rejected shortcuts

- Public unauthenticated model endpoint: rejected; would permit third parties to consume quota/credits.
- Shipping provider API keys to browser code: rejected; secret exposure.
- Allowing caller-selected arbitrary model IDs: rejected; cost/policy bypass.
- Enabling frontier profiles by default: rejected; accidental spend.
- Counting successful unit tests as F1 live evidence: rejected; synthetic/control-plane proof is not live provider evidence.

## Next live gates

1. Supervisor opens `F1_LIVE_EXTERNAL_FEDERATION` or explicitly authorizes this accelerator under another mutation domain.
2. Deploy `apps/model-gateway` to an isolated Vercel project with AI Gateway/OIDC enabled.
3. Configure inbound broker authentication.
4. Run a zero-spend live request and persist/read back its receipt.
5. Independently verify the upstream model/routing receipt and only then prepare `EVIDENCE_READY`.

No item above is claimed complete by this research note.
