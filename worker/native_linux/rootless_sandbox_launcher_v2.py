#!/usr/bin/env python3
"""S2 rootless sandbox launcher v2 for W1 PREP/review.

Non-authority execution primitive only. It never admits a worker and never
claims W1. Provider execution remains gated by a fresh aligned W1 claim and the
MB1V2 authority rules.

Composition:
  user namespace + single-ID maps -> CLONE_NEWPID -> fork dedicated namespace
  PID1 -> private mount namespace + isolated network namespace -> fresh tmpfs
  root + minimal read-only runtime binds + one read/write workspace ->
  pivot_root + detach old root + fresh /proc -> worker PID2+ with
  no_new_privs/seccomp/capability bounding-set drop -> PID1 signal forwarding,
  orphan reaping, cleanup, and worker exit propagation.

No sudo, privileged, host PID/network, seccomp-unconfined, capability-add, or
synthetic isolation fallback exists.
"""
from __future__ import annotations

import argparse
import ctypes
from dataclasses import dataclass
import os
from pathlib import Path, PurePosixPath
import platform
import resource
import shutil
import signal
import stat
import sys
import threading
import time
from typing import Sequence

try:
    from worker.native_linux import rootless_sandbox_launcher as v1
except ModuleNotFoundError as exc:
    if exc.name != "worker":
        raise
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))
    from worker.native_linux import rootless_sandbox_launcher as v1

CLONE_NEWNS = 0x00020000
CLONE_NEWPID = 0x20000000
CLONE_NEWUSER = 0x10000000
CLONE_NEWNET = 0x40000000
MS_RDONLY = 1
MS_NOSUID = 2
MS_NODEV = 4
MS_NOEXEC = 8
MS_REMOUNT = 32
MS_BIND = 4096
MS_REC = 16384
MS_PRIVATE = 1 << 18
MNT_DETACH = 2
CLOSE_RANGE_UNSHARE = 1 << 1
UINT_MAX = (1 << 32) - 1
AT_FDCWD = -100
AT_RECURSIVE = 0x8000
MOUNT_ATTR_RDONLY = 0x00000001
MOUNT_ATTR_NOSUID = 0x00000002
MOUNT_ATTR_NODEV = 0x00000004
MOUNT_ATTR_NOEXEC = 0x00000008
PR_SET_PDEATHSIG = 1
PR_GET_DUMPABLE = 3
PR_SET_DUMPABLE = 4
SUID_DUMP_DISABLE = 0
TMPFS_SIZE = "size=256M,mode=0755"
NETWORK_ISOLATION_OWNER = "LAUNCHER_CLONE_NEWNET"
PID1_ROLE = "DEDICATED_INIT_REAPER"
OLDROOT_NAME = ".oldroot"
DENIED_SYSCALLS = v1.DENIED_SYSCALLS
SandboxUnavailable = v1.SandboxUnavailable

_SYSCALL_NR = {
    "pivot_root": {
        "x86_64": 155,
        "amd64": 155,
        "aarch64": 41,
        "arm64": 41,
        "riscv64": 41,
        "ppc64le": 203,
        "s390x": 217,
    },
    "close_range": {
        arch: 436 for arch in ("x86_64", "amd64", "aarch64", "arm64", "riscv64", "ppc64le", "s390x")
    },
    "mount_setattr": {
        arch: 442 for arch in ("x86_64", "amd64", "aarch64", "arm64", "riscv64", "ppc64le", "s390x")
    },
}
_SENSITIVE_BIND_ROOTS = tuple(Path(p) for p in ("/proc", "/sys", "/dev", "/run", "/var/run"))
_SENSITIVE_WORKSPACE_ROOTS = tuple(Path(p) for p in ("/proc", "/sys", "/dev", "/run", "/var/run", "/etc", "/usr", "/opt"))
_MINIMAL_ETC_BINDS = (
    "/etc/ld.so.cache",
    "/etc/passwd",
    "/etc/group",
    "/etc/nsswitch.conf",
    "/etc/localtime",
    "/etc/ssl/certs",
    "/etc/ca-certificates",
)
FIXED_WORKER_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
PASSTHROUGH_ENV_KEYS = (
    "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TERM", "COLORTERM",
    "NO_COLOR", "FORCE_COLOR", "PYTHONUTF8", "PYTHONIOENCODING",
)
MAX_COMMAND_ARGS = 256
MAX_COMMAND_ARG_BYTES = 16 * 1024
MAX_COMMAND_BYTES = 128 * 1024
HANDLED_SIGNALS = (signal.SIGTERM, signal.SIGINT, signal.SIGHUP, signal.SIGQUIT)


