#!/usr/bin/env python3
"""Classify a W1 Linux host for later A1 sandbox choices.

This probe is deliberately non-authoritative. It never marks W1 VERIFIED and never
executes user code. It only reports whether the persistent host has the kernel and
runtime capabilities needed for gVisor or Firecracker after W1 is independently
verified.
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path


def read_text(path: str) -> str:
    try:
        return Path(path).read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def command_version(command: str, *args: str) -> str | None:
    path = shutil.which(command)
    if not path:
        return None
    try:
        proc = subprocess.run(
            [path, *args],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    first = (proc.stdout or "").strip().splitlines()
    return first[0][:240] if first else None


def bool_sysctl(path: str) -> bool | None:
    raw = read_text(path)
    if raw == "":
        return None
    if raw in {"1", "Y", "y", "true"}:
        return True
    if raw in {"0", "N", "n", "false"}:
        return False
    return None


def main() -> int:
    controllers = set(read_text("/sys/fs/cgroup/cgroup.controllers").split())
    pid1 = ""
    try:
        pid1 = Path("/proc/1/comm").read_text(encoding="utf-8").strip()
    except OSError:
        pass

    userns_clone = bool_sysctl("/proc/sys/kernel/unprivileged_userns_clone")
    max_userns_raw = read_text("/proc/sys/user/max_user_namespaces")
    try:
        max_userns = int(max_userns_raw) if max_userns_raw else None
    except ValueError:
        max_userns = None

    runsc_path = shutil.which("runsc")
    runsc_version = command_version("runsc", "--version") if runsc_path else None
    newuidmap = shutil.which("newuidmap") is not None
    newgidmap = shutil.which("newgidmap") is not None

    kvm_path = Path("/dev/kvm")
    kvm_present = kvm_path.exists()
    kvm_rw = kvm_present and os.access(kvm_path, os.R_OK | os.W_OK)

    cgroup_v2 = Path("/sys/fs/cgroup/cgroup.controllers").exists()
    cgroup_kill = Path("/sys/fs/cgroup/cgroup.kill").exists()
    required_controllers = {"cpu", "memory", "pids"}
    core_host_ready = (
        platform.system().lower() == "linux"
        and pid1 == "systemd"
        and cgroup_v2
        and cgroup_kill
        and required_controllers.issubset(controllers)
    )

    userns_available = (userns_clone is not False) and (max_userns is None or max_userns > 0)
    gvisor_rootful_candidate = bool(runsc_path) and core_host_ready
    gvisor_rootless_candidate = bool(runsc_path) and core_host_ready and userns_available
    gvisor_multi_uid_rootless_candidate = gvisor_rootless_candidate and newuidmap and newgidmap
    firecracker_candidate = core_host_ready and kvm_rw

    if gvisor_rootful_candidate:
        recommended = "GVISOR_RUNSC"
    elif firecracker_candidate:
        recommended = "FIRECRACKER_KVM"
    else:
        recommended = "PREPARE_GVISOR_AFTER_W1_VERIFIED"

    payload = {
        "schema": "metaengine.compute.execution-substrate-probe.h205f22.v1",
        "classification": "PREPARE_ONLY",
        "canonical": False,
        "authority_effect": False,
        "persistent_worker_proof": False,
        "w1_verified": False,
        "a1_runtime_authority": False,
        "host": {
            "os": platform.system().lower(),
            "arch": platform.machine(),
            "kernel": platform.release(),
            "pid1": pid1,
            "systemd_version": command_version("systemd", "--version"),
        },
        "w1_host_prerequisites": {
            "cgroup_v2": cgroup_v2,
            "cgroup_kill": cgroup_kill,
            "controllers": sorted(controllers),
            "required_controllers_present": required_controllers.issubset(controllers),
            "core_host_ready": core_host_ready,
        },
        "gvisor": {
            "runsc_path": runsc_path,
            "version": runsc_version,
            "unprivileged_userns_clone": userns_clone,
            "max_user_namespaces": max_userns,
            "newuidmap": newuidmap,
            "newgidmap": newgidmap,
            "rootful_candidate": gvisor_rootful_candidate,
            "rootless_candidate": gvisor_rootless_candidate,
            "multi_uid_rootless_candidate": gvisor_multi_uid_rootless_candidate,
        },
        "firecracker": {
            "dev_kvm_present": kvm_present,
            "dev_kvm_read_write": kvm_rw,
            "candidate": firecracker_candidate,
        },
        "recommended_first_sandbox": recommended,
        "nonclaims": [
            "NO_USER_CODE_EXECUTION",
            "NO_W1_VERIFICATION",
            "NO_A1_ENABLEMENT",
            "NO_SANDBOX_SECURITY_CLAIM_FROM_CAPABILITY_PROBE",
        ],
    }

    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    payload["evidence_sha256"] = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    print(json.dumps(payload, sort_keys=True, separators=(",", ":")))
    return 0 if core_host_ready else 2


if __name__ == "__main__":
    raise SystemExit(main())
