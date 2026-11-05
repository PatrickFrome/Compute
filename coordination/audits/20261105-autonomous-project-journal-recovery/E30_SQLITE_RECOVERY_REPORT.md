# METAENGINE — source-only audit: autonomous project dialogue checkpoint recovery (c265 → e30)

**Status:** narrow reproducible source fix + disposable SQLite regression tests complete; no installer/host/PG/service/browser/model/API execution. **Not a Windows/installed-client qualification.**

## Exact source identity and extraction correction

- Public source origin: `PatrickFrome/Compute`, `work/source-transfer-c26565e-20261103`, commit `accb28e72c87c059e780efb8e6681886b33e9b4f`, three parts under `coordination/source-transfer/c26565e/`.
- Integrated patch published by commit `d53ccd4135f28206d91d6804cf0626095565e6af` (`integrated-c265-to-e30.patch`).
- User-authorized GitHub-derived package: `METAENGINE-e30-github-only-source.zip`, Library ID `libfile_67e248dedc1081918003c1514194a6f7`, SHA256 **169f4dc6379605d68d34360c9d28d687b4da3dc856aea6fc1fb27e6bc6d3ba06 — PASS**.
- Exact reconstructed source tree **90fa5633d7926dd71a7303266073e0625325e740 — PASS** (4,346 files). Reproducible commands in clean directory:

  ```bash
  mkdir -p clean && cd clean
  LC_ALL=C.utf8 unzip -q /path/to/METAENGINE-e30-github-only-source.zip
  cd Compute
  git init -q
  LC_ALL=C.utf8 git -c core.autocrlf=false -c core.filemode=true -c core.excludesFile=/dev/null add -f --all
  git write-tree
  # 90fa5633d7926dd71a7303266073e0625325e740
  ```

- **Locale pitfall:** initial extraction under `LC_CTYPE=POSIX` made Info-ZIP render three Cyrillic filenames as `#Uxxxx` strings. That yielded false tree `ff63a45316d8f2a474b708de503f538afffa1791`; with UTF-8 locale the tree matches exactly. Unix execute bits were preserved (74 files mode `100755`); no files were silently rewritten.
- Patched test tree: **f66b2f00636da6ab21506f18f623c464fc78375f** (no claim that this is accepted integration HEAD).

## Actual producer → durable receipt → consumers

1. `apps/metaengine-browser/src/autonomous-project-host.mjs`: `createAutonomousProjectHost` creates the private `effects-project.sqlite` (after private storage/ACL file verification) and supplies `createAutonomousProjectJournal` to `AutonomousProjectTaskRuntime`. This is **SQLite** (`node:sqlite` `DatabaseSync`), not JSONL and not a PostgreSQL task authorizer. The native SQL-backed Supervisor remains the authority for tasks and claims.
2. `apps/metaengine-browser/src/autonomous-project-journal.mjs`: strict `project_effects` SQLite schema (`effect_key`, immutable `binding_sha256`, `intent`, optional `receipt`/`receipt_sha256`); trigger forbids deletion and mutation of confirmed records. `BEGIN IMMEDIATE` + `synchronous=FULL` + `journal_mode=DELETE` records the intent before a physical send; `confirm` records a separately observed receipt. Duplicate prior key never sets `created:true`, and a different binding fails.
3. `agent-toolbelt-core.mjs` → `AutonomousProjectTaskRuntime.beginToolEffect` write-ahead custody (`tool-issue:*`), `ackToolEffect` (`:accepted` command ID), `resolveToolEffect` (terminal receipt). Unknown / lost `issue-tool` ACK returns `UNKNOWN` or requires exact readback; it must not re-issue a fresh effect. `AgentToolbelt.harvestResults` reads terminal command receipts by the accepted command ID. Neither the SQLite intent nor a checkpoint grants an external permit.
4. `AutonomousProjectTaskRuntime.#message` and `#ackMessage`: local immutable intent precedes signed PostgreSQL project-message/ack endpoints. Server replies include `replayed` and message sequence, but message receipt explicitly sets `read_by_recipient_proven:false`, and recipient ACK sets `processing_verified:false`. An ACK is not proof that the agent processed the message. The actual SQL endpoint remains a separate authority; no real PG17 was used in this audit.
5. `DevOsNativeTaskCycle.#observeRunning`: after independent URL/fleet binding and live lease checks, calls `refreshContext` and `latestTurnForLease`. It passes tool results to `continueConversation`; the runtime reconstructs a bounded prompt, observes transcript floor, acquires SQLite `turn:*` `begin` barrier (with predecessor fencing), physically sends once through the existing fenced browser callback, then `confirm`s only on an allowed observed effect state. `ALREADY_DELIVERED` is read-only; an unfinished turn is `AMBIGUOUS` rather than retried. The cycle only suppresses duplicate tool delivery for confirmed identities.
6. `BrowserParentSuspension.suspend`: `conversationCheckpoint` requires complete delivery identities, no unresolved effects, no pending task effects; only then can existing `withQuiescentParent` consider a READ_ONLY parent for hibernation, and even then separate transport/SQL custody readbacks are required. `#rememberResume` writes a separate journal resume row only after verified SQL `RESUMED` receipt; it is not a fresh conversation-send authorization.
7. Restart: a new journal handle opens the same strict SQLite file and validates schema/integrity before use. `pendingPage` has bounded keyset pagination with advisory cursors; `hasPendingConversationTurn` scans all unfinished turns for a lease, so a later confirmed row cannot hide an earlier UNKNOWN. No checkpoint grants another model send, task, Owner, scheduler, or permit.

