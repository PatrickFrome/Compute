# METAENGINE H205F22 — CHAT-5 A1 Continuity Capsule

Date: 2026-08-21
Role: Implementation Chat 5
Milestone: `A1_ISOLATED_WORKSPACE_AGENT_ADAPTER`
Repository: `PatrickFrome/Compute`
Branch: `work/a1-agent-workspace`
Tracking issue: `#5`
Capsule class: **PREPARE_ONLY / NON-AUTHORITATIVE CONTINUITY CAPSULE**

---

## 1. Purpose

This capsule is the restart object for CHAT-5. It captures the authoritative gate state observed during the work session, the artifacts produced, the security decisions reached, research conclusions, explicit non-claims, and the exact protocol a future CHAT-5 instance must follow before continuing.

This capsule MUST NOT be interpreted as runtime authorization, A1 verification, a mainline checkpoint, or evidence that hostile-code execution is already safe.

---

## 2. Authoritative state observed

At the end of this work session the recovery Supabase state reported:

- semantic head: `metaengine-h205f22-recovery-dev-20260821-cp071`
- semantic payload root SHA-256: `23af6c63d1d294733573a86ff497951ed5aed2bce7543617a31b91d0fb7fb050`
- roadmap definition integrity: `true`
- sealed/current roadmap definition SHA-256: `96068a842c7dcb37d216aad6defc7b51e291394e916f76beed447be630024925`
- `W1_PERSISTENT_LINUX_WORKER_SAFETY`: `IN_PROGRESS`
- W1 verified checkpoint: `null`
- `A1_ISOLATED_WORKSPACE_AGENT_ADAPTER`: `BLOCKED`
- A1 blocked by: `W1_PERSISTENT_LINUX_WORKER_SAFETY`
- active A1 Supervisor directives: none
- active A1 roadmap claims: none

Supervisor policy observed:

- workers finish at `EVIDENCE_READY` only when authorized;
- Supervisor is authoritative controller and mainline sealer;
- workers may not seal mainline;
- checkpoint reservation is Supervisor-only;
- deep research is required per semantic step;
- live execution claims require live evidence.

### Gate conclusion

`W1 != VERIFIED`, therefore CHAT-5 remains **PREPARE_ONLY**.

Until W1 is authoritatively `VERIFIED` and Supervisor explicitly activates A1, CHAT-5 MUST NOT:

- grant runtime authority;
- execute agent-controlled code as A1 production evidence;
- claim real execution readiness;
- create a misleading synthetic-as-live result;
- reserve or seal a mainline checkpoint;
- mark A1 `EVIDENCE_READY` or `VERIFIED`;
- bypass the dependency gate because a substrate benchmark looks strong.

---

## 3. GitHub state

Branch at preparation start was identical to `main` at initial commit:

- base: `d9d1c267b1988823a67d6cf6f61c782ef3e5b587`

PREPARE_ONLY work added four commits before this capsule:

1. `e45d1fccb4730aa953fffe16c98406991b978b75`
2. `952634d003d711b23b7c97dc2d7033a1d8dd837e`
3. `d2c4e98a1ccab75b9dcf747be86a8eafa25e4d21`
4. `5ef92f53a025dfd4d0df1c4187649e131a00e9e7`

Before capsule creation the branch was:

- ahead of `main`: 4 commits
- behind `main`: 0 commits

No merge to `main` was performed.

---

## 4. Produced artifacts

### 4.1 Architecture

`docs/a1/PREPARE_ONLY_ARCHITECTURE.md`

Defines:

- fail-closed dependency and authority invariants;
- workspace identity inputs;
- PREPARE_ONLY and future ACTIVE lifecycle states;
- filesystem isolation model;
- output materialization model;
- deny-by-default network model;
- resource-control requirements;
- backend-neutral agent adapter API;
- structured command contract;
- threat model;
- backend capability contract;
- W1 compatibility rule;
- PREPARE_ONLY exit criteria.

### 4.2 Workspace envelope schema

`spec/a1/workspace-envelope.schema.json`

Important schema invariants:

