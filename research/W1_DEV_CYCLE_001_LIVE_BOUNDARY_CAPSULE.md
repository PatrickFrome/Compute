# W1 DEV-CYCLE-001 — live-boundary recheck capsule

Status: **IMPLEMENTATION RECHECKED / LIVE HOST EVIDENCE ABSENT / NON-AUTHORITY**

Canonical Level-1 milestone: **C1 — First Real Linux Worker**  
Level-2 milestone: `W1_PERSISTENT_LINUX_WORKER_SAFETY`

## Same-World precondition

This capsule is anchored to the pre-capsule W1 branch head:

`cbce8d143a839b459193ecde2d9ed9c9968a510f`

At the recheck boundary the canonical control plane reported:

- semantic head `metaengine-h205f22-recovery-dev-20260821-cp072`;
- payload root `14ef848e935dd12a6b3ada23f7fed6016788fcbaf2856c1490fd4e45caeed140`;
- roadmap `definition_integrity=true`;
- canonical alignment drift: none;
- Supervisor directive `#22 CONTINUE` for W1;
- W1 claim `#19` active and aligned to canonical C1.

No canonical checkpoint or roadmap status is changed by this capsule.

## Rechecked implementation boundary

The W1 branch now contains a complete fail-closed trust path up to, but not including, real persistent-host evidence:

1. deterministic Linux host-safety contract;
2. persisted-readback admission compositor that can produce only `ADMISSION_CANDIDATE_NON_AUTHORITY`;
3. off-host AWS EC2 signed Instance Identity Document verifier for `rsa2048` PKCS#7;
4. independently pinned AWS `us-east-2` RSA-2048 certificate DER SHA-256:
   `aa6f3e8afcd5e477501fbaf9d19f0945c7d94548f5a2de6375d8bfbab744cae0`;
5. OpenSSL verification with `-nointern`, preventing an embedded PKCS#7 certificate from replacing the pinned signer;
6. IMDSv2-only host courier that transports IID bytes as `HOST_UNTRUSTED_TRANSPORT` and has no authority to assert identity, reboot or persistence;
7. off-host courier verifier binding exact verifier implementation identity;
8. guarded Supabase reboot-receipt ingest that validates the signed-IID verifier proof and revokes direct `service_role` INSERT bypass.

Hard nonclaims remain:

- `worker_admitted=false`;
- `persistent_worker_proof=false`;
- `w1_verified=false`;
- `canonical=false`;
- `authority_effect=false`.

## Persisted live readback

Read at `2026-08-23T09:01:08Z` from the canonical Supabase project:

- provider reboot receipts: `0`;
- non-ephemeral Linux backend bindings: `0`;
- dedicated Linux safety verifications: `0`;
- Linux safety observations: `18`.

Post-migration privilege boundary:

- `service_role` direct reboot-table INSERT: `false`;
- reboot-table SELECT: `true`;
- guarded reboot-recorder RPC EXECUTE: `true`.

This is intentionally a blocking result. No synthetic row is inserted to manufacture a persistent-worker proof.

## CI recheck

For pre-capsule exact head `cbce8d143a839b459193ecde2d9ed9c9968a510f`:

- W1 AWS Signed Instance Identity `32629617166`: SUCCESS;
- W1 AWS IID Courier Contract `32629617051`: SUCCESS;
- W1 Linux Admission Contract `32629617053`: SUCCESS;
- Compute Fabric Governance `32629617054`: SUCCESS.

A later Governance run `32629660187` failed only because the PR description no longer contained the exact literal metadata string expected by the governance workflow. The PR body has been repaired to contain exactly:

`Canonical Level-1 milestone: C1`

This capsule commit creates a fresh branch synchronization event so Governance can re-evaluate that contract without changing the governance implementation from the W1 mutation domain.

## Research recheck

AWS EC2 documentation continues to separate identity from lifecycle completion:

- the Instance Identity Document identifies the EC2 instance and can be cryptographically verified using AWS-provided signatures/certificates;
- the correct regional certificate must be used for RSA-2048 verification;
- an identity document or an accepted `RebootInstances` request does **not** prove that the OS reboot completed.

Therefore the W1 compositor continues to require a changed, independently persisted Linux `boot_id` across ordered pre/post probes in addition to the same cryptographically verified provider instance identity.

References:

- https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/verify-iid.html
- https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-identity-documents.html

### Amplifier research — NitroTPM

AWS NitroTPM attestation is a useful later hardening amplifier because it can produce signed attestation material tied to measured boot/software state and supports nonce-based freshness checks. It can strengthen C1/C13 trust beyond basic provider-instance identity, but it is deliberately **not** made a prerequisite for this C1 live slice: adding it now would increase dependency surface without replacing the required reboot/persistence evidence.

Reference:

- https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/nitrotpm-attestation.html

## Exact next live dependency

The remaining C1 boundary is real-world evidence, not another local proof wrapper:

1. capture genuine IID `document` + `rsa2048` bytes from the exact W1 EC2 host through the committed IMDSv2 courier;
2. verify those exact bytes off-host through the pinned verifier;
3. bind the verified provider identity to a real CloudTrail `RebootInstances` request receipt;
4. persist ordered pre/post Linux probe-v2 receipts for the same worker/enrollment and require changed `boot_id`;
5. persist the exact non-ephemeral backend binding;
6. create a dedicated post-reboot Linux safety verification bound to the post probe;
7. feed only persisted readbacks to the admission compositor;
8. stop at non-authority evidence for Supervisor audit/seal.

Until those bytes exist, C1/W1 remains correctly `IN_PROGRESS`.

## Cross-lane coordination

F1/GLM remains a separate mutation domain. At this capsule boundary its last observed exact head was `75dc788449921376bcaed35ec73a83cad98d3866`, with GPT review `5002025051` carrying `CHANGES_REQUIRED` because the adapter proof is locally self-consistent rather than a verified persisted receipt readback. This W1 commit does not modify any F1 federation/provider/signature source.
