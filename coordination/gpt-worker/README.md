# GPT Coordination Worker — H205F22

Durable, PREPARED-only ChatGPT-side coordination worker for PAP.

## What it does

- A single named Cloudflare Durable Object (`h205f22-chatgpt`) persists the peer sequence cursor, guard counters, last success/error, and next alarm.
- A 5-minute Cron trigger bootstraps the object; the object then schedules its own alarm at `POLL_INTERVAL_SECONDS` (default 60s).
- Reads GLM envelopes from live PAP using `PAP_CHATGPT_TOKEN`.
- Messages with `requires_response=false` are ACKed without spending an OpenAI call.
- Messages requiring a response are sent to the OpenAI Responses API with a strict JSON Schema.
- Deterministic guards enforce authority-plane separation, witness-identity derivation, evidence honesty, response-contract transitions, and secret scanning.
- One guarded regeneration is allowed. If both candidates fail, toxic output is discarded and a safe `REVIEW` guard receipt is published; the original PAP pending item stays unresolved for peer/supervisor attention.

## Non-authority contract

This worker is not a Supervisor and has no project authority. Every outgoing envelope is hard-coded to:

- `evidence_class=PREPARED`
- `canonical=false`
- `authority_effect=false`

It has no DB service-role credential and intentionally does not infer project claim liveness. Project claim authority, AOP execution leases, and PAP transport identity remain separate planes.

## Required secrets

Set in Cloudflare, never in source/config:

- `OPENAI_API_KEY`
- `PAP_CHATGPT_TOKEN`
- `WORKER_CONTROL_TOKEN` (protects manual `/wake` and `/schedule`)

## Endpoints

- `GET /health` — non-secret durable state summary.
- `POST /wake` — run one cycle; requires `Authorization: Bearer $WORKER_CONTROL_TOKEN`.
- `POST /schedule` — ensure alarm exists; same authorization.

Cron and Durable Object alarms operate without these HTTP control endpoints.

## Local deterministic tests

```bash
node --test test/guards.test.mjs
node --check src/guards.mjs
node --check src/index.mjs
```

## Deploy

Use Wrangler 4.125.0 or newer compatible v4 and the committed `wrangler.jsonc`.

```bash
npx --yes wrangler@4.125.0 deploy --config wrangler.jsonc
printf '%s' "$OPENAI_API_KEY" | npx --yes wrangler@4.125.0 secret put OPENAI_API_KEY --config wrangler.jsonc
printf '%s' "$PAP_CHATGPT_TOKEN" | npx --yes wrangler@4.125.0 secret put PAP_CHATGPT_TOKEN --config wrangler.jsonc
printf '%s' "$WORKER_CONTROL_TOKEN" | npx --yes wrangler@4.125.0 secret put WORKER_CONTROL_TOKEN --config wrangler.jsonc
```

Do not call this deployment LIVE until the secret bindings and `/health`/PAP smoke checks have passed. A successful code deploy alone is `DEPLOYED`, not proof of autonomous processing.
