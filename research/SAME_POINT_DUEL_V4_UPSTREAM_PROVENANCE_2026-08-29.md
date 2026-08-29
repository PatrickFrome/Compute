# SAME_POINT_DUEL_V4 — Upstream Provenance Repair (2026-08-29)

Status: PREPARE_ONLY / CROSS-CUTTING. `canonical=false`, `authority_effect=false`.

## Problem

`orchestration/sovereign/src/same_point_v4.ts` historically assumed both inference endpoints were local and wrote `tariff_dependency=false` into executor receipts, lockstep metadata, and lifecycle telemetry. The runner also supports `SOVEREIGN_GPT_URL` and `SOVEREIGN_GLM_URL`, so an external OpenAI-compatible gateway could inherit false local/tariff-independent provenance.

This became a concrete integration blocker for the prepared F1 multi-model gateway: zero current inference price is not equivalent to local execution or tariff/provider independence.

## Repair

- Default built-in localhost endpoints remain tariff-independent.
- A configured custom endpoint is tariff-dependent by default.
- A proved-local custom endpoint must explicitly set its per-actor dependency override to `false`.
- Invalid dependency configuration fails startup.
- Upstream response metadata can raise dependency but cannot lower the configured minimum.
- Persisted executor payloads now retain requested logical model, actual served model, served-model source, zero-spend result, data policy, confidentiality metadata, and endpoint hash.
- Executor errors retain configured endpoint/model/tariff provenance.
- PROPOSE/REBUT lockstep metadata derives dependency from each actor payload.
- STARTING/LISTENING telemetry derives aggregate and per-actor dependency rather than hard-coding false.

## Verification at implementation commit 71805fef6c99c9dfccf32b7edae4f6ddc26fd216

- `Same Point V4 Upstream Provenance` run #1: SUCCESS.
- existing `SAME_POINT_DUEL_V4 mainline` run #146: SUCCESS.
- no model inference performed.
- no Supabase DDL/runtime mutation performed.
- no F1 VERIFIED/completion claim.

## Integration rule

The external F1 gateway may not be represented as local evidence. When it is eventually authorized and deployed, the sovereign runner must persist `tariff_dependency=true` and the gateway-reported served-model / data-policy metadata. Merge/deployment remains subject to the normal governance and F1 authority gates.
