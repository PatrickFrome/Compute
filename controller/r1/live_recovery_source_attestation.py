#!/usr/bin/env python3
"""Trusted live recovery source and attestation contract for R1 STEP07.

The module contains no database or provider clients and no credentials. It validates
source-environment metadata, fences a logical export against control-plane drift,
builds the custom in-toto predicate for the encrypted recovery ciphertext, and
validates JSON output produced by `gh attestation verify`.

A verified source attestation proves provenance of the encrypted source artifact.
It does NOT establish two-domain durability, R2/R3, or any persisted mainline seal.
"""

from __future__ import annotations

import argparse
import os
import hashlib
import json
import re
import sys
from urllib.parse import unquote, urlparse
from pathlib import Path
from typing import Any

from controller.r1.recovery_encryption_envelope import (
    ENVELOPE_CLASSIFICATION,
    ENVELOPE_SCHEMA,
    EnvelopeError,
    _canonical_bytes as envelope_canonical_bytes,
    _verify_self_hash as envelope_verify_self_hash,
    validate_envelope_receipt,
)

EXPECTED_REPOSITORY_ID = 1341371143
EXPECTED_REPOSITORY = "PatrickFrome/Compute"
EXPECTED_PROJECT_REF = "jhriwwsryeqsvvvufkok"
SOURCE_ENVIRONMENT = "r1-recovery-source"
SOURCE_WORKFLOW_PATH = ".github/workflows/r1-live-recovery-source.yml"
SOURCE_ARTIFACT_ATTESTATION_NAME = "r1-recovery-source-attestation.sigstore.jsonl"
SOURCE_PREDICATE_TYPE = "https://github.com/PatrickFrome/Compute/attestations/r1-recovery-source/v2"
SUPABASE_CLI_VERSION = "2.111.0"
FENCE_SCHEMA = "metaengine.compute.r1-source-control-fence.h205f22.v2"
EXPORT_METADATA_SCHEMA = "metaengine.compute.logical-export.v2"
PREDICATE_SCHEMA = "metaengine.compute.r1-recovery-source-attestation-predicate.h205f22.v2"
VERIFICATION_SCHEMA = "metaengine.compute.r1-recovery-source-attestation-verification.h205f22.v2"
DATABASE_CONNECTION_IDENTITY_SCHEMA = "metaengine.compute.r1-database-connection-identity.h205f22.v1"
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
SEMANTIC_HEAD = re.compile(r"^[A-Za-z0-9._:-]{8,240}$")


class SourceAttestationError(RuntimeError):
    pass


