# A2 Browser R11 — Same-Point Swarm — Post-Implementation Research

Date: 2026-08-29
Parent authoritative milestone: R10 `23dad9bdf117f7d732bf01da5866bdec46f206be`
Initial candidate: `247257cc12b609e53b3e024e9c6ae2696c7b1390`
Initial workflow: `33237409142`

## Implemented result

R11 implements a pure manager-side, phase-gated SAME_POINT protocol:

- proposer-facing proposal visibility is blind during PROPOSING;
- manager alone closes phases;
- every proposal requires critique by another agent;
- CRITICAL points require both FALSIFIER and SECURITY evidence;
- jury votes are bound to all proposal, critique and adversarial evidence ids;
- jury outcome is computed by strict majority and otherwise becomes UNRESOLVED;
- manager cannot provide an outcome override;
- no direct peer-message primitive exists;
- no model, browser, network, process or actuation capability exists in the swarm core.

## Post-implementation research

Anthropic's production multi-agent research write-up supports parallel, separately-contexted subagents for breadth and independent exploration, while also reporting significant coordination/token costs. That reinforces the R11 strategy of using SAME_POINT swarms selectively rather than making every task a swarm.

OpenAI's debate research reinforces separation between competing arguments and judging. R11 applies only the structural lesson: proposals/critiques are evidence and the jury is a distinct phase; it does not claim to implement or reproduce a training-time debate scheme.

AutoGen demonstrates flexible managed group-chat patterns. R11 intentionally chooses a narrower protocol because free early broadcast would destroy the independence that the blind proposal phase is designed to preserve.

## Verification result

The first R11 workflow reached all substantive gates successfully:
- exact R10 parent/source boundary;
- zero-authority/no-peer-bus static checks;
- R11 swarm adversarial tests;
- R10/R9/R8 regression fence;
- deterministic evidence construction;
- provenance attestation.

No implementation defect was found in the first test pass. The final exact-head run after this post-research document is the promotion gate.

## Confirmed invariants

- `BLIND_PROPOSALS_NOT_VISIBLE_TO_PEER_PROPOSERS_BEFORE_CLOSE`.
- `MANAGER_OWNS_PHASE_TRANSITIONS`.
- `SELF_CRITIQUE_IS_FORBIDDEN`.
- `EVERY_PROPOSAL_REQUIRES_CROSS_CRITIQUE`.
- `CRITICAL_REQUIRES_FALSIFIER_AND_SECURITY_EVIDENCE`.
- `JURY_VOTE_MUST_REFERENCE_REQUIRED_EVIDENCE`.
- `MANAGER_CANNOT_OVERRIDE_COMPUTED_JURY_OUTCOME`.
- `SWARM_STORES_REFERENCES_NOT_RAW_MODEL_BODIES`.
- `DIRECT_PEER_MESSAGING_IS_ABSENT`.
- `SWARM_HAS_ZERO_BROWSER_AUTHORITY`.

## R12 handoff

R12 should formalize integrity/provenance labels over information flow. It must track untrusted page/model/tool-derived influence across transformations and reject privileged sinks when required integrity is absent. The enforcement decision must be deterministic code, not another untrusted model judgment. Trusted declassification/endorsement must require an explicit capability and produce auditable provenance rather than silently clearing taint.
