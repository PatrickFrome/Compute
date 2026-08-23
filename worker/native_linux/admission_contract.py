#!/usr/bin/env python3
"""Deterministic, fail-closed W1 Linux worker admission contract.

This module does not admit a worker and never grants project authority.
It turns persisted host observations into one of three non-authoritative states:

- REJECTED_CAPABILITY
- SAFETY_ELIGIBLE_NON_PERSISTENT
- ADMISSION_CANDIDATE

Actual worker admission/canonical W1 verification is a separate authority-bearing step.

CLI input is stdin-only and output is stdout-only. This deliberately avoids
turning untrusted observation fields or CLI path arguments into filesystem I/O.
"""
from __future__ import annotations

import hashlib
import json
import sys
from typing import Any

OBSERVATION_SCHEMA = "metaengine.compute.w1-host-observation.h205f22.v1"
DECISION_SCHEMA = "metaengine.compute.w1-admission-decision.h205f22.v1"
REQUIRED_CONTROLLERS = {"cpu", "memory", "pids"}

POLICY = {
    "policy_key": "w1-linux-admission-v1",
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
    "persistent_candidate_requires_provider_reboot": True,
    "persistent_candidate_requires_identity_binding": True,
}

TOP_KEYS = {"schema", "policy_sha256", "source", "host", "persistence"}
SOURCE_KEYS = {"git_sha", "tree_sha"}
HOST_KEYS = {"os", "euid", "no_new_privs", "seccomp_mode", "mount_namespace_isolated", "cgroup", "pidfd_pass", "openat2_beneath_pass"}
CGROUP_KEYS = {"version", "unified", "controllers", "kill_supported"}
PERSISTENCE_KEYS = {
    "persistent_worker_proof", "provider_reboot_proof", "identity_binding_proof",
    "same_worker_before_after_reboot", "before_boot_id_sha256", "after_boot_id_sha256",
    "provider_event_sha256", "host_identity_sha256", "provider_event_identity_source",
    "host_identity_source",
}

ALLOWED_PROVIDER_IDENTITY_SOURCE = "INDEPENDENT_PROVIDER_API_BYTES"
ALLOWED_HOST_IDENTITY_SOURCE = "PERSISTED_HOST_OBSERVATION_BYTES"


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
    text = value.lower()
    if len(text) != length or any(c not in "0123456789abcdef" for c in text):
        raise ValueError(f"invalid {label}")
    return text


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
    if not isinstance(cgroup["controllers"], list) or any(not isinstance(x, str) for x in cgroup["controllers"]):
        raise ValueError("controllers must be list[str]")

    persistence = _require_exact_keys(observation["persistence"], PERSISTENCE_KEYS, "persistence")
    for key in ("persistent_worker_proof", "provider_reboot_proof", "identity_binding_proof", "same_worker_before_after_reboot"):
        if not isinstance(persistence[key], bool):
            raise ValueError(f"{key} must be boolean")

    for key in ("before_boot_id_sha256", "after_boot_id_sha256", "provider_event_sha256", "host_identity_sha256"):
        value = persistence[key]
        if value is not None:
            _sha(value, key)

    if persistence["provider_event_identity_source"] not in (None, ALLOWED_PROVIDER_IDENTITY_SOURCE):
        raise ValueError("untrusted provider event identity source")
    if persistence["host_identity_source"] not in (None, ALLOWED_HOST_IDENTITY_SOURCE):
        raise ValueError("untrusted host identity source")


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
        "cgroup_v2": cgroup["version"] == 2,
        "cgroup_unified": cgroup["unified"] is True,
        "required_cgroup_controllers": REQUIRED_CONTROLLERS.issubset(controllers),
        "cgroup_kill": cgroup["kill_supported"] is True,
        "pidfd": host["pidfd_pass"] is True,
        "openat2_beneath": host["openat2_beneath_pass"] is True,
    }


def _persistence_checks(observation: dict[str, Any]) -> dict[str, bool]:
    p = observation["persistence"]
    before = p["before_boot_id_sha256"]
    after = p["after_boot_id_sha256"]
    return {
        "persistent_worker_proof": p["persistent_worker_proof"] is True,
        "provider_reboot_proof": p["provider_reboot_proof"] is True,
        "identity_binding_proof": p["identity_binding_proof"] is True,
        "same_worker_before_after_reboot": p["same_worker_before_after_reboot"] is True,
        "boot_id_changed": isinstance(before, str) and isinstance(after, str) and before != after,
        "provider_event_bound": isinstance(p["provider_event_sha256"], str) and p["provider_event_identity_source"] == ALLOWED_PROVIDER_IDENTITY_SOURCE,
        "host_identity_bound": isinstance(p["host_identity_sha256"], str) and p["host_identity_source"] == ALLOWED_HOST_IDENTITY_SOURCE,
    }


def evaluate(observation: dict[str, Any]) -> dict[str, Any]:
    validate_observation(observation)
    safety = _safety_checks(observation)
    persistence = _persistence_checks(observation)
    capability_failures = sorted(k for k, passed in safety.items() if not passed)
    persistence_failures = sorted(k for k, passed in persistence.items() if not passed)

    if capability_failures:
        outcome = "REJECTED_CAPABILITY"
    elif persistence_failures:
        outcome = "SAFETY_ELIGIBLE_NON_PERSISTENT"
    else:
        outcome = "ADMISSION_CANDIDATE"

    neutral = {
        "policy_sha256": POLICY_SHA256,
        "source": observation["source"],
        "outcome": outcome,
        "safety_checks": safety,
        "persistence_checks": persistence,
        "capability_failures": capability_failures,
        "persistence_failures": persistence_failures,
        "admission_candidate": outcome == "ADMISSION_CANDIDATE",
    }
    return {
        "schema": DECISION_SCHEMA,
        **neutral,
        "decision_sha256": canonical_hash(neutral),
        "authority": {"authority_effect": False, "canonical": False, "project_claim_authority": False, "worker_admitted": False, "w1_verified": False},
    }


def main() -> int:
    observation = json.load(sys.stdin)
    if not isinstance(observation, dict):
        raise ValueError("observation must be an object")
    decision = evaluate(observation)
    json.dump(decision, sys.stdout, sort_keys=True, indent=2)
    sys.stdout.write("\n")
    return 0 if decision["outcome"] != "REJECTED_CAPABILITY" else 2


if __name__ == "__main__":
    raise SystemExit(main())
