#!/usr/bin/env python3
"""Non-authority shadow canary for the next W1 worker-only seccomp slice.

The production denylist is intentionally left unchanged by this file.  A child
process installs the candidate policy and then invokes every candidate syscall
through a libseccomp-resolved syscall number.  The experiment is accepted only
when the current production policy demonstrably lacks the candidates and the
candidate filter returns EPERM for every syscall on the hosted runner.
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

SCHEMA = "metaengine.compute.w1-s2-seccomp-amplifier-shadow-canary.h205f22.v1"
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
    "fsmount",
    "fspick",
    "mount_setattr",
    "pivot_root",
)


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


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


def probe_candidate_policy() -> dict[str, Any]:
    candidate = tuple(dict.fromkeys((*v1.DENIED_SYSCALLS, *CANDIDATE_SYSCALLS)))
    v1.install_seccomp_deny_policy(candidate)
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
    missing_now = [name for name in CANDIDATE_SYSCALLS if name not in v1.DENIED_SYSCALLS]
    completed = subprocess.run(
        [sys.executable, str(Path(__file__).resolve()), "--probe"],
        check=False,
        capture_output=True,
        text=True,
        timeout=20,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"candidate child failed rc={completed.returncode}: {completed.stderr[-2000:]}")
    probe = json.loads(completed.stdout)
    checks = {
        "production_policy_has_measurable_gap": set(missing_now) == set(CANDIDATE_SYSCALLS),
        "all_candidates_resolved": all(item.get("resolved") is True for item in probe.values()),
        "all_candidates_blocked_with_eperm": all(item.get("blocked_with_eperm") is True for item in probe.values()),
    }
    evidence = {
        "production_denylist_count": len(v1.DENIED_SYSCALLS),
        "candidate_syscalls": list(CANDIDATE_SYSCALLS),
        "missing_from_production": missing_now,
        "candidate_probe": probe,
        "checks": checks,
    }
    return {
        "schema": SCHEMA,
        "outcome": "ACCEPT_CANARY_SECCOMP_AMPLIFIER" if all(checks.values()) else "REJECT_OR_RESEARCH_MORE",
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
        print(json.dumps(probe_candidate_policy(), sort_keys=True))
        return 0
    result = evaluate()
    raw = json.dumps(result, sort_keys=True, indent=2) + "\n"
    if ns.output:
        ns.output.parent.mkdir(parents=True, exist_ok=True)
        ns.output.write_text(raw, encoding="utf-8")
    else:
        sys.stdout.write(raw)
    return 0 if result["outcome"] == "ACCEPT_CANARY_SECCOMP_AMPLIFIER" else 2


if __name__ == "__main__":
    raise SystemExit(main())
