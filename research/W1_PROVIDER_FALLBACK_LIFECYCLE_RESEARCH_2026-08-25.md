# W1 provider fallback lifecycle research — 2026-08-25

Status: RESEARCH_ONLY / NON-AUTHORITY

## Trigger

Fresh protected W1 STEP08 run `32786874695` at exact main `0d6bfd3fc54d2d0ebdcd8194f98c9becd067a4df` passed contract tests and protected-environment/deployment validation, was approved, then failed closed before AWS credentials because all required protected identity variables were empty: `W1_AWS_INSTANCE_ID`, `W1_WORKER_ID`, `W1_AWS_ROLE_ARN`, `W1_AWS_ACCOUNT_ID`, `W1_AWS_REGION`.

No AWS credentials were issued, no AWS API call was made, and no reboot occurred.

Current A2 hard gate: `994df3423fddf3cd21cd01a0f99a4ad75691f3eb04bff9c0f88d15115058596f` (`REAL_W1_AWS_HOST_IDENTITY_UNCONFIGURED`).

## Canonical acceptance boundary

Supabase readback distinguishes the implementation from the canonical goal:

- W1 Level-2 acceptance is provider-neutral: real Linux host, fresh heartbeat, ADMITTED resource pool, process/resource/filesystem isolation, no synthetic execution claim.
- C1 sealed acceptance additionally requires `real_persistent_linux_host`, `provider_correlated_reboot_proof`, `live_h1_h13_pass`, `admitted_cpu_local`.

Therefore a non-AWS provider is not forbidden in principle, but it must preserve the exact semantic requirement of independently provider-correlated lifecycle/reboot evidence. Provider substitution is an architecture change and requires peer/supervisor reseal before authority-bearing use.

## Candidate: GitHub Codespaces

Current GitHub documentation (checked 2026-08-25):

- A codespace is a cloud virtual machine environment whose saved project changes survive stop/start.
- GitHub exposes authenticated REST lifecycle endpoints to stop and start a user's codespace.
- Personal GitHub accounts include a monthly quota of free Codespaces usage; running compute consumes core-hours and stopped codespaces consume storage quota/cost according to account state.
- Classic PAT lifecycle calls require the `codespace` scope; fine-grained tokens require Codespaces lifecycle administration permission.

Useful official references:
- https://docs.github.com/en/codespaces/about-codespaces/understanding-the-codespace-lifecycle
- https://docs.github.com/en/rest/codespaces/codespaces?apiVersion=2026-03-10
- https://docs.github.com/en/codespaces/troubleshooting/troubleshooting-included-usage

### Required canary before any reseal

An EXISTING codespace may only be considered a W1 provider candidate if all of the following can be proven without creating a new billable resource:

1. It is bound to `PatrickFrome/Compute` and a known immutable repo/ref identity.
2. It runs Linux and exposes the kernel/process/resource/filesystem primitives required by H1-H13.
3. A pre-lifecycle observation persists provider identity, machine/codespace identity, repo SHA, witness identity and `/proc/sys/kernel/random/boot_id`.
4. The provider lifecycle operation is performed through the GitHub Codespaces API, not self-reported by the guest.
5. After stop/start, saved workspace state remains while boot identity changes.
6. Provider API readback proves the same codespace identity traversed the lifecycle.
7. Live H1-H13 is rerun after the lifecycle transition.
8. Supabase persists the lifecycle receipt and post-lifecycle safety evidence before admission.

If boot identity does not change, or provider identity cannot be independently correlated, Codespaces fails the C1 `provider_correlated_reboot_proof` bridge and must not replace AWS.

## Rejected as direct W1 replacement: Cloudflare Sandbox

Cloudflare Sandbox SDK documentation states that local container state exists only while the container is active; after idle stop/replacement a fresh container starts and previous local state is lost unless explicitly restored from external durable storage. This makes it useful for isolated A1/C1 execution acceleration, but not a drop-in persistent-host proof for W1/C1.

Official references checked 2026-08-25:
- https://developers.cloudflare.com/sandbox/concepts/sandboxes/
- https://developers.cloudflare.com/sandbox/1-0-preview/lifecycle/

## Current decision

- Do not alter the existing AWS STEP08 workflow or protected environment semantics.
- Do not create a Codespace yet.
- First inspect whether the authenticated user already has an existing `PatrickFrome/Compute` Codespace and whether the token rail has lifecycle scope.
- If an existing Codespace exists, run a read-only capability/identity study and then submit a GPT↔GLM architecture-reseal proposal before any stop/start mutation.
- If no existing Codespace exists, remain at the real external infrastructure gate rather than creating a potentially billable resource without explicit cost awareness.

Strict nonclaims: no provider substitution, no new VM/codespace, no Codespaces lifecycle operation, no AWS identity invention, no W1 verification, no C1 promotion.
