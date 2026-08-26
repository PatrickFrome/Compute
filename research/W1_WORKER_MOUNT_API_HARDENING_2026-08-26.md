# W1 worker mount API and exact-identity hardening

Date: 2026-08-26
Scope: `W1_PERSISTENT_LINUX_WORKER_SAFETY`, PREP/non-authority only

## Live-rail reconciliation

The research started from the pidfd head but was rebased onto the newer exact
rail head `5d6dcb7382b0a419c1498bc7c512fa218576c874`. That head had already adopted
the highest-value GLM findings: cross-process memory inspection denial,
`io_uring` denial, most of the modern mount API, PID1 `PR_SET_DUMPABLE=0`,
`RLIMIT_CORE=0`, environment scrubbing, and short regression canaries. Those
changes are reused, not reimplemented.

Three exact gaps remained:

1. `fsconfig` was missing although `fsopen`, `fsmount`, and `fspick` were
   denied. The modern mount API is a composition; leaving its configuration
   operation outside the adopted regression set is unnecessary attack surface.
2. the recursive `NODEV` exception still followed `stat.S_ISCHR(source)` for
   any bind instead of the four exact launcher device bindings;
3. four downstream consumers still pinned launcher SHA `8c5570fa...` after
   the exact source advanced to `e4204c21...`, so the lifecycle and draft
   pre-persistence identity chain had drifted from the rail.

## Decision

- Add `fsconfig` to the effective worker policy and to the live EPERM
  regression canary.
- Waive recursive `NODEV` only when source and target are the same one of
  `/dev/null`, `/dev/zero`, `/dev/random`, or `/dev/urandom`, and the bind is
  the launcher-owned read/write device bind.
- Add an in-sandbox runtime assertion that worker PID2 cannot read
  `/proc/1/environ`, directly exercising the PID1 dumpability boundary.
- Add behavioral failure-arm tests for dumpability and core-limit readback.
- Rebind every current source-identity consumer to one final launcher hash.
- State Linux 5.12 as the effective fail-closed floor: mandatory
  `mount_setattr` appeared in 5.12, `close_range` in 5.9, and pidfds earlier.
- Keep a name-only `clone3` deny rejected. It could block normal
  thread/process creation; a future rule must filter only dangerous flags.

## Primary evidence

- `fsopen(2)`: <https://man7.org/linux/man-pages/man2/fsopen.2.html>
- `fsconfig(2)`: <https://man7.org/linux/man-pages/man2/fsconfig.2.html>
- `fsmount(2)`: <https://man7.org/linux/man-pages/man2/fsmount.2.html>
- `fspick(2)`: <https://man7.org/linux/man-pages/man2/fspick.2.html>
- `open_tree(2)`: <https://man7.org/linux/man-pages/man2/open_tree.2.html>
- `move_mount(2)`: <https://man7.org/linux/man-pages/man2/move_mount.2.html>
- `mount_setattr(2)`: <https://man7.org/linux/man-pages/man2/mount_setattr.2.html>
- `pivot_root(2)`: <https://man7.org/linux/man-pages/man2/pivot_root.2.html>
- `seccomp(2)`: <https://man7.org/linux/man-pages/man2/seccomp.2.html>
- syscall version table: <https://man7.org/linux/man-pages/man2/syscalls.2.html>

## Nonclaims

`canonical=false`; `authority_effect=false`; `worker_admitted=false`;
`w1_verified=false`; `provider_mutation_performed=false`;
`database_ddl_applied=false`; `thirty_minute_canary=false`.
