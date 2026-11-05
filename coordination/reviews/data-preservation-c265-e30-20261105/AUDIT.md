# METAENGINE — upgrade/recovery data-preservation audit (verified e30)

**Review:** 2026-11-05. **Scope:** exact `PatrickFrome/Compute` c265→e30 source-derived tree.  
**Disposition:** `DP-01 NOT REPRODUCED ON e30 / PHYSICAL PRESERVATION UNPROVEN / INSTALLATION HOLD`.  
This report **supersedes** the pre-e30 source-only analysis in the earlier version of this Draft PR. It does not authorize installation, migration, backup, restoration, rollback, credential access or a second installer effect. All tests discussed below are source reads or disposable file/Node tests.

## 1. Provenance: checked exact source, not the older public parent

- Original GitHub transfer: branch `work/source-transfer-c26565e-20261103`, commit `accb28e72c87c059e780efb8e6681886b33e9b4f`, directory `coordination/source-transfer/c26565e`. Integrated GitHub patch: commit `d53ccd4135f28206d91d6804cf0626095565e6af`, file `integrated-c265-to-e30.patch` (Git blob `79d40bf024a6553656b86fb1a29c1313dd458a0e`).
- The supplied **GitHub-derived e30 source ZIP** was materialized using the ChatGPT Library file `libfile_67e248dedc1081918003c1514194a6f7`, filename `METAENGINE-e30-github-only-source.zip`. Independently computed archive SHA256: `169f4dc6379605d68d34360c9d28d687b4da3dc856aea6fc1fb27e6bc6d3ba06`, exactly matching the announced SHA256.
- ZIP inspection: `4,346` regular files, ZIP mode inventory `4,272 × 100644`, `74 × 100755`. Original executable bits were preserved on extraction. The ZIP was scanned for unsafe member paths and duplicate file entries before extraction. No binaries were executed.
- **Two independent tree computations** agree with required `90fa5633d7926dd71a7303266073e0625325e740`: (1) a Python reconstruction of Git blob/tree objects directly from ZIP member bytes and modes; (2) `git write-tree` after extracting the complete source into an isolated Git index with `core.filemode=true`. The source baseline was not replaced with public `ff63318b` or any other revision.
- Git blob SHA1 of the **e30 production** transaction module is `ce9ee1f55273f9a8fa511cb3c33165fd141879ec`; the durable JSON writer is `d00b80244d7ff1aa1a3e66e92f1c689ef82fbb84`. The older public-parent blobs previously reviewed in this PR (`f24e47a3…`, `ad46c314…`) are **not** these e30 modules. The previous DP-01 result therefore cannot be carried into the e30 verdict.
- Limitation: the exact expected tree and archive bytes are verified. The e30 ZIP was not independently rebuilt from three remote binary archive parts in this executor; that remaining **provenance-chain detail** must not be confused with a tree mismatch or a production qualification.

## 2. What the production e30 code actually does for DP-01

The old report identified a possible dual admission because its older public-parent `beginSelfUpdateTransaction` did an unlocked read followed by unconditional rename. **In the exact verified e30 module, that implementation has already been replaced.**

1. `apps/metaengine-browser/src/self-update-transaction-journal.mjs:88–126`: `withTransactionLock` opens the durable lock with exclusive `wx`, syncs its content, refuses an existing marker and does not guess whether a stale owner can be reclaimed. An uncertain mutation keeps its marker for readback/HOLD.
2. `.../self-update-transaction-journal.mjs:152–195`: `beginSelfUpdateTransaction` re-reads the prior transaction **under the lock**; any unresolved prior state rejects, and the writer receives `expectedPreimage: snapshot.raw`. The initial read outside the lock is a preflight refusal, not the final admission decision.
3. `.../self-update-transaction-journal.mjs:197–244`: transitions compare the exact locked byte preimage, validate target/transaction bindings, then make the same guarded write.
4. `.../self-update-transaction-journal.mjs:246–282`: `markSelfUpdateInstallEffectAttempted` binds to `requireTransactionId: current.transaction_id`, `requireState: 'PREPARED'`, then records `INSTALLING` and `effect_barrier_crossed:true` before installer handoff; no automatic retry is authorized.
5. `apps/metaengine-browser/src/durable-json-file.cjs:145–222`: byte-level CAS uses preimage and exclusive publication, verifies readback, and retains surviving evidence when the outcome is unknown. It is not a blind rename over another writer's committed row.

