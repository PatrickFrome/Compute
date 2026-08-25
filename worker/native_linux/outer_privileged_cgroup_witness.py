#!/usr/bin/env python3
"""PREP-only privileged OUTER cgroup witness for W1.

This is intentionally separate from the normal uid1000 canary. It exists to
make the privilege boundary explicit and auditable. The disposable worker is
created with the exact hardened arguments from outer_enforced_docker_canary;
only the final write to the already-resolved exact container `cgroup.kill`
uses passwordless sudo.

Default mode is DRY_RUN. `--execute` must not be used while the macroblock hard
gate is closed. This script never admits a worker or asserts W1.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from typing import Any

from worker.native_linux import outer_enforced_docker_canary as base

SCHEMA = "metaengine.compute.w1-outer-privileged-cgroup-witness.h205f22.v1"


def _sudo_root_probe() -> dict[str, Any]:
    cp = base._run(["sudo", "-n", "id", "-u"], check=False, timeout=5)
    uid = cp.stdout.strip() if cp.returncode == 0 else None
    return {
        "available": cp.returncode == 0 and uid == "0",
        "uid": uid,
        "stderr_sha256": base._sha256_text(cp.stderr) if cp.stderr else None,
    }


def _safe_exact_kill_target(cid: str, cgroup_dir: Path, relative: str) -> tuple[bool, str | None]:
    try:
        root = base.CGROUP_ROOT.resolve(strict=True)
        directory = cgroup_dir.resolve(strict=True)
        kill_file = (directory / "cgroup.kill").resolve(strict=True)
    except OSError as exc:
        return False, f"resolve_failed:{type(exc).__name__}"
    try:
        directory.relative_to(root)
        kill_file.relative_to(root)
    except ValueError:
        return False, "target_outside_cgroup_root"
    if kill_file.parent != directory or kill_file.name != "cgroup.kill":
        return False, "kill_file_path_mismatch"
    if cid not in relative or cid not in str(directory):
        return False, "exact_container_id_not_in_cgroup_path"
    if not kill_file.is_file():
        return False, "cgroup_kill_missing"
    return True, None


def _sudo_write_one(kill_file: Path) -> dict[str, Any]:
    # No shell, no wildcard, no caller-supplied command. The path has already
    # been resolved and constrained beneath /sys/fs/cgroup for the exact CID.
    cp = subprocess.run(
        ["sudo", "-n", "tee", "--", str(kill_file)],
        input="1\n",
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=5,
        check=False,
    )
    return {
        "returncode": cp.returncode,
        "stdout": cp.stdout.strip(),
        "stderr_sha256": base._sha256_text(cp.stderr) if cp.stderr else None,
        "succeeded": cp.returncode == 0,
    }


def _security_facts(inspect: dict[str, Any], inner: Any) -> tuple[dict[str, bool], dict[str, bool]]:
    hc = inspect.get("HostConfig") or {}
    config = inspect.get("Config") or {}
    mounts = inspect.get("Mounts") or []
    socket_exposed = any(
        str(m.get("Source", "")).endswith("/docker.sock")
        or str(m.get("Destination", "")).endswith("/docker.sock")
        for m in mounts if isinstance(m, dict)
    )
    outer = {
        "network_none": hc.get("NetworkMode") == "none",
        "cap_drop_all": "ALL" in (hc.get("CapDrop") or []),
        "nnp_requested": any("no-new-privileges" in str(x) for x in (hc.get("SecurityOpt") or [])),
        "seccomp_not_unconfined": not any("seccomp=unconfined" in str(x) for x in (hc.get("SecurityOpt") or [])),
        "cgroup_private": hc.get("CgroupnsMode") in ("private", ""),
        "pids_limited": int(hc.get("PidsLimit") or 0) > 0,
        "memory_limited": int(hc.get("Memory") or 0) > 0,
        "cpu_limited": int(hc.get("NanoCpus") or 0) > 0,
        "read_only_rootfs": bool(hc.get("ReadonlyRootfs")),
        "docker_socket_not_exposed": not socket_exposed,
        "worker_user_nonroot": str(config.get("User") or "") not in ("", "0", "0:0", "root"),
    }
    return outer, base._inner_checks(inner)


def dry_plan(image: str) -> dict[str, Any]:
    return {
        "schema": SCHEMA,
        "mode": "DRY_RUN",
        "image": image,
        "worker_run_argv": base.build_run_args(image, "w1-outer-privileged-DRYRUN"),
        "privilege_boundary": {
            "worker_launch_via_sudo": False,
            "worker_exec_via_sudo": False,
            "worker_configuration_modified_by_sudo": False,
            "sudo_operation": "tee 1 to already-resolved exact-container cgroup.kill only",
        },
        "required_pair_decision": "PRIVILEGED_OUTER_WITNESS_ACCEPTED",
        "canonical": False,
        "authority_effect": False,
        "worker_admitted": False,
        "w1_verified": False,
    }


def execute(image: str) -> dict[str, Any]:
    sudo = _sudo_root_probe()
    if not sudo["available"]:
        return {
            "schema": SCHEMA, "mode": "EXECUTE", "outcome": "REJECTED_NONAUTHORITY",
            "error": "passwordless_sudo_root_unavailable", "sudo": sudo,
            "canonical": False, "authority_effect": False, "worker_admitted": False, "w1_verified": False,
        }

    image_inspect = base._run(["docker", "image", "inspect", image], check=False)
    if image_inspect.returncode != 0:
        return {
            "schema": SCHEMA, "mode": "EXECUTE", "outcome": "REJECTED_NONAUTHORITY",
            "error": "required_image_absent_no_pull", "sudo": sudo,
            "canonical": False, "authority_effect": False, "worker_admitted": False, "w1_verified": False,
        }
    image_data = json.loads(image_inspect.stdout)[0]
    image_id = str(image_data.get("Id") or "")
    if not image_id.startswith("sha256:"):
        raise RuntimeError("image digest unavailable")

    name = f"w1-outer-privileged-{os.getpid()}-{int(time.time())}"
    argv = base.build_run_args(image, name)
    created = False
    cid = ""
    try:
        cp = base._run(argv, check=False, timeout=45)
        if cp.returncode != 0:
            return {
                "schema": SCHEMA, "mode": "EXECUTE", "outcome": "REJECTED_NONAUTHORITY",
                "error": "docker_run_failed", "stderr_sha256": base._sha256_text(cp.stderr), "sudo": sudo,
                "canonical": False, "authority_effect": False, "worker_admitted": False, "w1_verified": False,
            }
        created = True
        cid = cp.stdout.strip()
        inspect = json.loads(base._run(["docker", "inspect", cid]).stdout)[0]
        state = inspect.get("State") or {}
        state_pid = int(state.get("Pid") or 0)
        if state_pid <= 0:
            raise RuntimeError("container init pid unavailable")

        probe_cp = base._run(["docker", "exec", cid, "python3", "-c", base.inner_probe_script()], check=False)
        inner: Any = (
            json.loads(probe_cp.stdout.strip()) if probe_cp.returncode == 0
            else {"probe_failed": True, "stderr_sha256": base._sha256_text(probe_cp.stderr)}
        )
        security, inner_checks = _security_facts(inspect, inner)

        relative, directory = base._cgroup_dir_for_pid(state_pid)
        target_ok, target_error = _safe_exact_kill_target(cid, directory, relative)
        limits = {
            "cpu.max": base._read_text(directory / "cpu.max"),
            "memory.max": base._read_text(directory / "memory.max"),
            "pids.max": base._read_text(directory / "pids.max"),
        }
        pre_events = base._parse_cgroup_events(base._read_text(directory / "cgroup.events") or "")
        pre_pids = base._read_pids(directory)
        limit_checks = {
            "cpu_max_limited": limits["cpu.max"] not in (None, "", "max", "max 100000"),
            "memory_max_finite": limits["memory.max"] not in (None, "", "max"),
            "pids_max_finite": limits["pids.max"] not in (None, "", "max"),
        }
        pre_tree_ok = pre_events.get("populated") == 1 and len(pre_pids) >= 2

        kill_result: dict[str, Any] = {"succeeded": False, "not_attempted": True}
        if target_ok and pre_tree_ok and all(security.values()) and all(inner_checks.values()) and all(limit_checks.values()):
            kill_result = _sudo_write_one(directory / "cgroup.kill")

        post_unpopulated = False
        post_events: dict[str, int] = {}
        if kill_result.get("succeeded"):
            post_unpopulated, post_events = base._wait_for_unpopulated(directory)
        inspect_after = base._run(["docker", "inspect", cid], check=False, timeout=10)
        docker_running_after: bool | None = None
        if inspect_after.returncode == 0:
            docker_running_after = bool((json.loads(inspect_after.stdout)[0].get("State") or {}).get("Running"))

        tree_kill = bool(target_ok and pre_tree_ok and kill_result.get("succeeded") and post_unpopulated and docker_running_after is False)
        eligible = bool(all(security.values()) and all(inner_checks.values()) and all(limit_checks.values()) and tree_kill)
        return {
            "schema": SCHEMA,
            "mode": "EXECUTE",
            "outcome": "ELIGIBLE_NONAUTHORITY" if eligible else "REJECTED_NONAUTHORITY",
            "image_id": image_id,
            "container_id_sha256": base._sha256_text(cid),
            "sudo": sudo,
            "privilege_scope": "EXACT_CGROUP_KILL_WRITE_ONLY",
            "worker_launch_via_sudo": False,
            "worker_exec_via_sudo": False,
            "security_requests_verified": security,
            "inner": inner,
            "inner_checks": inner_checks,
            "cgroup": {
                "path": relative,
                "path_sha256": base._sha256_text(relative),
                "exact_target_valid": target_ok,
                "target_error": target_error,
                "limits": limits,
                "limit_checks": limit_checks,
                "pre_events": pre_events,
                "pre_process_count": len(pre_pids),
                "pre_process_ids_sha256": base._sha256_text(",".join(str(x) for x in pre_pids)),
                "sudo_kill_write": kill_result,
                "post_events": post_events,
                "post_unpopulated": post_unpopulated,
                "docker_running_after": docker_running_after,
                "tree_kill_proven": tree_kill,
            },
            "canonical": False,
            "authority_effect": False,
            "worker_admitted": False,
            "w1_verified": False,
            "requires_persisted_two_plane_composition": True,
        }
    finally:
        if created:
            # Cleanup only; never counted as tree-kill evidence.
            base._run(["docker", "rm", "-f", name], check=False, timeout=20)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", default=base.DEFAULT_IMAGE)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    result = execute(args.image) if args.execute else dry_plan(args.image)
    json.dump(result, sys.stdout, sort_keys=True, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
