# F1 live external federation

This workstream is evidence-only until Supervisor acceptance.

Trust boundary:

- A GitHub-hosted Actions runner is the real external provider execution environment.
- The producer receives GitHub OIDC permission only long enough to create a Sigstore-backed artifact attestation.
- A separate verifier job has no OIDC minting permission and verifies repository, workflow identity, source ref, source digest, issuer, and hosted-runner policy with `gh attestation verify`.
- A matching SHA-256 digest is transport/content binding only; it is never sufficient for cryptographic verification.
- Evidence expires, is bound to run ID and attempt with a replay nonce, supports explicit signer-identity revocation, and carries a trust generation for rotation.
- All resulting receipts remain `canonical=false` and `authority_effect=false` until Supervisor acceptance.

Hard invariants: `FETCHED != VERIFIED`, `CONTENT_HASH_ONLY != CRYPTO_VERIFIED`, and synthetic execution never counts as live execution.
