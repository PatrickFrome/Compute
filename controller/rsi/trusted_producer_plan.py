#!/usr/bin/env python3
"""V1.7 activation barrier for the future trusted RSI promotion attestor.

This module is deliberately non-actuating. It describes the exact workflow
identity, action pins, evidence set, and permissions that a future protected
release-branch workflow must satisfy before signing can be enabled. The RSI
candidate branch cannot turn this plan into signing authority.
"""

from __future__ import annotations

from typing import Any

from controller.rsi.promotion_attestation import (
    EXPECTED_REPOSITORY,
    EXPECTED_REPOSITORY_ID,
    TRUSTED_WORKFLOW_PATH,
    PromotionAttestationError,
    _require_int,
    _require_object,
    _require_sha40,
    _require_sha256,
    _require_text,
    _sha256_json,
)

PLAN_SCHEMA = "metaengine.rsi.trusted-promotion-producer-plan.v1"
EVIDENCE_MANIFEST_SCHEMA = "metaengine.rsi.promotion-evidence-manifest.v1"
ACTIVATION_SCHEMA = "metaengine.rsi.trusted-promotion-producer-activation.v1"
TRUSTED_REF = "refs/heads/release/self-update-ambiguity-live-v2"
TRUSTED_ENVIRONMENT = "rsi-promotion-attestation"
PINNED_CHECKOUT_ACTION = "actions/checkout@11d5960a326750d5838078e36cf38b85af677262"
PINNED_ATTEST_ACTION = "actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6"
PINNED_UPLOAD_ACTION = "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a"

REQUIRED_EVIDENCE = (
    "promotion-gate.json",
    "promotion-qualification.json",
    "shadow-canary-proof.json",
    "rollback-proof.json",
    "artifact-manifest.json",
    "slsa-provenance-verification.json",
    "github-workflow-runs.json",
)

REQUIRED_PERMISSIONS = {
    "contents": "read",
    "actions": "read",
    "id-token": "write",
    "attestations": "write",
}

FORBIDDEN_CAPABILITIES = (
    "browser_actuation",
    "process_execution",
    "installer_launch",
    "self_update_invocation",
    "release_promotion",
    "production_ddl",
    "arbitrary_shell_from_candidate_payload",
)


def _exact_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    if set(value) != expected:
        raise PromotionAttestationError(f"{label}_shape_invalid")


def create_trusted_producer_plan(*, candidate_sha: str, trusted_control_sha: str, evidence_run_id: int) -> dict[str, Any]:
    candidate = _require_sha40(candidate_sha, "candidate_sha")
    control_sha = _require_sha40(trusted_control_sha, "trusted_control_sha")
    if candidate == control_sha:
        raise PromotionAttestationError("candidate_cannot_be_trusted_control_sha")
    run_id = _require_int(evidence_run_id, "evidence_run_id")
    core = {
        "schema": PLAN_SCHEMA,
        "version": 1,
        "repository": {"id": EXPECTED_REPOSITORY_ID, "full_name": EXPECTED_REPOSITORY},
        "candidate_sha": candidate,
        "trusted_control": {
            "ref": TRUSTED_REF,
            "sha": control_sha,
            "workflow_path": TRUSTED_WORKFLOW_PATH,
            "environment": TRUSTED_ENVIRONMENT,
        },
        "evidence_source": {
            "run_id": run_id,
            "persisted_artifact_bytes_required": True,
            "caller_supplied_truth_trusted": False,
            "candidate_authored_evidence_allowed": False,
        },
        "required_evidence_files": list(REQUIRED_EVIDENCE),
        "required_action_pins": {
            "checkout": PINNED_CHECKOUT_ACTION,
            "attest": PINNED_ATTEST_ACTION,
            "upload": PINNED_UPLOAD_ACTION,
        },
        "required_job_permissions": dict(REQUIRED_PERMISSIONS),
        "workflow_policy": {
            "workflow_dispatch_only": True,
            "trusted_ref_only": True,
            "exact_trusted_control_sha_checkout_required": True,
            "protected_environment_required": True,
            "raw_github_run_readback_required": True,
            "artifact_byte_hashing_required": True,
            "independent_gh_attestation_verify_required": True,
            "verification_receipt_required": True,
            "pull_request_signing_allowed": False,
            "push_signing_allowed": False,
            "workflow_call_signing_allowed": False,
        },
        "forbidden_capabilities": list(FORBIDDEN_CAPABILITIES),
        "signing_activation_authorized": False,
        "promotion_authority": False,
        "self_update_authority": False,
        "execution_authority": False,
        "authority_effect": False,
    }
    return {**core, "plan_sha256": _sha256_json(core)}


