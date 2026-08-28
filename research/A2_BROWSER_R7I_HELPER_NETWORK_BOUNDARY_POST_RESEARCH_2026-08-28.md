# A2 Browser R7I — Helper Network Boundary — Post-Implementation Research

Date: 2026-08-28
Candidate: `8491a97a285c0308a522e00771e01ddc69753291`
Candidate workflow: `33208254686`
Candidate artifact: `9700546022`

## Candidate evidence

The revised sanitize-then-verify architecture passed on GitHub-hosted Ubuntu 24.04:

- dependency resolver/audit: PASS, 18 packages;
- fmt + Clippy `-D warnings`: PASS;
- inherited R7G protocol unit tests: PASS;
- R7F1 cardinality tests: PASS;
- legacy helper process tests: 4/4 PASS;
- R7H Landlock regression: PASS;
- new R7I network boundary test: 1/1 PASS;
- R7 package/registry JS regressions: PASS;
- deterministic candidate evidence: PASS;
- Sigstore build provenance: PASS.

The adversarial launch deliberately inherited non-CLOEXEC fd 9. The helper successfully removed that ambient capability with `close_range(3..UINT_MAX, CLOSE_RANGE_UNSHARE)`, verified the post-cleanup fd table, and exited cleanly on EOF. This also fixed the real-world failure seen when ordinary Cargo test processes supplied additional inherited descriptors.

After R7H + R7I Seccomp-BPF installation, representative fresh UDP, TCP, and Unix socket creation returned `PermissionDenied`, while the already-open R7F skill-root capability continued to serve deterministic package reads.

Release helper candidate:

- size: 433,992 bytes;
- SHA-256: `8af667459dbf50c256be79227c09db89f6a8ae87ff2fc15936ca09dedd002ecb`.

Generated candidate lockfile SHA-256: `ffdf4d85f832e92b20960ecdbc581103a113cf9ddfa93fa319ba124f21a3d003`.

## Architecture comparison after implementation

### Firecracker

The result now matches an important Firecracker jailer invariant more closely: ambient descriptors are destroyed before the confined workload begins using delegated resources. Firecracker performs that operation in a separate jailer before exec; R7I currently performs it at the beginning of helper `main`. Therefore R7I has the same object-capability intent but not yet the same earliest possible cut point.

### Chromium

Chromium’s stronger model remains the target for the next layer. Chromium combines namespace/resource isolation with a positive Seccomp-BPF policy because removing filesystem/network authority alone does not reduce the entire kernel syscall attack surface. R7I closes the concrete R7H UDP/new-socket gap, but its Seccomp-BPF default action is still `Allow`.

### Linux close_range

The observed Cargo process failure validates the Linux man-page guidance: relying on parent CLOEXEC hygiene is not a sufficient security contract. `close_range(..., CLOSE_RANGE_UNSHARE)` is both more deterministic and less race-prone than `/proc/self/fd` close loops. Keeping the procfs walk only as postcondition verification is a better separation of responsibilities.

## Security conclusions

### What R7I may claim after seal

Under the helper’s controlled Linux bootstrap:

- inherited descriptors >=3 are kernel-sanitized before root acquisition;
- sanitization is independently verified before root acquisition;
- only one locally audited unsafe syscall seam exists for the scalar close-range call;
- R7H filesystem/TCP restrictions remain fully enforced;
- new socket creation and socket-network operations represented by the R7I syscall set are denied with EPERM;
- `io_uring_setup`, `io_uring_enter`, and `io_uring_register` are denied to remove an alternate submission surface;
- R7G IPC remains functional;
- no Node integration or browser authority exists.

### What R7I must not claim

- no complete syscall sandbox;
- no network namespace;
- no proof against future kernel syscalls omitted from the denylist;
- no guarantee that every future architecture uses identical syscall numbering without a separately built/tested filter;
- no pre-exec parent-side descriptor sanitation yet.

## Supply-chain finding

`seccompiler=0.5.0` adds one direct package and reuses exact `libc=0.2.189`; the complete candidate closure is 18 packages. Introducing a separate fd-guard crate would have expanded the dependency trust surface for functionality expressible through the already-pinned libc boundary, so the local one-syscall seam remains the smaller TCB.

## Next best milestone: R7J positive Seccomp allowlist

Before Node/daemon integration, move from R7I’s targeted deny boundary to a positive syscall allowlist, following the Chromium/Firecracker direction.

Recommended workflow:

1. Trace the exact helper workload before allowlist installation across LIST, READ_PACKAGE, malformed-message termination, source-error response, Landlock bootstrap, and close-range verification.
2. Build an explicit architecture-specific syscall inventory.
3. Classify syscalls into bootstrap-only and steady-state sets.
4. Install the smallest steady-state allowlist after root open, fd sanitation, and Landlock setup.
5. Default-deny all unlisted syscalls, preferably with a deterministic EPERM/KILL policy chosen per failure semantics.
6. Add negative probes for representative dangerous syscall families (network, process creation/exec, ptrace, namespace changes, mounts, keyring/BPF/perf/io_uring).
7. Keep deterministic exact-head evidence and source-controlled lock/provenance.

This is more valuable than immediately wiring Node to the helper: once a long-lived daemon can feed untrusted requests into the parser, Chromium-style kernel attack-surface reduction becomes materially more important.

A later production Node launcher should additionally move `close_range` into a pre-exec hook or dedicated launcher process, preserving only an explicit IPC/stdin/stdout/stderr allowlist, so ambient capabilities are cut before the helper executable itself starts.