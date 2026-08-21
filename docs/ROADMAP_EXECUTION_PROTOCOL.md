# Roadmap Execution Protocol

The project is governed by two linked roadmap layers:

1. `docs/CANONICAL_ROADMAP.md` — the stable **Level-1 architectural north star**: `R1`, `C1…C17`, `F1+`.
2. Supabase `compute-fabric-roadmap-v1` — the mutable **Level-2 execution DAG** containing implementation gates/submilestones.

The Level-2 DAG is subordinate to Level-1. It may refine dependencies and acceptance gates, but it must not silently redefine, renumber or replace the canonical Level-1 roadmap.

## Mandatory roadmap reconciliation

Before every meaningful semantic step, the workstream must record:

- Canonical Level-1 milestone: `R1`, `C1…C17`, or `F1+`;
- Current Level-2 milestone/claim;
- Which canonical acceptance criterion the step advances;
- Whether the step moves the project closer to real compute or merely adds control-plane complexity.

If a Level-2 assignment cannot be mapped unambiguously to Level-1, stop at `EVIDENCE_READY` and request Supervisor reconciliation.

## Per-workstream loop

1. Read current semantic checkpoint and roadmap status.
2. Read `docs/CANONICAL_ROADMAP.md` and identify the owning Level-1 milestone.
3. Read the active supervisor directive and work claim.
4. Verify dependency gates, mutation domains and the Level-1 ↔ Level-2 mapping.
5. Implement only within the assigned workstream.
6. Run positive tests and fail-closed negative canaries.
7. Perform deep upstream/amplifier research for semantic steps.
8. Run Supabase security/performance advisors after schema changes.
9. Clearly label `LIVE`, `SYNTHETIC`, `CONTROL_PLANE_ONLY`, `SCHEMA_ONLY`, and `HISTORICAL` evidence.
10. Commit work on the assigned branch and open a draft PR.
11. Finish the Level-2 roadmap claim as `EVIDENCE_READY`.
12. State explicitly which Level-1 acceptance criterion is now evidence-ready.

## Integration loop

1. Analyst/Integrator compares all `EVIDENCE_READY` workstreams against both the current semantic head and `docs/CANONICAL_ROADMAP.md`.
2. Check migration order, API/schema compatibility, evidence provenance, tests, CI and roadmap drift.
3. Reject work that advances Level-2 mechanics while moving away from the Level-1 critical path without an explicit Supervisor-approved reason.
4. Recommend `ACCEPT`, `ACCEPT_WITH_REBASE`, `REQUEST_CHANGES`, `HOLD`, or `REJECT`.
5. Supervisor performs the final cross-audit.
6. Supervisor alone merges accepted work and reserves/seals the next checkpoint.
7. Independently verify checkpoint root/ledger.
8. Recompute both the Level-2 ready-set and the current Level-1 progress state.

## Canonical near-term priority

The project must not substitute scheduler/control-plane abstractions for the real execution spine:

`R1 → C1 First Real Linux Worker → C2 First Serial Coding Loop → C3 safe acceleration`

C1 requires a real admitted Linux worker. C2 requires a real repo → edit → build/test → verified artifact loop. Schema/control-plane readiness alone does not satisfy either milestone.

## Hard invariants

- Worker chats never seal mainline checkpoints.
- Synthetic evidence never counts as live evidence.
- A dependency-gated milestone cannot gain runtime authority early.
- Parallel workstreams must not overlap mutation domains without explicit Supervisor coordination.
- `main` is the integration result, not a workspace for direct experimentation.
- Every PR must name both its canonical Level-1 milestone and its Level-2 milestone.
- Amplifier research may alter implementation choices but may not silently alter the Level-1 roadmap.
- A Level-1 roadmap amendment requires explicit architectural review, a versioned GitHub change and the matching Supabase canonical-roadmap update.
