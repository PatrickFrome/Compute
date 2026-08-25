#!/usr/bin/env python3
"""PREP-only two-plane Docker safety canary.

Default mode is DRY RUN: no container is created.  Execution requires an
explicit --execute flag and is intended only after the MB1 hard gate is
properly resolved.

This tool does not admit a worker and does not create production safety
evidence.  It measures whether a trusted OUTER Docker control plane can enforce
constraints on a disposable INNER worker without exposing the Docker socket or
using host PID/network sharing.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from typing import Any

SCHEMA = "metaengine.compute.w1-outer-enforced-docker-canary.h205f22.v1"
DEFAULT_IMAGE = "python:3.12-alpine"
FORBIDDEN = {"--privileged", "--pid=host", "--network=host", "--security-opt=seccomp=unconfined"}


def _run(argv: list[str], *, check: bool = True, timeout: int = 30) -> subprocess.CompletedProcess[str]:
    return subprocess.run(argv, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=check, timeout=timeout)


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def build_run_args(image: str, name: str) -> list[str]:
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
        "sh", "-c", "sleep 300",
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
            "container init PID -> /proc/<pid>/cgroup if visible",
            "worker cgroup cpu/memory/pids limits",
            "disposable tree-kill canary using the exact worker cgroup when safely observable",
        ],
        "authority": {"canonical": False, "authority_effect": False, "worker_admitted": False, "w1_verified": False},
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
                "schema": SCHEMA, "mode": "EXECUTE", "started": False,
                "error": "docker_run_failed", "stderr_sha256": _sha256_text(cp.stderr),
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
        mounts = inspect.get("Mounts") or []
        docker_socket_exposed = any(
            str(m.get("Source", "")).endswith("/docker.sock") or str(m.get("Destination", "")).endswith("/docker.sock")
            for m in mounts if isinstance(m, dict)
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
        }
        return {
            "schema": SCHEMA,
            "mode": "EXECUTE",
            "started": True,
            "container_id_sha256": _sha256_text(cid),
            "image_id": image_id,
            "outer": outer,
            "inner": inner,
            "docker_inspect_facts": {
                "state_pid": state.get("Pid"),
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
            "needs_independent_cgroup_tree_kill_proof": True,
            "needs_persisted_two_plane_composition": True,
            "authority": {"canonical": False, "authority_effect": False, "worker_admitted": False, "w1_verified": False},
        }
    finally:
        if created:
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
