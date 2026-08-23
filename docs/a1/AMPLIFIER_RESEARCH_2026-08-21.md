# A1 Deep Research — Isolation / Workspace Amplifiers

Date: 2026-08-21  
Scope: PREPARE_ONLY research for `A1_ISOLATED_WORKSPACE_AGENT_ADAPTER`.

No candidate receives runtime authority from this research or from performance benchmarks. Authority remains gated on W1 verification + Supervisor activation + backend conformance evidence.

## Evaluation scale

- Isolation: LOW / MEDIUM / HIGH / VERY_HIGH relative to hostile agent code.
- Startup: EXCELLENT / HIGH / MEDIUM / LOW, qualitative unless provider publishes a stronger claim.
- Persistence: NONE / EXTERNAL / SNAPSHOT / NATIVE-ish session persistence.
- Lock-in: LOW / MEDIUM / HIGH.
- W1 compatibility: whether the backend can sit behind the W1/A1 gate; it does **not** mean it replaces W1.

## Matrix

| Candidate | Security isolation | Startup | Persistence | Filesystem semantics | Network isolation | Resource control | Observability | Reproducibility | Cost/ops | Lock-in | W1 compatibility |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Firecracker + jailer | VERY_HIGH | HIGH | SNAPSHOT/EXTERNAL | guest block/rootfs; snapshots external | explicit TAP/netns; operator policy | jailer + cgroups/rlimits | metrics/logs, integration needed | HIGH with pinned kernel/rootfs/snapshot | infra + significant ops | LOW | HIGH after W1 proves host/KVM/jailer envelope |
| gVisor (`runsc`) | HIGH | HIGH | external/container-style | Gofer/directfs; optional tmpfs overlay | userspace netstack; host-network mode weakens isolation | container/cgroup model | container tooling + gVisor signals | HIGH with pinned runtime/image | moderate ops | LOW | HIGH; shared host kernel remains a W1 concern |
| Kata Containers | VERY_HIGH | MEDIUM/HIGH | external/VM/container storage | VM-backed container storage | VM/pod network integration | VM + container controls | Kubernetes/container ecosystem | HIGH when guest assets/runtime pinned | higher operational complexity | LOW | HIGH; strongest fit when cluster/K8s arrives |
| Rootless container + namespaces/seccomp/cgroups | MEDIUM | EXCELLENT | normal container volumes | OverlayFS/fuse-overlayfs etc. | RootlessKit/slirp/gvisor-tap-vsock | cgroup v2/systemd dependent; some limits can be unavailable | excellent container tooling | HIGH with pinned OCI image | LOW | LOW | CONDITIONAL; defense-in-depth only for hostile code |
| Vercel Sandbox | VERY_HIGH (managed Firecracker microVM) | EXCELLENT (provider states millisecond starts) | SNAPSHOT + persistent sandbox modes | isolated microVM FS; OCI/snapshot inputs | per-sandbox network + egress firewall/SNI/CIDR; credentials brokering/proxying | provider enforced CPU/RAM/time limits | built-in logs/metrics | HIGH with OCI/snapshot identity | usage-based; low ops | HIGH | HIGH as managed substrate, still subordinate to W1 project gate |
| Cloudflare Sandbox SDK | VERY_HIGH (per-sandbox VM according to current security model) | HIGH | active-container state; backup/restore available; idle lifecycle must be handled explicitly | isolated FS/container image; state loss on idle in stable lifecycle unless persisted externally | separate network stack; deny-by-default `enableInternet=false`, allowedHosts/deniedHosts, outbound handlers, credential injection | provider quotas/instance types | Workers/Containers logs/observability | HIGH with aligned package/image digest | usage-based + Workers/DO; low ops | HIGH | HIGH as managed substrate, still subordinate to W1 project gate |
| OverlayFS | NOT A SANDBOX | n/a | upper-layer dependent | strong copy-on-write building block; whiteouts/copy_up/xattrs require care | none | none | filesystem-level | HIGH if lower/upper identities are controlled | low | LOW | useful inside an already-safe substrate only |
| Git linked worktree | NOT A SANDBOX | EXCELLENT | repository-native | separate worktree/index but shared `$GIT_COMMON_DIR` refs/config | none | none | Git-native | HIGH | low | LOW | unsafe as host security boundary; allowed only inside isolation |
| seccomp | DEFENSE-IN-DEPTH | n/a | n/a | none | syscall-dependent only | none by itself | audit dependent | policy reproducible | low | LOW | required where available, never sufficient alone |
| cgroup v2 | RESOURCE BOUNDARY, NOT SANDBOX | n/a | n/a | none | none | STRONG when correctly delegated/enforced | excellent counters/events | policy reproducible | low | LOW | required for host-backed resource containment |