@dataclass(frozen=True)
class BindSpec:
    source: Path
    target: PurePosixPath
    read_only: bool = True


class MountAttr(ctypes.Structure):
    _fields_ = (
        ("attr_set", ctypes.c_uint64),
        ("attr_clr", ctypes.c_uint64),
        ("propagation", ctypes.c_uint64),
        ("userns_fd", ctypes.c_uint64),
    )


def _libc() -> ctypes.CDLL:
    return ctypes.CDLL(None, use_errno=True)


def _raise_errno(label: str) -> None:
    err = ctypes.get_errno()
    raise SandboxUnavailable(f"{label}: {os.strerror(err)} ({err})")


def _cpath(value: str | os.PathLike[str] | None) -> ctypes.c_char_p | None:
    if value is None:
        return None
    return ctypes.c_char_p(os.fsencode(os.fspath(value)))


def _mount(source, target, fs_type, flags: int, data: str | None = None) -> None:
    libc = _libc()
    libc.mount.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_ulong, ctypes.c_void_p]
    libc.mount.restype = ctypes.c_int
    data_ptr = ctypes.c_char_p(data.encode()) if data is not None else None
    if libc.mount(_cpath(source), _cpath(target), _cpath(fs_type), ctypes.c_ulong(flags), data_ptr) != 0:
        _raise_errno(f"mount failed: {source!s} -> {target!s}")


def _umount2(target: str, flags: int) -> None:
    libc = _libc()
    libc.umount2.argtypes = [ctypes.c_char_p, ctypes.c_int]
    libc.umount2.restype = ctypes.c_int
    if libc.umount2(_cpath(target), ctypes.c_int(flags)) != 0:
        _raise_errno(f"umount2 failed: {target}")


def _unshare(flags: int, label: str) -> None:
    libc = _libc()
    libc.unshare.argtypes = [ctypes.c_int]
    libc.unshare.restype = ctypes.c_int
    if libc.unshare(ctypes.c_int(flags)) != 0:
        _raise_errno(label)


def _syscall_number(name: str) -> int:
    machine = platform.machine().lower()
    try:
        return _SYSCALL_NR[name][machine]
    except KeyError as exc:
        raise SandboxUnavailable(f"{name} unsupported architecture: {machine}") from exc


def _pivot_root(new_root: Path, put_old: Path) -> None:
    nr = _syscall_number("pivot_root")
    libc = _libc()
    libc.syscall.restype = ctypes.c_long
    if libc.syscall(ctypes.c_long(nr), _cpath(new_root), _cpath(put_old)) != 0:
        _raise_errno("pivot_root failed")


def _recursive_mount_attributes(
    target: Path,
    *,
    read_only: bool,
    no_exec: bool,
    allow_device: bool = False,
) -> None:
    attributes = MOUNT_ATTR_NOSUID
    if read_only:
        attributes |= MOUNT_ATTR_RDONLY
    if no_exec:
        attributes |= MOUNT_ATTR_NOEXEC
    if not allow_device:
        attributes |= MOUNT_ATTR_NODEV
    value = MountAttr(attr_set=attributes, attr_clr=0, propagation=0, userns_fd=0)
    rc = _libc().syscall(
        ctypes.c_long(_syscall_number("mount_setattr")),
        ctypes.c_int(AT_FDCWD),
        _cpath(target),
        ctypes.c_uint(AT_RECURSIVE),
        ctypes.byref(value),
        ctypes.sizeof(value),
    )
    if rc != 0:
        _raise_errno(f"recursive mount hardening failed: {target}")


