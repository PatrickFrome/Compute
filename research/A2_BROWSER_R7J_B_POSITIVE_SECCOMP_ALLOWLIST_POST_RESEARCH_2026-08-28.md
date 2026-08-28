# A2 Browser R7J-B — Positive Seccomp Allowlist — Post-Implementation Research

Date: 2026-08-28
Parent verified runtime: R7I `8da22eee9426f267f5982e90db246799cfe37e1c`
Candidate before final research seal: `9171a558c637454d4a8bb8cc2f5ab99896e6c221`
Candidate verification run: `33211001642`
Candidate artifact: `9701582775`

## Result

The trace-driven Linux x86_64 positive seccomp policy works on the full R7 helper workload exercised by the current verification matrix. The helper now changes from R7I's default-Allow denylist to an evidence-backed default-deny policy with exactly 14 allowed steady-state syscalls:

- `brk`
- `close`
- `exit_group`
- `fcntl`
- `getdents64`
- `lseek`
- `mmap`
- `munmap`
- `openat`
- `openat2`
- `read`
- `sigaltstack`
- `statx`
- `write`

The filter uses the already pinned `seccompiler=0.5.0`, `ALLOW` for those entries, and `ERRNO(EPERM)` as the default action. There is no R7I default-Allow fallback.

## Evidence that changed the design

### Small traces were insufficient

The first representative trace set covered LIST, READ_PACKAGE, typed source error, and malformed IPC termination. It observed only 12 post-seccomp syscalls. Treating that set as complete would have been a reliability error: it did not force the allocator to grow after filter installation.

A second real release-helper trace exercised a package containing 96 KiB `SKILL.md` plus eight 256 KiB resources, for 2,195,456 package-content bytes. That path added `brk` and `mmap` and produced the final 14-syscall set. Its dangerous-family intersection remained empty.

This confirmed Chromium's warning that an exhaustive seccomp policy requires tests which actually run the relevant workload under the sandbox, including code outside the immediate application source.

### First R7J-B candidate failure was not a policy failure

The first exact-head R7J-B workflow failed under `cargo clippy --all-targets -D warnings`: the integration test includes `syscall_sandbox.rs` through `#[path]`, and the typed `SyscallSandboxError::code()` method was not used in that compilation unit.

The fix did not suppress lint and did not alter the syscall policy. The adversarial child now reports the existing typed seccomp installation error through `error.code()`. This both removes the duplicate-module dead-code warning and improves failure diagnosis.

## Exact candidate-green evidence

At candidate `9171a558c637454d4a8bb8cc2f5ab99896e6c221`, GitHub Actions run `33211001642` passed:

- Linux x86_64 and Rust 1.98.0 target gate;
- unchanged exact Cargo.lock and dependency closure;
- static 14-syscall positive-allowlist contract;
- `cargo fmt --check`;
- `cargo clippy --locked --all-targets -- -D warnings`;
- all Rust unit/integration/adversarial tests;
- inherited-fd sanitation regression;
- Landlock regression;
- fresh UDP/TCP/Unix socket creation denial;
- unlisted raw `getpid` returning EPERM, proving live default deny;
- process creation/exec denial;
- LIST and READ_PACKAGE success under the installed allowlist;
- maximum-content package read under the installed allowlist;
- R7 package identity and registry JS regressions;
- deterministic evidence build;
- Sigstore build provenance;
- artifact upload.

Candidate helper SHA-256: `fa839bed29b3dbd2709748b49206f5e3cc7adab9ace03ad3bfb153bb1ed382e9`.

Candidate helper size: 429,104 bytes.

Candidate artifact ZIP digest: `sha256:7b51944ea74147591f7dea424a83e435a55a39ac805fce2cf0b7bd0a8cbbc1c5`.

Candidate attested tar digest: `sha256:323e21b91e3e5520250d2fd7f1a9a4554565a5ad2815a6dc7fca375b590640ed`.

