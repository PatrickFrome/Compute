#!/usr/bin/env python3
"""Collect raw local Linux safety facts for the W1 admission contract.

Security boundary:
- stdin carries provenance only (git/tree SHA);
- host safety facts are collected from fixed kernel interfaces and local canaries;
- callers cannot supply safety, persistence, identity, reboot, admission, or authority fields;
- stdout is exactly the observation schema consumed by admission_contract.py.

This collector never admits a worker and never asserts persistence.
"""
from __future__ import annotations

import ctypes
import errno
import json
import os
from pathlib import Path
import signal
import sys
import tempfile
from typing import Any

try:
    from . import admission_contract
except ImportError:  # direct script execution
    import admission_contract  # type: ignore

INPUT_KEYS = {"source"}
SOURCE_KEYS = {"git_sha", "tree_sha"}
CGROUP_ROOT = Path("/sys/fs/cgroup")
PROC_STATUS = Path("/proc/self/status")
PROC_SELF_CGROUP = Path("/proc/self/cgroup")
PROC_SELF_MNT_NS = Path("/proc/self/ns/mnt")
PROC_INIT_MNT_NS = Path("/proc/1/ns/mnt")

# openat2(2) is 437 on the Linux architectures supported by this project
# (x86_64/aarch64/riscv64). Unknown architectures fail closed.
_OPENAT2_NR = {
    "x86_64": 437,
    "amd64": 437,
    "aarch64": 437,
    "arm64": 437,
    "riscv64": 437,
}
_RESOLVE_BENEATH = 0x08


class _OpenHow(ctypes.Structure):
    _fields_ = [
        ("flags", ctypes.c_uint64),
        ("mode", ctypes.c_uint64),
        ("resolve", ctypes.c_uint64),
    ]


def _require_exact_object(value: Any, expected: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    diff = set(value) ^ expected
    if diff:
        raise ValueError(f"{label} keys mismatch: {sorted(diff)}")
    return value


def _validate_input(payload: Any) -> dict[str, str]:
    root = _require_exact_object(payload, INPUT_KEYS, "input")
    source = _require_exact_object(root["source"], SOURCE_KEYS, "source")
    # Reuse the admission contract as the canonical digest validator by
    # constructing only the source fragment later and validating the final
    # observation before output.
    if not all(isinstance(source[key], str) for key in SOURCE_KEYS):
        raise ValueError("source digests must be strings")
    return {"git_sha": source["git_sha"], "tree_sha": source["tree_sha"]}


def _read_proc_status() -> tuple[bool, int]:
    no_new_privs = False
    seccomp_mode = 0
    text = PROC_STATUS.read_text(encoding="utf-8")
    for line in text.splitlines():
        if line.startswith("NoNewPrivs:"):
            no_new_privs = line.split(":", 1)[1].strip() == "1"
        elif line.startswith("Seccomp:"):
            raw = line.split(":", 1)[1].strip()
            seccomp_mode = int(raw) if raw.isdigit() else 0
    return no_new_privs, seccomp_mode


def _mount_namespace_isolated() -> bool:
    try:
        return PROC_SELF_MNT_NS.stat().st_ino != PROC_INIT_MNT_NS.stat().st_ino
    except OSError:
        return False


def _current_cgroup_dir() -> Path:
    try:
        for line in PROC_SELF_CGROUP.read_text(encoding="utf-8").splitlines():
            if line.startswith("0::"):
                rel = line[3:].lstrip("/")
                return CGROUP_ROOT / rel
    except OSError:
        pass
    return CGROUP_ROOT


def _collect_cgroup() -> dict[str, Any]:
    controllers_file = CGROUP_ROOT / "cgroup.controllers"
    version = 2 if controllers_file.is_file() else 1
    unified = version == 2
    controllers: list[str] = []
    kill_supported = False
    if unified:
        try:
            controllers = sorted(set(controllers_file.read_text(encoding="utf-8").split()))
        except OSError:
            controllers = []
        try:
            kill_supported = (_current_cgroup_dir() / "cgroup.kill").is_file()
        except OSError:
            kill_supported = False
    return {
        "version": version,
        "unified": unified,
        "controllers": controllers,
        "kill_supported": kill_supported,
    }


def _pidfd_canary() -> bool:
    if not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
        return False
    fd = -1
    try:
        fd = os.pidfd_open(os.getpid(), 0)  # type: ignore[attr-defined]
        signal.pidfd_send_signal(fd, 0, None, 0)  # type: ignore[attr-defined]
        return True
    except (OSError, AttributeError, NotImplementedError):
        return False
    finally:
        if fd >= 0:
            os.close(fd)


def _openat2_call(dirfd: int, path: str, flags: int, resolve: int) -> int:
    nr = _OPENAT2_NR.get(os.uname().machine.lower())
    if nr is None:
        raise OSError(errno.ENOSYS, "openat2 unsupported architecture")
    libc = ctypes.CDLL(None, use_errno=True)
    how = _OpenHow(flags=flags, mode=0, resolve=resolve)
    raw_path = path.encode("utf-8")
    fd = libc.syscall(
        ctypes.c_long(nr),
        ctypes.c_int(dirfd),
        ctypes.c_char_p(raw_path),
        ctypes.byref(how),
        ctypes.sizeof(how),
    )
    if fd < 0:
        err = ctypes.get_errno()
        raise OSError(err, os.strerror(err), path)
    return int(fd)


def _openat2_beneath_canary() -> bool:
    dirfd = -1
    opened = -1
    try:
        with tempfile.TemporaryDirectory(prefix="w1-openat2-") as tmp:
            root = Path(tmp)
            sandbox = root / "sandbox"
            sandbox.mkdir(mode=0o700)
            (sandbox / "inside").write_bytes(b"ok")
            (root / "outside").write_bytes(b"deny")
            dirfd = os.open(sandbox, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            opened = _openat2_call(dirfd, "inside", os.O_RDONLY, _RESOLVE_BENEATH)
            os.close(opened)
            opened = -1
            try:
                escape_fd = _openat2_call(dirfd, "../outside", os.O_RDONLY, _RESOLVE_BENEATH)
            except OSError as exc:
                return exc.errno in {errno.EXDEV, errno.EACCES, errno.EPERM}
            else:
                os.close(escape_fd)
                return False
    except OSError:
        return False
    finally:
        if opened >= 0:
            os.close(opened)
        if dirfd >= 0:
            os.close(dirfd)


def collect_observation(source: dict[str, str]) -> dict[str, Any]:
    no_new_privs, seccomp_mode = _read_proc_status()
    observation = {
        "schema": admission_contract.OBSERVATION_SCHEMA,
        "policy_sha256": admission_contract.POLICY_SHA256,
        "source": dict(source),
        "host": {
            "os": "linux" if sys.platform.startswith("linux") else sys.platform,
            "euid": os.geteuid(),
            "no_new_privs": no_new_privs,
            "seccomp_mode": seccomp_mode,
            "mount_namespace_isolated": _mount_namespace_isolated(),
            "cgroup": _collect_cgroup(),
            "pidfd_pass": _pidfd_canary(),
            "openat2_beneath_pass": _openat2_beneath_canary(),
        },
    }
    admission_contract.validate_observation(observation)
    return observation


def main() -> int:
    payload = json.load(sys.stdin)
    source = _validate_input(payload)
    observation = collect_observation(source)
    json.dump(observation, sys.stdout, sort_keys=True, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
