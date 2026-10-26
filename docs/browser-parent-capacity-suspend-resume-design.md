# Browser parent capacity: quiet waiting and durable suspension

## Status

A production-wired **READ_ONLY parent suspension slice** now extends the existing
W30/Project continuity path. The earlier quiet-wait regression remains as the
fallback when no suspension transport is bound. No logical agent-count/depth
ceiling or second scheduler is introduced. Physical resource admission remains
finite and separate from the durable task graph.

### Implemented contract

1. The existing task cycle first handles failed children, UNKNOWN turns and
   pending tools. After a confirmed continuation, unchanged waiting parents may
   request suspension through the private Host runtime (not a model tool).
2. SQLite preserves the exact continuation floor and complete delivered-result
   identities. Generic tool issuance has a per-request write-ahead custody
   record before the network effect. Restart harvests an acknowledged command
   ID or retains UNKNOWN without reissuing. Delivering an UNAVAILABLE display
   result does not resolve effect custody. Legacy incomplete histories or
   pending/UNKNOWN effects retain the claim.
3. The exact parent view must have no draft/generation/retry state. A private
   physical-mutation gate plus renderer freeze protects two matching full
   transcript observations. The fleet durably records `SUSPENDING` before SQL.
4. Device-signed ADMIN project routes call
   `h205f22_project_suspend_browser_v1`. SQL verifies current Owner generation,
   project/device grant, exact claim, original transport proof, READ_ONLY class,
   no workspace custody, and unfinished nonfailed children. It atomically saves
   the checkpoint, closes the old claim and marks the task `SUSPENDED`, never
   `COMPLETED`. Only the exact committed receipt permits destruction of the old
   view. Registry removal alone is not proof of physical destruction.
5. Lost acknowledgements use `suspension-read` and immutable checkpoint bindings;
   they never repeat Send or substitute another checkpoint. The existing
   heartbeat pages `suspension-list`, not a new polling scheduler.
6. Completed dependencies permit restoration of the original conversation URL,
   transcript digest/floor and original Agent-surface provenance. The local
   view remains frozen `RESUMING`; signed telemetry may publish its exact ACTIVE
   transport proof **with an exclusive task/checkpoint reservation**. The
   ordinary allocator skips it, and an additional claim guard refuses unrelated
   tasks. A durable SQL suspended-agent hold also rejects stale ACTIVE heartbeat
   allocation before the new physical census arrives. The original W30 admission trigger remains enabled.
7. `h205f22_project_resume_browser_v1` requires that signed reservation and exact
   restoration. It creates a new claim/generation and records transport proof
   without sending the original prompt again. Only confirmed receipt/readback
   activates the local view. SQLite restores delivered-result identities and
   the transcript floor into the new generation.
8. To unwind a single physical slot, an exact completed READ_ONLY child may
   retire its view only after current authenticated project-task readback proves
   matching physical binding, `RESULT_READY`/`COMPLETED`, zero ACTIVE claims and
   zero workspace bindings, with no pending local effects. The idempotent
   `h205f22_project_release_browser_child_v1` transition then reserves that exact
   physical incarnation against concurrent claim admission and returns an
   immutable retirement certificate. Shared agent transaction locks serialize
   claim admission with suspension and retirement; a snapshot alone never
   authorizes destruction. Lost certificate ACKs retain a durable local intent
   and reconcile the exact idempotent transition before any close. Unknown completion
   is not idle capacity. Interrupted physical destruction remains durably
   `COMPLETED_RELEASING` and is reconciled by the same heartbeat.

### Evidence and remaining boundaries

- `test/browser-parent-suspension-cycle.test.mjs` composes the real task cycle,
  project runtime, SQLite journal, fleet and private transport with deterministic
  database/browser edges: one-slot parent → child → grandchild, journal restart,
  leaf ACK and original-conversation unwind, no replayed Send.
- `test/browser-parent-suspension*.test.mjs` cover lost suspension/resume ACKs,
  stale transcript, pending effects, admission reservation and physical-close
  proof. Edge route tests verify injected identity and strict readback bindings.
