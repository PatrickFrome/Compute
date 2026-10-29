# Rejected-result repair: proposed next source stage

Status: DESIGN, not an implemented or enabled repair operation.

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

## Open implementation decisions

The fleet task constraint, native transition guard, project completion guard,
reconciliation, snapshots, suspension projection and UI state decoder must be
updated together. Do not ship a new state recognized only by some of them.
Current code still reports rejection as a blocker. This document grants no
execution capability and must not be described as working automatic repair.
