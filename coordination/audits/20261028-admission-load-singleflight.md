# Admission recovery startup read race

Base: c84daadf0076bfcbc5fc60f095adf4577d868250, local isolated branch.

Two concurrent `load()` calls could both read an old empty journal. After the
first completed and `begin()` persisted a new PREPARED attempt, the delayed
second read replaced the in-memory state with the obsolete empty snapshot.
This lost the pending fence in memory while durable intent remained on disk.

The regression test uses deferred reads, commits a real journal transition,
and then releases the stale reader. It failed before the fix with the current
attempt ID becoming undefined. Startup now shares one in-flight read; failed
reads reject all waiters and permit a subsequent read without enabling effects.

Validation: isolated Node tests for admission durability, admission recovery,
and interrupted setup recovery: 45 passed, 0 failed, 0 skipped. This is Linux
source evidence, not installed Windows client or physical PostgreSQL evidence.
Windows source qualification is ongoing separately. No versions, installed
profiles, admission authority, or main branch changed. Publication pending.
