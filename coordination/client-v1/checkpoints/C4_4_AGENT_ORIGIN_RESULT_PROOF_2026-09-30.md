# C4.4 Checkpoint — Agent-Origin + Typed Result Proof

Captured: 2026-09-30
Roadmap: `metaengine-client-v1`
Milestone: `C4_TYPED_PRODUCT_CONTROL`
Alignment epoch: `3`
Baseline: `1fde1e53549eafefd6c28b50cdcd384e86d14512`
Branch: `work/client-v1-c4-agent-origin-result-proof-v1`
Draft PR: `#1081`

## Source-of-truth audit

The active Client implementation lineage is the C4 stack rooted in the fresh-project Client V1 line. Older C2/C3/runtime branches remain evidence or contained ancestors; no bulk merge is authorized.

At C4.4 start, the live recovery project reported:

- plan generation watermark: 3;
- ACTIVE Client plan: none;
- latest native Browser supervisor heartbeat: stale;
- fleet agent count: 0;
- scheduler capacity: `NO_SNAPSHOT`;
- available slots: 0.

Therefore this checkpoint does not claim a physical user-goal → real Agent result.

## Research

The existing runtime already owns the required physical execution rail:

1. DevOS owns task leases.
2. Native Browser Fleet owns Agent/tab lifecycle.
3. `DevOsEffectDeliveryJournal` establishes a write-ahead effect barrier before z.ai submission.
4. `devos_fleet_mark_running_v1` persists `TASK_TRANSPORT_PROVEN` with:
   - prompt SHA-256;
   - conversation URL SHA-256;
   - Agent-surface SHA-256;
   - proven effect state;
   - `ZAI_AGENT_SURFACE_CAUSAL_V1`.
5. Meta tasks require the typed `metaengine.agent-result-claim.v1` result protocol.
6. Completion already persists result-summary/result digests.

External research confirmed that caller-intent idempotency + durable readback is the useful pattern here. A second workflow/scheduler plane is not required.

Detailed research:
`research/METAENGINE_CLIENT_V1_C4_AGENT_ORIGIN_RESULT_PROOF_RESEARCH_2026-09-30.md`

## Defect found

Fresh-project Postgres and the Browser/Edge completion contract had drifted:

- Browser/Edge accepted `BLOCKED` and `AMBIGUOUS`;
- live `devos_fleet_complete_v1` accepted only `COMPLETED|FAILED|RESULT_READY`;
- the task state constraint did not admit `BLOCKED`.

This could turn a legitimate typed-result rejection such as
`RESULT_CLAIM_MISSING_OR_INVALID`
into completion transport ambiguity.

## Implementation

Migration:
`supabase/migrations/20260929224500_client_v1_agent_origin_result_proof_v1.sql`

It:

- adds durable `BLOCKED` task state;
- aligns `devos_fleet_complete_v1` with Browser/Edge FINALISH states;
- emits digest-only `TASK_RESULT_<STATE>` receipts;
- adds read-only `client_v1_goal_execution_proof_v1`.

The proof RPC joins only:

`request_id → exact Client ledger row → exact DevOS task → exact TASK_TRANSPORT_PROVEN event → digest-validated typed Result Claim`.

It never returns:

- agent identity;
- tab identity;
- target identity;
- task payload;
- raw result summary;
- page content;
- model output.

It grants no scheduler, Browser, release or retry authority.

## Browser/product integration

The signed Native Supervisor client now has a read-only execution-proof method.

Goal reconciliation:

1. reads durable progress;
2. records progress locally;
3. attempts the execution-proof read;
4. records proof when available;
5. never retries the original goal or physical Browser effect because proof readback failed.

The product UI distinguishes:

- no Agent proof;
- exact Agent-origin proven;
- accepted result proof bound to the same conversation.

## Verification

### Rollback-only DB qualification

The migration was first executed under `BEGIN/ROLLBACK`.

A synthetic, transaction-local proof established:

- `BLOCKED` completion is accepted durably;
- task/result digest binding remains exact;
- exact `TASK_TRANSPORT_PROVEN` binds a Client request to Agent-origin proof;
- a typed `READY` Result Claim with the same conversation digest produces:
  - `user_goal_to_agent_readback=true`;
  - `user_goal_to_result_readback=true`;
- no scheduler identity or raw result content is returned.

All synthetic mutations were rolled back.

### Live DDL

Migration `client_v1_agent_origin_result_proof_v1` was applied successfully to recovery project
`jhriwwsryeqsvvvufkok`.

Post-migration advisors introduced no new C4.4-specific security or performance finding.

### Isolated Edge canary

Only the isolated canary was changed:

- slug: `a2-browser-native-supervisor-v14-canary`
- version: 21
- EZBR SHA-256:
  `2fe43cc51e166f46d2d0ed5d22bdad2eb562953831c96a685eaae30e54cb973d`
- C4.4 meta-route source pin:
  `42c47251d75e804b6799d584fe26f2b2faf5a272`

Production stable Edge was not changed.

### Signed canary

Run:
`36641440383`

Result:
`SUCCESS`

Evidence artifact:
`11067410053`

Artifact digest:
`sha256:fd4ba48fc88509f673f3fde9f013f51d4f607d3b2fd8a6ca1d5f10656df4256a`

Exact live bindings:

- Client request:
  `07ef92b4-851e-414b-8511-c7b4eb3ffe17`
- plan generation: 4
- task:
  `91280274-cbf5-4be5-a15f-e60580db43e4`
- state at qualification: `READY`
- lease generation: 0
- Agent-origin proof: absent
- accepted result proof: absent

This is the expected fail-closed result because no live Agent capacity was present.

The qualification task was then fenced before lease and plan generation 4 was superseded. Execution-proof readback remains available after plan retirement.

## Current status

C4.4 contract/readback path: IMPLEMENTED + LIVE-QUALIFIED.

C4 roadmap exit:
`USER_GOAL_TO_DEVOS_AGENT_READBACK`

Status:
`PHYSICAL_AGENT_PENDING`

The missing evidence is now strictly physical rather than architectural: a fresh native Browser heartbeat with an ACTIVE z.ai Agent must lease one exact Client task, emit `TASK_TRANSPORT_PROVEN`, produce a bound typed Result Claim, and survive Client readback/restart.

No synthetic proof may close this roadmap exit.
