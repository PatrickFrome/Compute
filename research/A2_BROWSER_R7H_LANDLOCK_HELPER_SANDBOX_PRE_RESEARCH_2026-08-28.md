# A2 Browser R7H — Landlock Helper Sandbox — Pre-Research

Date: 2026-08-28
Parent: verified R7G bounded binary helper protocol at `2760e2c3cd1ccb8c3869767be9f39a1e33e887a4`
Status at write time: implementation candidate, not yet verified

## Problem

R7F/R7F1 make every skill-path operation root-relative, symlink/magic-link/mount confined, hardlink-aware and cardinality-bounded. R7G reduces the helper IPC surface to two bounded operations. However, the helper process still starts with the host process' ambient filesystem and network namespace rights. A memory-safety or logic defect outside the R7F path would therefore have more authority than the protocol itself requires.

R7H adds an irreversible process-level Landlock layer after the exact skill root is opened and before the first IPC request is read.

## Current external comparison

### Linux Landlock

The Linux kernel documents Landlock as unprivileged self-restriction. Rules stack and can only add restrictions. Importantly, file descriptors opened before restriction preserve their acquired rights. This fits the A2 lifecycle exactly:

```text
operator-configured root
        ↓
R7F open root descriptor once
        ↓
Landlock restrict current helper
        ↓
R7G request loop
```

Kernel documentation:
- https://cdn.kernel.org/doc/html/latest/userspace-api/landlock.html
- https://cdn.kernel.org/doc/html/latest/security/landlock.html

### rust-landlock 0.4.7

`landlock` 0.4.7 is a safe Rust wrapper and understands Landlock through ABI 9. The crate documentation recommends `CompatLevel::HardRequirement` when an application must fail rather than silently downgrade, and recommends verifying `RulesetStatus::FullyEnforced` plus `no_new_privs=true` in security-sensitive tests.

Sources:
- https://docs.rs/landlock/0.4.7/landlock/
- https://docs.rs/landlock/0.4.7/landlock/struct.Ruleset.html
- https://docs.rs/landlock/0.4.7/landlock/enum.RulesetStatus.html

The R7H baseline intentionally requests ABI 4 rights only. ABI 4 is the first Landlock ABI with TCP bind/connect restrictions and already covers the filesystem write/read/execute rights needed by this helper.

### UDP residual gap

The current kernel documentation adds UDP restrictions at Landlock ABI 10. `landlock` 0.4.7 only exposes `AccessNet::{BindTcp, ConnectTcp}` and therefore cannot express ABI 10 UDP policy.

R7H must not claim full network isolation. Its explicit claim is:
- filesystem access: only read beneath the exact R7F root descriptor;
- TCP bind: denied;
- TCP connect: denied;
- UDP isolation: **not claimed**.

Full network-off requires a later network-namespace/seccomp layer or a crate/toolchain upgrade that can express and verify ABI 10.

### Chromium and Bubblewrap

Chromium uses layered namespaces plus Seccomp-BPF because no single Linux mechanism is a complete sandbox. Bubblewrap similarly uses namespaces, including an optional isolated network namespace, and can add seccomp policy.

Sources:
- https://chromium.googlesource.com/chromium/src/+/refs/heads/main/sandbox/linux/README.md
- https://github.com/containers/bubblewrap

A2 consequence: R7H is a strong first process restriction layer, not the final sandbox claim. A later layer should remove the residual UDP/network namespace and syscall attack surface before Node integration is considered complete.

## R7H policy

Hard-required ABI: 4.

Filesystem handled rights:
```text
AccessFs::from_all(ABI::V4)
```

Only allowed filesystem rights:
```text
PathBeneath(existing_R7F_root_fd, AccessFs::from_read(ABI::V4))
```

This means:
- root package reads continue;
- new ambient reads outside root are denied;
- writes/creates/removes/truncates beneath root are denied;
- execution is not allowed by any rule.

Network handled rights:
```text
AccessNet::from_all(ABI::V4)
```

No `NetPort` allow rules are added, therefore all TCP bind/connect operations are denied.

The ruleset is configured with `CompatLevel::HardRequirement`. After `restrict_self()`, R7H accepts only:
```text
ruleset == RulesetStatus::FullyEnforced
no_new_privs == true
```
Any unsupported/partial state is a typed startup failure and the IPC loop is never entered.

## Descriptor identity

R7H does not reopen the configured root by pathname when creating `PathBeneath`. The sandbox module is a child of the R7F library and builds the rule on `&LinuxSkillSource.root`, i.e. the exact already-opened descriptor. This removes a pathname replacement race between loader bootstrap and sandbox policy installation.

## Evidence requirements

R7H is verified only when exact-head CI proves:
- exact Rust 1.98.0;
- exact direct deps `rustix=1.1.4`, `landlock=0.4.7`;
- generated dependency closure is recorded and denylisted before lock promotion;
- rustfmt + Clippy `-D warnings` + all R7F1/R7G tests pass;
- helper protocol still LISTs and READ_PACKAGEs after restriction;
- fresh `/etc/passwd` read is denied;
- fresh write beneath skill root is denied;
- TCP connect to a listener created before sandbox is denied;
- new TCP bind is denied;
- `SandboxReport.udp_isolation_claimed == false`;
- static source order is `LinuxSkillSource::open` → `restrict_helper_process` → `read_request`;
- R7C/R7E JS package/registry regressions pass;
- deterministic evidence tar receives GitHub/Sigstore provenance.

## Non-claims

R7H does not claim:
- UDP isolation;
- network namespace isolation;
- seccomp syscall filtering;
- PID/user/mount namespace isolation;
- Node daemon integration;
- skill script execution authority;
- browser authority.

These remain separate milestones so the evidence never overstates the actual Linux enforcement primitive.
