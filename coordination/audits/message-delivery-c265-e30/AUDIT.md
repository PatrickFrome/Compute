# METAENGINE — project-message delivery and ACK source-only audit

**Result:** verified source-only patch; **not** a PostgreSQL/native/installed-host qualification.
**Repository:** `PatrickFrome/Compute`.
**Source provenance:** source transfer `accb28e72c87c059e780efb8e6681886b33e9b4f`, `coordination/source-transfer/c26565e`, then integrated plaintext patch at `d53ccd4135f28206d91d6804cf0626095565e6af`.
**Source archive:** `METAENGINE-e30-github-only-source.zip`, SHA-256 `169f4dc6379605d68d34360c9d28d687b4da3dc856aea6fc1fb27e6bc6d3ba06`.
**Independent source tree (two calculations):** `90fa5633d7926dd71a7303266073e0625325e740`. 4,346 files, 74 with executable mode. `zipfile` extraction preserves Unicode pathnames; vanilla `unzip` on this host mangled non-ASCII filenames, producing a false negative tree. No changes to GitHub source transfer or original release were made.

## Verified producer → pending → reference → ACK trace

| Stage | Production source / concrete function | Identity and durability semantics |
|---|---|---|
| Browser producer | `apps/metaengine-browser/src/autonomous-project-task-runtime.mjs` (`serveToolRequests`, `PROJECT_MESSAGE`, `#message`); `apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/project-continuity-routes.mjs` (`/v1/devos/project/message`) | Existing sender task/claim/generation and `request_id` drive `public.h205f22_project_message_v1`; message stored as project event. Lost HTTP reply is not equivalent to absence of commit. |
| Browser storage | `infra/client-state-runtime/browser-project-messages-v1.sql` | `h205f22_project_message_v1` binds the original project task/claim and recipient and idempotency key; request collisions must fail. |
| Native producer | `infra/client-state-runtime/native-coding-agent-host-tools.mjs` and `supabase/migrations/20261025090000_native_coding_agent_project_tools_v1.sql`, as modified by `infra/client-state-runtime/native-coding-chat-messages-v1.sql` | Separate native run/request replay path; inspected only as source, no real PG run. |
| Pending read | `infra/client-state-runtime/project-message-wake-v1.sql`, `destruktion_meta.project_pending_message_seqs_v1` → `project_task_projection_h205f22` → `AutonomousProjectTaskRuntime.waitForChildren` | Returns only first **16** unacknowledged addressed sequences per task. Page is a wake/read hint, not proof of processing or a complete backlog. |
| History / content | `supabase/migrations/20261010100000_project_continuity_history_v1.sql`, `h205f22_project_history_v1`, Browser `PROJECT_HISTORY` / `/v1/devos/project/history` | Commit-ordered page with `after_seq`, pinned `through_seq`, `next_seq`, `has_more`; explicit `content_seq/content_offset` reads required to recover full text. |
| Delivery reference | `AutonomousProjectTaskRuntime.continueConversation`, `apps/metaengine-browser/src/autonomous-project-journal.mjs` | SQLite intent and physical-turn receipt store delivered request hashes and transcript boundary. Distinct physical sends require bound effect identity; failed/ambiguous sends must HOLD rather than silently retry. |
| ACK | Browser `PROJECT_ACK_MESSAGE` → `/v1/devos/project/message-ack` → `infra/client-state-runtime/project-message-ack-v1.sql`, `project_message_ack_v1` | Recipient-bound ACK event keyed to original message; repeat must return same event. `recipient_acknowledged` means receipt of address, **not** `processing_verified`. Native counterpart uses `native_coding_agent_message_ack_v1`. |

## Reproduced defects and narrow patch

**D1 — duplicate physical continuation due to invisible ninth result.** Original `AutonomousProjectTaskRuntime.continueConversation` rendered only `results.slice(0,8)` into the prompt and delivery references but digested **all** `results` as `effectKey`. A changed ninth item could acquire a different durable turn and trigger a second physical send of identical visible content. Inert regression on untouched source: **FAIL**, `actual=DELIVERED`, `expected=ALREADY_DELIVERED`. Fix: calculate one `visibleResults=results.slice(0,8)` once; use for prompt, durable key, delivery references and unknown-effect tracking. Retest: **PASS**. This preserves the prior journal's ambiguous-outcome hold; it does not grant retry authority.

