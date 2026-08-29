# A2 Browser R7M — Node Source Adapter — Post-Implementation Research

Date: 2026-08-29
Parent verified: R7L `8eb4931e3090f3d36a5fbe15527cfcd1870811b0`
Green implementation candidate observed before this document: `924def2194b23e605bff472806e88a738100554a`
Milestone: `R7M_NODE_SOURCE_ADAPTER_V1`

## Result before final seal

The implementation candidate passed its exact-head CI run `33231241281` / job `99044348773` on Ubuntu 24.04 x86_64 with Node `v22.23.2` and Rust `1.98.0`. Static authority checks, Node positive/negative/adversarial tests, the complete native R7 regression suite, the real Node → R7L launcher → FD-bound helper runtime proof, deterministic evidence generation, build-provenance attestation, and artifact upload all passed.

The uploaded candidate artifact `9708549549` was independently re-downloaded and checked. Its ZIP SHA-256 matched GitHub's reported digest `1f3425bfa20610391e2a0b63e76b79b4065932a749dab6c91f27e851e40e81a3`; its declared and recomputed deterministic tar digest matched `570759c83e0ee1a9972ba07f17c92de26334120cb759653e36b56d32d3f35e69`; source and parent receipts matched `924def2194b23e605bff472806e88a738100554a` and R7L respectively; retained runtime evidence contained zero configured CI credential markers.

This document changes the exact head. Therefore the milestone remains `CANDIDATE` until this document's commit itself receives the same required exact-head green gates and a newly bound artifact/provenance record.

## Did the pre-research assumptions hold?

Yes.

### Long-lived bounded port

The selected long-lived, single-outstanding-request design worked through one real native process epoch. Runtime evidence observed exactly one actual `execve()` of `a2-skill-source-launcher` and exactly one FD-bound helper `execveat(..., AT_EMPTY_PATH)` while the registry performed refresh plus fresh instruction hydration.

This confirms that per-request native respawn is unnecessary for the semantic source surface and that one process epoch can support the R7E transactional registry model.

### Empty Node child environment

The CI parent/test environment intentionally contained a synthetic sentinel, while the actual launcher `execve()` was observed with exactly `envp=[]`. The sentinel did not cross the adapter spawn boundary. The R7L helper exec also retained exactly empty `envp=[]`.

This confirms that explicit `env: {}` is a meaningful authority cut rather than a documentation-only claim.

### No shell intermediary

No `/bin/sh` or `/usr/bin/sh` exec appeared in the runtime trace. This confirms the direct-spawn `shell:false` contract for the verified path.

### Fail-closed transport behavior

The Node adversarial suite proved:

- invalid configuration fails before native I/O;
- invalid skill names fail before native I/O;
- concurrent requests are rejected by a one-outstanding-request fence;
- oversized response prefixes terminate before body accumulation;
- request-id mismatch is terminal;
- timeout is terminal;
- terminal failures cannot silently respawn a process;
- a bounded, valid remote source error rejects only that request and does not desynchronize the process epoch.

The combined Node suite passed 24/24 tests, including the prior package-identity and registry regressions. The native R7 all-target suite remained green with no Rust dependency changes.

## What real runtime changed in the architectural understanding

The first R7M run did not expose an adapter defect. It exposed an evidence-classification defect.

The initial trace verifier counted every line containing both `execve(` and the substring `a2-skill-source-launcher`. Because the synthetic test environment included `A2_R7M_REAL_LAUNCHER=<absolute path>`, Node test-runner process exec lines also contained that substring. The verifier therefore reported three launcher executions even though only one syscall actually executed the launcher.

The smallest correction was to classify the syscall's first path argument, not arbitrary text elsewhere in the trace. No production adapter or native boundary code changed.

This produces a new observability invariant:

`RUNTIME_EVIDENCE_CLASSIFIES_SYSCALL_ARGUMENTS_NOT_AMBIENT_TEXT`.

It also reinforces the R7L finding that the evidence producer is itself part of the security/reliability boundary. A semantically incorrect verifier can create both false failures and, in the opposite direction, false proofs.

## Comparison with primary-source analogues after implementation

### Chrome native messaging

The analogy remains strong at the transport level: one connected native process and explicit length-framed stdin/stdout. R7M deliberately keeps the existing bounded binary R7G protocol instead of adopting native-messaging JSON, because changing protocol format would add a second parser contract without increasing authority safety.

### Chromium broker/target separation

The implementation strengthened this analogy. The daemon-owned constructor owns executable/root configuration and process lifecycle; planner-facing registry snapshots receive semantic metadata only. Generic subprocess execution, PID/child handles, launcher paths, filesystem APIs, and restart controls do not cross the semantic boundary.

