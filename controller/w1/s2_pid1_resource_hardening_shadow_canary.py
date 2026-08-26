#!/usr/bin/env python3
"""Shadow canary for W1 PID1 dumpability and core-dump hardening.

Non-authority PREP only.  It does not enter provider namespaces and does not
claim persistent-worker isolation.  It verifies two narrow kernel primitives
that are candidates for the next S2 source revision:

* PR_SET_DUMPABLE=0 is accepted and observable through PR_GET_DUMPABLE.
* RLIMIT_CORE can be irreversibly reduced to zero in a disposable child.

The canary also records a conservative RLIMIT_NOFILE=4096 feasibility probe,
but that value remains shadow-only until a representative coding workload is
available. RLIMIT_NPROC is deliberately excluded because Linux accounts it by
real UID/threads rather than by the W1 workload; outer cgroup pids.max is the
preferred process-count control plane.
"""
from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import resource
import subprocess
import sys
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
V2_PATH = REPO_ROOT / "worker/native_linux/rootless_sandbox_launcher_v2.py"
SCHEMA = "metaengine.compute.w1-s2-pid1-resource-shadow-canary.h205f22.v1"
PR_GET_DUMPABLE = 3
PR_SET_DUMPABLE = 4
SUID_DUMP_DISABLE = 0
SHADOW_NOFILE_TARGET = 4096
SECRET_KEY = "W1_PID1_ENV_SECRET_CANARY"


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def child_probe() -> dict[str, Any]:
    libc = ctypes.CDLL(None, use_errno=True)
    libc.prctl.restype = ctypes.c_int
    secret_present_before = SECRET_KEY in os.environ

    if libc.prctl(ctypes.c_int(PR_SET_DUMPABLE), ctypes.c_ulong(SUID_DUMP_DISABLE), 0, 0, 0) != 0:
        err = ctypes.get_errno()
        raise OSError(err, os.strerror(err))
    dumpable = libc.prctl(ctypes.c_int(PR_GET_DUMPABLE), 0, 0, 0, 0)

    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    core = resource.getrlimit(resource.RLIMIT_CORE)

    nofile_before = resource.getrlimit(resource.RLIMIT_NOFILE)
    hard = nofile_before[1]
    target = SHADOW_NOFILE_TARGET if hard == resource.RLIM_INFINITY else min(SHADOW_NOFILE_TARGET, hard)
    nofile_probe_applied = target >= 256
    nofile_after = nofile_before
    if nofile_probe_applied:
        resource.setrlimit(resource.RLIMIT_NOFILE, (target, target))
        nofile_after = resource.getrlimit(resource.RLIMIT_NOFILE)

    # This reduces accidental inheritance/logging, but does NOT by itself
    # prove /proc/<pid>/environ secrecy because that file exposes the initial
    # exec environment. PR_SET_DUMPABLE is the access-control candidate.
    os.environ.clear()
    os.environ.update({"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"})

    return {
        "secret_present_before_live_scrub": secret_present_before,
        "secret_present_after_live_scrub": SECRET_KEY in os.environ,
        "dumpable_after": dumpable,
        "rlimit_core_after": list(core),
        "rlimit_nofile_before": list(nofile_before),
        "rlimit_nofile_shadow_target": target,
        "rlimit_nofile_shadow_probe_applied": nofile_probe_applied,
        "rlimit_nofile_after": list(nofile_after),
    }


def evaluate() -> dict[str, Any]:
    env = os.environ.copy()
    env[SECRET_KEY] = "DO_NOT_PERSIST_TEST_SECRET"
    completed = subprocess.run(
        [sys.executable, str(Path(__file__).resolve()), "--probe"],
        env=env,
        check=False,
        capture_output=True,
        text=True,
        timeout=20,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"hardening child failed rc={completed.returncode}: {completed.stderr[-2000:]}")
    probe = json.loads(completed.stdout)
    source = V2_PATH.read_text(encoding="utf-8")
    checks = {
        "current_v2_has_dumpability_gap": "PR_SET_DUMPABLE" not in source,
        "current_v2_has_core_limit_gap": "RLIMIT_CORE" not in source,
        "secret_present_before_live_scrub": probe["secret_present_before_live_scrub"] is True,
        "secret_removed_from_live_environ": probe["secret_present_after_live_scrub"] is False,
        "pr_set_dumpable_zero_verified": probe["dumpable_after"] == 0,
        "rlimit_core_zero_verified": probe["rlimit_core_after"] == [0, 0],
        "nofile_shadow_probe_safe_on_runner": (
            probe["rlimit_nofile_shadow_probe_applied"] is True
            and probe["rlimit_nofile_after"][0] == probe["rlimit_nofile_shadow_target"]
            and probe["rlimit_nofile_after"][1] == probe["rlimit_nofile_shadow_target"]
        ),
    }
    evidence = {
        "probe": probe,
        "checks": checks,
        "source_sha256": hashlib.sha256(V2_PATH.read_bytes()).hexdigest(),
        "adopt_now_candidates": ["PR_SET_DUMPABLE=0 on namespace PID1", "RLIMIT_CORE=0"],
        "keep_shadow": ["RLIMIT_NOFILE=4096 until representative coding workload"],
        "defer": ["RLIMIT_NPROC: use outer cgroup pids.max for workload-scoped process control"],
        "proc_environ_caveat": "os.environ mutation does not rewrite the initial exec environment exposed by /proc/pid/environ; dumpability/ptrace access control is the relevant PID1 fence",
    }
    required = (
        checks["current_v2_has_dumpability_gap"],
        checks["current_v2_has_core_limit_gap"],
        checks["secret_present_before_live_scrub"],
        checks["secret_removed_from_live_environ"],
        checks["pr_set_dumpable_zero_verified"],
        checks["rlimit_core_zero_verified"],
        checks["nofile_shadow_probe_safe_on_runner"],
    )
    return {
        "schema": SCHEMA,
        "outcome": "ACCEPT_CANARY_PID1_DUMPABLE_CORE" if all(required) else "REJECT_OR_RESEARCH_MORE",
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
        print(json.dumps(child_probe(), sort_keys=True))
        return 0
    result = evaluate()
    raw = json.dumps(result, sort_keys=True, indent=2) + "\n"
    if ns.output:
        ns.output.parent.mkdir(parents=True, exist_ok=True)
        ns.output.write_text(raw, encoding="utf-8")
    else:
        sys.stdout.write(raw)
    return 0 if result["outcome"] == "ACCEPT_CANARY_PID1_DUMPABLE_CORE" else 2


if __name__ == "__main__":
    raise SystemExit(main())
