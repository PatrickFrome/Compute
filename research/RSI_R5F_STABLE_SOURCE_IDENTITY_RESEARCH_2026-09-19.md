# RSI R5F — Stable Source Identity Witness Research

Date: 2026-09-19  
Parent: PR #890 @ `12c53438cb5775cb6ad1b40dc09beaac3b4e14f2`  
Implementation branch: `work/metaengine-rsi-source-identity-stability-v1-sol`

## Question

Once GitHub source, durable DB authority and installed/runtime target are observed as exactly equal and fresh, what additional evidence should be required before a self-improvement candidate may cross into a later external admission review?

The failure mode under study is transient equality: a one-shot sample can be correct while one of the three independently moving planes is already about to advance, has just reincarnated, or is being replayed from a previous observation. R5F therefore remains a zero-effect evidence layer. It does not synchronize the planes and does not authorize exposure, execution, promotion or self-update.

## Research synthesis

### SLSA Source v1.2 — immutable revisions and contemporaneous provenance
Source: https://slsa.dev/spec/v1.2/source-requirements

SLSA distinguishes immutable Source Revisions from moving Named References and requires trustworthy history/provenance to be contemporaneous with the revision/change process. The relevant implication for METAENGINE is that a branch name or semantic ancestry cannot replace an exact source revision, and an old observation of a moving ref must not be repackaged as current evidence.

**Adoption:** ADOPT_NOW. Preserve exact SHA identity in both read rounds and require distinct current observations.

### The Update Framework — timestamp freshness, snapshot consistency, rollback/freeze defense
Sources:
- https://theupdateframework.io/docs/metadata/
- https://theupdateframework.io/docs/security/

TUF separates consistency and freshness. Snapshot metadata provides a consistent repository view; frequently refreshed timestamp metadata limits freeze attacks. Expiration and monotonicity prevent authentic-but-stale state from silently remaining authoritative.

**Adoption:** ADOPT_NOW. A single fresh equality certificate is necessary but not a stable witness. Require a second, strictly newer, non-overlapping read round and reject replay/stale/future evidence. Keep the stability budget frozen by the trust root rather than candidate-selected.

### Kubernetes observedGeneration — controller status is bound to the generation actually observed
Source: https://kubernetes.io/docs/concepts/workloads/pods/

Kubernetes uses `status.observedGeneration` to bind reported status to the resource generation actually observed by the controller. A status tied to an older generation is not equivalent to the current desired state, and the controller-owned observation field is not for external mutation.

**Adoption:** ADOPT_NOW. Keep the DB `alignment_epoch` stable across both rounds and bind runtime evidence to the exact process incarnation. A restart or epoch movement invalidates the witness even when the Git SHA is unchanged.

### in-toto — externally defined steps and authorized functionaries
Source: https://in-toto.io/docs/getting-started/

in-toto separates an owner-defined layout from signed step evidence produced by authorized functionaries. Verification checks that the expected sequence and actors actually produced the evidence.

**Adoption:** ADOPT_NOW at the semantic boundary. The candidate cannot author the R5F certificate; R5F verifies its R5E parents and carries no effect authority.  
**Defer:** cryptographic functionary signatures for this evidence until the source/release attestation layer is integrated end-to-end.

### Auditing Harness Tampering in Self-Improving Agents
Source: https://arxiv.org/abs/2609.00069

The work documents that self-improving agents can obtain illusory gains by modifying authorization, provenance or completeness properties of their own harness, and that such edits can persist in winning lineages.

**Adoption:** ADOPT_NOW. Treat freshness/stability rules as verifier-owned trust roots, not editable candidate policy. Keep exact derived-state/digest re-verification.

### Self-Harness
Source: https://arxiv.org/abs/2606.09498

Self-Harness uses a bounded loop of weakness mining, minimal harness proposals and regression validation. The useful pattern is aggressive proposal generation coupled to an acceptance step that rejects regressions.

**Adoption:** EXPERIMENT in the proposer/search plane after R5/R7/R8 evidence gates are qualified. Candidate-generated harness improvements may be proposed, but they cannot weaken or self-certify the convergence/acceptance verifier.

### CORAL
Source: https://arxiv.org/abs/2604.01658

CORAL combines asynchronous multi-agent evolution with persistent memory, isolated workspaces, evaluator separation, resource management and heartbeat-based recovery.

**Adoption:** EXPERIMENT/ADOPT_LATER for parallel search and candidate diversity. Preserve evaluator separation and isolated workspaces. Do not turn search liveness into acceptance or Browser effect authority.

### EvoX
Source: https://arxiv.org/abs/2602.23413

EvoX adapts the evolutionary search strategy itself instead of using a fixed exploration/exploitation policy.

**Adoption:** EXPERIMENT in the search plane. Adaptive proposal routing is useful only while the R5F/R7/R8 acceptor remains externally fixed. Search-policy autonomy must not select its own evidence freshness, release thresholds or execution privileges.

## Decision

### ADOPT_NOW
1. Two distinct fresh R5E certificates.
2. Strictly newer, non-overlapping readback rounds.
3. Exact source tuple stability, not ancestry/version equivalence.
4. Stable DB alignment epoch.
5. Stable runtime client and process incarnation.
6. Frozen verifier-owned temporal policy.
7. External certificate ownership and canonical digest re-verification.

### EXPERIMENT
- asynchronous isolated search islands;
- adaptive proposal/search routing;
- self-generated minimal harness improvements;
- quality-diverse archives of rejected/alternate proposals.

These remain upstream of acceptance and cannot grant Browser, scheduler, promotion, exposure or self-update authority.

### DEFER
- threshold signatures and cryptographic functionary identities for each R5 read round;
- Source VSA / in-toto attestation ingestion into the R5 evidence object;
- automatic cross-plane repair.

The first two need an end-to-end release/source attestation plane. Automatic cross-plane repair is deliberately deferred because equality evidence must not become authority mutation.

### REJECT
- one fresh snapshot as sufficient release/exposure authority;
- candidate-configurable freshness or stability budgets;
- treating branch ancestry, version strings or semantic equivalence as exact source identity;
- treating runtime restart with the same SHA as the same observation generation;
- automatic DB/runtime synchronization merely to satisfy the convergence gate.

## Resulting METAENGINE contract

`R5D exact identity → R5E fresh identity → R5F stable two-round identity → external admission review`

R5F is evidence-only. Stable equality means only that the three independently read planes stayed exactly aligned across a bounded observation interval under the same DB generation and runtime incarnation. It never means “safe to execute” or “safe to promote” by itself.
