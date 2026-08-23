#!/usr/bin/env python3
"""Deterministic, fail-closed W1 Linux host safety gate.

This module consumes only local host capability observations. It deliberately
cannot accept persistence/reboot/identity claims from the host itself.

Outcomes:
- REJECTED_CAPABILITY
- SAFETY_ELIGIBLE_NON_PERSISTENT

A later, separate compositor may form an admission candidate only from this
safety receipt plus independently verified provider-reboot and host-identity
receipts. This module never admits a worker and never grants project authority.

CLI input is stdin-only and output is stdout-only. This avoids turning
untrusted observation fields or CLI path arguments into filesystem I/O.
"""
from __future__ import annotations

import hashlib
import json
import sys
from typing import Any

OBSERVATION_SCHEMA = "metaengine.compute.w1-host-safety-observation.h205f22.v1"
DECISION_SCHEMA = "metaengine.compute.w1-host-safety-decision.h205f22.v1"
REQUIRED_CONTROLLERS = {"cpu", "memory", "pids"}

POLICY = {
    "policy_key": "w1-linux-host-safety-v1",
    "required_os": "linux",
    "required_cgroup_version": 2,
    "require_unified_cgroup_hierarchy": True,
    "required_controllers": sorted(REQUIRED_CONTROLLERS),
    "require_cgroup_kill": True,
    "require_non_root_euid": True,
    "require_no_new_privs": True,
    "required_seccomp_mode": 2,
    "require_mount_namespace_isolation": True,
    "require_pidfd": True,
    "require_openat2_beneath": True,
}

TOP_KEYS = {"schema", "policy_sha256", "source", "host"}
SOURCE_KEYS = {"git_sha", "tree_sha"}
HOST_KEYS = {
    "os", "euid", "no_new_privs", "seccomp_mode", "mount_namespace_isolated",
    "cgroup", "pidfd_pass", "openat2_beneath_pass",
}
CGROUP_KEYS = {"version", "unified", "controllers", "kill_supported"}


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


POLICY_SHA256 = canonical_hash(POLICY)


def _require_exact_keys(value: Any, expected: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    diff = set(value) ^ expected
    if diff:
        raise ValueError(f"{label} keys mismatch: {sorted(diff)}")
    return value


def _sha(value: Any, label: str, length: int = 64) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{label} must be a string")
    if value != value.lower():
        raise ValueError(f"{label} must use canonical lowercase hex")
    if len(value) != length or any(c not in "0123456789abcdef" for c in value):
        raise ValueError(f"invalid {label}")
    return value


def _plain_int(value: Any, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValueError(f"invalid {label}")
    return value


def validate_observation(observation: dict[str, Any]) -> None:
    _require_exact_keys(observation, TOP_KEYS, "observation")
    if observation["schema"] != OBSERVATION_SCHEMA:
        raise ValueError("unsupported observation schema")
    if _sha(observation["policy_sha256"], "policy_sha256") != POLICY_SHA256:
        raise ValueError("policy_sha256 mismatch")

    source = _require_exact_keys(observation["source"], SOURCE_KEYS, "source")
    _sha(source["git_sha"], "git_sha", 40)
    _sha(source["tree_sha"], "tree_sha", 40)

    host = _require_exact_keys(observation["host"], HOST_KEYS, "host")
    if not isinstance(host["os"], str):
        raise ValueError("os must be a string")
    _plain_int(host["euid"], "euid")
    _plain_int(host["seccomp_mode"], "seccomp_mode")
    for key in ("no_new_privs", "mount_namespace_isolated", "pidfd_pass", "openat2_beneath_pass"):
        if not isinstance(host[key], bool):
            raise ValueError(f"{key} must be boolean")

    cgroup = _require_exact_keys(host["cgroup"], CGROUP_KEYS, "cgroup")
    version = _plain_int(cgroup["version"], "cgroup version")
    if version not in (1, 2):
        raise ValueError("unsupported cgroup version")
    if not isinstance(cgroup["unified"], bool) or not isinstance(cgroup["kill_supported"], bool):
        raise ValueError("invalid cgroup booleans")
    controllers = cgroup["controllers"]
    if not isinstance(controllers, list) or any(not isinstance(item, str) for item in controllers):
        raise ValueError("controllers must be list[str]")


def _safety_checks(observation: dict[str, Any]) -> dict[str, bool]:
    host = observation["host"]
    cgroup = host["cgroup"]
    controllers = set(cgroup["controllers"])
    return {
        "linux": host["os"] == POLICY["required_os"],
        "rootless": host["euid"] != 0,
        "no_new_privs": host["no_new_privs"] is True,
        "seccomp_filter_mode": host["seccomp_mode"] == POLICY["required_seccomp_mode"],
        "mount_namespace_isolated": host["mount_namespace_isolated"] is True,
        "cgroup_v2": cgroup["version"] == POLICY["required_cgroup_version"],
        "cgroup_unified": cgroup["unified"] is True,
        "required_cgroup_controllers": REQUIRED_CONTROLLERS.issubset(controllers),
        "cgroup_kill": cgroup["kill_supported"] is True,
        "pidfd": host["pidfd_pass"] is True,
        "openat2_beneath": host["openat2_beneath_pass"] is True,
    }


def evaluate(observation: dict[str, Any]) -> dict[str, Any]:
    validate_observation(observation)
    safety = _safety_checks(observation)
    capability_failures = sorted(key for key, passed in safety.items() if not passed)
    outcome = "REJECTED_CAPABILITY" if capability_failures else "SAFETY_ELIGIBLE_NON_PERSISTENT"

    neutral = {
        "policy_sha256": POLICY_SHA256,
        "source": observation["source"],
        "outcome": outcome,
        "safety_checks": safety,
        "capability_failures": capability_failures,
        "safety_eligible": not capability_failures,
        "admission_candidate": False,
        "requires_independent_persistence_receipts": not capability_failures,
    }
    return {
        "schema": DECISION_SCHEMA,
        **neutral,
        "decision_sha256": canonical_hash(neutral),
        "authority": {
            "authority_effect": False,
            "canonical": False,
            "project_claim_authority": False,
            "worker_admitted": False,
            "w1_verified": False,
        },
    }


def main() -> int:
    observation = json.load(sys.stdin)
    if not isinstance(observation, dict):
        raise ValueError("observation must be an object")
    decision = evaluate(observation)
    json.dump(decision, sys.stdout, sort_keys=True, indent=2)
    sys.stdout.write("\n")
    return 0 if decision["outcome"] == "SAFETY_ELIGIBLE_NON_PERSISTENT" else 2


if __name__ == "__main__":
    raise SystemExit(main())
