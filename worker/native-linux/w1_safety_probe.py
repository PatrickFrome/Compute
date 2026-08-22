#!/usr/bin/env python3
import argparse
import ctypes
import errno
import hashlib
import json
import os
import platform
import resource
import signal
import subprocess
import tempfile
import textwrap
import time
from pathlib import Path

POLICY_SHA256 = "3dba3ce69e945e52ff1a2ab23e2981dd543296c72f229673bcc44c94c9e70122"
REQUIRED_CONTROLLERS = {"cpu", "memory", "pids"}


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def read_text(path: str, default: str = "") -> str:
    try:
        return Path(path).read_text().strip()
    except OSError:
        return default


def readlink_observation(path: str) -> dict:
    try:
        return {"accessible": True, "target": os.readlink(path), "errno": None}
    except OSError as exc:
        return {"accessible": False, "target": "", "errno": exc.errno}


def memory_bytes() -> int:
    for line in read_text("/proc/meminfo").splitlines():
        if line.startswith("MemTotal:"):
            return int(line.split()[1]) * 1024
    return 0


def proc_status() -> dict[str, str]:
    out = {}
    for line in read_text("/proc/self/status").splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            out[k] = v.strip()
    return out


def current_cgroup_path() -> Path:
    for line in read_text("/proc/self/cgroup").splitlines():
        parts = line.split(":", 2)
        if len(parts) == 3 and parts[0] == "0":
            return Path("/sys/fs/cgroup") / parts[2].lstrip("/")
    return Path("/sys/fs/cgroup")


def openat2_runtime_canary() -> dict:
    if platform.machine() not in {"x86_64", "aarch64", "arm64", "riscv64"}:
        return {"pass": False, "reason": "unsupported_arch"}
    libc = ctypes.CDLL(None, use_errno=True)
    class OpenHow(ctypes.Structure):
        _fields_ = [("flags", ctypes.c_uint64), ("mode", ctypes.c_uint64), ("resolve", ctypes.c_uint64)]
    O_PATH = getattr(os, "O_PATH", 0o10000000)
    RESOLVE_NO_MAGICLINKS = 0x02
    RESOLVE_BENEATH = 0x08
    with tempfile.TemporaryDirectory(prefix="w1-openat2-runtime-") as td:
        root = Path(td)
        (root / "inside").mkdir()
        (root / "inside" / "ok").write_text("ok")
        (root / "escape").symlink_to("/etc/passwd")
        dfd = os.open(str(root), O_PATH | os.O_DIRECTORY)
        try:
            how = OpenHow(os.O_RDONLY | os.O_CLOEXEC, 0, RESOLVE_BENEATH | RESOLVE_NO_MAGICLINKS)
            good = libc.syscall(437, dfd, ctypes.c_char_p(b"inside/ok"), ctypes.byref(how), ctypes.sizeof(how))
            if good < 0:
                return {"pass": False, "reason": "inside_open_failed", "errno": ctypes.get_errno()}
            os.close(good)
            ctypes.set_errno(0)
            bad = libc.syscall(437, dfd, ctypes.c_char_p(b"escape"), ctypes.byref(how), ctypes.sizeof(how))
            saved = ctypes.get_errno()
            if bad >= 0:
                os.close(bad)
                return {"pass": False, "reason": "escape_opened"}
            return {"pass": saved in (errno.EXDEV, errno.ELOOP, errno.ENOENT), "escape_errno": saved}
        finally:
            os.close(dfd)


