#!/usr/bin/env python3
"""PREP-only fail-closed W1 provider-neutral causal-closure contract.

This module is deliberately NOT a production admission verifier.  It encodes
what persisted provider-neutral W1 v2 evidence would have to prove before an
additive database readback could even form a non-authority admission candidate.

Security properties:
- no provider receipt may self-assert verification;
- provider identity and lifecycle verification must come from a separately
  identified trusted verifier receipt;
- lifecycle, safety, backend, pre/post probes, and verifier receipts must bind
  to one worker/provider object and exact immutable digests;
- the semantic level of the runtime transition is explicit;
- this module can only return PREP_ELIGIBLE_NONAUTHORITY, never worker/W1
  authority or persistence truth.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

INPUT_SCHEMA = "metaengine.compute.w1-provider-neutral-causal-closure-input.h205f22.v2"
OUTPUT_SCHEMA = "metaengine.compute.w1-provider-neutral-causal-closure-prep.h205f22.v2"
HEX64 = re.compile(r"^[0-9a-f]{64}$")
WORKER_ID = re.compile(r"^[A-Za-z0-9._:-]{3,160}$")
OBJECT_ID = re.compile(r"^[A-Za-z0-9._:/-]{1,240}$")

ROOT_KEYS = {
    "schema", "worker_id", "provider_kind", "provider_object_id",
    "backend", "lifecycle", "provider_verification", "pre_probe", "post_probe",
    "safety", "persistence", "chronology",
}

SUPPORTED_PROVIDER_ACTION = {
    "GITHUB_CODESPACES": "STOP_RESUME",
    "VERCEL_SANDBOX": "STOP_RESUME",
    "AWS_EC2": "REBOOT",
}

ALLOWED_TRANSITION_LEVELS = {
    "HOST_KERNEL_REBOOT",
    "PROVIDER_VM_SESSION_REPLACED",
    "PROVIDER_CONTAINER_SESSION_REPLACED",
}


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return hashlib.sha256(raw).hexdigest()


def _obj(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label}_object_required")
    return value


def _exact(value: Any, keys: set[str], label: str) -> dict[str, Any]:
    obj = _obj(value, label)
    diff = set(obj) ^ keys
    if diff:
        raise ValueError(f"{label}_keys_mismatch:{sorted(diff)}")
    return obj


def _hash(value: Any, label: str) -> str:
    if not isinstance(value, str) or not HEX64.fullmatch(value):
        raise ValueError(f"{label}_sha256_invalid")
    return value


def _false(value: Any, label: str) -> None:
    if value is not False:
        raise ValueError(f"{label}_must_be_false")


def _true(value: Any, label: str) -> None:
    if value is not True:
        raise ValueError(f"{label}_must_be_true")


def evaluate(payload: dict[str, Any]) -> dict[str, Any]:
    root = _exact(payload, ROOT_KEYS, "input")
    if root["schema"] != INPUT_SCHEMA:
        raise ValueError("unsupported_input_schema")
    worker_id = root["worker_id"]
    provider_kind = root["provider_kind"]
    provider_object_id = root["provider_object_id"]
    if not isinstance(worker_id, str) or not WORKER_ID.fullmatch(worker_id):
        raise ValueError("worker_id_invalid")
    if provider_kind not in SUPPORTED_PROVIDER_ACTION:
        raise ValueError("provider_kind_unsupported")
    if not isinstance(provider_object_id, str) or not OBJECT_ID.fullmatch(provider_object_id):
        raise ValueError("provider_object_id_invalid")

    backend = _exact(root["backend"], {
        "receipt_sha256", "worker_id", "provider_kind", "provider_object_id",
        "execution_state", "persistence_semantics", "canonical", "authority_effect",
    }, "backend")
    lifecycle = _exact(root["lifecycle"], {
        "receipt_sha256", "worker_id", "provider_kind", "provider_object_id",
        "action_kind", "pre_snapshot_sha256", "post_snapshot_sha256",
        "requested_at_epoch_ms", "completed_at_epoch_ms", "canonical", "authority_effect",
    }, "lifecycle")
    verification = _exact(root["provider_verification"], {
        "receipt_sha256", "verifier_id", "verifier_code_sha256", "worker_id",
        "provider_kind", "provider_object_id", "lifecycle_receipt_sha256",
        "provider_identity_verified", "lifecycle_action_verified", "verified_at_epoch_ms",
        "expires_at_epoch_ms", "canonical", "authority_effect",
    }, "provider_verification")
    pre = _exact(root["pre_probe"], {
        "receipt_sha256", "worker_id", "provider_object_id", "probe_sha256",
        "observed_at_epoch_ms", "os", "arch", "machine_identity_sha256",
        "runtime_identity_sha256", "canonical", "authority_effect",
    }, "pre_probe")
    post = _exact(root["post_probe"], {
        "receipt_sha256", "worker_id", "provider_object_id", "probe_sha256",
        "observed_at_epoch_ms", "os", "arch", "machine_identity_sha256",
        "runtime_identity_sha256", "canonical", "authority_effect",
    }, "post_probe")
    safety = _exact(root["safety"], {
        "receipt_sha256", "worker_id", "post_probe_sha256", "policy_sha256",
        "verification_status", "expires_at_epoch_ms", "canonical", "authority_effect",
    }, "safety")
    persistence = _exact(root["persistence"], {
        "sentinel_pre_sha256", "sentinel_post_sha256", "transition_level",
        "provider_session_changed", "stable_provider_object", "machine_identity_stable",
        "canonical", "authority_effect",
    }, "persistence")
    chronology = _exact(root["chronology"], {
        "evaluated_at_epoch_ms",
    }, "chronology")

    for label, receipt in (
        ("backend", backend), ("lifecycle", lifecycle), ("provider_verification", verification),
        ("pre_probe", pre), ("post_probe", post), ("safety", safety),
    ):
        _hash(receipt["receipt_sha256"], f"{label}.receipt")
        _false(receipt["canonical"], f"{label}.canonical")
        _false(receipt["authority_effect"], f"{label}.authority_effect")
    for hlabel, hvalue in (
        ("lifecycle.pre_snapshot", lifecycle["pre_snapshot_sha256"]),
        ("lifecycle.post_snapshot", lifecycle["post_snapshot_sha256"]),
        ("verification.code", verification["verifier_code_sha256"]),
        ("verification.lifecycle", verification["lifecycle_receipt_sha256"]),
        ("pre.probe", pre["probe_sha256"]), ("post.probe", post["probe_sha256"]),
        ("pre.machine", pre["machine_identity_sha256"]),
        ("post.machine", post["machine_identity_sha256"]),
        ("pre.runtime", pre["runtime_identity_sha256"]),
        ("post.runtime", post["runtime_identity_sha256"]),
        ("safety.post_probe", safety["post_probe_sha256"]),
        ("safety.policy", safety["policy_sha256"]),
        ("persistence.sentinel_pre", persistence["sentinel_pre_sha256"]),
        ("persistence.sentinel_post", persistence["sentinel_post_sha256"]),
    ):
        _hash(hvalue, hlabel)
    _false(persistence["canonical"], "persistence.canonical")
    _false(persistence["authority_effect"], "persistence.authority_effect")

    checks: dict[str, bool] = {}
    checks["backend_binding"] = (
        backend["worker_id"] == worker_id
        and backend["provider_kind"] == provider_kind
        and backend["provider_object_id"] == provider_object_id
        and backend["execution_state"] in {"LIVE_SESSION_OBSERVED", "PROBED"}
        and isinstance(backend["persistence_semantics"], str)
        and len(backend["persistence_semantics"]) >= 8
    )
    checks["lifecycle_binding"] = (
        lifecycle["worker_id"] == worker_id
        and lifecycle["provider_kind"] == provider_kind
        and lifecycle["provider_object_id"] == provider_object_id
        and lifecycle["action_kind"] == SUPPORTED_PROVIDER_ACTION[provider_kind]
    )
    checks["provider_verifier_binding"] = (
        verification["worker_id"] == worker_id
        and verification["provider_kind"] == provider_kind
        and verification["provider_object_id"] == provider_object_id
        and verification["lifecycle_receipt_sha256"] == lifecycle["receipt_sha256"]
        and isinstance(verification["verifier_id"], str)
        and len(verification["verifier_id"]) >= 8
    )
    checks["provider_identity_verified"] = verification["provider_identity_verified"] is True
    checks["lifecycle_action_verified"] = verification["lifecycle_action_verified"] is True
    checks["provider_verification_current"] = (
        isinstance(verification["verified_at_epoch_ms"], int)
        and isinstance(verification["expires_at_epoch_ms"], int)
        and verification["verified_at_epoch_ms"] <= chronology["evaluated_at_epoch_ms"]
        < verification["expires_at_epoch_ms"]
    )
    checks["pre_post_binding"] = (
        pre["worker_id"] == post["worker_id"] == worker_id
        and pre["provider_object_id"] == post["provider_object_id"] == provider_object_id
        and pre["os"] == post["os"] == "linux"
        and isinstance(pre["arch"], str) and pre["arch"] == post["arch"] and len(pre["arch"]) > 0
    )
    checks["safety_current_and_post_bound"] = (
        safety["worker_id"] == worker_id
        and safety["post_probe_sha256"] == post["probe_sha256"]
        and safety["verification_status"] == "VERIFIED"
        and isinstance(safety["expires_at_epoch_ms"], int)
        and chronology["evaluated_at_epoch_ms"] < safety["expires_at_epoch_ms"]
    )
    checks["stable_provider_object"] = persistence["stable_provider_object"] is True
    checks["machine_identity_stable"] = (
        persistence["machine_identity_stable"] is True
        and pre["machine_identity_sha256"] == post["machine_identity_sha256"]
    )
    checks["sentinel_survived"] = persistence["sentinel_pre_sha256"] == persistence["sentinel_post_sha256"]
    checks["provider_session_changed"] = (
        persistence["provider_session_changed"] is True
        and pre["runtime_identity_sha256"] != post["runtime_identity_sha256"]
    )
    checks["transition_semantics_explicit"] = persistence["transition_level"] in ALLOWED_TRANSITION_LEVELS
    checks["chronology"] = (
        isinstance(pre["observed_at_epoch_ms"], int)
        and isinstance(lifecycle["requested_at_epoch_ms"], int)
        and isinstance(lifecycle["completed_at_epoch_ms"], int)
        and isinstance(post["observed_at_epoch_ms"], int)
        and isinstance(verification["verified_at_epoch_ms"], int)
        and pre["observed_at_epoch_ms"] < lifecycle["requested_at_epoch_ms"]
        <= lifecycle["completed_at_epoch_ms"] < post["observed_at_epoch_ms"]
        <= verification["verified_at_epoch_ms"] <= chronology["evaluated_at_epoch_ms"]
    )

    failures = sorted(k for k, passed in checks.items() if not passed)
    neutral = {
        "worker_id": worker_id,
        "provider_kind": provider_kind,
        "provider_object_id": provider_object_id,
        "checks": checks,
        "failures": failures,
        "bound_receipts": {
            "backend": backend["receipt_sha256"],
            "lifecycle": lifecycle["receipt_sha256"],
            "provider_verification": verification["receipt_sha256"],
            "pre_probe": pre["receipt_sha256"],
            "post_probe": post["receipt_sha256"],
            "safety": safety["receipt_sha256"],
        },
    }
    return {
        "schema": OUTPUT_SCHEMA,
        "outcome": "PREP_ELIGIBLE_NONAUTHORITY" if not failures else "REJECTED_CAUSAL_CLOSURE",
        "evidence": neutral,
        "candidate_sha256": canonical_hash(neutral),
        "admission_candidate": False,
        "provider_identity_verified_by_this_module": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
        "requires_persisted_database_readback": True,
        "requires_supervisor_verification": True,
    }
