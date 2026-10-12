# METAENGINE DevFleet — parallel roadmap dispatch packet (2026-10-13)

This is a **prepared**, not dispatched, packet. Only an authenticated **installed** DevFleet RPC may prove that a Chat message was sent. GitHub writes and the presence of browser tabs are not send receipts.

## Global binding for all seven GPT-6 High Chat workers

Repository: `PatrickFrome/Compute`.
Roadmap: `coordination/operator-control/ROADMAP_UNIFIED_COMMAND_CONTINUITY_V1.md`.
Truth baseline: draft PR #1191 `fff5c2147d83445457f47e9e3503e2bab0161292`.
Operator DevFleet baseline: draft PR #1197 `83c05417a21598cd06f4e67b6136f8d1b6a6817c`.
Independent cloud-fallback slice: draft PR #1198 `31a3aea3656daa3b19165a5aa8da5919f2597d67`.

**Mandatory:** Only normal Chat (not Work), user attests each new tab uses GPT-6 High. Immediately start source work, no repeated model selection audit. No Supabase (REST, SDK, hosted SQL, Edge, credentials, default fallback); own PostgreSQL only. No shared worktrees, installed Browser/Guardian/DB mutations, main merges, unknown network-result retries or raw shell/SQL/CDP effect surfaces. Each worker claims a disjoint set of modules in its own work branch and opens a **draft** PR; report exact source SHA and changed files. Read connected GitHub current HEAD, branches and PRs before choosing path. Unknown live readback is UNKNOWN, not healthy. Minimal focused tests if essential, no protracted test sweeps. Never grant yourself promotion authority.

**Dispatch contract:** create fresh empty OWNED DevFleet tabs for new tasks; do not resubmit two historical AMBIGUOUS request IDs or overwrite existing drafts. Record exact `request_id`/tab_id/output fingerprint. On ambiguous post-send outcome, stop that slot and reconcile before another send. Assignment in the installed client is not proof that the worker obtained terminal authority or started development.

## W1 — Host / process truth, P0

**Disjoint owner:** Host / Guardian process-incarnation provider and trusted adapter wiring. Start from #1191, review Host code and owner identity. Implement actual trusted Host→`GET /operator/v1/context` wiring with OS PID+creation-time and heartbeat provenance, no request-provided evidence, no raw secrets. Prove lack of owner yields UNKNOWN and PID reuse cannot be AVAILABLE. Do not modify native-supervisor-endpoints, bootstrap, migration SQL, DevFleet or Gateway. Branch `work/roadmap-host-truth-20261013`; draft PR, exact evidence checkpoint.

## W2 — Own PostgreSQL / task truth, P0

**Disjoint owner:** own-DB read-only task / claim / lease / event cursor projection and catalog witness. Start #1191. Add bounded source-backed `fleet` and `continuity` adapter readback only from METAENGINE-owned PostgreSQL with owner/generation freshness. No database schema mutation, no Supervisor endpoint cloud changes, no Host files, no DevFleet. Fail closed on inconsistent lease/owner. Branch `work/roadmap-ownpg-task-truth-20261013`.

## W3 — Operator Gateway, P1

**Disjoint owner:** own authenticated read-only external Gateway interface for `context`, `inspect`, `run_status`, `events`. One canonical run identity and monotonic event cursor, no mutations/admissions until separately qualified. Add a new Gateway module, don't duplicate planner/queue. Reuse existing loopback auth/owner contracts; never expose public listener by default. Avoid files owned by W1, W2, W4–W7. Branch `work/roadmap-gateway-20261013`.

## W4 — Supervisor execution continuity, P2

**Disjoint owner:** recovered boot/restart/lease reconciliation state machine and WAL-like durable checkpoint *contracts*, under existing Supervisor executor. Handle lost acknowledgments, `WAKE_AMBIGUOUS`, duplicate dispatch and incarnation epochs. Side-effect dispatcher remains fenced without real own-DB evidence. Do not operate real Guardian or PostgreSQL. Branch `work/roadmap-continuity-20261013`.

## W5 — Fleet coordination, P3

**Disjoint owner:** pure bounded DAG/dependency task scheduling and agent role assignment under *existing* leased executor (no second planner runtime). Design dispatch-claims for implementer/researcher/critic and token/resource slot budget. A GPT chat is not a durable agent; DB owns tasks. No DevFleet app edits, no real task sends, no live DB migration. Branch `work/roadmap-fleet-20261013`.

## W6 — Causal Observatory / unified workspace, P4

**Disjoint owner:** read-only UI projections for Now/Missions/Fleet/Brain/Develop/System/Evidence from identical `context` snapshot + cursor deltas. Make UNKNOWN and stale/AMBIGUOUS visible, never fake ACTIVE from healthy HTTP. Avoid scheduler, database, browser bootstrap and release code. Branch `work/roadmap-observatory-20261013`.

## W7 — Independent CRITIC + self-improvement evaluation, P5

**Disjoint owner:** audit #1191/#1197/#1198 source risks and create hermetic evaluator/falsification artifacts, candidate-vs-baseline latency/quality benchmark, promotion safety. Do not edit files claimed by other workers; submit findings and minimal independent tests in separate critic branch. Specifically check #1198 legacy cloud health sentinel/fallback-console startup; candidate is untested and must not deploy. Branch `work/roadmap-critic-20261013`.

## Coordinator execution cycle

1. Read actual DevFleet operator-state request ledger, exclude all AMBIGUOUS identities and blocked cells. User confirmed model, so do not spend time re-probing GPT-6 High.
2. Allocate up to seven new owned Chat tabs, one per disjoint role; only dispatch to verified CHAT/send-ready empty composer. Use stable new request IDs for each distinct prompt, no duplicate sends.
3. Send first wave concurrently within service's own bounded controls, capture native receipts (`PROVEN_SENT` vs `AMBIGUOUS`); do not fabricate statuses from UI.
4. Poll digests / fresh AX on changed cells, extract branch/SHA/evidence; feed only resulting *verified* readbacks into canonical roadmap and next task wave.
5. Repeat while resources permit. Keep existing installed native Browser/Guardian/own PostgreSQL untouched until signed release, own DB backup and physical Owner evidence.

## Actual dispatch proof (write only after native readback)

As of creation: **DISPATCH_NOT_PROVEN**. No new agents launched merely by committing this packet.
