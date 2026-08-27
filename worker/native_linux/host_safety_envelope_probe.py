#!/usr/bin/env python3
"""Active W1 Linux safety-envelope evidence probe.

This probe is deliberately non-authoritative. It collects and actively tests
kernel/runtime safety properties required by the live H205F22
`linux-h1-h13-v1` policy, but it never admits a worker and never asserts host
persistence.

Input (stdin) is provenance only:
  {"source":{"git_sha":"<40 hex>","tree_sha":"<40 hex>"}}

The caller cannot supply safety facts, filesystem paths, cgroup paths, network
claims, identity claims, persistence claims, or authority fields.
"""
from __future__ import annotations

import ctypes
import errno
import hashlib
import json
import os
from pathlib import Path
import resource
import select
import signal
import subprocess
import sys
import tempfile
import time
from typing import Any

SCHEMA = "metaengine.compute.w1-host-safety-envelope-observation.h205f22.v2"
POLICY_KEY = "linux-h1-h13-v1"
INPUT_KEYS = {"source"}
SOURCE_KEYS = {"git_sha", "tree_sha"}
CGROUP_ROOT = Path("/sys/fs/cgroup")
PROC_STATUS = Path("/proc/self/status")
PROC_SELF_CGROUP = Path("/proc/self/cgroup")
PROC_SELF_MNT_NS = Path("/proc/self/ns/mnt")
PROC_INIT_MNT_NS = Path("/proc/1/ns/mnt")
PROC_SELF_NET_NS = Path("/proc/self/ns/net")
PROC_INIT_NET_NS = Path("/proc/1/ns/net")

_OPENAT2_NR = {"x86_64": 437, "amd64": 437, "aarch64": 437, "arm64": 437, "riscv64": 437}
_GETPPID_NR = {"x86_64": 110, "amd64": 110, "aarch64": 173, "arm64": 173, "riscv64": 173}
_RESOLVE_NO_XDEV = 0x01
_RESOLVE_NO_MAGICLINKS = 0x02
_RESOLVE_NO_SYMLINKS = 0x04
_RESOLVE_BENEATH = 0x08
_RESOLVE_STRICT = _RESOLVE_NO_XDEV | _RESOLVE_NO_MAGICLINKS | _RESOLVE_NO_SYMLINKS | _RESOLVE_BENEATH

# prctl/seccomp constants from Linux UAPI.
_PR_SET_SECCOMP = 22
_PR_SET_NO_NEW_PRIVS = 38
_SECCOMP_MODE_FILTER = 2
_BPF_LD_W_ABS = 0x20
_BPF_JMP_JEQ_K = 0x15
_BPF_RET_K = 0x06
_SECCOMP_RET_ALLOW = 0x7FFF0000
_SECCOMP_RET_ERRNO = 0x00050000

# Conservative canary limits. These constrain only the disposable child cgroup.
_CANARY_CPU_MAX = "10000 100000"
_CANARY_MEMORY_MAX = str(64 * 1024 * 1024)
_CANARY_PIDS_MAX = "8"


class _OpenHow(ctypes.Structure):
    _fields_ = [("flags", ctypes.c_uint64), ("mode", ctypes.c_uint64), ("resolve", ctypes.c_uint64)]


class _SockFilter(ctypes.Structure):
    _fields_ = [("code", ctypes.c_ushort), ("jt", ctypes.c_ubyte), ("jf", ctypes.c_ubyte), ("k", ctypes.c_uint32)]


class _SockFProg(ctypes.Structure):
    _fields_ = [("len", ctypes.c_ushort), ("filter", ctypes.POINTER(_SockFilter))]


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def _exact_object(value: Any, expected: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label}_must_be_object")
    if set(value) != expected:
        raise ValueError(f"{label}_keys_mismatch")
    return value


def _sha40(value: Any, label: str) -> str:
    if not isinstance(value, str) or len(value) != 40 or value != value.lower() or any(c not in "0123456789abcdef" for c in value):
        raise ValueError(f"invalid_{label}")
    return value


