#!/usr/bin/env python3
"""Independent, non-authoritative GitHub/Sigstore verifier for RSI promotion review.

This module deliberately lives outside the Browser candidate mutation roots. It
models the consumer side of a future trusted attestation producer:

    trusted evidence -> deterministic promotion subject -> GitHub/Sigstore attest
    -> gh attestation verify --format json -> this verifier -> non-authority receipt

A self-hash proves integrity only. Promotion provenance is accepted only from the
structured output of an independent GitHub attestation verification whose subject,
predicate, repository, workflow, source head and run identity all match.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

EXPECTED_REPOSITORY_ID = 1341371143
EXPECTED_REPOSITORY = "PatrickFrome/Compute"
TRUSTED_WORKFLOW_PATH = ".github/workflows/rsi-promotion-attestation.yml"
PREDICATE_TYPE = "https://github.com/PatrickFrome/Compute/attestations/rsi-promotion-review/v1"
SUBJECT_SCHEMA = "metaengine.rsi.promotion-review-subject.v1"
PREDICATE_SCHEMA = "metaengine.rsi.promotion-review-attestation-predicate.v1"
VERIFICATION_SCHEMA = "metaengine.rsi.promotion-review-attestation-verification.v1"
GATE_SCHEMA = "metaengine.rsi.promotion-admission-gate-result.v1"
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
CANDIDATE_ID = re.compile(r"^candidate_sha256_[0-9a-f]{64}$")


class PromotionAttestationError(RuntimeError):
    pass


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_json(value: Any) -> str:
    return _sha256_bytes(_canonical_bytes(value))


def _hash_file(path: Path) -> tuple[str, int]:
    h = hashlib.sha256()
    total = 0
    try:
        with path.open("rb") as handle:
            while True:
                chunk = handle.read(1024 * 1024)
                if not chunk:
                    break
                h.update(chunk)
                total += len(chunk)
    except OSError as exc:
        raise PromotionAttestationError(f"subject_file_unavailable:{path}") from exc
    return h.hexdigest(), total


def _require_object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise PromotionAttestationError(f"{label}_invalid")
    return value


def _require_text(value: Any, label: str, maximum: int = 512) -> str:
    if not isinstance(value, str):
        raise PromotionAttestationError(f"{label}_invalid")
    text = value.strip()
    if not text or len(text) > maximum or any(ord(ch) < 32 or ord(ch) == 127 for ch in text):
        raise PromotionAttestationError(f"{label}_invalid")
    return text


def _require_sha40(value: Any, label: str) -> str:
    text = _require_text(value, label, 40).lower()
    if not SHA40.fullmatch(text):
        raise PromotionAttestationError(f"{label}_invalid")
    return text


def _require_sha256(value: Any, label: str) -> str:
    text = _require_text(value, label, 71).lower()
    if text.startswith("sha256:"):
        text = text[7:]
    if not SHA256.fullmatch(text):
        raise PromotionAttestationError(f"{label}_invalid")
    return text


def _require_int(value: Any, label: str, minimum: int = 1) -> int:
    if isinstance(value, bool):
        raise PromotionAttestationError(f"{label}_invalid")
    try:
        out = int(value)
    except (TypeError, ValueError) as exc:
        raise PromotionAttestationError(f"{label}_invalid") from exc
    if out < minimum:
        raise PromotionAttestationError(f"{label}_invalid")
    return out


def _verify_self_hash(value: dict[str, Any], field: str, label: str) -> None:
    claimed = _require_sha256(value.get(field), field)
    core = dict(value)
    core.pop(field, None)
    if _sha256_json(core) != claimed:
        raise PromotionAttestationError(f"{label}_{field}_mismatch")


def _assert_zero_authority(value: dict[str, Any], label: str) -> None:
    for field in (
        "execution_authority",
        "production_mutation_authority",
        "promotion_authority",
        "self_update_authority",
        "authority_effect",
    ):
        if value.get(field) is not False:
            raise PromotionAttestationError(f"{label}_{field}_invalid")
    if value.get("automatic_retry_allowed") is not False:
        raise PromotionAttestationError(f"{label}_automatic_retry_allowed_invalid")


def validate_gate(gate: Any) -> dict[str, Any]:
    gate = _require_object(gate, "gate")
    if gate.get("schema") != GATE_SCHEMA or gate.get("version") != 1:
        raise PromotionAttestationError("gate_schema_invalid")
    _assert_zero_authority(gate, "gate")
    if gate.get("state") != "READY_FOR_EXTERNAL_PROMOTION_REVIEW":
        raise PromotionAttestationError("gate_not_review_ready")
    if gate.get("ready_for_external_promotion_review") is not True:
        raise PromotionAttestationError("gate_review_ready_flag_invalid")
    if gate.get("existing_self_update_handoff_authorized") is not False:
        raise PromotionAttestationError("gate_self_update_handoff_forbidden")
    if gate.get("direct_install_authorized") is not False or gate.get("promotion_token") is not None:
        raise PromotionAttestationError("gate_direct_promotion_forbidden")
    blockers = gate.get("blockers")
    if blockers != []:
        raise PromotionAttestationError("gate_blockers_present")
    candidate_id = _require_text(gate.get("candidate_id"), "candidate_id", 96).lower()
    if not CANDIDATE_ID.fullmatch(candidate_id):
        raise PromotionAttestationError("candidate_id_invalid")
    candidate_sha = _require_sha40(gate.get("candidate_sha"), "candidate_sha")
    parent_sha = _require_sha40(gate.get("parent_sha"), "parent_sha")
    if candidate_sha == parent_sha:
        raise PromotionAttestationError("candidate_parent_same")
    gate_digest = _require_sha256(gate.get("gate_digest"), "gate_digest")
    core = dict(gate)
    core.pop("gate_digest", None)
    if _sha256_json(core) != gate_digest:
        raise PromotionAttestationError("gate_digest_mismatch")
    return {
        "candidate_id": candidate_id,
        "candidate_sha": candidate_sha,
        "parent_sha": parent_sha,
        "gate_digest": gate_digest,
        "artifact_digest": _require_sha256(gate.get("artifact_digest"), "artifact_digest"),
        "provenance_digest": _require_sha256(gate.get("provenance_digest"), "provenance_digest"),
        "archive_admission_digest": _require_sha256(gate.get("archive_admission_digest"), "archive_admission_digest"),
        "tournament_result_digest": _require_sha256(gate.get("tournament_result_digest"), "tournament_result_digest"),
        "qualification_digest": _require_sha256(gate.get("qualification_digest"), "qualification_digest"),
    }


def build_promotion_subject(gate: Any, *, canary_evidence_digest: str, rollback_evidence_digest: str) -> dict[str, Any]:
    normalized = validate_gate(gate)
    core = {
        "schema": SUBJECT_SCHEMA,
        "version": 1,
        "candidate_id": normalized["candidate_id"],
        "candidate_sha": normalized["candidate_sha"],
        "parent_sha": normalized["parent_sha"],
        "artifact_sha256": normalized["artifact_digest"],
        "provenance_sha256": normalized["provenance_digest"],
        "promotion_gate_sha256": normalized["gate_digest"],
        "archive_admission_sha256": normalized["archive_admission_digest"],
        "tournament_result_sha256": normalized["tournament_result_digest"],
        "qualification_sha256": normalized["qualification_digest"],
        "canary_evidence_sha256": _require_sha256(canary_evidence_digest, "canary_evidence_digest"),
        "rollback_evidence_sha256": _require_sha256(rollback_evidence_digest, "rollback_evidence_digest"),
        "classification": "RSI_PROMOTION_REVIEW_SUBJECT_NONAUTHORITY",
        "source_material_must_be_persisted_readback": True,
        "candidate_authored_subject_allowed": False,
        "direct_install_authorized": False,
        "promotion_authority": False,
        "self_update_authority": False,
        "execution_authority": False,
        "production_mutation_authority": False,
        "automatic_retry_allowed": False,
        "authority_effect": False,
    }
    return {**core, "subject_sha256": _sha256_json(core)}


def validate_subject(value: Any) -> dict[str, Any]:
    value = _require_object(value, "subject")
    if value.get("schema") != SUBJECT_SCHEMA or value.get("version") != 1:
        raise PromotionAttestationError("subject_schema_invalid")
    _assert_zero_authority(value, "subject")
    if value.get("classification") != "RSI_PROMOTION_REVIEW_SUBJECT_NONAUTHORITY":
        raise PromotionAttestationError("subject_classification_invalid")
    if value.get("source_material_must_be_persisted_readback") is not True:
        raise PromotionAttestationError("subject_persisted_readback_required")
    if value.get("candidate_authored_subject_allowed") is not False or value.get("direct_install_authorized") is not False:
        raise PromotionAttestationError("subject_origin_policy_invalid")
    candidate_id = _require_text(value.get("candidate_id"), "subject_candidate_id", 96).lower()
    if not CANDIDATE_ID.fullmatch(candidate_id):
        raise PromotionAttestationError("subject_candidate_id_invalid")
    candidate_sha = _require_sha40(value.get("candidate_sha"), "subject_candidate_sha")
    parent_sha = _require_sha40(value.get("parent_sha"), "subject_parent_sha")
    if candidate_sha == parent_sha:
        raise PromotionAttestationError("subject_candidate_parent_same")
    for field in (
        "artifact_sha256",
        "provenance_sha256",
        "promotion_gate_sha256",
        "archive_admission_sha256",
        "tournament_result_sha256",
        "qualification_sha256",
        "canary_evidence_sha256",
        "rollback_evidence_sha256",
    ):
        _require_sha256(value.get(field), field)
    _verify_self_hash(value, "subject_sha256", "subject")
    return dict(value)


def build_attestation_predicate(subject: Any, *, source_head_sha: str, run_id: int, run_attempt: int) -> dict[str, Any]:
    subject = validate_subject(subject)
    source_head = _require_sha40(source_head_sha, "source_head_sha")
    run_id = _require_int(run_id, "run_id")
    run_attempt = _require_int(run_attempt, "run_attempt")
    core = {
        "schema": PREDICATE_SCHEMA,
        "classification": "RSI_PROMOTION_REVIEW_ATTESTATION_PREDICATE_NONAUTHORITY",
        "source": {
            "repository_id": EXPECTED_REPOSITORY_ID,
            "repository": EXPECTED_REPOSITORY,
            "workflow_path": TRUSTED_WORKFLOW_PATH,
            "head_sha": source_head,
            "run_id": run_id,
            "run_attempt": run_attempt,
            "event": "workflow_dispatch",
        },
        "promotion_subject": {
            "subject_sha256": _require_sha256(subject["subject_sha256"], "subject_sha256"),
            "candidate_id": subject["candidate_id"],
            "candidate_sha": subject["candidate_sha"],
            "parent_sha": subject["parent_sha"],
            "artifact_sha256": subject["artifact_sha256"],
            "promotion_gate_sha256": subject["promotion_gate_sha256"],
        },
        "authority": {
            "attestation_candidate": True,
            "verified_by_consumer": False,
            "promotion_authority": False,
            "self_update_authority": False,
            "direct_install_authorized": False,
            "authority_effect": False,
        },
        "required_next": "INDEPENDENT_GH_ATTESTATION_VERIFY_AND_EXACT_SOURCE_BINDING",
    }
    return {**core, "predicate_sha256": _sha256_json(core)}


def validate_verification_result(
    *,
    verification: Any,
    subject_path: Path,
    expected_source_head_sha: str,
    expected_source_run_id: int,
) -> dict[str, Any]:
    expected_head = _require_sha40(expected_source_head_sha, "expected_source_head_sha")
    expected_run = _require_int(expected_source_run_id, "expected_source_run_id")
    if not isinstance(verification, list) or len(verification) != 1 or not isinstance(verification[0], dict):
        raise PromotionAttestationError("attestation_verification_result_must_be_single")
    vr = _require_object(verification[0].get("verificationResult"), "verification_result")
    timestamps = vr.get("verifiedTimestamps")
    if not isinstance(timestamps, list) or not timestamps:
        raise PromotionAttestationError("verified_timestamp_missing")
    statement = _require_object(vr.get("statement"), "statement")
    if statement.get("predicateType") != PREDICATE_TYPE:
        raise PromotionAttestationError("attestation_predicate_type_invalid")
    subjects = statement.get("subject")
    if not isinstance(subjects, list) or len(subjects) != 1 or not isinstance(subjects[0], dict):
        raise PromotionAttestationError("attestation_subject_invalid")
    actual_sha, actual_bytes = _hash_file(subject_path)
    subject_digest = _require_object(subjects[0].get("digest"), "attestation_subject_digest")
    if subject_digest.get("sha256") != actual_sha:
        raise PromotionAttestationError("attestation_subject_digest_mismatch")
    subject = validate_subject(json.loads(subject_path.read_text(encoding="utf-8")))

    predicate = _require_object(statement.get("predicate"), "attestation_predicate")
    if predicate.get("schema") != PREDICATE_SCHEMA:
        raise PromotionAttestationError("attestation_predicate_schema_invalid")
    _verify_self_hash(predicate, "predicate_sha256", "attestation_predicate")
    source = _require_object(predicate.get("source"), "attestation_source")
    expected_source = {
        "repository_id": EXPECTED_REPOSITORY_ID,
        "repository": EXPECTED_REPOSITORY,
        "workflow_path": TRUSTED_WORKFLOW_PATH,
        "head_sha": expected_head,
        "run_id": expected_run,
        "event": "workflow_dispatch",
    }
    for key, expected in expected_source.items():
        if source.get(key) != expected:
            raise PromotionAttestationError(f"attestation_source_binding_mismatch:{key}")
    promotion_subject = _require_object(predicate.get("promotion_subject"), "promotion_subject")
    bindings = {
        "subject_sha256": subject["subject_sha256"],
        "candidate_id": subject["candidate_id"],
        "candidate_sha": subject["candidate_sha"],
        "parent_sha": subject["parent_sha"],
        "artifact_sha256": subject["artifact_sha256"],
        "promotion_gate_sha256": subject["promotion_gate_sha256"],
    }
    for key, expected in bindings.items():
        if promotion_subject.get(key) != expected:
            raise PromotionAttestationError(f"attestation_subject_binding_mismatch:{key}")
    authority = _require_object(predicate.get("authority"), "attestation_authority")
    if authority.get("attestation_candidate") is not True or authority.get("verified_by_consumer") is not False:
        raise PromotionAttestationError("attestation_authority_state_invalid")
    for field in ("promotion_authority", "self_update_authority", "direct_install_authorized", "authority_effect"):
        if authority.get(field) is not False:
            raise PromotionAttestationError(f"attestation_authority_boundary_invalid:{field}")

    core = {
        "schema": VERIFICATION_SCHEMA,
        "classification": "CRYPTOGRAPHICALLY_VERIFIED_RSI_PROMOTION_REVIEW_NONAUTHORITATIVE",
        "source": {
            "repository_id": EXPECTED_REPOSITORY_ID,
            "repository": EXPECTED_REPOSITORY,
            "workflow_path": TRUSTED_WORKFLOW_PATH,
            "head_sha": expected_head,
            "run_id": expected_run,
        },
        "predicate_type": PREDICATE_TYPE,
        "predicate_sha256": predicate["predicate_sha256"],
        "attested_file_sha256": actual_sha,
        "attested_file_bytes": actual_bytes,
        "promotion_subject_sha256": subject["subject_sha256"],
        "candidate_id": subject["candidate_id"],
        "candidate_sha": subject["candidate_sha"],
        "parent_sha": subject["parent_sha"],
        "artifact_sha256": subject["artifact_sha256"],
        "promotion_gate_sha256": subject["promotion_gate_sha256"],
        "verified_timestamp_count": len(timestamps),
        "source_attestation_verified": True,
        "promotion_authority": False,
        "self_update_authority": False,
        "direct_install_authorized": False,
        "authority_effect": False,
        "required_next": "EXTERNAL_PROMOTION_AUTHORITY_MUST_CONSUME_THIS_RECEIPT_AND_REVALIDATE_LIVE_RELEASE_STATE",
    }
    return {**core, "verification_receipt_sha256": _sha256_json(core)}


def _read_json(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PromotionAttestationError(f"{label}_invalid_json") from exc


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(_canonical_bytes(value) + b"\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    subject = sub.add_parser("build-subject")
    subject.add_argument("--gate", required=True)
    subject.add_argument("--canary-evidence-sha256", required=True)
    subject.add_argument("--rollback-evidence-sha256", required=True)
    subject.add_argument("--output", required=True)

    predicate = sub.add_parser("build-predicate")
    predicate.add_argument("--subject", required=True)
    predicate.add_argument("--source-head-sha", required=True)
    predicate.add_argument("--run-id", required=True, type=int)
    predicate.add_argument("--run-attempt", required=True, type=int)
    predicate.add_argument("--output", required=True)

    verify = sub.add_parser("validate-verification")
    verify.add_argument("--verification", required=True)
    verify.add_argument("--subject", required=True)
    verify.add_argument("--source-head-sha", required=True)
    verify.add_argument("--source-run-id", required=True, type=int)
    verify.add_argument("--output", required=True)

    args = parser.parse_args(argv)
    try:
        if args.command == "build-subject":
            _write_json(Path(args.output), build_promotion_subject(
                _read_json(Path(args.gate), "gate"),
                canary_evidence_digest=args.canary_evidence_sha256,
                rollback_evidence_digest=args.rollback_evidence_sha256,
            ))
            return 0
        if args.command == "build-predicate":
            _write_json(Path(args.output), build_attestation_predicate(
                _read_json(Path(args.subject), "subject"),
                source_head_sha=args.source_head_sha,
                run_id=args.run_id,
                run_attempt=args.run_attempt,
            ))
            return 0
        if args.command == "validate-verification":
            _write_json(Path(args.output), validate_verification_result(
                verification=_read_json(Path(args.verification), "verification"),
                subject_path=Path(args.subject),
                expected_source_head_sha=args.source_head_sha,
                expected_source_run_id=args.source_run_id,
            ))
            return 0
        raise PromotionAttestationError("unknown_command")
    except PromotionAttestationError as exc:
        print(f"RSI_PROMOTION_ATTESTATION_REJECTED:{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
