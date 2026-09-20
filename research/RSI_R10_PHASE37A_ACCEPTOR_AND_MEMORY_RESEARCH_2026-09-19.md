# RSI R10 / Phase37A acceptor + memory research — 2026-09-19

Status: ZERO-EFFECT RESEARCH / STACKED ON PR #921 / NO PROMOTION OR LIVE BROWSER EFFECT

## Current implementation boundary

R10 intentionally stops at a derived governance preview. The runtime can prove the exact
`DORMANT_CAP + admission_exposure_hold -> EXPLORATION_ACTIVE + exploration_only_hold`
projection without mutating durable state. Full `ACTIVE` remains a separate graduation stage.

## Research findings

### 1. PACE: acceptance is the weak point in self-evolution

PACE (arXiv:2606.08106) frames repeated candidate acceptance as adaptive multiple testing.
Its key reusable idea is paired incumbent-vs-candidate evaluation on identical instances plus
an anytime-valid sequential acceptor. Optional stopping is part of the acceptor contract, not
an error to ignore.

METAENGINE implication:

- Phase37A should be an acceptor/certificate plane, not another proposer.
- Candidate and incumbent must share the same instance manifest and evaluation contract.
- The acceptor must expose a numerical anytime-valid threshold, not only a boolean claim.
- Insufficient evidence must abstain rather than promote.
- A fixed false-admission budget must survive arbitrary stopping/adaptation.

### 2. Existing METAENGINE statistics are reusable but not yet a Phase37 graduation contract

The repository already has:
- `rsi-recursive-risk-budget.mjs`
- `rsi-external-canary-statistical-review.mjs`
- `rsi-exact-existing-consumer-owner-review.mjs`

Phase33 already binds a paired-instance manifest, stopping-policy digest, fixed false-admission
alpha, minimum paired sample count, and numerical e-value threshold. Reuse those trust concepts
instead of creating a second statistical authority.

Gap for Phase37A:
- no exact certificate yet binds the *currently exploration-only skill* plus exact current
  library/governance/consumer/retrieval context to a same-instance incumbent comparison;
- no graduation certificate currently requires retention, latency/cost, negative-transfer,
  contamination and coalition checks simultaneously;
- no graduation-specific separation exists between statistical acceptor, process verifier,
  outcome verifier and later effect executor.

### 3. Microsoft Universal Verifier: split process and outcome

Microsoft Research reports that verifier reliability improves when rubric criteria are
specific/non-overlapping and when process vs outcome and controllable vs uncontrollable
failures are separated.

METAENGINE implication:
- Phase37A should require two independent verifier receipts:
  1. PROCESS: policy/path/invariant adherence.
  2. OUTCOME: environment-grounded success/non-regression.
- A third classification should mark uncontrollable environment failure separately so it
  causes abstention/retest, not candidate blame or promotion.
- Model self-report must not be a source of acceptance authority.

### 4. State-grounded verification should dominate appearance-only grading

For Browser tasks, exact environment/state readback should be preferred wherever the application
surface exposes it. Screenshot/LLM judgments are fallback evidence, not the primary authority.

Phase37A should therefore bind:
- terminal Browser receipt/readback;
- exact consumer state;
- exact retrieval profile;
- exact source/library/governance;
- paired instance manifest;
- verifier-root provenance.

### 5. EvolveMem: evolve retrieval architecture only behind a strong acceptor

EvolveMem (arXiv:2605.13941) exposes retrieval configuration as a structured search space and
uses revert-on-regression / explore-on-stagnation guards.

METAENGINE implication:
- do not directly self-modify memory architecture yet;
- first finish Phase37A acceptance and Phase37B bounded graduation;
- then expose memory/retrieval settings as typed candidate parameters under the same external
  evaluator and rollback/reversion rules.

### 6. SQLite WAL/FULL is a candidate lifecycle backend, not an immediate migration

SQLite documentation states that WAL with synchronous=FULL adds a WAL sync on each transaction
commit and is ACID across power loss under documented assumptions. WAL improves read/write
concurrency but requires same-host shared state and careful checkpoint handling.

METAENGINE implication:
- keep current crash-aware JSON primitive conservative;
- benchmark an experimental local lifecycle journal with WAL + synchronous=FULL;
- no canonical migration until Linux + Windows crash/power-loss qualification and recovery
  replay semantics are proven;
- preserve the current one-attempt ambiguity rules even if storage becomes transactional.

## Proposed Phase37A zero-effect contract

A future `rsi-exploration-graduation-certificate.mjs` should consume:

1. exact current verified library + current governance;
2. target skill must be `EXPLORATION_ACTIVE` with `exploration_only_hold=true`;
3. exact consumer/retrieval/source identity;
4. paired incumbent/candidate instance manifest;
5. external anytime-valid statistical receipt with numerical threshold;
6. process verifier receipt;
7. outcome verifier receipt;
8. retention/non-regression receipt;
9. latency + cost budget receipt;
10. negative-transfer clearance;
11. contamination/lineage CLEAN receipt;
12. coalition/no-skill ablation receipts;
13. distinct statistical/process/outcome/effect-owner identities.

Outputs are certificate-only:
- no hold removal;
- no ACTIVE transition;
- no Browser effect;
- no promotion/self-update;
- no retry authority;
- no scheduler authority.

## Near-term implementation order

1. Make PR #921 exact-head green.
2. Freeze its zero-effect preview in runtime/trust roots.
3. Build Phase37A certificate only after exact-head R10 qualification.
4. Build Phase37B one-attempt graduation effect only after Phase37A is independently green.
5. Only then begin EvolveMem-style retrieval/memory architecture search.

References:
- PACE: https://arxiv.org/abs/2606.08106
- EvolveMem: https://arxiv.org/abs/2605.13941
- Microsoft Universal Verifier: https://www.microsoft.com/en-us/research/articles/the-art-of-building-verifiers-for-computer-use-agents/
- SQLite WAL: https://www.sqlite.org/wal.html
- SQLite PRAGMA synchronous: https://www.sqlite.org/pragma.html