def _is_at_or_below(path: Path, root: Path) -> bool:
    return path == root or root in path.parents


def _validate_linux_nonroot() -> tuple[int, int]:
    if not sys.platform.startswith("linux"):
        raise SandboxUnavailable("linux required")
    if os.geteuid() == 0:
        raise SandboxUnavailable("root caller forbidden")
    return os.getuid(), os.getgid()


def _validate_extra_bind(spec: BindSpec) -> BindSpec:
    if not spec.read_only:
        raise SandboxUnavailable("extra host binds must be read-only; workspace is the only read/write host bind")
    source = spec.source.resolve(strict=True)
    if source == Path("/") or any(_is_at_or_below(source, root.resolve()) for root in _SENSITIVE_BIND_ROOTS):
        raise SandboxUnavailable(f"sensitive bind source forbidden: {source}")
    if spec.target == PurePosixPath("/") or ".." in spec.target.parts or not spec.target.is_absolute():
        raise SandboxUnavailable("extra bind target must be absolute, below /, and contain no '..'")
    return BindSpec(source, spec.target, True)


def _validate_layout(workspace: Path, sandbox_root: Path) -> tuple[Path, Path]:
    workspace = workspace.resolve(strict=True)
    root = sandbox_root.resolve()
    if not workspace.is_dir():
        raise SandboxUnavailable("workspace must be a directory")
    if workspace == Path("/") or any(_is_at_or_below(workspace, sensitive.resolve()) for sensitive in _SENSITIVE_WORKSPACE_ROOTS):
        raise SandboxUnavailable(f"workspace path forbidden: {workspace}")
    if root == Path("/"):
        raise SandboxUnavailable("sandbox root may not be /")
    if _is_at_or_below(root, workspace) or _is_at_or_below(workspace, root):
        raise SandboxUnavailable("sandbox root and workspace must be disjoint")
    return workspace, root


def enter_user_namespace() -> None:
    uid, gid = _validate_linux_nonroot()
    _unshare(CLONE_NEWUSER, "unshare user namespace failed")
    v1._disable_setgroups_if_needed()
    v1._write_text("/proc/self/uid_map", f"{uid} {uid} 1\n")
    v1._write_text("/proc/self/gid_map", f"{gid} {gid} 1\n")


def prepare_pid_namespace() -> None:
    _unshare(CLONE_NEWPID, "unshare pid namespace failed")


def enter_pid1_isolation_namespaces() -> None:
    _unshare(CLONE_NEWNS, "unshare mount namespace failed")
    _mount(None, "/", None, MS_REC | MS_PRIVATE)
    _unshare(CLONE_NEWNET, "unshare network namespace failed")


def _sandbox_target(root: Path, target: PurePosixPath) -> Path:
    if not target.is_absolute() or ".." in target.parts or target == PurePosixPath("/"):
        raise ValueError("bind target must be absolute, below /, and contain no '..'")
    return root.joinpath(*target.parts[1:])


def _create_mount_target(source: Path, target: Path) -> None:
    if source.is_dir():
        target.mkdir(parents=True, exist_ok=True)
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            target.touch(mode=0o600)


def _bind_mount(spec: BindSpec, root: Path) -> None:
    source = spec.source.resolve(strict=True)
    target = _sandbox_target(root, spec.target)
    _create_mount_target(source, target)
    _mount(source, target, None, MS_BIND | (MS_REC if source.is_dir() else 0))
    allow_device = stat.S_ISCHR(source.stat().st_mode)
    if spec.read_only:
        _mount(None, target, None, MS_BIND | MS_REMOUNT | MS_RDONLY | MS_NOSUID | MS_NODEV)
    _recursive_mount_attributes(
        target,
        read_only=spec.read_only,
        no_exec=allow_device or str(spec.target).startswith("/etc/"),
        allow_device=allow_device,
    )