def validate_trusted_producer_plan(value: Any) -> dict[str, Any]:
    value = _require_object(value, "trusted_producer_plan")
    if value.get("schema") != PLAN_SCHEMA or value.get("version") != 1:
        raise PromotionAttestationError("trusted_producer_plan_schema_invalid")
    claimed = _require_sha256(value.get("plan_sha256"), "plan_sha256")
    core = dict(value)
    core.pop("plan_sha256", None)
    if _sha256_json(core) != claimed:
        raise PromotionAttestationError("trusted_producer_plan_digest_mismatch")
    repo = _require_object(value.get("repository"), "trusted_producer_repository")
    if repo != {"id": EXPECTED_REPOSITORY_ID, "full_name": EXPECTED_REPOSITORY}:
        raise PromotionAttestationError("trusted_producer_repository_mismatch")
    _require_sha40(value.get("candidate_sha"), "candidate_sha")
    control = _require_object(value.get("trusted_control"), "trusted_control")
    if control.get("ref") != TRUSTED_REF or control.get("workflow_path") != TRUSTED_WORKFLOW_PATH or control.get("environment") != TRUSTED_ENVIRONMENT:
        raise PromotionAttestationError("trusted_control_identity_mismatch")
    _require_sha40(control.get("sha"), "trusted_control_sha")
    evidence = _require_object(value.get("evidence_source"), "trusted_evidence_source")
    _require_int(evidence.get("run_id"), "evidence_run_id")
    if evidence.get("persisted_artifact_bytes_required") is not True or evidence.get("caller_supplied_truth_trusted") is not False or evidence.get("candidate_authored_evidence_allowed") is not False:
        raise PromotionAttestationError("trusted_evidence_source_policy_invalid")
    if value.get("required_evidence_files") != list(REQUIRED_EVIDENCE):
        raise PromotionAttestationError("trusted_required_evidence_invalid")
    if value.get("required_action_pins") != {
        "checkout": PINNED_CHECKOUT_ACTION,
        "attest": PINNED_ATTEST_ACTION,
        "upload": PINNED_UPLOAD_ACTION,
    }:
        raise PromotionAttestationError("trusted_action_pins_invalid")
    if value.get("required_job_permissions") != REQUIRED_PERMISSIONS:
        raise PromotionAttestationError("trusted_permissions_invalid")
    policy = _require_object(value.get("workflow_policy"), "trusted_workflow_policy")
    for required_true in (
        "workflow_dispatch_only",
        "trusted_ref_only",
        "exact_trusted_control_sha_checkout_required",
        "protected_environment_required",
        "raw_github_run_readback_required",
        "artifact_byte_hashing_required",
        "independent_gh_attestation_verify_required",
        "verification_receipt_required",
    ):
        if policy.get(required_true) is not True:
            raise PromotionAttestationError(f"trusted_workflow_policy_{required_true}_invalid")
    for required_false in ("pull_request_signing_allowed", "push_signing_allowed", "workflow_call_signing_allowed"):
        if policy.get(required_false) is not False:
            raise PromotionAttestationError(f"trusted_workflow_policy_{required_false}_invalid")
    if value.get("forbidden_capabilities") != list(FORBIDDEN_CAPABILITIES):
        raise PromotionAttestationError("trusted_forbidden_capabilities_invalid")
    for field in ("signing_activation_authorized", "promotion_authority", "self_update_authority", "execution_authority", "authority_effect"):
        if value.get(field) is not False:
            raise PromotionAttestationError(f"trusted_producer_{field}_invalid")
    return dict(value)