## Transition table — observed implementation and protected result

| Durable state / event | Real consumer / check | Recovery outcome | New physical effect? |
|---|---|---|---|
| No row, current SQL lease + transcript read | `continueConversation`, SQLite `begin` returns `created:true` | `INTENT_PENDING` before guarded send | Only via existing live send gate, never from checkpoint |
| Intent COMMIT, crash before physical send | `find`, `latestConversationTurn`, pending check | `AMBIGUOUS` / readback required | No automatic resend (unknown which side of boundary) |
| Intent COMMIT, physical send, reply lost | `continueConversation` prior row and `latestTurnForLease` | `AMBIGUOUS`, preserve original identity | No |
| Receipt COMMIT, restart | `latestTurnForLease` and cycle | `CONFIRMED` only if complete delivery history, no unresolved effects | Already-delivered results not resent |
| Prior confirmed turn but older pending row | `hasPendingConversationTurn` | `AMBIGUOUS` | No |
| Legacy incomplete delivery history | `conversationCheckpoint` and patched `latestTurnForLease` | `DURABLE_DELIVERY_CHECKPOINT_REQUIRED` / `AMBIGUOUS` | No |
| Hash-valid malformed delivered identity | Patched journal/runtime validation | `DURABLE_DELIVERY_CHECKPOINT_REQUIRED` / `AMBIGUOUS` | No |
| Confirmed displayed result with UNKNOWN tool | `conversationCheckpoint` and patched recovered turn check | `UNKNOWN_TOOL_EFFECT_REQUIRES_READBACK` / `AMBIGUOUS` | No automatic reissue |
| Accepted command ID with terminal receipt | `AgentToolbelt.harvestResults`, `resolveToolEffect` | Retained immutable resolved tool result | No second command issue |
| Project message stored, recipient ACK absent | `PROJECT_HISTORY`, `#ackMessage`, SQL idempotent endpoint | Unread/processing unproven | No authority inferred |
| Recipient ACK confirmed | SQL ack receipt (`processing_verified:false`) | Acknowledged address, processing unproven | No |
| Parent READ_ONLY + complete checkpoint, no pending effects | `BrowserParentSuspension.suspend` | Possible separate SQL/transport hibernation | Checkpoint itself authorizes nothing |
| SQLite truncated, malformed or foreign JSONL | Strict open/schema / quick_check | Fail closed without rewriting foreign bytes | No |
| SQLite capacity exceeded / `SQLITE_FULL` | `begin` transaction failure | Previous rows remain; no new durable intent/receipt | No |
| Claim changes during transcript observation | Patched `continueConversation` fresh `#taskSnapshot` | Reject before SQLite begin/send | No |