def validate_database_connection_identity_receipt(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SourceAttestationError("database_connection_identity_invalid")
    expected_keys = {
        "schema",
        "project_ref",
        "project_ref_verified",
        "binding",
        "connection_mode",
        "port",
        "database",
        "credential_present",
        "secret_material_persisted",
        "authority_effect",
    }
    if set(value) != expected_keys:
        raise SourceAttestationError("database_connection_identity_shape_invalid")
    if value.get("schema") != DATABASE_CONNECTION_IDENTITY_SCHEMA:
        raise SourceAttestationError("database_connection_identity_schema_invalid")
    if value.get("project_ref") != EXPECTED_PROJECT_REF or value.get("project_ref_verified") is not True:
        raise SourceAttestationError("database_connection_identity_project_ref_invalid")
    binding = value.get("binding")
    mode = value.get("connection_mode")
    if (binding, mode) not in {
        ("HOST", "DIRECT_OR_DEDICATED_POOLER"),
        ("USERNAME_SUFFIX", "SHARED_POOLER"),
    }:
        raise SourceAttestationError("database_connection_identity_binding_invalid")
    if value.get("port") not in (5432, 6543) or value.get("database") != "postgres":
        raise SourceAttestationError("database_connection_identity_endpoint_invalid")
    if value.get("credential_present") is not True:
        raise SourceAttestationError("database_connection_identity_credential_state_invalid")
    if value.get("secret_material_persisted") is not False or value.get("authority_effect") is not False:
        raise SourceAttestationError("database_connection_identity_authority_boundary_invalid")
    return dict(value)


def validate_database_url_project_identity(value: Any) -> dict[str, Any]:
    raw = _require_text(value, "database_url", minimum=20, maximum=8192)
    try:
        parsed = urlparse(raw)
        port = parsed.port
    except ValueError as exc:
        raise SourceAttestationError("database_url_invalid") from exc

    scheme = parsed.scheme.lower()
    if scheme not in {"postgres", "postgresql"}:
        raise SourceAttestationError("database_url_scheme_invalid")
    if parsed.fragment:
        raise SourceAttestationError("database_url_fragment_forbidden")

    host = (parsed.hostname or "").lower().rstrip(".")
    if not host:
        raise SourceAttestationError("database_url_host_missing")
    username = unquote(parsed.username or "")
    if not username:
        raise SourceAttestationError("database_url_username_missing")
    if parsed.password in (None, ""):
        raise SourceAttestationError("database_url_credential_missing")

    database = (parsed.path or "").lstrip("/")
    if database != "postgres":
        raise SourceAttestationError("database_url_database_invalid")
    if port not in (5432, 6543):
        raise SourceAttestationError("database_url_port_invalid")

    direct_host = f"db.{EXPECTED_PROJECT_REF}.supabase.co"
    if host == direct_host:
        binding = "HOST"
        mode = "DIRECT_OR_DEDICATED_POOLER"
    elif host.endswith(".pooler.supabase.com"):
        role_and_ref = username.rsplit(".", 1)
        if len(role_and_ref) != 2 or not role_and_ref[0]:
            raise SourceAttestationError("database_url_pooler_username_invalid")
        if role_and_ref[1] != EXPECTED_PROJECT_REF:
            raise SourceAttestationError("database_url_project_ref_mismatch")
        binding = "USERNAME_SUFFIX"
        mode = "SHARED_POOLER"
    elif host.startswith("db.") and host.endswith(".supabase.co"):
        raise SourceAttestationError("database_url_project_ref_mismatch")
    else:
        raise SourceAttestationError("database_url_supabase_host_invalid")

    return validate_database_connection_identity_receipt({
        "schema": DATABASE_CONNECTION_IDENTITY_SCHEMA,
        "project_ref": EXPECTED_PROJECT_REF,
        "project_ref_verified": True,
        "binding": binding,
        "connection_mode": mode,
        "port": port,
        "database": database,
        "credential_present": True,
        "secret_material_persisted": False,
        "authority_effect": False,
    })


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
        raise SourceAttestationError(f"file_unavailable:{path}") from exc
    return h.hexdigest(), total


def _read_json(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise SourceAttestationError(f"{label}_invalid_json") from exc


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(_canonical_bytes(value) + b"\n")


def _require_text(value: Any, field: str, minimum: int = 1, maximum: int = 2048) -> str:
    if not isinstance(value, str) or not (minimum <= len(value.strip()) <= maximum):
        raise SourceAttestationError(f"{field}_invalid")
    return value.strip()


def _require_sha(value: Any, field: str) -> str:
    if not isinstance(value, str) or not SHA256.fullmatch(value):
        raise SourceAttestationError(f"{field}_invalid")
    return value


def _require_int(value: Any, field: str, minimum: int = 1) -> int:
    if isinstance(value, bool):
        raise SourceAttestationError(f"{field}_invalid")
    try:
        result = int(value)
    except (TypeError, ValueError) as exc:
        raise SourceAttestationError(f"{field}_invalid") from exc
    if result < minimum:
        raise SourceAttestationError(f"{field}_invalid")
    return result


def _verify_self_hash(value: dict[str, Any], field: str, label: str) -> None:
    claimed = _require_sha(value.get(field), field)
    core = dict(value)
    core.pop(field, None)
    if _sha256_json(core) != claimed:
        raise SourceAttestationError(f"{label}_{field}_mismatch")


def validate_source_environment(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("name") != SOURCE_ENVIRONMENT:
        raise SourceAttestationError("source_environment_invalid")
    rules = value.get("protection_rules")
    if not isinstance(rules, list):
        raise SourceAttestationError("source_environment_protection_rules_missing")
    reviewers = [r for r in rules if isinstance(r, dict) and r.get("type") == "required_reviewers"]
    if len(reviewers) != 1:
        raise SourceAttestationError("source_environment_required_reviewers_missing")
    reviewer_rule = reviewers[0]
    reviewer_list = reviewer_rule.get("reviewers")
    if not isinstance(reviewer_list, list) or not reviewer_list:
        raise SourceAttestationError("source_environment_required_reviewers_empty")
    if reviewer_rule.get("prevent_self_review") is not True:
        raise SourceAttestationError("source_environment_prevent_self_review_required")
    branch_policy = value.get("deployment_branch_policy")
    if not isinstance(branch_policy, dict):
        raise SourceAttestationError("source_environment_branch_policy_missing")
    protected = branch_policy.get("protected_branches") is True
    custom = branch_policy.get("custom_branch_policies") is True
    if protected == custom:
        raise SourceAttestationError("source_environment_branch_policy_invalid")
    if not any(isinstance(r, dict) and r.get("type") == "branch_policy" for r in rules):
        raise SourceAttestationError("source_environment_branch_policy_rule_missing")
    return {
        "schema": "metaengine.compute.r1-source-environment-readiness.h205f22.v1",
        "environment": SOURCE_ENVIRONMENT,
        "required_reviewer_count": len(reviewer_list),
        "prevent_self_review": True,
        "branch_policy": {"protected_branches": protected, "custom_branch_policies": custom},
        "ready_for_source_generation": True,
        "authority_effect": False,
        "r2_proven": False,
        "persisted_seal_allowed": False,
    }


def _validate_fence(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema") != FENCE_SCHEMA:
        raise SourceAttestationError(f"{label}_schema_invalid")
    project_ref = _require_text(value.get("project_ref"), f"{label}_project_ref", minimum=20, maximum=20)
    if project_ref != EXPECTED_PROJECT_REF:
        raise SourceAttestationError(f"{label}_project_ref_mismatch")
    checkpoint_rows = _require_int(value.get("checkpoint_rows"), f"{label}_checkpoint_rows")
    checkpoint_sha = _require_sha(value.get("checkpoint_ledger_sha256"), f"{label}_checkpoint_ledger_sha256")
    latest_checkpoint_id = _require_sha(value.get("latest_checkpoint_id"), f"{label}_latest_checkpoint_id")
    latest_payload_sha = _require_sha(
        value.get("latest_checkpoint_payload_sha256"),
        f"{label}_latest_checkpoint_payload_sha256",
    )
    latest_source_sha = _require_text(
        value.get("latest_checkpoint_source_parent_sha"),
        f"{label}_latest_checkpoint_source_parent_sha",
        minimum=40,
        maximum=40,
    )
    if not SHA40.fullmatch(latest_source_sha):
        raise SourceAttestationError(f"{label}_latest_checkpoint_source_parent_sha_invalid")
    latest_evidence_state = _require_text(
        value.get("latest_checkpoint_evidence_state"),
        f"{label}_latest_checkpoint_evidence_state",
        maximum=32,
    )
    if latest_evidence_state not in {"LIVE_DB_ONLY", "EVIDENCE_READY", "PARTIAL"}:
        raise SourceAttestationError(f"{label}_latest_checkpoint_evidence_state_invalid")
    latest_kind = _require_text(
        value.get("latest_checkpoint_kind"),
        f"{label}_latest_checkpoint_kind",
        minimum=3,
        maximum=200,
    )
    roadmap_rows = _require_int(
        value.get("roadmap_authority_rows"),
        f"{label}_roadmap_authority_rows",
        minimum=0,
    )
    roadmap_sha = _require_sha(value.get("roadmap_authority_sha256"), f"{label}_roadmap_authority_sha256")
    migration_sha = _require_sha(value.get("migration_ledger_sha256"), f"{label}_migration_ledger_sha256")
    migration_rows = _require_int(value.get("migration_rows"), f"{label}_migration_rows")
    max_version = _require_text(value.get("max_migration_version"), f"{label}_max_migration_version", maximum=64)
    captured_at = _require_text(value.get("captured_at"), f"{label}_captured_at", maximum=80)
    return {
        "project_ref": project_ref,
        "checkpoint_rows": checkpoint_rows,
        "checkpoint_ledger_sha256": checkpoint_sha,
        "latest_checkpoint_id": latest_checkpoint_id,
        "latest_checkpoint_payload_sha256": latest_payload_sha,
        "latest_checkpoint_source_parent_sha": latest_source_sha,
        "latest_checkpoint_evidence_state": latest_evidence_state,
        "latest_checkpoint_kind": latest_kind,
        "roadmap_authority_rows": roadmap_rows,
        "roadmap_authority_sha256": roadmap_sha,
        "migration_ledger_sha256": migration_sha,
        "migration_rows": migration_rows,
        "max_migration_version": max_version,
        "captured_at": captured_at,
    }


def validate_control_fences(before: Any, after: Any) -> dict[str, Any]:
    a = _validate_fence(before, "before")
    b = _validate_fence(after, "after")
    stable_fields = (
        "project_ref",
        "checkpoint_rows",
        "checkpoint_ledger_sha256",
        "latest_checkpoint_id",
        "latest_checkpoint_payload_sha256",
        "latest_checkpoint_source_parent_sha",
        "latest_checkpoint_evidence_state",
        "latest_checkpoint_kind",
        "roadmap_authority_rows",
        "roadmap_authority_sha256",
        "migration_ledger_sha256",
        "migration_rows",
        "max_migration_version",
    )
    changed = [field for field in stable_fields if a[field] != b[field]]
    if changed:
        raise SourceAttestationError("source_control_fence_drift:" + ",".join(changed))
    return {
        "schema": "metaengine.compute.r1-source-control-fence-validation.h205f22.v2",
        "stable": True,
        **{field: a[field] for field in stable_fields},
        "captured_before": a["captured_at"],
        "captured_after": b["captured_at"],
    }


def build_export_metadata(before: Any, after: Any) -> dict[str, Any]:
    fence = validate_control_fences(before, after)
    return {
        "schema": EXPORT_METADATA_SCHEMA,
        "tool": "supabase-cli",
        "tool_version": SUPABASE_CLI_VERSION,
        "project_ref": EXPECTED_PROJECT_REF,
        "export_mode": "SUPABASE_LOGICAL_ROLES_SCHEMA_DATA",
        "project_owned_schemas": ["destruktion_meta"],
        "migration_ledger_separate": True,
        "checkpoint_rows": fence["checkpoint_rows"],
        "checkpoint_ledger_sha256": fence["checkpoint_ledger_sha256"],
        "latest_checkpoint_id": fence["latest_checkpoint_id"],
        "latest_checkpoint_payload_sha256": fence["latest_checkpoint_payload_sha256"],
        "latest_checkpoint_source_parent_sha": fence["latest_checkpoint_source_parent_sha"],
        "latest_checkpoint_evidence_state": fence["latest_checkpoint_evidence_state"],
        "latest_checkpoint_kind": fence["latest_checkpoint_kind"],
        "roadmap_authority_rows": fence["roadmap_authority_rows"],
        "roadmap_authority_sha256": fence["roadmap_authority_sha256"],
        "migration_ledger_sha256": fence["migration_ledger_sha256"],
        "migration_rows": fence["migration_rows"],
        "max_migration_version": fence["max_migration_version"],
        "control_fence_stable": True,
        "canonical_roadmap_claim": False,
        "captured_before": fence["captured_before"],
        "captured_after": fence["captured_after"],
        "supabase_managed_schemas_complete_claim": False,
        "physical_backup_export_claim": False,
        "storage_api_objects_included": False,
        "storage_warning": "SUPABASE_DATABASE_BACKUP_DOES_NOT_INCLUDE_STORAGE_API_OBJECT_BYTES",
    }


def _read_and_verify_bundle_receipt(path: Path) -> dict[str, Any]:
    value = _read_json(path, "bundle_receipt")
    if not isinstance(value, dict):
        raise SourceAttestationError("bundle_receipt_shape_invalid")
    try:
        envelope_verify_self_hash(value, "receipt_sha256", "bundle_receipt")
    except EnvelopeError as exc:
        raise SourceAttestationError(str(exc)) from exc
    for key in ("bundle_sha256", "manifest_sha256", "receipt_sha256"):
        _require_sha(value.get(key), f"bundle_{key}")
    if value.get("storage_api_objects_included") is not False:
        raise SourceAttestationError("source_storage_coverage_unexpected")
    if value.get("authority_effect") is not False or value.get("r2_proven") is not False or value.get("persisted_seal_allowed") is not False:
        raise SourceAttestationError("bundle_receipt_authority_boundary_invalid")
    return value


def build_source_predicate(
    *,
    ciphertext: Path,
    envelope_receipt_path: Path,
    bundle_receipt_path: Path,
    export_metadata_path: Path,
    source_head_sha: str,
    run_id: int,
    run_attempt: int,
) -> dict[str, Any]:
    if not SHA40.fullmatch(source_head_sha):
        raise SourceAttestationError("source_head_sha_invalid")
    run_id = _require_int(run_id, "run_id")
    run_attempt = _require_int(run_attempt, "run_attempt")
    try:
        envelope = validate_envelope_receipt(ciphertext, envelope_receipt_path, require_production_ready=True)
    except EnvelopeError as exc:
        raise SourceAttestationError(str(exc)) from exc
    bundle = _read_and_verify_bundle_receipt(bundle_receipt_path)
    metadata = _read_json(export_metadata_path, "export_metadata")
    if not isinstance(metadata, dict) or metadata.get("schema") != EXPORT_METADATA_SCHEMA:
        raise SourceAttestationError("export_metadata_schema_invalid")
    if metadata.get("tool_version") != SUPABASE_CLI_VERSION or metadata.get("project_ref") != EXPECTED_PROJECT_REF:
        raise SourceAttestationError("export_metadata_identity_invalid")
    try:
        connection_identity = validate_database_connection_identity_receipt(
            metadata.get("database_connection_identity")
        )
    except SourceAttestationError as exc:
        raise SourceAttestationError("export_database_connection_identity_invalid") from exc
    if metadata.get("control_fence_stable") is not True:
        raise SourceAttestationError("export_control_fence_not_stable")
    if metadata.get("storage_api_objects_included") is not False:
        raise SourceAttestationError("export_storage_coverage_unexpected")
    if bundle["bundle_sha256"] != envelope.get("source_bundle", {}).get("bundle_sha256"):
        raise SourceAttestationError("envelope_bundle_digest_mismatch")
    if bundle["receipt_sha256"] != envelope.get("source_bundle", {}).get("bundle_receipt_sha256"):
        raise SourceAttestationError("envelope_bundle_receipt_digest_mismatch")
    cipher_sha, cipher_bytes = _hash_file(ciphertext)
    cipher = envelope.get("ciphertext") or {}
    if cipher_sha != cipher.get("sha256") or cipher_bytes != cipher.get("bytes"):
        raise SourceAttestationError("ciphertext_envelope_mismatch")

    core = {
        "schema": PREDICATE_SCHEMA,
        "classification": "TRUSTED_RECOVERY_SOURCE_ATTESTATION_PREDICATE",
        "source": {
            "repository_id": EXPECTED_REPOSITORY_ID,
            "repository": EXPECTED_REPOSITORY,
            "workflow_path": SOURCE_WORKFLOW_PATH,
            "head_sha": source_head_sha,
            "run_id": run_id,
            "run_attempt": run_attempt,
            "event": "workflow_dispatch",
            "ref": "refs/heads/main",
            "environment": SOURCE_ENVIRONMENT,
        },
        "database_export": {
            "project_ref": EXPECTED_PROJECT_REF,
            "mode": metadata["export_mode"],
            "supabase_cli_version": SUPABASE_CLI_VERSION,
            "checkpoint_rows": metadata["checkpoint_rows"],
            "checkpoint_ledger_sha256": metadata["checkpoint_ledger_sha256"],
            "latest_checkpoint_id": metadata["latest_checkpoint_id"],
            "latest_checkpoint_payload_sha256": metadata["latest_checkpoint_payload_sha256"],
            "latest_checkpoint_source_parent_sha": metadata["latest_checkpoint_source_parent_sha"],
            "latest_checkpoint_evidence_state": metadata["latest_checkpoint_evidence_state"],
            "latest_checkpoint_kind": metadata["latest_checkpoint_kind"],
            "roadmap_authority_rows": metadata["roadmap_authority_rows"],
            "roadmap_authority_sha256": metadata["roadmap_authority_sha256"],
            "migration_ledger_sha256": metadata["migration_ledger_sha256"],
            "migration_rows": metadata["migration_rows"],
            "max_migration_version": metadata["max_migration_version"],
            "control_fence_stable": True,
            "canonical_roadmap_claim": False,
            "connection_identity": connection_identity,
            "supabase_managed_schemas_complete_claim": False,
            "storage_api_objects_included": False,
        },
        "bundle": {
            "bundle_sha256": bundle["bundle_sha256"],
            "bundle_bytes": bundle["bundle_bytes"],
            "manifest_sha256": bundle["manifest_sha256"],
            "bundle_receipt_sha256": bundle["receipt_sha256"],
        },
        "ciphertext": {
            "sha256": cipher_sha,
            "bytes": cipher_bytes,
            "envelope_receipt_sha256": envelope["receipt_sha256"],
            "encryption_profile": envelope["encryption"]["profile"],
            "recipient_count": envelope["encryption"]["recipient_count"],
        },
        "coverage": {
            "database_logical_export_included": True,
            "storage_api_object_bytes_included": False,
            "storage_warning": "SUPABASE_DATABASE_BACKUP_DOES_NOT_INCLUDE_STORAGE_API_OBJECT_BYTES",
        },
        "authority": {
            "source_attestation_candidate": True,
            "source_attestation_verified_by_consumer": False,
            "authority_effect": False,
            "r2_proven": False,
            "r3_proven": False,
            "persisted_seal_allowed": False,
        },
        "required_next": "CONSUMER_VERIFY_SIGSTORE_BUNDLE_BEFORE_PROVIDER_CREDENTIALS_THEN_TWO_DOMAIN_VERSION_PINNED_READBACK",
    }
    result = dict(core)
    result["predicate_sha256"] = _sha256_json(core)
    return result


def validate_verification_result(
    *,
    verification: Any,
    ciphertext: Path,
    envelope_receipt_path: Path,
    expected_source_head_sha: str,
    expected_source_run_id: int,
) -> dict[str, Any]:
    if not SHA40.fullmatch(expected_source_head_sha):
        raise SourceAttestationError("expected_source_head_sha_invalid")
    expected_source_run_id = _require_int(expected_source_run_id, "expected_source_run_id")
    if not isinstance(verification, list) or len(verification) != 1 or not isinstance(verification[0], dict):
        raise SourceAttestationError("attestation_verification_result_must_be_single")
    vr = verification[0].get("verificationResult")
    if not isinstance(vr, dict):
        raise SourceAttestationError("verification_result_missing")
    timestamps = vr.get("verifiedTimestamps")
    if not isinstance(timestamps, list) or not timestamps:
        raise SourceAttestationError("verified_timestamp_missing")
    statement = vr.get("statement")
    if not isinstance(statement, dict) or statement.get("predicateType") != SOURCE_PREDICATE_TYPE:
        raise SourceAttestationError("attestation_predicate_type_invalid")
    subjects = statement.get("subject")
    if not isinstance(subjects, list) or len(subjects) != 1 or not isinstance(subjects[0], dict):
        raise SourceAttestationError("attestation_subject_invalid")
    actual_sha, actual_bytes = _hash_file(ciphertext)
    digest = subjects[0].get("digest")
    if not isinstance(digest, dict) or digest.get("sha256") != actual_sha:
        raise SourceAttestationError("attestation_subject_digest_mismatch")

    try:
        envelope = validate_envelope_receipt(ciphertext, envelope_receipt_path, require_production_ready=True)
    except EnvelopeError as exc:
        raise SourceAttestationError(str(exc)) from exc
    predicate = statement.get("predicate")
    if not isinstance(predicate, dict) or predicate.get("schema") != PREDICATE_SCHEMA:
        raise SourceAttestationError("attestation_predicate_schema_invalid")
    _verify_self_hash(predicate, "predicate_sha256", "attestation_predicate")
    source = predicate.get("source")
    if not isinstance(source, dict):
        raise SourceAttestationError("attestation_source_missing")
    expected_source = {
        "repository_id": EXPECTED_REPOSITORY_ID,
        "repository": EXPECTED_REPOSITORY,
        "workflow_path": SOURCE_WORKFLOW_PATH,
        "head_sha": expected_source_head_sha,
        "run_id": expected_source_run_id,
        "event": "workflow_dispatch",
        "ref": "refs/heads/main",
        "environment": SOURCE_ENVIRONMENT,
    }
    for key, expected in expected_source.items():
        if source.get(key) != expected:
            raise SourceAttestationError(f"attestation_source_binding_mismatch:{key}")
    cipher = predicate.get("ciphertext")
    if not isinstance(cipher, dict) or cipher.get("sha256") != actual_sha or cipher.get("bytes") != actual_bytes:
        raise SourceAttestationError("attestation_ciphertext_binding_mismatch")
    if cipher.get("envelope_receipt_sha256") != envelope.get("receipt_sha256"):
        raise SourceAttestationError("attestation_envelope_binding_mismatch")
    coverage = predicate.get("coverage")
    if not isinstance(coverage, dict) or coverage.get("storage_api_object_bytes_included") is not False:
        raise SourceAttestationError("attestation_coverage_boundary_invalid")
    authority = predicate.get("authority")
    if not isinstance(authority, dict):
        raise SourceAttestationError("attestation_authority_missing")
    if authority.get("source_attestation_candidate") is not True or authority.get("source_attestation_verified_by_consumer") is not False:
        raise SourceAttestationError("attestation_authority_source_state_invalid")
    if any(authority.get(k) is not False for k in ("authority_effect", "r2_proven", "r3_proven", "persisted_seal_allowed")):
        raise SourceAttestationError("attestation_authority_boundary_invalid")

    core = {
        "schema": VERIFICATION_SCHEMA,
        "classification": "CRYPTOGRAPHICALLY_VERIFIED_RECOVERY_SOURCE_NONAUTHORITATIVE",
        "source": {
            "repository_id": EXPECTED_REPOSITORY_ID,
            "repository": EXPECTED_REPOSITORY,
            "workflow_path": SOURCE_WORKFLOW_PATH,
            "head_sha": expected_source_head_sha,
            "run_id": expected_source_run_id,
        },
        "predicate_type": SOURCE_PREDICATE_TYPE,
        "predicate_sha256": predicate["predicate_sha256"],
        "ciphertext_sha256": actual_sha,
        "ciphertext_bytes": actual_bytes,
        "envelope_receipt_sha256": envelope["receipt_sha256"],
        "latest_checkpoint_id_at_source": predicate["database_export"]["latest_checkpoint_id"],
        "latest_checkpoint_payload_sha256": predicate["database_export"]["latest_checkpoint_payload_sha256"],
        "latest_checkpoint_source_parent_sha": predicate["database_export"]["latest_checkpoint_source_parent_sha"],
        "checkpoint_ledger_sha256": predicate["database_export"]["checkpoint_ledger_sha256"],
        "roadmap_authority_sha256": predicate["database_export"]["roadmap_authority_sha256"],
        "migration_ledger_sha256": predicate["database_export"]["migration_ledger_sha256"],
        "verified_timestamp_count": len(timestamps),
        "source_attestation_verified": True,
        "authority_effect": False,
        "r2_proven": False,
        "r3_proven": False,
        "persisted_seal_allowed": False,
        "final_r2_evidence_binding_required": True,
    }
    result = dict(core)
    result["verification_receipt_sha256"] = _sha256_json(core)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    env = sub.add_parser("validate-environment")
    env.add_argument("--input", required=True)
    env.add_argument("--output", required=True)

    dburl = sub.add_parser("validate-db-url")
    dburl.add_argument("--env-name", required=True)
    dburl.add_argument("--output", required=True)

    meta = sub.add_parser("build-export-metadata")
    meta.add_argument("--before", required=True)
    meta.add_argument("--after", required=True)
    meta.add_argument("--output", required=True)

    pred = sub.add_parser("build-predicate")
    pred.add_argument("--ciphertext", required=True)
    pred.add_argument("--envelope-receipt", required=True)
    pred.add_argument("--bundle-receipt", required=True)
    pred.add_argument("--export-metadata", required=True)
    pred.add_argument("--source-head-sha", required=True)
    pred.add_argument("--run-id", required=True, type=int)
    pred.add_argument("--run-attempt", required=True, type=int)
    pred.add_argument("--output", required=True)

    verify = sub.add_parser("validate-verification")
    verify.add_argument("--verification", required=True)
    verify.add_argument("--ciphertext", required=True)
    verify.add_argument("--envelope-receipt", required=True)
    verify.add_argument("--source-head-sha", required=True)
    verify.add_argument("--source-run-id", required=True, type=int)
    verify.add_argument("--output", required=True)

    args = parser.parse_args(argv)
    try:
        if args.command == "validate-environment":
            _write_json(Path(args.output), validate_source_environment(_read_json(Path(args.input), "environment")))
            return 0
        if args.command == "validate-db-url":
            env_name = _require_text(args.env_name, "database_url_env_name", minimum=1, maximum=128)
            value = os.environ.get(env_name)
            if value in (None, ""):
                raise SourceAttestationError("database_url_env_missing")
            _write_json(Path(args.output), validate_database_url_project_identity(value))
            return 0
        if args.command == "build-export-metadata":
            _write_json(Path(args.output), build_export_metadata(
                _read_json(Path(args.before), "before"),
                _read_json(Path(args.after), "after"),
            ))
            return 0
        if args.command == "build-predicate":
            _write_json(Path(args.output), build_source_predicate(
                ciphertext=Path(args.ciphertext),
                envelope_receipt_path=Path(args.envelope_receipt),
                bundle_receipt_path=Path(args.bundle_receipt),
                export_metadata_path=Path(args.export_metadata),
                source_head_sha=args.source_head_sha,
                run_id=args.run_id,
                run_attempt=args.run_attempt,
            ))
            return 0
        if args.command == "validate-verification":
            _write_json(Path(args.output), validate_verification_result(
                verification=_read_json(Path(args.verification), "verification"),
                ciphertext=Path(args.ciphertext),
                envelope_receipt_path=Path(args.envelope_receipt),
                expected_source_head_sha=args.source_head_sha,
                expected_source_run_id=args.source_run_id,
            ))
            return 0
        raise SourceAttestationError("unknown_command")
    except SourceAttestationError as exc:
        print(f"R1_SOURCE_ATTESTATION_REJECTED:{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