## Key findings

### 1. Firecracker

Firecracker's production guidance requires the `jailer` or constraints at least as restrictive. The jailer drops privileges and uses cgroups/namespaces; operator-controlled jail paths and resources are trusted inputs. This is a strong isolation foundation but makes W1 host correctness directly relevant.

Snapshots are deliberately simple and are not a complete persistence system. Snapshot files, memory files and backing disks are trusted/external lifecycle responsibilities; secure storage/authentication/encryption must be supplied by the integrator. Snapshot restore also has compatibility constraints and networking/vsock caveats.

A1 consequence: Firecracker is an excellent self-hosted reference backend **after** W1, but A1 must own snapshot identity, secure lifecycle, output lineage and network policy rather than assuming Firecracker provides them.

Sources:
- https://github.com/firecracker-microvm/firecracker/blob/main/docs/prod-host-setup.md
- https://github.com/firecracker-microvm/firecracker/blob/main/docs/jailer.md
- https://github.com/firecracker-microvm/firecracker/blob/main/docs/snapshotting/snapshot-support.md

### 2. gVisor

gVisor moves much of the kernel interface into the Sentry/userspace kernel and treats Linux primitives as defense-in-depth. Its security model minimizes host syscalls and can avoid host sockets through its userspace `netstack`.

Filesystem access is mediated by Gofer/directfs. A writable tmpfs overlay can isolate modifications from the underlying filesystem. Host networking explicitly trades away some isolation for performance and should therefore be ineligible for hostile A1 profiles unless separately justified.

A1 consequence: strong option where container compatibility/startup matters and VM isolation is not mandatory, but host-kernel dependency remains material and must be covered by W1.

Sources:
- https://gvisor.dev/docs/architecture_guide/security/
- https://gvisor.dev/docs/architecture_guide/intro/
- https://gvisor.dev/docs/user_guide/filesystem/
- https://gvisor.dev/docs/user_guide/networking/

### 3. Kata Containers

Kata adds a VM boundary beneath OCI/container workflows and explicitly targets protection of host infrastructure from malicious container users/workloads. Current architecture supports multiple hypervisors and containerd integration.

A1 consequence: strong long-term backend for cluster/Kubernetes execution and possible convergence with later K1-style roadmap work. Operational complexity is higher than a direct microVM SDK, so it should not be the first backend solely because its isolation is strong.

Sources:
- https://katacontainers.io/software/
- https://github.com/kata-containers/kata-containers/blob/main/docs/design/architecture/README.md
- https://github.com/kata-containers/documentation/blob/master/design/threat-model/threat-model.md

### 4. Rootless containers / namespaces / seccomp / cgroups

Rootless Docker runs daemon and containers inside a user namespace and removes host-root daemon authority, but it remains a host-kernel container model. Docker documents important rootless constraints: resource flags rely on cgroup v2 + systemd delegation, storage/network features differ, and some controls may be unsupported.

The Linux kernel documentation explicitly states seccomp filtering is **not a sandbox**; it reduces kernel attack surface. cgroup v2 is a resource distribution/control mechanism, not an isolation boundary.

A1 consequence: these are mandatory defense-in-depth building blocks for host-backed execution, but a rootless container alone should not become the hostile-agent reference boundary without explicit Supervisor acceptance and adversarial evidence.

Sources:
- https://docs.docker.com/engine/security/rootless/
- https://docs.docker.com/engine/security/rootless/troubleshoot/
- https://docs.kernel.org/userspace-api/seccomp_filter.html
- https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html

### 5. Vercel Sandbox

Vercel documents each sandbox as a Firecracker microVM with its own filesystem/network and millisecond startup. The platform supports snapshots, persistent sandbox workflows, OCI images, configurable resources, and provider observability.