def _validate_input(value: Any) -> dict[str, str]:
    root = _exact_object(value, INPUT_KEYS, "input")
    source = _exact_object(root["source"], SOURCE_KEYS, "source")
    return {"git_sha": _sha40(source["git_sha"], "git_sha"), "tree_sha": _sha40(source["tree_sha"], "tree_sha")}


def _read_status(path: Path = PROC_STATUS) -> dict[str, int | bool]:
    fields: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if ":" in line:
            key, raw = line.split(":", 1)
            fields[key] = raw.strip()
    return {
        "no_new_privs": fields.get("NoNewPrivs") == "1",
        "seccomp_mode": int(fields.get("Seccomp", "0")) if fields.get("Seccomp", "0").isdigit() else 0,
        "seccomp_filters": int(fields.get("Seccomp_filters", "0")) if fields.get("Seccomp_filters", "0").isdigit() else 0,
    }


def _namespace_isolated(self_path: Path, init_path: Path) -> bool:
    try:
        return self_path.stat().st_ino != init_path.stat().st_ino
    except OSError:
        return False


def _current_cgroup_rel() -> str | None:
    try:
        for line in PROC_SELF_CGROUP.read_text(encoding="utf-8").splitlines():
            if line.startswith("0::"):
                return "/" + line[3:].lstrip("/")
    except OSError:
        return None
    return None


def _cgroup_dir(rel: str | None) -> Path:
    if not rel:
        return CGROUP_ROOT
    return CGROUP_ROOT / rel.lstrip("/")


def _read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return None


def _finite_positive(raw: str | None) -> bool:
    if raw is None or raw == "max":
        return False
    head = raw.split()[0] if raw.split() else ""
    return head.isdigit() and int(head) > 0


def _collect_current_cgroup() -> dict[str, Any]:
    rel = _current_cgroup_rel()
    current = _cgroup_dir(rel)
    controllers_raw = _read_text(CGROUP_ROOT / "cgroup.controllers")
    controllers = sorted(set((controllers_raw or "").split()))
    cpu_max = _read_text(current / "cpu.max")
    memory_max = _read_text(current / "memory.max")
    pids_max = _read_text(current / "pids.max")
    return {
        "version": 2 if (CGROUP_ROOT / "cgroup.controllers").is_file() else 1,
        "relative_path": rel,
        "controllers": controllers,
        "cgroup_kill_present": (current / "cgroup.kill").is_file(),
        "cpu_max": cpu_max,
        "memory_max": memory_max,
        "pids_max": pids_max,
        "finite_cpu_max": _finite_positive(cpu_max),
        "finite_memory_max": _finite_positive(memory_max),
        "finite_pids_max": _finite_positive(pids_max),
    }


def _collect_rlimits() -> dict[str, Any]:
    specs = {
        "cpu_seconds": resource.RLIMIT_CPU,
        "fsize_bytes": resource.RLIMIT_FSIZE,
        "address_space_bytes": resource.RLIMIT_AS,
        "nofile": resource.RLIMIT_NOFILE,
        "nproc": resource.RLIMIT_NPROC,
    }
    result: dict[str, Any] = {}
    for name, key in specs.items():
        soft, hard = resource.getrlimit(key)
        result[name] = {
            "soft": soft,
            "hard": hard,
            "soft_finite": soft != resource.RLIM_INFINITY,
            "hard_finite": hard != resource.RLIM_INFINITY,
        }
    return result


