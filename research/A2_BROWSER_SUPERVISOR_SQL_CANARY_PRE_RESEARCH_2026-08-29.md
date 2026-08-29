# A2 Browser Supervisor Control-Plane SQL Canary — Pre-Implementation Research

Date: 2026-08-29
Parent verified: R8B `bd4b3c029fc4531d355ca181a0897d50e68268b3` (CI run 33233110209, all steps success)
Milestone: `A2_BROWSER_SUPERVISOR_SQL_CANARY_V1` / closes the evidence gap first recorded as OBS-V63-1 in mailbox #197

## Problem

The A2 Browser Supervisor control plane is implemented as nine SQL migrations
(20260827043107 v1 control plane through 20260827141000 v4 atomic result).
These functions are the at-most-once backbone for chat-issued supervisor
commands: idempotent issuance, terminal stale-lease reaping, bootstrap-lane
reservation of `SET_SUPERVISOR_MODE`, a weighted action budget with failure
circuit, and atomic completion that is the only authority-effect writer.

None of this SQL layer has a persisted executable test. Every existing
supervisor test is a JavaScript behavior lab against a mocked `fetch`; grep of
the tree finds zero live-database references to `enqueue_v2`/`lease_v2`/
`lease_control_v4`/`complete_v4`. The same gap was identified for the v2
migration alone in mailbox #197 (OBS-V63-1, HIGH); since then the surface grew
by the v3 authority/bootstrap lanes and the full v4 control-lease/budget/
privacy/atomic-result chain, none of which were independently verified at the
SQL layer. Documentation and design reviews (#192, #197) are not runtime
proof. A regression in `ON CONFLICT` semantics, `is distinct from` NULL
handling, `FOR UPDATE SKIP LOCKED` behavior, or privilege revocation would
ship silently.

## Existing project precedents

The repository already solved exactly this problem once for the chat-bridge
receipt transport: `tests/chat_bridge_receipt_sql_canary.sh` plus
`.github/workflows/chat-bridge-receipt-sql-canary.yml` apply the migration to
an ephemeral PostgreSQL 17 and assert positive, negative, and adversarial
behavior through `do $$` blocks that raise `canary_*` exceptions. That canary
is the reason the bridge receipt contract stayed honest. The supervisor
control plane — a larger and more authority-sensitive surface — never received
the same treatment.

## Primary-source comparison

### Supabase migration semantics

Supabase applies `supabase/migrations/*.sql` in filename (timestamp) order on
a database where `anon`, `authenticated`, and `service_role` roles and the
`extensions` schema exist. The canary must reproduce exactly this shape so the
proof transfers: migrations applied in order to an empty PostgreSQL 17 after
role/schema bootstrap.

Source: https://supabase.com/docs/guides/deploy/database-migrations

### PostgreSQL ON CONFLICT with partial unique indexes

The idempotency design relies on `INSERT ... ON CONFLICT (workspace_id,
idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING`:
the speculative insert that loses the race returns no row, so a NULL returned
command id means a replay. Under READ COMMITTED this get-or-create is
race-free (PostgreSQL docs, concurrency-control chapter, ON CONFLICT
section). The canary proves the sequential replay and conflicting-replay
identity properties; the concurrent case is covered by the index contract
itself.

Source: https://www.postgresql.org/docs/current/sql-insert.html (ON CONFLICT)
Source: https://www.postgresql.org/docs/current/mvcc.html (11.6. caveats)

### PostgreSQL NULL semantics and jsonb

The replay-conflict check uses `is distinct from` because NULL-safe
comparison is required (`platform`/`target_client_id` are nullable). jsonb
operators have their own NULL semantics that bit the first version of this
canary locally: `->` on a JSON null value returns the jsonb scalar `null`,
not SQL NULL, while a nested `->>` returns SQL NULL. Assertions must use the
nested form; this is now encoded in the canary itself.

Source: https://www.postgresql.org/docs/current/functions-json.html

### Queue-lane separation (best relevant analogues)

SQS visibility-timeout redelivery exists precisely because queue workers may
die with work outstanding. The supervisor control plane deliberately deviates:
a stale lease is terminal (`lease_timeout_no_retry`, no requeue) because a
leased supervisor command may have crossed an irreversible physical boundary
in the browser before the ack was lost. This is the at-most-once choice for
physical actuation and was anchored in #192/#197 against Stripe's terminal
intent states. The canary locks this in as an executable contract: a reaped
lease can never be re-leased.

Source: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html

## Options

### A. pgTAP test suite

Mature xUnit-style SQL testing, but it requires the pgTAP extension in CI and
adds a dependency the repository has never used. Supply-chain and parity cost
with no benefit over the established shell-canary pattern.

### B. JavaScript integration lab against an ephemeral PostgreSQL

Would reuse the lab harness, but the labs already exist for transport-level
behavior and they mock the database. What is missing is SQL-native proof of
SQL-native semantics (constraints, ON CONFLICT, RLS, grants, functions).
Adding a JS indirection layer over psql would test the JS client as much as
the SQL layer and duplicate the shell canary's job with more moving parts.

### C. Static SQL validation only (sqlglot)

Cheap and fast, but it proves syntax, not behavior. ON CONFLICT interaction
with a partial unique index, NULL-safe comparisons, SKIP LOCKED selection,
check-constraint enforcement, and privilege revocation are runtime semantics.
#192 already used sqlglot as a pre-flight; it cannot close an evidence gap.

### D. Shell SQL canary following the chat-bridge receipt precedent (chosen)

`tests/a2_browser_supervisor_sql_canary.sh` + a dedicated workflow: postgres:17
service container, full migration chain applied in order, then six assertion
phases. Zero new dependencies, repo-native, directly executable in CI, and it
doubles as migration-hygiene proof (I1 below): every supervisor migration must
apply cleanly to an empty PostgreSQL 17 with only the Supabase-shaped
bootstrap.

## Decision

Implement option D on branch `work/a2-browser-supervisor-sql-canary-v1`,
parented on the sealed R8B head `bd4b3c0` (newest proven-green tree carrying
the complete supervisor line). The canary asserts, per phase:

- **A — enqueue idempotency (v2/v3):** fresh issue shape; exact replay returns
  the same command_id with `replayed=true`; conflicting payload and conflicting
  action replays raise `supervisor_idempotency_conflict`; invalid action,
  invalid platform, short/bad-charset/NULL idempotency keys raise their typed
  errors; v2 rollback-compat lane preserves replay identity; v1 documented as
  non-idempotent (the regression reason v2 exists).
- **B — lease lanes and terminal reap:** the CONTROL lane never serves
  `SET_SUPERVISOR_MODE` (bootstrap reservation) but does serve DISARM; the
  bootstrap lane serves the reserved mode command and prioritizes DISARM over
  an older ARM; target-client isolation; OFF-mode clients only lease
  mode-changing commands; a stale lease is reaped terminal
  (`lease_timeout_no_retry`) and never requeued; a stale PENDING command
  expires before lease; the v2 route still leases.
- **C — weighted budget and failure circuit:** six cost-4 leases exhaust the
  24-point/60s budget and the seventh is FAILED with
  `supervisor_action_budget_exceeded`; zero-cost POLL still passes; five
  failed completions open the failure circuit
  (`supervisor_failure_circuit_open`); DISARM bypasses the open circuit.
- **D — atomic completion:** success carries receipt and authority_effect;
  enqueue replay after completion reports CURRENT state; double completion is
  rejected without mutating the terminal row; non-owner completion is rejected
  and the lease survives; expired-lease completion reports EXPIRED without
  mutating the row; failed completion records the error and clears the
  receipt; unknown command and invalid identity raise typed errors.
- **E — schema invariants:** RLS enabled on both tables; partial unique
  idempotency index present; v3 widened action allowlist; v3-dropped
  no-authority constraints absent; service_role holds EXECUTE on all seven
  lane functions while anon/authenticated hold none; table grants match.
- **F — live privilege probes:** a real `set role service_role` call
  executes; anon RPC execution and anon table reads are denied.

## Authority model

The canary asserts `authority_effect=false` at issue time and that
`complete_v4` is the only observed writer of `authority_effect=true`, matching
the v3 semantic change (authority is a recorded post-completion effect, not a
table invariant). The canary never claims supervisor commands are authority by
themselves; it proves the transport records what happened.

## Rejected shortcuts

- Not testing the v1/v2 legacy lanes: they are declared rollback-compat
  surfaces; a silent break there would strand deployed clients. Both lanes
  are exercised (A10, B4b).
- Skipping the bootstrap-lane reservation test: `SET_SUPERVISOR_MODE`
  escaping into the normal CONTROL lane is the single most
  authority-sensitive regression this layer could have.
- Testing only enqueue/lease without completion: `complete_v4` is where
  receipt discipline and authority recording live; at-most-once without
  honest completion proof is half a contract.

## New invariants

- **I1 (migration hygiene):** every `*a2_browser_supervisor*` migration
  applies cleanly, in filename order, to an empty PostgreSQL 17 given only
  the Supabase-shaped bootstrap (roles, extensions schema, pgcrypto). No
  hidden platform dependencies. The canary's migration glob is
  forward-inclusive: new supervisor migrations join the chain automatically.
- **I2 (idempotency):** exact replay returns the original command identity;
  any semantic-field conflict on replay raises
  `supervisor_idempotency_conflict`.
- **I3 (at-most-once):** a reaped lease is terminal
  (`lease_timeout_no_retry`) and can never be leased again; a stale PENDING
  command expires before lease.
- **I4 (lane reservation):** `SET_SUPERVISOR_MODE` is leasable only via the
  bootstrap lane, which also prioritizes DISARM.
- **I5 (budget/circuit):** the 24-point/60s weighted budget and 5-failure/60s
  circuit block non-emergency commands by marking them FAILED; DISARM and
  `SET_SUPERVISOR_MODE(OFF)` always bypass.
- **I6 (atomic completion):** only a current, unexpired, self-owned lease can
  complete; all other completions are rejected without row mutation;
  `complete_v4` is the only authority-effect writer observed.
- **I7 (privilege boundary):** RLS stays enabled; service_role-only EXECUTE
  on all lane functions; anon/authenticated denied at both function and table
  level — proven by live probes, not catalog claims alone.

## Non-claims

- The canary does not prove concurrent racer behavior beyond what the partial
  unique index contract guarantees; true multi-session racing of
  `FOR UPDATE SKIP LOCKED` is CI-hostile and the index semantics are
  documented upstream behavior.
- The canary does not deploy anything to the live Supabase project, does not
  exercise the edge functions, and does not validate that production has the
  migrations applied (that is the operator's deployment-ordering decision
  point, unchanged).
- The v3/v4 remote-authority edge-function surfaces (bearer transport, device
  identity, enforcement stack from #194/#197) are out of scope for this
  SQL-layer slice.
