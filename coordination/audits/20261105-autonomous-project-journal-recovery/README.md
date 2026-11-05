# METAENGINE — source-only audit: dialogue restoration from project journal checkpoints

Status: **PARTIAL / EVIDENCE-ONLY** (2026-11-05). This pull request does **not** claim a qualified runtime correction or implementation audit of the target snapshot.

## Authoritative source identity and transport failure

Repository: `PatrickFrome/Compute`. **Only** the user's specified source-transfer chain is authoritative for potential production fixes.

1. c265 transfer commit: [`accb28e72c87c059e780efb8e6681886b33e9b4f`](https://github.com/PatrickFrome/Compute/commit/accb28e72c87c059e780efb8e6681886b33e9b4f), branch `work/source-transfer-c26565e-20261103`.
2. Transfer directory: `coordination/source-transfer/c26565e/`. Its `README.txt` reports c265 source revision `c26565e58ab92dcbcda9663c4d231bdf4a9a7ee6`, source tree `2dbe253e97379532f6f4b52ef7edf26109a9266d`, and concatenated archive SHA256 `4200e492828dbb857aaa737a7ce56d0aeda3c97c84f7743b1501ef2f229d3636`.
3. Follow-on patch commit: [`d53ccd4135f28206d91d6804cf0626095565e6af`](https://github.com/PatrickFrome/Compute/commit/d53ccd4135f28206d91d6804cf0626095565e6af), branch `work/integrated-e30-source-patch-20261103`, path `coordination/source-transfer/c26565e/integrated-c265-to-e30.patch`. GitHub blob SHA `79d40bf024a6553656b86fb1a29c1313dd458a0e`, size 1,269,917 bytes, 138 file diff sections.
4. **Requested reconstructed target tree**: `90fa5633d7926dd71a7303266073e0625325e740` — **NOT VERIFIED** in this executor. This SHA identifies an expected *reconstructed source tree*, not the GitHub transfer commit's own tree.

GitHub file metadata confirms three binary archive pieces of sizes 7,200,000, 7,200,000, and 1,657,953 bytes, respectively. The GitHub connector's text fetch rejects binary blobs (`UnicodeDecodeError` / `only accepts UTF-8 text`), while `fetch_file` yielded no usable byte content for the parts. The isolated container has no reachable GitHub DNS/network. Do not substitute the older public branch, the prior wave15 ZIP, or a different local candidate for the specified c265 → e30 reconstructed tree. No byte-level archive SHA, `git apply`, or target tree verification was possible here.

The integrated patch's 138 `diff --git` paths contain **no** `autonomous-project-journal.mjs` section. This does *not* establish the journal's actual contents or those of its consumers within the inaccessible archive.

## Recovery transition table (proposed contract, NOT source-verified)

| Prior condition | Observation/input | Allowed recovery transition | Must **not** infer/do | Test ID |
| --- | --- | --- | --- | --- |
| ABSENT | complete checkpoint durably persisted | `CHECKPOINT_PRESENT` (context only) | Treat checkpoint as an effect permit | all target tests |
| CHECKPOINT_PRESENT | transport send attempted, no durable ACK | `DELIVERY_UNKNOWN` | Mark delivered or silently re-send as a fresh effect | target-4, target-8 |
| DELIVERY_UNKNOWN | exact ACK with durable identity/cursor | `DELIVERY_CONFIRMED` | Infer ACK from a local write or optimistic callback | target-1 |
| DELIVERY_CONFIRMED | process restarts | `DELIVERY_CONFIRMED` if ACK replay validates | Duplicate/renumber delivery | target-1 |
| REPLY_PENDING | reply generation started, missing terminal proof | `REPLY_PENDING` / `INCOMPLETE` | Re-label as completed | target-2 |
| REPLY_PENDING | complete reply + durable completion proof | `REPLY_COMPLETED` | Auto-issue side effects | target-2 |
| VALID_PREFIX | last frame/line truncated | `VALID_PREFIX` + `TAIL_INCOMPLETE`, or `HOLD` | Invent missing ACK/reply | target-3, target-4 |
| LEGACY_PARTIAL | incomplete older journal | `DEGRADED` / `HOLD`, inspect only | Backfill completion/delivery | target-5 |
| EFFECT_UNKNOWN | ambiguous external effect outcome | `EFFECT_UNKNOWN` | Auto-retry, mint new effect identity, debit/refill | target-6, target-8 |
| STABLE_LOG | ENOSPC midway through an append | `WRITE_FAILED`/`UNKNOWN` + preserve prior durable prefix | Claim new checkpoint/ACK committed | target-7 |
| WRITE_FAILED | process restarts | `DEGRADED`/`HOLD` until exact readback | Discard previous confirmed evidence or replay commands | target-7 |
| ANY | restart with mismatched identity/cursor/root | `HOLD` pending original-authority reconciliation | Restore authority from JSON/ACK/boolean alone | target adapter TBD |

The table states required **invariants** for future source verification; it is not an assertion about the current code. A confirmed delivery requires its real durable receipt/ACK evidence, not a journal line alone. An incomplete tail may preserve a validated prefix only if the real format/checksums/ordering support that operation.

## Targeted audit not yet possible

On the exact verified reconstructed snapshot, inspect `apps/metaengine-browser/src/autonomous-project-journal.mjs` plus every static import, dynamic import, persisted cursor reader, provider-transcript consumer, UI history adapter, restart/bootstrap restoration path and any migration/legacy parser. Trace: writer → durability boundary → delivery ACK → reply completion → project-history consumer → restart replay → effect gate. For every `await`, test whether generation, source identity and cursor/lease fencing remain current. Record file paths, function names and line ranges from that snapshot; do not infer from old GitHub code.

### Test mechanics

- `fixture-tools.mjs` implements exclusively local temporary-file truncation and synthetic partial ENOSPC; it never opens real project data, services, listeners or databases.
- `fixture-tools.test.mjs` executes seven *fixture helper* checks. These only validate the injection tools, **not** the journal.
- `journal-recovery-target.contract.test.mjs` specifies eight target-facing cases and requires an adapter to the verified reconstructed tree. Without one, they are deliberately SKIP/NOT RUN. No fake production witness or synthetic PASS is claimed.
- Any future adapter must export `createInertJournalHarness({root,onExternalEffect})`. It must seed via genuine journal APIs into the supplied temporary `root`, implement `seed(name)`, `inspectStorage()`, `restartAndInspect()`, `injectAppendFault({code,partialBytes})`, `appendCheckpoint(id)`, and optionally `close()`. `restartAndInspect()` normalizes `newEffectAuthority`, `recoveryStatus`, `confirmedDeliveryIds`, `completedReplyIds`, `pendingReplyIds`, `unknownEffectIds`, `durableCheckpointIds`. The injected `onExternalEffect` function records and throws on any attempted external effect. A sealed adapter should prevent any production root/DB/network connection.
- Before enabling the adapter, independently verify the combined archive SHA, extract into an isolated directory, apply the integrated patch, run `git rev-parse HEAD^{tree}` or equivalent and confirm exact `90fa5633d7926dd71a7303266073e0625325e740`. Set `METAENGINE_JOURNAL_VERIFIED_TREE` to that exact value only after the check. Do not run target tests otherwise.

### Execution evidence

```sh
node --test fixture-tools.test.mjs journal-recovery-target.contract.test.mjs
```

Fixture helpers: **7 PASS, 0 FAIL**. Target journal contracts: **0 PASS, 0 FAIL, 8 SKIP / NOT RUN**. Production fix: **NOT APPLIED** (no reproduced journal defect on authorized source). Actual truncation/recovery semantics, legacy parsing, delivery ACK and consumers: **NOT VERIFIED**. PostgreSQL/Windows/installed-client/security reviews: **NOT RUN**.

## Strict negative scope

No refill, debit, quota, spending or policy changes. No checkpoint-derived authority to issue a new effect. No installer, local PC, real DB/PG, guardian/Owner service, listeners, credentials, signing, model/API calls or Supabase. No changes to runtime, Main, preload, seals, version, or source archive. No merge. This branch is **only** an inert test harness plus transparent audit handoff.
