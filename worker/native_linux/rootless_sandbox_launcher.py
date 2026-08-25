#!/usr/bin/env python3
"""Fail-closed rootless launcher for a W1 worker process.

PREPARE-ONLY until the MB1 V2 hard gate is resumed and the target provider
passes a live capability canary. This launcher is intentionally separate from
admission_contract.py: it may create isolation, but it never claims that W1 is
verified or that a worker is admitted.

The launcher:
1. requires Linux and a non-root caller;
2. creates a new user + mount namespace without privileged mode;
3. maps only the caller UID/GID into the new user namespace;
4. makes mount propagation private;
5. sets PR_SET_NO_NEW_PRIVS;
6. installs a non-empty libseccomp deny policy;
7. drops all Linux capabilities available in the new user namespace;
8. execs the requested worker command.

No fallback to privileged execution, seccomp=unconfined, or an allow-all
synthetic filter is permitted.
"""
from __future__ import annotations

import ctypes
import ctypes.util
import errno
import os
from pathlib import Path
import sys
from typing import Iterable

CLONE_NEWNS = 0x00020000
CLONE_NEWUSER = 0x10000000
MS_REC = 16384
MS_PRIVATE = 1 << 18
PR_SET_NO_NEW_PRIVS = 38
PR_CAPBSET_DROP = 24
SCMP_ACT_ALLOW = 0x7FFF0000
SCMP_ACT_ERRNO_BASE = 0x00050000

# Deliberately substantive denylist. The filter is loaded only after namespace
# setup, so mount/unshare are denied to the worker after the sandbox boundary.
DENIED_SYSCALLS = (
    "acct",
    "add_key",
    "bpf",
    "clock_adjtime",
    "clock_settime",
    "delete_module",
    "finit_module",
    "init_module",
    "kexec_file_load",
    "kexec_load",
    "keyctl",
    "mount",
    "open_by_handle_at",
    "perf_event_open",
    "ptrace",
    "reboot",
    "request_key",
    "setns",
    "settimeofday",
    "swapoff",
    "swapon",
    "umount2",
    "unshare",
    "userfaultfd",
)


class SandboxUnavailable(RuntimeError):
    pass


def _libc() -> ctypes.CDLL:
    return ctypes.CDLL(None, use_errno=True)


def _raise_errno(label: str) -> None:
    err = ctypes.get_errno()
    raise SandboxUnavailable(f"{label}: {os.strerror(err)} ({err})")


def _write_text(path: str, value: str) -> None:
    try:
        Path(path).write_text(value, encoding="ascii")
    except OSError as exc:
        raise SandboxUnavailable(f"cannot write {path}: {exc}") from exc


def enter_rootless_namespaces() -> None:
    if not sys.platform.startswith("linux"):
        raise SandboxUnavailable("linux required")
    uid, gid = os.getuid(), os.getgid()
    if os.geteuid() == 0:
        raise SandboxUnavailable("root caller forbidden")

    libc = _libc()
    if libc.unshare(ctypes.c_int(CLONE_NEWUSER | CLONE_NEWNS)) != 0:
        _raise_errno("unshare user+mount namespace failed")

    # Single-ID mapping is intentionally narrow and does not need subordinate
    # UID/GID ranges. setgroups must be disabled before gid_map on modern Linux.
    try:
        _write_text("/proc/self/setgroups", "deny\n")
    except SandboxUnavailable as exc:
        if "No such file" not in str(exc):
            raise
    _write_text("/proc/self/uid_map", f"{uid} {uid} 1\n")
    _write_text("/proc/self/gid_map", f"{gid} {gid} 1\n")

    # Prevent mount propagation back to the parent namespace.
    if libc.mount(None, ctypes.c_char_p(b"/"), None, ctypes.c_ulong(MS_REC | MS_PRIVATE), None) != 0:
        _raise_errno("make mount tree private failed")


def set_no_new_privs() -> None:
    libc = _libc()
    if libc.prctl(ctypes.c_int(PR_SET_NO_NEW_PRIVS), 1, 0, 0, 0) != 0:
        _raise_errno("PR_SET_NO_NEW_PRIVS failed")


def _seccomp_action_errno(code: int) -> int:
    if code <= 0 or code > 0xFFFF:
        raise ValueError("errno out of range")
    return SCMP_ACT_ERRNO_BASE | code


def install_seccomp_deny_policy(syscalls: Iterable[str] = DENIED_SYSCALLS) -> None:
    name = ctypes.util.find_library("seccomp")
    if not name:
        raise SandboxUnavailable("libseccomp unavailable")
    sec = ctypes.CDLL(name, use_errno=True)
    sec.seccomp_init.argtypes = [ctypes.c_uint32]
    sec.seccomp_init.restype = ctypes.c_void_p
    sec.seccomp_release.argtypes = [ctypes.c_void_p]
    sec.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    sec.seccomp_syscall_resolve_name.restype = ctypes.c_int
    sec.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
    sec.seccomp_rule_add.restype = ctypes.c_int
    sec.seccomp_load.argtypes = [ctypes.c_void_p]
    sec.seccomp_load.restype = ctypes.c_int

    selected = tuple(dict.fromkeys(syscalls))
    if len(selected) < 8:
        raise SandboxUnavailable("seccomp policy too small; refusing synthetic filter")

    ctx = sec.seccomp_init(SCMP_ACT_ALLOW)
    if not ctx:
        raise SandboxUnavailable("seccomp_init failed")
    try:
        action = _seccomp_action_errno(errno.EPERM)
        installed = 0
        for syscall in selected:
            nr = sec.seccomp_syscall_resolve_name(syscall.encode("ascii"))
            if nr < 0:
                continue  # architecture may not implement every syscall
            rc = sec.seccomp_rule_add(ctx, action, nr, 0)
            if rc != 0:
                raise SandboxUnavailable(f"seccomp_rule_add failed for {syscall}: {rc}")
            installed += 1
        if installed < 8:
            raise SandboxUnavailable("too few seccomp rules resolved on this architecture")
        rc = sec.seccomp_load(ctx)
        if rc != 0:
            raise SandboxUnavailable(f"seccomp_load failed: {rc}")
    finally:
        sec.seccomp_release(ctx)


def drop_capability_bounding_set() -> None:
    libc = _libc()
    # Linux currently defines capabilities far below 64. Dropping nonexistent
    # numbers returns EINVAL and is ignored; any other error fails closed.
    for cap in range(0, 64):
        ctypes.set_errno(0)
        rc = libc.prctl(ctypes.c_int(PR_CAPBSET_DROP), ctypes.c_ulong(cap), 0, 0, 0)
        if rc != 0:
            err = ctypes.get_errno()
            if err != errno.EINVAL:
                raise SandboxUnavailable(f"failed to drop capability {cap}: {os.strerror(err)}")


def launch(argv: list[str]) -> None:
    if not argv:
        raise ValueError("worker command required")
    enter_rootless_namespaces()
    set_no_new_privs()
    install_seccomp_deny_policy()
    drop_capability_bounding_set()
    os.execvp(argv[0], argv)


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: rootless_sandbox_launcher.py COMMAND [ARG ...]", file=sys.stderr)
        return 64
    try:
        launch(sys.argv[1:])
    except SandboxUnavailable as exc:
        print(f"W1_SANDBOX_UNAVAILABLE: {exc}", file=sys.stderr)
        return 78
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