- `mode = PREPARE_ONLY` forces `authority.execution_authority = false`;
- PREPARE_ONLY lifecycle is limited to preparation/gate states;
- `execution_authority = true` implies `mode = ACTIVE`;
- ACTIVE authority requires `w1_status = VERIFIED`;
- ACTIVE authority requires a non-null W1 verified checkpoint id;
- ACTIVE authority requires a Supervisor directive id and coordination epoch;
- host repository mounts are forbidden;
- source is read-only;
- network is deny-by-default;
- inbound exposure is disabled by default;
- workspace lineage binds input and policy digests.

### 4.3 Failure/adversarial plan

`tests/a1/PREPARE_ONLY_TEST_PLAN.md`

Covers planned negative and failure-injection classes including:

- dependency-gate bypass attempts;
- stale/replayed authority envelopes;
- shared Git metadata corruption;
- path traversal and unsafe symlink/hardlink outputs;
- malicious build/package hooks;
- credential exfiltration;
- metadata/private-network access;
- network-policy bypass;
- fork bomb / PID exhaustion;
- memory/disk/output exhaustion;
- timeout and cleanup failure;
- output substitution after test;
- mutable/snapshot replay ambiguity;
- backend capability misreporting.

The test plan is preparation only; passing live hostile-code tests is still future ACTIVE work.

### 4.4 Deep research matrix

`docs/a1/AMPLIFIER_RESEARCH_2026-08-21.md`

Compared:

- Firecracker + jailer;
- gVisor;
- Kata Containers;
- rootless containers;
- Vercel Sandbox;
- Cloudflare Sandbox SDK;
- OverlayFS;
- Git linked worktrees;
- seccomp;
- cgroup v2.

Dimensions evaluated:

- security isolation;
- startup latency;
- persistence;
- filesystem semantics;
- network isolation;
- resource control;
- observability;
- reproducibility;
- cost/operations;
- provider lock-in;
- compatibility with W1.

No candidate receives authority from this matrix.

---

## 5. Key architecture decisions

### D1 — Git worktree is not a security boundary

A host-linked Git worktree MUST NOT be exposed to hostile agent execution as the isolation mechanism.

Reason: linked worktrees have worktree-specific state but share common repository metadata through `$GIT_COMMON_DIR`, including common refs/config.

Required pattern:

`trusted repo resolution -> immutable source -> clone/snapshot inside sandbox -> optional worktree inside already-isolated repository`

A sandbox MUST NOT receive a writable mount of the controller's host repository or host `.git` metadata.

### D2 — OverlayFS is a COW mechanism, not a sandbox

OverlayFS may provide an immutable-lower/private-upper workspace model inside an already trusted isolation boundary, but it cannot itself grant authority.

Raw upper layers MUST NOT be treated as authoritative outputs. Output leaves the sandbox only through trusted manifest-driven materialization.

### D3 — Strong boundary first, defense-in-depth second

Security boundary candidates include:

- Firecracker microVM;
- Kata VM-backed runtime;
- gVisor userspace-kernel boundary where accepted;
- managed per-sandbox VM/microVM systems such as Vercel Sandbox or Cloudflare Sandbox.

The following are layered controls, not sufficient hostile-agent boundaries on their own:

- rootless mode;
- namespaces;
- seccomp;
- cgroups;
- OverlayFS;
- Git worktrees.

### D4 — Authority is dynamic and fail-closed

Cached knowledge that W1 was once `VERIFIED` is insufficient.

Before every transition into command execution the trusted adapter must re-evaluate:

- current W1 status;
- W1 verification checkpoint identity;
- current Supervisor A1 directive;
- coordination epoch;
- adapter policy digest;
- selected backend conformance state.

Authority loss or revocation during execution quarantines outputs and terminates execution fail-closed.

### D5 — Credentials stay outside hostile code

Repository write credentials, provider credentials and control-plane secrets must not appear in sandbox environment variables or files accessible to agent code.

Prefer trusted egress brokering/proxy injection when a dependency request needs credentials.

### D6 — Network default is deny

Future hostile-agent execution starts with:

- no inbound exposure;
- deny-all egress by default;
- explicit destination allowlists only where necessary;
- cloud metadata and private control-plane ranges blocked;
- network-policy changes recorded in evidence lineage.

### D7 — Output materialization is a trust boundary

Only declared output paths may leave the sandbox.

Materialization must reject at least:

