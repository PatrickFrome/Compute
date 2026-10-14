# DevFleet configurable hot-slot target V1

The user-selected number of simultaneously usable coding chats is a **durable owner configuration**, not a hard-coded fleet size. The initial target of four preserves the previous legacy profile default; it is **not** a maximum. An authenticated local developer can call `dev.pipeline.configure` with `{"hot_slots":5}` (or another positive safe integer). `dev.pipeline.queue_status` and `chat.list` then report the same persisted target.

- Slot admission is controlled by the existing exclusive DevFleet operator; there is no timer, second scheduler, automatic resubmission or ChatGPT-page authority.
- `dev.pipeline.admit` admits up to the available configured capacity and the existing per-command contract budget (e.g. `max_batch_items:8`). **Per-command budgets are not total hot-slot limits.** Additional independent waves can expand the concurrent fleet when configured capacity and actual host resources permit.
- A lower target does not close existing sessions, erase ambiguous receipts, or send duplicate tasks. It only prevents further admission until occupancy falls below the new target.
- The native WebContents adapter no longer has a separate fixed 16-tab ceiling; Electron/OS resource allocation can still fail, and those failures preserve the existing source-backed `CREATION_UNKNOWN` / fail-closed receipts.
- The journal retains `hot_slots_target` across restart; old journals without that field are read with the previous default of four.
- No production METAENGINE Browser/Guardian/PostgreSQL, Supabase, hosted fallback, installed package mutation or main merge is part of this source-only change.

Verification: five-slot one-owner admission, restart persistence, independent source-only coding, 24-slot configurable value, lowering the target below occupancy, queue fairness beyond four, and old four-slot legacy compatibility. Physical five-ChatGPT qualification is required before claiming all five agent runs are active.
