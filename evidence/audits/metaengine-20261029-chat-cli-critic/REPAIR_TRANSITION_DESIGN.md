# Rejected-result repair: implemented source transition

Status: source implemented and registered in the reviewed local migration path;
installed Windows/live provider qualification remains pending. No installed
profiles, databases, worktrees or executables were modified by this stage.

## Why not replay or reuse the dirty tree

The runner requires a clean IMPLEMENTER worktree. Rejected bytes and the old
writer/critic receipts are retained under HELD custody. Clearing HELD, marking
REJECT accepted, or replaying the old run would invalidate those guarantees.

Prefer an independently authorized spare IMPLEMENTER/CRITIC pair on a different
managed root at the same reviewed base SHA. Existing native preflight still
proves clean root, identity, current device/Owner, sandbox and process control.
The new task restates the original bounded objective with rejected-result and
critic references. It does not pretend the old dirty tree became clean, reuse
the old run or import unverified files. Original rejected data remains retained.

## Required complete transition, before enabling

1. Authenticate current project/device/control and lock the exact rejected pair.
   Verify the existing registered writer/critic subject binding and immutable
   receipt digests. Restrict first implementation to CHAT_LED child tasks.
2. Select an existing valid unused native pair for this same goal/project/Owner,
   with a distinct physical root and matching source base. No new trust root,
   generic path or permit is minted by model output. If absent, retain durable
   capacity wait, not a failed/replayed task or an unbounded spawn loop.
3. Admit one replacement through existing W30 enqueue, keyed by rejected pair,
   and persist immutable repair lineage. Duplicate/concurrent reconciliation
   must return that same replacement. All changes commit atomically.
4. Represent replaced attempts honestly (a distinct superseded terminal state
   or equally explicit canonical resolution). Their REJECT receipts never count
   as accepted checkpoints. All consumers must agree, not only a UI overlay.
5. Parent failure/wait/completion must follow the replacement chain. A chain is
   resolved only by an independently accepted, committed replacement. Require
   increasing task sequence / same-project constraints to prevent cycles.
6. New rejection can transfer again to another eligible clean pair; resource
   exhaustion waits. Original worktrees remain retained until separate verified
   archival/cleanup. Logical unboundedness is not infinite physical capacity.
7. Do not release old roots, recycle permits or modify installed profiles in
   this admission slice. Those require their own physical quiescence proof.

## Acceptance matrix

Positive: REJECT -> one clean replacement -> independent ACCEPT -> actual
checkpoint/commit -> parent continuation, using the existing allocator.
Negative: ACCEPT/foreign/stale/revoked pair, changed receipt, same root through
alias, mismatched base/goal/Owner, busy permit, stopped control, invalid child
lineage, spoofed SUPERSEDED state, failed replacement, concurrent admission,
commit-before-ACK loss, restart, and capacity recovery. Old bytes/receipts must
remain unchanged. Source SQL fixtures do not substitute for installed Windows
process, filesystem and live model tests.

## Implemented canonical resolution

No new fleet state was introduced. Rejected writer/critic rows remain
RESULT_READY, receipts remain REJECT, and dirty worktree fences remain HELD.
The immutable repair table and strictly bound task_spec.native_repair record
connect the rejected pair to a sibling replacement at the same reviewed base.
Original objective, constraints and deliverable are preserved in full. A
specific independent critic permit is selected and pinned; actual critic
admission must use that permit, not another merely eligible provider.

The replacement uses existing W30 enqueue and project reconciliation. A separate
repair_obligation projection is null, PENDING or RESOLVED; only a transitive
accepted checkpoint plus committed replacement resolves the old obligation.
Project snapshot, task projection, parent completion, suspension readiness and
browser autonomous task accounting all consume this same resolution. The old
native completion function still refuses the rejected original. Historical
resolution remains valid when the project becomes terminal. Delegated old pairs
are excluded from the bounded admission sweep, avoiding starvation after more
than four rejected pairs.

The new SQL migration runs after project-message-wake. Predecessor/current
function definitions, metadata, table shape, foreign keys, RLS and immutable
trigger are attested; unknown drift is refused. The previous review/wake sources
recognize the exact repair definitions so normal installer reapplication can
restore intermediate definitions and then reapply repair in one transaction.
No API EXECUTE or table write authority is added.

## Source verification and remaining boundaries

Real disposable PostgreSQL 17 exercises five consecutive rejected pairs and a
sixth accepted/committed replacement, duplicate/concurrent reconciliation,
immutable and forged/foreign/cyclic edges, busy lowest critic selection,
owner-stop/paused/revoked-profile/no-critic gates, failed replacement blocking,
transaction rollback after enqueue, terminal-project history, suspension
WAITING_CHILDREN -> READY_TO_RESUME, migration reapply and drift refusal.
These are assertions inside one lifecycle subtest, not separate installed runs.
The test suite also covers existing initial-goal authority and W30 boundaries.

The fixture uses generated OS/job/Git receipt witnesses. It does not run Codex,
perform a physical Git commit, launch a browser, verify Windows ACLs, restore a
live suspended conversation or prove installed perpetual autonomy. Physical
root preparation and fresh native preflight remain mandatory before execution.
The source tests do not prove correctness under arbitrary filesystem/host death,
or manufacture more eligible clean roots when the protected pool is exhausted.
See REPAIR_TRANSITION_VERIFICATION.md for exact commands, counts and logs.
