#!/usr/bin/env python3
"""Non-authority live prerequisite probe for W1 linux-h1-h13-v1.

This script deliberately does NOT create production safety evidence and cannot
admit a worker.  It answers a narrower question: can the current Linux runtime
perform the kernel primitives required to later build evidence accepted by
h205f22_worker_linux_safety_observe_v1?

Active canaries are confined to the current process or a child process:
- pidfd open/send-signal/waitid lifecycle;
- finite rlimit enforcement in a child;
- unprivileged user + mount + network namespace bootstrap in a child;
- cgroup-v2 delegated subtree + cgroup.kill against a child only;
- descriptor-bound openat2 RESOLVE_BENEATH|RESOLVE_NO_MAGICLINKS escape test.

No privileged fallback, host namespace sharing, network access grant, admission,
or project authority is performed.
"""
from __future__ import annotations

import argparse
import ctypes
import errno
import json
import os
from pathlib import Path
import resource
import signal
import socket
import sys
import tempfile
from typing import Any

SCHEMA = "metaengine.compute.w1-h1-h13-prereq-probe.h205f22.v1"
CGROUP_ROOT = Path("/sys/fs/cgroup")
CLONE_NEWNS = 0x00020000
CLONE_NEWNET = 0x40000000
CLONE_NEWUSER = 0x10000000
MS_REC = 16384
MS_PRIVATE = 1 << 18
_RESOLVE_NO_MAGICLINKS = 0x02
_RESOLVE_BENEATH = 0x08
_OPENAT2_NR = {
    "x86_64": 437,
    "amd64": 437,
    "aarch64": 437,
    "arm64": 437,
    "riscv64": 437,
}


class _OpenHow(ctypes.Structure):
    _fields_ = [
        ("flags", ctypes.c_uint64),
        ("mode", ctypes.c_uint64),
        ("resolve", ctypes.c_uint64),
    ]


def _status_fields() -> dict[str, str]:
    fields: dict[str, str] = {}
    try:
        for line in Path("/proc/self/status").read_text(encoding="utf-8").splitlines():
            if ":" in line:
                key, value = line.split(":", 1)
                fields[key] = value.strip()
    except OSError:
        pass
    return fields


def _current_cgroup_dir() -> Path | None:
    try:
        for line in Path("/proc/self/cgroup").read_text(encoding="utf-8").splitlines():
            if line.startswith("0::"):
                rel = line[3:].lstrip("/")
                candidate = (CGROUP_ROOT / rel).resolve()
                root = CGROUP_ROOT.resolve()
                if candidate == root or root in candidate.parents:
                    return candidate
    except OSError:
        return None
    return None


def _pidfd_waitid_canary() -> tuple[bool, str]:
    pidfd_open = getattr(os, "pidfd_open", None)
    pidfd_send_signal = getattr(signal, "pidfd_send_signal", None)
    p_pidfd = getattr(os, "P_PIDFD", None)
    if not callable(pidfd_open) or not callable(pidfd_send_signal) or p_pidfd is None:
        return False, "pidfd_or_waitid_api_unavailable"
    pid = os.fork()
    if pid == 0:
        os._exit(17)
    fd = -1
    try:
        fd = pidfd_open(pid, 0)
        pidfd_send_signal(fd, 0, None, 0)
        result = os.waitid(p_pidfd, fd, os.WEXITED)
        code = getattr(result, "si_status", None)
        return code == 17, f"waitid_status={code}"
    except (OSError, AttributeError, TypeError) as exc:
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass
        try:
            os.waitpid(pid, 0)
        except OSError:
            pass
        return False, f"{type(exc).__name__}:{exc}"
    finally:
        if fd >= 0:
            os.close(fd)


def _rlimit_canary() -> tuple[bool, dict[str, Any]]:
    targets = {
        resource.RLIMIT_CPU: 300,
        resource.RLIMIT_AS: 1 << 30,
        resource.RLIMIT_NOFILE: 1024,
        resource.RLIMIT_NPROC: 256,
        resource.RLIMIT_FSIZE: 1 << 30,
    }
    read_fd, write_fd = os.pipe()
    pid = os.fork()
    if pid == 0:
        os.close(read_fd)
        result: dict[str, Any] = {"ok": True, "values": {}}
        try:
            for key, wanted in targets.items():
                soft, hard = resource.getrlimit(key)
                finite_hard = wanted if hard == resource.RLIM_INFINITY else min(wanted, int(hard))
                if finite_hard < 1:
                    raise RuntimeError(f"hard_limit_too_low:{key}")
                resource.setrlimit(key, (finite_hard, finite_hard))
                after = resource.getrlimit(key)
                result["values"][str(key)] = [int(after[0]), int(after[1])]
                if after[0] == resource.RLIM_INFINITY or after[1] == resource.RLIM_INFINITY:
                    raise RuntimeError(f"limit_not_finite:{key}")
        except Exception as exc:  # child-only diagnostic
            result = {"ok": False, "error": f"{type(exc).__name__}:{exc}"}
        os.write(write_fd, json.dumps(result, sort_keys=True).encode("utf-8"))
        os.close(write_fd)
        os._exit(0)
    os.close(write_fd)
    raw = b""
    while True:
        chunk = os.read(read_fd, 65536)
        if not chunk:
            break
        raw += chunk
    os.close(read_fd)
    _, status = os.waitpid(pid, 0)
    try:
        payload = json.loads(raw.decode("utf-8")) if raw else {"ok": False, "error": "no_child_payload"}
    except Exception as exc:
        payload = {"ok": False, "error": f"decode:{exc}"}
    ok = os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0 and payload.get("ok") is True
    return ok, payload


