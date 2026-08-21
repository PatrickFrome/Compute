#!/usr/bin/env python3
"""Normalize and validate GitHub environment approval evidence for R1 STEP07B.

The helper is offline: network retrieval stays in GitHub Actions. It accepts the
JSON returned by `GET /actions/runs/{run_id}/approvals`, requires at least one
approved review for `r1-recovery-source`, and rejects self-approval by the workflow
initiator account id. The normalized receipt is non-authoritative.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

SCHEMA = "metaengine.compute.r1-source-environment-approval.h205f22.v1"
CLASSIFICATION = "SOURCE_ENVIRONMENT_APPROVAL_EVIDENCE_NONAUTHORITATIVE"
ENVIRONMENT = "r1-recovery-source"
ARTIFACT_NAME = "r1-source-environment-approval.json"
SHA256 = re.compile(r"^[0-9a-f]{64}$")


class ApprovalEvidenceError(RuntimeError):
    pass


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def _read(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise ApprovalEvidenceError(f"{label}_invalid_json") from exc


def _write(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(_canonical(value) + b"\n")


def _positive_int(value: Any, field: str) -> int:
    if isinstance(value, bool):
        raise ApprovalEvidenceError(f"{field}_invalid")
    try:
        out = int(value)
    except (TypeError, ValueError) as exc:
        raise ApprovalEvidenceError(f"{field}_invalid") from exc
    if out < 1:
        raise ApprovalEvidenceError(f"{field}_invalid")
    return out


def _text(value: Any, field: str, maximum: int = 200) -> str:
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum:
        raise ApprovalEvidenceError(f"{field}_invalid")
    return value.strip()


def _extract_approvals(history: Any, initiator_actor_id: int) -> list[dict[str, Any]]:
    if not isinstance(history, list):
        raise ApprovalEvidenceError("approval_history_shape_invalid")
    selected: list[dict[str, Any]] = []
    for index, review in enumerate(history):
        if not isinstance(review, dict):
            raise ApprovalEvidenceError(f"approval_history_entry_invalid:{index}")
        if str(review.get("state") or "").lower() != "approved":
            continue
        environments = review.get("environments")
        if not isinstance(environments, list):
            raise ApprovalEvidenceError(f"approval_environments_invalid:{index}")
        matches = [e for e in environments if isinstance(e, dict) and e.get("name") == ENVIRONMENT]
        if not matches:
            continue
        user = review.get("user")
        if not isinstance(user, dict):
            raise ApprovalEvidenceError(f"approval_user_missing:{index}")
        user_id = _positive_int(user.get("id"), f"approval_user_id:{index}")
        login = _text(user.get("login"), f"approval_user_login:{index}")
        if user_id == initiator_actor_id:
            raise ApprovalEvidenceError("source_environment_self_approval_detected")
        env_ids = sorted({_positive_int(e.get("id"), f"approval_environment_id:{index}") for e in matches})
        selected.append({
            "reviewer_user_id": user_id,
            "reviewer_login": login,
            "environment_ids": env_ids,
            "comment_sha256": hashlib.sha256(str(review.get("comment") or "").encode("utf-8")).hexdigest(),
        })
    if not selected:
        raise ApprovalEvidenceError("source_environment_approved_review_missing")
    unique: dict[tuple[int, tuple[int, ...], str], dict[str, Any]] = {}
    for item in selected:
        key = (item["reviewer_user_id"], tuple(item["environment_ids"]), item["comment_sha256"])
        unique[key] = item
    return sorted(unique.values(), key=lambda x: (x["reviewer_user_id"], x["environment_ids"], x["comment_sha256"]))


def build_approval_evidence(history: Any, initiator_actor_id: int) -> dict[str, Any]:
    actor_id = _positive_int(initiator_actor_id, "initiator_actor_id")
    approvals = _extract_approvals(history, actor_id)
    core = {
        "schema": SCHEMA,
        "classification": CLASSIFICATION,
        "artifact_name": ARTIFACT_NAME,
        "environment": ENVIRONMENT,
        "initiator_actor_id": actor_id,
        "approved_review_count": len(approvals),
        "approvals": approvals,
        "self_review_absent": True,
        "approval_event_observed": True,
        "approval_timestamp_claimed": False,
        "authority_effect": False,
        "r2_proven": False,
        "r3_proven": False,
        "persisted_seal_allowed": False,
    }
    out = dict(core)
    out["approval_receipt_sha256"] = _sha(core)
    return out


def validate_approval_receipt(evidence: Any) -> dict[str, Any]:
    if not isinstance(evidence, dict) or evidence.get("schema") != SCHEMA:
        raise ApprovalEvidenceError("approval_receipt_schema_invalid")
    if evidence.get("classification") != CLASSIFICATION or evidence.get("artifact_name") != ARTIFACT_NAME:
        raise ApprovalEvidenceError("approval_receipt_identity_invalid")
    if evidence.get("environment") != ENVIRONMENT:
        raise ApprovalEvidenceError("approval_receipt_environment_invalid")
    actor_id = _positive_int(evidence.get("initiator_actor_id"), "approval_receipt_initiator_actor_id")
    approvals = evidence.get("approvals")
    count = _positive_int(evidence.get("approved_review_count"), "approval_receipt_count")
    if not isinstance(approvals, list) or len(approvals) != count:
        raise ApprovalEvidenceError("approval_receipt_approvals_invalid")
    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(approvals):
        if not isinstance(item, dict):
            raise ApprovalEvidenceError(f"approval_receipt_entry_invalid:{index}")
        reviewer_id = _positive_int(item.get("reviewer_user_id"), f"approval_receipt_reviewer_id:{index}")
        if reviewer_id == actor_id:
            raise ApprovalEvidenceError("source_environment_self_approval_detected")
        login = _text(item.get("reviewer_login"), f"approval_receipt_reviewer_login:{index}")
        env_ids = item.get("environment_ids")
        if not isinstance(env_ids, list) or not env_ids:
            raise ApprovalEvidenceError(f"approval_receipt_environment_ids_invalid:{index}")
        normalized_ids = sorted({_positive_int(x, f"approval_receipt_environment_id:{index}") for x in env_ids})
        comment_sha = item.get("comment_sha256")
        if not isinstance(comment_sha, str) or not SHA256.fullmatch(comment_sha):
            raise ApprovalEvidenceError(f"approval_receipt_comment_sha_invalid:{index}")
        normalized.append({
            "reviewer_user_id": reviewer_id,
            "reviewer_login": login,
            "environment_ids": normalized_ids,
            "comment_sha256": comment_sha,
        })
    if normalized != sorted(normalized, key=lambda x: (x["reviewer_user_id"], x["environment_ids"], x["comment_sha256"])):
        raise ApprovalEvidenceError("approval_receipt_order_invalid")
    if evidence.get("self_review_absent") is not True or evidence.get("approval_event_observed") is not True:
        raise ApprovalEvidenceError("approval_receipt_state_invalid")
    if evidence.get("approval_timestamp_claimed") is not False:
        raise ApprovalEvidenceError("approval_receipt_timestamp_claim_invalid")
    if any(evidence.get(k) is not False for k in ("authority_effect", "r2_proven", "r3_proven", "persisted_seal_allowed")):
        raise ApprovalEvidenceError("approval_receipt_authority_boundary_invalid")
    claimed = evidence.get("approval_receipt_sha256")
    if not isinstance(claimed, str) or not SHA256.fullmatch(claimed):
        raise ApprovalEvidenceError("approval_receipt_sha256_invalid")
    core = dict(evidence)
    core.pop("approval_receipt_sha256", None)
    if _sha(core) != claimed:
        raise ApprovalEvidenceError("approval_receipt_sha256_mismatch")
    return evidence


def validate_approval_evidence(evidence: Any, history: Any, initiator_actor_id: int) -> dict[str, Any]:
    validate_approval_receipt(evidence)
    expected = build_approval_evidence(history, initiator_actor_id)
    if evidence != expected:
        raise ApprovalEvidenceError("source_environment_approval_evidence_mismatch")
    return expected


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="command", required=True)
    build = sub.add_parser("build")
    build.add_argument("--history", required=True)
    build.add_argument("--initiator-actor-id", required=True, type=int)
    build.add_argument("--output", required=True)
    val = sub.add_parser("validate")
    val.add_argument("--evidence", required=True)
    val.add_argument("--history", required=True)
    val.add_argument("--initiator-actor-id", required=True, type=int)
    val.add_argument("--output", required=True)
    a = p.parse_args(argv)
    try:
        history = _read(Path(a.history), "approval_history")
        if a.command == "build":
            result = build_approval_evidence(history, a.initiator_actor_id)
        else:
            result = validate_approval_evidence(_read(Path(a.evidence), "approval_evidence"), history, a.initiator_actor_id)
        _write(Path(a.output), result)
        return 0
    except ApprovalEvidenceError as exc:
        print(f"R1_SOURCE_ENVIRONMENT_APPROVAL_REJECTED:{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
