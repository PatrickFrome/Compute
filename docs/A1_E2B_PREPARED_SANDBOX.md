# A1 E2B PREPARED Sandbox Lane

Status: **PREPARED / NOT W1 / NOT PROJECT AUTHORITY**

This lane evaluates E2B as an ephemeral isolated execution backend for A1 development and agent-code smoke tests. It does not replace `W1_PERSISTENT_LINUX_WORKER_SAFETY` and cannot produce persistent-worker or provider-reboot proof.

## Why E2B

Current E2B documentation describes E2B sandboxes as isolated Linux environments backed by Firecracker microVMs. Hobby sandboxes are session-bounded (up to one hour) and are therefore classified here as `EPHEMERAL_MICROVM`, not persistent workers.

The E2B SDK supports disabling outbound internet access. The H205F22 smoke uses this mode and uploads an already checked-out source archive from the GitHub runner instead of cloning from inside the sandbox.

## Evidence boundary

A successful live smoke may establish only:

- a real E2B sandbox session was created;
- the session accepted an exact source archive associated with one Git SHA;
- the source was made read-only after unpacking;
- a runtime fingerprint was collected;
- the outbound-network negative canary was blocked;
- the A1 workspace schema parsed successfully;
- Python coordination sources compiled;
- sandbox destruction was requested and confirmed.

A successful live smoke **does not establish**:

- W1 persistent-host compliance;
- stable machine identity across sessions;
- provider reboot persistence;
- independent Firecracker attestation (the Firecracker statement remains a provider claim in our manifest);
- project execution authority;
- canonical state or checkpoint authority.

## Secret boundary

The only live credential is `E2B_API_KEY`, supplied through GitHub Actions Secrets. The adapter rejects secret-like keys/values in its evidence manifest. The source archive excludes `.git` and `evidence`; no credential is intentionally copied into the sandbox payload.

Do not paste the E2B API key into chat, PAP messages, issue bodies, source files, or evidence artifacts.

## Workflow

`.github/workflows/a1-e2b-prepared-smoke.yml`

Pull requests run only deterministic tests and contract checks. A real E2B sandbox is created only by an explicit `workflow_dispatch` on `main` with confirmation:

`RUN_E2B_PREPARED_SMOKE`

Required GitHub secret:

`E2B_API_KEY`

The live job uses a five-minute sandbox timeout and `allow_internet_access=False`.

## Evidence class

Before a successful live dispatch:

`IMPLEMENTED / CI-VALIDATED / NOT LIVE`

After a successful live dispatch and artifact readback:

`LIVE_E2B_SANDBOX_SMOKE_NON_AUTHORITY`

This must never be promoted to `W1_VERIFIED` or `PERSISTENT_WORKER_PROOF` without satisfying the separate W1 admission and persistence requirements.