def _runtime_bind_specs() -> tuple[BindSpec, ...]:
    specs: list[BindSpec] = []
    for path in ("/usr", "/usr/local"):
        p = Path(path)
        if p.exists():
            specs.append(BindSpec(p, PurePosixPath(path), True))
    for path in ("/bin", "/sbin", "/lib", "/lib64"):
        p = Path(path)
        if p.exists() and not p.is_symlink():
            specs.append(BindSpec(p, PurePosixPath(path), True))
    for path in _MINIMAL_ETC_BINDS:
        p = Path(path)
        if p.exists():
            specs.append(BindSpec(p, PurePosixPath(path), True))
    for path in ("/dev/null", "/dev/zero", "/dev/random", "/dev/urandom"):
        p = Path(path)
        if p.exists() and stat.S_ISCHR(p.stat().st_mode):
            specs.append(BindSpec(p, PurePosixPath(path), False))
    return tuple(specs)


def _mirror_host_symlinks(root: Path) -> None:
    for path in ("/bin", "/sbin", "/lib", "/lib64"):
        src = Path(path)
        if not src.is_symlink():
            continue
        dst = _sandbox_target(root, PurePosixPath(path))
        dst.parent.mkdir(parents=True, exist_ok=True)
        if dst.exists() or dst.is_symlink():
            dst.unlink()
        dst.symlink_to(os.readlink(src))


def setup_sandbox_root(sandbox_root: Path, workspace: Path, extra_binds: Sequence[BindSpec]) -> None:
    workspace, root = _validate_layout(workspace, sandbox_root)
    validated_extra = tuple(_validate_extra_bind(spec) for spec in extra_binds)
    root.mkdir(mode=0o700, parents=False, exist_ok=False)
    _mount("tmpfs", root, "tmpfs", MS_NOSUID | MS_NODEV, TMPFS_SIZE)
    for path, mode in (("proc", 0o555), ("tmp", 0o1777), ("dev", 0o755)):
        target = root / path
        target.mkdir(parents=True, exist_ok=True)
        target.chmod(mode)

    binds = list(_runtime_bind_specs()) + list(validated_extra)
    binds.append(BindSpec(workspace, PurePosixPath(str(workspace)), False))
    for spec in binds:
        _bind_mount(spec, root)
    _mirror_host_symlinks(root)

    put_old = root / OLDROOT_NAME
    put_old.mkdir(mode=0o700)
    _pivot_root(root, put_old)
    os.chdir("/")
    _umount2(f"/{OLDROOT_NAME}", MNT_DETACH)
    os.rmdir(f"/{OLDROOT_NAME}")
    if Path(f"/{OLDROOT_NAME}").exists():
        raise SandboxUnavailable("old root remains visible after pivot")
    _mount("proc", "/proc", "proc", MS_NOSUID | MS_NODEV | MS_NOEXEC)
    if os.path.realpath("/proc/1/root") != "/":
        raise SandboxUnavailable("PID1 proc root is not the pivoted root")
    os.chdir(str(workspace))


def _set_parent_death_signal() -> None:
    parent = os.getppid()
    libc = _libc()
    if libc.prctl(ctypes.c_int(PR_SET_PDEATHSIG), ctypes.c_ulong(signal.SIGKILL), 0, 0, 0) != 0:
        _raise_errno("PR_SET_PDEATHSIG failed")
    if os.getppid() != parent:
        raise SandboxUnavailable("launcher parent died during PID1 setup")


