# Roadmap Execution Protocol

The project is governed by the Supabase roadmap DAG and the Supervisor/Mainline Sealer.

## Per-workstream loop

1. Read current semantic checkpoint and roadmap status.
2. Read the active supervisor directive and work claim.
3. Verify dependency gates and mutation domains.
4. Implement only within the assigned workstream.
5. Run positive tests and fail-closed negative canaries.
6. Perform deep upstream research for semantic steps.
7. Run Supabase security/performance advisors after schema changes.
8. Clearly label `LIVE`, `SYNTHETIC`, `CONTROLLED`, and `HISTORICAL` evidence.
9. Commit work on the assigned branch and open a draft PR.
10. Finish the roadmap claim as `EVIDENCE_READY`.

## Integration loop

1. Analyst/Integrator compares all `EVIDENCE_READY` workstreams against the current head.
2. Check migration order, API/schema compatibility, evidence provenance, tests and CI.
3. Recommend `ACCEPT`, `ACCEPT_WITH_REBASE`, `REQUEST_CHANGES`, `HOLD`, or `REJECT`.
4. Supervisor performs the final cross-audit.
5. Supervisor alone merges accepted work and reserves/seals the next checkpoint.
6. Recompute the roadmap ready-set after independent checkpoint-root verification.

## Hard invariants

- Worker chats never seal mainline checkpoints.
- Synthetic evidence never counts as live evidence.
- A dependency-gated milestone cannot gain runtime authority early.
- Parallel workstreams must not overlap mutation domains without explicit Supervisor coordination.
- `main` is the integration result, not a workspace for direct experimentation.
