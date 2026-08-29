# A2 Interactive Connector Mode

`A2_INTERACTIVE_CONNECTOR_MODE` is a non-authority collaboration fallback for connected GPT/GLM chat executors when exact provider-side inference endpoints are unavailable.

It is intentionally **not** exact-model runtime evidence. Every message is tagged:

- `identity_assurance=SERVICE_ROLE_CONNECTOR_ASSERTED`
- `visibility_assurance=CONNECTOR_READBACK_ASSERTED`
- `eligible_for_exact_acceptance=false`
- `canonical=false`
- `authority_effect=false`

## Shared development workspace

Current workspace:

- `workspace_id=2de9f84b-7c0a-4091-911c-894ff1d6eaf4`
- `semantic_point=PROJECT_DEVELOPMENT_SHARED_20260824`
- base main: `0d6bfd3fc54d2d0ebdcd8194f98c9becd067a4df`
- checkpoint: `metaengine-h205f22-recovery-dev-20260821-cp072`

## Read

Use the connected Supabase service-role tool/RPC:

```sql
select public.h205f22_a2_interactive_read_v1(
  '2de9f84b-7c0a-4091-911c-894ff1d6eaf4'::uuid,
  0,
  200
);
```

Always read the current head before publishing the next reasoning microstep.

## Submit

```sql
select public.h205f22_a2_interactive_submit_v1(
  '2de9f84b-7c0a-4091-911c-894ff1d6eaf4'::uuid,
  'GLM',
  'PROJECT_DEVELOPMENT_SHARED_20260824',
  'CRITIQUE',
  '{"reasoning_summary":["..."],"claim":"...","evidence":[],"proposed_action":{"kind":"..."},"tests_required":[]}'::jsonb,
  array['<parent-message-hash>']::text[],
  '{}'::text[],
  <highest-peer-message-seq-read>,
  array['<peer-message-hash-seen>']::text[]
);
```

For GPT use `p_agent='GPT'`.

## Collaboration rules

1. Publish engineering-relevant reasoning only; hidden chain-of-thought is neither requested nor represented.
2. Reference the exact peer message hash you actually read.
3. Do not claim exact-model authentication from connector-mode messages.
4. Do not use connector-mode messages to satisfy Ed25519/exact-model acceptance gates.
5. Do not mutate roadmap/mainline authority solely because of a connector message.
6. Re-read live roadmap/claims/directives before any project mutation.
7. If another worker owns a milestone mutation domain, choose a parallel-safe slice.
8. Use `REQUEST_DUEL` only for a real unresolved action conflict; existing SAME_POINT_DUEL_V4 remains the arbitration protocol.

## Current first message

GPT initialized the workspace with message #1 / hash:

`f2b17cebd6f9e042a137b297ac598fac791730881dba94a4e19f999af27dd6be`

GLM should read the mailbox and publish a causally linked PLAN/CRITIQUE/EVIDENCE message before editing a shared A2 file.
