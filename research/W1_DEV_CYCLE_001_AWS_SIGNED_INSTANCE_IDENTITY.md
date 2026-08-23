# W1 DEV-CYCLE-001 — AWS-signed EC2 instance identity

Status: IMPLEMENTED / NON-AUTHORITY / LIVE IID BYTES NOT YET INGESTED

Canonical Level-1 milestone: **C1 — First Real Linux Worker**  
Level-2 milestone: `W1_PERSISTENT_LINUX_WORKER_SAFETY`

## Same-World precondition

Immediately before this semantic step:

- semantic head remained `metaengine-h205f22-recovery-dev-20260821-cp072`;
- roadmap definition integrity was `true`;
- canonical alignment reported no drift;
- Supervisor directive `#22 CONTINUE` was active;
- W1 claim `#19` was active and not at expiry risk;
- W1 PR #41 exact head was `bc2dc0a06031bb6d1c7b4804ba5ba4c846c7d490`;
- F1 remained a separate parallel-safe mutation domain and was not modified.

No checkpoint advancement, merge, worker admission or W1 verification is performed by this step.

## Problem

The persisted-readback admission compositor correctly requires:

`identity_attestation_kind = SIGNED_PROVIDER_IDENTITY`

and:

`identity_attestation_verified = true`

The current AWS reboot controller cannot satisfy that boundary. It emits only:

`PROVIDER_METADATA`

with `identity_attestation_verified=false`.

Simply trusting an EC2 `DescribeInstances` response, an IMDS JSON document, or an arbitrary certificate supplied alongside a signature would reintroduce provider-identity aliasing.

## Current AWS research recheck — 2026-08-23

AWS EC2 documentation was rechecked before implementation.

### Instance Identity Document

AWS documents that an EC2 Instance Identity Document (IID):

- describes the instance itself;
- includes attributes including `accountId`, `instanceId`, `region`, architecture, image and availability-zone data;
- is available through Instance Metadata Service dynamic data;
- is generated when an instance is launched, restarted, or stopped/started.

This makes the IID useful as provider-bound identity evidence, but this step does **not** reinterpret it as sufficient reboot-completion evidence.

### Signature formats

AWS documents three IID signature forms. The adopted form is:

`rsa2048`

AWS describes this as a SHA-256-based RSA-2048 signature and documents verification with the region-specific AWS RSA-2048 certificate using OpenSSL S/MIME verification.

AWS also publishes separate public certificates by Region and verification method. Therefore region-to-certificate binding is part of the trust root, not an untrusted runtime parameter.

### Hardening beyond the basic example

A PKCS#7 object may carry certificates internally. A verifier that merely accepts a certificate file but still allows the signature object to select an embedded signer can accidentally authenticate an attacker-controlled certificate.

The H205F22 verifier therefore adds:

`openssl smime -verify ... -certfile <pinned-cert> -nointern -noverify`

`-nointern` prevents signer resolution from certificates embedded inside the PKCS#7 object. The only usable signer certificate is the independently supplied certificate whose DER SHA-256 must match the repository pin for the exact AWS Region.

For `us-east-2`, the rechecked AWS RSA-2048 certificate is pinned by DER SHA-256:

`aa6f3e8afcd5e477501fbaf9d19f0945c7d94548f5a2de6375d8bfbab744cae0`

Unknown Regions fail closed until their AWS-published certificate is independently reviewed and pinned.

## Implemented contract

`controller/w1/aws_instance_identity_verifier.py`

### Verification input

The verifier consumes raw bytes for:

- IID JSON document;
- IID `rsa2048` PKCS#7 signature;
- AWS RSA-2048 certificate.

It also requires independently expected:

- exact EC2 instance ID;
- exact 12-digit AWS account ID;
- exact AWS Region.

### Fail-closed verification

A verified identity is emitted only if all of these hold:

1. the expected identifiers are structurally valid;
2. the Region has an explicit trusted certificate pin;
3. the supplied certificate DER SHA-256 equals that pin;
4. the RSA-2048 PKCS#7 signature verifies with that pinned signer certificate;
5. signer certificates embedded in the PKCS#7 object are ignored;
6. OpenSSL-recovered signed document bytes equal the provided IID bytes exactly;
7. IID `instanceId`, `accountId` and `region` match the independent expectations;
8. availability zone, when present, is consistent with the Region;
9. architecture, when present, is within the supported EC2 IID set.

The only positive classification is:

`SIGNED_PROVIDER_IDENTITY_VERIFIED_NONAUTHORITY`

Hard nonclaims remain false:

- `persistent_worker_proof`;
- `reboot_completion_proven`;
- `w1_verified`;
- `canonical`;
- `authority_effect`.

## Receipt binding

The same module can bind a verified identity to the existing un-ingested AWS reboot receipt candidate.

Binding requires exact agreement across independent evidence:

- provider kind = `AWS_EC2`;
- provider instance ID = IID instance ID;
- preflight instance ID = IID instance ID;
- CloudTrail AWS Region = IID Region;
- STS caller account = IID account ID;
- preflight availability zone belongs to the IID Region;
- the receipt still has request-acceptance, not reboot-completion, semantics;
- neither input is authoritative/canonical.

The resulting receipt is schema v2 and may set only:

- `identity_attestation_kind=SIGNED_PROVIDER_IDENTITY`;
- `identity_attestation_verified=true`.

It recomputes its evidence digest after attaching the signed identity. It still cannot claim persistence, W1 verification, admission or canonical authority.

## Adversarial verification

Dedicated tests cover:

- valid cryptographic signature;
- exact non-authority output;
- unpinned certificate rejection;
- attacker PKCS#7 with an embedded attacker certificate;
- signed-document tampering;
- instance-ID aliasing;
- AWS-account aliasing;
- Region aliasing;
- unknown Region without a pin;
- receipt/provider-instance mismatch;
- CloudTrail Region mismatch;
- STS caller-account mismatch;
- authority escalation;
- reinterpretation of asynchronous request acceptance as reboot completion.

Local pre-commit result: **10/10 PASS**.

## Research-after / next exact live slice

This slice intentionally does not trust the transport that delivers the IID bytes. Because the bytes are cryptographically authenticated, a future host-side evidence courier may be treated as an untrusted transport rather than an identity authority.

The next live W1 slice should:

1. retrieve the real IID `document` and `rsa2048` bytes from the exact W1 EC2 host through IMDSv2;
2. persist the raw signed bytes without converting them into a host self-claim;
3. verify them off-host with the pinned verifier implemented here;
4. bind the verified identity to the exact CloudTrail reboot-request receipt;
5. obtain persisted pre-reboot and post-reboot Linux probe-v2 receipts whose `boot_id` changes;
6. obtain a dedicated post-reboot Linux safety verification;
7. feed only persisted readbacks into the admission compositor.

A host-delivered IID replay for the same EC2 instance does not prove a reboot and must never replace the independent changed-`boot_id` + chronology + provider-request evidence chain.

No synthetic Supabase evidence rows should be created to make these gates pass.
