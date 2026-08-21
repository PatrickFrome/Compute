# W1 Step 04 — systemd `openat2` hardening compatibility

Date: 2026-08-21
Milestone: `W1_PERSISTENT_LINUX_WORKER_SAFETY`
Classification: RESEARCH / SECURITY DESIGN DECISION

## Trigger

Exact-head W1 CI on Ubuntu 24.04 / Linux 6.17 showed every transient-service H1–H13 check passing except the two `openat2(2)` canaries. Both returned `ENOSYS` despite a kernel that implements `openat2`.

The structured failure ruled out an old-kernel explanation. The active service hardening included `RestrictSUIDSGID=yes`.

## Root cause

Current systemd implementation intentionally disables `openat2()` when `RestrictSUIDSGID=true`. systemd cannot safely inspect the indirect `struct open_how.mode` argument with classic seccomp argument filtering, so the restriction blocks the syscall. This interaction is documented in current systemd issue/source discussions.

Sources:
- https://github.com/systemd/systemd/issues/38711
- https://github.com/systemd/systemd/blob/main/src/shared/seccomp-util.c
- https://www.man7.org/linux/man-pages/man5/systemd.exec.5.html

## Policy conflict

The authoritative H1–H13 policy explicitly requires:

- Linux / effective non-root UID;
- `NoNewPrivileges`;
- cgroup v2 controls;
- mount namespace;
- seccomp filter and policy digest;
- rlimits;
- `pidfd` lifecycle;
- workspace `openat2` with `RESOLVE_BENEATH` and no magic-links;
- default-deny network.

It does **not** require the systemd convenience directive `RestrictSUIDSGID`.

Therefore retaining `RestrictSUIDSGID=yes` would violate a stronger and explicit H1–H13 requirement: usable `openat2` workspace containment.

## Security decision

Remove `RestrictSUIDSGID=yes` from the W1 service profile and transient CI profile while retaining:

- `NoNewPrivileges=yes`;
- empty `CapabilityBoundingSet`;
- empty `AmbientCapabilities`;
- `SecureBits=noroot-locked`;
- dedicated non-root worker identity;
- `ProtectSystem=strict`;
- `ProtectHome=yes`;
- private devices/tmp/mounts;
- kernel/control-group protections;
- syscall deny groups for privileged/mount/module/raw-io/reboot/swap/etc.;
- explicit read/write paths only for worker state/runtime.

Linux kernel documentation states that with `no_new_privs` set, `execve()` cannot gain privileges from setuid/setgid bits or file capabilities. This directly preserves the privilege-escalation property relevant to the worker while allowing the required `openat2` syscall.

Source:
- https://www.kernel.org/doc/html/latest/userspace-api/no_new_privs.html

## Acceptance rule

This is not accepted merely because CI becomes green. The resulting service must still demonstrate:

1. `NoNewPrivs: 1` at runtime;
2. non-root effective UID;
3. seccomp mode 2;
4. both runtime and compiled `openat2` containment canaries PASS;
5. all remaining H1–H13 checks PASS;
6. `persistent_worker_proof=false` on GitHub-hosted CI;
7. a real persistent VM must independently repeat H1–H13 before W1 can become EVIDENCE_READY.

## Nonclaims

- Removing `RestrictSUIDSGID` does not reduce the H1–H13 policy definition.
- GitHub-hosted CI is still ephemeral and cannot prove W1 persistence.
- No real persistent VM is claimed by this step.
- W1 remains IN_PROGRESS until real-host persistence and reboot evidence exists.
