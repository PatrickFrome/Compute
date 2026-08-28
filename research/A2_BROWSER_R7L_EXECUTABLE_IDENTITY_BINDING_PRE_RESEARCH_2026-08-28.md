# A2 Browser R7L — Executable Identity Binding — Pre-Implementation Research

Date: 2026-08-28
Parent verified runtime: R7K `cbdb70e9be5a99251d57a7be7d0c43a95683ebae`

## Problem

R7K validates a fixed sibling `a2-skill-source-helper`, cuts ambient descriptors and inherited environment, then executes that helper by pathname. The final R7K post-research identified the remaining concrete race: the pathname can name a different inode after validation but before `exec` if an actor can mutate the installation directory.

R7L must bind validation and execution to the same already-open kernel object. It must preserve R7K's fixed-sibling contract, R7I's post-exec descriptor cleanup, R7H Landlock, R7J positive seccomp, and bounded R7G IPC. Node/browser authority remains out of scope.

## Primary-source comparison

### Linux `execveat(2)`

Linux `execveat(fd, "", argv, envp, AT_EMPTY_PATH)` executes the object already referenced by `fd`; the descriptor may have been opened with `O_PATH`. This removes the second pathname lookup from the execution decision. The natural idiom is for that descriptor to be `O_CLOEXEC`, so it is consumed by the transition and does not leak into the new image.

The documented caveat is interpreter scripts: `AT_EMPTY_PATH` plus `O_CLOEXEC` can fail with `ENOENT` because the interpreter may need the original descriptor. The A2 release helper is a native ELF binary and R7L intentionally supports that native-helper contract rather than weakening descriptor lifetime for scripts.

### Linux `openat2(2)`

`openat2` provides resolution constraints specifically for trusted programs handling paths: `RESOLVE_BENEATH`, `RESOLVE_NO_SYMLINKS`, `RESOLVE_NO_MAGICLINKS`, and `RESOLVE_NO_XDEV` fail closed on escape, symlink/magic-link traversal, or mount crossing. Opening the one fixed basename relative to an already-open launcher directory gives a smaller resolution surface than revalidating an absolute pathname.

### Firecracker production guidance

Firecracker's production guidance treats jailer exec paths and their parent directories as trusted inputs and requires them not to be writable by unprivileged users. R7L follows the same operational assumption for the launcher's own install directory, but additionally binds the helper after open so a rename/swap after that point cannot redirect execution.

## Options

### A. Metadata/hash check followed by pathname exec

SECURITY: insufficient. Any check can be invalidated by a rename between the check and the second path lookup.

RELIABILITY: familiar but preserves the exact R7K TOCTOU gap.

Decision: reject.

### B. `fexecve` through libc/procfs fallback

SECURITY: descriptor-based when implemented natively, but libc implementations may depend on `/proc/self/fd` on older systems and provide less explicit control over path-resolution evidence.

Decision: reject in favor of direct Linux `execveat` on the already-open descriptor.

### C. `openat2` + `O_PATH|O_CLOEXEC` + `execveat(AT_EMPTY_PATH)`

SECURITY: validation and exec use one kernel object; fixed basename cannot escape the opened directory; symlink/magic-link/mount crossing fails closed; exec fd is close-on-exec.

RELIABILITY: native Linux >=3.19/5.6 primitives already compatible with the R7F/R7J Linux baseline.

TCB: one small identity module and one raw `execveat` seam; no new package.

SUPPLY CHAIN: existing pinned rustix/libc only.

TESTABILITY: deterministic swap-after-open proof can replace the pathname after the descriptor is acquired and verify that the original opened ELF still runs.

Decision: choose.

### D. Copy helper into a private immutable staging directory before exec

SECURITY: can work but introduces copy/update lifecycle, storage identity, cleanup, and atomic-publish complexity.

Decision: defer; fd-bound execution closes the current gap with much less state.

## Decision

Implement R7L as:

1. resolve only the launcher's own executable directory;
2. open that directory `O_PATH|O_DIRECTORY|O_CLOEXEC`;
3. open exactly `a2-skill-source-helper` relative to it with `openat2` using `O_PATH|O_CLOEXEC` and `BENEATH|NO_SYMLINKS|NO_MAGICLINKS|NO_XDEV`;
4. `fstat` the opened fd and require a regular executable with no setuid/setgid bits;
5. set `no_new_privs` before exec using the already pinned rustix API, preventing exec-time privilege gain including file capabilities;
6. close every unrelated fd while preserving only stdio and the executable fd, then independently verify that postcondition;
7. invoke `execveat(exec_fd, "", argv, empty_env, AT_EMPTY_PATH)` on that same fd;
8. retain helper-side R7I sanitation so the exec fd and any impossible residual ambient fd are removed/verified after transition;
9. accept no caller-supplied executable path, fd, digest, or identity.

The executable descriptor is `O_CLOEXEC`: it exists long enough for `execveat` to resolve the native ELF, then is closed by successful exec semantics.

## Adversarial proof design

A feature-gated test hook exists only in test builds. It pauses after the helper descriptor has been opened and verified but before ambient-fd cleanup/exec. The parent test:

1. installs a copied native `/bin/true` as the fixed helper;
2. starts the launcher and waits until the descriptor-open hook signals ready;
3. atomically renames a copied `/bin/false` over the helper pathname;
4. releases the launcher;
5. requires exit status 0.

If R7L accidentally re-resolves the pathname, the process executes `/bin/false` and fails. If it executes the already-open descriptor, `/bin/true` succeeds. The test also verifies that the pathname now points to the replacement, proving the swap actually occurred.

The real release helper must then pass LIST + READ_PACKAGE through the fd-bound launcher, and `strace` must show `openat2` before `close_range`, `execveat(...AT_EMPTY_PATH)` rather than pathname helper `execve`, and the inherited R7I helper close-range after exec.

## New invariants

- `HELPER_OPEN_ONCE_EXEC_SAME_FD`.
- `HELPER_FIXED_BASENAME_OPENAT2_CONFINED`.
- `HELPER_SYMLINK_MAGICLINK_XDEV_ESCAPE_REJECTED`.
- `HELPER_EXEC_FD_CLOEXEC`.
- `UNRELATED_FDS_CUT_WHILE_EXEC_FD_PRESERVED`.
- `NO_NEW_PRIVS_BEFORE_HELPER_EXEC`.
- `HELPER_SETUID_SETGID_BITS_REJECTED`.
- `SWAP_AFTER_OPEN_CANNOT_REDIRECT_EXECUTION`.
- `HELPER_INTERNAL_FD_SANITATION_RETAINED`.
- no new dependency package.
- no Node/browser/actuation authority.

## Explicit non-claims

- R7L does not make the install directory immutable; production must still protect its ownership/permissions.
- R7L does not bind a release digest/signature into runtime policy; the kernel fd object is the execution identity for this slice.
- scripts/interpreter helpers are not supported by the fd+CLOEXEC execution contract.
- no cross-architecture proof is made.
