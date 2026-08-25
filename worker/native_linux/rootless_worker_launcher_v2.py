#!/usr/bin/env python3
"""PREP-only worker-rootless launcher for W1 two-plane safety v2.

This is additive to rootless_sandbox_launcher.py. It creates user, mount and
network namespaces for the WORKER process, verifies the mount/net boundaries,
then installs NNP + a substantive seccomp deny policy and drops the capability
bounding set before exec. It never admits a worker or asserts W1.
"""
from __future__ import annotations

import ctypes
import errno
import os
from pathlib import Path
import socket
import sys

try:
    from . import rootless_sandbox_launcher as v1
except ImportError:
    import rootless_sandbox_launcher as v1  # type: ignore

CLONE_NEWNET = 0x40000000


def _ns_inode(kind: str) -> int:
    return Path(f"/proc/self/ns/{kind}").stat().st_ino


def _network_default_deny_canary() -> bool:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(0.35)
    try:
        sock.connect(("1.1.1.1", 53))
    except OSError:
        return True
    finally:
        sock.close()
    return False


def enter_worker_rootless_namespaces() -> None:
    if not sys.platform.startswith("linux"):
        raise v1.SandboxUnavailable("linux required")
    uid, gid = os.getuid(), os.getgid()
    if os.geteuid() == 0:
        raise v1.SandboxUnavailable("root caller forbidden")

    outer_mnt = _ns_inode("mnt")
    outer_net = _ns_inode("net")
    libc = ctypes.CDLL(None, use_errno=True)

    if libc.unshare(ctypes.c_int(v1.CLONE_NEWUSER)) != 0:
        v1._raise_errno("unshare user namespace failed")
    v1._disable_setgroups_if_needed()
    v1._write_text("/proc/self/uid_map", f"{uid} {uid} 1\n")
    v1._write_text("/proc/self/gid_map", f"{gid} {gid} 1\n")

    if libc.unshare(ctypes.c_int(v1.CLONE_NEWNS | CLONE_NEWNET)) != 0:
        v1._raise_errno("unshare mount/network namespaces failed")
    if libc.mount(None, ctypes.c_char_p(b"/"), None, ctypes.c_ulong(v1.MS_REC | v1.MS_PRIVATE), None) != 0:
        v1._raise_errno("make mount tree private failed")

    if _ns_inode("mnt") == outer_mnt:
        raise v1.SandboxUnavailable("mount namespace did not change")
    if _ns_inode("net") == outer_net:
        raise v1.SandboxUnavailable("network namespace did not change")
    if not _network_default_deny_canary():
        raise v1.SandboxUnavailable("new network namespace is not default-deny")


def launch(argv: list[str]) -> None:
    if not argv:
        raise ValueError("worker command required")
    enter_worker_rootless_namespaces()
    v1.set_no_new_privs()
    v1.install_seccomp_deny_policy()
    v1.drop_capability_bounding_set()
    os.execvp(argv[0], argv)


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: rootless_worker_launcher_v2.py COMMAND [ARG ...]", file=sys.stderr)
        return 64
    try:
        launch(sys.argv[1:])
    except v1.SandboxUnavailable as exc:
        print(f"W1_WORKER_ROOTLESS_UNAVAILABLE: {exc}", file=sys.stderr)
        return 78
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