Candidate GitHub attestation id: `43758106`; Rekor log index: `2628844462`.

Cargo.lock SHA-256 remains `ffdf4d85f832e92b20960ecdbc581103a113cf9ddfa93fa319ba124f21a3d003`.

## Comparison after implementation

### Firecracker

The result follows the same useful principle as Firecracker's target-specific seccomp filters: permit only the minimum host syscall interface needed by a known process role, and bind the policy to the target/runtime combination. Reusing the existing `seccompiler` keeps A2's policy compiler TCB small.

A2 remains deliberately simpler: the helper has one steady-state role and one 14-syscall policy instead of Firecracker's multiple VMM/API/VCPU thread policies.

Primary source: Firecracker `docs/seccomp.md` and `docs/seccompiler.md`.

### Chromium

Chromium uses seccomp-BPF as one layer in a broader sandbox and explicitly requires exhaustive syscall coverage. R7J-B now follows that positive-policy direction, while retaining R7H Landlock and R7F openat2 path confinement as separate layers.

Chromium's namespace/broker architecture remains stronger for a large renderer process, but importing that complexity into this small read-only skill helper would increase TCB and operational complexity without a proportionate current gain.

Primary source: Chromium `sandbox/linux/README.md` and `docs/linux_sandboxing.md`.

### gVisor

A userspace-kernel boundary such as gVisor can reduce direct host-kernel exposure much further, but it is a much larger isolation layer. For this narrow helper, a dedicated process + bounded IPC + Landlock + openat2 + a 14-syscall seccomp allowlist gives a much better security/complexity ratio at the current roadmap point.

### ERRNO versus KILL

`ERRNO(EPERM)` was the correct action for this compatibility-seal step: it proves denied syscalls have no effect while keeping failures observable. Moving to a kill action would increase fail-stop strength but reduce diagnostics. That can be reconsidered after the launcher/daemon integration paths are exercised under the final policy.

## Security claims after final exact-head seal

R7J-B may claim, for the pinned Linux x86_64 / Rust 1.98.0 helper build:

- default-deny seccomp-BPF is installed before IPC request servicing;
- exactly 14 evidence-backed steady-state syscalls are allowed;
- an unlisted syscall returns EPERM before effect;
- fresh socket creation is denied;
- child process creation/exec is denied;
- the maximum permitted content path remains functional;
- R7H Landlock and R7F openat2 confinement remain enforced;
- the dependency closure is unchanged;
- no Node integration or browser authority is introduced.

## Explicit non-claims / remaining weaknesses

- no cross-architecture policy; non-x86_64 fails closed;
- no network namespace;
- no claim that the 14-syscall set is valid after libc, Rust, allocator, compiler, linker, or dependency changes without remeasurement;
- `openat`/`openat2` remain available because they are required for the read-only source workload; filesystem authority therefore still relies on the independent Landlock/openat2 layers;
- inherited descriptor sanitation still happens at helper startup rather than in a pre-exec parent/launcher boundary;
- no Node/daemon helper lifecycle integration yet;
- no browser actuation or browser authority is delegated to the helper;
- `ERRNO` is retained instead of kill-on-violation during compatibility hardening.

## Next highest-value hardening step

`R7K_PREEXEC_HELPER_LAUNCHER_V1` has the strongest expected security/reliability gain per unit complexity before Node integration.

The current helper closes inherited descriptors at the beginning of its own `main`. A dedicated launcher/pre-exec boundary can make the capability cut earlier: preserve only the explicitly required stdio/IPC descriptors, sanitize everything else before the helper executable begins, then exec the already sandboxed helper contract.

This follows the same direction as Firecracker's jailer separation without importing a VM-sized TCB. It should remain a tiny, auditable launcher and must not gain browser authority, network authority, or general filesystem authority.

Only after that boundary is green should the long-lived Node/Compute Browser daemon be connected to the helper over the bounded R7G protocol.
