# W1 Step 01 — Persistence Truth Gate Amplifier Research

Date: 2026-08-21
Milestone: `W1_PERSISTENT_LINUX_WORKER_SAFETY`
Classification: RESEARCH ONLY — no amplifier is adopted by this report.

## Decision boundary

W1 requires a real persistent Linux worker. Provider terminology is not authoritative for W1: a substrate that terminates and later resumes from filesystem or VM snapshots is not treated as proof of a continuously persistent Linux host. Such systems can still be useful for reproducible state continuity, isolation experiments, and negative canaries.

## AMPLIFIER_CANDIDATE: Vercel Persistent Sandbox

- name: Vercel Persistent Sandbox
- upstream/source: https://vercel.com/docs/sandbox/concepts/persistent-sandboxes ; https://vercel.com/docs/rest-api/sandboxes/create-a-snapshot
- current activity/maintenance: actively documented in current Vercel Sandbox docs; named sandboxes persist filesystem state by automatic snapshots and resume by name.
- какую проблему решает: reproducible isolated Linux execution and filesystem continuity between sessions.
- expected benefit: very fast microVM provisioning; stable logical name; snapshots; resource/network controls; useful live shell/isolation canaries.
- integration cost: low to medium if Vercel credentials/project are available.
- security risk: medium; strong microVM boundary but provider-managed control plane and session lifecycle; snapshot semantics can be confused with host persistence.
- vendor lock-in: high.
- reproducibility impact: positive for filesystem state and environment snapshots.
- prerequisite milestones: none for sandbox experiments; cannot by itself satisfy W1 persistent-host acceptance.
- conflicts with roadmap: semantic conflict if provider term `persistent` is promoted to W1 persistent-host evidence; snapshot creation terminates the active session.
- recommendation: EXPERIMENT

## AMPLIFIER_CANDIDATE: systemd + cgroup v2

- name: systemd service sandboxing + unified cgroup v2
- upstream/source: https://github.com/systemd/systemd/releases ; https://docs.kernel.org/admin-guide/cgroup-v2.html
- current activity/maintenance: systemd 261.x/260.x/259.x stable lines received releases in 2026; cgroup v2 is the Linux unified resource-control interface.
- какую проблему решает: always-on worker lifecycle, restart supervision, process grouping/fencing, CPU/memory/PID limits, service-level hardening.
- expected benefit: lowest-complexity path to a persistent worker on a real VM; maps directly to W1 heartbeat/fencing/resource-limit requirements.
- integration cost: low on a modern Linux VM.
- security risk: low to medium; correctness depends on hardened unit configuration and host kernel posture.
- vendor lock-in: very low.
- reproducibility impact: high when unit files and host bootstrap are version-controlled.
- prerequisite milestones: real persistent Linux VM/host.
- conflicts with roadmap: none identified inside W1; implementation must stay within worker/enrollment/execution_safety/scheduler domains.
- recommendation: ADOPT_NOW

## AMPLIFIER_CANDIDATE: Rootless Podman + Quadlet

- name: Rootless Podman + Quadlet
- upstream/source: https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html ; https://github.com/containers/podman/releases
- current activity/maintenance: Podman 5.8.x security/maintenance releases in 2026; current Quadlet docs support rootless systemd-managed containers and require cgroup v2.
- какую проблему решает: reproducible worker packaging, rootless process/filesystem/network isolation, systemd lifecycle integration.
- expected benefit: accelerates containment and restart semantics without introducing Kubernetes.
- integration cost: medium.
- security risk: medium; container boundary still shares host kernel, so it must not be represented as microVM-grade isolation.
- vendor lock-in: low.
- reproducibility impact: high with pinned image digest + versioned Quadlet files.
- prerequisite milestones: persistent Linux VM, cgroup v2, dedicated unprivileged worker UID.
- conflicts with roadmap: none if used purely inside W1; must not replace required host-level evidence.
- recommendation: EXPERIMENT

## AMPLIFIER_CANDIDATE: Firecracker

- name: Firecracker microVM
- upstream/source: https://github.com/firecracker-microvm/firecracker ; https://github.com/firecracker-microvm/firecracker/blob/main/docs/RELEASE_POLICY.md
- current activity/maintenance: v1.16.1 released July 2026; v1.16 and v1.15 supported; active commits/issues in August 2026.
- какую проблему решает: stronger workload isolation than ordinary containers while retaining fast VM startup.
- expected benefit: strong process/kernel isolation for untrusted execution; aligns with future multi-tenant worker hardening.
- integration cost: high; requires KVM-capable host, jailer/network/rootfs orchestration, image lifecycle, and patch discipline.
- security risk: low to medium when correctly configured; project itself states secure multi-tenant posture depends on host configuration.
- vendor lock-in: very low.
- reproducibility impact: high with pinned release, kernel/rootfs hashes and declarative config.
- prerequisite milestones: persistent KVM-capable Linux host; hardened host baseline.
- conflicts with roadmap: none intrinsic, but adopting it now would materially expand W1 implementation scope.
- recommendation: DEFER

## AMPLIFIER_CANDIDATE: gVisor runsc

