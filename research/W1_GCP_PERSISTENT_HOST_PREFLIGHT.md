# W1 GCP Persistent Host Preflight — PREPARED

Status: **PREPARED / NOT LIVE / NO GCP RESOURCE CREATED**

This path adapts W1 persistent-host proof to Google Compute Engine without making GCP a canonical roadmap dependency.

## Why GCP is viable for W1

Google Cloud's current Compute Engine Free Tier includes one non-preemptible `e2-micro` VM per month in `us-west1`, `us-central1`, or `us-east1`, plus 30 GB-months of standard persistent disk. The free usage limit is eligibility-dependent and subject to change.

W1 needs a real Linux host with persistent disk, systemd/cgroup-v2 capability, stable machine identity, and an independent provider reboot/reset plane. Compute Engine exposes an instance `reset` API and `instances.testIamPermissions`, so the preflight can prove reset permission without actually resetting the host.

## Authentication: no static Google service-account key

The workflow uses GitHub OIDC -> Google Workload Identity Federation -> short-lived access token.

Required GitHub Environment/Repository variables:

- `W1_GCP_PROJECT_ID`
- `W1_GCP_ZONE`
- `W1_GCP_INSTANCE_NAME`
- `W1_GCP_WIF_PROVIDER` — full resource name: `projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL/providers/PROVIDER`
- `W1_GCP_SERVICE_ACCOUNT`
- `W1_WORKER_ID`

The WIF provider must be constrained to the trusted GitHub tenant/repository and preferably the exact `main` ref. A broad GitHub issuer without an attribute condition is not acceptable evidence for W1.

The service account needs only the read permissions required to inspect the target VM/disk plus `compute.instances.reset` on that target. The preflight uses `instances.testIamPermissions` and never invokes `instances.reset`.

## VM shape expected by the guard

- instance: `e2-micro`
- provisioning: non-preemptible / `STANDARD`
- zone in `us-west1-*`, `us-central1-*`, or `us-east1-*`
- exactly one boot disk
- boot disk: `pd-standard`, size <= 30 GB
- no GPU/accelerator
- metadata:
  - `metaengine-worker-id=<W1_WORKER_ID>`
  - `metaengine-git-sha=<exact work/w1-linux-worker-safety SHA>`

The exact branch SHA is resolved by the workflow before cloud authentication and then compared against VM metadata.

## Cost warning

The Compute Engine VM shape can qualify for the Free Tier, but an external IPv4 address is separately billable after the small IP-address free allowance. The guard reports `external_ipv4_present` and `strict_zero_cost_networking`; it does not misclassify a free compute shape as strict zero-cost networking.

A no-external-IPv4 VM may still need a paid network egress mechanism for arbitrary public IPv4 endpoints, so networking must be designed separately before calling the worker zero-cost.

## Preflight evidence boundary

A successful workflow proves only:

1. protected GitHub dispatch reached the GCP WIF trust path;
2. short-lived authentication succeeded;
3. the exact VM and boot disk are readable;
4. the VM matches the selected free-tier shape and W1 metadata binding;
5. the identity has `compute.instances.reset` permission on the target instance.

It does **not** prove:

- reset/reboot was performed;
- systemd or cgroup-v2 safety probes passed on the VM;
- accepted heartbeat quorum exists;
- machine identity persisted across a new boot ID;
- `PERSISTENT_ACROSS_PROVIDER_REBOOT`;
- W1 is VERIFIED or EVIDENCE_READY.

Those remain separate live-runtime steps after the provider preflight.

## Suggested live sequence

1. Create/identify an eligible GCP project and enable Compute Engine API.
2. Configure Workload Identity Federation for `PatrickFrome/Compute` with a narrow repository/ref attribute condition.
3. Create a least-privilege service account / resource binding.
4. Create one `e2-micro` VM in a free-tier region with 30 GB `pd-standard` and the exact W1 metadata keys.
5. Add the six GitHub variables above.
6. Dispatch `W1 GCP Persistent Host Preflight Only` with `PREFLIGHT_W1_GCP_PERSISTENT_HOST_ONLY`.
7. Only after successful preflight: bootstrap the native Linux worker, establish witness-bearing heartbeats, then execute a separately reviewed provider reset and correlate before/after boot evidence.

## Evidence class

`PREPARED` until a real GCP project and VM are reached by the workflow. A green contract-test job is implementation evidence, not GCP connectivity evidence.
