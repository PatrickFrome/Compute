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
- Windows/installed/signed-canary qualification for the new commit remains a separate required CI result.

## Research and decisions

1. Temporal, Workflow message passing: https://docs.temporal.io/develop/typescript/workflows/message-passing . The documented distinction between an accepted update and completed work supports keeping ADMITTED separate from Agent execution. Use a read-only progress query for later tracking; do not add a second scheduler.
2. Temporal, Event History: https://docs.temporal.io/encyclopedia/event-history/event-history-go . Durable state must be recovered from recorded events rather than inferred from a green transport call. Here we verified the exact task row and its terminal cleanup reason independently.
3. W3C Web Cryptography: https://www.w3.org/TR/webcrypto/ . Signature verification and application-level identity validation are distinct responsibilities. Preserve the existing device-signature rail and strengthen the response binding consumed by the client.
4. Supabase Edge authentication: https://supabase.com/docs/guides/functions/auth . The project's custom device-signature path remains its existing trust boundary; no replacement with anonymous or service-role credentials in the renderer.

## Next acceptance gates

1. Qualify the new production normalizer against a fresh signed canary response on this exact source head; verify DB task identity and quarantine the probe task afterward.
2. Add durable goal progress/reconciliation keyed by exact workspace + plan generation + task id, including response-loss and restart cases. A task admission receipt must not be displayed as a completed development result.
3. Prove the admitted task reaches a real z.ai Agent-origin session, verified submission/readback and accepted result. Preserve the single canonical scheduler and geometry-independent controls.
4. Qualify the installed Client against the new recovery project. Historical installed Browser heartbeat and old-project AMBIGUOUS_INSTALL do not demonstrate this migration.
5. Only after exact-head qualification, publish the tested installer and perform a reconciled update. No blind SELF_UPDATE_APPLY.

## Branch audit

`client-v1-c4-branch-audit-2026-09-29.json` inventories all fetched origin refs with exact SHA and ancestry relative to 94d8b6dc. The audit first detected a shallow checkout and deepened history before final classification. Ancestry coverage is not a claim that every divergent branch received a semantic code review. Older local R98 provider patches were preserved in their original worktree and are not replayed over the converged Client source.
