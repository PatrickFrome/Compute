# A2 Browser R7L — Executable Identity Binding — Pre-Implementation Research

Date: 2026-08-28
Parent verified runtime: R7K `cbdb70e9be5a99251d57a7be7d0c43a95683ebae`

## Problem

R7K moved ambient descriptor and environment cleanup ahead of helper execution, but still performs two pathname operations on the helper: metadata validation and later `exec` by sibling pathname. A local actor able to mutate the installation directory between those operations could replace the checked pathname with a different executable.

The next semantic slice must bind validation and execution to one already-open kernel object without weakening R7K's rule that ambient descriptors are fully removed before any new executable capability is acquired.

## Primary-source comparison

### Linux `fexecve(3)` / `execveat(2)`

`fexecve` executes the file referenced by a file descriptor instead of by pathname. Its documented purpose includes verifying an executable and then executing that same object, because pathname validation followed by `execve(path)` can be redirected by exchanging the filename or a directory prefix.

On modern Linux/glibc, `fexecve` uses `execveat(..., AT_EMPTY_PATH)` when available. An executable descriptor may be opened with `O_PATH`. The natural idiom is close-on-exec on the executable descriptor so the capability does not survive into the new process image. The script/CLOEXEC caveat is not relevant to the production helper because it is a native Rust ELF binary and R7L will test the real built artifact.

### rustix 1.1.4

The already pinned rustix exposes stable `open`, `openat2`, `OFlags::PATH`, `OFlags::CLOEXEC`, `ResolveFlags`, and `fstat`. This is sufficient to bind a fixed sibling path through a directory capability with `RESOLVE_BENEATH | NO_SYMLINKS | NO_MAGICLINKS | NO_XDEV`, then inspect the opened object.

rustix does not expose its internal experimental execveat layer as a stable public API, so making R7L depend on it would increase maintenance risk for no security benefit.

### Firecracker jailer

Firecracker treats its exec path and parent directories as trusted operator inputs and requires ownership/permissions that prevent unprivileged modification. R7L complements, rather than replaces, that operational requirement: FD-bound execution removes the check/exec pathname race after the object has been opened, while the path used to acquire the initial directory capability remains part of the trusted installation boundary.

## Options

### A. Keep metadata(path) + exec(path)

SECURITY: insufficient; concrete check/exec pathname TOCTOU remains.

RELIABILITY: simple but security claim is weaker than the available kernel primitive.

Decision: reject.

### B. Raw `SYS_execveat`

SECURITY: strong and direct.

TCB: requires another raw syscall/pointer seam and architecture/kernel-specific handling even though libc already provides the standardized FD-exec interface.

Decision: reject for now.

### C. rustix internal/experimental execveat

SECURITY: strong.

MAINTAINABILITY: weak because the API is not stable/public in the pinned release.

Decision: reject.

### D. Confined `openat2` + pinned-libc `fexecve`

SECURITY: binds execution to the exact opened object and removes the second pathname lookup.

RELIABILITY: standard POSIX interface backed by execveat on current glibc/Linux.

TCB: one new small module and one new audited FFI call; no new package.

SUPPLY CHAIN: unchanged Cargo.lock.

TESTABILITY: deterministic rename/swap test can prove that replacing the sibling pathname after open does not redirect execution.

Decision: choose.

## Decision

R7L will introduce an explicit executable capability acquired only after the R7K ambient descriptor cut:

1. Parse the root argument and derive the launcher installation directory before capability cleanup.
2. Run the existing R7K `close_range(3..UINT_MAX, CLOSE_RANGE_UNSHARE)` and independent readback, leaving only stdio.
3. Open the installation directory as a fresh `O_PATH|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW` capability.
4. Open only fixed sibling `a2-skill-source-helper` with `openat2`, `O_PATH|O_CLOEXEC|O_NOFOLLOW`, and `BENEATH|NO_SYMLINKS|NO_MAGICLINKS|NO_XDEV`.
5. `fstat` the opened helper; require a regular executable file and reject setuid/setgid metadata.
6. Drop the installation-directory FD.
7. Independently prove the pre-exec descriptor set is exactly stdin/stdout/stderr plus the helper executable FD.
8. Execute the already-open helper with `fexecve`, exact argv `[a2-skill-source-helper, <root>]`, and empty envp.
9. Keep the executable FD close-on-exec and retain the helper's own R7I descriptor sanitation after exec.

## Runtime proof required

The exact-head gate must prove on the real Linux runner:

- actual launcher/helper protocol still works;
- after the R7K ambient cut, the helper is opened through `openat2` before FD-bound exec;
- the real process transition appears as FD-bound `fexecve`/`execveat(..., AT_EMPTY_PATH)`, not a second helper pathname lookup;
- the helper executable FD does not survive into helper steady state;
- the helper retains its own close-range sanitation and R7J seccomp behavior;
- deterministic pathname replacement after executable open cannot redirect execution;
- symlink/non-regular/non-executable/setuid/setgid helper candidates fail closed;
- environment remains empty;
- dependency closure is unchanged.

## Explicit non-claims

- R7L does not make the installation-directory pathname intrinsically trustworthy before it is opened; operator-controlled ownership/permissions remain part of deployment trust.
- R7L does not prevent an actor with write access to the already-open executable inode from mutating file contents; deployment must protect installed binaries from modification.
- no namespace/chroot/cgroup layer is added.
- no Node/daemon integration, browser authority, network authority, or actuation authority is introduced.
- Linux x86_64 remains the only verified target.

## New invariants

- `EXECUTED_HELPER_IS_OPENED_OBJECT_NOT_RELOOKED_PATH`.
- `AMBIENT_FDS_CLOSED_BEFORE_EXECUTABLE_CAPABILITY_ACQUISITION`.
- `FIXED_HELPER_LOOKUP_IS_OPENAT2_CONFINED`.
- `EXACTLY_ONE_NON_STDIO_EXEC_FD_BEFORE_FEXECVE`.
- `EXEC_FD_IS_CLOEXEC_AND_DOES_NOT_LEAK_TO_HELPER`.
- `NO_ARBITRARY_EXEC_PATH`.
- `EMPTY_INHERITED_ENVIRONMENT`.
- `R7K_AND_R7J_HELPER_DEFENSES_RETAINED`.
- zero new dependency packages.
