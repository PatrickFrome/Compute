#!/usr/bin/env python3
"""Bind protected source-environment configuration and approval into STEP07 provenance.

This module is offline and credential-free. It binds immutable environment readiness
and actual approved-review evidence into the custom source predicate before Sigstore
signing, validates that binding in the signer, and propagates it into the consumer
verification receipt.

It does not create or approve an environment, sign attestations, access a database,
call a provider, establish R2/R3, or authorize a persisted seal.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

from controller.r1.source_environment_approval_evidence import (
    ARTIFACT_NAME as APPROVAL_ARTIFACT_NAME,
    ApprovalEvidenceError,
    validate_approval_receipt,
)

READINESS_SCHEMA = "metaengine.compute.r1-source-environment-readiness.h205f22.v1"
READINESS_ARTIFACT_NAME = "r1-source-environment-readiness.json"
PREDICATE_SCHEMA = "metaengine.compute.r1-recovery-source-attestation-predicate.h205f22.v1"
VERIFICATION_SCHEMA = "metaengine.compute.r1-recovery-source-attestation-verification.h205f22.v1"
SOURCE_ENVIRONMENT = "r1-recovery-source"
BOUND_PREDICATE_CLASSIFICATION = "TRUSTED_RECOVERY_SOURCE_ATTESTATION_PREDICATE"
VERIFICATION_CLASSIFICATION = "CRYPTOGRAPHICALLY_VERIFIED_RECOVERY_SOURCE_NONAUTHORITATIVE"
SHA256 = re.compile(r"^[0-9a-f]{64}$")


class EnvironmentBindingError(RuntimeError):
    pass


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def _read(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise EnvironmentBindingError(f"{label}_invalid_json") from exc


def _write(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(_canonical(value) + b"\n")


def _require_sha(value: Any, field: str) -> str:
    if not isinstance(value, str) or not SHA256.fullmatch(value):
        raise EnvironmentBindingError(f"{field}_invalid")
    return value


def _require_positive_int(value: Any, field: str) -> int:
    if isinstance(value, bool):
        raise EnvironmentBindingError(f"{field}_invalid")
    try:
        out = int(value)
    except (TypeError, ValueError) as exc:
        raise EnvironmentBindingError(f"{field}_invalid") from exc
    if out < 1:
        raise EnvironmentBindingError(f"{field}_invalid")
    return out


def _verify_self_hash(value: dict[str, Any], field: str, label: str) -> str:
    claimed = _require_sha(value.get(field), field)
    core = dict(value)
    core.pop(field, None)
    if _sha(core) != claimed:
        raise EnvironmentBindingError(f"{label}_{field}_mismatch")
    return claimed


def validate_readiness(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema") != READINESS_SCHEMA:
        raise EnvironmentBindingError("source_environment_readiness_schema_invalid")
    if value.get("environment") != SOURCE_ENVIRONMENT:
        raise EnvironmentBindingError("source_environment_readiness_environment_invalid")
    reviewers = _require_positive_int(value.get("required_reviewer_count"), "required_reviewer_count")
    if value.get("prevent_self_review") is not True:
        raise EnvironmentBindingError("source_environment_readiness_prevent_self_review_missing")
    branch = value.get("branch_policy")
    if not isinstance(branch, dict):
        raise EnvironmentBindingError("source_environment_readiness_branch_policy_missing")
    protected = branch.get("protected_branches") is True
    custom = branch.get("custom_branch_policies") is True
    if protected == custom:
        raise EnvironmentBindingError("source_environment_readiness_branch_policy_invalid")
    if value.get("ready_for_source_generation") is not True:
        raise EnvironmentBindingError("source_environment_not_ready")
    if value.get("authority_effect") is not False or value.get("r2_proven") is not False or value.get("persisted_seal_allowed") is not False:
        raise EnvironmentBindingError("source_environment_readiness_authority_boundary_invalid")
    return {
        "schema": READINESS_SCHEMA,
        "artifact_name": READINESS_ARTIFACT_NAME,
        "environment": SOURCE_ENVIRONMENT,
        "readiness_sha256": _sha(value),
        "required_reviewer_count": reviewers,
        "prevent_self_review": True,
        "branch_policy": {
            "protected_branches": protected,
            "custom_branch_policies": custom,
        },
    }


def validate_approval(value: Any) -> dict[str, Any]:
    try:
        validated = validate_approval_receipt(value)
    except ApprovalEvidenceError as exc:
        raise EnvironmentBindingError(str(exc)) from exc
    if validated.get("environment") != SOURCE_ENVIRONMENT:
        raise EnvironmentBindingError("approval_environment_invalid")
    return {
        "artifact_name": APPROVAL_ARTIFACT_NAME,
        "environment": SOURCE_ENVIRONMENT,
        "approval_receipt_sha256": _require_sha(validated.get("approval_receipt_sha256"), "approval_receipt_sha256"),
        "approved_review_count": _require_positive_int(validated.get("approved_review_count"), "approved_review_count"),
        "initiator_actor_id": _require_positive_int(validated.get("initiator_actor_id"), "initiator_actor_id"),
        "reviewer_user_ids": [item["reviewer_user_id"] for item in validated["approvals"]],
        "self_review_absent": True,
        "approval_event_observed": True,
        "approval_timestamp_claimed": False,
    }


def _validate_predicate_base(predicate: Any) -> dict[str, Any]:
    if not isinstance(predicate, dict) or predicate.get("schema") != PREDICATE_SCHEMA:
        raise EnvironmentBindingError("predicate_schema_invalid")
    if predicate.get("classification") != BOUND_PREDICATE_CLASSIFICATION:
        raise EnvironmentBindingError("predicate_classification_invalid")
    _verify_self_hash(predicate, "predicate_sha256", "predicate")
    source = predicate.get("source")
    if not isinstance(source, dict) or source.get("environment") != SOURCE_ENVIRONMENT:
        raise EnvironmentBindingError("predicate_source_environment_invalid")
    authority = predicate.get("authority")
    if not isinstance(authority, dict) or authority.get("source_attestation_candidate") is not True:
        raise EnvironmentBindingError("predicate_authority_source_state_invalid")
    if any(authority.get(k) is not False for k in ("source_attestation_verified_by_consumer", "authority_effect", "r2_proven", "r3_proven", "persisted_seal_allowed")):
        raise EnvironmentBindingError("predicate_authority_boundary_invalid")
    return predicate


def _expected_environment_evidence(
    readiness: Any,
    approval: Any,
    readiness_artifact_id: int,
    approval_artifact_id: int,
) -> dict[str, Any]:
    r = validate_readiness(readiness)
    a = validate_approval(approval)
    return {
        "environment": SOURCE_ENVIRONMENT,
        "configuration": {
            "artifact_id": _require_positive_int(readiness_artifact_id, "source_environment_readiness_artifact_id"),
            **r,
        },
        "approval": {
            "artifact_id": _require_positive_int(approval_artifact_id, "source_environment_approval_artifact_id"),
            **a,
        },
        "source_environment_binding_verified": True,
    }


def bind_predicate(
    predicate: Any,
    readiness: Any,
    approval: Any,
    readiness_artifact_id: int,
    approval_artifact_id: int,
) -> dict[str, Any]:
    base = _validate_predicate_base(predicate)
    evidence = _expected_environment_evidence(readiness, approval, readiness_artifact_id, approval_artifact_id)
    core = dict(base)
    core.pop("predicate_sha256", None)
    if "source_environment_evidence" in core:
        raise EnvironmentBindingError("predicate_environment_evidence_already_present")
    core["source_environment_evidence"] = evidence
    out = dict(core)
    out["predicate_sha256"] = _sha(core)
    return out


def validate_bound_predicate(
    predicate: Any,
    readiness: Any,
    approval: Any,
    readiness_artifact_id: int,
    approval_artifact_id: int,
) -> dict[str, Any]:
    bound = _validate_predicate_base(predicate)
    expected = _expected_environment_evidence(readiness, approval, readiness_artifact_id, approval_artifact_id)
    if bound.get("source_environment_evidence") != expected:
        raise EnvironmentBindingError("predicate_environment_evidence_mismatch")
    return {
        "schema": "metaengine.compute.r1-source-environment-predicate-binding.h205f22.v1",
        "predicate_sha256": bound["predicate_sha256"],
        "source_environment_readiness_sha256": expected["configuration"]["readiness_sha256"],
        "source_environment_approval_sha256": expected["approval"]["approval_receipt_sha256"],
        "source_environment_readiness_artifact_id": expected["configuration"]["artifact_id"],
        "source_environment_approval_artifact_id": expected["approval"]["artifact_id"],
        "approved_review_count": expected["approval"]["approved_review_count"],
        "environment": SOURCE_ENVIRONMENT,
        "source_environment_binding_verified": True,
        "authority_effect": False,
        "r2_proven": False,
        "persisted_seal_allowed": False,
    }


def _verified_statement(verification: Any) -> dict[str, Any]:
    if not isinstance(verification, list) or len(verification) != 1 or not isinstance(verification[0], dict):
        raise EnvironmentBindingError("attestation_verification_result_must_be_single")
    result = verification[0].get("verificationResult")
    if not isinstance(result, dict):
        raise EnvironmentBindingError("attestation_verification_result_missing")
    timestamps = result.get("verifiedTimestamps")
    if not isinstance(timestamps, list) or not timestamps:
        raise EnvironmentBindingError("attestation_verified_timestamp_missing")
    statement = result.get("statement")
    if not isinstance(statement, dict):
        raise EnvironmentBindingError("attestation_statement_missing")
    return statement


def bind_verification(
    *,
    source_verification: Any,
    verification: Any,
    readiness: Any,
    approval: Any,
    readiness_artifact_id: int,
    approval_artifact_id: int,
) -> dict[str, Any]:
    if not isinstance(source_verification, dict) or source_verification.get("schema") != VERIFICATION_SCHEMA:
        raise EnvironmentBindingError("source_verification_schema_invalid")
    if source_verification.get("classification") != VERIFICATION_CLASSIFICATION:
        raise EnvironmentBindingError("source_verification_classification_invalid")
    _verify_self_hash(source_verification, "verification_receipt_sha256", "source_verification")
    if source_verification.get("source_attestation_verified") is not True:
        raise EnvironmentBindingError("source_verification_not_verified")
    if source_verification.get("authority_effect") is not False or source_verification.get("r2_proven") is not False or source_verification.get("r3_proven") is not False or source_verification.get("persisted_seal_allowed") is not False:
        raise EnvironmentBindingError("source_verification_authority_boundary_invalid")
    statement = _verified_statement(verification)
    predicate = statement.get("predicate")
    binding = validate_bound_predicate(predicate, readiness, approval, readiness_artifact_id, approval_artifact_id)
    if source_verification.get("predicate_sha256") != binding["predicate_sha256"]:
        raise EnvironmentBindingError("source_verification_predicate_binding_mismatch")

    core = dict(source_verification)
    core.pop("verification_receipt_sha256", None)
    if "source_environment_evidence" in core:
        raise EnvironmentBindingError("source_verification_environment_evidence_already_present")
    core["source_environment_evidence"] = {
        "environment": SOURCE_ENVIRONMENT,
        "configuration": {
            "artifact_id": binding["source_environment_readiness_artifact_id"],
            "artifact_name": READINESS_ARTIFACT_NAME,
            "readiness_sha256": binding["source_environment_readiness_sha256"],
        },
        "approval": {
            "artifact_id": binding["source_environment_approval_artifact_id"],
            "artifact_name": APPROVAL_ARTIFACT_NAME,
            "approval_receipt_sha256": binding["source_environment_approval_sha256"],
            "approved_review_count": binding["approved_review_count"],
        },
        "source_environment_binding_verified": True,
    }
    out = dict(core)
    out["verification_receipt_sha256"] = _sha(core)
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="command", required=True)

    bp = sub.add_parser("bind-predicate")
    bp.add_argument("--predicate", required=True)
    bp.add_argument("--readiness", required=True)
    bp.add_argument("--approval", required=True)
    bp.add_argument("--readiness-artifact-id", required=True, type=int)
    bp.add_argument("--approval-artifact-id", required=True, type=int)
    bp.add_argument("--output", required=True)

    vp = sub.add_parser("validate-predicate")
    vp.add_argument("--predicate", required=True)
    vp.add_argument("--readiness", required=True)
    vp.add_argument("--approval", required=True)
    vp.add_argument("--readiness-artifact-id", required=True, type=int)
    vp.add_argument("--approval-artifact-id", required=True, type=int)
    vp.add_argument("--output", required=True)

    bv = sub.add_parser("bind-verification")
    bv.add_argument("--source-verification", required=True)
    bv.add_argument("--verification", required=True)
    bv.add_argument("--readiness", required=True)
    bv.add_argument("--approval", required=True)
    bv.add_argument("--readiness-artifact-id", required=True, type=int)
    bv.add_argument("--approval-artifact-id", required=True, type=int)
    bv.add_argument("--output", required=True)

    a = p.parse_args(argv)
    try:
        if a.command == "bind-predicate":
            result = bind_predicate(
                _read(Path(a.predicate), "predicate"),
                _read(Path(a.readiness), "readiness"),
                _read(Path(a.approval), "approval"),
                a.readiness_artifact_id,
                a.approval_artifact_id,
            )
        elif a.command == "validate-predicate":
            result = validate_bound_predicate(
                _read(Path(a.predicate), "predicate"),
                _read(Path(a.readiness), "readiness"),
                _read(Path(a.approval), "approval"),
                a.readiness_artifact_id,
                a.approval_artifact_id,
            )
        else:
            result = bind_verification(
                source_verification=_read(Path(a.source_verification), "source_verification"),
                verification=_read(Path(a.verification), "verification"),
                readiness=_read(Path(a.readiness), "readiness"),
                approval=_read(Path(a.approval), "approval"),
                readiness_artifact_id=a.readiness_artifact_id,
                approval_artifact_id=a.approval_artifact_id,
            )
        _write(Path(a.output), result)
        return 0
    except EnvironmentBindingError as exc:
        print(f"R1_SOURCE_ENVIRONMENT_BINDING_REJECTED:{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
