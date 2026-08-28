# A2 Browser Operator R7D — Session-Bound Provenance Verifier Receipts Pre-Research

Date: 2026-08-28
Branch: `work/a2-browser-r7-skill-runtime`
Parent head: `ed01cf27bc2d1bd8f7c33327c17ca32f7bc71088`
Milestone: `R7_SKILL_RUNTIME_V1`
Substep: `R7D_SESSION_BOUND_PROVENANCE_RECEIPTS`

## Research trigger

R7C now distinguishes semantic skill identity from exact raw package identity. The next question is how a package may acquire a verified source state without trusting claims inside `SKILL.md`, resource metadata, or arbitrary JSON returned by the package itself.

## External comparison

### SLSA Verification Summary Attestation (VSA)

SLSA v1.2 defines a Verification Summary Attestation produced by a verifier after evaluating an artifact against policy. The statement records the verifier, policy, exact subject digest, and a verification result such as `PASSED`. Verification consumers must validate the attestation/signature, subject digest, predicate type, verifier identity, policy, and result rather than accepting a self-declared boolean.

A2 implication: provenance state must be produced by a separately configured verifier boundary and bound to the exact R7C package digest.

Source: https://slsa.dev/spec/v1.2/verification_summary

### Sigstore verification

Sigstore verification is not merely signature parsing. Verification includes cryptographic signature validation, expected signer identity, issuer/trust-root validation, and when applicable transparency-log evidence. Sigstore's threat model explicitly warns that a signed artifact is not automatically trustworthy; consumers must define acceptable signer identities and issuers.

A2 implication: the verifier adapter may report evidence, but daemon-owned policy must independently configure the exact expected signer identity and issuer. The adapter cannot choose who is trusted by returning `verifierIdentityVerified=true`.

Sources:
- https://docs.sigstore.dev/cosign/verifying/verify/
- https://github.com/sigstore/architecture-docs/blob/main/threat_model.md

### GitHub artifact attestations

GitHub artifact attestations are Sigstore-backed and are meaningful only when cryptographically verified against an expected repository/workflow identity. Digest lookup alone is discovery, not a trust decision.

Sources:
- https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/verifying-the-authenticity-of-artifacts
- https://docs.github.com/en/rest/repos/repos#list-attestations

## R7D architecture

R7D introduces a verifier-produced receipt boundary, but deliberately does **not** make that receipt durable authority.

1. A verifier instance is constructed only by daemon-owned code with:
   - verifier URI;
   - policy URI + SHA-256 digest;
   - exact expected signer identity;
   - exact expected signer issuer;
   - a trusted verifier adapter function.
2. The package supplies no trust configuration. Its R7C package identity must already be non-authoritative.
3. Attestation bytes are copied before asynchronous verification and bounded to 1 MiB.
4. The verifier adapter receives immutable expected subject/policy/signer information plus a copy of the attestation bytes.
5. Adapter output fields are snapshotted exactly once and normalized inside the adapter error boundary.
6. `PASSED` requires all of:
   - exact subject digest equals R7C package-manifest digest;
   - cryptographic signature verified;
   - returned signer identity exactly equals daemon-configured signer identity;
   - returned issuer exactly equals daemon-configured issuer;
   - verifier adapter identity check true;
   - policy check true.
7. Exception or malformed adapter result becomes typed `VERIFIER_ADAPTER_ERROR`.
8. The receipt is authenticated with a random 256-bit verifier-session HMAC key held only in the verifier closure.
9. Receipt replay into another verifier process/session fails even under identical policy configuration.
10. Receipt revalidation also binds exact package digest + semantic fingerprint + verifier + policy + signer + issuer.

## Why session-bound receipts first

A durable verification receipt requires its own signing/key lifecycle, rotation, revocation, storage, and replay model. R7D intentionally avoids pretending an in-memory assertion is durable provenance. It emits:

- `session_bound=true`
- `durable_verification_receipt=false`

This allows safe same-process composition in later R7 steps while keeping persistent trust claims out of scope until an independently designed durable receipt format exists.

## Authority boundary

Even a valid `PASSED` receipt has:

- `authority_effect=false`
- `execution_eligible=false`
- `script_execution_exposed=false`

Verification answers “did a trusted verifier validate this exact package under this policy?” It does not answer “may this package execute shell/browser actions?”. Execution capability remains a separate typed policy/lease problem.

## Adversarial verification plan

- exact subject/signer/issuer/policy -> PASSED;
- signer mismatch despite all adapter booleans true -> FAILED;
- issuer mismatch despite all adapter booleans true -> FAILED;
- subject digest mismatch -> FAILED;
- forged JSON or mutated receipt -> HMAC rejection;
- receipt copied across verifier sessions -> rejection;
- caller mutation of attestation bytes during async verification -> no effect;
- stateful getter result fields -> read exactly once;
- verifier exception/malformed result -> typed FAILED;
- oversized attestation -> fail closed.

## Follow-up

R7E should integrate the proven skill planes into a daemon-owned read-only skill registry/provider abstraction. Filesystem discovery must be researched separately because pathname validation alone is not enough to defeat symlink/replacement races between directory enumeration and file reads.
