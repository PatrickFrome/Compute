# W1 STEP09 — Off-Host Instance-Identity Verification (Research + Additive Implementation)

Canonical Level-1 milestone: **C1 — First Real Linux Worker**
Level-2 milestone: `W1_PERSISTENT_LINUX_WORKER_SAFETY`

Status: RESEARCH COMPLETE + ADDITIVE FAIL-CLOSED IMPLEMENTATION (Pure Node.js, offline).
Authority: **NON-AUTHORITY / NON-CLAIM**. This step does not promote the roadmap, does not
create admission, does not set `worker_admitted`, `w1_verified`, or any persisted binding, and
produces **no synthetic proof rows**.

## Problem (why C1 is still gated)

The C1 gate reads:

- `worker_admitted = false`
- `w1_verified = false`
- `0 non-ephemeral backend bindings`

There is still **no off-host-verified persistent worker identity**. The existing Python verifier
(`controller/w1/aws_instance_identity_verifier.py`) proves that an AWS-signed EC2 Instance
Identity Document (IID) can be cryptographically authenticated against a repository-pinned
certificate, but:

1. it operates on the `rsa2048` detached-signature form and shells out to `openssl smime -verify`;
2. it is Python-only, so it cannot be exercised by the Node-based worker admission surface
   without a subprocess and a POSIX toolchain;
3. the *off-host* identity verification has never been wired into the W1 admission contract as a
   self-contained, dependency-free, fail-closed module that the worker side can call directly.

This step adds the missing **off-host IID verification** as a PURE Node.js module so the W1
admission contract can verify an AWS `PKCS#7 / S/MIME` signed instance-identity document with no
network, no AWS SDK, no OpenSSL, and no trust in anything the worker asserts about itself.

## Design

### Trust root

AWS EC2 exposes an Instance Identity Document (IID) that is generated at launch/restart and is
cryptographically signed by AWS using the region-specific AWS RSA-2048 certificate. For
`us-east-2`, that certificate is pinned by **DER SHA-256**:

`aa6f3e8afcd5e477501fbaf9d19f0945c7d94548f5a2de6375d8bfbab744cae0`

(rechecked 2026-08-23, see `research/W1_DEV_CYCLE_001_AWS_SIGNED_INSTANCE_IDENTITY.md`).

### Verification flow (off-host, never trust the worker)

1. The worker supplies only an untrusted transport: the IID JSON document and its AWS `PKCS#7`
   (`pkcs7`) S/MIME signature, retrieved from IMDSv2 link-local. Nothing about the worker's claim
   of *who it is* is trusted.
2. The verifier is given the **independently supplied/pinned** AWS certificate
   (`opts.certificatePem`). It computes the DER SHA-256 of that certificate and requires it to
   equal the expected pin (default `us-east-2`). This is the OpenSSL `-nointern` discipline: the
   signer certificate embedded inside the PKCS#7 object is **deliberately ignored**. Only the
   externally pinned certificate may resolve the signer.
3. The PKCS#7 SignedData is parsed (pure Node `crypto` + a minimal DER reader). The encapsulated
   content (the IID JSON) and the signer's signature value are extracted.
4. The signature is verified as `RSASSA-PKCS1-v1_5` over `SHA-256(content)` using the pinned
   certificate's public key.
5. The IID JSON is parsed and `instanceId` / `region` / `accountId` are extracted.
6. Optional expected values (`expectedInstanceId`, `expectedAccountId`, `expectedRegion`) fence
   provider/account/region aliasing.

Output: `{ ok:true, instanceId, region, accountId, fingerprint }` or `{ ok:false, reason }`.
The function **never throws** on bad input; every failure path is fail-closed.

### Reboot receipt + changed boot_id binding

`bindRebootReceipt(identity, rebootReceipt, preProbe, postProbe)`:

- requires the receipt's `instanceId` to equal the verified identity's `instanceId`;
- requires `postProbe.boot_id !== preProbe.boot_id`.

A **changed `boot_id`** across ordered pre/post probes is the decisive proof of a *real reboot of a
persistent host*. An ephemeral/recycled instance that merely replays an old IID can present a valid
signature forever, but it cannot produce a `boot_id` that differs from a probe taken before the
reboot — unless a genuine reboot occurred. This is exactly the persistence compositor's
`boot_id is well-formed and changes` requirement (see
`research/W1_DEV_CYCLE_001_PERSISTENCE_COMPOSITOR.md`).

## Alternatives considered

