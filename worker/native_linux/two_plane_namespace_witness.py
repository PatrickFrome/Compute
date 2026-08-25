#!/usr/bin/env python3
"""Non-authority validator for outer/inner Linux namespace observations.

This fixes a measurement weakness in the legacy local collector: comparing
/proc/self/ns/mnt with /proc/1/ns/mnt is not sufficient inside a normal PID
namespace because PID 1 is then the container's own init process. A caller must
never use host PID sharing merely to make that comparison differ.

The witness does not create namespaces, execute Docker, admit a worker, or
assert W1. It validates two independently captured raw planes:
- outer: durable provider host/container environment;
- inner: candidate worker sandbox.

Production evidence still requires provider-authenticated/persisted receipts.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from typing import Any

SCHEMA = "metaengine.compute.w1-two-plane-namespace-input.h205f22.v1"
OUTPUT_SCHEMA = "metaengine.compute.w1-two-plane-namespace-witness.h205f22.v1"
HEX40 = re.compile(r"^[0-9a-f]{40}$")

ROOT_KEYS = {"schema", "source", "outer", "inner", "runtime"}
SOURCE_KEYS = {"git_sha", "tree_sha"}
PLANE_KEYS = {"mount_ns_inode", "pid_ns_inode", "euid", "no_new_privs", "seccomp_mode"}
RUNTIME_KEYS = {"container_runtime", "rootless_runtime", "host_pid_shared", "host_network_shared", "privileged"}


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


def _plain_int(value: Any, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValueError(f"invalid {label}")
    return value


def _plane(value: Any, label: str) -> dict[str, Any]:
    obj = _exact(value, PLANE_KEYS, label)
    for key in ("mount_ns_inode", "pid_ns_inode", "euid", "seccomp_mode"):
        _plain_int(obj[key], f"{label}.{key}")
    if not isinstance(obj["no_new_privs"], bool):
        raise ValueError(f"{label}.no_new_privs must be boolean")
    return obj


def evaluate(payload: dict[str, Any]) -> dict[str, Any]:
    root = _exact(payload, ROOT_KEYS, "input")
    if root["schema"] != SCHEMA:
        raise ValueError("unsupported schema")
    source = _exact(root["source"], SOURCE_KEYS, "source")
    for key in SOURCE_KEYS:
        if not isinstance(source[key], str) or not HEX40.fullmatch(source[key]):
            raise ValueError(f"invalid {key}")
    outer = _plane(root["outer"], "outer")
    inner = _plane(root["inner"], "inner")
    runtime = _exact(root["runtime"], RUNTIME_KEYS, "runtime")
    if runtime["container_runtime"] not in ("docker", "podman", "other"):
        raise ValueError("unsupported container_runtime")
    for key in ("rootless_runtime", "host_pid_shared", "host_network_shared", "privileged"):
        if not isinstance(runtime[key], bool):
            raise ValueError(f"runtime.{key} must be boolean")

    checks = {
        "mount_namespace_distinct_outer_inner": inner["mount_ns_inode"] != outer["mount_ns_inode"],
        "pid_namespace_distinct_outer_inner": inner["pid_ns_inode"] != outer["pid_ns_inode"],
        "inner_nonroot": inner["euid"] != 0,
        "inner_no_new_privs": inner["no_new_privs"] is True,
        "inner_seccomp_filter": inner["seccomp_mode"] == 2,
        "runtime_rootless": runtime["rootless_runtime"] is True,
        "no_host_pid_sharing": runtime["host_pid_shared"] is False,
        "no_host_network_sharing": runtime["host_network_shared"] is False,
        "not_privileged": runtime["privileged"] is False,
    }
    failures = sorted(k for k, ok in checks.items() if not ok)
    evidence = {
        "source": source,
        "checks": checks,
        "failures": failures,
        "outer_namespace_digest": canonical_hash(outer),
        "inner_namespace_digest": canonical_hash(inner),
        "runtime_digest": canonical_hash(runtime),
    }
    return {
        "schema": OUTPUT_SCHEMA,
        "outcome": "TWO_PLANE_NAMESPACE_ELIGIBLE_NONAUTHORITY" if not failures else "REJECTED_TWO_PLANE_NAMESPACE",
        "evidence": evidence,
        "witness_sha256": canonical_hash(evidence),
        "input_provenance_verified": False,
        "provider_identity_verified": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
        "requires_authenticated_outer_collector": True,
        "requires_persisted_readback": True,
    }


def main() -> int:
    raw = json.load(sys.stdin)
    if not isinstance(raw, dict):
        raise ValueError("input must be object")
    result = evaluate(raw)
    json.dump(result, sys.stdout, sort_keys=True, indent=2)
    sys.stdout.write("\n")
    return 0 if result["outcome"].startswith("TWO_PLANE_NAMESPACE_ELIGIBLE") else 2


if __name__ == "__main__":
    raise SystemExit(main())
