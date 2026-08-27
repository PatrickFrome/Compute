#!/usr/bin/env python3
"""Fail-closed offline oracle for provider-neutral W1 lifecycle evidence.

This module checks *structural and causal consistency only*. Caller-provided JSON
cannot prove that a provider API response was authentic or persisted in the
continuity plane. Therefore every successful result remains NON-AUTHORITY and
explicitly requires server-side provider validation plus persisted readback.

The oracle is intentionally stricter than a simple "filesystem survived" test:
- the durable provider object must remain identical across the lifecycle boundary;
- the provider/runtime session identifier must change;
- Linux kernel boot_id must change;
- the persistent sentinel hash must remain identical;
- timestamps must establish pre < request <= completion < post;
- provider/action combinations are allow-listed;
- no input may claim canonical/authority/W1 status.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from typing import Any

INPUT_SCHEMA = "metaengine.compute.w1-provider-lifecycle-oracle-input.h205f22.v1"
OUTPUT_SCHEMA = "metaengine.compute.w1-provider-lifecycle-oracle.h205f22.v1"

SUPPORTED_PROVIDER_ACTIONS = {
    "GITHUB_CODESPACES": {"STOP_RESUME"},
    "VERCEL_SANDBOX": {"STOP_RESUME"},
    "AWS_EC2": {"REBOOT"},
}

TOP_KEYS = {"schema", "provider", "pre", "post", "nonclaims"}
PROVIDER_KEYS = {
    "provider_kind",
    "pre_object_id",
    "post_object_id",
    "pre_session_id",
    "post_session_id",
    "action_kind",
    "requested_at",
    "completed_at",
    "provider_readback_sha256",
}
OBS_KEYS = {"captured_at", "os", "boot_id", "sentinel_sha256"}
NONCLAIM_KEYS = {
    "canonical",
    "authority_effect",
    "persistent_worker_proof",
    "worker_admitted",
    "w1_verified",
}

OBJECT_RE = re.compile(r"^[A-Za-z0-9._:/-]{1,240}$")
SESSION_RE = re.compile(r"^[A-Za-z0-9._:/-]{1,240}$")
BOOT_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _exact_object(value: Any, keys: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    diff = set(value) ^ keys
    if diff:
        raise ValueError(f"{label} keys mismatch: {sorted(diff)}")
    return value


def _string(value: Any, pattern: re.Pattern[str], label: str) -> str:
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise ValueError(f"invalid {label}")
    return value


def _timestamp(value: Any, label: str) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise ValueError(f"{label} must be canonical UTC ISO-8601 ending in Z")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise ValueError(f"invalid {label}") from exc
    if parsed.tzinfo is None or parsed.utcoffset() != timezone.utc.utcoffset(parsed):
        raise ValueError(f"{label} must be UTC")
    return parsed


def _validate_nonclaims(value: Any) -> dict[str, bool]:
    obj = _exact_object(value, NONCLAIM_KEYS, "nonclaims")
    for key in NONCLAIM_KEYS:
        if obj[key] is not False:
            raise ValueError(f"{key} must be false")
    return {key: False for key in sorted(NONCLAIM_KEYS)}


def evaluate(payload: dict[str, Any]) -> dict[str, Any]:
    root = _exact_object(payload, TOP_KEYS, "input")
    if root["schema"] != INPUT_SCHEMA:
        raise ValueError("unsupported lifecycle oracle schema")

    provider = _exact_object(root["provider"], PROVIDER_KEYS, "provider")
    pre = _exact_object(root["pre"], OBS_KEYS, "pre")
    post = _exact_object(root["post"], OBS_KEYS, "post")
    _validate_nonclaims(root["nonclaims"])

    provider_kind = provider["provider_kind"]
    action_kind = provider["action_kind"]
    if provider_kind not in SUPPORTED_PROVIDER_ACTIONS:
        raise ValueError("unsupported provider_kind")
    if action_kind not in SUPPORTED_PROVIDER_ACTIONS[provider_kind]:
        raise ValueError("provider/action combination not allowed")

    pre_object_id = _string(provider["pre_object_id"], OBJECT_RE, "pre_object_id")
    post_object_id = _string(provider["post_object_id"], OBJECT_RE, "post_object_id")
    pre_session_id = _string(provider["pre_session_id"], SESSION_RE, "pre_session_id")
    post_session_id = _string(provider["post_session_id"], SESSION_RE, "post_session_id")
    readback_sha = _string(provider["provider_readback_sha256"], SHA256_RE, "provider_readback_sha256")

    pre_boot = _string(pre["boot_id"], BOOT_RE, "pre boot_id")
    post_boot = _string(post["boot_id"], BOOT_RE, "post boot_id")
    pre_sentinel = _string(pre["sentinel_sha256"], SHA256_RE, "pre sentinel_sha256")
    post_sentinel = _string(post["sentinel_sha256"], SHA256_RE, "post sentinel_sha256")
    if pre["os"] != "linux" or post["os"] != "linux":
        raise ValueError("real Linux pre/post observations required")

    pre_at = _timestamp(pre["captured_at"], "pre captured_at")
    requested_at = _timestamp(provider["requested_at"], "requested_at")
    completed_at = _timestamp(provider["completed_at"], "completed_at")
    post_at = _timestamp(post["captured_at"], "post captured_at")

    checks = {
        "provider_object_identity_stable": pre_object_id == post_object_id,
        "provider_session_identity_changed": pre_session_id != post_session_id,
        "kernel_boot_id_changed": pre_boot != post_boot,
        "persistent_sentinel_hash_equal_pre_post": pre_sentinel == post_sentinel,
        "real_linux_execution_pre_and_post": pre["os"] == post["os"] == "linux",
        "chronology": pre_at < requested_at <= completed_at < post_at,
        "provider_readback_digest_structural": bool(SHA256_RE.fullmatch(readback_sha)),
    }
    failures = sorted(key for key, passed in checks.items() if not passed)
    if failures:
        outcome = "REJECTED_LIFECYCLE_EVIDENCE"
    else:
        outcome = "LIFECYCLE_EVIDENCE_STRUCTURALLY_ELIGIBLE_NONAUTHORITY"

    evidence = {
        "provider_kind": provider_kind,
        "provider_object_id": pre_object_id if checks["provider_object_identity_stable"] else None,
        "action_kind": action_kind,
        "pre_session_id": pre_session_id,
        "post_session_id": post_session_id,
        "pre_boot_id": pre_boot,
        "post_boot_id": post_boot,
        "sentinel_sha256": pre_sentinel if checks["persistent_sentinel_hash_equal_pre_post"] else None,
        "provider_readback_sha256": readback_sha,
        "checks": checks,
        "failures": failures,
        "asserted_input_sha256": canonical_hash(root),
    }

    return {
        "schema": OUTPUT_SCHEMA,
        "outcome": outcome,
        "evidence": evidence,
        "oracle_sha256": canonical_hash(evidence),
        "input_provenance_verified": False,
        "provider_identity_verified": False,
        "provider_action_verified": False,
        "persisted_readback_verified": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
        "requires_server_side_provider_validation": True,
        "requires_persisted_db_composition": True,
        "requires_post_resume_h1_h13": True,
        "requires_supervisor_verification": True,
    }


def main() -> int:
    payload = json.load(sys.stdin)
    if not isinstance(payload, dict):
        raise ValueError("input must be an object")
    result = evaluate(payload)
    json.dump(result, sys.stdout, sort_keys=True, indent=2)
    sys.stdout.write("\n")
    return 0 if result["outcome"].startswith("LIFECYCLE_EVIDENCE_STRUCTURALLY_ELIGIBLE") else 2


if __name__ == "__main__":
    raise SystemExit(main())
