# METAENGINE R91 — Agent Result Verification Loop Convergence

Date: 2026-09-27
Branch: `work/r91-agent-result-verification-loop-v1`
Parent: R90 exact head `1ca341fc3e6f03d34bade36c8960754791a444c8`
Source branch audited: PR #985 `work/r86-autonomous-closed-loop-v1 @ 332927aa8ab373e385895423ad46a8856c354035`

## Audit finding

PR #985 is one of the still-unabsorbed development lines. Unlike R82 and the obsolete installer-provenance forks, its central capability is not present in the current R85/R90 line:

- a machine-readable, digest-bound agent result claim protocol;
- exact task + lease-generation binding for primary agent results;
- exact subject task + result digest binding for critic/falsifier verdicts;
- RESULT_READY as a non-terminal verification boundary rather than implicit completion;
- independent critic scheduling only after the primary result exists;
- critical work receives both critic and falsifier only after RESULT_READY;
- acceptance is requested only after required verifier results are ready;
- missing/ambiguous/invalid claims fail closed instead of becoming inferred success.

The older PR also changed the continuous reconciler from preallocating verifier tasks alongside new work to post-result verification. That distinction matters: the previous policy raced critics against implementations and consumed fleet slots before there was a result to review.

## R91 convergence

R91 is stacked on R90 instead of merging #985 directly. The source branch is ancestry-diverged from the current Browser line, so only the unique closed-loop semantics are ported.

### Agent result protocol

Added `agent-result-protocol.mjs` with:

- fenced `RESULT_CLAIM_V1` payload;
- primary dispositions `READY | BLOCKED | FAILED`;
- verifier dispositions `ACCEPT | REJECT | BLOCKED`;
- exact UUID task binding;
- exact lease-generation binding;
- verifier subject task binding;
- verifier subject result SHA-256 binding;
- bounded summary/deliverable/evidence references;
- stable claim SHA-256;
- explicit `model_claim_authority=false`, `page_data_authority=false`, `authority_effect=false`;
- multiple valid claims become `AMBIGUOUS`.

### Native DevOS task cycle

For meta-orchestrator work only:

- task prompts include the exact result protocol;
- the final transcript harvest parses both tool requests and one bound result claim;
- a missing or invalid result claim produces `BLOCKED`;
- multiple result claims produce `AMBIGUOUS`;
- primary `READY` becomes `RESULT_READY`;
- critic/falsifier `ACCEPT` becomes `RESULT_READY`;
- verifier reject/block cannot be promoted into success;
- durable completion summary stores only bounded claim digest/metadata, never raw model text.

Normal non-meta fleet tasks retain the existing result behavior.

### Meta Orchestrator

- removed pre-result `riskCompanions` scheduling;
- every primary RESULT_READY receives at least one independent critic;
- CRITICAL primary RESULT_READY receives critic + falsifier;
- active verifiers are observed, not duplicated;
- ambiguous verifier effects request reconciliation, never blind retry;
- required verifier terminal failure requests reasoning;
- acceptance is requested only after all required verifier tasks are RESULT_READY/COMPLETED;
- zero verifier capacity produces an explicit capacity wait.

### Continuous reconcile

The atomic frontier no longer starts verifier companions together with a fresh implementation. Safety repair begins only after the parent is RESULT_READY/COMPLETED, and the base `VERIFYING` / `ACCEPTANCE_PENDING` states take precedence over continuous frontier expansion.

## Safety

R91 adds no scheduler authority and does not allocate agent/tab/target identity. It emits only task proposals through the existing DevOS scheduler. Model/page content remains untrusted. Ambiguous effects remain non-retriable.

## Qualification

R91 must pass the full Browser regression suite and the focused meta-orchestrator/result-protocol tests on its own exact head. It remains stacked and must not replace R90 qualification evidence.
