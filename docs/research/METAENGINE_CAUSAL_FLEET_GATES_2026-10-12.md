# METAENGINE architecture checkpoint — 2026-10-12: causal fleet gates and restore qualification

Local authority: Windows repo `C:/Users/User/Desktop/metaen/client-work`, branch `work/client-autonomous-continuity-v1`. Baseline committed HEAD `e5b9ed0d4e9757a1e77e949bd8faa3ace4d230c8`. No GitHub synchronization or installed Browser upgrade in this cycle.

## End goal and testable invariants

METAENGINE must continuously execute useful project goals with a coordinated fleet of real, independently verified agents, durable task/lease/effect provenance, safe native IDE/browser/terminal actions, adversarial recovery, self-test, and bounded autonomous self-improvement.

A service heartbeat, a green unit-test stub, a model label, or an open chat tab does not prove autonomous useful work. Proof must include goal admission, claimed lease, exact physical effect, independently reviewed output, durable checkpoint and next semantic point.

## Research (official current source material)

- Temporal event history explains deterministic workflow replay and the separation of recorded commands from Activity effects: https://docs.temporal.io/encyclopedia/event-history
- Temporal Activities generally have at-least-once effects under worker failure; they require idempotent Activities or explicit no-retry control: https://github.com/temporalio/documentation/blob/main/docs/develop/python/best-practices/error-handling.mdx
- AWS Durable Execution documents at-most-once per retry, which is NOT the same as exactly-once for a workflow: https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/
- LangGraph checkpoint modes and deterministic replay favor isolated checkpointed side effects: https://github.com/langchain-ai/docs/blob/main/src/oss/langgraph/functional-api.mdx
- PostgreSQL 17 pg_restore documentation specifies --exit-on-error and --single-transaction and warns that restoring a dump executes database-controlled code: https://www.postgresql.org/docs/17/app-pgrestore.html

## Newly found production architecture defect: effect-lane eviction

In `apps/metaengine-browser/src/devos-native-task-cycle-core.mjs`, the previous tab gate pruned keys from a 256-slot Map without checking whether promises were completed. If the evicted tab received another lease while its original command was still executing, it could bypass the prior promise and run another browser effect concurrently in the same tab. This violates causal order at fleet scale.

New source `bounded-keyed-effect-gate.mjs` retains each in-flight lane until it settles, serializes same-key operations across exceptions, allows distinct keys to overlap, caps at 256 active tab keys and 32 queued operations per key, and refuses overflow before a new effect. Live task cycle now uses the new helper. Existing `devos-concurrent-dispatch.test.mjs` independently passed 4/4. Source check passed 190/190.

Adversarial test `bounded-keyed-effect-gate.test.mjs` is now green (5/5); the initial 2 PASS / 3 FAIL was a test error from asynchronous `assert.rejects` against deliberate synchronous pre-effect rejection. Both original DevOS concurrency and new effect-gate tests combined pass 9/9; broader DevOS cycle suite passes 24/24. This proves the isolated JS gate, **not** a physical 256-tab ChatGPT run.

## Recovery / installation gap

Working Browser .59 primary PID 2888, Guardian 3288, PostgreSQL 17 Keeper PID 10776, with Keeper listening on 127.0.0.1:55432. API/Edge 55433/55434 not ready, live Admin unavailable, historical WAKE_AMBIGUOUS and zero proven agent work remain unqualified. The attempted local61 protected pre-upgrade dump is 0 bytes with no PASS receipt. No blind retry, no installer started, no live DB mutation.

`upgrade-backup-restore-gate.mjs` now validates a *claimed* disposable-restore receipt input but strictly distinguishes `restore_receipt_consistent:true` from `restore_verified:false` and `physical_restore_proven:false`; a synthetic receipt and synthetic PGDMP prefix are NOT physical restore evidence. All relevant 28 tests passed, one symlink test SKIPPED. The gate **never** sets `upgrade_authorized:true`. Future work must run an independently attested isolated physical PostgreSQL 17 restore and compare table/row digests before a distinct promotion gate can even consider an upgrade.

## Ordered next proof stages

P0: tab-gate adversarial regression closed at source level (9/9); freeze exact source SHA and preserve historical ambiguous wakes without duplicate sends.
P0: independently diagnose *previous* PostgreSQL failure by authorized nonsecret diagnostics; establish a new effect-intent namespace before any new one-shot backup.
P0: full new protected backup, independently verified TOC, isolated physical PostgreSQL restore and ACL/identity/rollback proof; no automatic production promotion.
P0: release candidate from exact SHA, Windows packaged Owner/PG/UI E2E in disposable runtime, then safe installed update when gates pass.
P0: one actual agent completing a useful coding task from admitted goal through code, tests, independent critic, persisted checkpoint and next admitted point.
P1: scale logical fleet under physical resource broker and exact per-tab effect lanes (4, 16, 32, 64+), verify measured throughput and memory.
P1: adversarial restart and 72-hour soak, self-improvement under an independent non-self-certifying release gate.
