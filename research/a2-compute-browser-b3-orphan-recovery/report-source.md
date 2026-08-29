# A2 Compute Browser orphan intent recovery research

Date: 2026-08-29
Base commit: `11181e72d8f8c0eb0e5e0e1ad10e6da75e69cf1a4` (branch `work/a2-browser-operator-b3-session-scheduler` head at slice start)
Scope: source-only recovery slice on the B2/B3 context and target registries; no provider, DDL, merge, or web-authority action.

## Problem

GLM mailbox #237 (OBS_CB_2, probe P2, demonstrated on both the PR #62 and PR #63 trees):
non-terminal intent rows whose browser process incarnation died are permanently pinned.

- A `PREPARING` context row blocks `context.create` for its logical id forever
  (`context_id_exists` allows reuse only from `LOST`/`RETIRED`).
- A `CLOSING` context row can never complete (`context.close` requires `ACTIVE`)
  and never retires.
- Target rows have the same trap for `PREPARING`/`ACTIVATING`/`CLOSING`, and
  additionally any `ACTIVE` target row from a dead incarnation pins its logical id
  forever: `target.create` allows reuse only from `RETIRED`, `target.close` requires a
  live binding that died with the process, and no recovery operator exists.

The B2 design keeps this fail-closed on purpose ("an ambiguous create/close stays
recovery-required and cannot blind-retry"), but it never defined the path OUT of the
ambiguity. Correctness was preserved; liveness was lost.

## Primary-source analysis

### Chromium DevTools Protocol Target domain

`Target.createBrowserContext` returns an engine-owned `browserContextId` valid for the
current browser process; `Target.disposeBrowserContext` deletes the context; contexts
created with `disposeOnDetach` are removed when their targets detach. All ephemeral
engine state — contexts and targets — is destroyed with the browser process.

Consequence: a persisted intent whose recorded `pending_process_incarnation_id`
refers to a process that is no longer running can have no live engine-side effect.
The ambiguity the B2 design worried about ("the CDP effect may have occurred before
the transport failed") exists only WITHIN a live incarnation. Once the incarnation is
dead, the outcome is determined: nothing of that incarnation survives.

### In-repo precedent (shipped and tested)

B2 already resolves `ACTIVE` contexts this way: on start and on list, an `ACTIVE`
context whose `last_process_incarnation_id` differs from the running incarnation
becomes `LOST`, and explicit `context.create` rotates `context_epoch`. This slice
extends the identical principle to every non-terminal row and to the target registry.

## Decision

Add incarnation-recorded retirement, mirroring the shipped `ACTIVE -> LOST` mechanism:

1. Every non-terminal row records the incarnation it belongs to. Contexts already
   recorded `pending_process_incarnation_id` (transitions) and
   `last_process_incarnation_id` (ACTIVE). Targets now record
   `last_process_incarnation_id` on their ACTIVE rows as well.
2. A row whose recorded incarnation is not the running incarnation is
   definitionally dead. Open intents (`PREPARING`/`ACTIVATING`/`ACTIVE`) become
   `LOST`; closing intents (`CLOSING`) become `RETIRED` because process death has
   already fulfilled the close. Retirement is applied at profile start and lazily
   on `context.list`/`target.list`; it performs no engine calls.
3. Logical-id reuse requires `LOST`/`RETIRED` and rotates the epoch
   (`context_epoch` for contexts, `conversation_epoch` for targets). Targets gain
   `LOST` as a first-class registry state for this purpose; `LOST` rows stay visible
   in listings so the loss remains observable.
4. Rows without any recorded incarnation (pre-upgrade format) are definitionally
   from a dead incarnation — the current daemon process writes the new format — so
   they retire the same way.

## Rejected alternatives

- A dedicated `context.recover`/`target.recover` RPC: enlarges the trusted surface
  (new method, effect class, protocol version) to express what explicit re-creation
  already expresses. The design document defines recovery as explicit `create` with
  epoch rotation; what was missing was the path to `LOST`/`RETIRED`, not a new verb.
- Automatic replay of pending intents after restart: violates B2 invariants 5 and 7
  ("never replays context creation or target creation", "cannot blind-retry") and
  risks duplicated engine-side effects if the CDP call had completed before the crash.
- Startup-only reconciliation: incomplete. A process death mid-session (without a
  restart) leaves rows pinned until the next start; contexts already reconcile
  lazily on list, and targets need the same parity.

## New invariants

- I1: every non-terminal registry row records the incarnation it belongs to.
- I2: a row whose recorded incarnation is not the running incarnation is
  definitionally dead and is reconciled to `LOST` (open intents) or `RETIRED`
  (closing intents) at the next start or list.
- I3: logical-id reuse requires `LOST`/`RETIRED` and rotates the epoch.
- I4: within the live incarnation, mid-flight intents stay fenced from blind retry
  (unchanged; covered by the existing ambiguity tests, which remain green).

## Security analysis

- No silent restoration: retirement records loss; recreation is explicit, observable,
  and epoch-rotating. The protocol capability `silent_context_recreation` remains
  absent.
- No new authority: retirement performs zero engine calls and no new RPC method,
  parameter, or effect class is introduced.
- Fail-closed direction preserved: an unknown or tampered incarnation string never
  resurrects a row as `ACTIVE`; it retires to `LOST`, the strictly observable outcome.
- Registry tampering itself remains outside the threat model (daemon-private state
  root, 0600 files, single-owner daemon lock), unchanged from B2/B3.

## Post-research: OBS_CB_5 runtime probe (closes GLM #237 open question)

`tests/obscb5-dispose-probe.mjs` runs four cases on a real engine over the
production native-pipe transport (Chrome for Testing 151.0.7922.34):

- `dispose_with_live_target` — succeeds (control case).
- `dispose_after_last_target_close` — **succeeds**. The hypothesized orphan mode
  ("disposeOnDetach auto-disposes the emptied context, so closeContext's
  disposeBrowserContext fails and leaves a CLOSING orphan") is FALSIFIED on
  this engine: disposing after draining targets works.
- `double_dispose` — fails with `cdp_error:-32000 Failed to find context`,
  proving dispose is not generally idempotent. The dangerous window is a
  dispose that succeeded at the engine while the runtime died before persisting
  `RETIRED`: replaying the dispose would error. This slice handles exactly that
  case by reconciling the dead-incarnation `CLOSING` row to `RETIRED` without
  ever replaying the engine call — the design is consistent with the observed
  engine behavior.
- `create_target_in_disposed_context` — fails cleanly; no silent resurrection
  into the disposed context id.

Conclusion: OBS_CB_5 is closed with falsifiable primary-source evidence; no
closeContext change is required; the orphan-recovery reconciliation is the
correct and sufficient mechanism for both failure windows observed.

## Verification matrix

- Unit (new `tests/orphan-recovery.test.mjs`, 8 tests):
  dead-incarnation `PREPARING`/`ACTIVATING`/`CLOSING`/`ACTIVE` contexts and targets
  retire on list; ids become reusable with epoch rotation; mid-flight intents of the
  live incarnation stay fenced from blind retry; adversarial rows with unknown
  incarnations retire fail-closed; process-down lists retire every non-terminal row.
- Unit (regression): all 41 pre-existing tests pass unmodified, including the
  ambiguity-fencing and ACTIVE-to-LOST tests.
- Runtime (real Chromium, `src/cli.mjs self-test`): the crash-restart smoke now
  injects the exact pre-effect intent shapes at the persistence seam before a real
  `Browser.close`, restarts the profile, and proves on the live engine that open
  orphans become `LOST`, closing orphans become `RETIRED`, and both ids are
  explicitly reusable with rotated epochs. The pre-existing stale-target assertion
  is strengthened from bound-false to status `LOST`.