- `.git` administrative data;
- sockets;
- devices;
- FIFOs;
- private keys/tokens;
- undeclared files;
- unsafe symlink targets.

Each accepted output is content-addressed and included in an output manifest/lineage receipt.

---

## 6. Agent adapter protocol target

Planned provider-neutral operations:

- `prepareWorkspace(envelope)` — PREPARE_ONLY-safe validation/identity;
- `materializeWorkspace(envelope)` — ACTIVE-only;
- `applyEdit(editRequest)` — ACTIVE-only;
- `runCommand(commandRequest)` — ACTIVE-only;
- `collectOutputs(outputPolicy)` — ACTIVE-only;
- `destroyWorkspace(workspaceId)` — ACTIVE-only;
- `getEvidence(workspaceId)` — evidence retrieval only, never authority.

Command execution must use structured argv, normalized cwd and explicit environment allowlists. Raw shell strings are denied by default.

Every ACTIVE operation requires a current authority envelope and idempotency key.

---

## 7. Research conclusions / amplifier ranking

### First managed conformance candidates after W1

**Vercel Sandbox**

Research position: very strong first managed backend candidate because of Firecracker microVM isolation, fast lifecycle, snapshots/OCI support, resource controls, egress filtering and credential brokering.

Constraint: high provider lock-in. Must remain behind the provider-neutral A1 adapter and must emit provider/snapshot identity into lineage.

**Cloudflare Sandbox SDK**

Research position: also a strong managed candidate because current model gives per-sandbox VM isolation and supports deny-by-default outbound policy, destination allowlists and trusted outbound handlers for credential injection.

Constraint: lifecycle/persistence semantics must be explicit; sandbox identity must not be confused with guaranteed durable workspace state.

### Self-hosted reference after W1

**Firecracker + jailer**

Strong isolation and low lock-in, but only eligible after W1 has proven the host/KVM/jailer/cgroup/network envelope. A1 must own snapshot identity, persistence, network policy and lineage around Firecracker.

### Secondary candidates

**gVisor** — strong compatibility/startup option with a userspace kernel; host kernel remains relevant.

**Kata Containers** — strong VM-backed option, especially attractive when the roadmap reaches Kubernetes/cluster orchestration.

**Rootless container** — useful defense-in-depth but not the default hostile-agent reference boundary.

---

## 8. Threat model snapshot

Assume repository content, generated patches, build scripts, test scripts and agent-generated commands can be malicious.

Primary threats:

1. sandbox/container/microVM escape;
2. host repository/shared Git metadata corruption;
3. credential theft;
4. egress exfiltration;
5. metadata-service/private-control-plane access;
6. path traversal;
7. symlink/hardlink attacks;
8. malicious package lifecycle hooks;
9. PID/memory/disk/file-descriptor exhaustion;
10. snapshot replay or stale-state confusion;
11. mutable base image / poisoned cache;
12. output substitution after verification;
13. authority replay after W1/directive revocation;
14. confused-deputy abuse of trusted network/credential brokers;
15. cleanup failure leaving reusable hostile state.

Mitigation principle:

**least authority + immutable inputs + strong isolation + deny-by-default network + brokered credentials + bounded resources + content-addressed outputs + receipt-bearing transitions + fresh authority checks**.

---

## 9. Explicit non-claims

At capsule time CHAT-5 has NOT proven:

- live hostile-code execution safety;
- Vercel Sandbox conformance to the final A1 contract;
- Cloudflare Sandbox conformance to the final A1 contract;
- Firecracker production readiness on the W1 host;
- real repo edit/build/test/output materialization end-to-end;
- A1 `EVIDENCE_READY`;
- A1 `VERIFIED`;
- mainline merge acceptance.

No benchmark or research score changes these facts.

---

## 10. Resume protocol for the next CHAT-5

On restart, do not trust this capsule as current authority. Treat it as continuity context only.

### Step 1 — Read authoritative state

Query Supabase for:

1. `compute_fabric_roadmap_status_h205f22()`
2. `compute_fabric_supervisor_snapshot_h205f22()`
3. current semantic head
4. current A1 directives
5. current A1 claims
6. W1 effective status and verified checkpoint

Require `definition_integrity = true`.

### Step 2 — Read GitHub state

Read:

