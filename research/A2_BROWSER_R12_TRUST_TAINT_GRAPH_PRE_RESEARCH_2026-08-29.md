# A2 Browser R12 — Trust / Taint Graph — Pre-Implementation Research

Date: 2026-08-29
Parent authoritative milestone: R11 `d768954aa541e5927ddf14d5bb751a9a7620a6aa`
Roadmap milestone: `R12_TRUST_TAINT_GRAPH_V1`

## Goal

Formalize provenance/integrity flow so page, model, tool and other external data can inform reasoning and action arguments without ever becoming authority merely because a model copied or transformed it.

R12 owns:
- typed source trust classes;
- provenance-preserving derivation;
- taint/integrity propagation;
- strict separation of authority inputs from data inputs;
- deterministic privileged-sink checks;
- explicit scoped endorsement with an injected trusted verifier;
- minimal requested-capability validation.

R12 has no browser, network, model or process side effects.

## Research findings

OpenAI's current prompt-injection guidance frames third-party content as a social-engineering channel and recommends limiting agent access and reviewing consequential actions. OpenAI's 2026 agent-security guidance emphasizes constraining the impact of manipulation even when input filtering is imperfect.

OWASP's current prompt-injection guidance recommends least privilege, handling extensible functions in code, human approval for high-risk actions, and explicit segregation of external content.

Recent information-flow-control research for AI agents (Fides) models confidentiality/integrity labels and deterministic enforcement rather than relying on model judgment. Classical IFC similarly separates principals/authority from tracked information flow.

## Architecture decision

A2 does not use a single boolean taint bit as the entire policy. Each graph node retains:
- immutable provenance parents;
- source classes;
- integrity class;
- taint-source ids;
- authority eligibility;
- bounded authority capabilities / endorsement scopes.

Trusted authority and untrusted data are passed into sink assessment separately:

```text
trusted directive / signed policy ---------> authority input ----+
                                                                |
page/model/tool data -> transformations ---> data inputs --------+--> deterministic sink check
```

Untrusted data may be accepted as arguments while remaining tainted. It never satisfies the authority requirement.

## Source classes

Authority-capable trusted sources:
- `LOCAL_POLICY`
- `SIGNED_SUPERVISOR_DIRECTIVE`
- `USER_CONFIRMED_ACTION`

Evidence-only sources:
- `VERIFIED_TEST_EVIDENCE`
- `ATTESTED_BUILD_EVIDENCE`

Untrusted sources:
- `PAGE_DATA`
- `MODEL_OUTPUT`
- `TOOL_OUTPUT`
- `EXTERNAL_FILE`
- `EXTERNAL_MESSAGE`

Caller input cannot relabel a source class' integrity category.

## Derivation

Derivation is conservative:
- any UNTRUSTED parent => derived integrity UNTRUSTED;
- otherwise any EVIDENCE parent => EVIDENCE;
- otherwise TRUSTED;
- authority eligibility survives only if every parent is authority eligible;
- taint sources are unioned and never silently removed.

This intentionally forces code to keep authority and data as separate lanes instead of concatenating them into one authority-bearing object.

## Endorsement

A scoped endorsement may create an `ENDORSED` derivative only when an injected trusted verifier confirms a bounded endorsement object. Taint provenance is retained. Endorsement grants only explicit sink scopes; it does not globally convert the object into TRUSTED data.

## Privileged sinks

Canonical sink kinds:
- `BROWSER_ACTUATION`
- `LOCAL_EXEC`
- `NETWORK_WRITE`
- `SECRET_READ`

Sink assessment requires:
1. authority node is authority eligible;
2. authority capability/scope covers the exact sink;
3. requested capabilities are a subset of the authority node's granted capabilities;
4. data nodes contribute no authority.

For BROWSER_ACTUATION, any tainted data input causes `live_revalidation_required=true` in the assessment receipt. The check itself remains non-actuating.

## Invariants

- `PAGE_MODEL_TOOL_DATA_NEVER_GRANTS_AUTHORITY`.
- `TAINT_PROVENANCE_IS_MONOTONIC_ACROSS_DERIVATION`.
- `AUTHORITY_AND_DATA_ARE_SEPARATE_SINK_INPUTS`.
- `PRIVILEGED_SINK_CHECK_IS_DETERMINISTIC_CODE`.
- `REQUESTED_CAPABILITIES_MUST_BE_MINIMAL_SUBSET`.
- `ENDORSEMENT_IS_EXPLICIT_SCOPED_AND_AUDITABLE`.
- `ENDORSEMENT_RETAINS_UNTRUSTED_PROVENANCE`.
- `TAINTED_BROWSER_ARGUMENTS_REQUIRE_LIVE_REVALIDATION`.
- `TRUST_TAINT_GRAPH_HAS_ZERO_ACTUATION_AUTHORITY`.
