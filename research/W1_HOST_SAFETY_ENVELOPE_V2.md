# W1 Host Safety Envelope V2 — Active Evidence Research

Date: 2026-08-27
Canonical target: `C1` / Level-2 `W1_PERSISTENT_LINUX_WORKER_SAFETY`

## Live gap that motivated this slice

The live Supabase recovery project currently has no W1 backend binding, no reboot receipt, no dedicated Linux safety verification, and no admitted `cpu-local` worker. One old `cpu-local` enrollment (`glm-sandbox-worker-01`) remains `AUTH_BOUND`; its latest observations are expired `OBSERVED_FAIL` evidence rather than admission evidence.

The enabled `linux-h1-h13-v1` policy requires a combined envelope: Linux/rootless/no-new-privs, seccomp filter + architecture/policy identity, pidfd open/waitid/send-signal lifecycle, cgroup v2 CPU/memory/pids + kill, finite rlimits, mount/process-tree isolation, dirfd-bound openat2 workspace resolution, and network default deny.

The existing `host_observation_collector.py` tests several capability bits but does not actively prove all of those enforcement properties.

## Upstream research

### pidfd: stable process identity and lifecycle

`pidfd_open()` produces a file descriptor that refers to a specific task. A pidfd can be polled for task exit, and `pidfd_send_signal()` avoids the PID-reuse race of traditional PID-based signaling. This is stronger evidence than checking only that `os.pidfd_open` exists.

References:
- https://man7.org/linux/man-pages/man2/pidfd_open.2.html
- https://man7.org/linux/man-pages/man2/pidfd_send_signal.2.html

Design consequence: the V2 probe creates a disposable child, obtains a pidfd, proves signal delivery through the pidfd, observes termination through pidfd/waitid semantics, and never treats a numeric PID alone as the lifecycle fence.

### cgroup v2: capability versus actual enforcement

The kernel cgroup v2 documentation defines resource controls and process hierarchy semantics. `memory.max` is a hard memory limit; `pids.max` is a hard task-count limit; CPU is controlled through `cpu.max`; `cgroup.kill` is the process-tree termination primitive for a cgroup.

Reference:
- https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html

Design consequence: merely seeing `cgroup.controllers` is insufficient. The V2 probe attempts to create a disposable delegated child cgroup, writes finite CPU/memory/pids limits, moves a parent into it before it forks a descendant, proves both tasks inherited the cgroup, then uses `cgroup.kill` and pidfds to prove tree termination. The canary never moves or kills the probe itself.

### seccomp: prove an installed filter, not only mode support

Linux seccomp filter mode evaluates a BPF program over syscall metadata. Unprivileged filter installation requires `no_new_privs` unless the task has `CAP_SYS_ADMIN` in its namespace. `/proc/<pid>/status` exposes both `Seccomp` mode and `Seccomp_filters` count.

References:
- https://www.kernel.org/doc/html/latest/userspace-api/seccomp_filter.html
- https://www.man7.org/linux/man-pages/man5/proc_pid_status.5.html

Design consequence: the V2 probe keeps the actual worker-process `Seccomp=2` / filter-count observation and separately forks a disposable child that installs a small repository-defined BPF filter, blocks a known harmless syscall with `EPERM`, reads back its filter mode/count, and emits a deterministic filter-policy digest. This proves active filter mechanics and policy identity without weakening the existing worker filter.

### descriptor-bound workspace resolution

`openat2()` provides resolution restrictions intended for trusted programs resolving untrusted paths. `RESOLVE_BENEATH` rejects escapes above the supplied directory fd; `RESOLVE_NO_MAGICLINKS`, `RESOLVE_NO_SYMLINKS`, and `RESOLVE_NO_XDEV` further constrain resolution.

Reference:
- https://www.man7.org/linux/man-pages/man2/openat2.2.html

Design consequence: the V2 probe anchors a canary to a real directory fd in the current worker workspace, proves a normal file opens, and proves `..` and symlink escapes fail with the strict resolution mask. No caller-provided workspace path is accepted.

### network namespace default-deny evidence

Network namespaces isolate network devices, IPv4/IPv6 stacks, routing tables, firewall state, `/proc/net`, and `/sys/class/net` from other namespaces.

References:
- https://man7.org/linux/man-pages/man7/network_namespaces.7.html
- https://man7.org/linux/man-pages/man7/namespaces.7.html

Design consequence: the V2 policy evidence requires a network namespace distinct from PID 1 and no IPv4/IPv6 default route. This is intentionally conservative: explicit future allowlist routes may exist, but an ambient default route is not accepted as `default_deny` evidence.

### mount namespace isolation

Mount namespaces give a process an isolated view of the mount hierarchy.

Reference:
- https://man7.org/linux/man-pages/man7/mount_namespaces.7.html

Design consequence: the probe compares its mount namespace handle with PID 1 and fails closed if the worker remains in the host's initial mount namespace.

## Implementation

New artifacts:

- `worker/native_linux/host_safety_envelope_probe.py`
- `controller/w1/host_safety_envelope_validator.py`
- `controller/w1/host_safety_evidence_bundle.py`
- `tests/test_w1_host_safety_envelope_v2.py`

The one-command bundle runs only repository-pinned local code and emits:

1. exact source Git/tree provenance;
2. active host safety observation;
3. deterministic independent validation decision;
4. hashes for the probe, observation, decision and whole bundle;
5. explicit non-authority boundaries.

A successful result is only:

`SAFETY_ENVELOPE_ELIGIBLE_NON_PERSISTENT`

It is never equivalent to worker admission or W1 verification.

## Why this advances C1 more than another control-plane feature

The live W1 blocker is no longer roadmap selection. The missing evidence is runtime evidence from an actual Linux host. This slice converts the existing abstract safety policy into a single executable evidence surface that can be run immediately when a persistent host is bound. It therefore reduces the next live experiment from multiple ad-hoc probes to one deterministic artifact while preserving independent provider identity/reboot verification.

## Explicit boundaries

- no real Linux host was claimed by this implementation step;
- no AWS/other provider API call was made;
- no provider reboot was executed;
- no backend binding was created;
- no Supabase safety observation or verification was inserted;
- no worker was admitted;
- W1 remains `READY`, not `VERIFIED`;
- no PR merge or force-push was performed.
