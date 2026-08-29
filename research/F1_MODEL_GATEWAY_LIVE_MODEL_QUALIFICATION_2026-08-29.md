# F1 Model Gateway — Live Model Qualification Attempt (2026-08-29)

Status: **PREPARE_ONLY / authority_effect=false**. This is a qualification receipt, not F1 live evidence, not a VERIFIED checkpoint, and not permission to spend or deploy.

## Goal

Exercise the broadest zero-spend model set reachable through the already-authorized A2 GitHub OIDC → Vercel AI Gateway acceptance rail, distinguish provider/account failures from model-quality failures, and reduce the default route to a small provider-diverse shortlist.

## Exact test provenance

- Repository: `PatrickFrome/Compute`
- Benchmark source commit: `85570df184b76ff3cccb4bd617aa76b57fef72a2`
- GitHub Actions run: `33233918493` (`A2 live acceptance`, run #24)
- Job: `99051437169` (`live`)
- Gateway: `https://ai-gateway.vercel.sh`
- Authentication: short-lived capability obtained by the existing GitHub OIDC acceptance broker; secret values were masked and scrubbed by the workflow.
- Benchmark tasks: arithmetic, JavaScript coding selection, untrusted-instruction fence, strict JSON output.
- Benchmark output/content was not promoted to project authority. `canonical=false`, `authority_effect=false`.

## Full zero-spend language coverage

A fresh scan of the complete live Vercel AI Gateway catalog observed **360 total models**. Under the project fail-closed rule — `type=language`, explicit published `pricing.input=0`, explicit published `pricing.output=0`, and no non-zero published tier/charge — the usable zero-spend language pool is exactly four current routes:

1. `minimax/minimax-m3-free`
2. `minimax/minimax-m2.7-free`
3. `poolside/laguna-s-2.1-free`
4. `inclusionai/ling-3.0-flash-fin-free`

All **4/4 current explicit zero-price language routes** were actually sent inference requests in the benchmark run. `inclusionai/ling-3.0-tiny-free` was also checked as a previously observed candidate but is no longer present in the live catalog.

Routes whose catalog pricing object is empty or ambiguous are deliberately **not** treated as zero-spend; absence of a published price is not proof of zero cost.

## Zero-spend candidates actually attempted

| Model | Live zero-price gate | Inference attempt | Qualification disposition |
| --- | --- | --- | --- |
| `minimax/minimax-m3-free` | PASS | HTTP 403 on all 4 tasks | KEEP shortlist; inference blocked by account gate, not scored for quality |
| `minimax/minimax-m2.7-free` | PASS | HTTP 403 on all 4 tasks | DROP default; same provider family as M3 and therefore redundant for a three-peer diversity shortlist |
| `poolside/laguna-s-2.1-free` | PASS | HTTP 403 on all 4 tasks | KEEP shortlist; independent provider family |
| `inclusionai/ling-3.0-flash-fin-free` | PASS | HTTP 403 on all 4 tasks | KEEP shortlist; independent provider family |
| `inclusionai/ling-3.0-tiny-free` | FAIL: model missing | No inference | DROP; stale/missing live catalog route |

The measured 403 response latencies are **not model-generation latency** and MUST NOT be used to rank model quality.

## Account-level inference blocker

The same acceptance run successfully:

1. exchanged GitHub OIDC for the scoped acceptance bundle;
2. read the live Vercel Gateway model inventory;
3. passed the A2 ingress/Ed25519 canary;
4. reached the inference endpoint.

All four catalog-present zero-price candidates were then rejected with HTTP 403 before a model answer was returned. The exact paid probes for `openai/gpt-5.6-sol` and `zai/glm-5.3` were independently classified as `CUSTOMER_VERIFICATION_REQUIRED` in the same run.

Therefore the current evidence supports an **account/provider access gate**, not a quality failure of MiniMax, Laguna, or Ling. No candidate receives a quality score from this run.

## Alternative credential rails checked

The existing `metaengine-cloudflare-relay-h205f21` control bridge was also checked without exposing credentials:

- relay health: HTTP 200, control bridge alive;
- stored OpenAI credential verification: upstream HTTP 401 / invalid JWT;
- stored Cloudflare credential verification: upstream HTTP 401 / unauthorized.

Those credentials are stale and are not accepted as an inference route.

The Supabase `metaengine-aop1-vercel-gateway-key-probe-h205f22` function is intentionally closed and returns `410 probe_closed`; it is not an active bypass path.

## Final default shortlist

Keep exactly:

1. `minimax/minimax-m3-free` — primary general free route.
2. `poolside/laguna-s-2.1-free` — independent Poolside fallback/peer.
3. `inclusionai/ling-3.0-flash-fin-free` — independent InclusionAI fallback/peer.

Selection criteria at this stage are **live catalog presence + verified zero-price metadata + provider-family diversity + removal of stale/redundant routes**. They are not claimed to be a quality leaderboard because the account-level 403 prevented model responses.

The existing logical peers remain:

- `metaengine/peer-a-free` → MiniMax first;
- `metaengine/peer-b-free` → Laguna first;
- `metaengine/peer-c-free` → Ling first.

The F1 branch additionally contains a regression contract that requires exactly these three default routes, three distinct provider prefixes, and prevents request preferences from resurrecting MiniMax M2.7 Free or Ling Tiny into the default plan.

## Frontier candidates

Claude Sonnet 5, Gemini 3.7 Flash, DeepSeek V4 Pro 0813, GLM 5.3, Qwen 3.8 Flash/Max, and Grok 4.6 remain allowlisted only in paid role profiles and remain disabled by default. They are **not live-quality-qualified** by this receipt. Enabling them still requires both deployment and per-request paid opt-in plus the hard request budget fence.

## F1 shortlist contract verification

After sealing the shortlist, `F1 Model Gateway Contract` run #16 / Actions run `33234341990` on head `0a835fa11315eac0361dae7214a2fb550fa3244e` completed **SUCCESS**:

- syntax/schema: PASS;
- model-gateway tests: **31/31 PASS**;
- full live catalog observed: 360 models;
- all three selected routes still zero-price under tier-aware checks;
- seven disabled frontier allowlist entries present;
- inference calls in the F1 contract workflow: 0;
- `authority_effect=false`.

Governance Preview remains red by design because this accelerator branch is not an authoritative registered workstream. The qualification work does not weaken that gate.

## Re-run condition

A true quality tournament becomes valid only after one of these conditions is satisfied without weakening authentication:

- Vercel customer verification allows inference; or
- a new explicitly authorized provider credential/control rail is connected; or
- a trusted Browser Operator UI rail becomes live for the relevant subscription model.

When that happens, rerun the same deterministic task set, add coding/reasoning/long-context workloads, record served-model provenance and latency, and replace this provisional shortlist only if evidence justifies it.

## Non-actions

No merge to `main`, no force-push, no Supabase DDL, no authority mutation, no paid inference authorization, and no F1 VERIFIED claim were performed by this qualification attempt.
