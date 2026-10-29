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

### Explicit recipient acknowledgement implemented (source)

Browser PROJECT_ACK_MESSAGE and native MCP agent_ack_message now pass through
existing current-parent / current-Job authorization to a private shared helper.
Only a committed message with a trusted producer source addressed to the exact
recipient task and agent can be acknowledged. The append-only event stream
retains the message and one acknowledgement. Receipt replay does not create
another event. Native ACK intents have immutable receipts and historical
READ_INTENT reconciliation; browser ACK intents use the current local journal.
An acknowledgement is recipient_acknowledged=true, processing_verified=false:
it cannot confer completion, execution or review acceptance.

The additive migration attests old/new native intent trigger bodies and the
precise operation constraint before adding ACK. Private helper grants remain
revoked; public browser RPC is device/current-parent scoped. Actual PG17 tests
cover both directions, wrong recipients, duplicate ACK, immutable receipt,
historical intent readback, denied grants and altered-function rejection.
Fresh schema plus suspension serial/concurrency:28pass/3optionalWASMskip.
Focused parser/stdio/Host/runtime/route tests:128pass. Runtime aggregate:
723pass/1existingUnixIPCfail/29skip. Full browser final:6944total,6834pass,
28samepriorenvironmentfail,82skip. A new prompt-length failure was reproduced
and fixed by shortening protocol wording to1182chars, preserving1200budget.
Automatic message wake remains the next separate stage.

### Message-driven parent wake implemented (source)

A private bounded projection now returns up to16 committed message sequences
addressed to the current task+agent without an authenticated recipient ACK.
Ordinary activity cannot impersonate a message producer. An indexed recipient
lookup avoids scanning unrelated project events. Existing suspension readback
can report READY_FOR_MESSAGE, after owner-stop/generation/rejected-review and
failed-child gates. The existing authenticated restoration, physical transcript
checks, W30 claim-admission trigger and durable resume receipt remain mandatory.
No second scheduler or new model-call authority is introduced.

The existing task cycle includes pending message refs in the continuation and
keeps the parent active until ACK clears them. Notification identity depends on
message sequences, not changing sibling counts; unchanged notifications are not
resent. Already delivered but unacknowledged messages return WAIT_MESSAGE_ACK,
not false completion and not a repeated suspend/resume loop. On ACK the parent
can return to waiting for unfinished children. A rejection/failure still blocks
this message wake path; automatic code repair remains separate and unfinished.

Evidence: actual disposable PG17 message/suspension/concurrency set41pass with
1optionalWASMskip, including resume while child RESULT_READY, exact new claim,
ACK removal from pending projection, owner-stop/failure negatives and forged
producer rejection.123 focused Browser runtime/transport/cycle tests pass.
Final full browser6946total6836pass28unchangedenvironmentfail82skip; runtime
754total723pass1UnixIPCfail30skip (native-PG test separately executed above).
Source244pass. The first migration test caught an accidental CREATE instead of
CREATE OR REPLACE; corrected and repeated installation succeeds. Prior local
review migration accepts only this reviewed successor projection body, with
restoration of the wake layer in the same installer transaction.

These results do not qualify actual installed Windows chat restoration or
provider/model interaction. Next P0 remains safe rejected-result repair and
source-owned installed CHAT_LED preparation, followed by live qualification.

### Independent rejected-pair readback implemented (source prerequisite)

The existing checkpoint verifier now has a separate fixed REJECT verification
entry. ACCEPT remains the only path that creates checkpoint evidence. REJECT
verification authenticates the same protected job/receipt identities, independent
critic subject and two current physical candidate reads, while allowing failed
checks as rejection evidence. It returns repair_authorized=false and creates no
checkpoint. Caller options cannot change the verdict required by either entry.

A fixed private READ_PROJECT_REJECTION operation, bounded IPC selector and
heartbeat-driven readonly observer connect this to actual Browser/Host runtime
composition. The observer never retries work, writes SQL state, releases custody
or grants a repair. It validates freshness, pair/hash binding and false authority
flags; shutdown drains its in-flight read. Public summaries omit private paths
and execution scopes. The existing parent remains blocked after REJECT.

Evidence:27 verifier/Host/observer tests,141 IPC/runtime/project wiring tests,
and4 real PG17 checkpoint/negative/rejected-pair tests passed. Full browser:
6950total6840pass28unchangedenvironmentfail82skip. Runtime aggregate754total,
723pass1existingUnixIPCfail30skip. All OS/image/Git witnesses in PG tests remain
generated; these are not installed Windows proof. The older disposable Host
fixture now configures its already-used loopback TCP connection explicitly,
avoiding a missing default Unix socket directory on Linux.

Windows qualification now requires the actual Host rejected-pair PG test and a
native-only message-wake PG test. Shared suspension fixture was extracted without
removing the supplemental WASM/serial assertions. Native-only lane retains zero
skips. YAML parsing, schema registration checks and UI TypeScript pass.

Automatic repair admission remains unimplemented. REPAIR_TRANSITION_DESIGN.md
records the required clean-root replacement and honest supersession semantics;
none of that document is a runtime grant or a claim of completed repair.

### Rejection-read lifetime and Git cancellation

The private rejection request context now reaches the verifier and the physical
checkpoint reader without replacing its transaction-owned PG reader. Expired or
cancelled requests cannot issue a fresh read or emit a verified rejection.
Native observation and Git proof receive the same AbortSignal. The Git proof
reader waits for its owned child close after an abort/error before rejecting;
pre-cancelled reads spawn nothing and do not alter repository bytes.

Evidence:48 focused cancellation/physical-scope/verifier/transaction/Git tests
pass;4 real PG17 checkpoint tests pass. Final browser6951total6841pass,
28unchangedenvironmentfail82skip; runtime755total724pass1UnixIPCfail30skip.
Windows component qualification also requires the Git abort and pre-dispatch
cancel tests. These changes do not authorize automatic retry or code repair.

### Windows source qualification failure and portable fixture startup

71d0f4e Windows source run40834461374: component268pass/1baseline skip,
nativePG41pass/1fail/0skip. The failed required case is the new native parent
message-wake test. Sanitized artifact12879814238 (SHA256
3253e847ecd30faaf05d5e98ce4f6cbedb3ab36f1d1e4904527cd6cf3c53c4c7)
identifies that case but deliberately omits raw private error text.

Inspection found the ordinary fresh-schema fixture still used POSIX single
quotes in pg_ctl -o for an empty unix_socket_directories setting. The existing
canonical startup helper and its Windows-argument regression already demonstrate
that those quotes become a literal nonempty Windows value. The archive path
used the correct helper, but the ordinary path did not. Both now use the same
Windows-safe helper; the assertion/gate remains required.40 startup/contract
regressions and the real native parent-wake PG case pass locally. Windows CI
must confirm whether this fixes the observed failure; no pass is inferred.

### Windows CI applicability and tool-path coverage

The PR path filters did not cover the newly added message/ACK/wake SQL files,
the native-only wake test, its shared fixture, or the ordinary fresh-schema
factory. They also matched only the task-cycle wrapper, not its core. Added
narrow relevant paths and a registration regression, preserving unrelated-path
exclusion. Parser/toolbelt tests now run in the Windows component lane. Native
wake/rejection/cancellation requirements and zero native skips remain enforced.
The exact component list passes locally:300total299pass1expectedbaseline skip.
YAML and both registration regressions pass. Windows execution remains required.
