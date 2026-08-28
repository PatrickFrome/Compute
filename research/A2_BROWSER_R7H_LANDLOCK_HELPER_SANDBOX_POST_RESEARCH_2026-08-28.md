# A2 Browser R7H — Landlock Helper Sandbox — Post-Implementation Research

Date: 2026-08-28
Candidate head tested: `a17670486530f727c33ca4732a8c62cc58adef92`
Parent verified R7G: `2760e2c3cd1ccb8c3869767be9f39a1e33e887a4`

## Candidate evidence

The first semantic R7H candidate completed successfully on GitHub-hosted Ubuntu 24.04 after a formatting-only retry. The exact test run proved:

- Rust `1.98.0` and Cargo `1.98.0`;
- exact direct dependencies `landlock=0.4.7` and `rustix=1.1.4`;
- `cargo fmt --check` and Clippy `-D warnings`;
- 7/7 bounded helper-protocol tests;
- 3/3 R7F1 directory-cardinality tests;
- 4/4 helper process tests;
- 10/10 R7F filesystem/source tests;
- 1/1 Landlock sandbox integration test;
- 16/16 R7C/R7E JavaScript package/registry regressions;
- release helper size: `392560` bytes;
- release helper SHA-256: `f28462a6b1b1d70f54d2909fded2146f7544efecc8e905dd491baf0433ea8e24`.

The sandbox integration test demonstrated on the actual runner that, after `restrict_helper_process()`:

- R7F `LIST`/package reads beneath the already-opened skill root still work;
- a new `/etc/passwd` read is denied;
- a new write beneath the skill root is denied;
- a TCP connect to a listener created before sandboxing is denied;
- a new TCP bind is denied.

Candidate provenance was also green, but this candidate is not the final seal because its dependency lockfile was generated inside CI rather than committed to source. The final R7H evidence must be rerun against the exact source-controlled lockfile extracted from this successful resolver run.

## Exact dependency closure

The candidate resolver produced 17 packages. The security-relevant direct surface remains only:

```text
landlock 0.4.7
rustix   1.1.4
```

`landlock` adds its expected safe-wrapper/proc-macro closure (`enumflags2`, `thiserror`, `proc-macro2`, `quote`, `syn`, `unicode-ident`, `libc`). The existing supply-chain denylist remained clean. The generated lockfile is promoted unchanged into source before the final evidence rerun so later CI uses `--locked` and cannot silently re-resolve.

## Precision of the R7H claim

The successful test validates a deliberately frozen **Landlock ABI 4 baseline**, not every current or future Landlock access right.

R7H handles:

```text
AccessFs::from_all(ABI::V4)
AccessNet::from_all(ABI::V4)
```

and grants only:

```text
PathBeneath(exact_already_open_root_fd, AccessFs::from_read(ABI::V4))
```

Therefore the evidence claim should be worded as:

```text
Landlock ABI4 filesystem baseline:
  read-only beneath the exact R7F skill-root capability

Landlock ABI4 network baseline:
  TCP bind denied
  TCP connect denied

UDP isolation:
  NOT CLAIMED
```

This avoids an invalid inference that `AccessFs::from_all(ABI::V4)` automatically handles access rights introduced by future ABIs.

## Comparison with stronger sandbox systems

### Chromium Linux sandbox

Chromium uses multiple orthogonal Linux mechanisms rather than treating one LSM as a complete sandbox: namespaces isolate resource views and Seccomp-BPF narrows the syscall surface. This is the correct comparison point for A2 after R7H.

R7H is narrower but intentionally easier to prove:
- the helper has a tiny two-operation R7G IPC protocol;
- skill filesystem access is already capability-confined by R7F/openat2;
- Landlock now removes ambient ABI4 filesystem rights and TCP bind/connect.

The residual syscall and namespace surface is still wider than Chromium's mature sandbox.

### Bubblewrap

Bubblewrap's strongest relevant advantage is namespace isolation, especially a fresh network namespace (`CLONE_NEWNET`) that removes access to the host networking stack instead of filtering only selected socket operations. This matters because current `landlock 0.4.7` cannot express Landlock ABI10 UDP rights.

### WASI/capability-style systems

WASI preopened directories and capability-oriented filesystem libraries continue to validate the architectural direction: grant an already-open capability, then operate relative to it. R7F + R7H follows the same least-authority lifecycle while retaining native Linux enforcement.

## Remaining security gaps

R7H intentionally does not prove:
- UDP isolation;
- a separate network namespace;
- Seccomp-BPF syscall filtering;
- user/PID/mount namespace isolation;
- inherited descriptor allowlisting beyond the ordinary process-launch contract;
- Node daemon integration.

The most important remaining gap before Node integration is network/syscall isolation. A malformed or exploited helper should not retain host UDP or a broad syscall surface merely because its application-level IPC is read-only.

## Best next step

Recommended next milestone: **R7I helper launcher isolation** before Node integration.

Target sequence:

```text
build/verify exact helper binary
        ↓
launcher creates isolated network namespace
        ↓
close / allowlist inherited descriptors
        ↓
optional user/mount namespace hardening
        ↓
install narrow seccomp policy
        ↓
exec helper
        ↓
helper opens configured root
        ↓
R7H Landlock ABI4 restriction
        ↓
R7G bounded IPC
```

The exact ordering may need a small bootstrap adjustment because the helper currently opens the root itself from an argument. The design should preserve one trustworthy root acquisition and avoid reintroducing a broad pathname broker.

Only after this helper-process sandbox is independently green should a Node adapter be allowed to spawn and consume the helper protocol. The Node adapter must remain a transport adapter to the R7E registry, not a new filesystem authority owner.
