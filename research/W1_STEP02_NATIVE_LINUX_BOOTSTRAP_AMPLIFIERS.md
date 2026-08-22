# W1 Step 02 — Native Linux bootstrap amplifier research

Date: 2026-08-21
Milestone: `W1_PERSISTENT_LINUX_WORKER_SAFETY`
Classification: RESEARCH ONLY. No candidate below changes milestone scope without Supervisor approval.

## Baseline implemented by this step

The branch now contains a dependency-light native Linux baseline using systemd service sandboxing, cgroup v2, kernel pidfd/openat2/seccomp primitives, rlimits, pinned egress rules and a fail-closed heartbeat agent. The GitHub workflow is explicitly `LIVE_EPHEMERAL_GITHUB_HOSTED` and sets `persistent_worker_proof=false`. A real persistent host is still required for W1 acceptance.

## AMPLIFIER_CANDIDATE: Linux Landlock

- name: Linux Landlock LSM
- upstream/source: https://www.kernel.org/doc/html/latest/security/landlock.html ; https://www.kernel.org/doc/html/latest/userspace-api/landlock.html
- current activity/maintenance: current kernel documentation was updated in 2026; current userspace API documents ABI evolution including filesystem, TCP/UDP and IPC restrictions.
- какую проблему решает: lets an unprivileged worker further restrict its own filesystem/network ambient rights in addition to systemd mount namespaces and openat2 path discipline.
- expected benefit: defense in depth against path traversal, compromised worker code and accidental over-broad filesystem/network access; rules only add restrictions.
- integration cost: medium; requires runtime ABI detection and kernel built/booted with Landlock enabled.
- security risk: low to medium; kernel LSM surface is small, but older ABI versions lack newer restrictions and special filesystems still have limitations.
- vendor lock-in: none beyond Linux.
- reproducibility impact: positive when ABI, handled rights and ruleset are emitted into evidence.
- prerequisite milestones: real persistent Linux host; kernel feature probe.
- conflicts with roadmap: none in W1 execution_safety; adding it as a hard requirement would narrow supported host kernels and therefore needs Supervisor scope approval.
- recommendation: EXPERIMENT

## AMPLIFIER_CANDIDATE: nsjail

- name: google/nsjail
- upstream/source: https://github.com/google/nsjail ; https://github.com/google/nsjail/releases
- current activity/maintenance: nsjail 3.6 released March 2026; repository shows current 2026 maintenance activity and fixes.
- какую проблему решает: packages namespaces, cgroups, rlimits and seccomp-bpf into a mature per-process jail runner.
- expected benefit: could replace substantial custom per-job isolation glue and make process/filesystem/network/resource containment declarative.
- integration cost: medium; binary packaging, config generation, kernel/user-namespace posture, and cgroup integration must be pinned and tested.
- security risk: medium; isolation correctness depends on kernel namespaces and nsjail configuration. 2026 issues show active work around mount behavior, cgroups and process reaping.
- vendor lock-in: low; open-source Linux tool.
- reproducibility impact: high with pinned release/binary digest and versioned protobuf config.
- prerequisite milestones: stable persistent Linux host and a defined per-job execution contract.
- conflicts with roadmap: introducing it now would be an implementation dependency/scope expansion beyond the minimal W1 host proof.
- recommendation: EXPERIMENT

## AMPLIFIER_CANDIDATE: bubblewrap

- name: containers/bubblewrap
- upstream/source: https://github.com/containers/bubblewrap/releases ; https://github.com/containers/bubblewrap/blob/main/NEWS.md
- current activity/maintenance: 0.11.2 released April 2026 as a security update for CVE-2026-41163 affecting setuid mode; upstream recommends normal non-setuid builds.
- какую проблему решает: lightweight user/mount/pid namespace construction and filesystem view isolation.
- expected benefit: simpler per-job filesystem namespace than bespoke mount setup; non-setuid mode is compatible with least-privilege design where user namespaces are available.
- integration cost: low to medium.
- security risk: medium; recent setuid-mode vulnerability demonstrates why W1 should reject setuid deployment. It also does not replace cgroup resource accounting/fencing.
- vendor lock-in: low.
- reproducibility impact: positive with pinned non-setuid binary digest and exact argv/mount policy receipt.
- prerequisite milestones: host user namespaces enabled; systemd/cgroup resource layer remains required.
- conflicts with roadmap: none conceptually, but adding it now is unnecessary for first host proof.
- recommendation: DEFER

## AMPLIFIER_CANDIDATE: systemd transient per-job units

- name: systemd transient services/scopes
- upstream/source: https://www.freedesktop.org/software/systemd/man/latest/systemd-run.html ; https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html
- current activity/maintenance: systemd remains actively maintained with 2026 stable releases; this step already uses its service sandbox and cgroup resource properties as baseline implementation, not as a new roadmap scope.
- какую проблему решает: creates one cgroup/lifecycle boundary per command with deterministic CPU/memory/PID limits and kill-whom=all fencing.
- expected benefit: extends the already-selected host supervisor into per-job containment without introducing a second runtime.
- integration cost: low to medium; needs carefully delegated launcher authority rather than granting the worker broad systemd privileges.
- security risk: medium if a worker can submit arbitrary unit properties; must be mediated by a fixed allowlisted launcher contract.
- vendor lock-in: low on modern Linux distributions.
- reproducibility impact: high when every property set is hashed into the execution receipt.
- prerequisite milestones: persistent host + hardened privileged launcher design.
- conflicts with roadmap: launcher privilege boundary is new implementation work and should be Supervisor-approved before adoption.
- recommendation: EXPERIMENT

## AMPLIFIER_CANDIDATE: rootless Podman + Quadlet

- name: rootless Podman + Quadlet
- upstream/source: https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html ; https://github.com/containers/podman/releases
- current activity/maintenance: current Podman/Quadlet documentation supports rootless systemd-managed containers on cgroup v2; active 2026 release line.
- какую проблему решает: OCI image reproducibility plus rootless filesystem/process namespace packaging.
- expected benefit: simple content-addressed worker/job images and cleaner dependency isolation.
- integration cost: medium.
- security risk: medium; shared host kernel means it is not a microVM boundary, and container image supply chain becomes part of W1 evidence.
- vendor lock-in: low.
- reproducibility impact: high with image digest pinning.
- prerequisite milestones: persistent host; explicit image provenance policy.
- conflicts with roadmap: no domain conflict, but dependency/image scope is larger than first persistent-host proof.
- recommendation: DEFER

## Recommendation summary

- Keep the current minimal systemd+cgroup v2+kernel-primitives baseline for the first real persistent host.
- EXPERIMENT after Supervisor approval: Landlock first (smallest extra privilege/dependency surface), then nsjail or mediated transient per-job units depending the desired execution model.
- DEFER: bubblewrap and Podman until a persistent host has already produced canonical W1 evidence.
- REJECT: setuid bubblewrap for this milestone; any sandbox path that weakens default-deny networking or gives the worker arbitrary systemd control.
