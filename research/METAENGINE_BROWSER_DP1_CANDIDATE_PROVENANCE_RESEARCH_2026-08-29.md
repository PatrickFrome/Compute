# METAENGINE Browser — DP1 Candidate Capsule Provenance Research

Date: 2026-08-29
Branch: `work/metaengine-browser-shell-v1`
Baseline: DP0 cross-platform VERIFIED at `327613cd5395d9d70c7f08d9ce582d6637a092f8`, GitHub Actions run `33247750048`.

## Goal

Make the embedded Development Plane useful as a browser-development brain without granting it the ability to replace the currently running browser, execute arbitrary commands, or treat page/LLM text as authority.

DP1 therefore produces and verifies a **candidate capsule**. A capsule is a non-executable, digest-bound statement describing a proposed development candidate and the evidence that future gates must verify.

## Research synthesis

### SLSA provenance

SLSA 1.2 defines provenance as verifiable information that traces an artifact through the supply-chain moving parts back to its source. Build provenance is specifically intended to bind outputs to the source and build process that produced them.

Sources:
- https://slsa.dev/spec/v1.2/provenance
- https://slsa.dev/spec/v1.2/build-provenance

Implication for METAENGINE: every development candidate must be bound to an exact source revision before any later build/promotion stage can claim provenance.

### in-toto

The stable in-toto specification and attestation framework model supply-chain claims around authorized steps and digest-identified materials/products. The key architectural lesson is to carry explicit digest identities between stages rather than relying on mutable filenames or narrative claims.

Sources:
- https://in-toto.io/docs/specs/
- https://in-toto.io/docs/getting-started/

Implication for METAENGINE: candidate components and evidence are represented by cryptographic digests, and the capsule itself receives a deterministic digest-derived identity.

### TUF

The Update Framework treats rollback and freeze as distinct update-system attacks. Preventing them requires trusted version/expiration state at the last-mile update layer, not merely a signed build artifact.

Sources:
- https://theupdateframework.io/docs/security/
- https://theupdateframework.io/docs/faq/

Implication for METAENGINE: DP1 may declare a candidate sequence, but it must **not** claim rollback protection yet. Monotonic enforcement belongs to a later promotion/update gate with durable trusted state.

### GitHub artifact attestations

GitHub artifact attestations cryptographically bind build artifacts to workflow/repository/commit context via Sigstore. GitHub explicitly notes that an attestation alone does not prove an artifact is safe; consumers still need policy-based verification.

Sources:
- https://docs.github.com/en/actions/concepts/security/artifact-attestations
- https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations

Implication for METAENGINE: DP1 records that signed build attestation is required before promotion, but does not mark the local candidate capsule as signed or promoted.

## DP1 contract

New read-only typed capabilities:
- `CANDIDATE_CAPSULE_CREATE`
- `CANDIDATE_CAPSULE_VERIFY`

Create requires a bounded structured payload containing:
- exact expected `source_head`;
- positive candidate `sequence`;
- human/agent intent treated as data, never executable instructions;
- 1..64 repo-relative component descriptors with `CREATE|MODIFY|DELETE` and SHA-256 digest;
- 1..32 named required verification gates (identifiers only, never commands);
- optional named evidence digests;
- optional previous candidate id.

The worker obtains the authoritative current repo head itself and rejects a mismatched requested source head.

The capsule is normalized, sorted where order is not semantic, canonicalized, and SHA-256 digested. Its `candidate_id` is derived from that digest. Verification independently reconstructs the canonical core, checks current source binding, verifies policy invariants, and recomputes the digest.

## Explicit non-authority

Every DP1 capsule states:
- `candidate_only=true`
- `executable=false`
- `direct_promote_current=false`
- `automatic_promotion=false`
- `arbitrary_eval=false`
- `page_command_authority=false`
- `browser_actuation_authority=false`
- `signed_attestation_required_before_promotion=true`
- `rollback_protection_enforced_at_promotion=false`
- `authority_effect=false`

The verify receipt states `promotion_authorized=false`.

## Why this is stronger than direct self-update

A direct self-update path would collapse proposer, builder, verifier, and actuator into one authority boundary. Candidate capsules keep those responsibilities separable. The Development Plane can reason about and prepare browser evolution now, while later milestones can add isolated build/test execution, signed attestations, monotonic promotion metadata, and rollback/recovery without retrofitting provenance after the fact.

## Next milestones

- **DP1**: deterministic candidate capsule + independent verification (this slice).
- **DP2**: isolated verification sandbox that can materialize a candidate in a non-current workspace and produce evidence, without promotion authority.
- **DP3**: attested promotion gate with durable monotonic sequence / rollback protection and explicit activation receipt.

No DP1 result is a release, update, or executable artifact.