**DP-01 finding on e30: NOT REPRODUCED.** Four new targeted tests, the existing seven generated multi-process/CAS tests, and the prior journal, write-ahead and recovery tests passed. Six independent child Node processes competing for one `begin` admitted exactly one attempt; the analogous test for `mark` admitted one. This is a Linux/local-filesystem source qualification only, **not** a Windows power-failure guarantee.

**Minimal production fix:** already included in exact e30. A second implementation or artificial code churn would be unjustified and might weaken HOLD. No production file is modified by this PR update. The minimal deliverable is an **additive inert regression patch** (`patches/DP01_e30_inert_regression.patch`) which adds `apps/metaengine-browser/test/self-update-dp01-e30.test.mjs` against the exact e30 tree. `git apply --cached --check` on that tree passed. The PR's GitHub base is the published transfer-patch branch rather than a commit containing the e30 source tree; therefore do not cherry-pick this regression path onto the older parent or treat this draft as an installable code release.

## 3. Data custody and preservation matrix — independent domains

| Domain | Verified in exact e30 source | What is **not** proven |
|---|---|---|
| Browser profile/user settings/authentication | Transaction, old-parent handoff and several control journals are stored under Electron `app.getPath('userData')`; `electron-builder.test.json` sets `nsis.deleteAppDataOnUninstall:false`. | Installation/rollback preserves actual Chromium profile, cookies, encrypted secrets, original absolute userData location, ACLs, settings and all associated files; this must be shown by physical pre/post byte and identity inventory. |
| PostgreSQL PGDATA, catalog and logical records | `infra/client-state-runtime/pg17-recovery-producer.mjs` requires original recovery-root/directory custody before binding source pool. `upgrade-backup-gate.mjs` verifies some archive properties, and `upgrade-backup-restore-gate.mjs` refuses to turn a coherent receipt into physical restore authority; `upgrade_authorized:false`, `database_rollback_allowed:false` remain vetoes. | Real PG17 physical restore, WAL/sequence state, role/schema/extension reconciliation, original source and destination identity, Windows service/Owner joins, and no mutation of production PGDATA. All **NOT RUN**. |
| Projects and workspace | **Not one PG surface:** `apps/metaengine-browser/src/autonomous-project-journal.mjs` uses `node:sqlite` local `project_effects` with FULL durability; `managed-task-project-sqlite-journal.mjs` stores another SQLite state domain. Filesystem worktrees and owner-selected repository metadata are separate. | Unified backup/rollback of ALL SQLite databases, project files, worktrees, original IDs/permissions and PG project rows with a common consistent cutoff. |
| Messages, conversation, pending deliveries | PG-side message/ACK schema exists (`infra/client-state-runtime/browser-project-messages-v1.sql`, `project-message-ack-v1.sql`); local autonomous project journal independently tracks pending and confirmed turns and refuses incomplete delivery history. | Exact preservation of persisted messages and queued/unsent sends, pagination cursors, user-visible transcript, attachments and deduplicated ACK across rollback. A checkpoint is not permission for a new effect. |
| Agent results and artifacts | `apps/metaengine-browser/src/native-coding-run-callback-journal.mjs` writes private numbered receipts under `host-callback-custody` and represents UNKNOWN/HOLD. `result-delivery-transport.mjs` has explicit readback reconciliation; RSI ledger and related state files are placed under `userData` in `main.mjs`. | Full result/outbox/artifact inventory, durable callback reconciliation, task/lease association and cross-store consistent rollback; no independent physical proof. |
| Upgrade attempt journal | e30 `withTransactionLock` + byte CAS + exact transaction identity prevents the tested DP-01 double admission; ambiguous effects are not automatically retried. | End-to-end atomicity with PG, project files, SQLite stores, outgoing messages and results; Windows/power-loss durability remains unqualified. |

**Crucial:** protecting only PGDATA is insufficient. Relevant project, chat, callback and supervisor records live in *multiple* separately durable stores. None of the inspected source functions establishes one atomic snapshot covering all domains.

## 4. Phase/interruption/rollback table

