#!/usr/bin/env python3
"""Fail-closed structural verifier for GitHub Codespaces lifecycle snapshots.

This module does not call GitHub and does not trust caller-supplied session IDs.
It consumes raw pre/stop/post Codespace API snapshots, computes canonical hashes,
and derives a session fingerprint from provider-owned fields. A successful result
is still non-authority: authenticated GitHub provenance and persisted Supabase
readback must be verified server-side before any W1 admission decision.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from typing import Any

INPUT_SCHEMA = "metaengine.compute.w1-github-codespaces-snapshot-input.h205f22.v1"
OUTPUT_SCHEMA = "metaengine.compute.w1-github-codespaces-snapshot-oracle.h205f22.v1"

TOP_KEYS = {"schema", "pre", "stopped", "post", "nonclaims"}
NONCLAIM_KEYS = {
    "canonical",
    "authority_effect",
    "provider_identity_verified",
    "provider_action_verified",
    "persistent_worker_proof",
    "worker_admitted",
    "w1_verified",
}

NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,240}$")
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
ENV_RE = re.compile(r"^[A-Za-z0-9._:/-]{1,240}$")


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


def _nonempty_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 512:
        raise ValueError(f"invalid {label}")
    return value


def _timestamp(value: Any, label: str) -> datetime:
    raw = _nonempty_string(value, label)
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError as exc:
        raise ValueError(f"invalid {label}") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{label} must be timezone-aware")
    return parsed.astimezone(timezone.utc)


def _validate_nonclaims(value: Any) -> None:
    obj = _exact_object(value, NONCLAIM_KEYS, "nonclaims")
    for key in NONCLAIM_KEYS:
        if obj[key] is not False:
            raise ValueError(f"{key} must be false")


def _codespace_core(snapshot: Any, label: str) -> dict[str, Any]:
    if not isinstance(snapshot, dict):
        raise ValueError(f"{label} snapshot must be an object")

    required = {
        "id", "name", "environment_id", "repository", "machine", "updated_at",
        "state", "location", "url", "start_url", "stop_url",
    }
    missing = sorted(required - set(snapshot))
    if missing:
        raise ValueError(f"{label} snapshot missing keys: {missing}")

    ident = snapshot["id"]
    if not isinstance(ident, int) or isinstance(ident, bool) or ident <= 0:
        raise ValueError(f"invalid {label} id")

    name = _nonempty_string(snapshot["name"], f"{label} name")
    if not NAME_RE.fullmatch(name):
        raise ValueError(f"invalid {label} name")

    env_id = _nonempty_string(snapshot["environment_id"], f"{label} environment_id")
    if not ENV_RE.fullmatch(env_id):
        raise ValueError(f"invalid {label} environment_id")

    repository = snapshot["repository"]
    if not isinstance(repository, dict):
        raise ValueError(f"{label} repository must be object")
    repo_full_name = _nonempty_string(repository.get("full_name"), f"{label} repository.full_name")
    if not REPO_RE.fullmatch(repo_full_name):
        raise ValueError(f"invalid {label} repository.full_name")

    machine = snapshot["machine"]
    if not isinstance(machine, dict):
        raise ValueError(f"{label} machine must be object")
    operating_system = _nonempty_string(machine.get("operating_system"), f"{label} machine.operating_system")

    state = _nonempty_string(snapshot["state"], f"{label} state")
    location = _nonempty_string(snapshot["location"], f"{label} location")
    updated_at = _timestamp(snapshot["updated_at"], f"{label} updated_at")

    url = _nonempty_string(snapshot["url"], f"{label} url")
    start_url = _nonempty_string(snapshot["start_url"], f"{label} start_url")
    stop_url = _nonempty_string(snapshot["stop_url"], f"{label} stop_url")
    expected_prefix = f"https://api.github.com/user/codespaces/{name}"
    if url != expected_prefix or start_url != expected_prefix + "/start" or stop_url != expected_prefix + "/stop":
        raise ValueError(f"{label} lifecycle URLs not bound to codespace name")

    provider_session_material = {
        "environment_id": env_id,
        "updated_at": updated_at.isoformat(),
        "state": state,
        "location": location,
    }

    return {
        "id": ident,
        "name": name,
        "environment_id": env_id,
        "repo_full_name": repo_full_name,
        "operating_system": operating_system,
        "state": state,
        "location": location,
        "updated_at": updated_at,
        "snapshot_sha256": canonical_hash(snapshot),
        "session_fingerprint_sha256": canonical_hash(provider_session_material),
    }


def evaluate(payload: dict[str, Any]) -> dict[str, Any]:
    root = _exact_object(payload, TOP_KEYS, "input")
    if root["schema"] != INPUT_SCHEMA:
        raise ValueError("unsupported Codespaces snapshot schema")
    _validate_nonclaims(root["nonclaims"])

    pre = _codespace_core(root["pre"], "pre")
    stopped = _codespace_core(root["stopped"], "stopped")
    post = _codespace_core(root["post"], "post")

    stable_id = pre["id"] == stopped["id"] == post["id"]
    stable_name = pre["name"] == stopped["name"] == post["name"]
    stable_repo = pre["repo_full_name"] == stopped["repo_full_name"] == post["repo_full_name"]
    linux = pre["operating_system"] == stopped["operating_system"] == post["operating_system"] == "linux"
    state_sequence = pre["state"] == "Available" and stopped["state"] == "Shutdown" and post["state"] == "Available"
    provider_time_progresses = pre["updated_at"] < stopped["updated_at"] < post["updated_at"]
    pre_post_session_changed = pre["session_fingerprint_sha256"] != post["session_fingerprint_sha256"]

    checks = {
        "provider_object_id_stable": stable_id,
        "provider_object_name_stable": stable_name,
        "repository_binding_stable": stable_repo,
        "provider_reports_linux": linux,
        "provider_state_sequence_available_shutdown_available": state_sequence,
        "provider_updated_at_progresses": provider_time_progresses,
        "provider_session_fingerprint_changed": pre_post_session_changed,
    }
    failures = sorted(key for key, passed in checks.items() if not passed)
    outcome = (
        "CODESPACES_SNAPSHOTS_STRUCTURALLY_ELIGIBLE_NONAUTHORITY"
        if not failures
        else "REJECTED_CODESPACES_SNAPSHOTS"
    )

    evidence = {
        "provider_kind": "GITHUB_CODESPACES",
        "provider_object_id": str(pre["id"]) if stable_id else None,
        "provider_object_name": pre["name"] if stable_name else None,
        "repo_full_name": pre["repo_full_name"] if stable_repo else None,
        "pre_snapshot_sha256": pre["snapshot_sha256"],
        "stopped_snapshot_sha256": stopped["snapshot_sha256"],
        "post_snapshot_sha256": post["snapshot_sha256"],
        "pre_session_fingerprint_sha256": pre["session_fingerprint_sha256"],
        "post_session_fingerprint_sha256": post["session_fingerprint_sha256"],
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
        "requires_authenticated_github_readback": True,
        "requires_kernel_boot_id_change": True,
        "requires_persistent_sentinel_match": True,
        "requires_post_resume_h1_h13": True,
        "requires_persisted_db_composition": True,
    }


def main() -> int:
    payload = json.load(sys.stdin)
    if not isinstance(payload, dict):
        raise ValueError("input must be an object")
    result = evaluate(payload)
    json.dump(result, sys.stdout, sort_keys=True, indent=2)
    sys.stdout.write("\n")
    return 0 if result["outcome"].startswith("CODESPACES_SNAPSHOTS_STRUCTURALLY_ELIGIBLE") else 2


if __name__ == "__main__":
    raise SystemExit(main())
