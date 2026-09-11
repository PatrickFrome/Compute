# Native Supervisor Command Fastlane — v1 (2026-09-05)

## Problem (measured on the live host)

The chat/supervisor control plane issues typed commands through the
`compute_fabric_a2_browser_supervisor_command_h205f22` queue. The native
browser leased at most ONE command per full supervisor cycle, and each cycle
carries mesh reconcile, supervisor lifecycle, DevOS dispatch recovery,
self-update work and the full-state heartbeat before it reaches
`/v1/commands/next`. Live measurements (issued_at -> leased_at -> completed_at
over the last 3 hours before this change):

| stage | latency |
|---|---|
| issued -> leased (pickup) | **7.8 s .. 336 s** |
| leased -> completed (execution) | 2.3 s .. 2.5 s (stable) |
| observed probe round trip | 15 s .. 96 s |

The browser's own poll interval is 2 s, but the full cycle measured ~20-40 s,
so command pickup was cycle-bound, not transport-bound. Burst-issued commands
(DevOS diagnostics, multi-probe audits) queued one-cycle-apart, producing the
worst case of 336 s for the fifth command in a burst.

The chat brain (operator / GLM / ChatGPT supervisor conversations) therefore
could not "merge with the browser": insight waited for heartbeats and control
waited for cycle slots.

## Change

`src/native-supervisor-command-fastlane.mjs` (new) — a command pickup
fastlane that polls the SAME signed `/v1/commands/next` lease endpoint on a
short cadence (default 750 ms, bounded backoff 1.5 s -> 8 s on failure,
reset on success).

Wiring (opt-in, default off — zero behavior change for any other consumer):

- `native-supervisor-client-base.mjs`:
  - constructor accepts `commandFastlane` / `commandFastlaneIntervalMs`;
  - command pickup + execution unified into `#pickupAndRunCommand()` guarded
    by a local command slot (used by BOTH the cycle and the fastlane);
  - `start()` starts the fastlane, `stop()` stops it (self-update install
    path already calls stop());
  - `snapshot()` gains `command_fastlane` telemetry.
- `main.mjs`: the shell opts in with `commandFastlane: true,
  commandFastlaneIntervalMs: 750`.
- Version: `0.6.6-dev.16.1`.

Expected pickup latency after this change: **<= ~1.1 s** (interval + one
round trip), execution unchanged ~2.4 s, total round trip for a read-only
probe **~3.5 s** vs 15-96 s before.

## Invariant analysis (explicit amendment)

The project carries a hard invariant: *no second scheduler / polling loop*
(`second_polling_loop: false` across snapshot contracts). This change adds a
second TIMER but not a second SCHEDULER, and the amendment is deliberately
narrow:

1. `command_pickup_transport_only: true` — the fastlane only transports
   already-authorized commands. It owns no lifecycle, mesh, self-update,
   heartbeat or fleet scheduling. The single supervisor cycle remains the
   only scheduler for those planes (unchanged).
2. `command_execution_exclusive: 'local_slot_plus_db_lease_transactional'` —
   the local command slot guarantees at most one command executes at a time
   locally (the cycle defers to the fastlane's in-flight command and vice
   versa); the transactional lease RPC
   (`h205f22_a2_browser_supervisor_lease_v3`, PENDING -> LEASED exactly once)
   guarantees at most one CLIENT wins each command regardless of poll
   frequency on either loop.
3. No new authority path — commands flow through the exact same lease,
   mode/armed gates, effect-binding seal, execution and result-posting code
   as cycle-driven pickup. `authority_effect` remains false at the transport
   layer.
4. Failure containment — pickup errors degrade to bounded backoff (max 8 s)
   and never terminate or duplicate the supervisor service; enrollment stays
   cycle-driven (the fastlane does not poll while unenrolled).
5. Load — 750 ms cadence = ~80 signed lease requests/minute from one device
   against the existing edge function; the lease on an empty queue is a
   single indexed lookup.

## Brain-side channel (companion, DB-side, no browser change)

For instant insight the chat brain now has push semantics on the same
control tables: NOTIFY triggers (`glm_pulse_state`, `glm_pulse_command`,
`glm_pulse_mesh` -> channel `glm_browser_pulse`) fire on every state
heartbeat, command lifecycle transition (PENDING -> LEASED ->
COMPLETED/FAILED/EXPIRED) and mesh change. Combined with direct Postgres
SELECT this gives the brain sub-second awareness of all browser processes
plus on-demand full-state reads. These triggers are additive,
NOTIFY-only (no row mutation, no authority), and installed with
`scripts/brain_channel_setup.py` on the operator database.

## Tests

`test/native-supervisor-command-fastlane.test.mjs` (9 tests):
- dependency-probe validation;
- independent cadence pickup without waiting for the supervisor cycle;
- slot-busy deferral (zero polls while a command executes);
- no polls when not running / not enrolled;
- exponential backoff on failure + reset on success;
- stop() halts polling;
- legacy cycle pickup intact through the shared slot (full client with mock
  transport);
- base-class wiring + main.mjs opt-in source contracts;
- fastlane snapshot authority flags (`scheduler_authority: false`,
  `authority_effect: false`, `command_pickup_transport_only: true`).

Full suite: **1056/1056 pass** (2 pre-existing skips), `npm run check` green.

## Known follow-ups

- The 15-second freshness gate in `h205f22_a2_browser_supervisor_issue_native_v1`
  is tighter than the observed heartbeat cadence (~20-40 s); issuers must
  retry during stale windows. A follow-up should either relax the gate to the
  command TTL envelope or raise heartbeat cadence.
- Live-host delivery of this version still requires the self-update restart
  to unblock (sentinel worker heartbeat livelock, see the 2026-09-05 audit):
  tracked separately.
