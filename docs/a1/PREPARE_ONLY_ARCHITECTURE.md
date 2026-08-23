# A1 Isolated Workspace + Agent Adapter — PREPARE_ONLY Architecture

Status: **PREPARE_ONLY / NON-AUTHORITATIVE**  
Milestone: `A1_ISOLATED_WORKSPACE_AGENT_ADAPTER`  
Dependency: `W1_PERSISTENT_LINUX_WORKER_SAFETY == VERIFIED`  
Baseline observed at preparation time: semantic head `CP071`; W1 was `IN_PROGRESS`; A1 was `BLOCKED`.

This document intentionally defines contracts without granting runtime authority. It MUST NOT be interpreted as proof that real execution is safe or available.

## 1. Gate invariants

1. A1 execution authority is fail-closed.
2. No workspace may execute agent-controlled commands unless all are true at decision time:
   - W1 is `VERIFIED` in the authoritative roadmap state;
   - the W1 verification checkpoint is present and bound into the workspace authority envelope;
   - a current Supervisor directive authorizes A1 ACTIVE work;
   - the A1 adapter policy digest matches the approved policy;
   - the selected substrate passes the required isolation capability checks.
3. Cached `VERIFIED` state is insufficient. Authority must be re-evaluated before every transition into command execution.
4. A benchmark, startup-time win, or cost advantage MUST NOT create authority.
5. Provider credentials and repository write credentials MUST NOT be exposed to agent code.
6. The Supervisor remains the only mainline sealer.

## 2. Security boundary

The security boundary is the isolated execution substrate, not Git, not a worktree, not OverlayFS, and not seccomp alone.

`git worktree` is treated as a repository-layout optimization only. Linked worktrees share `$GIT_COMMON_DIR`, including common refs/config. Therefore an untrusted agent MUST NOT receive a host-linked worktree whose shared Git metadata is writable or reachable as a privilege boundary.

Preferred repository ingestion:

1. trusted control plane resolves repository + immutable commit;
2. trusted control plane materializes an immutable source snapshot or clone input;
3. that input is copied/cloned **inside the sandbox**;
4. any `git worktree` use occurs only inside that already-isolated repository namespace;
5. the sandbox never receives a writable mount of the host controller repository or host `.git` directory.

## 3. Workspace identity

A workspace identity is derived from immutable inputs, not from a mutable directory name.

Minimum identity material:

- repository canonical locator;
- source commit SHA;
- source tree SHA or source content digest;
- toolchain contract key + toolchain identity digest when T0/T1 make it available;
- isolation backend and backend image/snapshot identity;
- filesystem strategy and base image digest;
- network policy digest;
- resource policy digest;
- A1 adapter policy digest;
- W1 verification checkpoint id;
- Supervisor directive id / coordination epoch;
- nonce for this workspace instance.

The resulting `workspace_id` MUST be content-bound and recorded in all command, output, and lineage receipts.

## 4. Lifecycle state machine

Allowed PREPARE_ONLY design states:

`PROPOSED -> INPUT_RESOLVED -> POLICY_BOUND -> READY_FOR_GATE`

Future ACTIVE-only states (defined now, forbidden now):

`READY_FOR_GATE -> MATERIALIZING -> INPUT_SEALED -> EDITING -> BUILDING -> TESTING -> OUTPUT_STAGED -> OUTPUT_MATERIALIZED -> DESTROYING -> DESTROYED`

Failure states:

`REJECTED`, `ISOLATION_FAILED`, `POLICY_VIOLATION`, `TIMEOUT`, `RESOURCE_EXHAUSTED`, `OUTPUT_REJECTED`, `DESTROY_FAILED`.

Rules:

- only the trusted adapter advances state;
- every transition carries previous-state digest + transition receipt;
- `READY_FOR_GATE -> MATERIALIZING` requires fresh authority evaluation;
- any authority loss during execution causes fail-closed cancellation and output quarantine;
- `OUTPUT_MATERIALIZED` is not equivalent to merge or checkpoint acceptance.

## 5. Filesystem model

### 5.1 Source

- immutable or read-only source image/snapshot;
- no host repository metadata writable from sandbox;
- reject device nodes, unsafe mount requests, path traversal and untrusted privileged xattrs at ingestion;
- resolve and validate symlink/hardlink policy before output materialization.

### 5.2 Writable layer

Preferred model: immutable lower + private writable upper inside the sandbox.

OverlayFS may implement this but is not itself an isolation boundary. If used:

- upper/work directories are unique per workspace;
- upper/work paths are never shared between concurrent overlays;
- untrusted layers cannot control privileged overlay xattrs;
- durability mode is explicit; volatile overlays are allowed only for disposable/reconstructable state;
- final outputs are copied/materialized through the trusted adapter, never by reusing the raw upper directory as authoritative output.

### 5.3 Output materialization

