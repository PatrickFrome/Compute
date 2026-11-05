# METAENGINE — source-only audit of preservation across upgrade and recovery

**Review date:** 2026-11-05. **Status:** `INCOMPLETE / INSTALLATION HOLD`.
This is a preservation-focused review, not an authorization to install, migrate,
restore, reset, open listeners, run services, or access a real user profile/DB.
No rejected security reviews or symbolic-link race investigations are included.

## 1. Provenance and precision of claims

The ONLY source references considered here are GitHub `PatrickFrome/Compute`:

- Source-transfer branch `work/source-transfer-c26565e-20261103`, commit
  `accb28e72c87c059e780efb8e6681886b33e9b4f`, directory
  `coordination/source-transfer/c26565e/`. Its `README.txt` describes the
  ordered three-part archive with SHA256
  `4200e492828dbb857aaa737a7ce56d0aeda3c97c84f7743b1501ef2f229d3636`,
  original revision `c26565e58ab92dcbcda9663c4d231bdf4a9a7ee6`,
  original tree `2dbe253e97379532f6f4b52ef7edf26109a9266d`.
- Integrated patch commit `d53ccd4135f28206d91d6804cf0626095565e6af`
  (branch `work/integrated-e30-source-patch-20261103`), file
  `coordination/source-transfer/c26565e/integrated-c265-to-e30.patch`,
  Git blob `79d40bf024a6553656b86fb1a29c1313dd458a0e`
  (1,269,896 characters of text, 138 `diff --git` sections).
- Requested resulting Git tree `90fa5633d7926dd71a7303266073e0625325e740`
  is **NOT VERIFIED**. The GitHub API did not expose this tree as a Git object;
  GitHub's connected text reader refused raw archive parts as non-UTF-8 or
  returned empty decoded content; the isolated executor had no network path for
  downloading the binary archive. We did **not** reconstruct the c265 source
  tree or apply the integrated patch locally. Therefore source observations
  below cover accessible GitHub text and patch hunks, NOT every resulting file.
- Accessible unmodified public-parent files were separately read at `d53`:
  `apps/metaengine-browser/src/self-update-transaction-journal.mjs` (blob
  `f24e47a323a1b8018ee696735419a0a492ee4b35`),
  `apps/metaengine-browser/src/durable-json-file.cjs` (blob
  `ad46c3141e2f44f75c15360ff652b42331fc4277`),
  `apps/metaengine-browser/src/self-update-runtime.mjs`,
  and `apps/metaengine-browser/test/installer-upgrade-identity.test.mjs`.
  Their equivalence to the unextracted c265 image is **not established**.

The audit deliberately does not assume that an Electron installer, a successful
journal transition, a backup *selector*, or a synthetic fixture PASS proves
preservation of user-created data.

## 2. Surface-by-surface assurance matrix

