# A2 Browser R11 — Same-Point Swarm — Pre-Implementation Research

Date: 2026-08-29
Parent authoritative milestone: R10 `23dad9bdf117f7d732bf01da5866bdec46f206be`
Roadmap milestone: `R11_SAME_POINT_SWARM_V1`

## Goal

Build a manager-controlled same-point reasoning protocol on top of R9 fleet/evidence identities and R10 role-specific context capsules without creating any browser authority.

R11 owns:
- blind independent proposal collection;
- phase-gated proposal disclosure;
- cross-critique;
- required falsifier/security evidence for critical points;
- evidence-bound jury votes;
- deterministic jury sealing.

R11 does not invoke models, send browser actions, create workers, or mutate R9/R10 source objects.

## Research findings

### Parallel independence

Anthropic's production multi-agent research architecture uses an orchestrator-worker pattern with parallel subagents and explicitly cites separate context windows / independent exploration trajectories as a major benefit. It also reports substantial coordination and token cost. This supports using multiple agents selectively for high-value SAME_POINT work while retaining one manager and bounded phases.

### Judge/debate separation

OpenAI's debate research separates competing arguments from the judging function. The exact training setup is not copied here, but the architectural lesson is useful: proposers should not also be the sole authority that decides whether their own answer won.

### Avoid unconstrained group chat

AutoGen demonstrates flexible multi-agent group conversation and a manager agent. R11 deliberately does not expose a generic peer-message bus. Free conversation would undermine proposal independence and create an echo-chamber path before independent evidence is captured.

## Protocol

```text
PROPOSING (blind)
   |
   | manager closes only after every proposer submitted
   v
CRITIQUING
   |
   | every proposal requires >=1 critique by a different agent
   v
ADVERSARIAL   [CRITICAL only]
   |-- FALSIFIER evidence required
   |-- SECURITY evidence required
   v
JURY
   |-- evidence-bound votes
   |-- quorum
   |-- strict majority for ACCEPT/REJECT
   v
SEALED
```

STANDARD points skip ADVERSARIAL after critique coverage. CRITICAL points cannot enter JURY until both falsifier and security evidence are present.

## Blindness boundary

During `PROPOSING`, a proposer-facing proposal view returns only that proposer's own proposal. Other proposal identities become visible only after the manager closes the proposal phase. Blindness is therefore enforced by the swarm API, not merely requested by prompt wording.

## Evidence binding

All submitted evidence ids are resolved through an injected read-only evidence resolver compatible with R9's blackboard. R11 verifies:
- exact same `point_id`;
- exact author identity;
- expected evidence kind;
- critique references an existing peer proposal;
- jury evidence references all proposal ids plus required adversarial evidence.

R11 stores evidence ids and verdict metadata only, never raw response bodies.

## Jury semantics

Each JURY participant may vote once with `ACCEPT`, `REJECT`, or `UNRESOLVED`. A manager may seal only after quorum. A strict majority of all submitted votes is required for ACCEPT or REJECT; otherwise the swarm seals UNRESOLVED. The manager cannot override the computed outcome.

## Security invariants

- `BLIND_PROPOSALS_NOT_VISIBLE_TO_PEER_PROPOSERS_BEFORE_CLOSE`.
- `MANAGER_OWNS_PHASE_TRANSITIONS`.
- `SELF_CRITIQUE_IS_FORBIDDEN`.
- `EVERY_PROPOSAL_REQUIRES_CROSS_CRITIQUE`.
- `CRITICAL_REQUIRES_FALSIFIER_AND_SECURITY_EVIDENCE`.
- `JURY_VOTE_MUST_REFERENCE_REQUIRED_EVIDENCE`.
- `MANAGER_CANNOT_OVERRIDE_COMPUTED_JURY_OUTCOME`.
- `SWARM_STORES_REFERENCES_NOT_RAW_MODEL_BODIES`.
- `SWARM_HAS_ZERO_BROWSER_AUTHORITY`.
- `DIRECT_PEER_MESSAGING_IS_ABSENT`.
