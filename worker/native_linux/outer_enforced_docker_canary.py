#!/usr/bin/env python3
"""PREP-only two-plane Docker safety canary.

Default mode is DRY RUN: no container is created. Execution requires an
explicit --execute flag and is intended only after the MB1 hard gate is
properly resolved.

This tool does not admit a worker and does not create production safety
evidence. It measures whether a trusted OUTER Docker control plane can enforce
constraints on a disposable INNER worker without exposing the Docker socket or
using host PID/network sharing.

Execute mode is intentionally fail-closed. In particular, `docker kill` is NOT
accepted as a substitute for the W1 cgroup tree-kill predicate. The canary must
bind the exact Docker container PID to its cgroup-v2 path and successfully write
`1` to that cgroup's `cgroup.kill`, then observe the cgroup become unpopulated.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys
import time
from typing import Any

SCHEMA = "metaengine.compute.w1-outer-enforced-docker-canary.h205f22.v1"
DEFAULT_IMAGE = "python:3.12-alpine"
CGROUP_ROOT = Path("/sys/fs/cgroup")
FORBIDDEN = {
    "--privileged",
    "--pid=host",
    "--network=host",
    "--security-opt=seccomp=unconfined",
    "--cap-add",
}


def _run(argv: list[str], *, check: bool = True, timeout: int = 30) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        argv,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=check,
        timeout=timeout,
    )


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def build_run_args(image: str, name: str) -> list[str]:
    # The shell plus two sleepers gives the cgroup.kill canary a real process
    # tree instead of proving only single-process termination.
    args = [
        "docker", "run", "-d", "--pull=never", "--name", name,
        "--network=none",
        "--user", "1000:1000",
        "--cap-drop=ALL",
        "--security-opt", "no-new-privileges=true",
        "--security-opt", "seccomp=builtin",
        "--cgroupns=private",
        "--pids-limit", "64",
        "--memory", "256m",
        "--memory-swap", "256m",
        "--cpus", "0.50",
        "--ulimit", "nofile=1024:1024",
        "--ulimit", "nproc=256:256",
        "--ulimit", "fsize=1048576:1048576",
        "--read-only",
        "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m",
        image,
        "sh", "-c", "sleep 300 & sleep 300 & wait",
    ]
    flat = " ".join(args)
    for token in FORBIDDEN:
        if token in flat:
            raise RuntimeError(f"forbidden flag present: {token}")
    return args


def inner_probe_script() -> str:
    return r'''
import json, os, pathlib, socket
status = {}
for line in pathlib.Path('/proc/self/status').read_text().splitlines():
    if ':' in line:
        k,v=line.split(':',1); status[k]=v.strip()
def ino(path):
    return pathlib.Path(path).stat().st_ino
blocked=False
s=socket.socket(socket.AF_INET,socket.SOCK_STREAM); s.settimeout(0.5)
try:
    s.connect(('1.1.1.1',53))
except OSError:
    blocked=True
finally:
    s.close()
print(json.dumps({
  'euid': os.geteuid(),
  'no_new_privs': status.get('NoNewPrivs'),
  'seccomp': status.get('Seccomp'),
  'cap_eff': status.get('CapEff'),
  'pid_ns': ino('/proc/self/ns/pid'),
  'mnt_ns': ino('/proc/self/ns/mnt'),
  'net_ns': ino('/proc/self/ns/net'),
  'network_egress_blocked': blocked,
}, sort_keys=True))
'''.strip()


def _parse_unified_cgroup(text: str) -> str:
    """Return the unified cgroup-v2 path from /proc/<pid>/cgroup."""
    matches: list[str] = []
    for raw in text.splitlines():
        parts = raw.strip().split(":", 2)
        if len(parts) == 3 and parts[0] == "0" and parts[1] == "":
            matches.append(parts[2])
    if len(matches) != 1:
        raise RuntimeError("exactly one unified cgroup-v2 entry required")
    path = PurePosixPath(matches[0])
    if not path.is_absolute() or ".." in path.parts:
        raise RuntimeError("unsafe cgroup path")
    return str(path)


def _cgroup_dir_for_pid(pid: int) -> tuple[str, Path]:
    if pid <= 0:
        raise RuntimeError("container init pid unavailable")
    proc_path = Path(f"/proc/{pid}/cgroup")
    raw = proc_path.read_text(encoding="utf-8")
    relative = _parse_unified_cgroup(raw)
    directory = CGROUP_ROOT.joinpath(relative.lstrip("/"))
    if not directory.is_dir():
        raise RuntimeError("container cgroup directory unavailable from outer plane")
    return relative, directory


def _parse_cgroup_events(text: str) -> dict[str, int]:
    result: dict[str, int] = {}
    for raw in text.splitlines():
        parts = raw.split()
        if len(parts) == 2 and parts[1].isdigit():
            result[parts[0]] = int(parts[1])
    return result


def _read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return None


def _read_pids(path: Path) -> list[int]:
    raw = _read_text(path / "cgroup.procs")
    if raw is None or raw == "":
        return []
    pids: list[int] = []
    for item in raw.splitlines():
        item = item.strip()
        if item.isdigit():
            pids.append(int(item))
    return sorted(set(pids))


def _wait_for_unpopulated(cgroup_dir: Path, *, timeout: float = 5.0) -> tuple[bool, dict[str, int]]:
    deadline = time.monotonic() + timeout
    last: dict[str, int] = {}
    while time.monotonic() < deadline:
        raw = _read_text(cgroup_dir / "cgroup.events")
        if raw is None:
            # A removed exact container cgroup after kill is acceptable only
            # when Docker independently reports the container stopped.
            return False, last
        last = _parse_cgroup_events(raw)
        if last.get("populated") == 0:
            return True, last
        time.sleep(0.05)
    return False, last


def _inner_checks(inner: Any) -> dict[str, bool]:
    if not isinstance(inner, dict) or inner.get("probe_failed"):
        return {
            "euid_nonzero": False,
            "no_new_privs": False,
            "seccomp_filter": False,
            "cap_eff_zero": False,
            "network_default_deny": False,
        }
    cap_eff = str(inner.get("cap_eff") or "").lower().removeprefix("0x")
    return {
        "euid_nonzero": int(inner.get("euid", 0)) != 0,
        "no_new_privs": str(inner.get("no_new_privs")) == "1",
        "seccomp_filter": str(inner.get("seccomp")) == "2",
        "cap_eff_zero": bool(cap_eff) and set(cap_eff) <= {"0"},
        "network_default_deny": inner.get("network_egress_blocked") is True,
    }


def _cgroup_tree_kill(cid: str, state_pid: int) -> dict[str, Any]:
    """Directly prove outer-plane cgroup-v2 tree kill for the exact container."""
    proof: dict[str, Any] = {
        "attempted": False,
        "exact_container_binding": False,
        "kill_file_present": False,
        "kill_file_writable": False,
        "pre_populated": None,
        "pre_process_count": 0,
        "kill_write_succeeded": False,
        "post_unpopulated": False,
        "docker_running_after": None,
        "tree_kill_proven": False,
    }
    try:
        relative, cgroup_dir = _cgroup_dir_for_pid(state_pid)
        proof["cgroup_path"] = relative
        proof["cgroup_path_sha256"] = _sha256_text(relative)
        proof["exact_container_binding"] = cid in relative
        proof["limits"] = {
            "cpu.max": _read_text(cgroup_dir / "cpu.max"),
            "memory.max": _read_text(cgroup_dir / "memory.max"),
            "pids.max": _read_text(cgroup_dir / "pids.max"),
        }
        pre_events_raw = _read_text(cgroup_dir / "cgroup.events") or ""
        pre_events = _parse_cgroup_events(pre_events_raw)
        pre_pids = _read_pids(cgroup_dir)
        proof["pre_populated"] = pre_events.get("populated")
        proof["pre_process_count"] = len(pre_pids)
        proof["pre_process_ids_sha256"] = _sha256_text(",".join(str(pid) for pid in pre_pids))

        kill_file = cgroup_dir / "cgroup.kill"
        proof["kill_file_present"] = kill_file.is_file()
        proof["kill_file_writable"] = os.access(kill_file, os.W_OK)
        proof["attempted"] = True
        if not proof["exact_container_binding"]:
            proof["error"] = "cgroup_path_not_bound_to_exact_container_id"
            return proof
        if pre_events.get("populated") != 1 or len(pre_pids) < 2:
            proof["error"] = "disposable_process_tree_not_observed"
            return proof
        if not proof["kill_file_present"] or not proof["kill_file_writable"]:
            proof["error"] = "outer_cgroup_kill_not_writable"
            return proof

        # This write targets ONLY the disposable container cgroup resolved from
        # its exact init PID. There is deliberately no docker-kill fallback.
        with kill_file.open("w", encoding="utf-8") as fh:
            fh.write("1\n")
        proof["kill_write_succeeded"] = True

        post_unpopulated, post_events = _wait_for_unpopulated(cgroup_dir)
        proof["post_unpopulated"] = post_unpopulated
        proof["post_events"] = post_events

        inspect_after = _run(["docker", "inspect", cid], check=False, timeout=10)
        if inspect_after.returncode == 0:
            state = (json.loads(inspect_after.stdout)[0].get("State") or {})
            proof["docker_running_after"] = bool(state.get("Running"))
        proof["tree_kill_proven"] = bool(
            proof["exact_container_binding"]
            and proof["kill_write_succeeded"]
            and proof["post_unpopulated"]
            and proof["docker_running_after"] is False
        )
        return proof
    except Exception as exc:  # Evidence collector must fail closed, not hide the cause.
        proof["error_type"] = type(exc).__name__
        proof["error_sha256"] = _sha256_text(str(exc))
        return proof


def dry_plan(image: str) -> dict[str, Any]:
    name = "w1-two-plane-canary-DRYRUN"
    args = build_run_args(image, name)
    return {
        "schema": SCHEMA,
        "mode": "DRY_RUN",
        "run_argv": args,
        "required_outer_reads": [
            "docker inspect HostConfig/State/Mounts/Image",
            "outer namespace inode capture",
            "exact container init PID -> /proc/<pid>/cgroup",
            "exact cgroup-v2 cpu.max/memory.max/pids.max",
            "cgroup.events populated=1 and >=2 disposable processes",
            "direct write 1 to exact cgroup.kill",
            "cgroup.events populated=0 and Docker Running=false",
        ],
        "forbidden_substitutions": [
            "docker kill as proof of cgroup tree-kill",
            "host PID/network sharing",
            "privileged mode",
            "seccomp=unconfined",
            "cap-add",
        ],
        "authority": {
            "canonical": False,
            "authority_effect": False,
            "worker_admitted": False,
            "w1_verified": False,
        },
    }


def execute(image: str) -> dict[str, Any]:
    # Never pull implicitly; evidence must bind to an already-present image.
    image_inspect = _run(["docker", "image", "inspect", image], check=False)
    if image_inspect.returncode != 0:
        raise RuntimeError("required image not present locally; refusing implicit pull")
    image_data = json.loads(image_inspect.stdout)[0]
    image_id = str(image_data.get("Id") or "")
    if not image_id.startswith("sha256:"):
        raise RuntimeError("image digest unavailable")

    suffix = f"{os.getpid()}-{int(time.time())}"
    name = f"w1-two-plane-canary-{suffix}"
    argv = build_run_args(image, name)
    created = False
    try:
        cp = _run(argv, check=False, timeout=45)
        if cp.returncode != 0:
            return {
                "schema": SCHEMA,
                "mode": "EXECUTE",
                "outcome": "REJECTED_NONAUTHORITY",
                "started": False,
                "error": "docker_run_failed",
                "stderr_sha256": _sha256_text(cp.stderr),
                "authority": {"canonical": False, "authority_effect": False, "worker_admitted": False, "w1_verified": False},
            }
        created = True
        cid = cp.stdout.strip()
        inspect_cp = _run(["docker", "inspect", cid])
        inspect = json.loads(inspect_cp.stdout)[0]

        probe_cp = _run(["docker", "exec", cid, "python3", "-c", inner_probe_script()], check=False)
        if probe_cp.returncode != 0:
            inner: Any = {"probe_failed": True, "stderr_sha256": _sha256_text(probe_cp.stderr)}
        else:
            inner = json.loads(probe_cp.stdout.strip())

        outer = {
            "self_pid_ns": Path("/proc/self/ns/pid").stat().st_ino,
            "self_mnt_ns": Path("/proc/self/ns/mnt").stat().st_ino,
            "self_net_ns": Path("/proc/self/ns/net").stat().st_ino,
        }
        host_config = inspect.get("HostConfig") or {}
        state = inspect.get("State") or {}
        config = inspect.get("Config") or {}
        mounts = inspect.get("Mounts") or []
        docker_socket_exposed = any(
            str(m.get("Source", "")).endswith("/docker.sock")
            or str(m.get("Destination", "")).endswith("/docker.sock")
            for m in mounts
            if isinstance(m, dict)
        )
        required_security = {
            "network_none": host_config.get("NetworkMode") == "none",
            "cap_drop_all": "ALL" in (host_config.get("CapDrop") or []),
            "nnp_requested": any("no-new-privileges" in str(x) for x in (host_config.get("SecurityOpt") or [])),
            "seccomp_not_unconfined": not any("seccomp=unconfined" in str(x) for x in (host_config.get("SecurityOpt") or [])),
            "cgroup_private": host_config.get("CgroupnsMode") in ("private", ""),
            "pids_limited": int(host_config.get("PidsLimit") or 0) > 0,
            "memory_limited": int(host_config.get("Memory") or 0) > 0,
            "cpu_limited": int(host_config.get("NanoCpus") or 0) > 0,
            "read_only_rootfs": bool(host_config.get("ReadonlyRootfs")),
            "docker_socket_not_exposed": not docker_socket_exposed,
            "worker_user_nonroot": str(config.get("User") or "") not in ("", "0", "0:0", "root"),
        }
        inner_checks = _inner_checks(inner)
        cgroup_proof = _cgroup_tree_kill(cid, int(state.get("Pid") or 0))
        limits = cgroup_proof.get("limits") if isinstance(cgroup_proof, dict) else {}
        cgroup_limit_checks = {
            "memory_max_finite": isinstance(limits, dict) and limits.get("memory.max") not in (None, "", "max"),
            "pids_max_finite": isinstance(limits, dict) and limits.get("pids.max") not in (None, "", "max"),
            "cpu_max_limited": isinstance(limits, dict) and limits.get("cpu.max") not in (None, "", "max", "max 100000"),
        }
        eligible = bool(
            all(required_security.values())
            and all(inner_checks.values())
            and all(cgroup_limit_checks.values())
            and cgroup_proof.get("tree_kill_proven") is True
        )
        return {
            "schema": SCHEMA,
            "mode": "EXECUTE",
            "outcome": "ELIGIBLE_NONAUTHORITY" if eligible else "REJECTED_NONAUTHORITY",
            "started": True,
            "container_id_sha256": _sha256_text(cid),
            "image_id": image_id,
            "outer": outer,
            "inner": inner,
            "inner_checks": inner_checks,
            "docker_inspect_facts": {
                "state_pid": state.get("Pid"),
                "config_user": config.get("User"),
                "host_config": {
                    "NetworkMode": host_config.get("NetworkMode"),
                    "CapDrop": host_config.get("CapDrop"),
                    "SecurityOpt": host_config.get("SecurityOpt"),
                    "CgroupnsMode": host_config.get("CgroupnsMode"),
                    "PidsLimit": host_config.get("PidsLimit"),
                    "Memory": host_config.get("Memory"),
                    "MemorySwap": host_config.get("MemorySwap"),
                    "NanoCpus": host_config.get("NanoCpus"),
                    "ReadonlyRootfs": host_config.get("ReadonlyRootfs"),
                },
            },
            "security_requests_verified": required_security,
            "cgroup_limit_checks": cgroup_limit_checks,
            "cgroup_tree_kill": cgroup_proof,
            "needs_persisted_two_plane_composition": True,
            "authority": {"canonical": False, "authority_effect": False, "worker_admitted": False, "w1_verified": False},
        }
    finally:
        if created:
            # Cleanup is not evidence. The cgroup predicate above never falls
            # back to docker rm/kill; this only prevents disposable leftovers.
            _run(["docker", "rm", "-f", name], check=False, timeout=20)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", default=DEFAULT_IMAGE)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    result = execute(args.image) if args.execute else dry_plan(args.image)
    json.dump(result, sys.stdout, sort_keys=True, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
