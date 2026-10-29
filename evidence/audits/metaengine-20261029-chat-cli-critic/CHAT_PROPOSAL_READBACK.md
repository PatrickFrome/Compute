# Chat child proposal and admission readback

The browser accepted up to 12,000 UTF-16 units while authoritative PostgreSQL
accepts at most 4,000 characters after trimming ASCII spaces. Oversized proposals
could be persisted as pending intents even though SQL cannot admit them. The
client now applies the SQL character-count boundary before journal creation,
including supplementary Unicode characters without truncating the proposal.

Admission receipts also accepted duplicate child task IDs, the parent as its own
child, incorrect depth, inconsistent waiting/task fields, and admitted rows with
wait reasons. These are now rejected without resolving the durable intent.
A capacity/budget-wait response no longer advertises task_admission_proven=true.
No lease or execution is inferred from proposal persistence.

Evidence: two length regressions and six receipt regressions reproduced before
repair. The project runtime and managed project tests pass 73/73 afterward.
These are deterministic provider/SQLite tests, not a live model or installed
Windows qualification. Existing SQL and authenticated authority are unchanged.
