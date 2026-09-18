# METAENGINE Browser — Multi-Gateway Advisory Evidence Bridge v1

Date: 2026-08-29
Branch: `work/metaengine-browser-shell-v1`
Validated runtime head before this documentation commit: `afc5554422dc911bd3be4cbcf704ec8828b351ba`
GitHub Actions: METAENGINE Browser Shell V1 run `33249546379` = SUCCESS
Development Plane protocol: `0.4.0`

## Purpose

Bind model-federation / multi-gateway advisory evidence into the Browser Development Plane without granting model, gateway, page, or evidence payload any execution authority.

This slice is cross-plane interoperability only. It does not complete DP2, F1, sandbox execution, browser actuation, or promotion.

## Producer contract

The F1 multi-gateway plane emits `metaengine.advisory-evidence-envelope.v1` as a digest-bound wrapper around an already validated advisory receipt. Supported gateway-plane identities include Vercel AI Gateway, Vercel live peer projects, Supabase live peer broker/decision rails, GitHub Models probes, Cloudflare Workers AI probes, and proved-local open-model probes.

The envelope is deliberately advisory-only and carries:

- task / trace / request identity;
- gateway-plane and route identity;
- source receipt schema and digest;
- served model identities;
- availability / decision metadata;
- tariff dependency;
- fixed public-or-non-sensitive data policy;
- a canonical SHA-256 envelope identity.

It cannot assert semantic truth, direct action, browser authority, development authority, sandbox execution authority, promotion authority, or canonical project authority.

## Independent Browser verifier

`apps/metaengine-browser/src/advisory-evidence-verifier.cjs` is an independent implementation of the wire contract. It does not import the F1 producer implementation.

It:

- requires an exact object shape and rejects hidden fields;
- validates gateway plane, transport and receipt-kind allowlists;
- validates request/object SHA-256 identities and optional trace identity;
- requires `HASH_BOUND_ADVISORY_UNATTESTED` trust state;
- rejects self-upgrade to attested or persisted-readback trust;
- rejects truth, direct-action, browser, development, sandbox-execution, promotion, canonical, or authority escalation;
- independently recomputes the canonical envelope digest.

A fixed cross-plane fixture is verified against digest:

`b5cba0627de9c6c41cfb51e2fd724d66c0f8199c0091b7b9d4866497115741c9`

This prevents the producer and verifier from sharing one implementation and agreeing on the same accidental behavior.

## Development Plane capability

Development Plane `0.4.0` adds exactly one new typed payload capability:

`ADVISORY_EVIDENCE_VERIFY`

The utility worker verifies the envelope offline. It does not call any gateway and receives no new network or browser capability.

The capability surface explicitly reports:

- `advisory_evidence_verification=true`
- `advisory_evidence_network_dispatch=false`
- `advisory_evidence_browser_authority=false`
- `advisory_evidence_promotion_authority=false`
- `verification_sandbox_execution=false`
- `sandbox_backend_bound=false`
- `direct_promote_current=false`
- `arbitrary_eval=false`

## Physical proof

Run `33249546379` passed the full Browser Shell workflow at `afc5554422dc911bd3be4cbcf704ec8828b351ba`.

The real Electron smoke sends the fixed F1 wire fixture through the actual `utilityProcess` Development Plane and requires:

1. DP `0.4.0` exact capability handshake;
2. DP1 candidate create/verify remains non-executable and non-promotable;
3. DP2 sandbox plan remains PREPARE_ONLY, backend-unbound and execution-unauthorized;
4. advisory evidence validates to the exact fixed SHA-256;
5. trust remains `HASH_BOUND_ADVISORY_UNATTESTED`;
6. direct action, browser authority, development authority, sandbox execution authority and promotion authority all remain false;
7. cooperative shutdown ACK and observed STOPPED state.

## Multi-gateway boundary

The Browser does not choose a model by branding and does not trust a gateway because it is deployed. Multi-gateway routing belongs to the federation plane and must be evidence-driven. The Browser receives only normalized advisory evidence and independently verifies it before it can be considered by Supervisor logic.

Nested routing rule:

- a gateway such as Vercel AI Gateway may perform provider/model fallback inside one gateway rail;
- METAENGINE may later select among independent gateway rails using qualification evidence and failure-domain diversity;
- neither layer grants browser authority.

## Non-claims

- No model or gateway network request is made by Development Plane.
- No gateway output is treated as semantic truth.
- No F1 milestone is VERIFIED by this slice.
- No physical DP2 sandbox backend is authenticated or bound.
- No sandbox command execution exists.
- No candidate is promoted, activated, or allowed to overwrite the running system.
- No page-derived or model-derived data gains authority.

## Next gates

1. `DP2_PHYSICAL_SANDBOX_BACKEND_BINDING_V1`: authenticate a real provider control-plane lifecycle and bind immutable input/runtime/image/network/teardown evidence.
2. Converge DP2 and Compute Fabric A1 on a shared environment envelope instead of creating separate sandbox semantics.
3. Upgrade multi-gateway qualification from hash-bound advisory evidence to persisted-readback and/or attested qualification receipts before any automatic route execution.
4. Keep DP3 promotion authority separate from both sandbox execution and multi-gateway reasoning.
