#!/usr/bin/env python3
"""Regression canary for adopted W1 PID1 dumpability/core hardening.

Non-authority PREP only. It verifies both the exact integrated S2 source
composition and the underlying Linux primitives.

RLIMIT_NOFILE=4096 remains a SHADOW measurement, not an adopted safety gate.
Host-dependent NOFILE values are therefore emitted in a separately hashed
``environment`` block and are intentionally excluded from ``evidence_sha256``
and the adopted verdict. RLIMIT_NPROC remains deferred to outer cgroup pids.max.
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
SCHEMA = "metaengine.compute.w1-s2-pid1-resource-regression.h205f22.v3"
PR_GET_DUMPABLE = 3
PR_SET_DUMPABLE = 4
SUID_DUMP_DISABLE = 0
SHADOW_NOFILE_TARGET = 4096
SECRET_KEY = "W1_PID1_ENV_SECRET_CANARY"

ADOPTED_PROBE_FIELDS = (
    "secret_present_before_live_scrub",
    "secret_present_after_live_scrub",
    "dumpable_after",
    "rlimit_core_after",
)
ENVIRONMENT_PROBE_FIELDS = (
    "rlimit_nofile_before",
    "rlimit_nofile_shadow_target",
    "rlimit_nofile_shadow_probe_applied",
    "rlimit_nofile_after",
)


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

    # Shadow-only observation. The host hard limit is outside this canary's
    # adopted contract and must never change the adopted verdict/evidence hash.
    nofile_before = resource.getrlimit(resource.RLIMIT_NOFILE)
    hard = nofile_before[1]
    target = SHADOW_NOFILE_TARGET if hard == resource.RLIM_INFINITY else min(SHADOW_NOFILE_TARGET, hard)
    nofile_probe_applied = target >= 256
    nofile_after = nofile_before
    if nofile_probe_applied:
        resource.setrlimit(resource.RLIMIT_NOFILE, (target, target))
        nofile_after = resource.getrlimit(resource.RLIMIT_NOFILE)

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


def compose(probe: dict[str, Any], source: str, source_sha256: str) -> dict[str, Any]:
    missing = [key for key in ADOPTED_PROBE_FIELDS + ENVIRONMENT_PROBE_FIELDS if key not in probe]
    if missing:
        raise ValueError("missing probe fields: " + ",".join(missing))

    harden_pos = source.find("_harden_pid1_runtime(workspace)")
    reaper_pos = source.find("return _pid1_reaper(argv, workspace, original_mask)")
    deterministic_probe = {key: probe[key] for key in ADOPTED_PROBE_FIELDS}

    nofile_target = probe["rlimit_nofile_shadow_target"]
    nofile_after = probe["rlimit_nofile_after"]
    shadow_target_reached = (
        probe["rlimit_nofile_shadow_probe_applied"] is True
        and isinstance(nofile_after, list)
        and len(nofile_after) == 2
        and nofile_after[0] == nofile_target
        and nofile_after[1] == nofile_target
    )
    environment = {
        key: probe[key] for key in ENVIRONMENT_PROBE_FIELDS
    }
    environment["nofile_shadow_target_reached"] = shadow_target_reached
    environment["classification"] = "HOST_DEPENDENT_SHADOW_OBSERVATION_NONAUTHORITY"

    # Only adopted, host-independent properties may gate the adopted verdict.
    checks = {
        "integrated_dumpability_fence_present": all(token in source for token in (
            "PR_SET_DUMPABLE", "PR_GET_DUMPABLE", "SUID_DUMP_DISABLE", "_harden_pid1_runtime"
        )),
        "integrated_core_limit_present": "resource.setrlimit(resource.RLIMIT_CORE, (0, 0))" in source,
        "integrated_live_environment_scrub_present": "os.environ.clear()" in source and "os.environ.update(sanitized)" in source,
        "hardening_runs_before_pid1_worker_fork": harden_pos >= 0 and reaper_pos >= 0 and harden_pos < reaper_pos,
        "secret_present_before_live_scrub": deterministic_probe["secret_present_before_live_scrub"] is True,
        "secret_removed_from_live_environ": deterministic_probe["secret_present_after_live_scrub"] is False,
        "pr_set_dumpable_zero_verified": deterministic_probe["dumpable_after"] == 0,
        "rlimit_core_zero_verified": deterministic_probe["rlimit_core_after"] == [0, 0],
    }
    evidence = {
        "probe": deterministic_probe,
        "checks": checks,
        "source_sha256": source_sha256,
        "adopted": ["PR_SET_DUMPABLE=0 on namespace PID1", "RLIMIT_CORE=0", "sanitized live PID1 environment"],
        "keep_shadow": ["RLIMIT_NOFILE=4096 until representative coding workload"],
        "defer": ["RLIMIT_NPROC: use outer cgroup pids.max for workload-scoped process control"],
        "determinism_scope": "evidence_sha256 excludes host-dependent environment shadow observations",
        "excluded_host_dependent_fields": list(ENVIRONMENT_PROBE_FIELDS),
        "proc_environ_caveat": "live os.environ mutation is not the /proc/pid/environ secrecy proof; PR_SET_DUMPABLE=0 is the ptrace-governed PID1 access fence",
    }
    return {
        "schema": SCHEMA,
        "outcome": "ACCEPT_ADOPTED_PID1_DUMPABLE_CORE" if all(checks.values()) else "REGRESSION_BLOCKED",
        "evidence": evidence,
        "evidence_sha256": canonical_hash(evidence),
        "environment": environment,
        "environment_sha256": canonical_hash(environment),
        "runtime_isolation_verified": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
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
    source_bytes = V2_PATH.read_bytes()
    source = source_bytes.decode("utf-8")
    return compose(probe, source, hashlib.sha256(source_bytes).hexdigest())


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
    return 0 if result["outcome"] == "ACCEPT_ADOPTED_PID1_DUMPABLE_CORE" else 2


if __name__ == "__main__":
    raise SystemExit(main())
