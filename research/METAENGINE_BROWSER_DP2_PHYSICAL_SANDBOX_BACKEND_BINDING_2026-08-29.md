# METAENGINE Browser — DP2 Physical Sandbox Backend Binding Contract

Date: 2026-08-29
Branch: `work/metaengine-browser-shell-v1`
Authoritative baseline: `0b6aa2dc73781d2d9eba829794dec73b8e33c9af`
Active milestone: `DP2_PHYSICAL_SANDBOX_BACKEND_BINDING_V1`

## Source-of-truth

The authoritative Supabase checkpoint keeps DP2 ACTIVE/PREPARE_ONLY. DP2 sandbox planning is physically proven through the Electron Development Plane on Linux, Windows Server 2022, and Windows latest, but no physical sandbox backend is bound and no sandbox execution authority exists.

The authoritative recovery database had zero rows in the Linux worker backend-binding and safety-verification tables when this slice began. A provider name or caller-supplied session ID is therefore not sufficient to promote DP2.

## Current provider research

### Vercel Sandbox

Current Vercel documentation describes an isolated Linux microVM backed by Firecracker. Vercel also documents custom network policy, deny-by-default egress patterns, credential brokering outside the sandbox, explicit stop/session lifecycle, and sandbox REST APIs. The connected Vercel account has a READY production project `metaengine-jcs-v2-c1-exec` on Node 24, making Vercel a practical first control-plane candidate.

References:
- https://vercel.com/sandbox
- https://vercel.com/kb/guide/running-opencode-securely-with-the-vercel-sandbox
- https://vercel.com/docs/rest-api/sdk/sandboxes/update-network-policy
- https://vercel.com/docs/rest-api/sdk/sandboxes/stop-a-session

### Cloudflare Sandbox

Cloudflare documents a separate VM per sandbox with filesystem, process, network, and resource isolation. Its lifecycle API includes a unique sandbox ID and explicit `destroy()` that deletes files, processes, sessions, network connections and exposed ports. It remains a strong second backend candidate.

References:
- https://developers.cloudflare.com/sandbox/concepts/security/
- https://developers.cloudflare.com/sandbox/api/lifecycle/

### Self-managed options

Firecracker provides a strong microVM primitive but makes the integrator responsible for trusted host/API control and secure snapshot lifecycle. gVisor provides a userspace application kernel and a reduced host syscall surface. Both remain useful future backends, but they impose more METAENGINE-owned operational surface than the managed Vercel/Cloudflare options.

References:
- https://github.com/firecracker-microvm/firecracker/blob/main/docs/snapshotting/snapshot-support.md
- https://gvisor.dev/docs/architecture_guide/security/

## Binding rule

**Provider identity is not trust. Structural observation is not trust.**

The new binding contract therefore has two stages:

1. `backend binding candidate` — digest-bound to an already closed DP2 PREPARE_ONLY plan.
2. `provider observation verification` — validates session/runtime/image/network/materialization/teardown evidence, but returns `PROVIDER_OBSERVED_UNATTESTED` and still grants no authority.

A later physical adapter must prove that the observation came from a trusted provider control plane and bind that observation to exact source/CI provenance before `backend_bound=true` can exist.

## Candidate invariants

- exact DP2 `plan_id` and digest are revalidated;
- candidate/source identities remain digest-bound;
- provider is from a closed list;
- Vercel requires `FIRECRACKER_MICROVM`;
- Cloudflare requires `DEDICATED_VM`;
- materialization is content-digest upload, never host repository mount;
- source remains read-only;
- initial verification uses deny-all network, zero exposed ports, zero credential brokering and zero environment-secret injection;
- persistence and snapshot restore are disabled;
- stop and teardown receipts are mandatory;
- runtime and image immutable digests are mandatory;
- input/output manifest and teardown digests are mandatory;
- provider name and self-reported evidence explicitly do not grant trust;
- `backend_bound=false`;
- `execution_authorized=false`;
- `promotion_authorized=false`;
- `authority_effect=false`.

## Observation validation

A structurally valid provider observation must include:
- provider session identity;
- expected isolation class;
- runtime and image SHA-256 identities;
- input/output manifest SHA-256 identities;
- teardown receipt SHA-256 identity;
- monotonic created/stopped timestamps;
- observed deny-default closed network policy;
- no secret injection/brokering;
- no host repository mount;
- source read-only;
- stopped lifecycle with persistent state deleted.

Even when every structural check passes, the receipt is `PROVIDER_OBSERVED_UNATTESTED` and non-authoritative.

## Verification

Local Node contract suite before publication: 6/6 PASS.

The suite also exposed and fixed a verifier design error: observation verification initially attempted to reconstruct a full sandbox plan from the binding's normalized plan subset. The corrected design verifies the backend-binding envelope against its own digest, preserving separation between DP2 plan integrity and backend-observation integrity.

## Next bounded slice

Implement the Vercel provider adapter/control-plane probe using the documented Sandbox API. The first physical proof must use a fresh ephemeral microVM, deny-all network, no secret injection, no host repo mount, a tiny immutable input payload, typed verification only, explicit stop, and persisted provider/API plus teardown evidence. Do not grant general candidate execution or DP3 promotion authority in that slice.
