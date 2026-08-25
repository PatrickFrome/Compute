#!/usr/bin/env python3
"""Non-authority W1 two-plane safety witness v2.

V2 makes the pair-decided semantics explicit: `worker_rootless` describes the
candidate WORKER, while a trusted outer control plane may own cgroup controls.
The outer privilege never counts as worker privilege. This validator consumes
normalized raw facts only; it does not authenticate their provenance, admit a
worker, or assert W1.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from typing import Any

SCHEMA = "metaengine.compute.w1-two-plane-safety-input.h205f22.v2"
OUTPUT_SCHEMA = "metaengine.compute.w1-two-plane-safety-witness.h205f22.v2"
HEX40 = re.compile(r"^[0-9a-f]{40}$")
ROOT_KEYS = {"schema", "source", "outer", "inner", "runtime", "cgroup"}
SOURCE_KEYS = {"git_sha", "tree_sha"}
OUTER_KEYS = {"mount_ns_inode", "pid_ns_inode", "net_ns_inode"}
INNER_KEYS = {"mount_ns_inode", "pid_ns_inode", "net_ns_inode", "euid", "no_new_privs", "seccomp_mode", "cap_eff_zero", "network_default_deny"}
RUNTIME_KEYS = {"worker_rootless", "worker_has_control_socket", "host_pid_shared", "host_network_shared", "privileged"}
CGROUP_KEYS = {"exact_target_valid", "cpu_limited", "memory_limited", "pids_limited", "tree_kill_proven", "prebound_before_outer_privilege", "worker_launch_via_outer_privilege", "worker_exec_via_outer_privilege"}


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return hashlib.sha256(raw).hexdigest()


def _exact(value: Any, keys: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be object")
    diff = set(value) ^ keys
    if diff:
        raise ValueError(f"{label} keys mismatch: {sorted(diff)}")
    return value


def _int(value: Any, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValueError(f"invalid {label}")
    return value


def _bools(obj: dict[str, Any], keys: set[str], label: str) -> None:
    for key in keys:
        if not isinstance(obj[key], bool):
            raise ValueError(f"{label}.{key} must be boolean")


def evaluate(payload: dict[str, Any]) -> dict[str, Any]:
    root = _exact(payload, ROOT_KEYS, "input")
    if root["schema"] != SCHEMA:
        raise ValueError("unsupported schema")

    source = _exact(root["source"], SOURCE_KEYS, "source")
    for key in SOURCE_KEYS:
        if not isinstance(source[key], str) or not HEX40.fullmatch(source[key]):
            raise ValueError(f"invalid source.{key}")

    outer = _exact(root["outer"], OUTER_KEYS, "outer")
    for key in OUTER_KEYS:
        _int(outer[key], f"outer.{key}")

    inner = _exact(root["inner"], INNER_KEYS, "inner")
    for key in ("mount_ns_inode", "pid_ns_inode", "net_ns_inode", "euid", "seccomp_mode"):
        _int(inner[key], f"inner.{key}")
    _bools(inner, {"no_new_privs", "cap_eff_zero", "network_default_deny"}, "inner")

    runtime = _exact(root["runtime"], RUNTIME_KEYS, "runtime")
    _bools(runtime, RUNTIME_KEYS, "runtime")
    cgroup = _exact(root["cgroup"], CGROUP_KEYS, "cgroup")
    _bools(cgroup, CGROUP_KEYS, "cgroup")

    checks = {
        "mount_namespace_distinct_outer_inner": inner["mount_ns_inode"] != outer["mount_ns_inode"],
        "network_namespace_distinct_outer_inner": inner["net_ns_inode"] != outer["net_ns_inode"],
        # PID separation is recorded below but is not a linux-h1-h13-v1 gate.
        "inner_nonroot": inner["euid"] != 0,
        "inner_no_new_privs": inner["no_new_privs"] is True,
        "inner_seccomp_filter": inner["seccomp_mode"] == 2,
        "inner_cap_eff_zero": inner["cap_eff_zero"] is True,
        "inner_network_default_deny": inner["network_default_deny"] is True,
        "worker_rootless": runtime["worker_rootless"] is True,
        "worker_has_no_outer_control_socket": runtime["worker_has_control_socket"] is False,
        "no_host_pid_sharing": runtime["host_pid_shared"] is False,
        "no_host_network_sharing": runtime["host_network_shared"] is False,
        "worker_not_privileged": runtime["privileged"] is False,
        "cgroup_exact_target": cgroup["exact_target_valid"] is True,
        "cgroup_cpu_limited": cgroup["cpu_limited"] is True,
        "cgroup_memory_limited": cgroup["memory_limited"] is True,
        "cgroup_pids_limited": cgroup["pids_limited"] is True,
        "cgroup_tree_kill": cgroup["tree_kill_proven"] is True,
        "outer_privilege_after_prebinding": cgroup["prebound_before_outer_privilege"] is True,
        "worker_not_launched_via_outer_privilege": cgroup["worker_launch_via_outer_privilege"] is False,
        "worker_not_execed_via_outer_privilege": cgroup["worker_exec_via_outer_privilege"] is False,
    }
    failures = sorted(k for k, ok in checks.items() if not ok)
    evidence = {
        "source": source,
        "checks": checks,
        "failures": failures,
        "pid_namespace_distinct_observed": inner["pid_ns_inode"] != outer["pid_ns_inode"],
        "outer_digest": canonical_hash(outer),
        "inner_digest": canonical_hash(inner),
        "runtime_digest": canonical_hash(runtime),
        "cgroup_digest": canonical_hash(cgroup),
    }
    return {
        "schema": OUTPUT_SCHEMA,
        "outcome": "TWO_PLANE_SAFETY_ELIGIBLE_NONAUTHORITY" if not failures else "REJECTED_TWO_PLANE_SAFETY",
        "evidence": evidence,
        "witness_sha256": canonical_hash(evidence),
        "input_provenance_verified": False,
        "provider_identity_verified": False,
        "persistent_worker_proof": False,
        "safety_verified": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
        "requires_authenticated_outer_inner_receipts": True,
        "requires_persisted_server_side_composition": True,
    }


def main() -> int:
    raw = json.load(sys.stdin)
    if not isinstance(raw, dict):
        raise ValueError("input must be object")
    result = evaluate(raw)
    json.dump(result, sys.stdout, sort_keys=True, indent=2)
    sys.stdout.write("\n")
    return 0 if result["outcome"] == "TWO_PLANE_SAFETY_ELIGIBLE_NONAUTHORITY" else 2


if __name__ == "__main__":
    raise SystemExit(main())
