#!/usr/bin/env python3
"""One-command W1 Linux host safety evidence bundle.

The CLI accepts provenance only. Runtime identity and workspace are fixed by
this reviewed source file and cannot be supplied through stdin, argv, or env.

Production execution contract:
- dedicated non-root user: metaengine-w1
- dedicated workspace: /var/lib/metaengine/w1/workspace
- repository/package code remains separate from the writable workspace

The runner executes only the repository-pinned local active probe, validates its
result, and emits a self-hashed observation+decision bundle. It has no network,
database, provider, reboot, admission, or checkpoint mutation authority.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import pwd
import stat
import subprocess
import sys
from typing import Any

import host_safety_envelope_validator as validator


SCHEMA = "metaengine.compute.w1-host-safety-evidence-bundle.h205f22.v2"
ROOT = Path(__file__).resolve().parents[2]
PROBE = ROOT / "worker" / "native_linux" / "host_safety_envelope_probe.py"
EXECUTION_USER = "metaengine-w1"
WORKSPACE_ROOT = Path("/var/lib/metaengine/w1/workspace")
MAX_PROBE_BYTES = 4 * 1024 * 1024


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def _validate_execution_context() -> dict[str, Any]:
    euid = os.geteuid()
    if euid == 0:
        raise RuntimeError("root_execution_forbidden")
    try:
        account = pwd.getpwuid(euid)
    except KeyError as exc:
        raise RuntimeError("execution_user_lookup_failed") from exc
    if account.pw_name != EXECUTION_USER:
        raise RuntimeError("dedicated_execution_user_required")

    try:
        workspace_lstat = WORKSPACE_ROOT.lstat()
    except OSError as exc:
        raise RuntimeError("workspace_missing") from exc
    if stat.S_ISLNK(workspace_lstat.st_mode) or not stat.S_ISDIR(workspace_lstat.st_mode):
        raise RuntimeError("workspace_must_be_real_directory")
    if workspace_lstat.st_uid != euid:
        raise RuntimeError("workspace_owner_mismatch")
    if workspace_lstat.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
        raise RuntimeError("workspace_group_world_writable_forbidden")

    return {
        "execution_user": EXECUTION_USER,
        "effective_uid": euid,
        "workspace_root": str(WORKSPACE_ROOT),
        "workspace_owner_uid": workspace_lstat.st_uid,
        "workspace_mode": stat.S_IMODE(workspace_lstat.st_mode),
        "workspace_real_directory": True,
        "workspace_owned_by_execution_user": True,
        "workspace_group_world_writable": False,
    }


def build(payload: dict[str, Any]) -> dict[str, Any]:
    if not PROBE.is_file():
        raise RuntimeError("pinned_probe_missing")
    execution_context = _validate_execution_context()
    raw_input = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    proc = subprocess.run(
        [sys.executable, str(PROBE)],
        input=raw_input,
        text=True,
        capture_output=True,
        cwd=str(WORKSPACE_ROOT),
        timeout=30,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"probe_failed:{proc.returncode}")
    if len(proc.stdout.encode("utf-8")) > MAX_PROBE_BYTES:
        raise RuntimeError("probe_output_too_large")
    try:
        observation = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("probe_output_invalid_json") from exc
    if not isinstance(observation, dict):
        raise RuntimeError("probe_output_not_object")
    decision = validator.evaluate(observation)
    neutral = {
        "probe_path": str(PROBE.relative_to(ROOT)),
        "probe_sha256": hashlib.sha256(PROBE.read_bytes()).hexdigest(),
        "execution_context": execution_context,
        "observation": observation,
        "decision": decision,
        "safety_eligible": decision["safety_eligible"],
        "persistence_status": "NOT_EVALUATED",
        "provider_identity_status": "NOT_EVALUATED",
        "reboot_status": "NOT_EVALUATED",
        "admission_status": "NOT_AUTHORIZED",
        "authority": {
            "canonical": False,
            "authority_effect": False,
            "database_mutation": False,
            "provider_mutation": False,
            "reboot_authorized": False,
            "worker_admitted": False,
            "w1_verified": False,
        },
    }
    return {"schema": SCHEMA, **neutral, "bundle_sha256": canonical_hash(neutral)}


def main() -> int:
    payload = json.load(sys.stdin)
    if not isinstance(payload, dict):
        raise ValueError("input_must_be_object")
    bundle = build(payload)
    json.dump(bundle, sys.stdout, sort_keys=True, indent=2)
    sys.stdout.write("\n")
    return 0 if bundle["safety_eligible"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
