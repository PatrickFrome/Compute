# W1 two-plane runtime PREP — 2026-08-25

Status: **NON-AUTHORITY / PREP ONLY**

This document records evidence and design constraints for MB1 V2 node
`N1_W1_PROVIDER_NEUTRAL_DURABLE_LINUX_WORKER`. It does not change the
`linux-h1-h13-v1` policy, does not admit a worker, and does not resolve the
current `MILESTONE_ACCEPTANCE_CONFLICT` hard gate.

## Current hard facts

1. Existing GitHub Codespace `psychic-goggles-p79456q477c6wvq` is a real Linux
   provider object with stable object identity and a persistent `/workspaces`
   volume across provider stop/start. The earlier lifecycle receipt is retained
   as diagnostic because the action happened before the then-active authority
   gate was resumed.
2. The bare Codespace dev container fails the local W1 safety contract on
   `NoNewPrivs`, seccomp filter mode, and the one-plane mount namespace check.
3. A genuinely PID+mount isolated nested container can have a mount namespace
   that differs from the outer Codespace while `/proc/self/ns/mnt` equals
   `/proc/1/ns/mnt` *inside the inner PID namespace*. Therefore the legacy
   one-plane `/proc/self` vs `/proc/1` check is not sufficient to measure
   isolation from an authenticated outer provider plane.
4. The authorized H1-H13 prerequisite probe on the Codespace main plane found:
   - PASS: Linux, non-root uid, pidfd+waitid, finite rlimits, descriptor-bound
     openat2 escape protection, cgroup v2 mounted, cpu/memory/pids controllers,
     libseccomp present.
   - FAIL: unprivileged user+mount+network namespace bootstrap (`EPERM`),
     writable/delegated cgroup subtree (`parent_writable=false`), and therefore
     an isolated-network default-deny canary.
5. Production policy `linux-h1-h13-v1` requires both `rootless=true` and
   `effective_uid_nonzero=true`, but the stored policy does not define whether
   `rootless` refers to the worker execution identity only or to the outer
   container daemon/runtime as well. This is a pair-level semantic question.
6. Production `VERCEL_SANDBOX` backend binding currently requires
   `persistence_mode='EPHEMERAL'` and explicitly states that snapshots do not
   make the worker persistent. Therefore Vercel Sandbox is not a drop-in W1
   persistent-worker provider under the current production contract.

## Candidate R1: two-plane measurement + outer enforcement

R1 is viable only if the pair explicitly accepts the following safety model and
it is proven live without weakening policy.

### Outer trusted control plane

The outer provider/controller may create and supervise the worker sandbox, but
its control socket/API must **not** be exposed to the worker. The outer plane is
responsible for evidence that an inner worker cannot self-assert:

- provider object and provider session identity;
- outer PID/mount/network namespace identities;
- exact source revision and image/runtime identity;
- cgroup assignment and effective CPU/memory/pids limits;
- tree termination performed through the worker cgroup;
- default-deny worker network policy;
- lifecycle boundary and durable workspace/sentinel binding.

### Inner worker plane

The worker must independently demonstrate:

- effective uid is non-zero;
- no-new-privileges is set;
- seccomp filter mode is active and bound to a policy digest;
- no privileged mode and no host PID/network namespace sharing;
- inner PID and mount namespace identities differ from the persisted outer
  reference identities;
- pidfd open/send-signal/waitid canaries pass;
- finite rlimits are actually enforced;
- descriptor-bound workspace operations use openat2 with RESOLVE_BENEATH and
  RESOLVE_NO_MAGICLINKS;
- worker has no Docker/control socket or equivalent host-control capability.

### Composition rule

No caller may submit `mount_namespace=true`, `tree_kill_via_cgroup=true`,
`network.default_deny=true`, or `rootless=true` as authoritative booleans.
Production acceptance must derive them server-side from persisted outer and
inner receipt hashes bound to the same enrollment, latest verified probe,
provider object/session, source SHA, policy SHA, and validity window.

The existing observation -> dedicated verification -> admission/heartbeat
barrier must remain in place. Legacy v1 rows and functions remain auditable and
unchanged.

## Rootless decision rule

The pair must choose one of two explicit meanings; ambiguity is not allowed:

- `WORKER_ROOTLESS`: the inner worker process executes as non-root, cannot gain
  privilege, has no outer daemon/control socket, and all outer enforcement is
  measured independently. A trusted outer daemon may be privileged.
- `RUNTIME_ROOTLESS`: the daemon/runtime that creates the worker sandbox must
  itself run without root privileges.

If `RUNTIME_ROOTLESS` is required, current Codespace evidence strongly points to
provider rejection because unprivileged user namespaces are denied and no
cgroup subtree is delegated. Do not work around that with `--privileged`,
`--pid=host`, `--network=host`, capability additions, sysctl/AppArmor changes, or
seccomp disablement.

## Candidate R3: provider change

R3 must select a provider that satisfies *current* W1 persistence semantics.
Under the production backend validator, Vercel Sandbox is currently classified
as EPHEMERAL and therefore cannot close W1 without an additional persistence
contract change. Prefer a native persistent Linux / self-hosted VM backend if
R1 is rejected.

## Mandatory falsifiers

R1 must fail closed if any of these occur:

- outer namespace/provider evidence is not independently bound to the same live
  provider object/session;
- inner and outer PID or mount namespace identity is equal;
- worker can access the outer Docker/control socket;
- worker runs privileged or shares host PID/network namespace;
- no-new-privileges or seccomp filter is absent;
- cgroup CPU/memory/pids limits are not observable on the worker cgroup;
- tree-kill cannot be demonstrated on a disposable probe tree;
- default-deny network cannot be demonstrated by a negative egress canary;
- persisted readback cannot reproduce every input hash used by composition;
- dedicated safety verification is absent or stale.

## Current governance

The macroblock is intentionally hard-gated while SAME_POINT duel
`bfd7962d-175d-494a-83d0-96e7472e426b` decides the provider/safety semantics.
No production DDL, worker admission, or further provider/runtime mutation is
permitted merely because this PREP document exists.
