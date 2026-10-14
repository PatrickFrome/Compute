# DevFleet W19 — Hermetic four-hot-slot coding-conveyor soak

**Status:** SOURCE-ONLY adversarial benchmark; **not** a live DevFleet/ChatGPT/Windows resource measurement.
**Base:** PR #1239 exact HEAD 4c867e7d4c2c7b05fa02dff39409747f4124d7a3.
**Canonical roadmap:** coordination/operator-control/ROADMAP_UNIFIED_COMMAND_CONTINUITY_V1.md on work/roadmap-no-cloud-capsule-20261013.
**Authority:** the existing DevFleetOperator (create, batchAssign, batchRotate, retire); W19 adds only test and documentation, not a scheduler, admissions service, RPC endpoint or any send authority.

## Reproduce

From apps/metaengine-devfleet with Node 24:

    node --test test/devfleet-w19-soak.test.mjs
    node --test test/*.test.mjs

The benchmark constructs a memory-backed fake native adapter and persistent journal. It does **not** call Electron, CDP, browsers, ChatGPT, PostgreSQL, Supabase, Guardian, remote hosts or services. The test driver submits 25 explicit four-lane waves; this simulates owner-issued existing operator calls, not automated scheduling or real agent completions.

## Invariants tested

1. **100 unique coding-task admissions**, 25 from each independent producer, with no producer skipped between waves; **four fake physical WebContents maximum** at any instant; one existing operator and its serialization/write-ahead history. This is a test-harness ceiling; DevFleet's underlying operator still supports 16 sessions and has no production four-hot governor in this PR.
2. Fault injection: **unknown after attempted Send** and **invalid native Send readback** both stay AMBIGUOUS; no replay on old request IDs, including after retirement and process reincarnation. An ambiguous receipt on the current hot tab remains blocked (not erased by accounting).
3. **Unknown physical close** leaves the affected lane RETIRE_UNKNOWN, does not create a replacement in that lane, and does not stop the other three; reboot converts interrupted lineage to ROTATION_INTERRUPTED_UNKNOWN without Send replay.
4. **Crash after physical close before durable close checkpoint**: durable write fails while previous persisted stage is RETIRING; upon process restart, old incarnation is fenced, no replacement or replay is inferred; only an independent new request identity can admit a different task.
5. Duplicate wave IDs, batch >4, and a synthetic 500-receipt-full journal reject new effects without close/send. The 100-task workload must fit under 500 receipts and a 512 KiB test journal ceiling.

## Initial focused run — Windows Node 24.19.0

- **4/4 tests PASS.**
- 100 synthetic admission intents; 100 fake Send attempts (exactly one each).
- 15 deliberately ambiguous receipts; 96 native-close fakes; 197 durable request records.
- Per-producer admissions [25,25,25,25]; peak fake WebContents 4.
- Peak serialized journal bytes 141,803; local elapsed ~1.84 s (nonportable).
- Sources of truth: test assertions and emitted Node diagnostic JSON. No real model, runtime RAM, task completion, signed receipt, developer source artifact or user-turn delivery was measured.

## Explicit nonclaims / integration gate

**W19 proves the existing source-level rotation and replay fences under a deterministic 100-intent mock workload; it does not prove real throughput, fairness of W17's forthcoming admission reducer, or physical readiness.** The 25-wave fairness in this test is guaranteed by scripted owner wave ordering; actual backlog admission fairness remains UNKNOWN until the W17 reducer is independently integrated and exercised. Mock PROVEN_SENT means only the fake adapter's return shape; it is not ChatGPT delivery proof. Actual 8 GB-host memory use, renderer readiness, process-incarnation proof, live 100-task acceptance/completion, durable multi-process transactions, and installed v15 behavior are UNKNOWN.

Keep this branch and PR DRAFT. No installation, package build, Supabase/cloud access, actual Browser/Guardian/PG effects, second task scheduler, or main merge is authorized by these tests.