def _pidfd_lifecycle_canary() -> dict[str, Any]:
    pidfd_open = getattr(os, "pidfd_open", None)
    pidfd_send_signal = getattr(signal, "pidfd_send_signal", None)
    if not callable(pidfd_open) or not callable(pidfd_send_signal):
        return {"open": False, "send_signal": False, "waitid": False, "exit_observed": False, "error": "PYTHON_PIDFD_API_UNAVAILABLE"}
    proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    fd = -1
    try:
        fd = pidfd_open(proc.pid, 0)
        pidfd_send_signal(fd, 0, None, 0)
        pidfd_send_signal(fd, signal.SIGTERM, None, 0)
        waitid_ok = False
        if hasattr(os, "waitid"):
            try:
                os.waitid(getattr(os, "P_PIDFD", 3), fd, os.WEXITED)
                waitid_ok = True
            except (ChildProcessError, OSError, ValueError):
                waitid_ok = False
        poller = select.poll()
        poller.register(fd, select.POLLIN | select.POLLHUP | select.POLLERR)
        exit_observed = bool(poller.poll(2000))
        if proc.poll() is None:
            proc.wait(timeout=2)
        return {"open": True, "send_signal": True, "waitid": waitid_ok, "exit_observed": exit_observed, "error": None}
    except (OSError, subprocess.SubprocessError, TypeError) as exc:
        try:
            proc.kill()
        except OSError:
            pass
        try:
            proc.wait(timeout=2)
        except Exception:
            pass
        return {"open": fd >= 0, "send_signal": False, "waitid": False, "exit_observed": False, "error": f"{type(exc).__name__}:{getattr(exc, 'errno', '')}"}
    finally:
        if fd >= 0:
            os.close(fd)


def _openat2_call(dirfd: int, path: str, flags: int, resolve: int) -> int:
    nr = _OPENAT2_NR.get(os.uname().machine.lower())
    if nr is None:
        raise OSError(errno.ENOSYS, "openat2_unsupported_arch")
    libc = ctypes.CDLL(None, use_errno=True)
    how = _OpenHow(flags=flags, mode=0, resolve=resolve)
    fd = libc.syscall(ctypes.c_long(nr), ctypes.c_int(dirfd), ctypes.c_char_p(path.encode()), ctypes.byref(how), ctypes.sizeof(how))
    if fd < 0:
        err = ctypes.get_errno()
        raise OSError(err, os.strerror(err), path)
    return int(fd)


