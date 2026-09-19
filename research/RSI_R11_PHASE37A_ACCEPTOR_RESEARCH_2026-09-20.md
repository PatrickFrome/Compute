# METAENGINE RSI R11 — Phase37A acceptor research

Date: 2026-09-20  
Status: ZERO-EFFECT RESEARCH / SOURCE-ONLY IMPLEMENTATION / NO ACTIVE EFFECT  
Exact predecessor: PR #921 @ `f04d216d5979240f1a9c86142e21fbc8f29b64b4`  
Current stacked PR: #923  
Authority effect: **false**

## 1. Research conclusion

Phase37A must improve the **acceptor**, not add another proposer, scheduler, lifecycle, evaluator plane, or statistical estimator.

The repository already has the correct risk-control substrate:

- `rsi-recursive-risk-budget.mjs`;
- external statistical certificate contracts;
- confirmation-triggered alpha spending;
- a durable confirmation concept;
- Phase33 paired-instance / stopping-policy / numerical anytime-valid semantics.

Therefore the graduation layer should bind those existing concepts to the exact post-exploration skill/consumer/governance state rather than invent a second risk ledger.

## 2. PACE

Reference: https://arxiv.org/abs/2606.08106

PACE treats repeated self-improvement acceptance as adaptive multiple testing. The reusable properties are:

- compare candidate and incumbent on identical instances;
- use an anytime-valid sequential test;
- allow early stopping without invalidating the per-decision false-commit guarantee;
- abstain when evidence is insufficient;
- control the acceptor, because repeated greedy "score improved" decisions accumulate false commits.

METAENGINE adaptation:

- Phase37A consumes a paired-instance manifest;
- exact consumer/retrieval/evaluation context is frozen across PROCESS, OUTCOME, and statistical receipts;
- a numerical external e-value threshold is checked;
- insufficient evidence cannot remove the exploration-only hold;
- Phase37A emits a certificate only, never the ACTIVE effect.

## 3. Statistical Gödel Machine

Reference: https://arxiv.org/abs/2510.10232

SGM adds a cumulative statistical risk budget across recursive modifications and spends risk only at confirmation events.

METAENGINE already implements this in `rsi-recursive-risk-budget.mjs`.

R11 design decision:

- reuse the existing recursive risk budget;
- reuse an existing externally verified statistical certificate;
- require an existing risk-confirmation row;
- require exact agreement between risk confirmation, external certificate, paired-instance/tournament digest, holdout, evaluator root, candidate identity, and budget;
- no second statistical ledger or estimator is created in R11.

The local R11 statistical adapter only checks the graduation-specific numerical e-value threshold and exact binding. It does not estimate an e-value.

## 4. Universal Verifier

Reference:
https://www.microsoft.com/en-us/research/articles/the-art-of-building-verifiers-for-computer-use-agents/

The Universal Verifier work reports that verifier reliability improves when:

- criteria are specific and non-overlapping;
- PROCESS and OUTCOME are evaluated separately;
- controllable and uncontrollable failures are distinguished;
- false positives are treated as a primary failure mode.

METAENGINE adaptation:

- PROCESS and OUTCOME are separate external receipts;
- their identities must be distinct from each other, the statistical acceptor, certificate owner, and future effect executor;
- an uncontrollable environment failure yields ABSTAIN, not candidate failure and never promotion;
- model self-report is explicitly not acceptance authority;
- state/readback evidence is preferred over appearance-only grading.

## 5. Existing lineage/provenance reuse

R11 does not add a new lineage graph.

The certificate reuses the existing current-library lineage contamination review and requires it to be exact-bound to:

- current verified library;
- target skill;
- current governance;
- target consumer;
- future Phase37B effect executor.

All provenance/security/semantic lineage reviewers must remain disjoint from the Phase37A certificate/process/outcome/statistical/effect identities.

## 6. Graduation-specific hard gates

A successful Phase37A certificate requires all of:

1. current target is `EXPLORATION_ACTIVE`;
2. current target has `exploration_only_hold=true`;
3. target is already proven-positive;
4. projected next governance changes only the target to `ACTIVE` and removes only its exploration hold;
5. active count remains unchanged;
6. exact same consumer/retrieval/evaluation/source scope across receipts;
7. paired same-instance evidence;
8. existing recursive-risk confirmation passes;
9. numerical anytime-valid evidence passes;
10. PROCESS verifier passes;
11. OUTCOME verifier passes;
12. retention non-regression;
13. cost budget pass;
14. latency budget pass;
15. negative transfer clear;
16. lineage contamination clear;
17. coalition ablation pass;
18. no-skill ablation pass;
19. source grounding pass;
20. memory-poisoning scan pass.

The output still has:
- no hold-release authority;
- no ACTIVE authority;
- no Browser authority;
- no scheduler authority;
- no promotion authority;
- no self-update authority;
- no retry authority.

## 7. EvolveMem — next research frontier, not current authority

Reference: https://arxiv.org/abs/2605.13941

EvolveMem treats retrieval configuration itself as an evolvable structured search space and uses revert-on-regression / explore-on-stagnation safeguards.

METAENGINE should adopt this only after the graduation acceptor is independently qualified. The future candidate space can include:

- retrieval scorer mixtures;
- graph traversal depth;
- recency/semantic/causal fusion weights;
- memory consolidation policy;
- context assembly budget;
- episodic/semantic memory routing.

Every such candidate must remain behind the same external evaluator, paired acceptor, negative-transfer gates, and rollback/reversion contract.

## 8. Durability research

References:
- https://www.sqlite.org/wal.html
- https://sqlite.org/pragma.html

SQLite documents WAL + `synchronous=FULL` as providing ACID durability under its documented VFS/storage assumptions, with a WAL sync at each transaction commit.

This remains an experiment, not a migration. Before adoption:

- benchmark JSON vs SQLite p50/p95/p99 commit latency;
- test application crash, OS crash, and power-loss classes separately;
- qualify Windows and Linux;
- preserve one-attempt ambiguity semantics;
- do not treat storage transactions as proof that an external Browser effect happened exactly once.

## 9. Live-release convergence warning

The installed/current release lineage and the current RSI convergence lineage are deeply diverged. A current compare reports thousands of release-line commits on one side and more than one hundred RSI-side commits on the other, with hundreds of changed files.

Do not bulk-merge histories.

The safe strategy remains selective reconstruction:
1. freeze the live release exact SHA;
2. freeze the green RSI exact SHA;
3. classify intersecting files into authority/runtime/test/docs groups;
4. reconstruct only proven RSI semantics onto the current release source;
5. preserve current self-update/Sentinel/supervisor/GLM/runtime behavior;
6. run full exact-head CI and installed-runtime qualification;
7. only then consider a controlled self-update.

## 10. Next implementation boundary

Phase37B may be implemented only after Phase37A exact-head CI is terminal green.

Phase37B should be a one-attempt effect:
`EXPLORATION_ACTIVE + exploration_only_hold -> ACTIVE + no graduation hold`

Required effect semantics:
- PREPARED persisted;
- ATTEMPTED persisted before mutation;
- exact fresh pre-effect readback;
- one hold mutation;
- terminal readback;
- ambiguity is reconciliation-only;
- same-attempt replay forbidden;
- certificate itself remains non-authoritative.
