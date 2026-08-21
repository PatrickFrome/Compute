# R1 STEP04 — age PQ recovery encryption envelope

Status: PREPARE_ONLY / source support plane  
Canonical Level-1: CROSS-CUTTING support for `R1_CONTINUITY_PLANE_ADOPTION`  
Semantic head at design start: `metaengine-h205f22-recovery-dev-20260821-cp072`

## Research before implementation

### Managed Supabase recovery source remains logical and incomplete by default

Current Supabase documentation states that modern eligible projects use platform-managed physical backups, while a user-created portable logical backup is generated with `supabase db dump` or `pg_dump`. Supabase also explicitly states that database backups do **not** include the actual bytes stored through the Storage API; the database contains metadata for those objects. Therefore STEP03 correctly emits an explicit Storage coverage flag instead of silently claiming a full platform backup.

Sources:
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/troubleshooting/download-logical-backups

### age v1.3.1 is the current stable release selected for this contract

The upstream age release page currently lists v1.3.1 as latest. The official Linux amd64 release archive publishes SHA-256:

`bdc69c09cbdd6cf8b1f333d372a1f58247b3a33146406333e30c0f26e8f51377`

The workflow downloads only that release asset and verifies this digest before running the real round-trip test.

Source:
- https://github.com/FiloSottile/age/releases/tag/v1.3.1

### Production recipient policy: native hybrid ML-KEM-768 + X25519

age v1.3 introduced native post-quantum hybrid recipients. The current age manual describes native hybrid recipients as X25519 + ML-KEM-768 and recommends the hybrid recipient type for most applications. Hybrid public recipients begin with `age1pq1`; corresponding private identities begin with `AGE-SECRET-KEY-PQ-1`.

Classic `age1...` X25519 recipients remain interoperable, but this project does not make classic-only recovery recipients the production default. `COMPATIBILITY_TEST_ONLY` exists only to test migration/backward-compatibility behavior and is never external-storage-ready.

Sources:
- https://github.com/FiloSottile/age/releases/tag/v1.3.0
- https://github.com/FiloSottile/age/blob/main/doc/age.1.ronn

### Why ciphertext must be created once

The C2SP age format specification defines a fresh random symmetric file key for every age file. Therefore encrypting the same plaintext twice is expected to create different ciphertext. R2 cross-provider identity must consequently be defined as:

`encrypt one reviewed recovery bundle once -> hash ciphertext -> copy those exact ciphertext bytes to provider A and provider B`

It must **not** be defined as “encrypt independently once for each provider”.

The age specification also states that the file consists of a recipient-wrapped header plus encrypted binary payload and that age files are not malleable without knowledge of the file key.

Source:
- https://github.com/C2SP/C2SP/blob/main/age.md

## Security / authority contract

Production envelope requirements:

1. Input STEP03 bundle receipt self-hash must verify.
2. Bundle bytes and SHA-256 must match the STEP03 receipt.
3. Recipient file must contain at least two unique public recipients.
4. Production profile requires every recipient to be a native `age1pq1...` hybrid recipient.
5. Private identity material is rejected in recipient files.
6. Plugin/unknown recipient types are rejected from the production wrapper to keep the crypto dependency explicit and reviewable.
7. The exact age v1.3.1 binary is required by the source contract.
8. Ciphertext output must not already exist; accidental overwrite/re-encryption is rejected.
9. Ciphertext and its envelope receipt are mode 0600 where the filesystem supports it.
10. Recipient public keys are not copied into the receipt; only SHA-256 fingerprints and recipient kinds are stored.
11. No provider SDK, Supabase SDK, DB write, KMS SDK, or home-grown cryptographic primitive exists in the wrapper.
12. The envelope remains non-authoritative: `canonical=false`, `r2_proven=false`, `r3_proven=false`, `persisted_seal_allowed=false`.

## Resulting identity model

STEP03 establishes deterministic plaintext identity:

`bundle_sha256`

STEP04 adds one encrypted artifact identity:

`ciphertext_sha256`

The only object eligible for two-provider replication is the exact STEP04 ciphertext. The plaintext bundle remains local-only and must never be uploaded as the R2 artifact.

Provider-side ETag/checksum metadata can be retained as auxiliary evidence, but R2 must independently materialize the object bytes and recompute SHA-256 using the STEP02 verifier.

## CI proof plan

The CI gate has two layers:

- pure offline adversarial unit tests with no crypto/network dependency;
- a real integration test using the exact official age v1.3.1 Linux amd64 archive after verifying the upstream-published archive SHA-256.

The real integration test generates two ephemeral PQ identities, encrypts to both public recipients, decrypts with one identity and compares exact plaintext bytes. It then encrypts the same plaintext a second time and requires the ciphertext SHA-256 to differ, proving why provider B must receive a copy of provider A's ciphertext object rather than a second encryption.

All generated identities are ephemeral CI fixtures only. No project recovery private key is created or stored by this PR.

## Research after implementation — binary provenance amplifier

Post-implementation research found that age v1.2.0+ prebuilt binaries publish **Sigsum transparency proofs**, not only release-page SHA-256 values. The upstream `SIGSUM.md` describes these proofs as cryptographically verifiable evidence that the released artifact was recorded in a public append-only transparency log, and publishes the two SSH Ed25519 verification keys plus the exact verification command.

For v1.3.1 Linux amd64 the published proof asset SHA-256 is:

`91331dc8ed9b5a0f4317ef6e7c261e49dfc2f11249a1775120a81361349d4c92`

Adopted amplifier:

1. pin the archive SHA-256;
2. pin the `.proof` SHA-256;
3. pin `sigsum-verify@v0.13.1` as shown by upstream;
4. verify the proof with the upstream-published age signing keys and `sigsum-generic-2025-1` policy;
5. only then extract and execute the age binary.

This is stronger than checksum-only validation: a checksum copied from the same compromised release page would not independently establish transparency-log inclusion. The Sigsum proof adds an append-only public accountability plane for the binary used by the real CI round-trip.

Sources:
- https://github.com/FiloSottile/age/blob/main/SIGSUM.md
- https://github.com/FiloSottile/age/releases/tag/v1.3.1

## Strict nonclaims

- no production recovery recipient keys created;
- no production recovery bundle encrypted;
- no plaintext recovery bundle uploaded;
- no AWS/B2/R2 object created;
- no continuity observation inserted into Supabase;
- no R2 proof;
- no R3 restore proof;
- no H47C persisted seal;
- active R1 worker claim remains external to this support-plane.

## Required next semantic step

`R1 STEP05 — exact-ciphertext provider replication/controller`

It must consume only a production-ready STEP04 receipt, upload the **same** ciphertext bytes to two independently operated domains, then download/materialize each object and feed both byte streams into the STEP02 verifier. DB ingestion remains a later, separately authorized gate.