| Surface | Source-supported mechanism / observed condition | Guaranteed by inspected source | Still unproven; required evidence |
|---|---|---|---|
| Browser/user profiles (settings, sessions, authentication, Chromium state) | Public parent transaction journal is stored under `app.getPath('userData')`; installer identity test requires `nsis.deleteAppDataOnUninstall === false` and unchanged install-directory choice. | The *test expectation* and journal path are demonstrable; sequential unresolved transactions are rejected. | Same physical profile path and all profile bytes/permissions before and after in-place upgrade, restart, rollback; no profile migration/drop/first-run reset; cross-process journal coherence. |
| PostgreSQL PGDATA + logical records | Integrated patch binds backup-root selector to Host state/source directory physical identity; modified PG17 producer requires original recovery custody before binding source pool. | Root registration without original parent custody remains HOLD; existing `REGISTERING` is not silently replaced by `READY`. | A genuine registered root, native custody, PG17 physical backup/restore, WAL consistency, catalog/role/extension checks, complete schema/migration rollback, restore readback on isolated DB; source and destination truly same attempt. |
| Projects/workspace documents | No reconstructible end-to-end inventory of both SQL rows and external project files in accessible material. | **None** for end-to-end project persistence. | Stable project IDs, content hashes and file-tree inventory, owner/permission/references, migrations in both directions, pre/post/restored counts and byte digests. |
| Messages / conversational history | The inspected updater journal does not contain a ledger-level preservation proof; protected backup selector is not an archive receipt. | **None** for message completeness, order, deduplication or attachments. | Chat/CHAT_LED table-level and file-level inventory, ordered cursors, parent links and attachments, committed-vs-unsent writes, rollback replay without gaps or duplicates. |
| Agent results, outbox, task records, artifacts | Neither success of the updater handoff nor `QUALIFIED` by itself attests retained results. | **None** for delivered or pending results. | Durable result/outbox IDs, task/attempt scope, exact artifact hashes, ack/cursor reconciliation and idempotent re-delivery across rollback/restart. |
| Attempt journal / prior-effect evidence | Public parent journal uses durable temp write + file sync + rename and `INSTALLING` before install effect; `automatic_retry_allowed:false`. | Per-write durability intention and sequential rejection of unresolved attempts; `markSelfUpdateInstallEffectAttempted` is serialized **within one process**. | Cross-process compare-and-swap/lease for `begin`, transition and physical effect; durable Windows directory synchronization and exact readback under concurrent owners. |
| Disposable image *fixtures* | Integrated patch adds tests for prior-attempt HOLD, unchanged receipt/image and competing installed image during compensation. | Only portable synthetic-injection assertions, conditional on executing the reconstructed target suite. | Real Windows installer/rollback, real userData and PGDATA preservation, no hidden deletions; this audit did not run those tests on the target tree. |

**Do not infer** that project/message/result data is all in PostgreSQL. The
storage ownership and inventory for each category must first be established
from the exact resulting tree, then verified with independent readbacks.

## 3. Transaction and interruption matrix

`PREPARED`, `INSTALLING`, `SUCCESSOR_BOOTED`, `QUALIFIED`, `QUARANTINED`,
`AMBIGUOUS_INSTALL` are observable updater-journal states. Backup reservation,
source/PG custody and restoration are *separate* subsystems; a unified atomic
transaction among them has **not** been demonstrated.

| Crash / handoff point | Observed source behavior | Preservation claim and safe disposition |
|---|---|---|
| Before creating journal | Begin validates metadata and restart gate. | Existing profile, PGDATA and artifacts must remain untouched. If an earlier attempt is unreadable, HOLD, not reset. |
| After `PREPARED`, before any install effect | Journal persisted; no source proof of a complete backup receipt from this journal alone. | Freeze affected writes and require original exact backup + data inventory. A `PREPARED` row alone is not permission to install. |
| Backup root selection / PG custody | Integrated code rejects missing durable registration or native directory custody. | **HOLD**: do not create a fresh root to bypass prior-effect evidence. Do not touch source pool. |
| After possible backup, before effect crossing | Prior-effect claim should bind attempt, source identity, root, manifests and cutoff; no complete chain verified. | **HOLD** unless the complete receipt and data readbacks are verified. |
| `INSTALLING` / OS installer effect | Write-ahead attempt marker exists; it can already reflect a physical modification. | Effect may have happened. Never install again or infer rollback success from journal alone. Require independent readback. |
| `SUCCESSOR_BOOTED` pre-qualification | Version/receipt match can be established, but no complete user-data content proof was observed. | **HOLD** for preservation claim pending full profile/PG/project/message/result readback. |
| `QUARANTINED` / ambiguous successor | Recovery classifier prevents unproven new install and treats effect ambiguity as HOLD. | Preserve old/new observations and original backup; no automatic retry. |
| Rollback/restore starts then is interrupted | Disposable fixture tests guard prior attempt overwrite and a competing installed image. | **HOLD** until restore completion + independent identity, bytes, SQL, message and result reconciliation. No auto-new restore attempt. |
| Post-rollback restart | Exact restored state and owner generation must be read back. | No `READY/QUALIFIED` without the original authority plus all five data-domain comparisons. |

## 4. Concrete finding: potential lost-attempt race in public parent journal

