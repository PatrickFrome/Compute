#!/usr/bin/env python3
"""Fail-closed W1 admission-candidate compositor.

This layer does not inspect a host directly and does not admit a worker. It only
combines independently persisted/read-back W1 receipts:

* dedicated Linux safety verification;
* a non-ephemeral backend binding;
* a provider reboot-request receipt;
* pre/post reboot worker probe receipts.

A candidate is possible only when all subjects bind to the same enrollment,
worker, provider instance and a changed Linux boot_id. Provider reboot evidence
is treated as request-acceptance evidence, never reboot-completion authority.
"""
from __future__ import annotations

import hashlib
import json
import sys
import uuid
from datetime import datetime, timezone
from typing import Any

INPUT_SCHEMA = "metaengine.compute.w1-admission-composition-input.h205f22.v1"
OUTPUT_SCHEMA = "metaengine.compute.w1-admission-candidate.h205f22.v1"
PROBE_SCHEMA = "metaengine.compute.worker-host-probe.h205f22.v2"
READBACK_SOURCE = "SUPABASE_PERSISTED_READBACK"

INPUT_KEYS = {
    "schema", "evaluated_at", "safety_verification", "backend_binding",
    "reboot_receipt", "pre_reboot_probe", "post_reboot_probe",
}
SAFETY_KEYS = {
    "source", "enrollment_id", "worker_id", "probe_sha256", "policy_sha256",
    "verification_id", "verification_receipt_sha256", "verification_status",
    "expires_at", "canonical", "authority_effect",
}
BINDING_KEYS = {
    "source", "enrollment_id", "worker_id", "backend_kind",
    "backend_instance_name", "persistence_mode", "execution_state",
    "endpoint_ref", "canonical", "authority_effect",
}
ENDPOINT_KEYS = {"provider_kind", "provider_instance_id"}
REBOOT_KEYS = {
    "source", "reboot_receipt_id", "worker_id", "provider_kind",
    "provider_instance_id", "action_kind", "action_id", "requested_at",
    "completed_at", "completed_at_semantics", "identity_attestation_kind",
    "identity_attestation_verified", "evidence_sha256", "accepted",
    "canonical", "authority_effect",
}
PROBE_KEYS = {
    "source", "receipt_id", "enrollment_id", "worker_id", "probe_schema",
    "probe_payload", "probe_sha256", "verdict", "receipt_sha256", "created_at",
}
PROBE_PAYLOAD_KEYS = {
    "schema", "os", "arch", "boot_id", "cpu_logical", "capabilities", "memory_bytes"
}

PERSISTENT_MODES = {"NATIVE_PERSISTENT", "PERSISTENT_SNAPSHOT"}
LIVE_BINDING_STATES = {"LIVE_SESSION_OBSERVED", "PROBED"}
BACKEND_KINDS = {"NATIVE_LINUX", "SELF_HOSTED_VM"}


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _object(value: Any, expected: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    diff = set(value) ^ expected
    if diff:
        raise ValueError(f"{label} keys mismatch: {sorted(diff)}")
    return value


def _string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"invalid {label}")
    return value


def _sha256(value: Any, label: str) -> str:
    text = _string(value, label)
    if text != text.lower() or len(text) != 64 or any(c not in "0123456789abcdef" for c in text):
        raise ValueError(f"invalid {label}")
    return text


def _bool(value: Any, label: str) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f"{label} must be boolean")
    return value


def _int(value: Any, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValueError(f"invalid {label}")
    return value


def _uuid(value: Any, label: str) -> str:
    text = _string(value, label)
    try:
        parsed = uuid.UUID(text)
    except ValueError as exc:
        raise ValueError(f"invalid {label}") from exc
    if str(parsed) != text.lower():
        raise ValueError(f"{label} must be canonical UUID")
    return text.lower()


def _time(value: Any, label: str) -> datetime:
    text = _string(value, label)
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"invalid {label}") from exc
    if dt.tzinfo is None:
        raise ValueError(f"{label} timezone required")
    return dt.astimezone(timezone.utc)


def _readback(value: Any, label: str) -> None:
    if value != READBACK_SOURCE:
        raise ValueError(f"{label} must come from persisted readback")


def _non_authority(value: dict[str, Any], label: str) -> None:
    if _bool(value["canonical"], f"{label}.canonical"):
        raise ValueError(f"{label} must be noncanonical")
    if _bool(value["authority_effect"], f"{label}.authority_effect"):
        raise ValueError(f"{label} must be non-authority")