def _write_map(path: str, value: str) -> None:
    Path(path).write_text(value, encoding="ascii")


def _namespace_canary() -> tuple[bool, dict[str, Any]]:
    read_fd, write_fd = os.pipe()
    pid = os.fork()
    if pid == 0:
        os.close(read_fd)
        out: dict[str, Any] = {"ok": False}
        try:
            if os.geteuid() == 0:
                raise RuntimeError("root_caller_not_rootless")
            libc = ctypes.CDLL(None, use_errno=True)
            if libc.unshare(ctypes.c_int(CLONE_NEWUSER)) != 0:
                err = ctypes.get_errno()
                raise OSError(err, os.strerror(err), "unshare_user")
            setgroups = Path("/proc/self/setgroups")
            if setgroups.exists():
                current = setgroups.read_text(encoding="ascii").strip()
                if current == "allow":
                    _write_map(str(setgroups), "deny\n")
                elif current != "deny":
                    raise RuntimeError(f"unexpected_setgroups:{current}")
            uid, gid = os.getuid(), os.getgid()
            _write_map("/proc/self/uid_map", f"{uid} {uid} 1\n")
            _write_map("/proc/self/gid_map", f"{gid} {gid} 1\n")
            if libc.unshare(ctypes.c_int(CLONE_NEWNS | CLONE_NEWNET)) != 0:
                err = ctypes.get_errno()
                raise OSError(err, os.strerror(err), "unshare_mount_net")
            if libc.mount(None, ctypes.c_char_p(b"/"), None, ctypes.c_ulong(MS_REC | MS_PRIVATE), None) != 0:
                err = ctypes.get_errno()
                raise OSError(err, os.strerror(err), "mount_private")
            outbound_blocked = False
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(0.4)
            try:
                sock.connect(("1.1.1.1", 53))
            except OSError:
                outbound_blocked = True
            finally:
                sock.close()
            out = {
                "ok": outbound_blocked,
                "network_default_deny_canary": outbound_blocked,
                "mount_ns_inode": Path("/proc/self/ns/mnt").stat().st_ino,
                "pid_ns_inode": Path("/proc/self/ns/pid").stat().st_ino,
                "net_ns_inode": Path("/proc/self/ns/net").stat().st_ino,
            }
        except Exception as exc:
            out = {"ok": False, "error": f"{type(exc).__name__}:{exc}"}
        os.write(write_fd, json.dumps(out, sort_keys=True).encode("utf-8"))
        os.close(write_fd)
        os._exit(0)
    os.close(write_fd)
    raw = b""
    while True:
        chunk = os.read(read_fd, 65536)
        if not chunk:
            break
        raw += chunk
    os.close(read_fd)
    _, status = os.waitpid(pid, 0)
    try:
        payload = json.loads(raw.decode("utf-8")) if raw else {"ok": False, "error": "no_child_payload"}
    except Exception as exc:
        payload = {"ok": False, "error": f"decode:{exc}"}
    ok = os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0 and payload.get("ok") is True
    return ok, payload


def _openat2_call(dirfd: int, path: str, resolve: int) -> int:
    nr = _OPENAT2_NR.get(os.uname().machine.lower())
    if nr is None:
        raise OSError(errno.ENOSYS, "openat2 unsupported architecture")
    libc = ctypes.CDLL(None, use_errno=True)
    how = _OpenHow(flags=os.O_RDONLY, mode=0, resolve=resolve)
    fd = libc.syscall(
        ctypes.c_long(nr), ctypes.c_int(dirfd), ctypes.c_char_p(path.encode()),
        ctypes.byref(how), ctypes.sizeof(how),
    )
    if fd < 0:
        err = ctypes.get_errno()
        raise OSError(err, os.strerror(err), path)
    return int(fd)


