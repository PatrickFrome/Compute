#!/usr/bin/env python3
"""Compose and validate machine-readable, non-authority W1 S2 runtime receipts.

A green GitHub Actions job is not itself proof that S2 executed: hosted runners
may legitimately reject the rootless namespace bootstrap. This module makes the
three outcomes explicit and fail-closed:

- PASS_NONAUTHORITY: launcher rc=0 and every required runtime marker is present.
- UNAVAILABLE_FAIL_CLOSED: launcher rc=78 with a sandbox-unavailable diagnostic.
- FAILED: any other result or inconsistent marker set.

No outcome admits a worker or verifies W1. Provider lifecycle evidence and
persisted Supabase readback remain separate authority-bearing gates.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

SCHEMA = "metaengine.compute.w1-s2-runtime-canary-receipt.h205f22.v1"
SOURCE_SHA_RE = re.compile(r"^[0-9a-f]{64}$")
RECEIPT_SHA_RE = SOURCE_SHA_RE

PASS_MARKERS = {
    "WORKER_IS_NOT_PID1": "true",
    "PARENT_IS_NAMESPACE_PID1": "true",
    "NO_NEW_PRIVS": "1",
    "SECCOMP": "2",
    "ROOT_FS": "tmpfs",
    "OLDROOT_DETACHED": "true",
    "WORKSPACE_RW": "true",
    "NETWORK_DEFAULT_DENY": "true",
    "RLIMIT_CORE_ZERO": "true",
    "PID1_ENVIRON_DENIED": "true",
    "CANONICAL": "false",
    "AUTHORITY_EFFECT": "false",
    "WORKER_ADMITTED": "false",
    "W1_VERIFIED": "false",
}
TOP_KEYS = {
    "schema", "status", "evidence", "receipt_sha256", "canonical",
    "authority_effect", "provider_identity_verified", "provider_action_verified",
    "persistent_worker_proof", "worker_admitted", "w1_verified",
}
EVIDENCE_KEYS = {
    "source_sha256", "launcher_rc", "status", "reason_class",
    "diagnostic_sha256", "markers", "missing_or_bad_pass_markers", "runner",
}
RUNNER_KEYS = {"run_id", "run_attempt", "runner_os", "runner_arch", "head_sha"}
NONCLAIM_KEYS = {
    "canonical", "authority_effect", "provider_identity_verified",
    "provider_action_verified", "persistent_worker_proof", "worker_admitted",
    "w1_verified",
}
ALLOWED_STATUSES = {"PASS_NONAUTHORITY", "UNAVAILABLE_FAIL_CLOSED", "FAILED"}


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _canonical_evidence_hash(evidence: dict[str, Any]) -> str:
    return _sha256_text(json.dumps(evidence, sort_keys=True, separators=(",", ":")))


def _exact_object(value: Any, keys: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    diff = set(value) ^ keys
    if diff:
        raise ValueError(f"{label} keys mismatch: {sorted(diff)}")
    return value


def _validate_runner(runner: Any) -> dict[str, str]:
    obj = _exact_object(runner, RUNNER_KEYS, "runner")
    out: dict[str, str] = {}
    for key, value in obj.items():
        if not isinstance(value, str) or not value or len(value) > 160:
            raise ValueError(f"invalid runner.{key}")
        out[key] = value
    return out


def _parse_markers(text: str) -> dict[str, str]:
    markers: dict[str, str] = {}
    for line in text.splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key in PASS_MARKERS or key in {"EUID", "PID", "PPID"}:
            markers[key] = value
    return markers


def _reason_class(text: str) -> str:
    lowered = text.lower()
    if "/proc/self/setgroups" in lowered and ("permission denied" in lowered or "eacces" in lowered):
        return "USER_NAMESPACE_SETGROUPS_DENIED"
    if "unshare user namespace failed" in lowered:
        return "USER_NAMESPACE_UNSHARE_DENIED"
    if "unshare pid namespace failed" in lowered:
        return "PID_NAMESPACE_UNSHARE_DENIED"
    if "unshare mount namespace failed" in lowered:
        return "MOUNT_NAMESPACE_UNSHARE_DENIED"
    if "unshare network namespace failed" in lowered:
        return "NETWORK_NAMESPACE_UNSHARE_DENIED"
    if "pivot_root failed" in lowered:
        return "PIVOT_ROOT_DENIED"
    if "w1_s2_sandbox_unavailable:" in lowered:
        return "SANDBOX_UNAVAILABLE_OTHER"
    return "UNCLASSIFIED_FAILURE"


def compose(*, launcher_rc: int, output: str, source_sha256: str, runner: dict[str, str]) -> dict[str, Any]:
    if not isinstance(launcher_rc, int) or isinstance(launcher_rc, bool) or launcher_rc < 0 or launcher_rc > 255:
        raise ValueError("launcher_rc must be an integer in [0,255]")
    if not isinstance(output, str):
        raise ValueError("output must be text")
    if not isinstance(source_sha256, str) or not SOURCE_SHA_RE.fullmatch(source_sha256):
        raise ValueError("source_sha256 must be lowercase sha256")
    runner = _validate_runner(runner)

    markers = _parse_markers(output)
    missing_or_bad = sorted(key for key, expected in PASS_MARKERS.items() if markers.get(key) != expected)
    diagnostic_present = "W1_S2_SANDBOX_UNAVAILABLE:" in output

    if launcher_rc == 0 and not missing_or_bad:
        status = "PASS_NONAUTHORITY"
        reason_class = None
    elif launcher_rc == 78 and diagnostic_present:
        status = "UNAVAILABLE_FAIL_CLOSED"
        reason_class = _reason_class(output)
    else:
        status = "FAILED"
        reason_class = _reason_class(output)

    evidence = {
        "source_sha256": source_sha256,
        "launcher_rc": launcher_rc,
        "status": status,
        "reason_class": reason_class,
        "diagnostic_sha256": _sha256_text(output),
        "markers": markers,
        "missing_or_bad_pass_markers": missing_or_bad,
        "runner": runner,
    }
    return {
        "schema": SCHEMA,
        "status": status,
        "evidence": evidence,
        "receipt_sha256": _canonical_evidence_hash(evidence),
        "canonical": False,
        "authority_effect": False,
        "provider_identity_verified": False,
        "provider_action_verified": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
    }


def validate(value: Any, *, require_pass: bool = False, expected_source_sha256: str | None = None) -> dict[str, Any]:
    root = _exact_object(value, TOP_KEYS, "receipt")
    if root["schema"] != SCHEMA:
        raise ValueError("unsupported S2 runtime receipt schema")
    status = root["status"]
    if status not in ALLOWED_STATUSES:
        raise ValueError("invalid S2 runtime receipt status")
    for key in NONCLAIM_KEYS:
        if root[key] is not False:
            raise ValueError(f"receipt.{key} must be false")

    evidence = _exact_object(root["evidence"], EVIDENCE_KEYS, "receipt.evidence")
    if evidence["status"] != status:
        raise ValueError("receipt/evidence status mismatch")
    source_sha = evidence["source_sha256"]
    diagnostic_sha = evidence["diagnostic_sha256"]
    receipt_sha = root["receipt_sha256"]
    for label, value_sha in (("source_sha256", source_sha), ("diagnostic_sha256", diagnostic_sha), ("receipt_sha256", receipt_sha)):
        if not isinstance(value_sha, str) or not RECEIPT_SHA_RE.fullmatch(value_sha):
            raise ValueError(f"invalid {label}")
    if expected_source_sha256 is not None and source_sha != expected_source_sha256:
        raise ValueError("S2 source SHA mismatch")
    if receipt_sha != _canonical_evidence_hash(evidence):
        raise ValueError("S2 runtime receipt hash mismatch")

    launcher_rc = evidence["launcher_rc"]
    if not isinstance(launcher_rc, int) or isinstance(launcher_rc, bool) or not 0 <= launcher_rc <= 255:
        raise ValueError("invalid receipt launcher_rc")
    markers = evidence["markers"]
    if not isinstance(markers, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in markers.items()):
        raise ValueError("invalid receipt markers")
    missing = evidence["missing_or_bad_pass_markers"]
    if not isinstance(missing, list) or any(not isinstance(v, str) for v in missing):
        raise ValueError("invalid missing_or_bad_pass_markers")
    _validate_runner(evidence["runner"])

    if status == "PASS_NONAUTHORITY":
        if launcher_rc != 0 or missing:
            raise ValueError("PASS receipt requires rc=0 and complete marker set")
        for key, expected in PASS_MARKERS.items():
            if markers.get(key) != expected:
                raise ValueError(f"PASS receipt marker mismatch: {key}")
        if evidence["reason_class"] is not None:
            raise ValueError("PASS receipt reason_class must be null")
    elif status == "UNAVAILABLE_FAIL_CLOSED":
        if launcher_rc != 78 or not isinstance(evidence["reason_class"], str):
            raise ValueError("UNAVAILABLE receipt requires rc=78 and reason_class")
    else:
        if not isinstance(evidence["reason_class"], str):
            raise ValueError("FAILED receipt requires reason_class")

    if require_pass and status != "PASS_NONAUTHORITY":
        raise ValueError(f"S2 runtime PASS required, got {status}")
    return root


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--launcher-rc", type=int, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--source-sha256", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--run-attempt", required=True)
    parser.add_argument("--runner-os", required=True)
    parser.add_argument("--runner-arch", required=True)
    parser.add_argument("--head-sha", required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    ns = parser.parse_args()
    result = compose(
        launcher_rc=ns.launcher_rc,
        output=ns.output.read_text(encoding="utf-8", errors="replace"),
        source_sha256=ns.source_sha256,
        runner={
            "run_id": ns.run_id,
            "run_attempt": ns.run_attempt,
            "runner_os": ns.runner_os,
            "runner_arch": ns.runner_arch,
            "head_sha": ns.head_sha,
        },
    )
    validate(result)
    ns.receipt.write_text(json.dumps(result, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, sort_keys=True))
    return 2 if result["status"] == "FAILED" else 0


if __name__ == "__main__":
    raise SystemExit(main())
