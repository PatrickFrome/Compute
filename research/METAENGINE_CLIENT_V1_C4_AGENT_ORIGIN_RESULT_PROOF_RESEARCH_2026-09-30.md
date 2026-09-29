# METAENGINE Client V1 C4 Agent-Origin + Result Proof Research — 2026-09-30

## Scope

This research supports the C4 exit:

`USER_GOAL_TO_DEVOS_AGENT_READBACK`

It is intentionally narrower than C5. It does not create a new scheduler, task store, Browser actuator, worker runtime, model API fallback, or workflow engine.

## Live source-of-truth snapshot

At research time:

- roadmap: `metaengine-client-v1`
- milestone: `C4_TYPED_PRODUCT_CONTROL`
- alignment epoch: `3`
- baseline: `1fde1e53549eafefd6c28b50cdcd384e86d14512`
- durable plan watermark: `3`
- ACTIVE plan: none
- latest native supervisor heartbeat: stale
- scheduler capacity: `NO_SNAPSHOT`
- available slots: `0`
- latest fleet agent count: `0`

Therefore no physical Agent success may be claimed from this checkpoint.

## Existing runtime rail

Repository and live DB inspection show that the required execution rail already exists.

### 1. Client intent correlation

C4.3 already persists a caller-generated request UUID atomically with:

- semantic plan activation;
- canonical DevOS task admission;
- exact task identity.

A repeated exact request returns the original receipt rather than allocating a second generation/task.

### 2. DevOS scheduler authority

The existing DevOS cycle remains the sole task lease authority. Client code never chooses:

- agent;
- tab;
- target;
- lease generation.

### 3. Browser effect journal

`DevOsEffectDeliveryJournal` establishes a durable write-ahead barrier before the external z.ai effect.

After the barrier, unknown outcomes are reconciled by status/proof readback and never by blind physical replay.

### 4. Agent-origin proof already exists

`20260928034500_devos_agent_origin_receipt_v1.sql` requires `devos_fleet_mark_running_v1` to receive:

- `prompt_sha256`;
- `conversation_url_sha256`;
- `agent_surface_sha256`;
- a proven effect state.

The DB emits `TASK_TRANSPORT_PROVEN` with:

- `agent_origin_contract = ZAI_AGENT_SURFACE_CAUSAL_V1`;
- conversation digest;
- Agent-surface digest;
- prompt digest;
- effect state.

The event already preserves the exact causal proof needed by C4. No new physical proof collector is needed.

### 5. Result proof already exists

Meta tasks require a typed Agent Result Claim.

The running observer accepts a Meta result only through `parseAgentResultClaim`; raw page/model text does not become authority.

The durable task result stores:

- `result_summary_sha256`;
- `result_sha256`;
- bounded claim metadata including `result_claim_sha256` and disposition.

The Client progress membrane currently exposes task/result digests but not the Agent-origin event nor the bounded Result Claim proof.

## Identified C4 gap

The missing piece is not execution. It is a read-only proof join:

`Client request_id -> exact admitted task -> TASK_TRANSPORT_PROVEN -> result-claim digest`

Without that join, the product UI can distinguish ADMITTED/RUNNING/RESULT_READY, but cannot prove to the user that:

1. the exact goal reached a genuine z.ai Agent surface;
2. the exact Agent-origin conversation is the same conversation observed at result completion;
3. the result was accepted through the typed Result Claim protocol rather than inferred from page text.

## External research

### AWS — caller intent + atomic idempotency token

AWS Builders' Library, *Making retries safe with idempotent APIs*:

https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/

Relevant result:

- use a caller-provided request identifier to express intent;
- persist that identifier atomically with the mutation;
- replay of the same identifier should return semantically equivalent state rather than create a second effect.

This matches the C4.3 request ledger. No second retry mechanism is needed.

### Temporal — durable progress history, not duplicate side effects

Temporal durable execution docs:

https://docs.temporal.io/temporal

Temporal task/idempotency discussion:

https://docs.temporal.io/tasks

Relevant result:

- durable workflows recover from persisted history;
- external operations still require idempotent/effect-safe handling;
- a durable history is useful as a reconciliation model, but importing another workflow engine would duplicate METAENGINE's existing DevOS + effect-journal authority.

Therefore the useful idea is the history/readback pattern, not a new orchestration dependency.

## C4.4 design decision

Add one read-only service-role RPC:

`client_v1_goal_execution_proof_v1(workspace_id, request_id)`

It must:

1. start from the C4.3 request ledger;
2. rebind the exact task using workspace/task/plan/point/task-spec digests;
3. find only the exact `TASK_TRANSPORT_PROVEN` event for the task's current lease generation;
4. expose only digest/protocol proof, never agent/tab/target scheduler identity;
5. validate result-summary digest before projecting bounded Result Claim metadata;
6. require result conversation digest to match Agent-origin conversation digest before claiming result-origin binding;
7. expose explicit booleans:
   - `user_goal_to_agent_readback`
   - `user_goal_to_result_readback`
8. remain valid after semantic plan retirement;
9. grant no scheduler, Browser, release or retry authority.

## Non-goals

This slice does not:

- lease a task;
- create/provision an Agent;
- select a tab or target;
- submit to z.ai;
- retry an ambiguous physical effect;
- accept raw model/page output;
- mark C4 complete without a real ACTIVE Agent live proof.

## Qualification plan

1. SQL/parser/authority contract tests.
2. Route/client/UI typed readback tests.
3. Rollback-only DB smoke with synthetic digest proof to verify binding and fail-closed drift.
4. Apply migration to the recovery project.
5. Re-run security/performance advisors.
6. When an actual native fleet heartbeat exposes ACTIVE Agent capacity, submit one bounded Client goal and capture:
   - request UUID;
   - task ID;
   - lease generation;
   - Agent-origin digest proof;
   - result-claim digest proof;
   - restart-safe Client readback.

Only step 6 can close the C4 roadmap exit.
