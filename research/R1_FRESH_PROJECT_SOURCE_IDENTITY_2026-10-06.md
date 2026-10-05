# R1 fresh-project recovery source identity convergence — 2026-10-06

Status: **EVIDENCE RECORD / source-level convergence; no live R2 claim**  
Canonical owner: **R1 Continuity Plane Adoption**  
Level-2 acceptance gate: **R2_TWO_DOMAIN_PERSISTED_READBACK**  
Base STEP09B head: `8da8573076f82f9b78e9a04b3edd1f7525297cf3`  
Successor head before this record: `448ef89c62db825a66312468a2e447f0e2eaff4c`

## Problem

The fresh-project continuity and STEP09B substrate had converged on Supabase project
`jhriwwsryeqsvvvufkok`, while the trusted R1 recovery-source path still carried the
historical project identity `xpeibufgzjknrhbhpffp`.

That split was fail-closed but blocked the real R2 path: a future recovery source could
not be admitted as evidence for the same live continuity project without proving the
database connection identity and re-versioning the evidence contracts that transitively
bind that observation.

## Implementation

The successor branch makes the fresh project identity explicit and propagates it through
the recovery-source evidence chain without granting new authority:

1. pin the effective recovery-source workflow environment to
   `R1_PROJECT_REF=jhriwwsryeqsvvvufkok`;
2. validate direct and shared-pooler Supabase database URLs against that project ref and
   reject libpq routing overrides;
3. persist a typed, secret-free database connection identity receipt into export metadata;
4. bind the fresh-project control fence to the exact observed source checkpoint;
5. version source observation, environment binding, verified handoff, quorum and final
   evidence contracts to v2 where their semantics changed;
6. version the recovery-source attestation predicate to
   `https://github.com/PatrickFrome/Compute/attestations/r1-recovery-source/v2`;
7. keep STEP09A coupled to the shared source predicate constant so downstream authority
   verification inherits the exact v2 predicate rather than duplicating a stale literal;
8. qualify both the trusted-source and STEP09B/R2-ingestion contract suites on every
   successor push.

The old project ref is retained only where tests explicitly prove that it is rejected.

## Exact-head verification

At successor head `448ef89c62db825a66312468a2e447f0e2eaff4c`:

- **R1 Trusted Live Recovery Source #57**, run `37374450920`: SUCCESS.
  - `contract-tests`: SUCCESS.
  - live-only `preflight-source`, `source-build`, `attest-source` and
    `verify-source`: SKIPPED on the push event.
- **R1 Supervisor R2 DB Ingestion #35**, run `37374450919`: SUCCESS.
  - `contract-tests`: SUCCESS.
  - checkout log confirms the exact successor SHA.
- source tests pass the fresh-project identity contract, including direct/shared-pooler
  acceptance, old-project rejection and libpq routing-override rejection;
- workflow self-check requires exactly one effective `R1_PROJECT_REF` and exactly one
  effective v2 predicate type;
- STEP09B/STEP08/STEP09A regression and adversarial suites remain green.

## Authority boundary

This change does **not**:

- dispatch the trusted live recovery-source workflow;
- read or create provider objects;
- produce a live STEP09A authority receipt;
- invoke STEP09B against the live database;
- create continuity domain/object/observation rows;
- create a persisted seal;
- prove R2;
- prove R3;
- promote the canonical roadmap.

The branch remains a source-level and contract-level prerequisite for a future explicitly
approved live R2 execution.

## Roadmap reconciliation

This work advances **R1 Continuity Plane Adoption** by removing a proven source/live
project-identity split on the path to the Level-2 gate
`R2_TWO_DOMAIN_PERSISTED_READBACK`.

It strengthens the path to real continuity evidence rather than adding an independent
control-plane abstraction: the recovery source, provider evidence and STEP09B continuity
target can now be required to name the same fresh Supabase project.

R2 remains **NOT_PROVEN** until two real current persisted readbacks are admitted through
the existing fail-closed STEP08 → STEP09A → STEP09B chain. R3 remains
**BLOCKED_BY_R2**.

## Next gate

After an exact-final-head CI pass and review of this successor PR, the next live action is
not another source-identity redesign. It is an explicitly approved STEP10 execution path
using successful trusted-source and two-domain provider runs, protected environments,
fresh provider materialization, a fresh Sigstore trusted root and the DB-only STEP09B
transaction.

Any missing protected environment, secret, upstream live run, freshness condition or
identity binding must fail closed; it must not be bypassed to manufacture R2 evidence.
