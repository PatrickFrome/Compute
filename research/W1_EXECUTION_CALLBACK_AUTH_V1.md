# W1 Execution Callback Authentication V1

Status: source implementation only; not deployed and not live evidence.

This slice replaces the abstract callback-auth placeholder with a concrete enrollment-bound asymmetric signature path.

## Trust split

1. `Metaengine-W1-Callback-Key-Enroll-H205F22` is parameterless. SSM root transport creates/validates `/var/lib/metaengine/w1/identity`, then drops to `metaengine-w1`. The non-root account creates a persistent P-256 private key at mode `0600`; only the public JWK is emitted. The SSM invocation target plus IMDSv2 instance-id readback bind the public key candidate to one EC2 instance. The private key is never returned by the document.
2. `Metaengine-W1-Execution-Marker-H205F22` accepts only non-secret correlation values with `interpolationType=ENV_VAR` and strict patterns. It deliberately has no `{{...}}` fallback: SSM Agent versions that do not provide ENV_VAR interpolation fail closed instead of receiving raw command substitution.
3. The non-root worker signs `DOMAIN || canonical(marker)` using ECDSA P-256/SHA-256. OpenSSL DER signatures are normalized to fixed 64-byte IEEE-P1363 `r || s`, matching Web Crypto ECDSA verification semantics.
4. Network default-deny remains a worker-plane property: `metaengine-w1` does not perform the callback HTTP request. The root SSM courier posts the already-signed envelope to one fixed Supabase Edge URL and suppresses the HTTP response from SSM stdout.
5. The Edge ingress is intentionally `verify_jwt=false` because it is an external signed-callback endpoint. It performs its own P-256 verification, checks key registry binding, freshness, exact digest fields and nonauthority booleans, then records only a non-authority callback receipt.
6. `controller/w1/w1_callback_signature_guard.py` independently repeats the cryptographic verification off-host before the existing execution-marker correlation guard may consume the callback attestation.

## Research basis rechecked 2026-08-28

- AWS SSM document parameter security: environment-variable interpolation plus `allowedPattern` reduces command-injection risk. AWS documents that agents before 3.3.2746.0 ignore `interpolationType`; this implementation therefore requires the `SSM_*` variables and has no direct-substitution fallback.
  - https://docs.aws.amazon.com/systems-manager/latest/userguide/documents-syntax-data-elements-parameters.html
  - https://docs.aws.amazon.com/systems-manager/latest/userguide/documents-creating-content.html
  - https://docs.aws.amazon.com/systems-manager/latest/userguide/documents-schemas-features.html
- AWS `SendCommand` can pin document version and the system-created SHA-256 `DocumentHash`; live dispatch must use both rather than `$LATEST`/`$DEFAULT`.
  - https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_SendCommand.html
- EC2 instance identity signatures authenticate the instance identity document itself. They are not signatures over arbitrary callback payloads; IID is therefore not used as callback-body authentication.
  - https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/verify-iid.html
- Web Crypto ECDSA represents P-256 signatures as concatenated fixed-width `r || s` (IEEE-P1363), while OpenSSL commonly emits ASN.1 DER. The repository has an explicit DER↔P1363 boundary and an interoperability test.
  - https://www.w3.org/TR/WebCryptoAPI/#ecdsa
  - https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/sign
  - https://docs.deno.com/examples/ecdsa_signing/
- Supabase external webhook-style functions may disable platform JWT verification only when they authenticate the request themselves. Secrets remain server-side; new `sb_secret_...` keys are used through the `apikey` header, not as bearer JWTs.
  - https://supabase.com/docs/guides/functions/function-configuration
  - https://supabase.com/docs/guides/functions/secrets

## Replay and freshness semantics

`ChallengeNonce` is a per-dispatch 256-bit non-secret correlation value and is signed into the marker. In this source slice it is verified off-host against the expected dispatch value. The public Edge ingress additionally enforces a five-minute marker freshness window and marker-id idempotency in the PREP persistence contract. This is intentionally not described as an authority-bearing one-time nonce ledger; a future dispatch ledger may tighten it without changing the signature format.

## PREP-only persistence

`supabase/prep/w1_callback_auth_v1.sql` is not a migration and was not applied. It defines, for later protected use:

- provider-bound public-key registry with explicit revocation;
- append-only execution callback receipts;
- service-role-only, `SECURITY INVOKER` registration/revocation/read/record functions;
- no worker admission, reboot proof, persistence proof, roadmap mutation, canonical mutation, or W1 verification.

## Nonclaims

A successful signature proves only possession of the enrolled private key for the signed marker bytes, subject to the independent SSM enrollment binding. It does not prove host safety, reboot completion, persistence across reboot, worker admission, canonical status, or W1 verification. No source or CI result from this slice may be promoted to live W1 evidence.