- name: gVisor `runsc`
- upstream/source: https://github.com/google/gvisor ; https://github.com/google/gvisor/pulls ; https://github.com/google/gvisor/issues
- current activity/maintenance: very active in July/August 2026 with hundreds of open PRs and current fixes/features.
- какую проблему решает: reduces direct host-kernel syscall exposure for OCI workloads through a userspace kernel.
- expected benefit: stronger container isolation while preserving OCI/container workflows.
- integration cost: medium.
- security risk: medium; compatibility surface is large and current issue traffic includes checkpoint/restore and seccomp behavior defects.
- vendor lock-in: low.
- reproducibility impact: positive if runsc build/tag is pinned.
- prerequisite milestones: persistent Linux host and container runtime integration.
- conflicts with roadmap: no direct domain conflict, but adoption before basic W1 evidence would increase debugging surface.
- recommendation: DEFER

## AMPLIFIER_CANDIDATE: Kata Containers

- name: Kata Containers
- upstream/source: https://github.com/kata-containers/kata-containers ; https://github.com/kata-containers/kata-containers/releases
- current activity/maintenance: 3.26–3.31 releases shipped throughout 2026 with explicit security fixes.
- какую проблему решает: VM-isolated containers with container runtime ergonomics.
- expected benefit: strong hardware-virtualized isolation and established containerd/Kubernetes integration.
- integration cost: high for a single first worker; significantly more moving parts than systemd/Podman.
- security risk: low to medium with timely patching.
- vendor lock-in: low.
- reproducibility impact: good with pinned release artifacts.
- prerequisite milestones: virtualization-capable host; container runtime; later multi-worker orchestration needs.
- conflicts with roadmap: scope/complexity expansion for W1.
- recommendation: DEFER

## AMPLIFIER_CANDIDATE: SPIFFE/SPIRE

- name: SPIFFE/SPIRE node and workload attestation
- upstream/source: https://github.com/spiffe/spire/releases ; https://github.com/spiffe/spire/blob/main/CHANGELOG.md ; https://spiffe.io/
- current activity/maintenance: SPIRE v1.15.2 released July 2026; active security fixes and attestation improvements in 2026.
- какую проблему решает: cryptographically stronger node/workload identity and attestation instead of ad-hoc worker identity claims.
- expected benefit: strong long-term identity foundation for worker enrollment and capability attestation.
- integration cost: medium to high; requires SPIRE server/agent trust domain and attestor policy.
- security risk: medium; attestors are security-critical and 2026 releases fixed multiple attestation vulnerabilities.
- vendor lock-in: low; open standard/open source.
- reproducibility impact: positive with versioned trust-domain and registration config.
- prerequisite milestones: stable worker host; supervisor approval for trust-plane integration.
- conflicts with roadmap: overlaps federation/signature/SPIFFE work already assigned to another workstream.
- recommendation: DEFER

## AMPLIFIER_CANDIDATE: Hetzner Cloud Server

- name: Hetzner Cloud VM
- upstream/source: https://docs.hetzner.com/cloud/servers/overview/
- current activity/maintenance: managed commercial cloud server product; current documentation remains available and describes VM servers, snapshots, firewalls and volumes.
- какую проблему решает: inexpensive real long-lived Linux VM substrate for the first W1 worker.
- expected benefit: simple persistent VM semantics; straightforward cloud-init/systemd bootstrap; good cost/performance.
- integration cost: low to medium technically, but requires a provider account/API credential not available in current connected tools.
- security risk: medium; public-cloud host and credential/bootstrap security must be controlled.
- vendor lock-in: medium.
- reproducibility impact: high with cloud-init/Terraform and pinned image identity.
- prerequisite milestones: Supervisor approval of provider choice and credentials/provisioning path.
- conflicts with roadmap: provider choice is a scope decision; cannot auto-adopt.
- recommendation: EXPERIMENT

## AMPLIFIER_CANDIDATE: Fly Machines

- name: Fly Machines with persistent rootfs/volume
- upstream/source: https://fly.io/docs/reference/configuration/ ; https://fly.io/docs/machines/guides-examples/machine-restart-policy/ ; https://fly.io/docs/volumes/overview/
- current activity/maintenance: current Fly docs expose `persist_rootfs`, restart policies and persistent volumes.
- какую проблему решает: managed VM-like worker instances with health checks, automatic restart and optionally persistent root filesystem/storage.
- expected benefit: fast managed provisioning and explicit always-restart behavior.
- integration cost: medium; requires external provider access and careful failure semantics.
- security risk: medium; managed platform lifecycle and hardware-local volume failure modes must be modeled.
- vendor lock-in: high.
- reproducibility impact: medium to high with declarative machine config, but provider-specific semantics are substantial.
- prerequisite milestones: Supervisor-approved provider experiment.
- conflicts with roadmap: provider adoption is scope expansion; physical host continuity is not guaranteed by logical Machine identity.
- recommendation: DEFER

## Step-01 recommendation summary

1. ADOPT_NOW (recommendation only; not auto-adopted): systemd + cgroup v2 as the baseline lifecycle/resource-control layer once a real persistent VM is available.
2. EXPERIMENT: rootless Podman/Quadlet for worker containment; Vercel Sandbox only for ephemeral isolation/state-continuity experiments; Hetzner as a candidate persistent VM provider if Supervisor authorizes provider provisioning.
3. DEFER: Firecracker, gVisor, Kata, SPIRE, Fly Machines until W1 has a minimal live persistent host or Supervisor explicitly expands scope.
4. REJECT for W1 persistence proof: treating Vercel snapshot-backed `persistent sandbox` terminology as evidence of a persistent underlying worker substrate.
