# W1 pidfd outer supervision — research and implementation decision

Date: 2026-08-26  
Audience: W1 reviewers and mainline supervisor  
Scope: `W1_PERSISTENT_LINUX_WORKER_SAFETY`, PREP/non-authority only

## Direct answer

Use `fork()` followed immediately by `pidfd_open()` for the exact namespace
PID1 and deliver outer lifecycle signals with `pidfd_send_signal()`. The
launcher can satisfy the documented race-free conditions by requiring a
single main thread, requiring and reinstalling the default `SIGCHLD`
disposition before namespace mutation, blocking lifecycle signals across the
fork, and preventing any other reaper from running. This removes the numeric
PID-reuse target race without a paid dependency or provider mutation.

`clone3(CLONE_PIDFD)` remains a later shadow candidate. It creates the pidfd
atomically, but does not currently improve the guarantee once the dedicated
launcher enforces the `fork()+pidfd_open()` preconditions. Adding a raw
`clone3` ABI in the same slice would increase compatibility and review surface.

## Evidence reconciliation

| Claim | Primary evidence | Decision | Confidence |
| --- | --- | --- | --- |
| Numeric PID signaling can target a recycled PID | `pidfd_send_signal(2)` states that pidfds are stable process references and return `ESRCH` after the target terminates | Replace outer `kill(pid1, sig)` with `pidfd_send_signal(pidfd, sig)` | High |
| `fork()+pidfd_open()` can be race-free | `pidfd_open(2)` states an unreaped child PID is not recycled when `SIGCHLD` is not ignored, `SA_NOCLDWAIT` is absent, and no other reaper runs | Enforce those conditions before `unshare`; open pidfd before unblocking signals | High |
| pidfds are close-on-exec | `pidfd_open(2)` specifies the returned descriptor has close-on-exec set | Do not add an inheritable fallback; close in the outer parent after wait | High |
| Python exposes the required zero-cost API | Python documents `os.pidfd_open` and `signal.pidfd_send_signal` on supported Linux versions | Require the APIs; fail closed if missing | High |
| `clone3(CLONE_PIDFD)` is strictly necessary now | Linux documents atomic pidfd creation, but the current launcher is single-purpose and can preserve the unreaped child | Keep shadow; do not expand this causal slice | Medium-high |

## Implementation boundary

- Check pidfd APIs, main-thread/single-thread state and default `SIGCHLD`
  before any namespace mutation.
- Reinstall `SIG_DFL` for `SIGCHLD` to clear hidden `SA_NOCLDWAIT` state from
  a non-Python parent.
- Keep TERM/INT/HUP/QUIT blocked until pidfd acquisition and handler install.
- On `pidfd_open` failure, kill and reap the exact still-unreaped child before
  restoring the signal mask; do not continue with numeric-PID supervision.
- If outer wait fails unexpectedly after pidfd acquisition, use the pidfd to
  kill PID1, reap it, close the pidfd and remove only the exact sandbox root.
- Preserve existing worker process-group logic. A `WNOWAIT`-based redesign of
  PID1 group shutdown is a separate step and is not claimed here.

## Verification plan

1. Mocked tests prove ordering, non-default `SIGCHLD` rejection, pidfd signal
   use and terminal `pidfd_open` failure.
2. A real-kernel unit test opens a pidfd for an exact child, signals through
   the pidfd and verifies the signal-derived exit status.
3. SHA-bound W1 and full-repository suites rerun after every dependent source
   hash is updated.
4. GitHub-hosted Ubuntu runtime canary exercises the committed launcher. It is
   a short non-authority canary, not the prohibited 30-minute canary.

## Primary sources

- Linux `pidfd_open(2)`: <https://man7.org/linux/man-pages/man2/pidfd_open.2.html>
- Linux `pidfd_send_signal(2)`: <https://man7.org/linux/man-pages/man2/pidfd_send_signal.2.html>
- Linux `clone(2)` / `CLONE_PIDFD`: <https://man7.org/linux/man-pages/man2/clone.2.html>
- Python `os.pidfd_open`: <https://docs.python.org/3/library/os.html#os.pidfd_open>
- Python `signal.pidfd_send_signal`: <https://docs.python.org/3/library/signal.html#signal.pidfd_send_signal>

## Nonclaims

`canonical=false`; `authority_effect=false`; `worker_admitted=false`;
`w1_verified=false`; `provider_mutation_performed=false`;
`thirty_minute_canary=false`.
