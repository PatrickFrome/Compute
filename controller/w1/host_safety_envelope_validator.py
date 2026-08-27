#!/usr/bin/env python3
"""Deterministic validator for W1 active Linux safety-envelope evidence.

The validator mirrors the live Supabase `linux-h1-h13-v1` requirements but has
no database/provider authority. It accepts only a probe observation and emits a
non-persistent safety decision. Persistence, provider identity, reboot proof,
and final W1 admission remain independent gates.
"""
from __future__ import annotations

import hashlib
import json
import sys
from typing import Any


OBSERVATION_SCHEMA = "metaengine.compute.w1-host-safety-envelope-observation.h205f22.v2"
DECISION_SCHEMA = "metaengine.compute.w1-host-safety-envelope-decision.h205f22.v2"
POLICY_KEY = "linux-h1-h13-v1"
LIVE_POLICY_SHA256 = "3dba3ce69e945e52ff1a2ab23e2981dd543296c72f229673bcc44c94c9e70122"
REQUIRED_CONTROLLERS = {"cpu", "memory", "pids"}
RLIMIT_MINIMUMS = {
    "cpu_seconds": 1,
    "fsize_bytes": 1,
    "address_space_bytes": 268435456,
    "nofile": 64,
    "nproc": 16,
}


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def _object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label}_must_be_object")
    return value


def _bool(value: Any) -> bool:
    return value is True


def _finite_hex(value: Any, length: int) -> bool:
    return isinstance(value, str) and len(value) == length and value == value.lower() and all(c in "0123456789abcdef" for c in value)


def _validate_integrity(observation: dict[str, Any]) -> bool:
    digest = observation.get("evidence_sha256")
    if not _finite_hex(digest, 64):
        return False
    copy = dict(observation)
    copy.pop("evidence_sha256", None)
    return canonical_hash(copy) == digest


def _rlimit_pass(entry: Any, minimum: int) -> bool:
    row = _object(entry, "rlimit")
    soft = row.get("soft")
    hard = row.get("hard")
    if isinstance(soft, bool) or isinstance(hard, bool) or not isinstance(soft, int) or not isinstance(hard, int):
        return False
    return (
        _bool(row.get("soft_finite"))
        and _bool(row.get("hard_finite"))
        and soft >= minimum
        and hard >= soft
    )