- repository `PatrickFrome/Compute`;
- branch `work/a1-agent-workspace`;
- issue `#5`;
- branch diff against `main`;
- all A1 commits/PRs/checks created after this capsule.

### Step 3 — Re-evaluate dependency gate

#### If W1 is NOT `VERIFIED`

Remain `PREPARE_ONLY`.

Allowed:

- architecture;
- protocol design;
- schema refinement;
- threat model;
- conformance harness design;
- failure injection design;
- research;
- provider-neutral capability contracts.

Forbidden:

- runtime authority;
- real A1 production execution claims;
- dependency bypass;
- A1 verification;
- mainline seal.

#### If W1 IS `VERIFIED`

Do not automatically activate.

Also require:

- W1 verified checkpoint id is present;
- current Supervisor directive explicitly authorizes A1 ACTIVE work;
- a valid A1 roadmap claim is obtained under the current coordination epoch;
- branch/head drift is checked;
- final adapter policy digest is bound into the authority envelope.

Only then may CHAT-5 transition toward ACTIVE implementation.

---

## 11. First ACTIVE implementation sequence after Supervisor unlock

Target pipeline:

`repo input -> isolated workspace -> controlled edit -> build/test -> output materialization -> lineage/evidence`

Recommended order:

1. implement authority-envelope validator;
2. implement provider-neutral backend capability interface;
3. implement immutable repo input resolver/materializer;
4. implement sandbox-local clone/snapshot ingestion;
5. implement structured command API;
6. implement deny-by-default network policy interface;
7. implement resource-limit contract;
8. implement manifest-driven output materializer;
9. implement lineage/receipt generation;
10. connect first managed backend;
11. run negative/adversarial conformance suite;
12. independently connect second backend to test provider neutrality;
13. test authority revocation during execution;
14. test cleanup/destroy semantics;
15. run Supabase/security/performance advisors where database/DDL changes occur;
16. perform deep research again after each semantic step;
17. record evidence receipts;
18. finish worker stream at `EVIDENCE_READY` only when all required evidence exists.

Supervisor alone decides mainline acceptance / `VERIFIED`.

---

## 12. Preferred first ACTIVE backend strategy

Research recommendation only:

1. keep the contract provider-neutral;
2. run Vercel Sandbox and Cloudflare Sandbox conformance in parallel after unlock;
3. use Firecracker+jailer as self-hosted reference only on a W1-verified host;
4. keep gVisor as performance/compatibility candidate;
5. revisit Kata as cluster/Kubernetes work becomes active;
6. never promote rootless/OverlayFS/seccomp/cgroups/worktrees into authority solely because they are fast or convenient.

Mandatory selection rule:

A backend is rejected if any mandatory security capability is absent even if it wins latency or cost benchmarks.

---

## 13. Evidence pointers

Primary files to read next:

- `docs/a1/PREPARE_ONLY_ARCHITECTURE.md`
- `spec/a1/workspace-envelope.schema.json`
- `tests/a1/PREPARE_ONLY_TEST_PLAN.md`
- `docs/a1/AMPLIFIER_RESEARCH_2026-08-21.md`
- this capsule
- GitHub issue `#5`

Research source set already recorded in `AMPLIFIER_RESEARCH_2026-08-21.md`, including official/current documentation for Firecracker, gVisor, Kata Containers, Docker rootless mode, Linux seccomp/cgroup/OverlayFS, Vercel Sandbox, Cloudflare Sandbox, and Git worktrees.

---

## 14. Handoff statement

Current safe handoff state:

- preparation architecture: **complete enough for review**;
- authority envelope schema: **present**;
- threat/failure-injection plan: **present**;
- amplifier research: **present**;
- dependency gate: **still closed**;
- A1 mode: **PREPARE_ONLY**;
- A1 runtime authority: **false**;
- A1 roadmap claim: **none at capsule creation**;
- A1 Supervisor directive: **none at capsule creation**;
- W1 status observed: **IN_PROGRESS**;
- A1 status observed: **BLOCKED**;
- semantic baseline observed: **CP071**;
- worker final state: **NOT EVIDENCE_READY; intentionally waiting on W1 + Supervisor unlock**.

A future CHAT-5 must begin by re-reading authoritative Supabase and GitHub state, not by assuming these values are still current.
