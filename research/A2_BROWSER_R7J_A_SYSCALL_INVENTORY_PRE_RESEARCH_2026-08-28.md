# A2 Browser R7J-A — Trace-Driven Seccomp Inventory — Pre-Implementation Research

Date: 2026-08-28
Parent verified milestone: R7I_HELPER_NETWORK_BOUNDARY
Parent verified commit: `8da22eee9426f267f5982e90db246799cfe37e1c`
Branch: `work/a2-browser-r7j-positive-seccomp-allowlist`

## Problem

R7I closes inherited file-descriptor authority, filesystem/TCP authority through R7H Landlock, and fresh socket/io_uring paths through a targeted Seccomp-BPF denylist. Its seccomp default action is still `Allow`. Replacing that policy with a positive allowlist without runtime evidence would either break legitimate helper paths or preserve unnecessary host-kernel attack surface.

## Primary-source comparison

### Firecracker / seccompiler

Firecracker uses architecture-specific seccomp filters and a default-restrictive model. The same `seccompiler` design already present in A2 supports a positive syscall map plus a restrictive default action. Reusing it avoids a second seccomp implementation and additional supply-chain surface.

### Chromium

Chromium treats Seccomp-BPF as one layer in a defense-in-depth sandbox and reduces the system-call interface visible to less-trusted processes. The relevant lesson for A2 is not to treat filesystem/network confinement as equivalent to host-kernel syscall confinement.

### gVisor

gVisor similarly minimizes host syscalls and emphasizes that host syscall exposure is attack surface. Its model reinforces the need to base a policy on the actual host interface exercised by the workload rather than on broad application-level capabilities.

### Linux seccomp

Linux seccomp filters are syscall/architecture sensitive. A filter that is incomplete for a workload fails closed only if the default action is restrictive; therefore an observed and audited inventory is a prerequisite to changing R7I from denylist/default-allow to allowlist/default-deny.

## Decision

Implement R7J-A as an evidence-only semantic slice:

1. build the exact R7I helper from the source-controlled lockfile;
2. run the real release helper under `strace` on Ubuntu x86_64;
3. exercise four representative paths:
   - LIST + READ_PACKAGE happy path over one stream;
   - typed source-error response for a missing skill;
   - malformed opcode termination;
   - oversized frame-prefix termination;
4. record complete traces;
5. derive both complete observed syscall sets and post-seccomp steady-state syscall sets, using the final successful `seccomp(...)` installation as the boundary;
6. fail the inventory gate if any post-seccomp path unexpectedly uses a known dangerous family such as networking, process creation/exec, ptrace, namespace/mount, BPF/perf/keyring, or io_uring;
7. publish deterministic evidence and provenance.

R7J-A does **not** modify the runtime seccomp policy and does **not** advance the Supabase authoritative checkpoint beyond R7I.

## Rejected alternatives

- **Guess the allowlist from source/docs only:** misses libc/runtime behavior and allocator/filesystem implementation details.
- **Keep extending the R7I denylist:** does not bound future or forgotten syscall surface.
- **Add libseccomp:** increases TCB and dependency cost without a demonstrated benefit over already-pinned `seccompiler`.
- **Wire Node before syscall minimization:** expands the long-lived attack surface before the helper boundary is fully reduced.
- **Treat one happy-path trace as complete:** misses error and malformed-message behavior that the helper must preserve after default-deny.

## New invariants

- R7J allowlist input MUST be trace-driven **and** source-audited.
- Inventory MUST be architecture-bound; the first target is Linux x86_64 / Rust 1.98.0.
- R7J-A evidence MUST preserve exact parent lockfile and helper source identity.
- No post-seccomp observed path may require networking, process creation/exec, ptrace, namespace/mount, BPF/perf/keyring, or io_uring.
- A syscall absent from traces is not automatically safe to omit until source/error-path audit is complete.
- R7J-A is evidence, not authority; R7I remains the authoritative runtime until the positive allowlist itself passes exact-head verification.