def pidfd_canary() -> dict:
    if not hasattr(os, "pidfd_open") or not hasattr(os, "P_PIDFD"):
        return {"pass": False, "reason": "python_pidfd_api_missing"}
    child = subprocess.Popen(["/bin/sh", "-c", "trap 'exit 0' TERM; sleep 30"])
    fd = None
    try:
        fd = os.pidfd_open(child.pid, 0)
        if hasattr(signal, "pidfd_send_signal"):
            signal.pidfd_send_signal(fd, signal.SIGTERM, None, 0)
        else:
            os.kill(child.pid, signal.SIGTERM)
        info = os.waitid(os.P_PIDFD, fd, os.WEXITED)
        return {
            "pass": info is not None,
            "pidfd_open": True,
            "send_signal": True,
            "waitid": info is not None,
            "si_code": getattr(info, "si_code", None),
            "fallback_signal_api": not hasattr(signal, "pidfd_send_signal"),
        }
    except Exception as exc:
        try:
            child.kill()
            child.wait(timeout=5)
        except Exception:
            pass
        return {"pass": False, "reason": type(exc).__name__, "detail": str(exc)[:240]}
    finally:
        if fd is not None:
            os.close(fd)


def rlimit_canaries() -> dict:
    nofile_code = r'''
import errno, os, resource
resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))
fds=[]
try:
    for _ in range(128):
        fds.append(os.open('/dev/null', os.O_RDONLY))
except OSError as e:
    raise SystemExit(0 if e.errno == errno.EMFILE else 3)
raise SystemExit(4)
'''
    fsize_code = r'''
import os, resource, signal, tempfile
signal.signal(signal.SIGXFSZ, signal.SIG_IGN)
resource.setrlimit(resource.RLIMIT_FSIZE, (1024, 1024))
fd, p = tempfile.mkstemp()
try:
    try:
        written = os.write(fd, b'x' * 65536)
        size = os.fstat(fd).st_size
        raise SystemExit(0 if written <= 1024 and size <= 1024 else 5)
    except OSError:
        raise SystemExit(0)
finally:
    try: os.close(fd)
    except OSError: pass
    try: os.unlink(p)
    except OSError: pass
'''
    n = subprocess.run(["python3", "-c", nofile_code], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    f = subprocess.run(["python3", "-c", fsize_code], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return {
        "pass": n.returncode == 0 and f.returncode == 0,
        "nofile_fail_closed": n.returncode == 0,
        "fsize_fail_closed": f.returncode == 0,
        "configured": {
            "nofile": resource.getrlimit(resource.RLIMIT_NOFILE),
            "nproc": resource.getrlimit(resource.RLIMIT_NPROC),
            "fsize": resource.getrlimit(resource.RLIMIT_FSIZE),
            "address_space": resource.getrlimit(resource.RLIMIT_AS),
            "cpu": resource.getrlimit(resource.RLIMIT_CPU),
        },
    }


SECCOMP_C = r'''
#define _GNU_SOURCE
#include <errno.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>

#if defined(__x86_64__)
#define EXPECTED_ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
#define EXPECTED_ARCH AUDIT_ARCH_AARCH64
#else
#error unsupported_arch
#endif

int main(void) {
  struct sock_filter f[] = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, EXPECTED_ARCH, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_getppid, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA)),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
  };
  struct sock_fprog prog = { .len = (unsigned short)(sizeof(f)/sizeof(f[0])), .filter = f };
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) return 10;
  if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &prog) != 0) return 11;
  errno = 0;
  long r = syscall(__NR_getppid);
  if (r != -1 || errno != EPERM) return 12;
  puts("SECCOMP_FAIL_CLOSED_PASS");
  return 0;
}
'''

OPENAT2_C = r'''
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/openat2.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

int main(void) {
  char root[] = "/tmp/w1-openat2-XXXXXX";
  if (!mkdtemp(root)) return 20;
  char inside[512], ok[512], escape[512];
  snprintf(inside, sizeof(inside), "%s/inside", root);
  snprintf(ok, sizeof(ok), "%s/inside/ok", root);
  snprintf(escape, sizeof(escape), "%s/escape", root);
  if (mkdir(inside, 0700) != 0) return 21;
  int f = open(ok, O_CREAT|O_WRONLY|O_CLOEXEC, 0600); if (f < 0) return 22; close(f);
  if (symlink("/etc/passwd", escape) != 0) return 23;
  int dfd = open(root, O_PATH|O_DIRECTORY|O_CLOEXEC); if (dfd < 0) return 24;
  struct open_how how = { .flags = O_RDONLY|O_CLOEXEC, .resolve = RESOLVE_BENEATH|RESOLVE_NO_MAGICLINKS };
  int good = syscall(SYS_openat2, dfd, "inside/ok", &how, sizeof(how));
  if (good < 0) return 25;
  close(good);
  errno = 0;
  int bad = syscall(SYS_openat2, dfd, "escape", &how, sizeof(how));
  int saved = errno;
  close(dfd); unlink(escape); unlink(ok); rmdir(inside); rmdir(root);
  if (bad >= 0) { close(bad); return 26; }
  if (!(saved == EXDEV || saved == ELOOP || saved == ENOENT)) return 27;
  puts("OPENAT2_BENEATH_PASS");
  return 0;
}
'''


def compile_and_run(name: str, source: str) -> dict:
    cc = next((x for x in ("cc", "gcc", "clang") if subprocess.run(["/usr/bin/env", "sh", "-c", f"command -v {x}"], stdout=subprocess.DEVNULL).returncode == 0), None)
    if not cc:
        return {"pass": False, "reason": "c_compiler_missing"}
    with tempfile.TemporaryDirectory(prefix=f"w1-{name}-") as td:
        src = Path(td) / f"{name}.c"
        exe = Path(td) / name
        src.write_text(source)
        build = subprocess.run([cc, "-O2", "-Wall", "-Wextra", "-Werror", str(src), "-o", str(exe)], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if build.returncode != 0:
            return {"pass": False, "reason": "compile_failed", "stderr": build.stderr[-1000:]}
        run = subprocess.run([str(exe)], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return {"pass": run.returncode == 0, "returncode": run.returncode, "stdout": run.stdout.strip(), "stderr": run.stderr[-500:]}


def gather(mode: str) -> dict:
    status = proc_status()
    cg = current_cgroup_path()
    controllers = set(read_text("/sys/fs/cgroup/cgroup.controllers").split())
    mnt_self = readlink_observation("/proc/self/ns/mnt")
    mnt_init = readlink_observation("/proc/1/ns/mnt")
    init_hidden_by_hardening = (
        mnt_self["accessible"]
        and not mnt_init["accessible"]
        and mnt_init["errno"] in (errno.EACCES, errno.EPERM)
    )
    isolated_from_init = (
        mnt_self["accessible"]
        and (
            init_hidden_by_hardening
            or (mnt_init["accessible"] and mnt_self["target"] != mnt_init["target"])
        )
    )
    machine_id = read_text("/etc/machine-id")
    boot_id = read_text("/proc/sys/kernel/random/boot_id")
    base = {
        "schema": "metaengine.compute.w1-linux-host-probe.h205f22.v1",
        "classification": os.getenv("METAENGINE_EVIDENCE_CLASSIFICATION", "UNCLASSIFIED"),
        "persistent_worker_proof": os.getenv("METAENGINE_PERSISTENT_WORKER_PROOF", "false").lower() == "true",
        "policy_key": "linux-h1-h13-v1",
        "policy_sha256": POLICY_SHA256,
        "observed_at_unix_ns": time.time_ns(),
        "host": {
            "os": platform.system().lower(),
            "kernel_release": platform.release(),
            "arch": platform.machine(),
            "cpu_logical": os.cpu_count() or 0,
            "memory_bytes": memory_bytes(),
            "machine_id_sha256": sha256_text(machine_id) if machine_id else None,
            "boot_id_sha256": sha256_text(boot_id) if boot_id else None,
        },
        "identity": {
            "uid": os.getuid(), "euid": os.geteuid(), "gid": os.getgid(),
            "effective_uid_nonzero": os.geteuid() != 0,
        },
        "no_new_privs": status.get("NoNewPrivs") == "1",
        "seccomp_runtime_mode": int(status.get("Seccomp", "0") or "0"),
        "seccomp_policy_sha256": os.getenv("METAENGINE_SECCOMP_POLICY_SHA256", ""),
        "cgroup_v2": {
            "mounted": Path("/sys/fs/cgroup/cgroup.controllers").exists(),
            "controllers": sorted(controllers),
            "required_controllers_present": REQUIRED_CONTROLLERS.issubset(controllers),
            "current_path": str(cg),
            "kill_supported": (cg / "cgroup.kill").exists(),
        },
        "mount_namespace": {
            "self": mnt_self["target"],
            "self_accessible": mnt_self["accessible"],
            "self_errno": mnt_self["errno"],
            "init": mnt_init["target"],
            "init_accessible": mnt_init["accessible"],
            "init_errno": mnt_init["errno"],
            "init_hidden_by_hardening": init_hidden_by_hardening,
            "isolated_from_init": isolated_from_init,
        },
    }
    base["workspace_openat2_runtime"] = openat2_runtime_canary()
    if mode == "full":
        base["pidfd"] = pidfd_canary()
        base["rlimits"] = rlimit_canaries()
        base["seccomp_filter_canary"] = compile_and_run("seccomp_canary", SECCOMP_C)
        base["workspace_openat2_canary"] = compile_and_run("openat2_canary", OPENAT2_C)
    else:
        base["pidfd"] = pidfd_canary()
        base["rlimits"] = {"configured": {
            "nofile": resource.getrlimit(resource.RLIMIT_NOFILE),
            "nproc": resource.getrlimit(resource.RLIMIT_NPROC),
            "fsize": resource.getrlimit(resource.RLIMIT_FSIZE),
            "address_space": resource.getrlimit(resource.RLIMIT_AS),
            "cpu": resource.getrlimit(resource.RLIMIT_CPU),
        }}
    configured_limits = base["rlimits"]["configured"]
    def finite_at_least(pair, minimum):
        soft = int(pair[0])
        return soft != resource.RLIM_INFINITY and soft >= minimum
    limits_satisfy = (
        finite_at_least(configured_limits["nofile"], 64)
        and finite_at_least(configured_limits["nproc"], 16)
        and finite_at_least(configured_limits["fsize"], 1)
        and finite_at_least(configured_limits["address_space"], 268435456)
        and finite_at_least(configured_limits["cpu"], 1)
    )
    base["rlimits"]["policy_floor_satisfied"] = limits_satisfy
    checks = {
        "linux": base["host"]["os"] == "linux",
        "rootless": base["identity"]["effective_uid_nonzero"],
        "no_new_privs": base["no_new_privs"],
        "cgroup_v2": base["cgroup_v2"]["mounted"] and base["cgroup_v2"]["required_controllers_present"] and base["cgroup_v2"]["kill_supported"],
        "mount_namespace": base["mount_namespace"]["isolated_from_init"],
        "pidfd": bool(base.get("pidfd", {}).get("pass")),
        "seccomp_runtime": base["seccomp_runtime_mode"] == 2,
        "seccomp_policy_digest": len(base["seccomp_policy_sha256"]) == 64 and all(c in "0123456789abcdef" for c in base["seccomp_policy_sha256"].lower()),
        "openat2_runtime": bool(base["workspace_openat2_runtime"].get("pass")),
        "rlimit_policy_floor": limits_satisfy,
    }
    if mode == "full":
        checks.update({
            "rlimit_negative": bool(base["rlimits"].get("pass")),
            "seccomp_negative": bool(base["seccomp_filter_canary"].get("pass")),
            "openat2_negative": bool(base["workspace_openat2_canary"].get("pass")),
        })
    base["checks"] = checks
    base["pass"] = all(checks.values())
    return base


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=("full", "runtime"), default="full")
    args = ap.parse_args()
    doc = gather(args.mode)
    encoded = json.dumps(doc, sort_keys=True, separators=(",", ":"))
    print(encoded)
    return 0 if doc["pass"] else 2

if __name__ == "__main__":
    raise SystemExit(main())