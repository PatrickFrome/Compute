# A2 Browser R7I — Helper Network Boundary — Pre-Implementation Research

Date: 2026-08-28
Base: `30f5f8b80855f53fb49e9b580b9741415bb46987` (R7H VERIFIED)

## Problem

R7H removes ambient Landlock ABI4 filesystem write authority and denies TCP bind/connect, but it deliberately does not claim UDP isolation, a network namespace, inherited-fd hygiene, or a narrow syscall surface. Node integration must not make that residual authority reachable from a long-lived daemon.

## Research comparison

### Linux Landlock

Current kernel documentation adds UDP bind/connect-send controls only in Landlock ABI10. The exact-pinned `landlock=0.4.7` wrapper used by R7H supports a lower userspace ABI surface, so R7H correctly leaves UDP unclaimed. Landlock is a stackable access-control layer, not a complete syscall sandbox.

### Chromium / ChromeOS

Chromium uses multiple orthogonal layers. Filesystem/root isolation is explicitly insufficient because a non-root process can still reach a large kernel API; Seccomp-BPF narrows that attack surface, while namespaces isolate resource views.

### Bubblewrap / namespace sandboxes

A fresh network namespace is stronger than filtering selected network operations because it removes the host network view and normally leaves only loopback. It is still a different primitive from access control and can be host-policy-sensitive when created without privileges.

### Firecracker

Firecracker installs restrictive seccomp filters by default and uses a separate jailer for namespaces/cgroups/chroot/privilege setup. Its production pattern is important here: launcher/resource setup and in-process syscall restriction are separate boundaries, and the seccomp policy is a minimal allowlist rather than a security-sensitive denylist.

### Linux seccomp guidance

The seccomp manual strongly recommends allow-list policies when practical. A deny-list must track newly added syscalls/flags and can have ABI representation bypasses. Therefore an initial network-specific filter must not be described as a complete seccomp sandbox.

## R7I scope decision

R7I is a **network boundary milestone**, not the final syscall sandbox.

Target properties:

1. R7H remains mandatory and is installed before IPC service.
2. Helper launch tests must use explicit piped stdin/stdout/stderr and prove no intentionally inherited authority fd.
3. After root acquisition and R7H restriction, install a safe Rust Seccomp-BPF filter before the IPC loop.
4. Deny creation/use of socket/network syscalls that the read-only helper does not require, including UDP-capable paths.
5. Process tests must prove representative TCP and UDP operations fail after restriction while skill IPC still works.
6. Evidence must explicitly state that this is **not yet a complete syscall allowlist** and **not a network-namespace claim**.
7. No Node integration and no browser authority are added in R7I.

## Critical inherited-fd caveat

Denying `socket(2)` and socket-specific send/connect calls is insufficient if a process inherits an already-connected socket: ordinary `read(2)`/`write(2)` can operate on that descriptor. Therefore R7I evidence may only make a strong no-network claim for the controlled launcher/test contract where only stdio pipes are intentionally inherited. General inherited-fd sanitization belongs in the launcher boundary before Node integration.

## Safe implementation choice

Use `seccompiler`'s safe Rust API rather than handwritten unsafe BPF/prctl code. Exact-pin the dependency, keep source-controlled `Cargo.lock`, compile a target-architecture filter in process, install it with TSYNC where supported by the library, and fail closed if construction or installation fails.

The first policy is deliberately narrow in claim:

- default: allow (temporary R7I network-boundary policy);
- matched network syscalls: return `EPERM`;
- architecture: exact host target supported by seccompiler;
- installation: before the first R7G request is read.

This deny-list is an incremental defense against the concrete R7H UDP gap. It is not the final seccomp design. The next hardening milestone must derive a positive allowlist from observed helper syscalls and then test it adversarially, following the Chromium/Firecracker direction.

## Acceptance gate

R7I is eligible for VERIFIED only if one exact head proves:

- R7F/R7F1/R7G/R7H inherited tests green;
- exact source-controlled dependency closure;
- fmt + Clippy `-D warnings`;
- real process TCP and UDP probes denied after sandbox install;
- normal LIST + READ_PACKAGE still green;
- filter ordering is `open root -> Landlock -> seccomp -> IPC loop`;
- no Node/browser authority;
- deterministic evidence + build provenance.

If dependency resolution or kernel behavior differs from this research, change the implementation/claim rather than weakening fail-closed behavior.