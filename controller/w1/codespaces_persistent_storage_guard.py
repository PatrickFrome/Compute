#!/usr/bin/env python3
"""Fail-closed GitHub Codespaces persistent-storage guard for W1.

GitHub documents /workspaces as the persistent directory preserved across
Codespaces stop/start and rebuild. This guard binds the lifecycle sentinel to
that provider storage contract. It never starts/stops a provider and never
admits or verifies a worker.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys
from typing import Any

from controller.w1 import github_codespaces_snapshot_guard
from worker.native_linux import w1_lifecycle_evidence_harness

CAPTURE_SCHEMA = "metaengine.compute.w1-codespaces-persistent-storage-capture.h205f22.v1"
RECEIPT_SCHEMA = "metaengine.compute.w1-codespaces-persistent-storage-receipt.h205f22.v1"
PERSISTENT_ROOT = PurePosixPath("/workspaces")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
NONCLAIMS = {"canonical": False, "authority_effect": False, "worker_admitted": False, "w1_verified": False}


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _persistent_path(value: Any) -> str:
    if not isinstance(value, str) or not value.startswith("/") or len(value) > 4096:
        raise ValueError("sentinel_path must be an absolute path")
    path = PurePosixPath(value)
    if str(path) != value:
        raise ValueError("sentinel_path must be normalized")
    if path == PERSISTENT_ROOT or PERSISTENT_ROOT not in path.parents:
        raise ValueError("Codespaces sentinel must be strictly below /workspaces")
    if any(part in {".", ".."} for part in path.parts):
        raise ValueError("sentinel_path traversal is forbidden")
    return value


def _validate_nonclaims(value: Any, label: str) -> None:
    if value != NONCLAIMS:
        raise ValueError(f"{label} nonclaims mismatch")


def _validate_provider_oracle(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema") != github_codespaces_snapshot_guard.OUTPUT_SCHEMA:
        raise ValueError("invalid Codespaces provider oracle")
    if value.get("outcome") != "CODESPACES_SNAPSHOTS_STRUCTURALLY_ELIGIBLE_NONAUTHORITY":
        raise ValueError("Codespaces provider oracle is not eligible")
    evidence = value.get("evidence")
    if not isinstance(evidence, dict) or not evidence:
        raise ValueError("Codespaces provider oracle evidence missing")
    oracle_sha = value.get("oracle_sha256")
    if not isinstance(oracle_sha, str) or not SHA256_RE.fullmatch(oracle_sha):
        raise ValueError("invalid Codespaces provider oracle hash")
    if github_codespaces_snapshot_guard.canonical_hash(evidence) != oracle_sha:
        raise ValueError("Codespaces provider oracle hash mismatch")
    checks = evidence.get("checks")
    if not isinstance(checks, dict) or not checks or any(v is not True for v in checks.values()):
        raise ValueError("Codespaces provider oracle checks must all pass")
    for key in ("provider_object_id", "provider_object_name", "stopped_snapshot_sha256"):
        if not evidence.get(key):
            raise ValueError(f"Codespaces provider oracle missing {key}")
    if not SHA256_RE.fullmatch(str(evidence["stopped_snapshot_sha256"])):
        raise ValueError("invalid Codespaces stopped snapshot hash")
    for key in (
        "provider_identity_verified", "provider_action_verified", "persisted_readback_verified",
        "persistent_worker_proof", "worker_admitted", "w1_verified", "canonical", "authority_effect",
    ):
        if value.get(key) is not False:
            raise ValueError(f"provider oracle {key} must be false")
    return value


def capture(*, phase: str, lifecycle_capture: dict[str, Any], sentinel: Path) -> dict[str, Any]:
    if phase not in {"PRE", "POST"}:
        raise ValueError("phase must be PRE or POST")
    local = w1_lifecycle_evidence_harness.validate_capture(lifecycle_capture, expected_phase=phase)
    raw = Path(sentinel)
    try:
        resolved = raw.resolve(strict=True)
    except OSError as exc:
        raise RuntimeError(f"unable to resolve Codespaces sentinel: {exc}") from exc
    path = _persistent_path(resolved.as_posix())
    if raw.is_symlink() or resolved != raw.absolute():
        raise RuntimeError("Codespaces sentinel path must not traverse symlinks")
    sentinel_sha = w1_lifecycle_evidence_harness.ensure_persistent_sentinel(raw, initialize=False)
    if sentinel_sha != local["sentinel_sha256"]:
        raise ValueError("Codespaces sentinel hash does not match lifecycle capture")
    result = {
        "schema": CAPTURE_SCHEMA,
        "phase": phase,
        "provider_kind": "GITHUB_CODESPACES",
        "persistent_root": str(PERSISTENT_ROOT),
        "sentinel_path": path,
        "sentinel_path_sha256": hashlib.sha256(path.encode("utf-8")).hexdigest(),
        "sentinel_sha256": sentinel_sha,
        "boot_id": local["boot_id"],
        "source": local["source"],
        "lifecycle_capture_sha256": canonical_hash(local),
        "nonclaims": dict(NONCLAIMS),
    }
    validate_capture(result, expected_phase=phase)
    return result


def validate_capture(value: Any, *, expected_phase: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("storage capture must be an object")
    required = {
        "schema", "phase", "provider_kind", "persistent_root", "sentinel_path",
        "sentinel_path_sha256", "sentinel_sha256", "boot_id", "source",
        "lifecycle_capture_sha256", "nonclaims",
    }
    if set(value) != required:
        raise ValueError("storage capture keys mismatch")
    if value["schema"] != CAPTURE_SCHEMA or value["phase"] != expected_phase:
        raise ValueError("storage capture schema/phase mismatch")
    if value["provider_kind"] != "GITHUB_CODESPACES" or value["persistent_root"] != str(PERSISTENT_ROOT):
        raise ValueError("storage capture provider/root mismatch")
    path = _persistent_path(value["sentinel_path"])
    expected_path_sha = hashlib.sha256(path.encode("utf-8")).hexdigest()
    if value["sentinel_path_sha256"] != expected_path_sha:
        raise ValueError("storage capture path hash mismatch")
    for key in ("sentinel_sha256", "lifecycle_capture_sha256"):
        if not isinstance(value[key], str) or not SHA256_RE.fullmatch(value[key]):
            raise ValueError(f"invalid storage capture {key}")
    if not isinstance(value["boot_id"], str) or not w1_lifecycle_evidence_harness.BOOT_RE.fullmatch(value["boot_id"]):
        raise ValueError("invalid storage capture boot_id")
    source = value["source"]
    if not isinstance(source, dict) or set(source) != {"git_sha", "tree_sha"}:
        raise ValueError("invalid storage capture source")
    if any(not isinstance(v, str) or not SHA40_RE.fullmatch(v) for v in source.values()):
        raise ValueError("invalid storage capture source identity")
    _validate_nonclaims(value["nonclaims"], "storage capture")
    return value


def compose(*, pre_storage: dict[str, Any], post_storage: dict[str, Any], provider_oracle: dict[str, Any]) -> dict[str, Any]:
    pre = validate_capture(pre_storage, expected_phase="PRE")
    post = validate_capture(post_storage, expected_phase="POST")
    provider = _validate_provider_oracle(provider_oracle)

    checks = {
        "persistent_root_is_workspaces": pre["persistent_root"] == post["persistent_root"] == "/workspaces",
        "sentinel_path_stable": pre["sentinel_path"] == post["sentinel_path"],
        "sentinel_path_hash_stable": pre["sentinel_path_sha256"] == post["sentinel_path_sha256"],
        "sentinel_content_stable": pre["sentinel_sha256"] == post["sentinel_sha256"],
        "source_identity_stable": pre["source"] == post["source"],
        "kernel_boot_id_changed": pre["boot_id"] != post["boot_id"],
        "provider_sequence_eligible": provider["outcome"] == "CODESPACES_SNAPSHOTS_STRUCTURALLY_ELIGIBLE_NONAUTHORITY",
    }
    failures = sorted(k for k, passed in checks.items() if not passed)
    if failures:
        raise ValueError(f"Codespaces persistent storage checks failed: {failures}")

    evidence = {
        "provider_kind": "GITHUB_CODESPACES",
        "provider_object_id": provider["evidence"]["provider_object_id"],
        "provider_object_name": provider["evidence"]["provider_object_name"],
        "persistent_root": "/workspaces",
        "sentinel_path": pre["sentinel_path"],
        "sentinel_path_sha256": pre["sentinel_path_sha256"],
        "sentinel_sha256": pre["sentinel_sha256"],
        "source": pre["source"],
        "pre_boot_id": pre["boot_id"],
        "post_boot_id": post["boot_id"],
        "pre_storage_capture_sha256": canonical_hash(pre),
        "post_storage_capture_sha256": canonical_hash(post),
        "provider_oracle_sha256": provider["oracle_sha256"],
        "stopped_snapshot_sha256": provider["evidence"]["stopped_snapshot_sha256"],
        "checks": checks,
    }
    return {
        "schema": RECEIPT_SCHEMA,
        "outcome": "CODESPACES_PERSISTENT_STORAGE_BOUND_NONAUTHORITY",
        "evidence": evidence,
        "receipt_sha256": canonical_hash(evidence),
        "provider_storage_contract_verified": False,
        "persisted_readback_verified": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
        "requires_authenticated_github_provenance": True,
        "requires_persisted_db_composition": True,
    }


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _dump(value: Any, path: Path | None) -> None:
    raw = json.dumps(value, sort_keys=True, indent=2) + "\n"
    if path is None:
        sys.stdout.write(raw)
    else:
        path.write_text(raw, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    cap = sub.add_parser("capture")
    cap.add_argument("--phase", choices=("PRE", "POST"), required=True)
    cap.add_argument("--lifecycle-capture", type=Path, required=True)
    cap.add_argument("--sentinel", type=Path, required=True)
    cap.add_argument("--output", type=Path)
    comp = sub.add_parser("compose")
    comp.add_argument("--pre-storage", type=Path, required=True)
    comp.add_argument("--post-storage", type=Path, required=True)
    comp.add_argument("--provider-oracle", type=Path, required=True)
    comp.add_argument("--output", type=Path)
    ns = parser.parse_args()
    if ns.command == "capture":
        result = capture(
            phase=ns.phase,
            lifecycle_capture=_load(ns.lifecycle_capture),
            sentinel=ns.sentinel,
        )
    else:
        result = compose(
            pre_storage=_load(ns.pre_storage),
            post_storage=_load(ns.post_storage),
            provider_oracle=_load(ns.provider_oracle),
        )
    _dump(result, ns.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
