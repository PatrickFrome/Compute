# W1 S2 Rootless Sandbox Launcher v2 — PREP / Non-Authority

This document binds the reviewable S2 launcher composition required before any provider mutation for W1.

## Exact source

- Path: `worker/native_linux/rootless_sandbox_launcher_v2.py`
- Rail commit at initial publication: `e6a462df5ad1febfc125d9dc74dca78375401b30`
- Exact SHA-256: `231afd6a58b1be50549ee4cdfa99c914bff474ae3950c7af2396d3b2519413b9`
- SHA evidence: GitHub Actions run `32929521210`, exact checkout `b80ecb8f3efbe1407a32a8d8cde695039fdd7004`.
- Status: PREP / non-authority. This source does **not** admit a worker or prove W1.

## Composition contract

1. Require Linux and a non-root caller.
2. Create a user namespace and map only the caller UID/GID.
3. `CLONE_NEWPID`; immediately fork so the first child is namespace PID 1.
4. Namespace PID1 is a dedicated init/reaper, never the worker process.
5. PID1 creates a private mount namespace (`MS_REC|MS_PRIVATE`) and a separate network namespace (`CLONE_NEWNET`). The launcher therefore owns the `no_host_network_sharing` invariant for this composition.
6. PID1 mounts a fresh tmpfs root, read-only runtime binds, explicit device binds, and the selected workspace as the sole default read/write bind.
7. `pivot_root` into the tmpfs, `chdir('/')`, detach old root with `MNT_DETACH`, then mount a new `/proc`. `/proc/1` must therefore refer to the dedicated namespace init/reaper.
8. PID1 forks worker PID2+, which applies `PR_SET_NO_NEW_PRIVS`, the existing substantive seccomp deny policy, and capability bounding-set drops before `execvp`.
9. PID1 forwards TERM/INT/HUP to the worker process group, reaps adopted orphans, and propagates the main worker exit status. PID1 exit is the final namespace cleanup boundary.

## Forbidden shortcuts

No executable `sudo` path in the launcher; no privileged mode; no host PID/network sharing; no `seccomp=unconfined`; no capability-add fallback; no synthetic provider or W1 identity; no provider start/restart from this PREP artifact.

## Required rail review before execution

- Exact source/test/docs are fetched from one immutable Git commit.
- Recompute SHA-256 and match `231afd6a58b1be50549ee4cdfa99c914bff474ae3950c7af2396d3b2519413b9`.
- Contract tests must pass.
- Review must verify PID1 reaping/signal semantics, pivot-root mount tree, old-root non-exposure, and network-plane ownership.
- A fresh aligned W1 claim/directive is still required after source approval and before any Codespace/provider mutation.

## Live canaries after authority is refreshed

The later provider execution must additionally prove: namespace PID1 identity, orphan reaping, signal forwarding, host sentinel invisibility, old-root absence from `/proc/self/mountinfo`, distinct network namespace, fresh `/proc`, exact prebound cgroup witness sequencing, lifecycle PRE/POST boot-id change, H1-H13, negative canaries, and persisted Supabase readback.
