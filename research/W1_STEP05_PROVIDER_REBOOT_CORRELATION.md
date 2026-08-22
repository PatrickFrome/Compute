# W1 Step 05 — independent provider reboot correlation

Date: 2026-08-21
Milestone: `W1_PERSISTENT_LINUX_WORKER_SAFETY`
Classification: RESEARCH / SECURITY DESIGN DECISION

## Trigger

The first persistence witness contract required a stable installation witness and machine identity across multiple accepted heartbeats and at least two distinct Linux boot IDs. That is materially stronger than a long-lived process check, but both sides of that statement were still produced by the worker host itself.

For W1 authority, a compromised or incorrectly instrumented host must not be able to promote itself merely by claiming a new boot ID. Persistent-host proof therefore needs an independent controller/provider observation of the reboot event.

## Research

### AWS EC2

EC2 exposes a reboot API for an existing instance and API activity is observable through CloudTrail. EC2 also exposes an instance identity document. AWS publishes RSA/PKCS7 signatures for the identity document, providing a stronger optional identity amplifier when AWS is the provider.

Primary references:
- https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_RebootInstances.html
- https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-identity-documents.html
- https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/verify-signature.html

### DigitalOcean

Droplet actions are asynchronous API resources. A reboot request creates an action object carrying action/resource identity, status, and timestamps. This is sufficient as a controller-side reboot receipt when fetched independently of the worker.

Primary references:
- https://docs.digitalocean.com/reference/api/digitalocean/#tag/Droplet-Actions
- https://docs.digitalocean.com/products/droplets/how-to/provide-user-data/

### Hetzner Cloud

Hetzner Cloud exposes machine lifecycle actions through the Cloud API and supports cloud-init/user-data at creation. This is sufficient to implement the same controller-side receipt pattern without coupling W1 semantics to one provider.

Primary references:
- https://docs.hetzner.cloud/
- https://docs.hetzner.com/cloud/servers/getting-started/creating-a-server/

## Adopted invariant

`persistent_worker_proof=true` now requires **both** witness planes:

1. **Worker plane** — append-only accepted heartbeat history demonstrates:
   - one stable `witness_id_sha256`;
   - one stable `machine_id_sha256`;
   - sufficient DB-observed duration;
   - Linux non-root execution;
   - at least three observations;
   - at least two distinct boot IDs.
2. **Independent controller/provider plane** — an append-only provider reboot receipt demonstrates a reboot action whose request/completion interval falls between a pre-action and a post-action worker heartbeat.

The correlation is accepted only if the nearest valid pre/post heartbeat pair has:
- the same witness ID;
- the same machine ID;
- different boot IDs.

Therefore neither plane can promote the host alone.

## DB implementation

Migration:
`supabase/migrations/20260821095822_w1_provider_reboot_correlation_v2.sql`

It introduces:
- `compute_fabric_worker_reboot_receipt_h205f22` — private append-only controller receipt ledger;
- `compute_fabric_record_worker_reboot_receipt_h205f22(...)` — service-role-only validated/idempotent recorder;
- `compute_fabric_w1_persistence_heartbeat_evidence_h205f22(...)` — the original heartbeat-only subordinate signal;
- `compute_fabric_w1_persistence_evidence_h205f22(...)` v2 — final two-plane verifier.

Final positive grade becomes:
`PERSISTENT_ACROSS_PROVIDER_REBOOT`.

A host with a valid heartbeat reboot transition but no independent provider action receipt is deliberately downgraded to:
`REBOOT_WITNESS_UNCORRELATED`.

## Adversarial verification

A rollback-only DB canary created a synthetic enrollment and three synthetic heartbeat receipts with stable machine/witness identity and a boot-ID transition.

Observed behavior:
1. before controller receipt, heartbeat reboot witness was true but final `persistent_worker_proof=false`;
2. inserting a provider reboot receipt between pre/post heartbeats promoted only the synthetic test case to `PERSISTENT_ACROSS_PROVIDER_REBOOT`;
3. replaying the identical receipt was idempotent and returned the same receipt ID;
4. attempted receipt mutation was rejected by the append-only trigger;
5. the transaction was rolled back;
6. the live receipt ledger returned to zero rows.

Canary result:
`W1_PROVIDER_REBOOT_CORRELATION_CANARY_PASS`.

This is SYNTHETIC / ROLLBACK evidence only and is not a real persistent-host claim.

## GitHub evidence

The W1 exact-head workflow remained green after the migration:
- commit: `b90f8262cd647f104309c5b85897d21b3f8cf7a6`
- Actions run: `32470735731`
- conclusion: `SUCCESS`

This continues to prove only the `LIVE_EPHEMERAL_GITHUB_HOSTED` safety contour. It does not provide provider reboot evidence for a persistent host.

## Optional amplifier: signed provider identity

For AWS EC2, cryptographic verification of the signed Instance Identity Document can bind the controller receipt to an independently signed provider identity. The reboot receipt schema therefore reserves:
- `identity_attestation_kind='SIGNED_PROVIDER_IDENTITY'`
- `identity_attestation_verified=true`.

This is **not** mandatory for the provider-neutral W1 baseline. It is a higher assurance amplifier and should be adopted when a provider has a stable signed identity primitive.

## Nonclaims

- No real persistent VM has been enrolled by this step.
- No real provider reboot has been executed by this step.
- No synthetic receipt remains in the live database after the rollback canary.
- This change does not mark W1 `EVIDENCE_READY` or `VERIFIED`.
- Provider action evidence does not replace the independent H1–H13 safety verification.
- Worker heartbeats are never sufficient to self-assert a provider reboot.
