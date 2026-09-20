# RSI R13 Durable Graduation Witness Research — 2026-09-20

## Question

Can Phase37A treat an in-memory-compatible statistical confirmation as sufficient evidence for a later
EXPLORATION_ACTIVE -> ACTIVE review after process restart?

No. The acceptance path needs a restart-stable witness that proves the exact statistical confirmation is
present in the durable recursive-risk history and still belongs to the same source, risk budget, candidate,
holdout and evaluator roots. The witness itself must remain zero-authority and must not become a second
statistical ledger or effect executor.

## External evidence

### Statistical Gödel Machine (SGM)

Wu et al., *SGM: A Statistical Godel Machine for Risk-Controlled Recursive Self-Modification*
(arXiv:2510.10232) allocates a global error budget across recursive modifications and introduces
confirmation-triggered spending. The important systems implication is that confirmation-event ordering is
part of the safety state: restart must not silently recreate an early confirmation index or a larger early
allocation.

Source: https://arxiv.org/abs/2510.10232

### SQLite durability as a future storage experiment

SQLite documents that WAL mode with `synchronous=FULL` performs an additional WAL sync after each
transaction commit and is ACID across power loss under the VFS durability contract. WAL with
`synchronous=NORMAL` remains consistent but can lose recent committed transactions after power loss.
SQLite also documents that WAL is a same-host design and that the WAL file is part of persistent database
state.

Sources:
- https://www.sqlite.org/pragma.html
- https://www.sqlite.org/wal.html
- https://www.sqlite.org/atomiccommit.html

This supports a benchmark experiment for a future lifecycle journal, but not an immediate migration.
Changing storage while Phase37 acceptance semantics are still being closed would combine two independent
risk surfaces.

### Filesystem durability limits

SQLite's locking/durability documentation explicitly fsyncs the containing directory when journal
directory metadata matters and notes that software ultimately depends on the operating system and hardware
honoring sync requests. Therefore a successful high-level write API is not itself sufficient evidence of
durability after an ambiguous post-rename failure.

Source: https://www.sqlite.org/lockingv3.html

## R13 design decision

Keep the current crash-aware JSON durable-state primitive for this slice and add an exact, zero-effect
durable confirmation witness:

1. Verify the full durable recursive-risk ledger state by replay through the existing
   `RsiRecursiveRiskLedger`.
2. Locate the exact confirmation row by `confirmation_digest`.
3. Re-verify its external statistical certificate against the existing risk budget, index, candidate,
   tournament/paired manifest, holdout and evaluator root.
4. Bind the witness to:
   - source SHA;
   - risk-budget digest;
   - durable-ledger state digest;
   - exact row digest;
   - confirmation and certificate digests;
   - confirmation index;
   - candidate id/SHA and parent SHA;
   - paired/tournament manifest;
   - holdout/evaluator roots;
   - allocated and cumulative alpha;
   - external durable-readback owner.
5. Phase37A must reject any statistical receipt whose in-memory confirmation does not match the durable
   witness exactly.
6. The durable-readback owner must be distinct from certificate owner, process verifier, outcome verifier,
   statistical acceptor, future effect executor and lineage reviewers.
7. No hold is removed and no ACTIVE transition is performed in R13.

## Deliberately deferred

- SQLite migration: EXPERIMENT, not ADOPT_NOW.
- Phase37B one-attempt ACTIVE effect: blocked until exact-head R13 qualification and restart readback.
- Any automatic retry after ambiguous persistence: rejected.
- Any candidate-authored durable witness: rejected.
- Any second statistical authority or duplicated risk budget: rejected.
