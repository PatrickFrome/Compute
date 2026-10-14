# W11 Wave 2 — Read-only release witness provenance boundary

This source-only conformance layer is stacked directly on the **current exact head of draft PR #1224** at development time: `5c4e5dc951266c5995f4c90c2db97e482c4cffba`. It does not alter the W11 identity reducer or install an adapter.

`inspectReleaseWitnessProvenance({ witnesses, issuerEvidence, hostObservation }, { nowMs, maxAgeMs })` first reuses `verifyReleaseEvidenceIdentity` (W11), the existing release-attestation verification **receipt schema** in `scripts/release-attestation-verification.mjs`, and `reduceHostProcessObservation` (W1). It checks independently present build/source/package values, existing issuer semantic receipt source/digest/repository shape and native Host/Guardian/OS incarnation consistency. Contradictions are `BLOCKED`; absent origin, issuer, Host or other evidence stays `UNKNOWN`.

**Security limit:** existing release-attestation receipt `cryptographic_verification: true`, issuer `trusted_root_sha256`, `signer_identity_verified`, source `verified`, and the W1 Host reducer's `AVAILABLE` are not independently verified trust roots when supplied as JSON. This module must not mistake them for signed provenance. It deliberately has **no authenticated positive state** or trust-establishing callback: all non-conflicting outcomes are `UNKNOWN`. Only an independently authenticated, in-process issuer and native Host/Guardian binding, wired separately through already approved platform mechanisms, could justify changing this ceiling. This source change does not create that authority.

The W11 `process_incarnation` is compared with the existing W1 Browser **child** incarnation ID for negative conformance only. The Host Owner's own PID/birth is checked by the pre-existing Host reducer, and the W11 owner ID is matched to it. The release observation must not predate the Browser child's OS creation time. A separate authenticated runtime source attestation is still missing.

No shell/SQL/HTTP/eval, new key, secret, task writer, cloud provider, fallback, retry, planner, release, installer or live-system effects are implemented. No raw receipt, process incarnation, identity or secret is returned. Output explicitly has `authenticity=UNKNOWN`, `release_ready=false`, and `authority_effect=false`.

Focused test command (CI on Linux + Windows Node 24):

```sh
node --test infra/client-state-runtime/operator-release-evidence-identity.test.mjs infra/client-state-runtime/operator-release-witness-provenance.test.mjs
```
