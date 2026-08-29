# F1 Zero-Spend Committee — 2026-08-29

Status: PREPARE_ONLY / non-canonical / non-authority.

Canonical Level-1 milestone: F1+
Level-2 milestone: F1_LIVE_EXTERNAL_FEDERATION

## Purpose

Add a provider-diverse advisory committee on top of the existing zero-spend Vercel AI Gateway shortlist without converting transport success or majority availability into METAENGINE execution authority.

## Source-of-truth preflight

Before implementation, Supabase was re-read and remained at semantic checkpoint `metaengine-h205f22-recovery-dev-20260821-cp072` with `definition_integrity=true`. `F1_LIVE_EXTERNAL_FEDERATION` remains `READY`, not `VERIFIED`. The newest F1 work claim is expired. Supervisor directive #25 remains stored as `ACTIVE` but its `expires_at` is 2026-08-23T16:35:24Z, so it is treated as stale governance debt rather than effective runtime authority.

GitHub `main` remained `0d1c074c7f513f25000d967761c7bb13912dacaa`. This accelerator stays on draft PR #66 and does not mutate main, Supabase schema, provider configuration, or authority state.

## Committee contract

Endpoint: `POST /v1/committee`.

The committee is fixed to exactly three models from three provider families:

1. `minimax/minimax-m3-free`
2. `poolside/laguna-s-2.1-free`
3. `inclusionai/ling-3.0-flash-fin-free`

Invariants:

- exactly three members;
- exactly three unique provider-family prefixes;
- `role=free` only;
- `paid_ok=true` is rejected;
- caller-supplied `preferred_models` is rejected;
- a fresh live catalog zero-price check completes before fan-out;
- each committee member is dispatched with a single-model plan (`models:[model]`), so fallback cannot silently substitute another committee member;
- all three requests start concurrently through `Promise.all`;
- each successful member must report exactly the requested `served_model`;
- each member receives an independent response SHA-256 receipt;
- quorum is 2/3 successful usable answers;
- fewer than two successful answers returns HTTP 503 with a structured non-authority receipt;
- no fourth-model synthesis is performed;
- `synthesis_performed=false`, `synthesis=null`;
- `tariff_dependency=true`;
- `data_policy=PUBLIC_OR_NON_SENSITIVE_ONLY`;
- `confidential_data_supported=false`;
- `authority_effect=false` at committee and member levels.

The existing pre-inference high-confidence secret detector is reused, so secret-like prompt/context material is rejected before the live catalog check or external inference.

## Why 2/3 is only an availability quorum

`quorum_met=true` means that at least two independent provider calls returned usable, provenance-valid answers. It does **not** mean those answers agree semantically, establish truth, authorize an action, or satisfy SAME_POINT_DUEL_V4 arbitration. Raw member answers are intentionally returned unsynthesized so the GPT supervisor or another explicit arbitration layer can compare them without hiding disagreement.

The committee therefore must not be submitted as a fake third actor into the existing two-actor SAME_POINT_DUEL_V4 peer relay. That relay retains its GPT/GLM identity and atomic pairing invariants.

## Verification

Implementation head: `9743e4fdd4efdf80f332ad26aeb5eb405aa84044`.

`F1 Model Gateway Contract` run #19 / GitHub Actions run `33234784371`: **SUCCESS**.

- syntax/schema gates: PASS;
- model gateway tests: **35/35 PASS**;
- new committee tests: **4/4 PASS**;
- concurrency observed in test: three member calls active concurrently;
- 2/3 success => `QUORUM_MET`;
- 1/3 success => `QUORUM_FAILED`;
- served-model mismatch => member failure, never provenance laundering;
- live Vercel catalog gate: PASS;
- live catalog observed: 360 models;
- all three selected routes remain zero-price under tier-aware checks;
- contract-CI inference calls: 0;
- confidentiality claim: false;
- authority effect: false.

Governance Preview remains red for PR #66 because the accelerator branch is not an authoritative registered workstream. No governance weakening is proposed.

## Current live blocker

The prior live qualification sent actual requests to all four then-current zero-price language routes and received HTTP 403 before model answers. This remains an account/customer-verification rail blocker, not model-quality evidence. The committee is therefore contract-proven but not claimed as live inference evidence.

## Next integration boundary

The next safe layer is a supervisor-facing adapter that converts a committee receipt into a hash-backed advisory evidence envelope. It may expose raw answers and provenance to the supervisor, but it must preserve:

- `synthesis_performed=false`;
- `authority_effect=false`;
- quorum as transport/availability evidence only;
- no direct submission into the two-actor V4 ledger;
- no action execution without independent supervisor revalidation.

Live promotion still requires an effective F1 supervisor grant, an authenticated isolated deployment, a working provider rail, persisted/read-back receipts, and supervisor sealing.