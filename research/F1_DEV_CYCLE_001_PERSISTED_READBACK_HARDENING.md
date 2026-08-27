# F1 DEV-CYCLE-001 — persisted-readback admission hardening

Status: **IMPLEMENTED CODE CONTRACT / LIVE DB MIGRATION NEXT / NON-AUTHORITY**

Canonical Level-1 milestone: `F1+` — Live Multi-CAT Federation  
Level-2 milestone: `F1_LIVE_EXTERNAL_FEDERATION`

Claim #21: `chatgpt:gpt-5.6-sol:DEV-CYCLE-001:F1-CLOSEOUT`, CP072, mutation domains `federation/provider/signature`.

GLM exact head `089d88c3bb4f51f2a2fbc83eb43bbda235544311` improved the receipt shape but retained the hard-coded proof and still accepted caller-constructed typed receipts. It also required `CRYPTO_VERIFIED_EVIDENCE_READY` even though the canonical DB recorder stores `VERIFIED`, and its readback keyed provider+execution instead of immutable verification UUID. This slice supersedes those remaining bypasses without discarding the GLM commit history.

`ProviderAdapter` is now declaration-only; direct `register()` always rejects; production admission is `register_from_supabase(adapter, verification_id)` and performs its own fixed Supabase RPC fetch. A caller cannot pass row/receipt bytes to the admission API.

The successful GitHub `gh attestation verify --format json` result contains the verified Sigstore bundle. The workflow now derives `signed_claims_sha256` from base64-decoded DSSE payload, `envelope_sha256` from the canonical DSSE envelope, `payload_type` from the envelope, and `sigstore_bundle_sha256` from the verified bundle. It also binds verifier-source and workflow SHA-256 bytes. This matches the existing database recorder semantics rather than substituting a verifier-output hash.

Local adversarial contract tests: **40/40 PASS** before push.

Research references: current GitHub CLI `gh attestation verify` / `gh attestation download` manuals, DSSE envelope specification, in-toto attestation envelope specification.

Next: seed exact F1 provider/verifier bindings and deploy `h205f22_read_signature_verification_v1`; persist a fresh exact-head DSSE receipt; read it back by returned UUID; request GLM adversarial recheck. Non-authority only; no merge/seal/VERIFIED promotion.