def _require_pidfd_supervision() -> None:
    if not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
        raise SandboxUnavailable("pidfd supervision APIs unavailable")
    if threading.current_thread() is not threading.main_thread() or threading.active_count() != 1:
        raise SandboxUnavailable("launcher requires a single main thread for fork and child reaping")
    if signal.getsignal(signal.SIGCHLD) != signal.SIG_DFL:
        raise SandboxUnavailable("default SIGCHLD disposition required for pidfd supervision")
    # Reinstall SIG_DFL to clear any hidden SA_NOCLDWAIT inherited from a
    # non-Python caller before fork()+pidfd_open().
    signal.signal(signal.SIGCHLD, signal.SIG_DFL)


def _open_pidfd(pid: int) -> int:
    try:
        return os.pidfd_open(pid, 0)
    except OSError as exc:
        raise SandboxUnavailable(f"pidfd_open failed for namespace PID1: {exc}") from exc


def _forward_pidfd_signal(pidfd: int, signum: int) -> None:
    try:
        signal.pidfd_send_signal(pidfd, signum, None, 0)
    except ProcessLookupError:
        return


def _reap_exact_child(pid: int) -> None:
    while True:
        try:
            waited, _ = os.waitpid(pid, 0)
        except InterruptedError:
            continue
        except ChildProcessError:
            return
        if waited == pid:
            return


def _abort_child_without_pidfd(pid: int) -> None:
    # The exact child is still owned and unreaped here, so its numeric PID
    # cannot have been recycled. This path exists only when pidfd_open fails.
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    _reap_exact_child(pid)


def _validated_command(argv: Sequence[str]) -> tuple[str, ...]:
    if not argv:
        raise ValueError("worker command required")
    if len(argv) > MAX_COMMAND_ARGS:
        raise ValueError("worker command has too many arguments")
    values: list[str] = []
    total = 0
    for value in argv:
        if not isinstance(value, str) or not value or "\x00" in value:
            raise ValueError("worker command contains an invalid argument")
        size = len(os.fsencode(value))
        if size > MAX_COMMAND_ARG_BYTES:
            raise ValueError("worker command argument is too large")
        total += size + 1
        values.append(value)
    if total > MAX_COMMAND_BYTES:
        raise ValueError("worker command is too large")
    if not Path(values[0]).is_absolute():
        resolved = shutil.which(values[0], path=FIXED_WORKER_PATH)
        if resolved is None:
            raise ValueError("worker executable is not in the fixed launcher PATH")
        values[0] = resolved
    return tuple(values)


def _worker_environment(workspace: Path, source: dict[str, str] | None = None) -> dict[str, str]:
    incoming = os.environ if source is None else source
    result = {
        "PATH": FIXED_WORKER_PATH,
        "HOME": str(workspace),
        "PWD": str(workspace),
        "TMPDIR": "/tmp",
        "GITHUB_WORKSPACE": str(workspace),
        "USER": "w1-worker",
        "LOGNAME": "w1-worker",
    }
    for key in PASSTHROUGH_ENV_KEYS:
        value = incoming.get(key)
        if value is None:
            continue
        if not isinstance(value, str) or "\x00" in value or len(value) > 1024:
            raise SandboxUnavailable(f"invalid environment value for {key}")
        result[key] = value
    return result


def _harden_pid1_runtime(workspace: Path) -> None:
    """Protect inherited launcher state before PID1 forks the worker."""
    libc = _libc()
    if libc.prctl(ctypes.c_int(PR_SET_DUMPABLE), ctypes.c_ulong(SUID_DUMP_DISABLE), 0, 0, 0) != 0:
        _raise_errno("PR_SET_DUMPABLE failed")
    if libc.prctl(ctypes.c_int(PR_GET_DUMPABLE), 0, 0, 0, 0) != SUID_DUMP_DISABLE:
        raise SandboxUnavailable("PID1 dumpability fence did not persist")
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    if resource.getrlimit(resource.RLIMIT_CORE) != (0, 0):
        raise SandboxUnavailable("PID1 core-dump limit did not persist")

    # /proc/<pid>/environ exposes the initial exec environment, so live Python
    # environment mutation alone is not the secrecy boundary. The dumpability
    # fence above controls ptrace-governed access; this scrub additionally
    # prevents future child inheritance and accidental logging of launch env.
    sanitized = _worker_environment(workspace)
    os.environ.clear()
    os.environ.update(sanitized)