def _validate_safety(value: Any, evaluated_at: datetime) -> dict[str, Any]:
    v = _object(value, SAFETY_KEYS, "safety_verification")
    _readback(v["source"], "safety_verification.source")
    _uuid(v["enrollment_id"], "safety enrollment_id")
    _string(v["worker_id"], "safety worker_id")
    _sha256(v["probe_sha256"], "safety probe_sha256")
    _sha256(v["policy_sha256"], "safety policy_sha256")
    _uuid(v["verification_id"], "verification_id")
    _sha256(v["verification_receipt_sha256"], "verification_receipt_sha256")
    if v["verification_status"] != "VERIFIED":
        raise ValueError("dedicated safety verification required")
    if _time(v["expires_at"], "safety expires_at") <= evaluated_at:
        raise ValueError("safety verification expired")
    _non_authority(v, "safety_verification")
    return v


def _validate_binding(value: Any) -> dict[str, Any]:
    v = _object(value, BINDING_KEYS, "backend_binding")
    _readback(v["source"], "backend_binding.source")
    _uuid(v["enrollment_id"], "binding enrollment_id")
    _string(v["worker_id"], "binding worker_id")
    if v["backend_kind"] not in BACKEND_KINDS:
        raise ValueError("persistent Linux backend kind required")
    _string(v["backend_instance_name"], "backend_instance_name")
    if v["persistence_mode"] not in PERSISTENT_MODES:
        raise ValueError("non-ephemeral persistence mode required")
    if v["execution_state"] not in LIVE_BINDING_STATES:
        raise ValueError("live/probed backend binding required")
    endpoint = _object(v["endpoint_ref"], ENDPOINT_KEYS, "backend endpoint_ref")
    _string(endpoint["provider_kind"], "provider_kind")
    _string(endpoint["provider_instance_id"], "provider_instance_id")
    if v["backend_instance_name"] != endpoint["provider_instance_id"]:
        raise ValueError("backend/provider instance mismatch")
    _non_authority(v, "backend_binding")
    return v


def _validate_reboot(value: Any) -> dict[str, Any]:
    v = _object(value, REBOOT_KEYS, "reboot_receipt")
    _readback(v["source"], "reboot_receipt.source")
    _uuid(v["reboot_receipt_id"], "reboot_receipt_id")
    _string(v["worker_id"], "reboot worker_id")
    _string(v["provider_kind"], "reboot provider_kind")
    _string(v["provider_instance_id"], "reboot provider_instance_id")
    if v["action_kind"] != "REBOOT":
        raise ValueError("reboot action required")
    _string(v["action_id"], "action_id")
    requested = _time(v["requested_at"], "requested_at")
    completed = _time(v["completed_at"], "completed_at")
    if completed < requested:
        raise ValueError("invalid provider action window")
    if v["completed_at_semantics"] != "PROVIDER_REQUEST_ACCEPTED_AT_NOT_REBOOT_COMPLETION":
        raise ValueError("provider completion semantics must remain non-completion")
    if v["identity_attestation_kind"] != "SIGNED_PROVIDER_IDENTITY":
        raise ValueError("signed provider identity required")
    if _bool(v["identity_attestation_verified"], "identity_attestation_verified") is not True:
        raise ValueError("verified provider identity required")
    _sha256(v["evidence_sha256"], "reboot evidence_sha256")
    if _bool(v["accepted"], "accepted") is not True:
        raise ValueError("persisted reboot receipt must be accepted")
    _non_authority(v, "reboot_receipt")
    return v


def _validate_probe(value: Any, label: str) -> dict[str, Any]:
    v = _object(value, PROBE_KEYS, label)
    _readback(v["source"], f"{label}.source")
    _int(v["receipt_id"], f"{label} receipt_id")
    _uuid(v["enrollment_id"], f"{label} enrollment_id")
    _string(v["worker_id"], f"{label} worker_id")
    if v["probe_schema"] != PROBE_SCHEMA:
        raise ValueError(f"{label} schema mismatch")
    payload = _object(v["probe_payload"], PROBE_PAYLOAD_KEYS, f"{label} probe_payload")
    if payload["schema"] != PROBE_SCHEMA or payload["os"] != "linux":
        raise ValueError(f"{label} must be Linux probe v2")
    _string(payload["arch"], f"{label} arch")
    _uuid(payload["boot_id"], f"{label} boot_id")
    _int(payload["cpu_logical"], f"{label} cpu_logical")
    _int(payload["memory_bytes"], f"{label} memory_bytes")
    if not isinstance(payload["capabilities"], dict):
        raise ValueError(f"{label} capabilities must be object")
    if v["probe_sha256"] != canonical_hash(payload):
        raise ValueError(f"{label} probe_sha256 mismatch")
    if v["verdict"] != "PASS":
        raise ValueError(f"{label} must be PASS")
    _sha256(v["receipt_sha256"], f"{label} receipt_sha256")
    _time(v["created_at"], f"{label} created_at")
    return v


