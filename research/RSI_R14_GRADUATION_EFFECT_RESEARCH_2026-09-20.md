# RSI R14 Graduation Effect Research (2026-09-20)

## Boundary

R14 closes the Phase37B implementation gap left open by the R9-R13 stack. The
Phase37A exploration graduation certificate (PR #923, hardened by the R13
restart-durable risk witness in PR #925) authorizes a *review* verdict:
`ELIGIBLE_FOR_PHASE37B_ONE_ATTEMPT_GRADUATION_REVIEW`. Until R14 nothing in the
runtime could legally consume that verdict: the certificate is `certificate_only`
with `exploration_hold_release_authorized:false` and `graduation_token:null`, and
the lifecycle exposed only a zero-effect exposure preview (R10) with no hold
mutating effect at all. R14 adds the missing one-attempt
`EXPLORATION_ACTIVE -> ACTIVE` effect with the same durable-attempt,
readback-before-effect, and no-blind-retry guarantees the admission path already
enforces.

## Design decisions

1. **Effect lives in the skill lifecycle, not a new scheduler.** The exploration
   only hold set is lifecycle state; a separate executor would create a second
   writer for the same state. The graduation attempt journal reuses the exact
   pattern of the library admission attempt journal (append-only rows, digest
   chained transitions, restart replay validation), so no second control plane is
   created. This mirrors the Fabric principle already used for
   RELEASE_PROMOTION: no new scheduler for an existing effect domain.

2. **Executor is designated, not self-assigned.** `prepare` requires
   `effect_executor_identity_digest === certificate.future_effect_executor_identity_digest`
   and rejects executors colliding with the certificate principals surfaced on
   the certificate (owner, durable witness readback owner). Deeper separation
   (process/outcome verifiers, statistical acceptor) was already proven at
   certificate creation, which enforces the full cross-stage identity set.

3. **Projected governance CAS.** The certificate binds
   `projected_next_governance_digest`. At prepare, the lifecycle recomputes the
   projection from its own current state (same governance id, same evidence,
   same historical libraries, exploration set minus the target) and rejects any
   mismatch. At execute, after the hold release, the observed governance digest
   must equal the same projection. The effect therefore cannot do anything
   except exactly the certified transition; any other state change fails closed.

4. **Durable ATTEMPTED fence with post-attempt pre-effect readback.** The
   sequence is PREPARED (durable) -> ATTEMPTED (durable, effect_attempt_count=1)
   -> re-read library and governance digests -> single effect attempt ->
   CONFIRMED_ACTIVE (durable). Drift detected after ATTEMPTED persists becomes
   RECONCILIATION_ONLY; the effect is never replayed on the same attempt.

5. **Readback-only reconciliation with owner separation.** `reconcile` accepts
   only an external readback owner distinct from the executor and the
   certificate principals. It classifies CONFIRMED_ACTIVE (hold absent and
   governance equals the projection), CONFIRMED_NOT_ACTIVE_NEW_ATTEMPT_REQUIRED
   (hold present and governance equals the predecessor), or RECONCILIATION_ONLY
   (anything else). This matches the dual-write recovery literature: identical
   durable source states with different sink acceptance records must be
   resolved by readback, never by re-execution.

6. **Zero new authority.** The effect row carries
   `graduation_releases_exploration_hold_only`, `graduation_does_not_grant_execution_authority`,
   and `graduation_does_not_mutate_library`. Graduation only removes the
   exploration hold for the target skill; the library, execution authority,
   browser authority, and every other authority flag remain untouched. The
   successful effect result explicitly reports `new_authority_granted:false`.

## Invariants covered by tests

- Happy path: PREPARED -> IDEMPOTENT re-prepare -> ATTEMPTED -> CONFIRMED_ACTIVE
  with the target entry fully ACTIVE (`active_for_composition:true`,
  `exploration_only_hold:false`, `admission_exposure_hold:false`), restart
  replay of the whole attempt journal, and terminal-state rejection of a second
  execute.
- Negative: non-external callers, non-designated executors, executor colliding
  with the certificate owner, certificates built against drifted governance,
  ineligible certificates (memory poisoning scan failed), and conflicting second
  attempts for the same skill while the first is non-terminal.
- Drift: governance change after PREPARED blocks ATTEMPTED; governance change
  after ATTEMPTED turns execute into PRE_EFFECT_DRIFT_RECONCILIATION_REQUIRED
  with the effect not performed, and reconciliation classifies the ambiguous
  state as RECONCILIATION_ONLY without any additional effect attempt.
- Crash semantics: crash after effect but before CONFIRMED_ACTIVE persists
  reconciles to CONFIRMED_ACTIVE; crash before effect reconciles to
  CONFIRMED_NOT_ACTIVE_NEW_ATTEMPT_REQUIRED (a fresh certificate and attempt
  are required, never a blind retry of the same effect id).
- Readback owner separation: executor and certificate principals cannot serve
  as the reconciliation readback owner.
- Trust root: the lifecycle root snapshot now records the graduation policy
  (append-only attempts, attempt limit 1, no blind retry, projected governance
  CAS, no new authority).

## Research anchors

- Exactly-once effect journals with durable attempt fences and
  reconciliation-only ambiguity resolution (Temporal activity idempotency
  semantics; Idempotent Consumer pattern).
- Machine-checked dual-write recovery from a commit log (arXiv, Sep 2026):
  post-crash states with equal durable source state and divergent sink records
  are resolved by readback classification, which is exactly the
  CONFIRMED_ACTIVE / CONFIRMED_NOT_ACTIVE / RECONCILIATION_ONLY triad here.
- Anytime-valid sequential evidence with a fixed false-admission budget (SEA /
  PACE line): the graduation effect deliberately consumes an already-spent
  statistical confirmation through the restart-durable witness instead of
  re-running statistics, so the effect layer cannot inflate the evidence.
- Agent memory poisoning literature (2026): memory poisoning gates must hold
  through full activation; the Phase37A certificate's
  `memory_poisoning_scan_pass` is a hard blocker the effect re-verifies via
  certificate eligibility at prepare and on every restart replay.

## Qualification plan

Focused preflight (`rsi-r14-graduation-effect-preflight.yml`) runs the nine
governance-critical test files on the exact branch head; the full integration
fanout (Critical Audit, Shell, Soak, Final Runtime, Installed Chat, Package,
Self Update E2E) then qualifies the head before any merge governance step. The
lifecycle state gains the graduation fields in a backward-compatible way: state
files persisted before R14 simply load with an empty graduation attempt list.