### Generic Node child-process broker

This remains a weaker design. It would turn a narrow skill-source capability into a confused-deputy execution surface and increase TCB and test state substantially.

## Stronger alternative discovered?

No replacement architecture is justified by the observed results.

A stronger *future installation-integrity* design could bind the Node-side first executable transition to a pre-opened FD or a separately authenticated launcher installation. That would reduce reliance on trusted pathname ownership before R7L takes control. It is not a reason to replace the current adapter now because it would enlarge the current slice and require a new bootstrap/IPC contract.

## Remaining weak points / explicit non-claims

1. **Initial launcher pathname trust.** Node's first spawn still resolves the configured absolute launcher pathname at process creation. R7L's FD-bound identity protection starts inside the launcher for the helper; it does not cryptographically bind Node's first executable lookup.
2. **Daemon privilege retention.** The adapter does not drop privileges, create namespaces/cgroups, or sandbox the Node daemon itself.
3. **One outstanding request.** Throughput is intentionally sacrificed for deterministic response correlation and small protocol state.
4. **No automatic recovery.** After terminal process/protocol/timeout failure, recovery requires creating a new adapter instance under an owner/supervisor policy that is outside R7M.
5. **Node runtime hermeticity.** Evidence records the exact runner Node version, but the project does not yet claim a hermetically pinned Node runtime image/toolchain for this slice.
6. **Linux x86_64 runtime proof only.** The native launcher/helper proof remains Linux x86_64.
7. **No browser/network/actuation authority.** R7M only provides the skill source data boundary; it does not make skills executable or grant WebMCP/CDP/browser control.

## Supply chain and TCB outcome

- New Node package dependencies: **0**.
- Rust dependency manifests: unchanged from verified R7L.
- Cargo.lock SHA-256: `ffdf4d85f832e92b20960ecdbc581103a113cf9ddfa93fa319ba124f21a3d003`.
- R7L launcher/helper release digests remained unchanged in the green candidate run.
- Adapter uses Node built-ins only and exposes only three frozen owner methods.

The pre-research objective of adding the integration boundary without expanding the external dependency graph was therefore achieved.

## Highest-gain next hardening / roadmap step

No `R7N` milestone exists in the authoritative roadmap or repository. Once R7M receives its final exact-head seal, the R7 skill-runtime integration chain is complete enough to advance to the next top-level authoritative roadmap item:

`R8_DURABLE_ACTION_GRAPH_V1`.

Before implementing R8, its pre-research should explicitly preserve R7M's source-only authority boundary and prevent durable graph/replay state from turning hydrated skill metadata into implicit execution authority.

## Final decision

### DECISION

Keep the R7M architecture unchanged after the evidence-verifier repair. Run the full exact-head matrix again with this post-research document included in the deterministic artifact. If that final head is green and its artifact/provenance independently verifies, promote R7M in the authoritative checkpoint.

### WHY

The production architecture survived both adversarial tests and real runtime integration. The only observed failure was a false-negative verifier caused by substring-based syscall classification, and the correction narrowed the evidence parser without weakening any gate.

### REJECTED_ALTERNATIVES

- change production adapter after a verifier-only failure — rejected as unrelated code churn;
- loosen the one-process-epoch assertion — rejected because the assertion is a core reliability invariant;
- remove the synthetic parent environment — rejected because it proves the empty child-env cut;
- drop `strace` runtime evidence — rejected because it would weaken the direct process-boundary proof;
- add automatic respawn — rejected because it can join one semantic operation across different native process/install epochs;
- introduce a generic subprocess broker — rejected as excess authority.

### NEW_INVARIANTS

- `RUNTIME_EVIDENCE_CLASSIFIES_SYSCALL_ARGUMENTS_NOT_AMBIENT_TEXT`.
- `ONE_REAL_NODE_ADAPTER_INSTANCE_EQUALS_ONE_LAUNCHER_PROCESS_EPOCH`.
- `NODE_TO_LAUNCHER_ENV_IS_PROVEN_EXACTLY_EMPTY`.
- `NODE_TO_LAUNCHER_SHELL_INTERMEDIARY_IS_ABSENT`.
- `R7M_FAILURES_NEVER_IMPLICITLY_RESPAWN`.
- `R7M_PRESERVES_R7E_TRANSACTIONAL_REGISTRY_SEMANTICS`.
- `R7M_ADDS_ZERO_EXTERNAL_PACKAGE_DEPENDENCIES`.
- `R7M_DOES_NOT_GRANT_EXECUTION_BROWSER_NETWORK_OR_ACTUATION_AUTHORITY`.
