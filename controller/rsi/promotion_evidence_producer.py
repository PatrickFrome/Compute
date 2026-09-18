#!/usr/bin/env python3
"""Trusted-input preparation for an RSI promotion attestation subject.

This is still PREP-only: it does not call GitHub APIs, sign, attest, promote, or
install. A future trusted workflow must independently download the raw GitHub run
metadata and evidence files, then pass those persisted bytes here. The producer
cross-checks V1.5 qualification claims against those raw run records before a
subject becomes eligible for cryptographic attestation.
"""

from __future__ import annotations

import json
from typing import Any

from controller.rsi.promotion_attestation import (
    EXPECTED_REPOSITORY,
    EXPECTED_REPOSITORY_ID,
    PromotionAttestationError,
    _require_int,
    _require_object,
    _require_sha40,
    _require_sha256,
    _require_text,
    _sha256_json,
    _assert_zero_authority,
    build_promotion_subject,
    validate_gate,
    validate_subject,
)

QUALIFICATION_SCHEMA = "metaengine.rsi.external-promotion-qualification.v1"
SLSA_PROVENANCE_V1 = "https://slsa.dev/provenance/v1"
REQUIRED_WORKFLOWS = (
    "METAENGINE Browser Shell V1",
    "METAENGINE Browser Critical Audit V1",
    "Browser Windows Installed Chat Qualification",
    "METAENGINE Browser Final Runtime Activation V1",
    "METAENGINE Browser Windows Autonomous Soak V1",
    "Browser Windows Package Smoke",
    "METAENGINE Browser Self Update E2E",
)


def _verify_qualification_digest(value: dict[str, Any]) -> str:
    claimed = _require_sha256(value.get("qualification_digest"), "qualification_digest")
    core = dict(value)
    core.pop("qualification_digest", None)
    if _sha256_json(core) != claimed:
        raise PromotionAttestationError("qualification_digest_mismatch")
    return claimed


def validate_qualification(qualification: Any, gate: Any) -> dict[str, Any]:
    gate_identity = validate_gate(gate)
    qualification = _require_object(qualification, "qualification")
    if qualification.get("schema") != QUALIFICATION_SCHEMA or qualification.get("version") != 1:
        raise PromotionAttestationError("qualification_schema_invalid")
    _assert_zero_authority(qualification, "qualification")
    if qualification.get("external_verifier") is not True or qualification.get("authored_by_candidate") is not False:
        raise PromotionAttestationError("qualification_origin_invalid")
    if qualification.get("direct_install_authorized") is not False or qualification.get("self_update_invocation_authorized") is not False:
        raise PromotionAttestationError("qualification_actuation_forbidden")
    if _require_text(qualification.get("candidate_id"), "qualification_candidate_id", 96).lower() != gate_identity["candidate_id"]:
        raise PromotionAttestationError("qualification_candidate_id_mismatch")
    if _require_sha40(qualification.get("candidate_sha"), "qualification_candidate_sha") != gate_identity["candidate_sha"]:
        raise PromotionAttestationError("qualification_candidate_sha_mismatch")
    if _require_sha40(qualification.get("parent_sha"), "qualification_parent_sha") != gate_identity["parent_sha"]:
        raise PromotionAttestationError("qualification_parent_sha_mismatch")

    qualification_digest = _verify_qualification_digest(qualification)
    if qualification_digest != gate_identity["qualification_digest"]:
        raise PromotionAttestationError("qualification_gate_digest_binding_mismatch")

    artifact = _require_object(qualification.get("artifact"), "qualification_artifact")
    artifact_digest = _require_sha256(artifact.get("digest"), "qualification_artifact_digest")
    if artifact_digest != gate_identity["artifact_digest"]:
        raise PromotionAttestationError("qualification_artifact_gate_mismatch")
    if artifact.get("signed") is not True or artifact.get("signature_verified") is not True:
        raise PromotionAttestationError("qualification_artifact_signature_unverified")

    provenance = _require_object(qualification.get("provenance"), "qualification_provenance")
    provenance_digest = _require_sha256(provenance.get("digest"), "qualification_provenance_digest")
    if provenance_digest != gate_identity["provenance_digest"]:
        raise PromotionAttestationError("qualification_provenance_gate_mismatch")
    if provenance.get("predicate_type") != SLSA_PROVENANCE_V1 or provenance.get("verified") is not True:
        raise PromotionAttestationError("qualification_provenance_unverified")
    if _require_sha40(provenance.get("source_sha"), "qualification_provenance_source_sha") != gate_identity["candidate_sha"]:
        raise PromotionAttestationError("qualification_provenance_source_mismatch")
    if _require_text(provenance.get("source_repository"), "qualification_provenance_repository", 200) != EXPECTED_REPOSITORY:
        raise PromotionAttestationError("qualification_provenance_repository_mismatch")

    checks = qualification.get("ci_checks")
    if not isinstance(checks, list) or len(checks) != len(REQUIRED_WORKFLOWS):
        raise PromotionAttestationError("qualification_ci_checks_invalid")
    normalized_checks: dict[str, dict[str, Any]] = {}
    for check in checks:
        check = _require_object(check, "qualification_ci_check")
        workflow = _require_text(check.get("workflow"), "qualification_ci_workflow", 160)
        if workflow in normalized_checks or workflow not in REQUIRED_WORKFLOWS:
            raise PromotionAttestationError("qualification_ci_workflow_invalid")
        row = {
            "workflow": workflow,
            "run_id": _require_int(check.get("run_id"), "qualification_ci_run_id"),
            "head_sha": _require_sha40(check.get("head_sha"), "qualification_ci_head_sha"),
            "conclusion": _require_text(check.get("conclusion"), "qualification_ci_conclusion", 32).upper(),
            "evidence_ref": _require_text(check.get("evidence_ref"), "qualification_ci_evidence_ref"),
        }
        if row["head_sha"] != gate_identity["candidate_sha"] or row["conclusion"] != "SUCCESS":
            raise PromotionAttestationError("qualification_ci_not_exact_green")
        normalized_checks[workflow] = row
    if set(normalized_checks) != set(REQUIRED_WORKFLOWS):
        raise PromotionAttestationError("qualification_required_ci_missing")

    canary = _require_object(qualification.get("canary"), "qualification_canary")
    if canary.get("mode") != "SHADOW_CANARY" or canary.get("result") != "PASS":
        raise PromotionAttestationError("qualification_canary_not_pass")
    if _require_sha40(canary.get("candidate_sha"), "qualification_canary_candidate") != gate_identity["candidate_sha"]:
        raise PromotionAttestationError("qualification_canary_candidate_mismatch")
    if _require_sha256(canary.get("artifact_digest"), "qualification_canary_artifact") != artifact_digest:
        raise PromotionAttestationError("qualification_canary_artifact_mismatch")
    for field in ("duplicate_irreversible_effects", "ambiguous_effect_retries", "authority_violations", "workspace_escapes"):
        value = canary.get(field)
        if isinstance(value, bool) or not isinstance(value, int) or value != 0:
            raise PromotionAttestationError(f"qualification_canary_{field}_nonzero")

    rollback = _require_object(qualification.get("rollback"), "qualification_rollback")
    if _require_sha40(rollback.get("predecessor_sha"), "qualification_rollback_predecessor") != gate_identity["parent_sha"]:
        raise PromotionAttestationError("qualification_rollback_predecessor_mismatch")
    if rollback.get("ready") is not True or rollback.get("ambiguous_effect_replay_allowed") is not False:
        raise PromotionAttestationError("qualification_rollback_not_safe")

    return {
        "gate": gate_identity,
        "qualification_digest": qualification_digest,
        "artifact_digest": artifact_digest,
        "provenance_digest": provenance_digest,
        "checks": normalized_checks,
    }


