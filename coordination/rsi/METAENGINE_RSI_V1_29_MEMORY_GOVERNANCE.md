# METAENGINE RSI V1.29 — Fail-Closed Memory Governance

Status: SOURCE IMPLEMENTED / STACKED ON V1.28 / CI PENDING / NO LIVE AUTHORITY

Predecessor: work/metaengine-rsi-experience-graph-v1 @ 1241705b5f0fd092a0ef5d94d08e2aa1c5a512b5

Implementation branch: work/metaengine-rsi-memory-governance-v1

## Purpose

V1.28 turns experience into durable relational memory. V1.29 treats that persistent memory as a security-sensitive behavioral surface: existence in history is not eligibility for retrieval.

Operational chain: write evidence -> external security audit -> governed view -> retrieval -> downstream transfer validation.

The immutable V1.28 source graph remains forensic history. V1.29 derives a fail-closed active view without destructive deletion.

## Research mechanisms adopted

### MemSecBench

MemSecBench follows malicious memory across Write, Execute and Forget/repair stages and shows why persistence, downstream behavioral consequence and selective repair must be tested as one lifecycle. METAENGINE adopts explicit write-vs-use separation, default distrust of unaudited cases and selective repair that preserves source evidence.

Reference: Chen et al., MemSecBench: Tracking Agent Memory Poisoning from Persistence to Consequence and Repair, arXiv:2607.27080.

### PERSIST

PERSIST models persistent-memory poisoning, retrieval injection, exfiltration, state corruption, provenance loss and temporal drift, and evaluates provenance/revocation/retrieval-time controls. V1.29 adopts those threat categories and retrieval-time policy gating while keeping claims limited to source contracts rather than assuming production efficacy.

Reference: Brobbey & Bhosale, PERSIST: Threat Modeling Memory-Persistent AI Agents in Cloud-to-Edge Environments, Security and Privacy, 2026.

### ReMe, SAGE and ExpGraph

ReMe replaces passive accumulation with context-adaptive reuse and utility-based refinement. SAGE/ExpGraph show the benefit of writer-reader feedback and utility-aware graph memory. METAENGINE adopts operational pruning as a derived view: quarantined, revoked or stale cases disappear from active retrieval, while immutable history remains available for incident reconstruction.

## Memory security audit

Schema: metaengine.rsi.memory-security-audit.v1.

Each audit binds graph identity, observed snapshot/epoch, exact case id/digest, audit sequence, decision, bounded risk codes, three risk scores, provenance-attestation digest, revalidation epoch and external evidence.

Decisions: ACCEPT, REVIEW, QUARANTINE, REVOKE.

Risk classes include persistent poisoning, retrieval injection, exfiltration risk, state corruption, provenance loss, temporal drift, identity/scope mismatch and unverified external origin.

ACCEPT is valid only with no risk codes and semantic-risk, attack-radius and access-risk scores each <= 0.25. These are trust-root constants, not candidate inputs.

## Temporal drift

Every ACCEPT has a bounded revalidate_after_epoch. At or after that graph epoch the case becomes STALE_REVIEW_REQUIRED and is excluded until a fresh external audit exists.

## Governed view

Schema: metaengine.rsi.memory-governed-view.v1.

Operational states: ACTIVE, REVIEW_REQUIRED, STALE_REVIEW_REQUIRED, QUARANTINED, REVOKED and SUPERSEDED_BY_VERIFIED_REPAIR.

Unaudited memory defaults to REVIEW_REQUIRED. Only ACTIVE cases enter the governed graph.

Blocked nodes are removed before graph diffusion. Similarity, correction and utility edges touching blocked nodes are removed too, so a poisoned node cannot silently act as a semantic bridge.

## Selective repair

Schema: metaengine.rsi.memory-repair-receipt.v1.

A repair can supersede a blocked source only when the replacement is independently ACCEPTed, source/replacement bind the exact same task/signature, the replacement is a later attempt, both audits bind exactly and an external repair verifier provides evidence.

Repair never deletes the source case. The source becomes SUPERSEDED_BY_VERIFIED_REPAIR in the active view while immutable history remains intact.

## Governed retrieval

retrieveRsiGovernedExperience() runs only over the governed graph. If nothing is eligible it returns BLOCKED_NO_ELIGIBLE_MEMORY instead of falling back to raw memory. A query cannot bridge through a quarantined/revoked/stale case.

All returned cases still require external target-context transfer validation; a security ACCEPT is not evidence of cross-context usefulness.

## Trust root

apps/metaengine-browser/src/rsi-memory-governance.mjs is added to Candidate Builder immutable paths, tournament trust root and promotion trust root.

## Non-goals

V1.29 does not deploy a production memory database, delete historical cases, automatically repair poisoned memory, trust model classification as final audit authority, expose raw trajectories/user/page text, create Browser effects, create DevOS leases, mutate production, promote, install or self-update.

## Next slice

V1.30 should add non-destructive memory consolidation views: compact derived summaries over immutable cases, utility-aware active-view pruning, mandatory failure/warning retention to avoid survivorship bias, graph-region drift scoring, re-expansion from source evidence and snapshot-diff diagnostics.
