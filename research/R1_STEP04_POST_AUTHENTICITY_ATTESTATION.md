# R1 STEP04 — post-step sender-authenticity / source-attestation research

Status: RESEARCH_ADOPTED / authority gate not yet implemented  
Applies after: `R1 STEP04 — age PQ recovery encryption envelope`

## Finding

The age format provides confidentiality and ciphertext integrity relative to the randomly generated file key, but public-key encryption to a public recipient does not itself prove **who created the ciphertext**. Anyone with the public recovery recipient can construct a new valid age file addressed to that recipient.

Therefore:

- `ciphertext_sha256` proves object identity, not author identity;
- `receipt_sha256` proves deterministic integrity of the receipt JSON, not signer provenance;
- successful age decryption proves possession of a matching recipient identity, not trusted source authorship;
- provider retention/readback proves durable bytes, not trusted source authorship.

This distinction is mandatory before any future R2 authority transition.

Sources:
- https://c2sp.org/age
- https://github.com/FiloSottile/age/discussions/640
- https://github.com/FiloSottile/age/discussions/720

## Adopted fail-closed envelope contract

Every STEP04 envelope receipt now explicitly records:

- `sender_authenticity_proven=false`;
- `source_attestation_verified=false`;
- `source_attestation_required_before_authority=true`;
- `self_hash_is_not_sender_authentication=true`.

The validator rejects receipts that claim otherwise, even when their self-hash is internally consistent.

Provider upload and materialized readback may continue as **non-authoritative candidates**. A future authority-bearing DB ingestion / R2 seal must not proceed until a separate trusted source attestation is verified.

## Research after amendment: Sigstore + DSSE + in-toto

Current Sigstore documentation supports in-toto attestations and signs their payload with DSSE. Verification supports explicit signer identity and OIDC issuer constraints. Sigstore bundles package the signature/certificate/timestamp/transparency material needed for portable verification, including offline-oriented verification flows.

Sources:
- https://docs.sigstore.dev/cosign/verifying/attestation/
- https://docs.sigstore.dev/cosign/verifying/verify/
- https://docs.sigstore.dev/about/bundle/
- https://docs.sigstore.dev/about/the-importance-of-verification/

GitHub artifact attestations are also implemented with Sigstore and bind provenance claims to repository, workflow, commit, environment and OIDC identity. They are useful as an additional build-provenance amplifier, but verification policy remains mandatory; merely generating an attestation is not authority.

Source:
- https://docs.github.com/en/actions/concepts/security/artifact-attestations

## Proposed H205F22 source-attestation statement

Use a dedicated in-toto statement whose subject is the encrypted recovery artifact itself:

```json
{
  "_type": "https://in-toto.io/Statement/v1",
  "subject": [{
    "name": "metaengine-h205f22-recovery.age",
    "digest": {"sha256": "<ciphertext_sha256>"}
  }],
  "predicateType": "https://metaengine.dev/attestations/r1-recovery-source/v1",
  "predicate": {
    "envelope_receipt_sha256": "<receipt_sha256>",
    "bundle_sha256": "<plaintext_bundle_sha256>",
    "manifest_sha256": "<manifest_sha256>",
    "semantic_head": "<semantic_checkpoint_id>",
    "source_git_sha": "<git_sha>",
    "encryption_profile": "PRODUCTION_PQ_TWO_RECIPIENT_MIN"
  }
}
```

The exact predicate schema must be versioned before authority use.

## Verification policy required before authority

A source attestation is acceptable only when all are true:

1. DSSE/in-toto structure validates.
2. Subject SHA-256 equals locally materialized ciphertext SHA-256.
3. Predicate envelope receipt SHA-256 equals the independently validated STEP04 receipt.
4. Predicate bundle/manifest identity matches the STEP03/STEP04 chain.
5. Signer identity matches an explicit trusted H205F22 identity policy.
6. OIDC issuer matches the explicitly trusted issuer.
7. Sigstore verification bundle / transparency evidence verifies according to the selected trust root.
8. Semantic head and source Git SHA satisfy the current supervisor policy.
9. Verification is fresh enough for the authority action being attempted.

No wildcard signer identity is acceptable for R2 authority.

## Separation of planes

- **age**: confidentiality + ciphertext integrity.
- **provider Object Lock / retention**: durable immutable-ish storage evidence.
- **materialized readback verifier**: byte identity and two-domain independence candidate.
- **Sigstore/DSSE/in-toto**: trusted source provenance binding.
- **Supabase continuity authority gate**: combines all required independent evidence; none of the individual planes may self-seal.

## Strict nonclaims

- no production source attestation has been generated;
- no signer identity has been authorized by this research file;
- no Sigstore verification receipt has been ingested into Supabase;
- no R2/R3 proof exists from this research;
- no H47C persisted seal is permitted by this research alone.

## Next use

`R1 STEP05` provider replication may proceed with non-authoritative candidate receipts, but any later source-attestation ingestion / R2 authority step MUST enforce this boundary first.
