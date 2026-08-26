# W1 S2 Rootless Sandbox Launcher v2 — PREP / Non-Authority

This document binds the reviewable S2 launcher composition required before any provider mutation for W1.

## Exact hardened source

- Path: `worker/native_linux/rootless_sandbox_launcher_v2.py`
- Current direct-entry hardened source commit: `bb2aaaf89595ddc80257aae340f173191d209642`
- Expected exact SHA-256: `f262cd5468b5eb51754cf397cdb1879c2e90d0670b74f479d3b28af8cd20f521`
- Status: PREP / non-authority. This source does **not** admit a worker or prove W1.

The initial reviewable v2 (`231afd6a...`) was deliberately rejected for provider execution after exact-source review found that arbitrary writable/sensitive host binds, `workspace=/`, broad `/etc`/`/opt` binds, and a pre-`setsid` signal-forwarding race could weaken isolation. The first hardened source closed those findings. Runtime-canary execution then found a separate direct-file packaging defect: `python3 worker/native_linux/rootless_sandbox_launcher_v2.py` could not resolve the package import from script mode. Commit `bb2aaaf...` adds a narrow repository-root bootstrap only when the missing module is exactly `worker`; the source remains fail-closed for all other import failures.

## Composition contract

1. Require Linux and a non-root caller.
2. Create a user namespace and map only the caller UID/GID.
3. `CLONE_NEWPID`; immediately fork so the first child is namespace PID 1.
4. Namespace PID1 is a dedicated init/reaper, never the worker process.
5. PID1 creates a private mount namespace (`MS_REC|MS_PRIVATE`) and a separate network namespace (`CLONE_NEWNET`). The launcher owns the `no_host_network_sharing` invariant for this composition.
6. PID1 mounts a fresh tmpfs root. Default host visibility is restricted to read-only runtime paths (`/usr` and compatible library aliases), a minimal set of `/etc` runtime/certificate files, four explicit device nodes, and exactly one read/write workspace.
7. Additional host binds are read-only only; `/`, `/proc`, `/sys`, `/dev`, `/run`, and `/var/run` sources are rejected. The workspace may not be `/` or sensitive runtime/config roots, and workspace/sandbox-root overlap is rejected.
8. `pivot_root` into the tmpfs, `chdir('/')`, detach old root with `MNT_DETACH`, then mount a new `/proc`. `/proc/1` must refer to the dedicated namespace init/reaper.
9. PID1 forks worker PID2+. A readiness pipe closes the signal race: the worker performs `setsid()` and explicitly marks its process group ready before queued TERM/INT/HUP signals may be forwarded.
10. The worker applies `PR_SET_NO_NEW_PRIVS`, the existing substantive seccomp deny policy, and capability bounding-set drops before `execvp`.
11. PID1 forwards signals to the worker process group, reaps adopted orphans, and propagates the main worker exit status. PID1 exit is the final namespace cleanup boundary.
12. Both package import and direct-file CLI invocation are contract-tested; direct-file invocation may bootstrap only the repository root and may not weaken sandbox policy.

## Forbidden shortcuts

No executable `sudo` path in the launcher; no privileged mode; no host PID/network sharing; no `seccomp=unconfined`; no capability-add fallback; no writable arbitrary host binds; no synthetic provider or W1 identity; no provider lifecycle mutation from this PREP artifact.

## Required rail review before execution

- Exact source/test/docs are fetched from one immutable Git commit.
- Recompute SHA-256 and match `f262cd5468b5eb51754cf397cdb1879c2e90d0670b74f479d3b28af8cd20f521`.
- SHA-bound composition tests and the direct-entry CLI regression must pass.
- Review must verify PID1 reaping/signal semantics, pivot-root mount tree, old-root non-exposure, bind/layout fences, network-plane ownership, and package/direct-file entry equivalence.
- A fresh aligned W1 claim/directive is still required after source approval and before any Codespace/provider mutation.

## Live canaries after authority is refreshed

The later provider execution must additionally prove: namespace PID1 identity, orphan reaping, signal forwarding, host sentinel invisibility, old-root absence from `/proc/self/mountinfo`, distinct network namespace, fresh `/proc`, exact prebound cgroup witness sequencing, lifecycle PRE/POST boot-id change, H1-H13, negative canaries, and persisted Supabase readback.