## Reproduced defects (source-only narrow patch)

1. **Incomplete restored delivery history admitted:** `AutonomousProjectTaskRuntime.latestTurnForLease` returned `CONFIRMED` for a hash-valid old SQLite receipt lacking `delivery_history_complete` or delivered tool identities, even though `conversationCheckpoint` explicitly rejected the same row. This supplied the downstream cycle with a transcript/delivery window before serving tools. Now it requires complete and well-formed delivered identities, no duplicate request IDs and no unresolved tool effects; otherwise `AMBIGUOUS`. `conversationCheckpoint` also rejects malformed/duplicate delivery references, not only a missing array.
2. **SQLite `SQLITE_FULL` error shadowed:** real disposable local journal stored 545 large records then returned `cannot rollback - no transaction is active` because SQLite automatically rolled back the failed transaction and `begin` blindly executed another `ROLLBACK`. Both `begin` and `confirm` now roll back only while `db.isTransaction` is true, preserving the original error and durable prior records.
3. **Stale parent after async transcript observation:** while `observeTranscriptFloor` awaited, the original SQL parent claim could change. `continueConversation` proceeded to new local intent and physical send without re-reading the current parent. Added existing authoritative `#taskSnapshot(lease)` recheck after observation and before SQLite begin; no new signer, owner, permit, scheduler or external effect authority introduced.

## Tests and evidence

- Initial untouched runtime baseline: `node --test .../autonomous-project-task-runtime.test.mjs` — **67 PASS**.
- Pre-fix regressions: legacy history / delivered identity / malformed delivery tests reproduced FAIL; real disposable local SQLite fill at 545 committed rows reproduced secondary rollback-error masking. See `regression-before.tap` and `actual-sqlite-full-before.txt`.
- Exact tree, patched source: six target test files (`autonomous-project-journal-recovery-regression`, `autonomous-project-task-runtime`, browser suspension and cycle, autonomous continuation contract, devos native cycle) — **137 PASS, 0 FAIL, 0 SKIP**.
- Two additional existing inert source/continuation suites — **7 PASS, 0 FAIL, 0 SKIP**.
- `git apply --check` + `git apply` against clean verified tree — **PASS**.
- New regressions use actual disposable SQLite databases; truncated file, old JSONL rejection, unconfirmed intent after reopen, capacity exhaustion, real `SQLITE_FULL`, competing readback, and parent claim drift. The separate `SQLITE_FULL` fixture with a small page cap confirms SQLite semantics but is **not** a production-disk `ENOSPC` test. Existing JSONL fixture tests from earlier PR are **not** counted as SQLite journal qualification.
- **NOT RUN:** installed client / real PostgreSQL or system DB / services / Windows ACL and fsync / real providers, live network listeners, browser, signed authorization / genuine disk-full OS, large-scale unattended integration, true physical crash power-cut. No production effects, budget or refill/debit changes.

## Integration and CI publication boundary

- Patch changes only `apps/metaengine-browser/src/autonomous-project-journal.mjs`, `apps/metaengine-browser/src/autonomous-project-task-runtime.mjs`; adds `apps/metaengine-browser/test/autonomous-project-journal-recovery-regression.test.mjs`.
- The public GitHub c265/d53 branches contain the **source-transfer archive and integrated patch**, not the reconstructed source as ordinary branch files. Therefore publish this as a **source patch artifact + evidence** in existing Draft PR #1451; do not rewrite unrelated files, merge or mark Windows/physical qualification complete.
- CI/Actions: static workflow/branch/path filters should be inspected before PR synchronization; creating a draft PR or pushing a branch may enqueue Actions. No workflow is manually dispatched by this audit. Treat automatic CI as independent, not a substitute for local evidence.
- Remain in `HOLD` for promotion to installed client until the integration coordinator applies the patch to the authoritative newer candidate, verifies base identity, and qualifies native/SQLite/PG/Windows custody independently.
