# METAENGINE Browser — DP2 Verification Sandbox Plan V1

Date: 2026-08-29
Branch: `work/metaengine-browser-shell-v1`
Baseline: DP1 VERIFIED at `70f7ead5b3092d8a7b50b2099f88e491db7788c5`, GitHub Actions run `33248106231`.
Milestone: `DP2_VERIFICATION_SANDBOX_V1`

## Source-of-truth before change

Supabase marks DP1 candidate provenance VERIFIED and DP2 verification sandbox ACTIVE. The authoritative recovery database currently has no persisted Linux worker backend binding or safety-verification row that could justify granting execution authority to a physical sandbox backend.

Therefore this slice is intentionally **PREPARE_ONLY**. It must not disguise a local worktree, host process, or ordinary container as verified isolation.

## Research synthesis

### SLSA Build isolation

SLSA Build v1.2 requires an isolated build platform at L3. Builds must not access platform signing secrets, influence overlapping or future builds, poison shared caches, or accept undeclared remote influence.

Source: https://slsa.dev/spec/v1.2/build-requirements

Implication: a host `git worktree` plus `child_process` is useful for source separation but does not by itself prove a verification sandbox security boundary.

### Cloudflare Sandbox

Cloudflare Sandbox SDK currently documents a separate VM per sandbox with filesystem, process, network, and resource isolation. It is a promising backend candidate, but backend identity, policy, lifecycle, and teardown receipts still need to be bound into METAENGINE evidence before execution authority can be claimed.

Sources:
- https://developers.cloudflare.com/sandbox/
- https://developers.cloudflare.com/sandbox/concepts/security/

### Existing A1 workspace envelope

`spec/a1/workspace-envelope.schema.json` already establishes the project-wide principles that DP2 should reuse:
- source read-only;
- host repository not mounted;
- private writable layer;
- output allowlist;
- deny-by-default network;
- no inbound exposure;
- bounded wall time, memory, pids, disk and output;
- explicit lineage;
- PREPARE_ONLY implies `execution_authority=false`.

DP2 adopts these semantics rather than creating a weaker parallel isolation model.

## Bounded DP2 contract

`verification-sandbox-plan.cjs` is a pure planning/verification core. It accepts only:
- a DP1 candidate capsule identity and required verification-step identifiers;
- the independently produced DP1 candidate verification receipt;
- an optional requested backend from a closed allowlist;
- bounded resource ceilings.

It produces a deterministic digest-bound sandbox plan with:
- `mode=PREPARE_ONLY`;
- `backend_bound=false`;
- `execution_authority=false`;
- immutable-snapshot materialization requirement;
- `source_read_only=true`;
- `host_repository_mounted=false`;
- `writable_layer=PRIVATE_DIRECTORY`;
- output allowlist limited to `evidence/`;
- `network.deny_by_default=true`;
- no inbound exposure, allowed hosts, CIDRs, or credential brokering;
- explicit evidence requirements for sandbox identity, input manifest, verification receipts, output manifest, and teardown;
- no promotion, signing, browser actuation, or arbitrary-command authority.

A requested backend is only a planning hint. It never changes execution authority.

## Backend allowlist for future binding

The planning schema recognizes strong-backend candidates:
- `CLOUDFLARE_SANDBOX`
- `VERCEL_SANDBOX`
- `FIRECRACKER`
- `GVISOR`
- `KATA`

Recognition is not verification. A later bounded slice must bind one backend to an independently verified backend identity and lifecycle receipt before changing DP2 out of PREPARE_ONLY.

## Verification

Local Node contract tests prove:
- deterministic plan identity;
- requested backend cannot grant execution;
- read-only source / no host mount;
- deny-default network / no credentials;
- exact verified-candidate binding;
- fail-closed resource ceilings;
- no command/argv/secret surface;
- full-shape digest verification and tamper rejection.

Local result: 6/6 PASS before publication.

## Next bounded slice

After exact-head CI proves this core, expose `VERIFICATION_SANDBOX_PLAN_CREATE` and `VERIFICATION_SANDBOX_PLAN_VERIFY` through the Development Plane typed protocol. Keep both non-executing. Only after that should DP2 add a backend adapter and physical sandbox lifecycle evidence.
