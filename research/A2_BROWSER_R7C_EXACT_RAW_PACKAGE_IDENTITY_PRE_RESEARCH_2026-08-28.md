# A2 Browser Operator R7C — Exact Raw Skill Package Identity Pre-Research

Date: 2026-08-28
Branch: `work/a2-browser-r7-skill-runtime`
Parent head: `0be1e7839f4895619a26b02dff1fc6f576a366ba`
Milestone: `R7_SKILL_RUNTIME_V1`
Substep: `R7C_EXACT_RAW_PACKAGE_IDENTITY`

## Research trigger

R7A intentionally canonicalizes SKILL.md line endings before computing a semantic fingerprint. R7B similarly canonicalizes text resources for deterministic planner-facing content identity. That is desirable for semantic stability but insufficient as a software-supply-chain identity: two byte-distinct packages can normalize to the same semantic content.

## External comparison

### Sigstore

Sigstore's client verification architecture supports signing raw artifact bytes or a digest and recommends that a verifier accept the raw artifact and compute the digest itself to reduce confusion-attack risk. When verifying in-toto statements, the artifact digest/algorithm tuple must appear in the attestation subject.

A2 implication: a future attestation verifier must bind to exact delivered bytes, not to a canonicalized planner-facing string fingerprint.

Source: https://github.com/sigstore/architecture-docs/blob/main/client-spec.md

### TUF

TUF Targets metadata records cryptographic hashes and sizes for target files. Snapshot metadata exists to prevent mixing metadata from inconsistent repository states.

A2 implication: resource identity should record both exact SHA-256 and byte length, and package identity should represent one consistent set of files rather than independent semantic hashes.

Source: https://theupdateframework.io/docs/metadata/

### SLSA / in-toto

SLSA provenance is an in-toto attestation in which subjects and resolved dependencies are represented by resource descriptors with cryptographic digests. SLSA explicitly treats external parameters as untrusted and builder/system-produced data as a separate trust domain.

A2 implication: content identity, provenance verification and policy trust are separate stages. Merely computing a digest must not produce `signature_verified=true`, `provenance_verified=true`, or execution authority.

Sources:
- https://slsa.dev/spec/v1.2/
- https://slsa.dev/spec/v1.1/provenance

## R7C architecture

R7C adds an exact raw package identity plane above R7A/R7B:

1. Caller provides package files as bytes plus explicit regular-file/executable classification.
2. Every external field is snapshotted exactly once.
3. Every byte array is immediately copied into daemon-owned memory before validation/hashing, preventing caller mutation from rewriting the checked material.
4. Package paths are limited to root `SKILL.md` and one-level `references/`, `assets/`, `scripts/` resources.
5. Each exact file receives SHA-256 + raw byte length.
6. A deterministic directory-manifest digest binds skill name, sorted paths, exact file digests, byte lengths and executable-bit observations.
7. `SKILL.md` is independently decoded as strict UTF-8 and passed through R7A to produce the semantic skill fingerprint.
8. Raw package identity and semantic identity are explicitly separate fields.
9. Binary assets are allowed in raw package identity without being decoded or inserted into model context.
10. Revalidation recomputes exact identity and fails closed on package or semantic drift.

## Key proof

LF and CRLF SKILL.md packages should produce the same R7A semantic fingerprint but different per-file raw digests, byte lengths and R7C package-manifest digests. This demonstrates that semantic normalization cannot accidentally masquerade as artifact provenance.

## Non-goals

R7C does not verify signatures or Sigstore bundles. It reports `trust_state=CONTENT_IDENTITY_ONLY`, `signature_verified=false`, and `provenance_verified=false`. It does not execute scripts, interpret executable bits as permission, or grant browser/shell authority.

## Next research target

R7D should define a verifier-produced provenance receipt boundary: only a trusted verifier adapter may upgrade content identity into an attested source state. Raw skill metadata must be structurally unable to self-assert verification or execution authority.