- `infra/client-state-runtime/browser-parent-suspension.sql.test.mjs` executes
  the full canonical baseline/runtime stack and the new migration in disposable
  PGlite, including original admission triggers, claim isolation, rollback,
  Owner stop, stale epochs and custody readbacks. This is **not native PG17
  concurrency qualification or installed Electron/ChatGPT proof**.
- MUTATING parents remain refused: retained worktree custody needs an independent
  exact-path/head transfer and restored-binding verification. No writable
  worktree is released by this patch.
- A missing physical view after uncertain `RESUMING` remains fenced. The client
  does not fabricate another physical generation or replay the task. Full
  transcript truncation/drift, expired restoration evidence, Owner generation
  change and absent durable delivery history also retain explicit fences.
- Main-process renderer freeze/AX transcript stability and exact destruction
  must be qualified on the installed Windows/Electron platform. The original
  root/Agent proof is preserved, not re-created by navigating to a root page.

The remaining design sections below describe the broader custody/recovery
acceptance target; they are not a claim that the MUTATING slice is implemented.

## Reproduced boundary

The production task cycle, production Edge lease-selection route, project
runtime and SQLite conversation journal are composed in
`apps/metaengine-browser/test/devos-native-task-cycle.test.mjs` under the test
“one browser worker waiting for a READY child retains its claim across cycles
and journal restart.” Database readbacks, physical resource denial and browser
responses are deterministic fixtures; no model or installed-client effect is
performed.

With one observed worker, the parent retains its ACTIVE W30 claim while its
child remains READY. Subsequent cycles and a restarted project journal still
produce `WAIT_CHILDREN`, without a child lease. Exposing a second worker to the
same route admits the child, demonstrating the capacity dependency rather than
a disabled lease mock.

`fairIdleLeaseCandidates` in
`apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/devos-routes.mjs`
correctly excludes agents with active claims. The fallback `WAIT_CHILDREN` return in `src/devos-native-task-cycle-core.mjs`
retains that claim when suspension is unavailable or fenced.
Reusing the tab without a new authority transition would violate the existing
task/agent/target/generation binding.

Native execution is different. `src/native-coding-execution-pool.mjs` retains
RUNNING jobs and unacknowledged result receipts. Exact W30 RESULT_READY
acknowledgement frees the slot; a project may still have descendants afterwards.
The native regression explicitly proves that WAIT_CHILDREN cannot substitute
for that acknowledgement. Pending-ACK and unknown slots must not be discarded.

## Implemented bounded improvement

After `latestTurnForLease` reports a durable CONFIRMED conversation turn with a
valid transcript floor, the cycle returns WAIT_CHILDREN without another Send
when children are still pending and there are no new project-tool results.
Changing only unfinished sibling/proposal status cannot restart generation.

The first acknowledgement is preserved. New tool results still use the existing
continuation path. Failed children reach BLOCKED first. AMBIGUOUS journal turns
remain fenced before tool processing. Terminal children trigger the existing
journaled continuation exactly once for the same result frontier. Missing model
result claims remain BLOCKED; they are never manufactured to release capacity.

## Missing authoritative suspend/resume contract

A safe implementation needs the following inseparable pieces, rather than a
local pool deletion or an additional task-state string.

### Durable checkpoint

Introduce a source-reviewed project suspension record with:

- stable suspension request/effect ID, canonical body and digest;
- project/root/parent task ID, current claim ID and lease generation;
- owner/admin/control generation and workspace identity;
- logical agent ID, current physical tab/target/generation binding;
- exact original conversation URL and hash, transcript floor plus a digest of
  the host-observed boundary, last confirmed continuation intent/receipt digest;
- delivered tool request IDs and immutable result digests, not only the current
  in-memory `#projectDeliveredTools` set;
- awaited child/proposal identities and authoritative dependency frontier;
- worktree reservation identity, base/HEAD/checkpoint digest and custody state;
- transition sequence/state, timestamps and reconciliation evidence references.

Variable-size content must use validated, durable references and bounded pages,
not truncation that loses resume state. Model text cannot supply binding
identities or attest that its own effects completed.

### SQL transitions inside existing W30 ownership

1. **PREPARED:** validate current owner/control epoch, exact live parent claim,
   authoritative unfinished dependencies and complete checkpoint. No capacity
   is released by preparation alone.
