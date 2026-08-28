# A2 Browser R7J-B — Positive Seccomp Allowlist — Pre-Implementation Research

Date: 2026-08-28
Parent verified runtime: R7I `8da22eee9426f267f5982e90db246799cfe37e1c`
Inventory evidence heads: `60a0efae6d2a99aafec0e3e97d56fc6cb4c2a130`, `09251dd9fed769c74d05e38a971da5213e417ea6`

## Problem

R7I blocks known network and io_uring syscalls but still uses a default-Allow seccomp policy. That leaves every forgotten or future syscall exposed to the helper process. R7J-A measured the real post-seccomp workload and source-audited it, including the maximum permitted package size.

## Primary-source comparison

### Firecracker

Firecracker uses target-specific seccomp filters with the bare minimum syscalls and arguments required by each process/thread role. Its `seccompiler` format models an allowlist as a restrictive `default_action` plus `filter_action = allow`. A2 already pins the same `seccompiler` crate, so no new seccomp dependency is required.

### Chromium

Chromium uses seccomp-BPF as a kernel attack-surface-reduction layer in addition to other confinement mechanisms. Chromium explicitly notes that an exhaustive syscall list is required and that strong test coverage must run under the sandbox because unexercised code paths can otherwise break only after deployment.

### gVisor

gVisor uses seccomp as a second layer against host-kernel attacks and treats every allowed host syscall as additional attack surface. This supports keeping the A2 policy target-specific and small rather than adding speculative runtime syscalls for portability.

### Linux seccomp

Seccomp actions operate before the syscall effect occurs. `ERRNO(EPERM)` therefore provides a deterministic deny action suitable for this verification stage, while retaining diagnosable failures. Kill/trap can be considered after coverage is mature.

## Evidence-backed steady-state set

The representative four-path trace produced 12 post-seccomp syscalls. The exact maximum package-content trace added only allocator syscalls `brk` and `mmap`, yielding the final evidence-backed set of 14:

- brk
- close
- exit_group
- fcntl
- getdents64
- lseek
- mmap
- munmap
- openat
- openat2
- read
- sigaltstack
- statx
- write

No dangerous-family syscall was observed after seccomp.

## Decision

Implement a Linux x86_64 positive allowlist with the existing `seccompiler=0.5.0`:

- filter map: exactly the 14 evidence-backed syscall numbers;
- matching action: `ALLOW`;
- default action: `ERRNO(EPERM)`;
- TSYNC: retained;
- non-x86_64: fail closed before IPC;
- no fallback to the R7I default-Allow denylist;
- no new dependency;
- no Node/browser authority.

## Why

SECURITY: converts an open-ended kernel interface into a 14-syscall steady-state interface.

RELIABILITY: the policy is based on real release-helper traces across happy, error, malformed, and maximum-size paths.

TCB SIZE: reuses the already reviewed/pinned seccompiler stack.

COMPLEXITY: one policy inversion plus isolated process tests; no new launcher or serialization layer.

SUPPLY-CHAIN COST: zero new packages; exact Cargo.lock remains unchanged.

PORTABILITY: intentionally narrow. The first policy is Linux x86_64 / Rust 1.98.0 / current GNU runtime. Other targets require their own observed policy delta.

OBSERVABILITY: EPERM makes denied calls diagnosable during the compatibility phase.

TESTABILITY: subprocess probes can install the irreversible filter without breaking the parent Rust test harness.

## Rejected alternatives

- **Add speculative syscalls such as futex/mremap/mprotect:** not evidence-backed post-seccomp and weakens the boundary.
- **Use Kill immediately:** stronger failure behavior but worse diagnosis before policy coverage is mature.
- **Keep default Allow:** preserves the exact gap R7J is intended to close.
- **Add libseccomp:** unnecessary dependency/TCB growth.
- **Install the positive filter inside the parent test harness:** would constrain unrelated Rust harness teardown and obscure policy failures.
- **Connect Node now:** expands input exposure before the kernel interface is minimized.

## New invariants

- `default_action = ERRNO(EPERM)`.
- `filter_action = ALLOW`.
- allowed syscall count = 14 on x86_64.
- no R7I default-Allow fallback.
- unsupported architecture fails before IPC service.
- every existing helper-process behavior must run under the positive policy.
- maximum package-content path must succeed under the positive policy.
- an intentionally unlisted harmless syscall must return EPERM, proving default deny is live.
- fresh socket creation and process creation/exec attempts remain denied.
- R7F openat2 confinement and R7H Landlock remain mandatory lower layers.
- exact Cargo.lock and dependency closure remain unchanged.
