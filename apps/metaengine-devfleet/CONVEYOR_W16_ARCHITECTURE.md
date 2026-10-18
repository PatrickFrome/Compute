# METAENGINE DevFleet — Mass Conveyor W16

Source scope: `apps/metaengine-devfleet`. Base `02d4c8bcca129e16014330c8961f173e9b3bdf23`; new isolated branch `work/devfleet-conveyor-rebuild-20261018`.

## Behavior

- One existing authenticated `DevFleetOperator` remains the sole authority for native ChatGPT `WebContentsView` creation, input, Send and durable request receipts.
- The owner starts or stops `DevFleetConveyor`. New tasks are loaded in batches, stored durably, and dispatched automatically through the existing queue; the stream can be replenished while running.
- No fixed *total* task limit (previous 32), request-history ceiling (previous 500), or 512-snapshot journal cap. Storage/OS limits can still fail closed. For long-lived operation, segmented journal compaction remains desirable; historic unknown receipts must never be silently discarded.
- The concurrency window is auto-sized from available local RAM (1 GiB reserve, 350 MiB estimate per new ChatGPT renderer), or explicitly set by the owner. There is no hardcoded count of 10 or 16 slots. Physical memory is finite.
- `READY_NOT_SENT` may be retried after a compositor-readiness failure, without another request identity. A committed `AMBIGUOUS` or `SENT` request is never submitted again. A tab is not declared working merely because its WebContents exists.
- Existing task fairness remains project-based. Task IDs and signed source/Draft PR constraints belong to the operator admission contract.

## Native composer repair

`composerDomText()` still validates the exact CDP backend node. When `DOM.describeNode` provides incomplete nested ProseMirror children, the same `backendNodeId` is recovered through native CDP `DOM.getOuterHTML` and parsed locally by pinned `parse5@8.0.0`; no page JavaScript or selector guessed from page content. Rich-text markup outside the narrow element allowlist is rejected. Exact text is read back before the single native Enter.

## Control plane

Local first-party UI: Conveyor text input; separate tasks with a line containing `---`, optional hot-slot target, *send stream*, *stop*, live QUEUED/READY_NOT_SENT/SENT/AMBIGUOUS/occupied counters. Untrusted ChatGPT text never becomes command authority.

Authenticated developer routes: `dev.pipeline.enqueue_batch`, `dev.pipeline.conveyor_start`, `dev.pipeline.conveyor_stop`, `dev.pipeline.conveyor_status`. Same native app and existing private developer RPC; no hosted fallback or additional service.

## Acceptance / outstanding physical evidence

- Source contracts: previous full suite 151/151 passed before the new controller unit test; targeted controller fake-admission test 1/1 passed.
- **Not equivalent to verified ChatGPT delivery**. A real QA `SENT` receipt requires current installed Electron UI plus a confirmed native user-message readback in the exact ChatGPT conversation. A failed readback remains UNKNOWN; future delivery reports must not invent a rate.
- Package identity: `0.1.0-dev.16.20261018.1`, non-production QA candidate; Authenticode depends on actual signing custody. Do not replace installed Browser/Guardian/Owner/PostgreSQL during DevFleet QA.
- Follow-up: independent Windows QA login/session, real multi-slot send proof, journal segment archiving for long-term storage efficiency, GitHub Draft PR integration.

Research: Electron `WebContentsView` and `webContents.debugger` official APIs; persistent partition is shared among views and background throttling is scoped to WebContents.

## W16.2 — restore-resume repair

Observed on Windows v16.1: an explicit conveyor START sent while the original DevFleetOperator was still restoring its ten saved ChatGPT WebContents left `enabled=true` but zero attempts; synchronous `queueStatus()` failed with `operator_restoring` even inside the pump's finalizer. V16.2 catches this transient error, schedules a bounded retry, and triggers `resume()` from the existing `operator.whenRestored()` completion path. This does not authorize a new request identity and never retries a committed AMBIGUOUS send.

Exact source test suite: 153 tests, 153 PASS, including new transient RESTORING controller test. New disposable QA package identity: `0.1.0-dev.16.20261018.2`; final Windows physical SEND remains a separate acceptance gate.

## W16.3 — durable receipt reconciliation and blocked restore

A previously recorded `SENT` or `AMBIGUOUS` request can survive a crash before its corresponding queue item is marked final. The conveyor now reads the request's durable ledger state and updates only the queue item, never issuing another native Send for that request. `resolveCodingTask` is idempotent after matching an existing authoritative receipt. Queued tasks tied to `RESTORE_BLOCKED` tabs are not attempted until legitimate restoration; the first-party status UI exposes `RESTORE_BLOCKED` count. No new scheduler, trust root, or authority paths were added.

Exact local full source suite: 155/155 PASS (includes ledger SENT re-sync and RESTORE_BLOCKED negatives). QA package identity `0.1.0-dev.16.20261018.3`. Physical ChatGPT delivery proof remains independent from source fixture proof.