def _close_inherited_fds() -> None:
    rc = _libc().syscall(
        ctypes.c_long(_syscall_number("close_range")),
        ctypes.c_uint(3),
        ctypes.c_uint(UINT_MAX),
        ctypes.c_uint(CLOSE_RANGE_UNSHARE),
    )
    if rc != 0:
        _raise_errno("close_range inherited descriptors failed")


def _decode_wait_status(status: int) -> int:
    if os.WIFEXITED(status):
        return os.WEXITSTATUS(status)
    if os.WIFSIGNALED(status):
        return 128 + os.WTERMSIG(status)
    return 125


def _outer_wait(pid1: int, pidfd: int, original_mask: set[signal.Signals]) -> int:
    previous = {}
    def handler(signum: int, _frame: object) -> None:
        _forward_pidfd_signal(pidfd, signum)
    for sig in HANDLED_SIGNALS:
        previous[sig] = signal.signal(sig, handler)
    signal.pthread_sigmask(signal.SIG_SETMASK, original_mask)
    try:
        while True:
            try:
                waited, status = os.waitpid(pid1, 0)
            except InterruptedError:
                continue
            if waited == pid1:
                return _decode_wait_status(status)
    finally:
        for sig, old in previous.items():
            signal.signal(sig, old)


def _terminate_worker_group(worker_pid: int, grace_seconds: float = 1.0) -> None:
    for signum in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(worker_pid, signum)
        except ProcessLookupError:
            return
        deadline = time.monotonic() + grace_seconds
        while time.monotonic() < deadline:
            try:
                got, _ = os.waitpid(-1, os.WNOHANG)
            except ChildProcessError:
                return
            if got == 0:
                time.sleep(0.02)


def _pid1_reaper(argv: Sequence[str], workspace: Path, original_mask: set[signal.Signals]) -> int:
    worker_pid: int | None = None
    group_ready = False
    pending_signals: list[int] = []

    def handler(signum: int, _frame: object) -> None:
        if worker_pid is None or not group_ready:
            pending_signals.append(signum)
            return
        try:
            os.killpg(worker_pid, signum)
        except ProcessLookupError:
            pass

    for sig in HANDLED_SIGNALS:
        signal.signal(sig, handler)
    signal.pthread_sigmask(signal.SIG_SETMASK, original_mask)

    ready_r, ready_w = os.pipe2(os.O_CLOEXEC)
    worker_pid = os.fork()
    if worker_pid == 0:
        os.close(ready_r)
        os.setsid()
        os.write(ready_w, b"1")
        os.close(ready_w)
        v1.set_no_new_privs()
        v1.install_seccomp_deny_policy(DENIED_SYSCALLS)
        v1.drop_capability_bounding_set()
        environment = _worker_environment(workspace)
        os.umask(0o077)
        _close_inherited_fds()
        os.execve(argv[0], list(argv), environment)
        raise AssertionError("execve returned")

    os.close(ready_w)
    try:
        ready = os.read(ready_r, 1)
    finally:
        os.close(ready_r)
    if ready != b"1":
        raise SandboxUnavailable("worker process group failed to initialize")
    group_ready = True
    for signum in pending_signals:
        try:
            os.killpg(worker_pid, signum)
        except ProcessLookupError:
            break

    main_status: int | None = None
    while main_status is None:
        try:
            pid, status = os.waitpid(-1, 0)
        except InterruptedError:
            continue
        except ChildProcessError:
            raise SandboxUnavailable("PID1 lost worker before exit status")
        if pid == worker_pid:
            main_status = status

    _terminate_worker_group(worker_pid)
    while True:
        try:
            pid, _ = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            break
        if pid == 0:
            break
    return _decode_wait_status(main_status)


