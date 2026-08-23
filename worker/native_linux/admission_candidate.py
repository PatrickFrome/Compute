#!/usr/bin/env python3
"""Offline W1 admission-composition oracle.

Caller-provided JSON cannot prove persisted Supabase provenance. This module is
therefore model-checking only and can never emit a production admission
candidate. Production composition is performed by the DB-native function
`public.h205f22_w1_admission_candidate_readback_v1`, which accepts immutable
receipt IDs and reads the rows itself.
"""
from __future__ import annotations

import hashlib
import json
import sys
from typing import Any

INPUT_SCHEMA = "metaengine.compute.w1-admission-composition-input.h205f22.v1"
OUTPUT_SCHEMA = "metaengine.compute.w1-admission-composition-oracle.h205f22.v1"
PRODUCTION_OUTPUT_SCHEMA = "metaengine.compute.w1-admission-candidate-readback.h205f22.v1"
PRODUCTION_READBACK_RPC = "h205f22_w1_admission_candidate_readback_v1"
READBACK_SOURCE = "SUPABASE_PERSISTED_READBACK"


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def compose(bundle: dict[str, Any]) -> dict[str, Any]:
    """Return an offline oracle observation; never a production candidate."""
    if not isinstance(bundle, dict) or bundle.get("schema") != INPUT_SCHEMA:
        raise ValueError("unsupported composition schema")
    required = {
        "schema", "evaluated_at", "safety_verification", "backend_binding",
        "reboot_receipt", "pre_reboot_probe", "post_reboot_probe",
    }
    if set(bundle) != required:
        raise ValueError("composition keys mismatch")
    for name in (
        "safety_verification", "backend_binding", "reboot_receipt",
        "pre_reboot_probe", "post_reboot_probe",
    ):
        value = bundle[name]
        if not isinstance(value, dict):
            raise ValueError(f"{name} must be object")
        if value.get("canonical") is True or value.get("authority_effect") is True:
            raise ValueError(f"{name} must be non-authority")
    evidence = {
        "asserted_sources": {
            name: bundle[name].get("source")
            for name in (
                "safety_verification", "backend_binding", "reboot_receipt",
                "pre_reboot_probe", "post_reboot_probe",
            )
        },
        "asserted_bundle_sha256": canonical_hash(bundle),
    }
    return {
        "schema": OUTPUT_SCHEMA,
        "outcome": "ADMISSION_COMPOSITION_ORACLE_NON_AUTHORITY",
        "evidence": evidence,
        "oracle_sha256": canonical_hash(evidence),
        "input_provenance_verified": False,
        "admission_candidate": False,
        "worker_admitted": False,
        "persistent_worker_proof": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
        "production_candidate_source": f"SUPABASE_DB_RPC:{PRODUCTION_READBACK_RPC}",
        "requires_persisted_db_composition": True,
        "requires_supervisor_verification": True,
    }


def main() -> int:
    raw = json.load(sys.stdin)
    result = compose(raw)
    json.dump(result, sys.stdout, sort_keys=True, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
