# DevFleet immutable local journal v1 (Windows)

## Why
A long-lived Desktop Commander `node.exe` instance was observed holding a sharing-incompatible handle to the **legacy** `%APPDATA%/METAENGINE DevFleet/operator-state.json`, even when all DevFleet processes were stopped. This made `fs.rename(tmp,legacy)` fail and fenced the existing DevFleet operator. The lock is not caused by old `AMBIGUOUS` receipts.

## Source-of-truth migration
- On the first start with this feature, read the existing legacy journal **without mutating it**.
- Every later durable operator-state snapshot is a fresh immutable `operator-snapshot-gNNNNNNNNNN-<sha256>.json` under the same private userData directory.
- On startup, choose the unique highest committed generation and verify its exact SHA-256 and envelope. A corrupted highest generation or competing same-sequence generations fail closed. Do not silently return to a stale legacy snapshot.
- A pending `.tmp-` filename is not a committed state. No host, chat Send, or PostgreSQL effect is inferred from the existence of a file.
- The operator still serializes writes via its original `#saveTail` and fences all further effects on unverified persistence failure.
- There is no new scheduler, database, hosted fallback, or direct page-to-host authority.

## Qualification
- 9 hermetic adversarial snapshot tests cover locked legacy destination, restart, 12 generations, crash/temp, corruption, fork, competing writer, ambiguous rename and pre-commit failure.
- Windows Node 24 full suite **140/140 PASS**.
- Disposable QA migration from copied **live** operator-state.json: **15/15** distinct Client W22–W36 coding tasks durably queued and reloaded, **16 historical AMBIGUOUS** preserved, original live journal SHA unchanged. This test does **not** submit any task to ChatGPT.
- Before live activation: exact source SHA, candidate archive digest and userData backup. After: verify operator READY, source-backed queue readback, then separately dispatch one new coding canary and read its user turn.

## Limits
This change removes reliance on in-place rewriting a journal file. It does **not** remove the existing 500-operation request-history cap, guarantee OS durability beyond file-system guarantees, resolve ChatGPT Send receipt ambiguity, prove 15 simultaneous physical chat sessions, or provide autonomous background dispatch. A long-lived queue requires bounded generation retention plus cryptographically verified checkpoint compaction; this implementation deliberately preserves snapshots rather than deleting them before a sound archive policy exists.