2. **SUSPENDED:** atomically fence/close the exact old claim and persist a
   nonterminal suspended parent with its checkpoint. This is neither COMPLETED
   nor RESULT_READY. A duplicate request with the same canonical body reads the
   original result; a changed body is rejected. An unknown write acknowledgement
   permits only exact readback, not a second suspension.
3. **RESUME_ELIGIBLE:** existing project reconciliation determines readiness from
   committed dependency state. Failed/blocked/unknown children keep the existing
   blocking behavior; owner stop prevents resume admission.
4. **RESUMING:** the existing scheduler issues a fenced new lease generation for
   that same logical parent. The old generation cannot submit tools/results or
   reacquire a worktree. A physical binding is prepared without replaying the
   original task dispatch.
5. **RESUMED:** only verified restored conversation/checkpoint readback completes
   reattachment. Failed/unknown restoration is retained as a fenced attempt;
   another lease/Send is not inferred safe from elapsed time.

Each transition must be generation-CAS and idempotency-key bound. Crash recovery
reconciles committed states, not optimistic caches. Do not reopen admission,
clear owner stop, or silently convert lease expiry into resumability.

### Physical browser handoff

Before suspension, prove the parent is quiescent: no generation, no unconfirmed
Send, no pending/unknown tool effect and a persisted continuation boundary.
An UNKNOWN effect cannot be made safe by closing its tab.

After confirmed SUSPENDED readback, a host-owned hibernation operation may release
the physical view while retaining the logical agent and exact conversation
identity. Confirm destruction/retention through actual target census; lost close
ACK requires observation, not blind repeat. Children receive their own logical
identity and conversation, never the parent's live conversation context.

Resume must reopen the original conversation without sending the task again,
verify provider/account session, exact URL, transcript boundary and generation,
then restore delivered-tool state before any new tool processing. The existing
transport bootstrap path in `src/devos-native-task-cycle.mjs` resets unproven
conversations to the root composer; **it is not a resume operation** and must not
be reused unchanged. If the original conversation cannot be recovered, surface
a fenced recovery condition rather than silently start a replacement.

Parent worktree custody must survive suspension. Mutating children require
independent admitted worktrees or another explicitly reviewed custody protocol;
releasing an agent claim is not permission for a child to mutate its parent's
reserved root. Resume must verify unchanged or independently accepted HEAD and
rebind the reservation under the new lease generation.

## Smallest follow-on patch sequence

1. Add the new migration and state/claim guards to the existing local migration
   registration. Extend existing project RPC/signed routes with prepare,
   suspend/readback and resume-readback operations; do not expose raw SQL or
   caller-selected target paths.
2. Extend `autonomous-project-journal.mjs` and
   `autonomous-project-task-runtime.mjs` with checkpoint persistence and exact
   reconciliation. Persist delivered-tool identities required after restart.
3. Add host-owned hibernation/rehydration to the existing fleet runtime/provisioner
   and task transport, preserving conversation identity and transport proofs.
4. Integrate the new states into `devos-native-task-cycle-core.mjs` and existing
   W30 project reconciliation. Keep the native execution pool's result custody
   unchanged unless a separate native checkpoint protocol is proven.

This is a cross-layer continuation feature. Shipping only one stage must remain
non-authorizing and must not report the capacity issue fixed.

## Acceptance gates

- Parent → child → grandchild completes with one physical worker, while the
  logical registry can continue growing; no task is falsely completed to free it.
- Original parent conversation, transcript floor, delivered tool-result identity,
  worktree and result provenance survive suspend/resume and process restart.
- Duplicate suspend/resume requests, concurrent contenders, changed body, lost
  ACK and crash at every DB/journal/physical transition produce one effect or an
  explicit retained unknown—not duplicate generation.
- Child failure, rejected critic, owner stop, owner generation change, stale
  lease and revoked device cannot wake an authorized-looking replacement parent.
- Ambiguous Send/tool effect remains fenced; no timeout-based replay escape.
- Two suspended parents, competing children, resource recovery and unavailable
  original conversation are exercised without starvation or data loss.
- Existing attached database, native ACK custody, independent critic and exact
  worktree/commit fences remain intact.
- Native PostgreSQL 17 transactional/concurrency tests and actual isolated
  browser-process hibernation tests precede installed useful-work qualification.