**DP-01 — BLOCKING pending reproduction on the exact reconstructed tree.**
`beginSelfUpdateTransaction` reads the prior row and then calls
`durableWriteJson` without the `serializeInstallEffectBarrier` used by
`markSelfUpdateInstallEffectAttempted`. That writer uses a unique temporary
file and an unconditional rename over the target; it does not compare the
existing transaction ID with the row read earlier. Thus two concurrent first
begins can both observe `ENOENT`, both return distinct successful transaction
IDs and leave only the last row. A later effect barrier cannot restore the
lost earlier grant. This is a *source-level interleaving possibility*, not an
observed physical-install data-loss event.

The isolated manual behavioral test in `tests/concurrent-begin.regression.manual.mjs`
uses only temporary synthetic `userData` directories and asserts precisely one
successful begin. It is NOT RUN here because the required GitHub source tree
could not be materialized; it must not be relabelled as PASS. The matching
static source check against actual GitHub text is **FAIL** (guard absent).

Recommended fix, **not** applied by this audit: use one original cross-process,
per-attempt lease or durable CAS around the entire read/validate/write sequence
and all transitions; bind the lease to the original attempt and owner generation,
then read back the committed row. Preserve existing HOLD and all single-shot
limits. Do not invent a new signer, reset the journal, or allow a second effect.

## 5. Minimal inert regression set

- `tests/source-contracts.manual.mjs`: 9 positive source assertions and one
  intentionally failing guard assertion for DP-01, reading only the GitHub
  checkout and integrated patch; **NOT RUN in executor** (no target checkout).
- `tests/concurrent-begin.regression.manual.mjs`: 16 disposable rounds using
  the *actual* `beginSelfUpdateTransaction` module when a checked-out source is
  supplied; **NOT RUN** in executor. Expected to expose DP-01; don't silently
  mark flaky or unexecuted outcomes as PASS.
- `tests/fixture-data-preservation.test.mjs`: 9 model-only, synthetic file tests
  for 5 preservation domains, interrupted state HOLD and missing readback.
  **9 PASS, 0 FAIL, 0 SKIP** in isolated Node executor. No installer, PG,
  browser, listener, service, network, or installed profile was accessed.
- GitHub text-only source assertions run directly via connected read action:
  **9 PASS, 1 FAIL** (DP-01 source guard). Not a behavioral target-tree run.

Manual commands *after acquiring and validating the actual requested tree*:

```sh
node --test coordination/reviews/data-preservation-c265-e30-20261105/tests/fixture-data-preservation.test.mjs
node --test coordination/reviews/data-preservation-c265-e30-20261105/tests/source-contracts.manual.mjs
node --test coordination/reviews/data-preservation-c265-e30-20261105/tests/concurrent-begin.regression.manual.mjs
```

These commands require **no** installer, service, DB or network. The real
source qualification remains blocked until the archive SHA256, original tree
and patch-produced tree can all be verified in an isolated checkout.

## 6. Required evidence to discharge HOLD

1. Reassemble the three binary parts from the **specified GitHub archive**,
   verify archive SHA256, original tree `2dbe253e...`, apply the exact integrated
   patch in an isolated checkout, verify tree `90fa5633...`, and compare target
   files with the publicly readable parent modules. Never substitute a different
   public revision or an earlier local/Space archive.
2. Produce a source-grounded map of every profile, PG cluster/tablespace,
   project file, message/attachment, and durable result/outbox location and
   its owning process/transaction. No data needs to be published.
3. At each actual phase boundary: capture hashes, stable IDs, SQL catalog and
   sequence positions, read them back after interruption/restart, and compare
   after rollback. Verify both presence and non-overwrite of pre-existing data.
4. Exercise fault injection on disposable data only, including right-before
   and right-after each durable journal/backup/restore effect, source changes,
   incomplete receipts, failed readbacks and concurrent attempts; HOLD whenever
   an effect is unknown. No real PG/Windows input was used in this audit.
5. Separately qualify disposable PG17 and Windows user-profile preservation
   when expressly authorized in a suitable environment. Keep
   `NOT RUN` until independently completed.

**Scope boundary:** no production logic was altered in this audit. The draft
PR should remain unmerged and installation should remain `HOLD`.
