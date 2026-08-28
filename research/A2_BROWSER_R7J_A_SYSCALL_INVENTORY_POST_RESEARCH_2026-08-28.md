# A2 Browser R7J-A — Trace-Driven Seccomp Inventory — Post-Implementation Research

Date: 2026-08-28
Parent verified runtime: R7I `8da22eee9426f267f5982e90db246799cfe37e1c`

## Evidence

### Representative-path inventory

Commit: `60a0efae6d2a99aafec0e3e97d56fc6cb4c2a130`
Workflow run: `33209707580`
Artifact: `9701094540`
Artifact ZIP SHA-256: `4b7ae2467bcf6ea8f3ab840b3bc302b949572d67d7d85753b0cfcc0fefd3c51c`
Attested tar SHA-256: `2d7a3f62de3cead0d96cc19f72c6b279c3d2a23a86d7eb4f6b60f88e4ca5faf0`
Sigstore attestation: `43755228`
Rekor index: `2628780524`

Four real release-helper paths were traced after the final seccomp installation:

- LIST + READ_PACKAGE;
- missing-skill typed source error;
- malformed opcode termination;
- oversized-frame-prefix termination.

Their post-seccomp union was 12 syscalls:

`close, exit_group, fcntl, getdents64, lseek, munmap, openat, openat2, read, sigaltstack, statx, write`

No network, process creation/exec, ptrace, namespace/mount, BPF/perf/keyring, or io_uring syscall appeared after seccomp.

### Allocator-stressed inventory

Commit: `09251dd9fed769c74d05e38a971da5213e417ea6`
Workflow run: `33209903551`
Artifact: `9701164110`
Artifact ZIP SHA-256: `16e27a9408dad7f74e99767dd323f8386ae1801cc0955d92aa41f1bbb578c818`
Attested tar SHA-256: `222e496a0841e1c18b5eefa0febf2b6e3e3f0651d88a91551deb996b495b7ea6`
Sigstore attestation: `43755710`
Rekor index: `2628792225`

The helper read and streamed a package at the exact R7C content-byte ceiling:

- `SKILL.md`: 96 KiB;
- 8 resources: 256 KiB each;
- total content bytes: 2,195,456.

That path added only `brk` and `mmap`. The resulting post-seccomp union is therefore exactly 14 syscalls:

1. `brk`
2. `close`
3. `exit_group`
4. `fcntl`
5. `getdents64`
6. `lseek`
7. `mmap`
8. `munmap`
9. `openat`
10. `openat2`
11. `read`
12. `sigaltstack`
13. `statx`
14. `write`

Dangerous-family intersection remained empty.

## Source audit

The observed filesystem calls map directly to R7F implementation behavior:

- `openat2`: confined skill/resource opens;
- `fcntl` + `openat` + `getdents64`: `rustix::fs::Dir::read_from` directory enumeration;
- `statx`: `File::metadata` on the current Linux/Rust/libc stack;
- `lseek`: the explicit same-inode verification reread;
- `read`, `close`: bounded file and IPC input handling;
- `write`: bounded R7G responses and typed fatal errors.

The memory/termination calls are also justified by implementation behavior:

- `brk` and `mmap`: the system allocator under actual package-limit pressure;
- `munmap`: deallocation/runtime teardown;
- `sigaltstack` and `exit_group`: observed Rust runtime teardown.

The source intentionally preallocates large file buffers from known metadata lengths (`Vec::with_capacity`) and the package-limit trace exercised the maximum permitted content volume. `mremap`, `madvise`, `futex`, `mprotect`, and other speculative runtime calls were not observed post-seccomp and are not required by the audited steady-state source paths.

## Comparison to strongest analogues

### Firecracker

Firecracker uses target-specific seccomp filters and `seccompiler`, with a restrictive default action and an allow action for matched syscalls. A2 should follow the same philosophy: keep the allowlist tied to a specific build/runtime target instead of inflating it for hypothetical portability.

### Chromium

Chromium’s sandbox demonstrates why this allowlist remains only one layer: syscall minimization complements, rather than replaces, namespace/resource and filesystem isolation. R7F/R7H/R7I therefore remain mandatory layers underneath R7J.

### gVisor

gVisor’s host-syscall minimization reinforces the same boundary: every extra allowed host syscall is attack surface. The inventory should be minimal and evidence-driven.

## R7J-B decision

Implement an x86_64 Linux positive allowlist using the already pinned `seccompiler=0.5.0`:

- matched action: `ALLOW`;
- default action: `ERRNO(EPERM)`;
- initial allowed set: exactly the 14 evidence-backed steady-state syscalls above;
- no new dependencies;
- no Node integration;
- no network namespace claim;
- no automatic fallback to R7I default-allow policy;
- unsupported architecture: fail closed before IPC service.

`ERRNO(EPERM)` is chosen for this milestone rather than kill/trap because it denies the syscall effect while allowing deterministic negative probes and typed operational diagnosis. A later hardening step may evaluate kill/trap after policy coverage is mature.

## Required R7J-B proofs

- all existing R7F/R7G/R7H/R7I regression tests remain green;
- LIST + READ_PACKAGE and typed error/malformed paths remain operational under default-deny;
- exact max-size package succeeds under default-deny;
- a deliberately unlisted harmless syscall proves the default action is active;
- fresh network socket creation remains denied;
- process creation/exec attempt remains denied;
- static source proof shows `default=ERRNO(EPERM)` and `filter_action=ALLOW`;
- exact lockfile and dependency closure remain unchanged;
- deterministic artifact and Sigstore provenance bind the exact source SHA.

## Explicit portability boundary

R7J-B is initially a Linux x86_64 policy validated on the Ubuntu 24.04 / Rust 1.98.0 / current GNU runtime used by CI. If another libc/runtime/toolchain needs an additional steady-state syscall, that target must receive its own observed and reviewed policy delta; the x86_64 allowlist must not silently grow for unverified targets.