| Phase / failure boundary | Evidence in e30 | Required disposition for user data |
|---|---|---|
| `P0` profile/PG/site inventory, before `PREPARED` | Files and PG stores have distinct owners; no common data inventory in updater receipt. | HOLD until complete stable IDs, bytes and logical counts are independently recorded. |
| `P1` `PREPARED` persisted | e30 one-winner lock/CAS, `automatic_retry_allowed:false`. | A single attempt exists; this alone does not prove backup completeness. Retain all preimage/profile/PG and local journals. |
| `P2` protected-root and PG producer selection | Original W74/W76 and retained directory custody veto missing authority. | HOLD on unconfirmed source/root/Owner or changed directory. No newly randomized root may bypass the old attempt. |
| `P3` archive/recovery readback | Backup/restore gate distinguishes archive digest, TOC, physical restore and installed Owner proof. | HOLD without exact same-attempt backup + independent disposable restore evidence. Do not overwrite PGDATA. |
| `P4` `INSTALLING` or lost installer ACK | Write-ahead barrier crossed before possible physical effect. | Effect may have happened; read back installed executable, profile, PG and data; **no automatic install retry**. |
| `P5` `SUCCESSOR_BOOTED` | Startup target/version and retained journal may converge. | Profile, PG, project/message/result reconciliation is not automatically qualified by boot. |
| `P6` `QUALIFIED`, `QUARANTINED` or `AMBIGUOUS_INSTALL` | Exact updater journal states and conditional recovery. | HOLD on missing or contradicting evidence; do not treat `QUALIFIED` alone as a five-domain preservation proof. |
| `P7` interrupted rollback/restore, restart | Synthetic fixture tests and source guards preserve earlier attempted restore and disallow blind retry. | Physical rollback/restore and multi-store readbacks **NOT RUN**; preserve original bytes and UNKNOWN until separately qualified. |

## 5. Regression execution and scope

All commands ran in the verified isolated e30 source checkout. They used local temporary directories, fake `app.getPath('userData')` and/or read-only source checks. Multi-process tests spawned only inert Node children to contend for one temporary lock; **no installer, OS service, PostgreSQL server, network listener, client, credentials or real user profile** was started or touched.

| Group | PASS | FAIL | SKIP |
|---|---:|---:|---:|
| Pre-existing e30 production transaction/CAS, journal, write-ahead, fail-closed suites | 24 | 0 | 0 |
| New e30 DP-01 production-module regressions (12 contenders, qualified new generation, begin/INSTALLING, abandoned lock) | 4 | 0 | 0 |
| Prior synthetic five-domain preservation tests | 9 | 0 | 0 |
| Earlier concurrent-first-begin regression (16 disposable rounds, executed against verified e30) | 1 | 0 | 0 |
| Updated exact-e30 source contracts | 10 | 0 | 0 |
| **Total, one combined TAP run** | **48** | **0** | **0** |

Full `TAP` output, source-tree verifier, test-only unified patch and SHA manifests are included in the local source-only result package; test counts are not extrapolated from source. See `TEST_RESULTS.md` for the exact command and file paths.

**Physical Windows inputs/installed profile: NOT RUN.** **Disposable PG17 with a real process: NOT RUN.** **Installer/update/rollback: NOT RUN.** **PostgreSQL migrations and services: NOT RUN.** **No new physical preservation guarantee is asserted.**

## 6. Remaining HOLD criteria

1. Independently inventory all user profile files, SQLite project journals, worktree contents, PostgreSQL clusters/schemas, message ACK tables and durable result/outbox artifacts at one bounded consistent cutoff, without publishing personal data.
2. Verify identity, counts/hashes and deletion/duplicate detection after each simulated interruption, after successor startup, and after physical rollback in expressly authorized disposable environments. Include incomplete write, disk-full, stopped process and UNKNOWN readback; never convert a checkpoint into effect permission.
3. Qualify Windows installed owner/ACL/package/PG17 using actual readback and separate authority. Verify that real userData and source PGDATA are not overwritten even when backup or rollback is interrupted.
4. Keep the draft PR **unmerged**, preserve existing permission/approval boundaries and `INSTALLATION HOLD`. No result in this audit changes authorization for the installed client.

**Excluded by explicit scope:** previously rejected security subreviews, symbolic-link races, cloud/Supabase/GLM, external billing, installer execution, Windows PC/real databases/services, and any authority/ACK fabrication.
