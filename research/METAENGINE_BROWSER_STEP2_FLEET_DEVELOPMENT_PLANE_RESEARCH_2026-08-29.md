# METAENGINE Browser Step 2 — Fleet Ownership and Embedded Development Plane Research

Date: 2026-08-29
Status: implementation research; not a release verification claim

## Finding

Compute can become part of METAENGINE Browser safely as a managed **Development Plane sidecar**, not as privileged code in a remote renderer and not as an unchecked self-updater. The browser may contain its developer, but the running trusted binary must never directly overwrite itself.

## Official platform findings

- Electron `utilityProcess.fork()` launches a Node.js service process through Chromium's Services API and supports MessagePorts; Electron recommends UtilityProcess for CPU-intensive, crash-prone or service workloads.
  - https://www.electronjs.org/docs/latest/api/utility-process
  - https://www.electronjs.org/docs/latest/tutorial/process-model
- Electron security guidance requires remote content to have Node integration disabled, context isolation and sandboxing enabled, restricted navigation/windows, per-session permission handlers, validated IPC senders, and no Electron APIs exposed to untrusted pages.
  - https://www.electronjs.org/docs/latest/tutorial/security
- Chromium multi-process architecture and Site Isolation provide the required containment model between browser/utility processes and untrusted renderers.
  - https://www.chromium.org/developers/design-documents/multi-process-architecture/
  - https://www.chromium.org/developers/design-documents/site-isolation/
- Electron `autoUpdater` is built in for macOS and Windows; Linux requires an external/package-manager update path. macOS automatic updates require signing.
  - https://www.electronjs.org/docs/latest/api/auto-updater/
- Electron exposes session network logging, Chromium-native networking, process lifecycle and application metrics that can become privacy-aware development evidence.
  - https://www.electronjs.org/docs/latest/api/net-log/
  - https://www.electronjs.org/docs/latest/api/net/
  - https://www.electronjs.org/docs/latest/api/app

## Spaces

1. **USER_SPACE** — persistent authenticated human browsing.
2. **AGENT_SPACE** — fleet-owned logical ChatGPT agents with exact physical bindings.
3. **COMPUTE_SPACE** — existing A2 Compute Browser / typed actuation runtime.
4. **DEV_SPACE** — isolated Development Plane utility process and workspaces.
5. **CANARY_SPACE** — separately launched candidate browser build used before promotion.

Cookies/session state must never be automatically copied between USER_SPACE, COMPUTE_SPACE and DEV_SPACE.

## Capabilities unlocked by owning the browser

Compared with an MV3-only runtime, METAENGINE Browser can provide:

- a durable fleet manager not subject to MV3 service-worker suspension;
- exact WebContents navigation/crash/lifecycle bindings;
- persistent and isolated browser partitions;
- native multi-view composition for ChatGPT, supervisor, evidence and development surfaces;
- local MessagePort IPC to Compute/Development sidecars;
- application/process metrics for adaptive worker scaling;
- session-scoped privacy-safe network diagnostics;
- isolated canary views/processes;
- staged packaging/update orchestration;
- automatic evidence binding of commit, build digest, tests and canary receipts;
- a closed development loop where agents research, patch, test and inspect the next browser candidate.

## Safe self-development loop

CURRENT TRUSTED BROWSER
-> semantic development point
-> GPT fleet research/design/critique
-> Development Plane creates isolated workspace
-> bounded patch
-> unit/contract/integration tests
-> build CANDIDATE
-> launch separate CANARY process/profile
-> browser/UI/Compute verification
-> exact-head CI + artifact digest
-> evidence-bound promotion decision
-> external/updater-mediated restart
-> rollback retained

CURRENT never directly overwrites itself.

## Development Plane capability progression

### DP0 — lifecycle/read-only
- HEALTH
- CAPABILITIES
- PROCESS_METRICS
- REPO_STATUS_READ

### DP1 — isolated development workspace
- CREATE_ISOLATED_WORKTREE
- READ_REPO
- APPLY_BOUNDED_PATCH
- RUN_ALLOWLISTED_TEST
- BUILD_CANDIDATE

### DP2 — canary verification
- LAUNCH_CANARY
- READ_CANARY_RECEIPTS
- STOP_CANARY
- COLLECT_PRIVACY_SAFE_NETLOG

### DP3 — source-control/CI staging
- PREPARE_COMMIT
- PUBLISH_WORK_BRANCH only through an explicit capability
- OBSERVE_EXACT_HEAD_CI
- COLLECT_ARTIFACT_DIGEST

### DP4 — promotion request
- STAGE_UPDATE
- REQUEST_PROMOTION

No Development Plane version gets `DIRECT_PROMOTE_CURRENT`, page-derived command execution, arbitrary eval, or implicit browser actuation authority.

## Step 2 fleet lifecycle

Logical identity is stable `agent_id` plus logical `target_id`, monotonic `conversation_epoch`/`generation_epoch`, with ephemeral `tab_id`/WebContents physical binding.

Provisioning contract:
1. persist REGISTERED/PROVISIONING before physical tab creation;
2. create fleet-owned ChatGPT WebContents;
3. persist exact binding before network navigation;
4. transition only to BOUND_UNVERIFIED;
5. require future ChatGPT transport/readback proof before READY.

An ambiguous tab-creation effect consumes its fleet slot and is not automatically retried.

## Relationship to R9/R11 and Compute Browser

- FleetProvisioner owns only physical desktop lifecycle.
- R9 remains the semantic fleet/assignment contract.
- R11 remains same-point blind-propose/challenge/jury orchestration.
- Compute Browser remains the typed privileged browser-effect runtime.
- Development Plane becomes a separate development/compute service behind typed capability gates.

Longer term the current localhost Compute Bridge may be transported over MessagePort when Compute is launched as a managed UtilityProcess, but its typed RPC and authority boundary should remain stable.

## Non-claims

- ChatGPT transport/readback is not verified by this step.
- BOUND_UNVERIFIED is not READY.
- DP0 implementation is a subsequent code slice.
- No self-update/self-promotion is implemented here.
- No raw CDP is delegated to GPT agents.
