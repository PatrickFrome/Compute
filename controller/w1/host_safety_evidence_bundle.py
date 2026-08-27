#!/usr/bin/env python3
"""One-command W1 Linux host safety evidence bundle.

Run from an exact repository checkout on the candidate Linux worker:

  printf '%s' '{"source":{"git_sha":"...","tree_sha":"..."}}' | \
    python3 controller/w1/host_safety_evidence_bundle.py

The runner executes only the repository-pinned local active probe, validates its
result, and emits a self-hashed observation+decision bundle. It has no network,
database, provider, reboot, admission, or checkpoint mutation authority.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
import sys
from typing import Any

import host_safety_envelope_validator as validator


SCHEMA = "metaengine.compute.w1-host-safety-evidence-bundle.h205f22.v1"
ROOT = Path(__file__).resolve().parents[2]
PROBE = ROOT / "worker" / "native_linux" / "host_safety_envelope_probe.py"
MAX_PROBE_BYTES = 4 * 1024 * 1024


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def build(payload: dict[str, Any]) -> dict[str, Any]:
    if not PROBE.is_file():
        raise RuntimeError("pinned_probe_missing")
    raw_input = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    proc = subprocess.run(
        [sys.executable, str(PROBE)],
        input=raw_input,
        text=True,
        capture_output=True,
        cwd=str(ROOT),
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