Only declared paths can leave the sandbox. Materialization produces:

- file manifest with type, mode, size and SHA-256;
- optional binary patch/diff for review;
- build/test artifacts declared by policy;
- stdout/stderr/exit receipts for approved commands;
- rejected-path report;
- workspace lineage receipt.

No `.git` administrative files, sockets, devices, FIFOs, private keys, provider tokens or undeclared symlink targets may be materialized.

## 6. Network model

Default: **deny all egress and all inbound exposure** during agent-controlled execution.

Trusted setup may temporarily allow narrowly scoped dependency acquisition, after which policy is tightened before untrusted execution.

Network policy requirements:

- hostname/CIDR allowlist where substrate supports it;
- prohibit cloud metadata endpoints and private control-plane ranges unless explicitly brokered;
- no unrestricted DNS-based exfiltration path;
- no public inbound port unless an explicit test requires it;
- credentials are brokered/injected by trusted egress proxy/handler when possible and are never placed in sandbox environment/files;
- every policy change is receipt-bearing and included in workspace lineage.

## 7. Resource model

Required enforceable limits:

- wall-clock deadline;
- CPU quota/weight;
- memory max;
- process/PID limit;
- disk quota;
- output byte/count quota;
- open-file limit;
- network policy/egress quota where available.

A backend that silently ignores a required resource limit is ineligible for authority for that profile.

## 8. Agent adapter API

The adapter is an explicit protocol boundary, not a raw shell relay.

Planned operations:

- `prepareWorkspace(envelope)` — PREPARE_ONLY-safe validation and identity derivation;
- `materializeWorkspace(envelope)` — ACTIVE-only;
- `applyEdit(editRequest)` — ACTIVE-only, path scoped;
- `runCommand(commandRequest)` — ACTIVE-only, argv form, no implicit shell by default;
- `collectOutputs(outputPolicy)` — ACTIVE-only;
- `destroyWorkspace(workspaceId)` — ACTIVE-only cleanup;
- `getEvidence(workspaceId)` — returns receipts/lineage, never grants authority.

Every ACTIVE operation requires the current authority envelope and an idempotency key.

## 9. Command contract

Commands use structured argv + cwd + explicit environment allowlist. Stringly-typed shell execution is denied by default.

Each command records:

- command id and workspace id;
- argv digest and normalized cwd;
- environment digest (secret values excluded/redacted, policy-bound separately);
- start/end monotonic and wall timestamps;
- exit code/signal;
- stdout/stderr digests and bounded captures;
- resource usage summary;
- network policy version;
- pre/post filesystem manifest roots.

## 10. Threat model summary

A1 assumes agent-controlled source code and generated commands can be malicious.

Primary threats:

- container/microVM escape;
- host repository or shared Git metadata corruption;
- credential theft and egress exfiltration;
- symlink/hardlink/path traversal during input/output handling;
- malicious build scripts and package lifecycle hooks;
- fork bombs, memory/disk exhaustion and long-running processes;
- confused-deputy use of trusted proxies;
- snapshot replay/stale-state confusion;
- poisoned caches or mutable base images;
- output substitution after tests;
- authority replay after W1/directive revocation.

Mitigation principle: least authority, immutable inputs, isolated execution, deny-by-default network, brokered credentials, bounded resources, content-addressed outputs, receipt-bearing transitions, and fresh authority checks.

## 11. Backend abstraction

A1 MUST expose a backend-neutral capability contract. Candidate backends are not automatically equivalent.

Capabilities to prove per backend:

- VM/kernel isolation class;
- filesystem isolation semantics;
- deny-by-default network support;
- credential brokering support;
- enforceable CPU/memory/PID/disk limits;
- immutable image/snapshot identity;
- lifecycle cleanup guarantees;
- logs/metrics/command receipts;
- snapshot persistence and replay semantics;
- host dependency on W1;
- provider-specific assumptions.

Initial candidates: self-hosted Firecracker+jailer, gVisor, Kata Containers, rootless containers as defense-in-depth only, Vercel Sandbox, Cloudflare Sandbox SDK.

## 12. W1 compatibility rule

Managed sandboxes and stronger VM isolation may reduce the exposed host surface, but **they do not replace the project dependency gate**. A1 remains blocked until W1 is authoritative `VERIFIED` and Supervisor explicitly activates A1.

For self-hosted substrates, W1 must additionally cover the host requirements of the chosen backend (for example KVM/jailer/cgroups/network namespaces for Firecracker).

## 13. PREPARE_ONLY exit criteria

Preparation is complete when:

- architecture and state machine are reviewable;
- protocol schema exists;
- threat/failure-injection plan exists;
- substrate research matrix exists;
- no live-execution claim was made;
- no roadmap verification/checkpoint was sealed;
- no runtime authority was granted.

Activation remains a Supervisor action after W1 verification.