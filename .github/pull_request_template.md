## Roadmap binding

- Canonical Level-1 milestone: <!-- R1 / C1..C17 / F1+ / CROSS-CUTTING for analysis-only PRs -->
- Level-2 milestone: <!-- e.g. W1_PERSISTENT_LINUX_WORKER_SAFETY -->
- Canonical acceptance criterion advanced:
- Why this moves the project toward real compute rather than control-plane-only complexity:

## Workstream

- Supervisor baseline checkpoint:
- Assigned branch:
- Base semantic checkpoint:

## Evidence

- [ ] Positive tests pass
- [ ] Fail-closed/adversarial negative canaries pass
- [ ] LIVE / SYNTHETIC / CONTROL_PLANE_ONLY / SCHEMA_ONLY / HISTORICAL evidence is clearly labeled
- [ ] Deep amplifier research completed for the semantic step
- [ ] Amplifier candidates are classified ADOPT_NOW / EXPERIMENT / DEFER / REJECT
- [ ] Supabase security advisor reviewed after DDL changes
- [ ] Supabase performance advisor reviewed after DDL changes
- [ ] No unapproved mutation-domain overlap
- [ ] Dependency gates satisfied
- [ ] Level-2 work remains subordinate to `docs/CANONICAL_ROADMAP.md`

## Integration

- Migrations/DDL:
- API/schema changes:
- Tests/canaries:
- Research sources / amplifier findings:
- Risks / unresolved questions:
- Rollback or fail-closed behavior:

Worker PRs must remain draft until the workstream is `EVIDENCE_READY`. Only the Supervisor may approve mainline integration and semantic checkpoint sealing. A Level-1 roadmap change requires a separate explicit architecture amendment; it must never be smuggled through an implementation PR.