def _workspace_canary() -> dict[str, Any]:
    rootfd = -1
    opened = -1
    try:
        # The canary is deliberately rooted in the actual current workspace.
        with tempfile.TemporaryDirectory(prefix=".w1-workspace-canary-", dir=os.getcwd()) as tmp:
            root = Path(tmp)
            (root / "inside").write_bytes(b"ok")
            (root / "escape-link").symlink_to("/proc/self/status")
            rootfd = os.open(root, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            opened = _openat2_call(rootfd, "inside", os.O_RDONLY, _RESOLVE_STRICT)
            os.close(opened)
            opened = -1

            parent_escape_blocked = False
            try:
                escaped = _openat2_call(rootfd, "../", os.O_RDONLY | getattr(os, "O_DIRECTORY", 0), _RESOLVE_STRICT)
            except OSError as exc:
                parent_escape_blocked = exc.errno in {errno.EXDEV, errno.EACCES, errno.EPERM, errno.ELOOP}
            else:
                os.close(escaped)

            symlink_escape_blocked = False
            try:
                escaped = _openat2_call(rootfd, "escape-link", os.O_RDONLY, _RESOLVE_STRICT)
            except OSError as exc:
                symlink_escape_blocked = exc.errno in {errno.ELOOP, errno.EXDEV, errno.EACCES, errno.EPERM}
            else:
                os.close(escaped)

            return {
                "dirfd_bound": True,
                "resolve_beneath": True,
                "no_magiclinks": True,
                "no_symlinks": True,
                "no_xdev": True,
                "inside_opened": True,
                "parent_escape_blocked": parent_escape_blocked,
                "symlink_escape_blocked": symlink_escape_blocked,
                "error": None,
            }
    except (OSError, ValueError) as exc:
        return {
            "dirfd_bound": rootfd >= 0,
            "resolve_beneath": False,
            "no_magiclinks": False,
            "no_symlinks": False,
            "no_xdev": False,
            "inside_opened": False,
            "parent_escape_blocked": False,
            "symlink_escape_blocked": False,
            "error": f"{type(exc).__name__}:{getattr(exc, 'errno', '')}",
        }
    finally:
        if opened >= 0:
            os.close(opened)
        if rootfd >= 0:
            os.close(rootfd)


def _seccomp_filter_canary() -> dict[str, Any]:
    machine = os.uname().machine.lower()
    getppid_nr = _GETPPID_NR.get(machine)
    if getppid_nr is None:
        return {"arch": machine, "arch_checked": False, "filter_installed": False, "blocked_syscall": False, "seccomp_mode": 0, "seccomp_filters": 0, "policy_digest": None, "error": "UNSUPPORTED_ARCH"}

    policy = {
        "arch": machine,
        "blocked_syscall": "getppid",
        "blocked_syscall_nr": getppid_nr,
        "action": "ERRNO_EPERM",
        "default": "ALLOW",
    }
    digest = canonical_hash(policy)
    read_fd, write_fd = os.pipe()
    pid = os.fork()
    if pid == 0:
        os.close(read_fd)
        result: dict[str, Any]
        try:
            filters = (_SockFilter * 4)(
                _SockFilter(_BPF_LD_W_ABS, 0, 0, 0),
                _SockFilter(_BPF_JMP_JEQ_K, 0, 1, getppid_nr),
                _SockFilter(_BPF_RET_K, 0, 0, _SECCOMP_RET_ERRNO | errno.EPERM),
                _SockFilter(_BPF_RET_K, 0, 0, _SECCOMP_RET_ALLOW),
            )
            prog = _SockFProg(len=4, filter=ctypes.cast(filters, ctypes.POINTER(_SockFilter)))
            libc = ctypes.CDLL(None, use_errno=True)
            if libc.prctl(_PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0:
                raise OSError(ctypes.get_errno(), "PR_SET_NO_NEW_PRIVS")
            if libc.prctl(_PR_SET_SECCOMP, _SECCOMP_MODE_FILTER, ctypes.byref(prog), 0, 0) != 0:
                raise OSError(ctypes.get_errno(), "PR_SET_SECCOMP")
            status = _read_status(Path("/proc/self/status"))
            ctypes.set_errno(0)
            rv = libc.syscall(ctypes.c_long(getppid_nr))
            blocked = rv == -1 and ctypes.get_errno() == errno.EPERM
            result = {
                "arch": machine,
                "arch_checked": True,
                "filter_installed": status["seccomp_mode"] == 2 and status["seccomp_filters"] >= 1,
                "blocked_syscall": blocked,
                "seccomp_mode": status["seccomp_mode"],
                "seccomp_filters": status["seccomp_filters"],
                "policy_digest": digest,
                "error": None,
            }
        except BaseException as exc:
            result = {"arch": machine, "arch_checked": True, "filter_installed": False, "blocked_syscall": False, "seccomp_mode": 0, "seccomp_filters": 0, "policy_digest": digest, "error": f"{type(exc).__name__}:{getattr(exc, 'errno', '')}"}
        raw = json.dumps(result, sort_keys=True).encode()
        try:
            os.write(write_fd, raw)
        finally:
            os.close(write_fd)
        os._exit(0)

    os.close(write_fd)
    chunks: list[bytes] = []
    try:
        while True:
            chunk = os.read(read_fd, 65536)
            if not chunk:
                break
            chunks.append(chunk)
    finally:
        os.close(read_fd)
        os.waitpid(pid, 0)
    try:
        return json.loads(b"".join(chunks).decode())
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {"arch": machine, "arch_checked": True, "filter_installed": False, "blocked_syscall": False, "seccomp_mode": 0, "seccomp_filters": 0, "policy_digest": digest, "error": "CANARY_RESULT_INVALID"}


def _pid_in_cgroup(pid: int, expected_rel: str) -> bool:
    try:
        for line in Path(f"/proc/{pid}/cgroup").read_text(encoding="utf-8").splitlines():
            if line.startswith("0::"):
                return "/" + line[3:].lstrip("/") == expected_rel
    except OSError:
        return False
    return False


def _pidfd_open_for(pid: int) -> int:
    fn = getattr(os, "pidfd_open", None)
    if not callable(fn):
        raise OSError(errno.ENOSYS, "pidfd_open_unavailable")
    return fn(pid, 0)


def _pidfd_exited(fd: int, timeout_ms: int) -> bool:
    poller = select.poll()
    poller.register(fd, select.POLLIN | select.POLLHUP | select.POLLERR)
    return bool(poller.poll(timeout_ms))


def _cgroup_tree_kill_canary() -> dict[str, Any]:
    rel = _current_cgroup_rel()
    current = _cgroup_dir(rel)
    if not rel or not (CGROUP_ROOT / "cgroup.controllers").is_file():
        return {"created": False, "limits_written": False, "parent_contained": False, "grandchild_contained": False, "tree_killed": False, "error": "CGROUP_V2_REQUIRED"}

    canary = current / f"w1-canary-{os.getpid()}-{time.monotonic_ns()}"
    proc: subprocess.Popen[str] | None = None
    pfd_parent = -1
    pfd_grand = -1
    gate_r = gate_w = -1
    grand_pid: int | None = None
    expected_rel = rel.rstrip("/") + "/" + canary.name if rel != "/" else "/" + canary.name
    try:
        canary.mkdir(mode=0o700)
        required_files = ["cpu.max", "memory.max", "pids.max", "cgroup.procs", "cgroup.kill"]
        if not all((canary / name).exists() for name in required_files):
            raise OSError(errno.ENOTSUP, "delegated_controller_files_missing")
        (canary / "cpu.max").write_text(_CANARY_CPU_MAX + "\n", encoding="utf-8")
        (canary / "memory.max").write_text(_CANARY_MEMORY_MAX + "\n", encoding="utf-8")
        (canary / "pids.max").write_text(_CANARY_PIDS_MAX + "\n", encoding="utf-8")
        limits_written = (
            _read_text(canary / "cpu.max") == _CANARY_CPU_MAX
            and _read_text(canary / "memory.max") == _CANARY_MEMORY_MAX
            and _read_text(canary / "pids.max") == _CANARY_PIDS_MAX
        )

        gate_r, gate_w = os.pipe()
        child_code = (
            "import os,sys,time; fd=int(sys.argv[1]); os.read(fd,1); os.close(fd); "
            "g=os.fork(); "
            "(print(f'{os.getpid()} {g}', flush=True), time.sleep(60)) if g else time.sleep(60)"
        )
        proc = subprocess.Popen(
            [sys.executable, "-c", child_code, str(gate_r)],
            pass_fds=(gate_r,),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        os.close(gate_r)
        gate_r = -1
        (canary / "cgroup.procs").write_text(str(proc.pid) + "\n", encoding="utf-8")
        os.write(gate_w, b"1")
        os.close(gate_w)
        gate_w = -1
        if proc.stdout is None:
            raise OSError(errno.EIO, "canary_stdout_missing")
        line = proc.stdout.readline().strip()
        parts = line.split()
        if len(parts) != 2:
            raise OSError(errno.EPROTO, "canary_pid_report_invalid")
        parent_pid, grand_pid = int(parts[0]), int(parts[1])
        pfd_parent = _pidfd_open_for(parent_pid)
        pfd_grand = _pidfd_open_for(grand_pid)
        parent_contained = _pid_in_cgroup(parent_pid, expected_rel)
        grandchild_contained = _pid_in_cgroup(grand_pid, expected_rel)
        (canary / "cgroup.kill").write_text("1\n", encoding="utf-8")
        parent_dead = _pidfd_exited(pfd_parent, 3000)
        grand_dead = _pidfd_exited(pfd_grand, 3000)
        if proc.poll() is None:
            proc.wait(timeout=2)
        return {
            "created": True,
            "limits_written": limits_written,
            "cpu_max": _read_text(canary / "cpu.max"),
            "memory_max": _read_text(canary / "memory.max"),
            "pids_max": _read_text(canary / "pids.max"),
            "parent_contained": parent_contained,
            "grandchild_contained": grandchild_contained,
            "tree_killed": parent_dead and grand_dead,
            "error": None,
        }
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        if proc is not None and proc.poll() is None:
            try:
                proc.kill()
                proc.wait(timeout=2)
            except Exception:
                pass
        if grand_pid is not None:
            try:
                os.kill(grand_pid, signal.SIGKILL)
            except OSError:
                pass
        return {"created": canary.exists(), "limits_written": False, "parent_contained": False, "grandchild_contained": False, "tree_killed": False, "error": f"{type(exc).__name__}:{getattr(exc, 'errno', '')}"}
    finally:
        for fd in (pfd_parent, pfd_grand, gate_r, gate_w):
            if fd >= 0:
                try:
                    os.close(fd)
                except OSError:
                    pass
        try:
            if canary.exists():
                for _ in range(20):
                    try:
                        canary.rmdir()
                        break
                    except OSError as exc:
                        if exc.errno not in {errno.EBUSY, errno.ENOTEMPTY}:
                            break
                        time.sleep(0.05)
        except OSError:
            pass


def _network_routes() -> dict[str, Any]:
    interfaces: list[str] = []
    try:
        interfaces = sorted(item.name for item in Path("/sys/class/net").iterdir())
    except OSError:
        interfaces = []
    default_v4 = False
    try:
        lines = Path("/proc/net/route").read_text(encoding="utf-8").splitlines()[1:]
        default_v4 = any(len(line.split()) >= 3 and line.split()[1] == "00000000" and line.split()[2] != "00000000" for line in lines)
    except OSError:
        default_v4 = True
    default_v6 = False
    try:
        for line in Path("/proc/net/ipv6_route").read_text(encoding="utf-8").splitlines():
            fields = line.split()
            if len(fields) >= 10 and fields[0] == "0" * 32 and fields[1] == "00":
                default_v6 = True
                break
    except OSError:
        default_v6 = True
    isolated = _namespace_isolated(PROC_SELF_NET_NS, PROC_INIT_NET_NS)
    return {
        "network_namespace_isolated": isolated,
        "interfaces": interfaces,
        "default_ipv4_route": default_v4,
        "default_ipv6_route": default_v6,
        "default_deny_pass": isolated and not default_v4 and not default_v6,
    }


def collect(source: dict[str, str]) -> dict[str, Any]:
    source = {"git_sha": _sha40(source.get("git_sha"), "git_sha"), "tree_sha": _sha40(source.get("tree_sha"), "tree_sha")}
    status = _read_status()
    evidence = {
        "schema": SCHEMA,
        "policy_key": POLICY_KEY,
        "source": source,
        "host": {
            "os": "linux" if sys.platform.startswith("linux") else sys.platform,
            "arch": os.uname().machine.lower(),
            "effective_uid": os.geteuid(),
            "no_new_privs": status["no_new_privs"],
            "seccomp_mode": status["seccomp_mode"],
            "seccomp_filters": status["seccomp_filters"],
            "mount_namespace_isolated": _namespace_isolated(PROC_SELF_MNT_NS, PROC_INIT_MNT_NS),
        },
        "seccomp_filter_canary": _seccomp_filter_canary(),
        "pidfd_lifecycle": _pidfd_lifecycle_canary(),
        "cgroup_current": _collect_current_cgroup(),
        "cgroup_tree_canary": _cgroup_tree_kill_canary(),
        "rlimits": _collect_rlimits(),
        "workspace": _workspace_canary(),
        "network": _network_routes(),
        "authority": {
            "canonical": False,
            "authority_effect": False,
            "worker_admitted": False,
            "w1_verified": False,
            "persistence_claimed": False,
            "provider_mutation": False,
        },
    }
    evidence["evidence_sha256"] = canonical_hash(evidence)
    return evidence


def main() -> int:
    if not sys.platform.startswith("linux"):
        raise RuntimeError("linux_host_required")
    payload = json.load(sys.stdin)
    source = _validate_input(payload)
    evidence = collect(source)
    json.dump(evidence, sys.stdout, sort_keys=True, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
