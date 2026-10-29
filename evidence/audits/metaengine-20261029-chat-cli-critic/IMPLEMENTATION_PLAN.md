# Critical audit implementation plan

Authorized by the owner on 2026-10-29. Starting published source:
2c533edc6ec09d1f84583349f391bece8398e9a1 (same tree as local ab9e5ad5e).
Continue in this worktree. No main merge or installed-machine mutation follows
from a source-only pass. Preserve own PostgreSQL, existing allocator and trust
roots. Do not remove checks to manufacture autonomous progress.

## Stages and acceptance

1. **Suspended task presentation — source verified.** Accept SUSPENDED in the
   native task page decoder and give it an explicit filter, derived from the
   same state mapping. Preserve selection across suspend/resume. Unknown states
   remain refused. Evidence: all UI library tests 92/92, task-surface quarantine
   3/3, TypeScript noEmit passed. No visual installed UI claim.
2. **Rejected-review repair — pending implementation.** Retain rejected evidence;
   verify old writer/critic quiescence and actual dirty tree; create an explicit
   repair lineage through existing custody/lease paths; new independent review
   must bind the repaired subject. Test replay, unknown ACK, process alive,
   changed bytes, foreign project, restart, repeated rejection and acceptance.
3. **Bidirectional addressed messages — pending.** Existing authority only;
   durable delivery identity, recipient read/processed cursor, browser-to-native
   action, and wake through existing suspension reconciliation. Test duplicate,
   stale incarnation, foreign project, concurrent readers and restart. Stored
   is not read; read is not acted upon.
4. **Installed CHAT_LED preparation — pending.** Source-owned protected profile,
   project/worktree and native permit preparation; legitimate Guardian/Owner
   binding. Existing local preparation script remains unread/unintegrated.
   Qualify fresh and interrupted bootstrap, no public renderer authority.
5. **Live chain and recovery — unqualified.** Actual chat -> CLI -> critic ->
   rejection -> repair -> acceptance -> parent resume -> next task. Kill and
   restart each component, lose replies and interrupt provider availability.
6. **Parallel integration — pending qualification.** Conflicting worker edits,
   branch/worktree preservation, integrated test/review, no lost accepted work.
7. **Resource adaptation — pending.** Measured CPU/memory/disk/DB/provider pressure,
   backpressure and fairness. Logical agent count has no arbitrary fixed cap;
   physical concurrency remains constrained by available resources.
8. **Development learning — pending qualification.** Bind coding outcomes to
   evidence-backed experience and existing RSI routing; held-out evaluation,
   regression rejection and rollback. Browser RSI is wired, not classified dead.
9. **Unified operator UI — pending.** Goal/task/process/worktree/review/artifact
   links, causal blockers, task tree, addressed inbox, diff and test results,
   supported recovery actions, consistent language and model observability.
10. **Runtime composition — pending.** Map installed entry and activated wrappers;
    test actual composition, reduce unnecessary coupling, prove reachability
    before deleting purported dead code.
11. **Release — pending.** One source SHA, immutable installer/provenance; fresh
    install and upgrade preserving data; real Windows long-running/chaos tests.

A source test pass does not close live/installer gates. Record exact evidence and
remaining limitations for each stage. Windows VM work remains cancelled.

### Rejected-review visibility prerequisite

The native project UI decoder also discarded the existing bound rejection
projection. It now retains and strictly validates its exact fields and project
identity, with no execution authority. The task screen explains retained custody
and links to the writer/critic history only when that exact row is present on
the confirmed page. Cross-page references remain visible without fake selection.
Forged/malformed rejection responses degrade readback rather than enabling a
retry. All UI library plus task-surface tests:98/98; TypeScript passed. The
actual repair transition remains pending, not disguised as a Retry button.

### Resource admission defect repaired

The execution pool previously read only physical_start_allowed and ignored the
newly observed physical_parallelism after construction. It now applies the
current valid integer budget to new dispatches, retaining the configured upper
budget and all existing jobs/unknown receipts. Zero/malformed budgets hold new
starts; exact same-lease observation still returns retained state. Legacy
boolean-only adapters retain their explicit budget. Regression first reproduced
both ignored capacity and malformed-budget starts; after repair 57 pool/runtime/
lease-executor/resource tests pass. This is not a complete memory/disk/provider
feedback controller and does not add a logical agent-count cap.

### Repair transition dependency discovered

codex-cli-runner.mjs currently requires IMPLEMENTER worktrees to be clean.
Rejected results intentionally retain dirty bytes and HELD custody. Therefore a
new repair task alone cannot work: the authenticated task/job contract must bind
a specific rejected baseline, and both preflight and custody transfer must
validate it. Removing the clean check or using a caller flag is not acceptable.
The current accepted-checkpoint path must remain unable to accept REJECT. A
repair lineage also needs terminal accounting for superseded attempts without
reporting their rejected artifacts as accepted. No such mutation has been added.

### Complete history-message reading implemented

PROJECT_HISTORY previously exposed only a 240-character excerpt of each event,
then advanced the event cursor. Added a bounded content_seq/content_offset read
using the same authenticated history endpoint and one exact committed event.
Chunks preserve complete canonical JSON content, a SHA256 and Unicode-code-point
cursor. Subsequent chunks require the returned digest, preventing mixed reads.
Output is limited before framing; backticks are JSON-escaped. Structured tool
results no longer collapse spaces inside JSON strings. Untrusted content never
becomes authority or an acknowledgement of processing. A >8K text fixture with
Unicode, whitespace, quotes, backslashes and tool fences reconstructs exactly
through the actual tool formatter. Wrong offsets/digests and mixed modes fail.
102 focused runtime/continuation/tool protocol tests passed before aggregate.
This closes truncated reading, not bidirectional delivery, automatic wake or
recipient processing acknowledgements.

### Browser-to-native addressed messages implemented (source)

PROJECT_MESSAGE is now registered in the parser, project toolbelt, prompt,
current-parent runtime, signed Supervisor transport, strict route, fixed DB API
allowlist and fresh/local migration plans. The new RPC uses existing device and
parent claim authentication, existing project peer resolution and event append.
It stores one event per sender/request UUID under task -> project locking.
Repeating the same request returns its stored event; changing text/recipient or
using a foreign/stale parent is refused. The local journal retains unknown ACKs
and reconciles only the same immutable request identity. Content is untrusted;
there is no execution grant, automatic wake or claim of recipient processing.

Real disposable PG17 integration covers both directions, replay, body collision,
foreign recipient, wrong parent claim and Unicode byte budgets. Fresh PG17
schema creation/reapplication passes; two supplemental PG18 WASM tests remain
skipped. Parser -> toolbelt delegation and lost-ACK journal tests pass. Full
aggregate runs are in progress before commit/publication. Live model, recipient
acknowledgement and wake remain open.

Browser message aggregate evidence: full browser run 6,940 total, 6,830 pass,
28 fail, 82 skip; failing test names unchanged from the preceding run (Unix IPC
and graphical Electron limitations). Runtime aggregate 753 total, 723 pass,
1 Unix IPC failure, 29 skip. After final recipient-type checks and prompt wiring,
87 focused parser/toolbelt/project/route tests pass. Native PG17 integration22/22;
fresh schema10/10 executed with2 optional WASM skips. No installer/live claim.
