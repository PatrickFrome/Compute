#!/usr/bin/env python3
"""PREP-only same-worker W1 two-plane canary v2.

One disposable Docker worker is used for BOTH worker-side safety collection and
outer cgroup tree-kill. This prevents composing green receipts from different
process/container incarnations. Default mode is dry-run. The result is always
non-authority and cannot admit/verify a worker.
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

_THIS_DIR = Path(__file__).resolve().parent
if str(_THIS_DIR) not in sys.path:
    sys.path.insert(0, str(_THIS_DIR))
import outer_enforced_docker_canary as base  # type: ignore  # noqa: E402
import outer_privileged_cgroup_witness as outer_v2  # type: ignore  # noqa: E402
import two_plane_safety_witness_v2 as safety_v2  # type: ignore  # noqa: E402

SCHEMA = "metaengine.compute.w1-same-worker-two-plane-canary.h205f22.v2"
DEFAULT_IMAGE = base.DEFAULT_IMAGE
REPO_ROOT = Path(__file__).resolve().parents[2]
BUNDLE_IN_CONTAINER = "/repo/worker/native_linux/worker_safety_bundle_collector_v2.py"


def _run_args(image: str, name: str) -> list[str]:
    args = base.build_run_args(image, name)
    image_index = args.index(image)
    additions = [
        "--mount", f"type=bind,src={REPO_ROOT},dst=/repo,readonly",
        "--ulimit", "cpu=300:300",
        "--ulimit", "as=2147483648:2147483648",
    ]
    result = args[:image_index] + additions + args[image_index:]
    flat = " ".join(result)
    for token in base.FORBIDDEN:
        if token in flat:
            raise RuntimeError(f"forbidden flag present: {token}")
    return result


def _source(git_sha: str, tree_sha: str) -> dict[str, Any]:
    for label, value in (("git_sha", git_sha), ("tree_sha", tree_sha)):
        if len(value) != 40 or value != value.lower() or any(c not in "0123456789abcdef" for c in value):
            raise ValueError(f"invalid {label}")
    return {"source": {"git_sha": git_sha, "tree_sha": tree_sha}}


def dry_plan(image: str, git_sha: str, tree_sha: str) -> dict[str, Any]:
    name = "w1-same-worker-two-plane-DRYRUN"
    return {
        "schema": SCHEMA,
        "mode": "DRY_RUN",
        "source": _source(git_sha, tree_sha)["source"],
        "worker_run_argv": _run_args(image, name),
        "same_worker_invariant": "bundle CID == cgroup-witness CID; bundle collected before outer privilege boundary",
        "outer_privilege": "prebound exact cgroup only, per outer witness v2",
        "canonical": False,
        "authority_effect": False,
        "safety_verified": False,
        "worker_admitted": False,
        "w1_verified": False,
    }


def execute(image: str, git_sha: str, tree_sha: str) -> dict[str, Any]:
    source_payload = _source(git_sha, tree_sha)
    image_cp = base._run(["docker", "image", "inspect", image], check=False)
    if image_cp.returncode != 0:
        return _reject("required_image_absent_no_pull")
    image_id = str(json.loads(image_cp.stdout)[0].get("Id") or "")
    if not image_id.startswith("sha256:"):
        return _reject("image_digest_unavailable")

    name = f"w1-same-worker-{os.getpid()}-{int(time.time())}"
    argv = _run_args(image, name)
    created = False
    try:
        cp = base._run(argv, check=False, timeout=45)
        if cp.returncode != 0:
            return _reject("docker_run_failed", stderr_sha256=base._sha256_text(cp.stderr))
        created = True
        cid = cp.stdout.strip()
        inspect = json.loads(base._run(["docker", "inspect", cid]).stdout)[0]
        state = inspect.get("State") or {}
        state_pid = int(state.get("Pid") or 0)
        if state_pid <= 0:
            return _reject("container_init_pid_unavailable")

        # Worker-side bundle is collected before any sudo boundary and in the
        # exact same container that will later be cgroup-killed.
        bundle_cp = subprocess.run(
            ["docker", "exec", "-i", "--user", "1000:1000", cid, "python3", BUNDLE_IN_CONTAINER],
            input=json.dumps(source_payload, sort_keys=True),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=20,
            check=False,
        )
        try:
            bundle = json.loads(bundle_cp.stdout) if bundle_cp.stdout.strip() else {}
        except json.JSONDecodeError:
            bundle = {}
        if bundle_cp.returncode not in (0, 2) or not isinstance(bundle, dict):
            return _reject("worker_bundle_execution_invalid", stderr_sha256=base._sha256_text(bundle_cp.stderr))

        outer_ns = outer_v2._outer_namespaces()
        bundle_raw = ((bundle.get("evidence") or {}).get("raw") or {})
        inner_ns = bundle_raw.get("namespace_inodes") or {}
        legacy_obs = bundle_raw.get("legacy_observation") or {}
        host = legacy_obs.get("host") or {}
        hc = inspect.get("HostConfig") or {}
        config = inspect.get("Config") or {}
        mounts = inspect.get("Mounts") or []
        socket_exposed = any(
            str(m.get("Source", "")).endswith("/docker.sock") or str(m.get("Destination", "")).endswith("/docker.sock")
            for m in mounts if isinstance(m, dict)
        )

        relative, directory = base._cgroup_dir_for_pid(state_pid)
        target_ok, target_error, kill_file = outer_v2._safe_exact_kill_target(cid, directory, relative)
        limits = {
            "cpu.max": base._read_text(directory / "cpu.max"),
            "memory.max": base._read_text(directory / "memory.max"),
            "pids.max": base._read_text(directory / "pids.max"),
        }
        limit_checks = {
            "cpu": limits["cpu.max"] not in (None, "", "max", "max 100000"),
            "memory": limits["memory.max"] not in (None, "", "max"),
            "pids": limits["pids.max"] not in (None, "", "max"),
        }
        pre_events = base._parse_cgroup_events(base._read_text(directory / "cgroup.events") or "")
        pre_pids = base._read_pids(directory)

        worker_nonroot = str(config.get("User") or "") not in ("", "0", "0:0", "root")
        worker_rootless_derived = bool(
            worker_nonroot
            and host.get("no_new_privs") is True
            and int(host.get("seccomp_mode", 0)) == 2
            and bundle_raw.get("cap_eff_zero") is True
            and not socket_exposed
            and not bool(hc.get("Privileged"))
        )
        prebound_ready = bool(
            bundle.get("outcome") == "WORKER_SAFETY_BUNDLE_ELIGIBLE_NONAUTHORITY"
            and target_ok and kill_file is not None
            and pre_events.get("populated") == 1 and len(pre_pids) >= 2
            and all(limit_checks.values()) and worker_rootless_derived
        )

        sudo = {"not_attempted": True}
        kill_result = {"not_attempted": True, "succeeded": False}
        if prebound_ready:
            sudo = outer_v2._sudo_root_probe()
            if sudo.get("available") is True:
                kill_result = outer_v2._sudo_write_one(kill_file)

        post_unpopulated = False
        post_events: dict[str, int] = {}
        if kill_result.get("succeeded"):
            post_unpopulated, post_events = base._wait_for_unpopulated(directory)
        pre_processes_gone = bool(pre_pids) and all(not Path(f"/proc/{pid}").exists() for pid in pre_pids)
        inspect_after = base._run(["docker", "inspect", cid], check=False, timeout=10)
        docker_running_after = None
        if inspect_after.returncode == 0:
            docker_running_after = bool((json.loads(inspect_after.stdout)[0].get("State") or {}).get("Running"))
        tree_kill = bool(prebound_ready and sudo.get("available") is True and kill_result.get("succeeded") and post_unpopulated and pre_processes_gone and docker_running_after is False)

        safety_input = {
            "schema": safety_v2.SCHEMA,
            "source": source_payload["source"],
            "outer": {"mount_ns_inode": outer_ns["mnt_ns"], "pid_ns_inode": outer_ns["pid_ns"], "net_ns_inode": outer_ns["net_ns"]},
            "inner": {
                "mount_ns_inode": int(inner_ns.get("mount", -1)),
                "pid_ns_inode": int(inner_ns.get("pid", -1)),
                "net_ns_inode": int(inner_ns.get("network", -1)),
                "euid": int(host.get("euid", 0)),
                "no_new_privs": host.get("no_new_privs") is True,
                "seccomp_mode": int(host.get("seccomp_mode", 0)),
                "cap_eff_zero": bundle_raw.get("cap_eff_zero") is True,
                "network_default_deny": bundle_raw.get("network_default_deny") is True,
            },
            "runtime": {
                "worker_rootless": worker_rootless_derived,
                "worker_has_control_socket": socket_exposed,
                "host_pid_shared": hc.get("PidMode") == "host",
                "host_network_shared": hc.get("NetworkMode") == "host",
                "privileged": bool(hc.get("Privileged")),
            },
            "cgroup": {
                "exact_target_valid": target_ok,
                "cpu_limited": limit_checks["cpu"],
                "memory_limited": limit_checks["memory"],
                "pids_limited": limit_checks["pids"],
                "tree_kill_proven": tree_kill,
                "prebound_before_outer_privilege": prebound_ready,
                "worker_launch_via_outer_privilege": False,
                "worker_exec_via_outer_privilege": False,
            },
        }
        safety = safety_v2.evaluate(safety_input)
        eligible = bool(
            bundle.get("outcome") == "WORKER_SAFETY_BUNDLE_ELIGIBLE_NONAUTHORITY"
            and safety.get("outcome") == "TWO_PLANE_SAFETY_ELIGIBLE_NONAUTHORITY"
            and tree_kill
        )
        evidence = {
            "source": source_payload["source"],
            "image_id": image_id,
            "container_id_sha256": base._sha256_text(cid),
            "bundle": bundle,
            "bundle_stdout_sha256": base._sha256_text(bundle_cp.stdout),
            "bundle_stderr_sha256": base._sha256_text(bundle_cp.stderr) if bundle_cp.stderr else None,
            "safety_witness": safety,
            "outer_namespaces": outer_ns,
            "cgroup": {
                "path_sha256": base._sha256_text(relative),
                "exact_target_valid": target_ok,
                "target_error": target_error,
                "limits": limits,
                "pre_events": pre_events,
                "pre_process_count": len(pre_pids),
                "pre_process_ids_sha256": base._sha256_text(",".join(str(x) for x in pre_pids)),
                "sudo": sudo,
                "kill_write": kill_result,
                "post_events": post_events,
                "post_unpopulated": post_unpopulated,
                "pre_processes_gone": pre_processes_gone,
                "docker_running_after": docker_running_after,
                "tree_kill_proven": tree_kill,
            },
            "same_worker_binding": {
                "state_pid": state_pid,
                "container_id_bound_to_cgroup": target_ok,
                "bundle_collected_before_outer_privilege": True,
                "worker_rootless_derived": worker_rootless_derived,
            },
        }
        return {
            "schema": SCHEMA,
            "mode": "EXECUTE",
            "outcome": "SAME_WORKER_TWO_PLANE_ELIGIBLE_NONAUTHORITY" if eligible else "REJECTED_SAME_WORKER_TWO_PLANE",
            "evidence": evidence,
            "evidence_sha256": safety_v2.canonical_hash(evidence),
            "provider_identity_verified": False,
            "persistence_verified": False,
            "safety_verified": False,
            "worker_admitted": False,
            "w1_verified": False,
            "canonical": False,
            "authority_effect": False,
            "requires_persisted_server_side_composition": True,
        }
    finally:
        if created:
            base._run(["docker", "rm", "-f", name], check=False, timeout=20)


def _reject(reason: str, **extra: Any) -> dict[str, Any]:
    return {
        "schema": SCHEMA,
        "mode": "EXECUTE",
        "outcome": "REJECTED_SAME_WORKER_TWO_PLANE",
        "reason": reason,
        **extra,
        "provider_identity_verified": False,
        "persistence_verified": False,
        "safety_verified": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", default=DEFAULT_IMAGE)
    parser.add_argument("--git-sha", required=True)
    parser.add_argument("--tree-sha", required=True)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    result = execute(args.image, args.git_sha, args.tree_sha) if args.execute else dry_plan(args.image, args.git_sha, args.tree_sha)
    json.dump(result, sys.stdout, sort_keys=True, indent=2)
    sys.stdout.write("\n")
    return 0 if result["outcome"].endswith("ELIGIBLE_NONAUTHORITY") else 2


if __name__ == "__main__":
    raise SystemExit(main())