def evaluate(observation: dict[str, Any]) -> dict[str, Any]:
    root = _object(observation, "observation")
    source = _object(root.get("source"), "source")
    host = _object(root.get("host"), "host")
    seccomp = _object(root.get("seccomp_filter_canary"), "seccomp_filter_canary")
    pidfd = _object(root.get("pidfd_lifecycle"), "pidfd_lifecycle")
    current_cgroup = _object(root.get("cgroup_current"), "cgroup_current")
    cgroup_canary = _object(root.get("cgroup_tree_canary"), "cgroup_tree_canary")
    workspace = _object(root.get("workspace"), "workspace")
    network = _object(root.get("network"), "network")
    rlimits = _object(root.get("rlimits"), "rlimits")
    authority = _object(root.get("authority"), "authority")

    controllers = current_cgroup.get("controllers")
    controller_set = set(controllers) if isinstance(controllers, list) and all(isinstance(x, str) for x in controllers) else set()

    checks: dict[str, bool] = {
        "schema": root.get("schema") == OBSERVATION_SCHEMA,
        "policy_key": root.get("policy_key") == POLICY_KEY,
        "evidence_integrity": _validate_integrity(root),
        "source_git_sha": _finite_hex(source.get("git_sha"), 40),
        "source_tree_sha": _finite_hex(source.get("tree_sha"), 40),
        "linux": host.get("os") == "linux",
        "supported_arch": host.get("arch") in {"x86_64", "amd64", "aarch64", "arm64", "riscv64"},
        "rootless": isinstance(host.get("effective_uid"), int) and not isinstance(host.get("effective_uid"), bool) and host.get("effective_uid") != 0,
        "no_new_privs": _bool(host.get("no_new_privs")),
        "seccomp_filter_mode": host.get("seccomp_mode") == 2 and isinstance(host.get("seccomp_filters"), int) and host.get("seccomp_filters") >= 1,
        "mount_namespace_isolated": _bool(host.get("mount_namespace_isolated")),
        "seccomp_arch_checked": _bool(seccomp.get("arch_checked")) and seccomp.get("arch") == host.get("arch"),
        "seccomp_active_filter_canary": _bool(seccomp.get("filter_installed")) and _bool(seccomp.get("blocked_syscall")),
        "seccomp_policy_digest": _finite_hex(seccomp.get("policy_digest"), 64),
        "pidfd_open": _bool(pidfd.get("open")),
        "pidfd_send_signal": _bool(pidfd.get("send_signal")),
        "pidfd_waitid": _bool(pidfd.get("waitid")) and _bool(pidfd.get("exit_observed")),
        "cgroup_v2": current_cgroup.get("version") == 2,
        "cgroup_controllers": REQUIRED_CONTROLLERS.issubset(controller_set),
        "cgroup_child_created": _bool(cgroup_canary.get("created")),
        "cgroup_cpu_memory_pids_enforced": _bool(cgroup_canary.get("limits_written")),
        "cgroup_parent_contained": _bool(cgroup_canary.get("parent_contained")),
        "cgroup_descendant_contained": _bool(cgroup_canary.get("grandchild_contained")),
        "cgroup_tree_kill": _bool(cgroup_canary.get("tree_killed")),
        "workspace_dirfd_bound": _bool(workspace.get("dirfd_bound")),
        "workspace_resolve_beneath": _bool(workspace.get("resolve_beneath")) and _bool(workspace.get("parent_escape_blocked")),
        "workspace_no_magiclinks": _bool(workspace.get("no_magiclinks")),
        "workspace_no_symlinks": _bool(workspace.get("no_symlinks")) and _bool(workspace.get("symlink_escape_blocked")),
        "workspace_no_xdev": _bool(workspace.get("no_xdev")),
        "workspace_inside_opened": _bool(workspace.get("inside_opened")),
        "network_namespace_isolated": _bool(network.get("network_namespace_isolated")),
        "network_default_deny": _bool(network.get("default_deny_pass")) and network.get("default_ipv4_route") is False and network.get("default_ipv6_route") is False,
        "authority_neutral": (
            authority.get("canonical") is False
            and authority.get("authority_effect") is False
            and authority.get("worker_admitted") is False
            and authority.get("w1_verified") is False
            and authority.get("persistence_claimed") is False
            and authority.get("provider_mutation") is False
        ),
    }
    for name, minimum in RLIMIT_MINIMUMS.items():
        checks[f"rlimit_{name}"] = _rlimit_pass(rlimits.get(name), minimum)

    failures = sorted(name for name, passed in checks.items() if not passed)
    eligible = not failures
    neutral = {
        "policy_key": POLICY_KEY,
        "policy_sha256": LIVE_POLICY_SHA256,
        "source": source,
        "observation_sha256": root.get("evidence_sha256"),
        "outcome": "SAFETY_ENVELOPE_ELIGIBLE_NON_PERSISTENT" if eligible else "REJECTED_SAFETY_ENVELOPE",
        "checks": checks,
        "failures": failures,
        "safety_eligible": eligible,
        "requires_independent_persistence_receipts": eligible,
    }
    return {
        "schema": DECISION_SCHEMA,
        **neutral,
        "decision_sha256": canonical_hash(neutral),
        "authority": {
            "canonical": False,
            "authority_effect": False,
            "database_mutation": False,
            "provider_mutation": False,
            "worker_admitted": False,
            "w1_verified": False,
        },
    }


def main() -> int:
    value = json.load(sys.stdin)
    decision = evaluate(_object(value, "observation"))
    json.dump(decision, sys.stdout, sort_keys=True, indent=2)
    sys.stdout.write("\n")
    return 0 if decision["safety_eligible"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