def validate_evidence_manifest(manifest: Any, plan: Any) -> dict[str, Any]:
    plan = validate_trusted_producer_plan(plan)
    manifest = _require_object(manifest, "promotion_evidence_manifest")
    if manifest.get("schema") != EVIDENCE_MANIFEST_SCHEMA or manifest.get("version") != 1:
        raise PromotionAttestationError("promotion_evidence_manifest_schema_invalid")
    if _require_sha40(manifest.get("candidate_sha"), "manifest_candidate_sha") != plan["candidate_sha"]:
        raise PromotionAttestationError("promotion_evidence_manifest_candidate_mismatch")
    if _require_int(manifest.get("source_run_id"), "manifest_source_run_id") != plan["evidence_source"]["run_id"]:
        raise PromotionAttestationError("promotion_evidence_manifest_run_mismatch")
    if manifest.get("persisted_readback") is not True or manifest.get("authored_by_candidate") is not False or manifest.get("caller_supplied_truth_trusted") is not False:
        raise PromotionAttestationError("promotion_evidence_manifest_origin_invalid")
    files = manifest.get("files")
    if not isinstance(files, list) or len(files) != len(REQUIRED_EVIDENCE):
        raise PromotionAttestationError("promotion_evidence_manifest_files_invalid")
    by_name: dict[str, dict[str, Any]] = {}
    for raw in files:
        raw = _require_object(raw, "promotion_evidence_file")
        name = _require_text(raw.get("name"), "promotion_evidence_file_name", 128)
        if name in by_name or name not in REQUIRED_EVIDENCE:
            raise PromotionAttestationError("promotion_evidence_file_name_invalid")
        byte_count = _require_int(raw.get("bytes"), "promotion_evidence_file_bytes")
        by_name[name] = {
            "name": name,
            "sha256": _require_sha256(raw.get("sha256"), "promotion_evidence_file_sha256"),
            "bytes": byte_count,
        }
    if set(by_name) != set(REQUIRED_EVIDENCE):
        raise PromotionAttestationError("promotion_evidence_required_file_missing")
    ordered = [by_name[name] for name in REQUIRED_EVIDENCE]
    return {
        "candidate_sha": plan["candidate_sha"],
        "source_run_id": plan["evidence_source"]["run_id"],
        "files": ordered,
        "evidence_set_sha256": _sha256_json(ordered),
    }


def evaluate_trusted_producer_activation(*, plan: Any, evidence_manifest: Any, workflow_merged_to_trusted_ref: bool, protected_environment_configured: bool) -> dict[str, Any]:
    normalized_plan = validate_trusted_producer_plan(plan)
    blockers: list[str] = []
    try:
        evidence = validate_evidence_manifest(evidence_manifest, normalized_plan)
    except PromotionAttestationError as exc:
        evidence = None
        blockers.append(f"EVIDENCE_MANIFEST_INVALID:{exc}")
    if workflow_merged_to_trusted_ref is not True:
        blockers.append("TRUSTED_WORKFLOW_NOT_MERGED")
    if protected_environment_configured is not True:
        blockers.append("PROTECTED_ENVIRONMENT_NOT_CONFIGURED")
    state = "READY_FOR_TRUSTED_WORKFLOW_ACTIVATION" if not blockers else "BLOCKED"
    core = {
        "schema": ACTIVATION_SCHEMA,
        "version": 1,
        "state": state,
        "blockers": sorted(blockers),
        "candidate_sha": normalized_plan["candidate_sha"],
        "trusted_control_sha": normalized_plan["trusted_control"]["sha"],
        "plan_sha256": normalized_plan["plan_sha256"],
        "evidence_set_sha256": None if evidence is None else evidence["evidence_set_sha256"],
        "ready_for_workflow_activation": state == "READY_FOR_TRUSTED_WORKFLOW_ACTIVATION",
        "signing_activation_authorized": False,
        "promotion_authority": False,
        "self_update_authority": False,
        "execution_authority": False,
        "authority_effect": False,
        "required_next": "MERGE_PINNED_WORKFLOW_TO_TRUSTED_REF_THEN_REVALIDATE_EXACT_CONTROL_SHA_AND_ENVIRONMENT",
    }
    return {**core, "activation_sha256": _sha256_json(core)}