**D2 — pending notification displaced by full tool-results page.** `DevOsNativeTaskCycle` sent eight tool results and appended a synthetic `project:messages:pending` ninth row, while the downstream runtime rendered only eight. The recipient could miss the notice despite a genuine pending committed event. Fix: reserve a slot for notification when pending sequences exist: seven tool results + one notification; otherwise retain eight slots. Omitted tool result remains pending for later delivery; no status/ACK becomes authority. Inert page regression: **PASS**.

**D3 — old journal key can replay an already-confirmed send across upgrade/restart.** The original durable turn keyed a nine-row result while the physical prompt included eight; merely changing the key to eight rows leaves an existing, confirmed legacy journal entry under the old key. A resumed runtime did not find the new key and acquired another send for identical bytes. Reproduced with a synthetically seeded valid old-key SQLite journal derived from a genuine confirmed predecessor: **FAIL before compatibility fix**, `actual=DELIVERED`, `expected=ALREADY_DELIVERED`. Narrow fix: when the exact prompt SHA and full binding match a confirmed predecessor, and no older pending conversation turn exists, return the confirmed transcript boundary without a new send. Any binding drift or unknown predecessor remains a HOLD, never auto-authority. Final regression: **PASS**.

**No SQL changes, new schedulers, limit on total agents, approvals, budget-policy changes, new authority or new trust roots.** The bounded page size remains eight physical rows per continuation; this is a message-size cap, not a logical-agent cap.

## Tests and limits

- **PASS** archive exact SHA256, both independent Git-tree calculations, all 74 executable bits preserved.
- **FAIL 2 (expected before respective fixes)**: D1 on untouched source and D3 on the first bounded-key patch; both showed a second physical send before correction.
- **PASS 121 / FAIL 0 / SKIP 0** after patch with Node 22.16.0, six focused suites (Browser runtime, cycle, Edge route, native agent host tool, new delivery page and production chain).
- **PASS 121 / FAIL 0 / SKIP 0** independent clean-archive extraction → `git apply --check` → `git apply` → all six focused suites.
- **PASS** `git diff --check` and `node --check` for modified production/test modules.
- **NOT RUN** real PostgreSQL 17/SQL migrations, native Windows process, services, installed application, real provider send or physical external delivery ACK. Integration uses real Browser runtime + Edge route modules and disposable local SQLite journal; **RPC is an inert in-memory fixture**, not genuine DB authority. No real-world claims based on it.
- **NOT RUN** previously declined security checks, local PC/installer/service/network listener, unrelated budget/approval/trust-policy changes.

### Inert chain regressions

1. Browser send persisted, lost HTTP reply; restart runtime/journal; same request returned original message sequence without duplicate. Recipient history full text read; wrong recipient ACK denied; lost ACK reply + restart returned original ACK event and `processing_verified:false`.
2. 18 committed messages, pending snapshot only first 16; history paginated in 5s with pinned `through_seq`, with a 19th event arriving after first page and a restart mid-way. All first 18 read once; after ACK first 16, 17/18/19 reappear as pending in order.
3. Malformed ACK declaring processing verified is rejected; original intent can be safely replayed only with proper readback, without duplicate ACK effect.
4. Valid legacy nine-row-key predecessor with eight visible rows is never re-sent after restart; exactly one confirmed physical turn remains. A stale/unknown predecessor is not accepted as a new-send permit.

## Applying patch

```sh
git apply --check production-delivery-gate.patch
git apply production-delivery-gate.patch
node --test --test-concurrency=1 \
 apps/metaengine-browser/test/autonomous-project-task-runtime.test.mjs \
 apps/metaengine-browser/test/devos-native-task-cycle.test.mjs \
 apps/metaengine-browser/test/project-continuity-routes.test.mjs \
 apps/metaengine-browser/test/project-message-delivery-page.test.mjs \
 apps/metaengine-browser/test/project-message-production-chain.test.mjs \
 infra/client-state-runtime/native-coding-agent-host-tools.test.mjs
```

GitHub delivery: existing **Draft PR #1447** is audit-only, not merged. Because the native source tree is available as an archive rather than as checked-out files on PR's base branch, the full `production-delivery-gate.patch` should be reviewed and applied to the **verified tree `90fa5633…`** separately; do not overlay shared Browser runtime files against a different integration version.
