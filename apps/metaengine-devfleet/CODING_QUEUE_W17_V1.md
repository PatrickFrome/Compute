# W17 — Source-only coding queue and manual fair admission

Candidate branch: `work/devfleet-w17-queue-20261014`. Base: PR #1239 at `4c867e7d4c2c7b05fa02dff39409747f4124d7a3`. This is source-only; installed DevFleet/Browser/Guardian/own PostgreSQL stay untouched.

## Boundaries

The **existing developer-authenticated local DevFleet RPC** exposes:
- `dev.pipeline.enqueue` — requires `task_id`, distinct `request_id`, `project_id`, `text`, `kind:"SOURCE_CODING"`, `scope:"SOURCE_ONLY"`, `draft_pr_only:true`.
- `dev.pipeline.queue_status` — read-only summary, no prompt text.
- `dev.pipeline.cancel` — cancellation while QUEUED only, keeps identity tombstone.
- `dev.pipeline.admit` — explicit developer call with `max_items:1..4`. It is **not a background scheduler**.

**4 hot slots total**, counting all owned DevFleet tabs plus outstanding unknown creation reservations. The queue stores at most 32 identities and 64,000 prompt characters, each task at most 4,000. No eviction or old request-ID reuse is permitted. When the cap is reached, admission fails closed; retention/compaction must first gain its own independently reviewed proof. Legacy manual tab operations may use larger limits, but do not grant queue capacity.

The pure fair reducer alternates project IDs in deterministic round-robin order, preserving FIFO within a project. Its cursor is durable in the existing private DevFleet operator-state journal. Admission is selected only upon an explicit call, and each reserved task consumes one hot slot. The **existing operator exclusive lock**, durable store, native ChatGPT creation and `#assignLocked` Send preflight are the only effect path. No second scheduler, task database, retry queue, arbitrary command transport or hosted backend was introduced.

A reservation is written **before** WebContents create. A new session is written **before** Send. Any unknown create remains capacity-fenced; restart changes such unproven reservations to `INTERRUPTED_UNKNOWN`, not QUEUED. Missing composer proof gives `READY_NOT_SENT` without Send. Any ambiguous Send stays AMBIGUOUS and never replays. Cancel cannot touch an admitted task. The caller's coding-only flags are **policy inputs, not a cryptographic or semantic guarantee** that a prompt is safe; developer authority must only submit independent test/source changes and Draft PR requests.

## Qualification

Hermetic tests cover deterministic fairness, capacity (4 hot / 32 queued), dedup, collisions, corrupt state, no prompt in read-only response, cancellation fences, unknown native create, unknown Send, process reincarnation, write-ahead save failure and missing native composer. These tests cannot establish that a real ChatGPT task completed or a Windows packaged operator is healthy.

No main merge, install, production PostgreSQL mutation, Browser/Guardian change, DevFleet reinstalls, Supabase or cloud fallback. A separately authorized installed-canary test and independent critic are required before any release.

