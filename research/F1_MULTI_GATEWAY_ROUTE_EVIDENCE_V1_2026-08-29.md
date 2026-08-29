# F1 Multi-Gateway Route Evidence v1

Date: 2026-08-29
Branch: `work/f1-multimodel-vercel-gateway-v1`
Validated code head before this documentation commit: `64884691f0b9934d6ee436561ce3794f7b5a43a1`
F1 Model Gateway Contract run `33249708923` = SUCCESS
Authority: `canonical=false`, `authority_effect=false`

## Purpose

Create a model-independent multi-gateway advisory layer that can normalize and route across multiple model/gateway rails without granting the routing layer browser, development, sandbox-execution, or project-promotion authority.

## Layering

Routing is explicitly two-level:

1. A provider gateway may perform provider/model fallback inside one rail.
2. METAENGINE selects among independent gateway planes using measured qualification evidence, freshness and failure-domain diversity.

A READY deployment, a catalog entry, a free price, or a model brand is never sufficient qualification evidence.

## Advisory evidence envelope

`metaengine.advisory-evidence-envelope.v1` normalizes evidence from:

- Vercel AI Gateway;
- Vercel live peer projects;
- Supabase live peer broker;
- Supabase peer-decision rail;
- GitHub Models probes;
- Cloudflare Workers AI probes;
- proved-local open-model probes.

The envelope is canonical-JSON/SHA-256 bound and fixed to:

- `advisory_only=true`;
- `requires_supervisor_arbitration=true`;
- `direct_action_allowed=false`;
- `browser_authority=false`;
- `development_authority=false`;
- `sandbox_execution_authority=false`;
- `promotion_authority=false`;
- `semantic_truth_claimed=false`;
- `canonical=false`;
- `authority_effect=false`.

Self-reported evidence cannot upgrade itself from `HASH_BOUND_ADVISORY_UNATTESTED` to attested or persisted-readback trust.

The live committee API now emits this envelope after independently re-validating the committee and supervisor advisory receipt.

## Route planner

`metaengine.multi-gateway.route-plan.v1` supports four distinct strategies:

- `STRUCTURED`
- `DIVERSE_ADVISORY`
- `TIEBREAK`
- `QUALIFICATION`

Each candidate rail is described by gateway plane, route, transport, failure domain, model identities, availability, observation time, latency, qualification state, evidence digest, tariff dependency and data policy.

The planner fails closed on stale/future evidence, invalid identities, unsafe data policy, duplicate rails or unsupported gateway/transport values.

Quality routes exclude rails for:

- `STALE_EVIDENCE`
- `UNAVAILABLE`
- `TRANSPORT_UNQUALIFIED`
- `QUALITY_UNQUALIFIED`
- `QUORUM_INELIGIBLE`
- `STRUCTURED_UNQUALIFIED`
- `FAILURE_DOMAIN_NOT_INDEPENDENT`

`QUALIFICATION` may use a transport-only rail, but the resulting plan still declares `availability_is_not_quality=true` and remains advisory-only.

`DIVERSE_ADVISORY` requires at least two distinct failure domains; two models behind one correlated rail cannot fabricate independent quorum.

`TIEBREAK` can exclude failure domains already used in the preceding deliberation.

## Current live qualification evidence

The existing Supabase live broker has real observed inference for Gemma2, Llama32, Nemotron, TinyLlama and Llama2 with differentiated roles. In particular:

- Gemma2 and Llama32 have demonstrated structured usefulness;
- Nemotron is advisory-diverse but requires an incomplete-reasoning fence;
- TinyLlama is transport-available but quality-ineligible;
- Llama2 is a late backup because of reservation cost/quota behavior.

This distinction is preserved by the planner: transport availability cannot count as quality quorum.

## Tariff semantics

A currently zero-price remote route remains `tariff_dependency=true` unless independent evidence proves the execution is local/tariff-independent. Routing may prefer a proved-local rail, but tariff metadata is evidence and never authority.

## Verification

At validated code head `64884691f0b9934d6ee436561ce3794f7b5a43a1`, F1 Model Gateway Contract run `33249708923` completed SUCCESS.

Tests prove:

- blocked Vercel AI Gateway cannot be selected merely because the rail exists;
- deployment-only Vercel projects do not qualify without transport evidence;
- structured Supabase broker evidence can qualify the relevant route;
- same-failure-domain rails cannot fake diverse quorum;
- stale evidence is rejected;
- availability-only peers cannot enter quality routes;
- tiebreak excludes already-used failure domains;
- all route plans retain zero action/promotion authority.

## Current trust limitation

The route planner is currently a pure planning primitive. Its rail observations are not yet a trusted runtime registry. Automatic route execution must not be exposed until qualification state itself is derived from persisted-readback and/or signed/attested receipts rather than caller-provided booleans.

## Next gates

1. Introduce a qualification receipt/registry that upgrades a rail only from independently verified live evidence.
2. Bind advisory envelopes to persisted readback or attestation without granting semantic-truth authority.
3. Expose route execution only after the registry, with bounded task/data policy and Supervisor arbitration.
4. Keep model/gateway routing completely separate from Browser capability authority and DP3 promotion authority.