def launch(argv: Sequence[str], *, workspace: Path, sandbox_root: Path, extra_binds: Sequence[BindSpec] = ()) -> int:
    argv = _validated_command(argv)
    workspace, sandbox_root = _validate_layout(workspace, sandbox_root)
    if sandbox_root.exists() or sandbox_root.is_symlink():
        raise SandboxUnavailable("sandbox root must not exist before launch")
    _require_pidfd_supervision()
    enter_user_namespace()
    prepare_pid_namespace()
    original_mask = signal.pthread_sigmask(signal.SIG_BLOCK, HANDLED_SIGNALS)
    try:
        pid1 = os.fork()
    except BaseException:
        signal.pthread_sigmask(signal.SIG_SETMASK, original_mask)
        raise
    if pid1 != 0:
        try:
            pidfd = _open_pidfd(pid1)
        except BaseException:
            _abort_child_without_pidfd(pid1)
            signal.pthread_sigmask(signal.SIG_SETMASK, original_mask)
            try:
                sandbox_root.rmdir()
            except FileNotFoundError:
                pass
            raise
        try:
            try:
                return _outer_wait(pid1, pidfd, original_mask)
            except BaseException:
                _forward_pidfd_signal(pidfd, signal.SIGKILL)
                _reap_exact_child(pid1)
                raise
        finally:
            os.close(pidfd)
            try:
                sandbox_root.rmdir()
            except FileNotFoundError:
                pass
    if os.getpid() != 1:
        raise SandboxUnavailable(f"namespace init expected pid 1, got {os.getpid()}")
    _set_parent_death_signal()
    enter_pid1_isolation_namespaces()
    setup_sandbox_root(sandbox_root, workspace, extra_binds)
    _harden_pid1_runtime(workspace)
    return _pid1_reaper(argv, workspace, original_mask)


def _parse_bind(raw: str) -> BindSpec:
    parts = raw.rsplit(":", 2)
    if len(parts) not in (2, 3):
        raise argparse.ArgumentTypeError("bind must be SOURCE:TARGET[:ro]")
    source_raw, target_raw = parts[0], parts[1]
    mode = parts[2] if len(parts) == 3 else "ro"
    if mode != "ro":
        raise argparse.ArgumentTypeError("extra binds are read-only; workspace is the only read/write host bind")
    source = Path(source_raw)
    target = PurePosixPath(target_raw)
    if not source.is_absolute() or not target.is_absolute() or ".." in target.parts or target == PurePosixPath("/"):
        raise argparse.ArgumentTypeError("bind source/target must be absolute and target must be below /")
    try:
        return _validate_extra_bind(BindSpec(source, target, True))
    except (SandboxUnavailable, OSError) as exc:
        raise argparse.ArgumentTypeError(str(exc)) from exc


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="W1 S2 rootless sandbox launcher v2 (PREP/non-authority)")
    p.add_argument("--workspace", type=Path, default=Path.cwd())
    p.add_argument("--sandbox-root", type=Path, default=Path(f"/tmp/metaengine-w1-s2-{os.getpid()}"))
    p.add_argument("--bind", action="append", default=[], type=_parse_bind, dest="binds")
    p.add_argument("command", nargs=argparse.REMAINDER)
    return p


def main() -> int:
    ns = _parser().parse_args()
    command = list(ns.command)
    if command[:1] == ["--"]:
        command = command[1:]
    if not command:
        print("worker command required", file=sys.stderr)
        return 64
    try:
        return launch(command, workspace=ns.workspace, sandbox_root=ns.sandbox_root, extra_binds=ns.binds)
    except (SandboxUnavailable, OSError, ValueError) as exc:
        print(f"W1_S2_SANDBOX_UNAVAILABLE: {exc}", file=sys.stderr)
        return 78


if __name__ == "__main__":
    raise SystemExit(main())
