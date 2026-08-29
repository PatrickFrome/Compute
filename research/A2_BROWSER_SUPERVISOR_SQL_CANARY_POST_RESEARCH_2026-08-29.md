# A2 Browser Supervisor Control-Plane SQL Canary — Post-Implementation Research

Date: 2026-08-29
Sealed slice: `A2_BROWSER_SUPERVISOR_SQL_CANARY_V1` (+ concurrency race extension)
Heads: `bbcc8c00088d9b7d0f0ff10356944405b2afd66f` (core canary, CI run 33233631002) and the race-probe extension commit on the same branch
Pre-research: `research/A2_BROWSER_SUPERVISOR_SQL_CANARY_PRE_RESEARCH_2026-08-29.md`

## Outcome

The pre-research decision (option D: shell SQL canary following the
chat-bridge receipt precedent) proved out end-to-end. All nine supervisor
migrations applied cleanly, in filename order, to an empty PostgreSQL 17
given only the Supabase-shaped bootstrap — the first time the full chain was
ever executed outside production (I1 confirmed). The at-most-once semantics
behaved exactly as designed in #192/#197, and the canary is now the
executable contract for them, extended with genuine multi-session race
probes.

## What real execution changed in the architecture understanding

1. **jsonb NULL operator semantics.** `->` applied to a JSON null value
   returns the jsonb scalar `null`, not SQL NULL; only a further `->>`
   returns SQL NULL. The first draft of the null-command assertions used
   `(v_r->'command') is not null`, which is true for JSON null — the local
   PostgreSQL 17 run caught it before any push. The corrected
   `->>'command_id'`-nested pattern is now encoded in the canary itself.
2. **Operator associativity.** `x->>'k' || '|' || x->>'k2'` does not parse as
   intended: `->>` and `||` share precedence and left-associate, so the last
   `->>` receives the whole text concatenation as its left operand
   (`operator does not exist: text ->> unknown`). All racer SQL now
   parenthesizes each extraction explicitly.
3. **Actual lane topology (corrected mental model).** The v4 budget-guard
   migration (20260827140612) REPLACED `lease_v3` with the guarded version
   (including `set search_path to ''` hardening). The real topology locked by
   the canary: `enqueue_v1/v2/v3` all issue (v1 legacy non-idempotent, v2/v3
   idempotent with typed key validation); `lease_v2` routes to
   `lease_control_v4`; `lease_v3` is the budget-guarded, mode-gated lane;
   `lease_control_v4` is the normal CONTROL lane and never serves
   `SET_SUPERVISOR_MODE`; `lease_bootstrap_v3` serves mode/ARM/DISARM with
   DISARM-first priority; `complete_v4` is the atomic terminal and the only
   observed `authority_effect` writer. The #197-era model of "lease_v2 as
   the lease" is obsolete.
4. **Replay readback is current-state, not issue-state.** An exact replay of
   an enqueue after the command completed returns `status=COMPLETED` and
   `authority_effect=true` (v3), with `replayed=true` and the original
   command id. This is the documented v3 semantic (authority recorded at
   completion), now executable.

## Concurrency race results (Phase G extension)

Three genuine multi-session races against the real PostgreSQL 17 server,
asserted deterministically for every legal interleaving:

- **Race A — concurrent idempotent issuance.** 20 concurrent sessions
  enqueue the same idempotency key. Result (3/3 stable local runs + CI):
  exactly one fresh insert (`replayed=false`), 19 replay readbacks, all 20
  return the same command id, exactly one physical row. This exercises the
  ON CONFLICT speculative-insert wait under READ COMMITTED — the core
  at-most-once issuance property that sequential tests cannot touch.
- **Race B — contended lease election.** 10 concurrent distinct clients
  lease one broadcast command: exactly one winner, the row leased exactly
  once with a single `leased_by` (FOR UPDATE SKIP LOCKED).
- **Race C — parallel drain.** 10 pending commands drained by 10 concurrent
  clients: every client leases exactly one command, all command ids
  distinct, no command leased twice, ten distinct lease holders.

Race A's command is targeted at an isolated client id so that it remains
PENDING (never leasable by the race B/C clients) — the first local run
caught the interaction where race B's winner legitimately leased race A's
still-pending broadcast command, which is correct queue semantics but would
have made the race assertions ambiguous.

## Pre-research assumptions: confirmed, rejected, strengthened

- Confirmed: pattern transfer 1:1 from the chat-bridge canary; migration
  hygiene on empty PG17; all designed semantics hold.
- Corrected (not rejected): the two jsonb/operator parsing lessons above;
  the lane topology update.
- Strengthened: the forward-inclusive migration glob plus the pull_request
  trigger means every future supervisor migration automatically joins the
  applied chain and inherits the contract at zero marginal cost.

## Remaining weaknesses

- The race probes sample interleavings rather than exhausting them; the
  assertions hold for every legal interleaving by contract (index
  uniqueness, speculative-insert wait, SKIP LOCKED), so this is a sampling
  limitation, not a semantic gap.
- `lease_v1` is not functionally exercised (only `enqueue_v1` is); the v1
  lease lane is declared legacy and superseded by the v2 route.
- The canary proves PostgreSQL 17 behavior, not that production Supabase
  has the migrations applied — deployment ordering (OBS-V63-3: DDL ->
  canary -> edge -> manifest -> bundle) remains an operator decision point.
- Clock-semantics probes use deterministic backdating, not real waits.

## Next hardening step (max gain per unit complexity)

On this rail: the #194 enforcement stack's zero-cost database layer — a
per-client monotonic sequence + nonce fence (reusing the audited
device-identity nonce pattern) BEFORE any chat-issued SET_MODE/ARM goes
live through the edge. The canary pattern established here would extend
naturally to that migration. Alternatively GPT may adopt this branch into
the operator line; the files are disjoint from every active rail.
