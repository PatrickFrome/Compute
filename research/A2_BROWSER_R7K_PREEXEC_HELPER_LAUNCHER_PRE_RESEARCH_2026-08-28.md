# A2 Browser R7K — Pre-Exec Helper Launcher — Pre-Implementation Research

Date: 2026-08-28
Parent verified runtime: R7J `efb3af6bad80b7efcccdeba24be9daef26eddb3d`

## Problem

R7I/R7J sanitize inherited descriptors at the beginning of `a2-skill-source-helper` itself. That is restart-safe and currently verified, but the helper executable still begins life with whatever ambient descriptors its parent supplied and only then destroys them.

Before connecting a long-lived Node/Compute Browser daemon to the helper, the capability cut should move earlier: a tiny launcher should remove ambient descriptors and inherited environment before `exec` transfers control to the helper.

## Primary-source comparison

### Linux `close_range(2)`

Linux explicitly documents `close_range(3, ~0U, CLOSE_RANGE_UNSHARE); execve(...)` as the safe pattern when nothing past stderr should survive into the executed program. `CLOSE_RANGE_UNSHARE` avoids races with a shared file-descriptor table.

### Firecracker jailer

Firecracker's jailer is a separate process specialized for one workload. Early in its operation it closes open file descriptors except stdin/stdout/stderr, cleans the inherited environment, establishes confinement, and finally `exec()`s Firecracker. This makes ambient capability removal a launcher responsibility rather than a first action of the workload.

### Rust `CommandExt::pre_exec`

Rust exposes `pre_exec`, but explicitly marks it unsafe because it runs after `fork` in a constrained child context. Allocations, environment access, and locks are not generally safe there. Embedding security setup into a future multithreaded Node/daemon spawn callback would therefore add an unnecessary post-fork correctness surface.

### Chromium-style larger launcher/broker isolation

Chromium's process sandboxing and brokers are stronger for renderer-scale adversarial workloads, but a namespace/chroot/broker stack would significantly enlarge the R7 helper TCB. The helper is currently read-only, path-confined, Landlock-confined, and restricted to a 14-syscall steady-state seccomp policy, so the next gap is narrower: pre-exec ambient authority.

## Options

### A. Node/Rust `pre_exec` hook

SECURITY: good timing if perfectly implemented.

RELIABILITY: weak relative to alternatives because the hook runs after fork from a potentially multithreaded parent.

TCB/COMPLEXITY: deceptively small but semantically hazardous.

TESTABILITY: difficult to prove absence of allocator/lock use across future edits.

Decision: reject.

### B. Full namespace/chroot jailer now

SECURITY: strongest of the three.

RELIABILITY: good once mature.

TCB/COMPLEXITY/PORTABILITY: much larger; duplicates protections not yet justified for the narrow helper.

Decision: defer until evidence shows Landlock + seccomp + capability launch is insufficient.

### C. Dedicated single-purpose launcher

SECURITY: moves descriptor/environment cut before helper execution.

RELIABILITY: single-threaded normal-process code; no post-fork callback restrictions.

TCB: tiny; reuses the already audited `launch_contract` close-range/readback code and existing libc dependency.

SUPPLY CHAIN: zero new dependencies.

OBSERVABILITY: typed launcher errors and strace ordering proof are straightforward.

TESTABILITY: executable ordering can be proven on the real Linux runner.

Decision: choose.

## Decision

Add `a2-skill-source-launcher` in the existing Rust crate.

The launcher will:

1. accept exactly one argument: the skill root;
2. derive a fixed sibling executable name `a2-skill-source-helper` from its own executable directory rather than accepting an arbitrary program path;
3. fail closed if the sibling is missing, a symlink, or not a regular executable file;
4. prepare the helper command and clear inherited environment;
5. call the existing `close_range(3..UINT_MAX, CLOSE_RANGE_UNSHARE)` contract;
6. independently verify that no descriptor above stderr survived;
7. `exec` the helper with exactly the root argument;
8. expose no browser, network, filesystem-broker, or actuation authority.

The helper keeps its own R7I sanitation/readback. The duplication is intentional defense-in-depth: direct/helper-only launch remains fail-safe, while production launcher use proves the earlier cut.

## Runtime proof required

The R7K gate must run real Linux processes and capture `execve` + `close_range` ordering under `strace`:

- launcher `execve` observed;
- launcher `close_range(..., CLOSE_RANGE_UNSHARE)` observed;
- helper `execve` occurs strictly after that close-range call;
- helper's own second close-range remains visible after helper exec;
- LIST/READ_PACKAGE protocol still succeeds through the launcher;
- inherited environment sentinel is absent from helper exec environment;
- malformed/invalid launcher argument paths fail closed;
- direct helper R7J regressions remain green.

## Rejected shortcuts

- do not remove the helper's own sanitation after adding the launcher;
- do not accept an arbitrary executable path from the daemon;
- do not add libseccomp, pidfd, namespace, or launcher framework dependencies;
- do not connect Node/browser authority in the same semantic slice;
- do not use documentation alone as proof of exec ordering.

## New invariants

- `PREEXEC_AMBIENT_FD_CUT_BEFORE_HELPER_EXEC`.
- `LAUNCHER_EXEC_TARGET_IS_FIXED_SIBLING`.
- `LAUNCHER_INHERITED_ENVIRONMENT_CLEARED`.
- `HELPER_INTERNAL_FD_SANITATION_RETAINED`.
- `LAUNCHER_HAS_NO_BROWSER_AUTHORITY`.
- `LAUNCHER_HAS_NO_NETWORK_AUTHORITY`.
- zero new dependency packages.
