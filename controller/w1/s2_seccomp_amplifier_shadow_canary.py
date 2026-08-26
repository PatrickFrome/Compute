#!/usr/bin/env python3
"""Non-authority regression canary for the adopted W1 worker seccomp slice.

The earlier v1 canary proved the production policy had a measurable gap and
that all proposed rules returned EPERM on GitHub-hosted Linux.  After adoption,
this v2 receipt verifies the exact integrated policy and emits a composite S2
runtime identity over both the v1 policy source and v2 launcher source.  This
prevents the v2 launcher SHA alone from hiding an imported-policy change.
"""
from __future__ import annotations

import argparse
import ctypes
import ctypes.util
import errno
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from worker.native_linux import rootless_sandbox_launcher as v1
from worker.native_linux import rootless_sandbox_launcher_v2 as s2

SCHEMA = "metaengine.compute.w1-s2-seccomp-amplifier-regression.h205f22.v2"
CANDIDATE_SYSCALLS = (
    "process_vm_readv",
    "process_vm_writev",
    "kcmp",
    "io_uring_setup",
    "io_uring_enter",
    "io_uring_register",
    "open_tree",
    "move_mount",
    "fsopen",
    "fsconfig",
    "fsmount",
    "fspick",
    "mount_setattr",
    "pivot_root",
)
V1_PATH = REPO_ROOT / "worker/native_linux/rootless_sandbox_launcher.py"
V2_PATH = REPO_ROOT / "worker/native_linux/rootless_sandbox_launcher_v2.py"


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _resolver() -> tuple[ctypes.CDLL, ctypes.CDLL]:
    name = ctypes.util.find_library("seccomp")
    if not name:
        raise RuntimeError("libseccomp unavailable")
    sec = ctypes.CDLL(name, use_errno=True)
    sec.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    sec.seccomp_syscall_resolve_name.restype = ctypes.c_int
    libc = ctypes.CDLL(None, use_errno=True)
    libc.syscall.restype = ctypes.c_long
    return sec, libc


def probe_production_policy() -> dict[str, Any]:
    s2.v1.install_seccomp_deny_policy(s2.DENIED_SYSCALLS)
    sec, libc = _resolver()
    results: dict[str, Any] = {}
    for name in CANDIDATE_SYSCALLS:
        nr = sec.seccomp_syscall_resolve_name(name.encode("ascii"))
        if nr < 0:
            results[name] = {"resolved": False, "nr": nr, "rc": None, "errno": None}
            continue
        ctypes.set_errno(0)
        rc = libc.syscall(
            ctypes.c_long(nr),
            ctypes.c_ulong(0), ctypes.c_ulong(0), ctypes.c_ulong(0),
            ctypes.c_ulong(0), ctypes.c_ulong(0), ctypes.c_ulong(0),
        )
        err = ctypes.get_errno()
        results[name] = {
            "resolved": True,
            "nr": nr,
            "rc": int(rc),
            "errno": int(err),
            "blocked_with_eperm": rc == -1 and err == errno.EPERM,
        }
    return results


def evaluate() -> dict[str, Any]:
    missing = [name for name in CANDIDATE_SYSCALLS if name not in s2.DENIED_SYSCALLS]
    completed = subprocess.run(
        [sys.executable, str(Path(__file__).resolve()), "--probe"],
        check=False,
        capture_output=True,
        text=True,
        timeout=20,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"production-policy child failed rc={completed.returncode}: {completed.stderr[-2000:]}")
    probe = json.loads(completed.stdout)
    source_identity = {
        "v1_policy_path": str(V1_PATH.relative_to(REPO_ROOT)),
        "v1_policy_sha256": file_sha256(V1_PATH),
        "v2_launcher_path": str(V2_PATH.relative_to(REPO_ROOT)),
        "v2_launcher_sha256": file_sha256(V2_PATH),
    }
    runtime_identity = {
        **source_identity,
        "effective_denylist": list(s2.DENIED_SYSCALLS),
    }
    checks = {
        "all_adopted_syscalls_present": not missing,
        "all_candidates_resolved": all(item.get("resolved") is True for item in probe.values()),
        "all_candidates_blocked_with_eperm": all(item.get("blocked_with_eperm") is True for item in probe.values()),
        "v2_imports_exact_v1_policy": tuple(s2.DENIED_SYSCALLS) == tuple(v1.DENIED_SYSCALLS),
    }
    evidence = {
        "production_denylist_count": len(s2.DENIED_SYSCALLS),
        "adopted_syscalls": list(CANDIDATE_SYSCALLS),
        "missing_from_production": missing,
        "production_probe": probe,
        "source_identity": source_identity,
        "s2_runtime_identity_sha256": canonical_hash(runtime_identity),
        "checks": checks,
    }
    return {
        "schema": SCHEMA,
        "outcome": "ACCEPT_ADOPTED_SECCOMP_REGRESSION" if all(checks.values()) else "REGRESSION_BLOCKED",
        "evidence": evidence,
        "evidence_sha256": canonical_hash(evidence),
        "runtime_isolation_verified": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--output", type=Path)
    ns = parser.parse_args()
    if ns.probe:
        print(json.dumps(probe_production_policy(), sort_keys=True))
        return 0
    result = evaluate()
    raw = json.dumps(result, sort_keys=True, indent=2) + "\n"
    if ns.output:
        ns.output.parent.mkdir(parents=True, exist_ok=True)
        ns.output.write_text(raw, encoding="utf-8")
    else:
        sys.stdout.write(raw)
    return 0 if result["outcome"] == "ACCEPT_ADOPTED_SECCOMP_REGRESSION" else 2


if __name__ == "__main__":
    raise SystemExit(main())