- **GitHub OIDC reboot controller (W1_STEP06).** Mints a short-lived OIDC role session that calls
  `RebootInstances` and correlates a CloudTrail `RebootInstances` event. Strong for *request
  acceptance* correlation, but a CloudTrail event proves only that AWS queued a reboot request, not
  that the guest completed a reboot, and it says nothing about host identity. Used as the provider
  request plane; it is **complementary**, not a substitute, for off-host identity.
- **SSM IID document delivery (W1_STEP07/008 + `controller/w1/aws_ssm_iid_*`).** SSM `runShellScript`
  captures the IID bytes off-host and hands them to the independent pinned verifier as *untrusted
  transport*. Good delivery channel; still requires this off-host cryptographic verification step to
  mean anything. SSM is a courier, not a verifier.
- **TPM / hardware attestation.** Strongest trust anchor but unavailable on general-purpose EC2 and
  far heavier; not required to close the C1 gap. Deferred.
- **Verify the `rsa2048` detached form (existing Python).** Already implemented. This step adds the
  `PKCS#7` S/MIME form in pure Node so the worker admission surface has a zero-dependency path that
  mirrors the same pinned-certificate trust root.

## Adversarial threat model and fences

| Threat | Fence (preserved) |
| --- | --- |
| Spoofed / forged PKCS#7 signature | Verified against the **pinned** AWS cert public key; embedded signer cert ignored (`-nointern`). |
| Forged PKCS#7 with attacker-embedded certificate | Only the externally supplied pinned cert resolves the signer; its DER SHA-256 must equal the pin. |
| Wrong region / account (aliasing) | `region`/`accountId` extracted from authenticated doc and fenced against `expected*` values. |
| Reused / replayed boot_id (ephemeral masquerading as persistent) | `bindRebootReceipt` requires `post.boot_id !== pre.boot_id`; equal boot_id → `ok:false`. |
| Replayed CloudTrail receipt | Out of scope here; handled by the provider-reboot receipt ordering in the persistence compositor. |
| MITM on IMDS | IMDSv2 + hop-limit 1 required at preflight (W1_STEP07/008); signature still verified off-host. |
| Tampered signature bytes | `crypto.verify` fails → `ok:false`. |
| Wrong/forged pinned cert | DER SHA-256 pin mismatch → `ok:false`. |
| Garbage / malformed input | Catch-all → `ok:false`; function never throws. |

The single most important invariant: **the worker never attests its own identity**. Identity is
established only by a signature that only AWS can produce, checked against a certificate whose trust
comes from an offline repository pin, not from the host.

## Integration plan with the existing admission contract

- The existing DB-native persisted-readback compositor
  (`research/W1_DEV_CYCLE_001_PERSISTENCE_COMPOSITOR.md`,
  `public.h205f22_w1_admission_candidate_readback_v1`) already requires
  `identity_attestation_kind = SIGNED_PROVIDER_IDENTITY` and `identity_attestation_verified = true`,
  and revalidates signed-reboot evidence via
  `compute_fabric_validate_signed_reboot_identity_h205f22`.
- The Python verifier (`controller/w1/aws_instance_identity_verifier.py`) is the authority-bearing
  path that ultimately feeds that compositor. The new Node module
  (`worker/admission/offhost-iid-verify.mjs`) is an **additive, parallel** implementation of the
  same off-host check, suitable for the Node worker admission surface and for offline unit testing
  without OpenSSL/AWS.
- Suggested wiring (NOT performed here, to stay additive and fail-closed): the Node worker
  admission path calls `verifyInstanceIdentityDocument` on the untrusted IID transport, then
  `bindRebootReceipt` with the persisted pre/post probe `boot_id` readbacks, and forwards the
  resulting non-authority verification object as input to the DB compositor. No existing controller
  or admission code was modified.

## Open questions / future research

- **T1 parity depends on this.** A second cloud provider (T1) would need its own pinned
  certificate and signature form; the `opts.certificatePem` + `expectedFingerprint` design is
  provider-pluggable, but the precise T1 IID signing root must be independently reviewed and pinned
  before any T1 claim.
- Real `us-east-2` AWS certificate acquisition and pin confirmation against live IMDSv2 bytes.
- Optional hardened OID/ContentType assertions inside `parseSignedData` (currently lenient; the
  cryptographic check is the real fence).
- Whether to additionally surface `availabilityZone`/`architecture` consistency checks (the Python
  verifier does; kept minimal here to stay focused).

## Explicit non-claims

- This is **research + additive implementation**, not a roadmap promotion.
- `authority_effect = false`. No persisted read/write, no admission, no canonical checkpoint.
- No synthetic proof rows, no fabricated C1 evidence, no `worker_admitted=true`, no
  `w1_verified=true`.
- The module is explicitly NON-AUTHORITY: it proves off-host *identity*, not reboot completion,
  not persistence, not W1 verification.