As of 2026, Vercel Sandbox egress controls include host/CIDR filtering, runtime policy updates, credentials brokering and request proxying. This is directly aligned with the A1 rule that secrets remain outside untrusted code.

A1 consequence: excellent candidate for the first managed conformance backend after W1 because it combines strong VM isolation, fast lifecycle and security-oriented egress controls. It is provider-specific and therefore must sit behind the neutral adapter contract; snapshot/provider identity must be captured in lineage.

Sources:
- https://vercel.com/docs/sandbox
- https://vercel.com/docs/vercel-sandbox/concepts/snapshots
- https://vercel.com/changelog/advanced-egress-firewall-filtering-for-vercel-sandbox
- https://vercel.com/changelog/vercel-sandbox-firewall-now-supports-request-proxying-and-filtering
- https://vercel.com/pricing

### 6. Cloudflare Sandbox SDK

Current Cloudflare Sandbox security docs state that each sandbox is isolated in its own VM, with isolated filesystem/process/network state and enforced resource quotas. The SDK sits on Workers + Durable Objects + Containers.

Cloudflare's outbound policy is especially relevant: `enableInternet=false` can deny public internet by default; `allowedHosts`/`deniedHosts` and outbound handlers can enforce destination policy and broker credentials in trusted Worker code. Non-HTTP traffic is denied when internet is disabled except platform DNS handling.

Stable lifecycle semantics require care: state exists while the container is active and can be lost after idle stop; backup/restore or explicit external persistence must therefore be part of an A1 profile that requires continuity. The package/image release line must be kept aligned for reproducibility.

A1 consequence: also a strong managed candidate, particularly when fine-grained egress brokering is central. Persistence semantics must be made explicit instead of inferred from sandbox ID/Durable Object identity.

Sources:
- https://developers.cloudflare.com/sandbox/concepts/security/
- https://developers.cloudflare.com/sandbox/concepts/sandboxes/
- https://developers.cloudflare.com/sandbox/guides/outbound-traffic/
- https://developers.cloudflare.com/sandbox/guides/deploy/
- https://developers.cloudflare.com/sandbox/platform/pricing/

### 7. Git worktrees

Git's own documentation says linked worktrees have private worktree-specific metadata but share common repository data through `$GIT_COMMON_DIR`; refs are generally common.

A1 consequence: host-linked worktrees cannot be the security boundary for an agent capable of arbitrary repository operations. Use a sandbox-local clone/repository first. Worktrees may then be used **inside** that isolated repository for efficient branch/task separation.

Source:
- https://git-scm.com/docs/git-worktree.html

### 8. OverlayFS

OverlayFS is an effective copy-on-write filesystem mechanism with read-only lower and writable upper layers. It uses whiteouts/opaque directories and copy-up semantics. Kernel docs warn against unsafe combinations involving untrusted redirect/metacopy metadata, shared upper/work paths, and volatile durability assumptions.

A1 consequence: useful as the internal writable layer, but never as the isolation boundary. The trusted adapter must materialize outputs from a validated manifest rather than exposing the raw upper directory.

Source:
- https://docs.kernel.org/filesystems/overlayfs.html

## Recommended backend strategy after W1 VERIFIED

This is a research recommendation, not authority assignment.

1. Keep a provider-neutral A1 protocol and capability conformance suite.
2. First managed conformance candidates: **Vercel Sandbox** and **Cloudflare Sandbox** in parallel, because both provide VM-level isolation plus modern egress controls and low operational burden.
3. Self-hosted reference: **Firecracker + jailer** only on a W1-verified Linux host, with explicit snapshot/network/resource lifecycle owned by A1.
4. gVisor remains a useful performance/compatibility candidate where a userspace-kernel boundary is accepted.
5. Kata becomes increasingly attractive when the roadmap reaches cluster/Kubernetes orchestration.
6. Rootless containers, OverlayFS, seccomp, namespaces and cgroups are layered controls, not substitutes for the selected isolation boundary.

## Authority-neutral decision rule

Backend selection must score at least:

- security isolation;
- startup latency;
- persistence semantics;
- filesystem semantics;
- network isolation and credential brokering;
- enforceable resource control;
- observability/evidence quality;
- reproducibility/image identity;
- cost;
- provider lock-in;
- compatibility with the W1 safety contract.

A candidate is rejected if a mandatory security capability is absent, even when it wins latency/cost benchmarks.