def validate_persisted_github_runs(runs: Any, qualification_projection: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(runs, list) or len(runs) != len(REQUIRED_WORKFLOWS):
        raise PromotionAttestationError("persisted_ci_runs_invalid")
    candidate_sha = qualification_projection["gate"]["candidate_sha"]
    expected_checks = qualification_projection["checks"]
    normalized: dict[str, dict[str, Any]] = {}
    for raw in runs:
        raw = _require_object(raw, "persisted_ci_run")
        name = _require_text(raw.get("name"), "persisted_ci_name", 160)
        if name in normalized or name not in REQUIRED_WORKFLOWS:
            raise PromotionAttestationError("persisted_ci_name_invalid")
        repository = _require_object(raw.get("repository"), "persisted_ci_repository")
        if repository.get("id") != EXPECTED_REPOSITORY_ID or repository.get("full_name") != EXPECTED_REPOSITORY:
            raise PromotionAttestationError("persisted_ci_repository_mismatch")
        row = {
            "workflow": name,
            "run_id": _require_int(raw.get("id"), "persisted_ci_run_id"),
            "run_attempt": _require_int(raw.get("run_attempt", 1), "persisted_ci_run_attempt"),
            "head_sha": _require_sha40(raw.get("head_sha"), "persisted_ci_head_sha"),
            "event": _require_text(raw.get("event"), "persisted_ci_event", 64),
            "status": _require_text(raw.get("status"), "persisted_ci_status", 32).lower(),
            "conclusion": _require_text(raw.get("conclusion"), "persisted_ci_conclusion", 32).upper(),
        }
        expected = expected_checks.get(name)
        if expected is None or row["run_id"] != expected["run_id"]:
            raise PromotionAttestationError("persisted_ci_run_id_claim_mismatch")
        if row["head_sha"] != candidate_sha or row["head_sha"] != expected["head_sha"]:
            raise PromotionAttestationError("persisted_ci_head_mismatch")
        if row["event"] != "pull_request" or row["status"] != "completed" or row["conclusion"] != "SUCCESS":
            raise PromotionAttestationError("persisted_ci_not_completed_success")
        normalized[name] = row
    if set(normalized) != set(REQUIRED_WORKFLOWS):
        raise PromotionAttestationError("persisted_ci_required_run_missing")
    ordered = [normalized[name] for name in REQUIRED_WORKFLOWS]
    return {
        "runs": ordered,
        "run_set_sha256": _sha256_json(ordered),
    }


def build_subject_from_persisted_evidence(
    *,
    gate: Any,
    qualification: Any,
    github_runs: Any,
    canary_evidence_digest: str,
    rollback_evidence_digest: str,
) -> dict[str, Any]:
    qualification_projection = validate_qualification(qualification, gate)
    persisted = validate_persisted_github_runs(github_runs, qualification_projection)
    subject = build_promotion_subject(
        gate,
        canary_evidence_digest=canary_evidence_digest,
        rollback_evidence_digest=rollback_evidence_digest,
    )
    core = dict(subject)
    core.pop("subject_sha256", None)
    core["ci_run_set_sha256"] = persisted["run_set_sha256"]
    core["ci_run_ids"] = [row["run_id"] for row in persisted["runs"]]
    core["evidence_producer"] = "TRUSTED_PERSISTED_GITHUB_RUN_READBACK_REQUIRED"
    core["caller_supplied_ci_status_trusted"] = False
    hardened = {**core, "subject_sha256": _sha256_json(core)}
    validate_subject(hardened)
    return hardened
