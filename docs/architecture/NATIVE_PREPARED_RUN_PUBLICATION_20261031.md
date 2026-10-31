# Native prepared-run and own-PG publication closure

Status: PARTIALLY IMPLEMENTED / DEFAULT EXECUTION GATE CLOSED / NOT INSTALL QUALIFIED.
Date: 2026-10-31.
Subordinate to `coordination/operator-control/ROADMAP_UNIFIED_COMMAND_CONTINUITY_V1.md` and its existing audit closure register. This is not another scheduler, trust root, enrollment flow or release authority.

## Current reproducible baseline

- Public Draft #1392 source: `c434cb3cad724abded54f2ff4569d5382440d823`.
- Cancellation repair: `035d3f66acb72d05c57c1656621a8e2d6cf1adac` (local, not published at this checkpoint).
- Its tree `370f37c8af86b595c9d523cc4511325f4da22dcc` was tested on Windows as `216dd8ccd0d53284f595da92357746a6f1ad05e1`: 88 passed, zero failures/skips, including real disposable PostgreSQL 17.
- Linux publication/lifetime/real-PG selection: 76 passed; related Host/Owner selection: 66; workflow registration: 18. These selections overlap and are not a single total.
- Full earlier matching Browser code on Windows: 7,464 passed, 25 skipped. This does not qualify later edits or an installer.
- Current-source GitHub run 41166546082: Ubuntu and ME2 succeeded; Windows cancelled while running the Browser suite. Cancellation is not a pass. Cause and hanging-test evidence are under investigation.

## Implementation readback — 2026-10-31 05:18 UTC

Steps 1–2 are now used by the existing executor/runtime wrapper, not a separate executor. Step 5 has bounded 6/6/3 phase contracts and actual original RESERVE transport; PUBLISH/AGENT composition remains pending. The direct Main callback reuses existing W74/W68/kernel custody without nested IPC. Later steps, initial publication and inert BOUND handoff remain open.

Final functional tree `c93cbefc524f2153c0083f37a67c1626a31f0c10` has 325 affected Windows tests passing (one platform skip), 318 affected Linux tests passing (seven platform skips). These do not qualify a full suite or installer. See the [source review](../../evidence/public/prepared-run-owner-20261031/REVIEW.md) for exact checkpoints, earlier failed evidence and remaining gates.

## The actual ordering defect

The lease executor currently reserves before the runner creates its immutable attempt and callback HEADER. Initial callback publication requires those bytes, a BOUND journal and the original in-memory RESERVED object within the original physical RESERVE request. Returning RESERVE first loses that request's lifetime. Reopening another ticket or reconstructing its JSON cannot restore custody.

The standalone Owner reader is single-use. Publication takes six fresh snapshots across its write transaction and separate committed readback. Calling the standalone IPC read from inside the original callback can wait on its own undrained physical request. The fix is an additive transaction-bound repeatable read facet, not a second nested request.

## Ordered implementation

1. **Inert preparation in the existing runner.** Validate the original lease, executable, worktree and critic policy; create the exclusive attempt directory and HEADER. Return a private instance-owned, single-use handle and a read-only descriptor. No model call, broker, child process or W30 write. Clone caller input. Existing prior/EEXIST evidence stays readback-only.
2. **Revalidate before consuming preparation.** Reject JSON/foreign/reused/fenced handles and concurrent consumption. Recheck cancellation, the original expiry ceiling, physical paths and immutable attempt bytes. Abandon fences the handle without deleting evidence. Preserve one implementation for `run()` and `runPrepared()`.
3. **Bind the journal without enabling dispatch.** Claim the existing single writer and produce BOUND independently of the dispatch-capable bridge. A descriptor, path or boolean must not become an execution capability.
4. **Keep initial publication inside actual RESERVE.** After its existing COMMIT, retain the exact returned RESERVED object, publish initial root and independently read committed bytes before the same request returns. Lost COMMIT/ACK is UNKNOWN; no repeat reserve or worker launch.
5. **Fresh Owner reads on the original physical ticket.** Bind every read to actual action, request ID and digest, Host instance/PID, original deadline and bounded monotonically increasing read cycle. Fixed budgets: RESERVE six; publication six; effect recheck three. One active cycle at a time. Reuse the existing W74/W68/kernel readers and passed SQL transaction. Do not invent body hashes for actions that have no signed body, refresh the sealed Owner timestamp, or use nested IPC/global drain.
6. **Promote only after matching response and physical settlement.** Retain custody privately. The Main client may consume it only after both are confirmed. Preserve suspended-worker order: ATTEMPTED COMMIT, W30 RUNNING acknowledgement, bridge bind, then resume.
7. **Require the durable root before effects.** Existing SQL permits absent publication on both sides of an execution transition; that is insufficient for this mode. Enforce the exact initial anchor before job/ATTEMPTED and per-intent publish/readback/handoff before each callback effect.
8. **Fence prior generations durably.** An unresolved native execution must block a fresh generation/run for the same task, for IMPLEMENTER and CRITIC. Per-run callback deduplication and the IMPLEMENTER worktree fence alone do not establish this property. Keep the rule in existing authoritative claim/reserve paths.

## Durability contract: fail-stop, not reconstructed history

An own-PG durable execution/intent fence may replace the requirement for literal Windows directory-entry durability for the narrow no-replay property. It does **not** prove that directory entries survive power loss. Preserve `DIRECTORY_DURABILITY_UNQUALIFIED` and state that losing local evidence causes HOLD.

Required PG conditions include the real database identity and storage, `fsync=on`, `full_page_writes=on` and synchronous commit of the actual fence. No silent reset, old-snapshot promotion or new empty database may erase uncertainty about effects. PG does not replace physical worker custody, watchdog, Owner/source proof or release signing.

A latest cursor/hash commits to a prefix but cannot reconstruct all lost intents. Until durable per-intent/outcome history exists, directory loss cannot become UNSENT, full cleanup, released capacity or replay permission. Existing unknown worker effects retain their physical custody and require reconciliation.

## Mandatory negative and end-to-end evidence

- Delete the callback directory before reserve, after initial COMMIT, before ATTEMPTED, after ATTEMPTED/before resume, after resume, before/after each intent and after effect COMMIT/before ACK. Assert no duplicate spawn, resume or effect.
- Repeat with restarted Main/Host and same PG; same and new generations/run IDs; IMPLEMENTER and CRITIC; two competing Hosts; copied/foreign/recreated prefixes.
- Lose write/readback/settlement ACKs independently. No opaque-handle recreation or successful retry after UNKNOWN.
- Change Owner/control/permit/Host/PG identity during every read cycle. Abort while native work remains pending; await the original work without freeing its physical slot.
- Verify bounded cycles, sequence replay, foreign frames, concurrent cycles, stale request deadlines, callback drain and fresh original SQL transaction custody.
- Run actual Windows and disposable PG17 integration, then the full suite on the final source. Generated contract fixtures alone do not qualify the default composition.

## Installer gates remain separate

First-run materialization and CLI/home/auth selection; probe/run policy equivalence; historical settlement; existing protected release signer and sidecar placement; a new unique package identity; clean install and upgrade with retained own-PG data; restart/backup/restore/rollback; real goal → worker → independent critic → durable checkpoint → next task, including GLM before GPT. The minimal UI must explain setup, READY/RUNNING/HOLD and recovery truthfully. Cosmetic expansion waits until this path works.

No stage in this document changes the default gate to ready or claims an installer was built, signed or installed.