def _descriptor_workspace_canary() -> tuple[bool, str]:
    dirfd = -1
    try:
        with tempfile.TemporaryDirectory(prefix="w1-h13-") as tmp:
            root = Path(tmp)
            sandbox = root / "workspace"
            sandbox.mkdir(mode=0o700)
            (sandbox / "inside").write_text("ok", encoding="utf-8")
            (root / "outside").write_text("deny", encoding="utf-8")
            dirfd = os.open(sandbox, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            good = _openat2_call(dirfd, "inside", _RESOLVE_BENEATH | _RESOLVE_NO_MAGICLINKS)
            os.close(good)
            try:
                escaped = _openat2_call(dirfd, "../outside", _RESOLVE_BENEATH | _RESOLVE_NO_MAGICLINKS)
            except OSError as exc:
                return exc.errno in {errno.EXDEV, errno.EACCES, errno.EPERM}, f"escape_errno={exc.errno}"
            else:
                os.close(escaped)
                return False, "escape_opened"
    except OSError as exc:
        return False, f"{type(exc).__name__}:{exc}"
    finally:
        if dirfd >= 0:
            os.close(dirfd)


def _cgroup_tree_kill_canary(active: bool) -> tuple[bool, dict[str, Any]]:
    current = _current_cgroup_dir()
    if current is None:
        return False, {"error": "cgroup_v2_path_unavailable"}
    info: dict[str, Any] = {
        "path": str(current),
        "controllers_file": (CGROUP_ROOT / "cgroup.controllers").is_file(),
        "kill_present": (current / "cgroup.kill").is_file(),
        "parent_writable": os.access(current, os.W_OK),
    }
    try:
        info["controllers"] = sorted((CGROUP_ROOT / "cgroup.controllers").read_text().split())
    except OSError:
        info["controllers"] = []
    if not active:
        info["active_canary_skipped"] = True
        return False, info

    child_group = current / f"w1-canary-{os.getpid()}"
    pid = -1
    try:
        child_group.mkdir(mode=0o700)
        pid = os.fork()
        if pid == 0:
            signal.pause()
            os._exit(0)
        (child_group / "cgroup.procs").write_text(f"{pid}\n", encoding="ascii")
        kill_file = child_group / "cgroup.kill"
        if not kill_file.is_file():
            raise RuntimeError("child_cgroup_kill_missing")
        kill_file.write_text("1\n", encoding="ascii")
        waited, status = os.waitpid(pid, 0)
        pid = -1
        killed = waited > 0 and os.WIFSIGNALED(status) and os.WTERMSIG(status) == signal.SIGKILL
        info["child_killed_via_cgroup"] = killed
        return killed, info
    except Exception as exc:
        info["error"] = f"{type(exc).__name__}:{exc}"
        return False, info
    finally:
        if pid > 0:
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass
            try:
                os.waitpid(pid, 0)
            except OSError:
                pass
        try:
            child_group.rmdir()
        except OSError:
            pass


def probe(active_cgroup: bool) -> dict[str, Any]:
    status = _status_fields()
    pidfd_ok, pidfd_detail = _pidfd_waitid_canary()
    rlimit_ok, rlimit_detail = _rlimit_canary()
    ns_ok, ns_detail = _namespace_canary()
    workspace_ok, workspace_detail = _descriptor_workspace_canary()
    cgroup_ok, cgroup_detail = _cgroup_tree_kill_canary(active_cgroup)
    libseccomp = ctypes.util.find_library("seccomp") if hasattr(ctypes, "util") else None
    # ctypes.util is imported lazily below for older runtimes.
    checks = {
        "linux": sys.platform.startswith("linux"),
        "nonroot": os.geteuid() != 0,
        "pidfd_waitid": pidfd_ok,
        "finite_rlimits": rlimit_ok,
        "user_mount_net_namespaces": ns_ok,
        "network_default_deny_canary": bool(ns_detail.get("network_default_deny_canary")),
        "descriptor_bound_workspace": workspace_ok,
        "cgroup_v2_mounted": bool(cgroup_detail.get("controllers_file")),
        "cgroup_cpu_memory_pids": {"cpu", "memory", "pids"}.issubset(set(cgroup_detail.get("controllers", []))),
        "cgroup_tree_kill": cgroup_ok,
        "libseccomp_available": bool(libseccomp),
    }
    return {
        "schema": SCHEMA,
        "checks": checks,
        "details": {
            "pidfd": pidfd_detail,
            "rlimits": rlimit_detail,
            "namespaces": ns_detail,
            "workspace": workspace_detail,
            "cgroup": cgroup_detail,
            "current_no_new_privs": status.get("NoNewPrivs"),
            "current_seccomp": status.get("Seccomp"),
            "libseccomp": libseccomp,
        },
        "ready_for_production_evidence": all(checks.values()),
        "canonical": False,
        "authority_effect": False,
        "worker_admitted": False,
        "w1_verified": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--active-cgroup-canary",
        action="store_true",
        help="create one temporary child cgroup and kill only a probe child via cgroup.kill",
    )
    args = parser.parse_args()
    result = probe(args.active_cgroup_canary)
    json.dump(result, sys.stdout, sort_keys=True, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ready_for_production_evidence"] else 2


if __name__ == "__main__":
    # Imported here so the module can be loaded on minimal Python builds and
    # report libseccomp absence instead of failing at import time.
    import ctypes.util
    raise SystemExit(main())
