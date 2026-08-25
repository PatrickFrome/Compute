#!/usr/bin/env python3
"""Raw worker-side W1 safety bundle collector v2 (non-authority).

Caller input is provenance only. Safety facts come from kernel interfaces and
local canaries. The collector never accepts persistence/provider/admission
claims and never asserts W1. Outer cgroup tree-kill remains a separate trusted
control-plane witness.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import resource
import socket
import sys
from typing import Any

try:
    from . import host_observation_collector as legacy
except ImportError:
    import host_observation_collector as legacy  # type: ignore

SCHEMA = "metaengine.compute.w1-worker-safety-bundle.h205f22.v2"
INPUT_KEYS = {"source"}
SOURCE_KEYS = {"git_sha", "tree_sha"}
RLIMIT_TARGETS = {
    "nproc": (resource.RLIMIT_NPROC, 16),
    "nofile": (resource.RLIMIT_NOFILE, 64),
    "cpu_seconds": (resource.RLIMIT_CPU, 1),
    "fsize_bytes": (resource.RLIMIT_FSIZE, 1),
    "address_space_bytes": (resource.RLIMIT_AS, 268435456),
}


def _hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return hashlib.sha256(raw).hexdigest()


def _status() -> dict[str, str]:
    out: dict[str, str] = {}
    for line in Path("/proc/self/status").read_text().splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            out[key] = value.strip()
    return out


def _network_default_deny() -> bool:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(0.35)
    try:
        sock.connect(("1.1.1.1", 53))
    except OSError:
        return True
    finally:
        sock.close()
    return False


def _finite_rlimits() -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for name, (kind, minimum) in RLIMIT_TARGETS.items():
        soft, hard = resource.getrlimit(kind)
        finite = soft != resource.RLIM_INFINITY and hard != resource.RLIM_INFINITY
        result[name] = {
            "soft": soft,
            "hard": hard,
            "minimum": minimum,
            "finite": finite,
            "meets_minimum": finite and soft >= minimum and hard >= minimum,
        }
    return result


def _pidfd_waitid_canary() -> bool:
    if not hasattr(os, "pidfd_open") or not hasattr(os, "P_PIDFD"):
        return False
    pid = os.fork()
    if pid == 0:
        os._exit(0)
    fd = -1
    try:
        fd = os.pidfd_open(pid, 0)
        info = os.waitid(os.P_PIDFD, fd, os.WEXITED)
        return info is not None and getattr(info, "si_pid", pid) == pid
    except (OSError, AttributeError, NotImplementedError, TypeError):
        try:
            os.waitpid(pid, 0)
        except OSError:
            pass
        return False
    finally:
        if fd >= 0:
            os.close(fd)


def collect(source: dict[str, str]) -> dict[str, Any]:
    source = {
        "git_sha": legacy._canonical_sha(source.get("git_sha"), "git_sha"),
        "tree_sha": legacy._canonical_sha(source.get("tree_sha"), "tree_sha"),
    }
    observation = legacy.collect_observation(source)
    status = _status()
    cap_eff = status.get("CapEff", "").lower().removeprefix("0x")
    rlimits = _finite_rlimits()
    raw = {
        "source": source,
        "legacy_observation": observation,
        "namespace_inodes": {
            "pid": Path("/proc/self/ns/pid").stat().st_ino,
            "mount": Path("/proc/self/ns/mnt").stat().st_ino,
            "network": Path("/proc/self/ns/net").stat().st_ino,
        },
        "cap_eff_zero": bool(cap_eff) and set(cap_eff) <= {"0"},
        "network_default_deny": _network_default_deny(),
        "pidfd_waitid": _pidfd_waitid_canary(),
        "rlimits": rlimits,
        "docker_socket_present": Path("/var/run/docker.sock").exists(),
    }
    legacy_decision = legacy.admission_contract.evaluate(observation)
    checks = {
        "legacy_safety_eligible": legacy_decision["outcome"] == "SAFETY_ELIGIBLE_NON_PERSISTENT",
        "cap_eff_zero": raw["cap_eff_zero"],
        "network_default_deny": raw["network_default_deny"],
        "pidfd_waitid": raw["pidfd_waitid"],
        "finite_rlimits": all(v["meets_minimum"] for v in rlimits.values()),
        "docker_socket_absent": not raw["docker_socket_present"],
    }
    failures = sorted(key for key, value in checks.items() if not value)
    evidence = {"raw": raw, "legacy_decision": legacy_decision, "checks": checks, "failures": failures}
    return {
        "schema": SCHEMA,
        "outcome": "WORKER_SAFETY_BUNDLE_ELIGIBLE_NONAUTHORITY" if not failures else "REJECTED_WORKER_SAFETY_BUNDLE",
        "evidence": evidence,
        "bundle_sha256": _hash(evidence),
        "input_provenance_verified": False,
        "provider_identity_verified": False,
        "safety_verified": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
        "requires_outer_cgroup_tree_kill_witness": True,
        "requires_persisted_server_side_composition": True,
    }


def main() -> int:
    payload = json.load(sys.stdin)
    if not isinstance(payload, dict) or set(payload) != INPUT_KEYS:
        raise ValueError("input keys mismatch")
    source = payload["source"]
    if not isinstance(source, dict) or set(source) != SOURCE_KEYS:
        raise ValueError("source keys mismatch")
    result = collect(source)
    json.dump(result, sys.stdout, sort_keys=True, indent=2)
    sys.stdout.write("\n")
    return 0 if result["outcome"] == "WORKER_SAFETY_BUNDLE_ELIGIBLE_NONAUTHORITY" else 2


if __name__ == "__main__":
    raise SystemExit(main())
