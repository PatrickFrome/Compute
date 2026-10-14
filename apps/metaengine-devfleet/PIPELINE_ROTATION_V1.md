# DevFleet Mass Lane Rotation V1 — living implementation note

Source: standalone DevFleet operator on existing authenticated developer RPC. No new scheduler, production METAENGINE Browser/Guardian/own PostgreSQL effect, or Supabase/cloud fallback.

**Goal:** throughput-oriented developer coding waves. Unknown delivery on a retired chat does not consume a live slot indefinitely.

### Hot methods
- `dev.pipeline.rotate` accepts `request_id`, `tab_id`, `replacement_request_id`, `text` and `acknowledge_unknown_delivery:true`.
- `dev.pipeline.rotate_batch` accepts `rotations` (1–4 distinct owned tabs, request IDs, replacement IDs; total prompt length <=32,000). Each lane is independently fenced; the existing operator's single authority lock serializes physical effects.
- A rotation durably records the old tab and unresolved request IDs before native close. Once close is proven, the old slot is freed, and a new tab receives a different request ID. A new task is sent only after the new composer passes the existing native preflight.
- A closed old tab's historical receipt stays `AMBIGUOUS` and its delivery verdict remains `UNKNOWN`. An old request ID remains idempotent even after the tab is gone.
- If close, creation, storage or composer proof fails, the rotation reports its state. It does not repeat an unknown Send. After a process restart, a `RETIRING` tab is not restored; old receipts and rotation lineage remain durable.

### Operational throughput and boundaries
The workload can repeat **coding-only** tasks as alternative implementations on distinct work branches and Draft PRs. Two agents may produce competing work; the evaluator must choose a result. The same policy must **not** be applied to deployment, merging, payments, releases, production database writes or other irreversible outcomes.

A batch is limited to four swaps, reflecting the measured 8 GB Windows host's resource pressure. The current ledger remains bounded to 500 entries (a follow-up journal compaction/segmentation task); this implementation is not an indefinitely self-running scheduler. A connected operator must invoke the next wave. A new chat is not considered ready merely because its URL loaded.

### Evidence gates
Focused hermetic rotation tests cover safe re-home, identity collisions, durability failure, unknown native close, unready composer, repeat submission and independent batch lanes. No claim that ChatGPT accepted the new task is made until exact native readback proves a user turn.

### Cold-slot load shedding (second implementation slice)
- `dev.pipeline.retire` and `dev.pipeline.retire_batch` are owner-authorized bounded operations (max 4 per batch) under the **existing** exclusive operator. They physically close selected unhealthy owned WebContents and release capacity **without** immediately creating new memory-heavy tabs.
- Every retirement has a new operation ID and retains all old `AMBIGUOUS` assign receipts and their UNKNOWN delivery status. Old request identities stay replay-fenced even after their tabs are gone.
- Durable `RETIRING`, `RETIRE_UNKNOWN`, and `RETIRED` stages survive restarts. An interrupted retirement is fenced, not replayed. A failed lane does not prevent unrelated retirements.
- The intended 8 GB-host policy is a **small hot pool (3–4 ChatGPT WebContents)** with queued independent coding tasks and replacement waves. Slot retirement alone does not implement an autonomous scheduler; it supplies the safe native primitive.
- Regression tests cover retire + reboot, capacity readback, unknown native close, one-failure/one-success batch, and write-ahead durability. Production Browser, Guardian and PostgreSQL remain untouched.
