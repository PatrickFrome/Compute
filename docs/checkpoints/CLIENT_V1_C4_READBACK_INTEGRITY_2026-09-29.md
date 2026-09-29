# Client V1 C4.2 — admission readback integrity

Checkpoint date: 2026-09-29 UTC. Scope: Client product-control C4, not the older Compute Fabric C4 cache milestone in CANONICAL_ROADMAP.md.

## Verified starting point

- Product donor: PR #1078, `work/client-v1-c4-typed-goal-bridge-v1`, exact head `94d8b6dcd97c1a0bb8cde264108f2269257a5f06`.
- The user handoff `924009631d896289443588e45f55d01a86d49277` is an ancestor, not the current frontier.
- All 18 listed GitHub workflows on 94d8b6dc completed SUCCESS, including signed canary goal, R83, Package, Installed Chat, Final Runtime, Soak and Self Update. This does not qualify a later commit automatically.
- Signed canary workflow: https://github.com/PatrickFrome/Compute/actions/runs/36581251342 . Artifact 11039104283, ZIP SHA-256 `57b5448d9079fbabcc84d0bec78d01419947851225162a095e2bb7a53abfe2a0`.
- Artifact proves device-signed goal admission to task `655d2460-9077-437c-848a-860b71e63791`, point `obj.c4-signed-canary-qualification-36581251342-attem.v1`, generation 1.
- Independent read-only query in recovery project `jhriwwsryeqsvvvufkok` found that exact task. It is FENCED, lease generation 0, no agent, with explicit cleanup reason `CLIENT_V1_SIGNED_CANARY_QUALIFICATION_COMPLETE`. This is deliberate test cleanup, not proof of Agent execution and not an unexplained liveness failure.
- Current DB authority: Client V1 C4, alignment epoch 3, source baseline `1fde1e53549eafefd6c28b50cdcd384e86d14512`. Source metadata and CI-only successors must remain distinguishable.

## Reproduced defect and change

The installed-client normalizer checked the outer ADMITTED envelope but did not bind nested activation and admission to one workspace, roadmap, plan generation or alignment epoch. It also accepted coercible non-integer values and ignored nested authority permissions. The canary used a separate, weaker assertion set instead of that production normalizer.

The new contract rejects missing or mismatched nested identities, non-ACTIVE activation, malformed point/task identifiers, missing digest fields, coercible generations/counts and absent/true permission or exposure flags. It retains workspace, epoch, baseline and plan/task digests in the client receipt and copies arrays before freezing them. These are consistency checks on an authenticated readback, not independent cryptographic recomputation of unavailable plan/task content.

The signed canary now invokes the same production normalizer and records the validated binding. Workflow path filters include the contract and its negative tests. No model API, scheduler, lease, Browser effect, automatic retry or deployment authority is added.

## Verification

- Before: the new 20-case suite failed all 20 cases (19 malformed-input rejection cases and one positive projection case).
- After: 20/20 integrity tests pass; all 55 Client V1 plus Meta provider tests pass.
- Parser checks for the normalizer and signed canary pass; `git diff --check` passes.
- On code head `188ae9e14e1f4a8e1e95190e6a2b8cea4783a8dd`, Shell, Critical Audit, Installed Chat, Autonomous Soak, Final Runtime, Package Smoke and the signed C4 canary are SUCCESS. Self Update E2E was still in progress at the last checkpoint read and remains a separate gate.

## Generation-watermark live repair and C4 canary qualification

The first live canary against the strengthened client exposed a second, independent defect after the previous generation-1 canary had been intentionally retired. `meta_orchestrator_plan_snapshot_v1` returned `found=false, plan_generation=0` whenever no ACTIVE plan existed, while `meta_orchestrator_plan_activate_v1` correctly fenced against the historical `max(plan_generation)=1`. The client compiler therefore sent stale CAS expectation 0 and received `meta_plan_generation_fenced`.

