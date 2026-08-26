# W1 rootless sandbox v2 — post-review hardening

Date: 2026-08-26  
Canonical Level-1 milestone: `C1`  
Level-2 milestone: `W1_PERSISTENT_LINUX_WORKER_SAFETY`  
Mode: `PREPARE_ONLY`; `canonical=false`; `authority_effect=false`

## Revalidated execution boundary

Live GitHub `main` is `acc7d60e09bc110f9cf1301532497d680e4510d1`.
The Level-2 definition and canonical alignment both report intact, with W1 as
`next_mainline`. The latest W1 claim and directive remain stored as `ACTIVE`
but their `expires_at` values are in the past. This change therefore publishes
reviewable source only. It performs no provider lifecycle action, cgroup
mutation, database migration, admission or W1 completion transition.

## Research-before gap matrix

| Gap found in prior v2 | Primary-source fact | Adopted change | Falsification boundary |
| --- | --- | --- | --- |
| Top-only read-only remount | Nested mounts are not reliably changed by a legacy remount of only the bind root. Linux 5.12+ `mount_setattr` supports `AT_RECURSIVE`. | Require recursive read-only/nosuid/nodev mount attributes for runtime trees and recursive nosuid/nodev for workspace. | Exact syscall/flag unit contract; failure is terminal. |
| Inherited descriptors | `close_range(3, ~0U, CLOSE_RANGE_UNSHARE)` is the Linux pre-`execve` primitive for separating and closing the descriptor table. | Atomically close everything above stderr; no `/proc/self/fd` loop or error-ignoring fallback. | Exact range/flag test and source-order check before `execve`. |
| Credential-bearing environment | Namespaces do not remove environment variables. | Resolve the executable only through a fixed `PATH`, bound command size, use a fixed credential-free environment, private umask and `execve`. | Token/proxy stripping tests and `execvp` prohibition. |
| Launcher death | `PR_SET_PDEATHSIG` must be paired with a parent-PID race check. | Fence namespace PID1 with `SIGKILL` and verify the parent did not die during setup. | Two-parent-observation and exact prctl contract. |
| Outer fork signal race | PID1 has special signal semantics and handlers must exist before lifecycle signals are released. | Block TERM/INT/HUP/QUIT across fork and unblock only after outer/PID1 handlers exist. | Ordered source contract plus existing process-group readiness queue. |
| Reused sandbox path | Reusing an existing path permits stale content/symlink ambiguity. | Require exclusive fresh `mkdir`, reject an existing root and remove only that exact empty root with `rmdir`. | Static exclusive-create/exact-cleanup assertions. |
| Old-root ambiguity | `pivot_root` does not itself change cwd or detach `put_old`. | Keep `chdir`, detach/remove old root, then assert old-root absence and `/proc/1/root == /`. | Ordered composition and post-pivot assertions. |

Primary sources:

- Linux `pid_namespaces(7)`: <https://man7.org/linux/man-pages/man7/pid_namespaces.7.html>
- Linux `pivot_root(2)`: <https://man7.org/linux/man-pages/man2/pivot_root.2.html>
- Linux `mount_setattr(2)`: <https://man7.org/linux/man-pages/man2/mount_setattr.2.html>
- Linux `close_range(2)`: <https://man7.org/linux/man-pages/man2/close_range.2.html>
- Linux `PR_SET_PDEATHSIG(2const)`: <https://man7.org/linux/man-pages/man2/PR_SET_PDEATHSIG.2const.html>

## Free amplifier disposition

- Adopt now: kernel-native `mount_setattr`, `close_range`, namespaces, seccomp,
  capability bounding-set drops and GitHub-hosted SHA-bound CI. They add no
  paid service or runtime dependency.
- Defer Landlock until a real W1 host proves a declared minimum ABI and exact
  negative path policy. Kernel documentation recommends ABI-dependent
  best-effort selection, which cannot silently replace this fail-closed gate.
- Defer `open_tree`/`move_mount` migration until the live v2 witness. It can
  reduce path-based mount assembly, but changing the whole mount builder in the
  same review slice would weaken causal attribution.
- Reject a persistent self-hosted runner on a public repository as an
  execution shortcut. GitHub documents the fork-PR compromise risk; W1 must
  use a narrow dispatcher/private trust boundary instead.

Additional sources:

- Linux Landlock documentation: <https://docs.kernel.org/userspace-api/landlock.html>
- Linux `open_tree(2)`: <https://man7.org/linux/man-pages/man2/open_tree.2.html>
- GitHub Actions secure use: <https://docs.github.com/actions/reference/security/secure-use>

## Verification-after

Local verification completed against launcher SHA-256
`da03e661f9ddfaeb2ffa53b625c19ad06a48f51802e4b27201becfaf40c8d0b5`:

| Gate | Result |
| --- | --- |
| v1 + v2 focused launcher contracts | 28 passed |
| complete W1 suite, including lifecycle/pre-persistence/Sigstore downstream contracts | 297 passed, 1 kernel-dependent test skipped |
| full repository unit/contract suite | 472 passed, 2 kernel-dependent tests skipped |
| SAME_POINT_DUEL_V4 and sovereign standalone guards | passed |
| Python compile, AST parse, workflow YAML parse and `git diff --check` | passed |
| root-caller adversarial runtime check | failed closed as designed, exit 78 |

Independent GitHub CI still has to recompute the source hash and execute the
unprivileged Ubuntu runtime canary against the committed head. No 30-minute
canary is part of this step.

Regardless of test outcome, this artifact cannot prove a persistent host,
provider stop/resume or reboot, outer-cgroup enforcement, Supabase persistence,
independent review, worker admission or W1 completion.
