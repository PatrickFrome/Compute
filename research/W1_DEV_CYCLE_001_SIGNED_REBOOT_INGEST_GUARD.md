# W1 DEV-CYCLE-001 — Signed reboot ingest guard

Status: LIVE DB MIGRATION APPLIED / NON-CANONICAL / NO LIVE REBOOT RECEIPT YET

Supabase migration: `20260823085243_w1_signed_reboot_identity_ingest_guard_v1`

## Why this slice was necessary

Audit of the existing reboot receipt ingest found two privileged trust gaps:

1. `compute_fabric_record_worker_reboot_receipt_h205f22(...)` accepted `SIGNED_PROVIDER_IDENTITY` + `identity_attestation_verified=true` without validating that evidence actually contained the pinned cryptographic verifier receipt.
2. `service_role` also had direct `INSERT` on `compute_fabric_worker_reboot_receipt_h205f22`, allowing the SECURITY DEFINER RPC to be bypassed entirely.

No existing persisted reboot receipt was affected because the live table still contained zero rows.

## Applied hardening

The live migration adds `compute_fabric_validate_signed_reboot_identity_h205f22(...)` and makes the reboot recorder invoke it whenever `identity_attestation_verified=true`.

For the current AWS path, acceptance now requires exact binding of:

- provider kind `AWS_EC2`;
- exact EC2 instance ID;
- exact AWS account and `us-east-2` Region;
- provider evidence schema and asynchronous request-acceptance semantics;
- CloudTrail `ec2.amazonaws.com / RebootInstances` event ID, Region, and requested instance;
- preflight instance and availability-zone Region;
- STS caller account;
- signed-IID verifier schema/classification/nonclaims;
- verifier identity `metaengine-w1-aws-iid-pinned-openssl-v1`;
- verifier contract `AWS_EC2_IID_RSA2048_PINNED_CERT_NOINTERN`;
- AWS RSA-2048 certificate DER pin `aa6f3e8afcd5e477501fbaf9d19f0945c7d94548f5a2de6375d8bfbab744cae0`;
- document and signature digests;
- exact untrusted IMDSv2 courier provenance;
- recomputed canonical verifier-receipt SHA-256.

The migration additionally revokes direct table `INSERT` from `service_role`; the role retains `SELECT` and `EXECUTE` on the guarded recorder.

## Verification performed on live DB

A synthetic **non-persistent validator-only** fixture was passed directly to the pure validation function. It returned `valid=true` and did not create a row.

A second transient fixture used a forged 64-hex verifier digest. It was rejected with the expected `signed_reboot_identity_verification_digest_mismatch` path.

Post-migration privilege check:

- `service_role` direct reboot-table INSERT: `false`;
- reboot-table SELECT: `true`;
- guarded recorder EXECUTE: `true`.

Persisted W1 live evidence counts remained unchanged before this operation: reboot receipts `0`, backend bindings `0`, dedicated safety verifications `0`, safety observations `18`.

## Supabase advisors

Security and performance advisors were run after DDL.

No new W1-specific advisor error was introduced. Security output remains dominated by pre-existing INFO notices for private-schema RLS tables with no policies and the project-wide Auth warning that leaked-password protection is disabled. Performance output remains pre-existing unused-index INFO notices. This migration adds no index.

## Authority boundary

This migration does not prove:

- that an EC2 reboot completed;
- that a Linux worker survived a reboot;
- that backend storage is persistent;
- that the post-reboot safety probe passed;
- W1 verification;
- C1 completion;
- canonical checkpoint advancement.

The next live step is now allowed to capture real IID bytes and bind them to a real CloudTrail reboot-request receipt, but W1 remains blocked from VERIFIED until the independent pre/post boot and dedicated safety evidence exists.