The repair keeps the write-side CAS unchanged and makes the read side monotonic: the snapshot now returns the durable generation watermark even when `found=false`; the objective compiler consumes that watermark instead of resetting it to zero. A new forward migration `20260929203000_client_v1_plan_generation_watermark_v1.sql` was applied to recovery project `jhriwwsryeqsvvvufkok`. Independent readback then returned `found=false, plan_generation=1` both directly and through `meta_orchestrator_authoritative_inputs_v1`.

The canary Edge function was advanced to version 19 with only the Meta route pinned to code head `188ae9e14e1f4a8e1e95190e6a2b8cea4783a8dd`; its existing custom device-signature authentication and `verify_jwt=false` setting were preserved. The first run attempt failed before goal submission on one transient Edge-to-Postgres `CONNECT_TIMEOUT` during enrollment polling; adjacent polls were HTTP 202, so this was not a generation or signature-contract failure.

Rerun attempt 2 was approved through the existing enrollment approval RPC and completed SUCCESS. Artifact `11060879768` has ZIP SHA-256 `9d4b8fb07cc865a452da70dc0f8e220dfda75600dffe39ab1c0b5b1bb9847387`. Production readback validation accepted generation 2 and durable task `411614e0-2602-4f4f-ba1c-4405bc663a90`, point `obj.c4-signed-canary-qualification-36627212762-attem.v1`, with `task_admission_state=ADMITTED`, matching workspace, epoch 3, baseline, plan digest and task-spec digest. Independent DB readback observed the task as READY with lease generation 0 and no agent. The probe was then deliberately fenced before any lease with reason `CLIENT_V1_SIGNED_CANARY_QUALIFICATION_COMPLETE`, and generation-2 plan state was retired to SUPERSEDED. This qualifies signed submission -> atomic plan activation -> durable ADMITTED task creation; it still does not qualify Agent execution.

## Research and decisions

1. Temporal, Workflow message passing: https://docs.temporal.io/develop/typescript/workflows/message-passing . The documented distinction between an accepted update and completed work supports keeping ADMITTED separate from Agent execution. Use a read-only progress query for later tracking; do not add a second scheduler.
2. Temporal, Event History: https://docs.temporal.io/encyclopedia/event-history/event-history-go . Durable state must be recovered from recorded events rather than inferred from a green transport call. Here we verified the exact task row and its terminal cleanup reason independently.
3. W3C Web Cryptography: https://www.w3.org/TR/webcrypto/ . Signature verification and application-level identity validation are distinct responsibilities. Preserve the existing device-signature rail and strengthen the response binding consumed by the client.
4. Supabase Edge authentication: https://supabase.com/docs/guides/functions/auth . The project's custom device-signature path remains its existing trust boundary; no replacement with anonymous or service-role credentials in the renderer.

## Next acceptance gates

1. Add durable goal progress/reconciliation keyed by exact workspace + plan generation + task id, including response-loss and restart cases. A task admission receipt must not be displayed as a completed development result.
2. Prove the admitted task reaches a real z.ai Agent-origin session, verified submission/readback and accepted result. Preserve the single canonical scheduler and geometry-independent controls.
3. Qualify the installed Client against the new recovery project. Historical installed Browser heartbeat and old-project AMBIGUOUS_INSTALL do not demonstrate this migration.
4. Close the remaining exact-code-head CI gate (Self Update E2E if still running/failing), then publish only the tested installer and perform a reconciled update. No blind SELF_UPDATE_APPLY.

The checkpoint commit itself is documentation-only and therefore is not evidence that a different runtime tree was exercised; runtime qualification above refers explicitly to code head `188ae9e14e1f4a8e1e95190e6a2b8cea4783a8dd`.

## Branch audit

`client-v1-c4-branch-audit-2026-09-29.json` inventories all fetched origin refs with exact SHA and ancestry relative to 94d8b6dc. The audit first detected a shallow checkout and deepened history before final classification. Ancestry coverage is not a claim that every divergent branch received a semantic code review. Older local R98 provider patches were preserved in their original worktree and are not replayed over the converged Client source.