def compose(bundle: dict[str, Any]) -> dict[str, Any]:
    b = _object(bundle, INPUT_KEYS, "composition")
    if b["schema"] != INPUT_SCHEMA:
        raise ValueError("unsupported composition schema")
    evaluated_at = _time(b["evaluated_at"], "evaluated_at")
    safety = _validate_safety(b["safety_verification"], evaluated_at)
    binding = _validate_binding(b["backend_binding"])
    reboot = _validate_reboot(b["reboot_receipt"])
    pre = _validate_probe(b["pre_reboot_probe"], "pre_reboot_probe")
    post = _validate_probe(b["post_reboot_probe"], "post_reboot_probe")

    enrollments = {
        safety["enrollment_id"], binding["enrollment_id"], pre["enrollment_id"], post["enrollment_id"]
    }
    workers = {
        safety["worker_id"], binding["worker_id"], reboot["worker_id"], pre["worker_id"], post["worker_id"]
    }
    if len(enrollments) != 1 or len(workers) != 1:
        raise ValueError("cross-worker or cross-enrollment composition forbidden")

    endpoint = binding["endpoint_ref"]
    if reboot["provider_kind"] != endpoint["provider_kind"] or reboot["provider_instance_id"] != endpoint["provider_instance_id"]:
        raise ValueError("provider binding mismatch")

    pre_time = _time(pre["created_at"], "pre_reboot_probe created_at")
    post_time = _time(post["created_at"], "post_reboot_probe created_at")
    requested = _time(reboot["requested_at"], "requested_at")
    provider_seen = _time(reboot["completed_at"], "completed_at")
    if not (pre_time < requested <= provider_seen < post_time <= evaluated_at):
        raise ValueError("reboot/probe ordering invalid")

    pre_boot = pre["probe_payload"]["boot_id"]
    post_boot = post["probe_payload"]["boot_id"]
    if pre_boot == post_boot:
        raise ValueError("boot_id must change across provider reboot request")
    if pre["probe_payload"]["arch"] != post["probe_payload"]["arch"]:
        raise ValueError("architecture drift across reboot")
    if safety["probe_sha256"] != post["probe_sha256"]:
        raise ValueError("safety verification must bind post-reboot probe")

    evidence = {
        "enrollment_id": safety["enrollment_id"],
        "worker_id": safety["worker_id"],
        "provider_kind": reboot["provider_kind"],
        "provider_instance_id": reboot["provider_instance_id"],
        "backend_persistence_mode": binding["persistence_mode"],
        "safety_verification_id": safety["verification_id"],
        "safety_verification_receipt_sha256": safety["verification_receipt_sha256"],
        "reboot_receipt_id": reboot["reboot_receipt_id"],
        "reboot_evidence_sha256": reboot["evidence_sha256"],
        "pre_probe_receipt_id": pre["receipt_id"],
        "pre_probe_receipt_sha256": pre["receipt_sha256"],
        "pre_boot_id": pre_boot,
        "post_probe_receipt_id": post["receipt_id"],
        "post_probe_receipt_sha256": post["receipt_sha256"],
        "post_boot_id": post_boot,
        "provider_identity_attestation_verified": reboot["identity_attestation_verified"],
        "provider_action_completion_proven": False,
        "provider_request_observed": True,
    }
    return {
        "schema": OUTPUT_SCHEMA,
        "outcome": "ADMISSION_CANDIDATE_NON_AUTHORITY",
        "evidence": evidence,
        "candidate_sha256": canonical_hash(evidence),
        "admission_candidate": True,
        "worker_admitted": False,
        "persistent_worker_proof": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
        "requires_supervisor_verification": True,
    }


def main() -> int:
    raw = json.load(sys.stdin)
    if not isinstance(raw, dict):
        raise ValueError("composition must be an object")
    result = compose(raw)
    json.dump(result, sys.stdout, sort_keys=True, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
