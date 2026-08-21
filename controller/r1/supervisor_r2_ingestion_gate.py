#!/usr/bin/env python3
"""STEP09A supervisor evidence gate before any continuity DB mutation.

The gate is credential-free and network-free. It verifies a STEP08 package, the
materialized ciphertext bytes, a strict GitHub attestation verification result, a
fresh trusted-root execution context, and the live seven-day readback freshness
boundary. Passing this gate means only that STEP09B may attempt the append-only DB
transaction. It never inserts rows, proves R2/R3, or creates a persisted seal.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import posixpath
import re
import sys
import tarfile
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from controller.r1.final_r2_evidence_package import (
    PACKAGE_SCHEMA,
    PROJECTION_SCHEMA,
    RECEIPT_SCHEMA,
)
from controller.r1.live_recovery_source_attestation import (
    EXPECTED_REPOSITORY,
    SOURCE_PREDICATE_TYPE,
    SOURCE_WORKFLOW_PATH,
    validate_verification_result,
)
from controller.r1.source_environment_evidence_binding import bind_verification

GATE_SCHEMA = "metaengine.compute.r1-supervisor-r2-ingestion-gate.h205f22.v1"
ROOT_CONTEXT_SCHEMA = "metaengine.compute.r1-supervisor-trusted-root-context.h205f22.v1"
GATE_CLASSIFICATION = "SUPERVISOR_R2_INGESTION_ELIGIBILITY_PRE_DB_NONAUTHORITATIVE"
ROOT_CONTEXT_CLASSIFICATION = "ONLINE_TRUSTED_ROOT_FETCH_CONTEXT_NONAUTHORITATIVE"
EXPECTED_ISSUER = "https://token.actions.githubusercontent.com"
EXPECTED_SOURCE_REF = "refs/heads/main"
ROOT_CONTEXT_MAX_AGE = timedelta(minutes=15)
MAX_PACKAGE_BYTES = 64 * 1024 * 1024
MAX_MEMBER_BYTES = 16 * 1024 * 1024
MAX_MEMBERS = 64
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")


class SupervisorGateError(RuntimeError):
    pass


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha_json(value: Any) -> str:
    return _sha_bytes(_canonical(value))


def _read_bytes(path: Path, label: str, maximum: int) -> bytes:
    try:
        value = path.read_bytes()
    except OSError as exc:
        raise SupervisorGateError(f"{label}_unavailable") from exc
    if not value:
        raise SupervisorGateError(f"{label}_empty")
    if len(value) > maximum:
        raise SupervisorGateError(f"{label}_too_large")
    return value


def _read_json(path: Path, label: str, maximum: int = MAX_MEMBER_BYTES) -> Any:
    raw = _read_bytes(path, label, maximum)
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SupervisorGateError(f"{label}_invalid_json") from exc


def _parse_json(raw: bytes, label: str) -> Any:
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SupervisorGateError(f"{label}_invalid_json") from exc


def _parse_time(value: Any, field: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise SupervisorGateError(f"{field}_missing")
    try:
        dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError as exc:
        raise SupervisorGateError(f"{field}_invalid") from exc
    if dt.tzinfo is None:
        raise SupervisorGateError(f"{field}_timezone_required")
    return dt.astimezone(timezone.utc)


def _require_sha(value: Any, field: str) -> str:
    if not isinstance(value, str) or SHA256.fullmatch(value) is None:
        raise SupervisorGateError(f"{field}_invalid")
    return value


def _require_positive_int(value: Any, field: str) -> int:
    if isinstance(value, bool):
        raise SupervisorGateError(f"{field}_invalid")
    try:
        out = int(value)
    except (TypeError, ValueError) as exc:
        raise SupervisorGateError(f"{field}_invalid") from exc
    if out < 1:
        raise SupervisorGateError(f"{field}_invalid")
    return out


def _verify_self_hash(value: Any, field: str, label: str) -> str:
    if not isinstance(value, dict):
        raise SupervisorGateError(f"{label}_shape_invalid")
    claimed = _require_sha(value.get(field), field)
    core = dict(value)
    core.pop(field, None)
    if _sha_json(core) != claimed:
        raise SupervisorGateError(f"{label}_{field}_mismatch")
    return claimed


def _safe_tar_path(name: str) -> None:
    if not isinstance(name, str) or not name or name.startswith("/"):
        raise SupervisorGateError("package_member_path_invalid")
    normalized = posixpath.normpath(name)
    if normalized != name or normalized in (".", "..") or normalized.startswith("../"):
        raise SupervisorGateError("package_member_path_invalid")


def _load_package(package_path: Path, receipt_path: Path) -> tuple[dict[str, bytes], dict[str, Any], dict[str, Any], dict[str, Any]]:
    package = _read_bytes(package_path, "step08_package", MAX_PACKAGE_BYTES)
    receipt = _read_json(receipt_path, "step08_package_receipt")
    if not isinstance(receipt, dict) or receipt.get("schema") != RECEIPT_SCHEMA:
        raise SupervisorGateError("step08_receipt_schema_invalid")
    receipt_sha = _verify_self_hash(receipt, "receipt_sha256", "step08_receipt")
    if receipt.get("package_sha256") != _sha_bytes(package) or receipt.get("package_bytes") != len(package):
        raise SupervisorGateError("step08_package_identity_mismatch")
    if any(receipt.get(k) is not False for k in ("database_write_performed", "provider_call_performed", "canonical", "authority_effect", "r2_proven", "r3_proven", "persisted_seal_allowed")):
        raise SupervisorGateError("step08_receipt_authority_boundary_invalid")
    if receipt.get("ciphertext_included") is not False or receipt.get("offline_reverification_required") is not True:
        raise SupervisorGateError("step08_receipt_reverification_boundary_invalid")

    entries: dict[str, bytes] = {}
    total = 0
    try:
        with tarfile.open(fileobj=io.BytesIO(package), mode="r:") as tf:
            members = tf.getmembers()
            if len(members) > MAX_MEMBERS:
                raise SupervisorGateError("step08_package_too_many_members")
            for member in members:
                _safe_tar_path(member.name)
                if not member.isfile():
                    raise SupervisorGateError("step08_package_non_regular_member")
                if member.size < 0 or member.size > MAX_MEMBER_BYTES:
                    raise SupervisorGateError("step08_package_member_too_large")
                if member.name in entries:
                    raise SupervisorGateError("step08_package_duplicate_member")
                handle = tf.extractfile(member)
                if handle is None:
                    raise SupervisorGateError("step08_package_member_unreadable")
                data = handle.read(MAX_MEMBER_BYTES + 1)
                if len(data) != member.size or len(data) > MAX_MEMBER_BYTES:
                    raise SupervisorGateError("step08_package_member_size_mismatch")
                total += len(data)
                if total > MAX_PACKAGE_BYTES:
                    raise SupervisorGateError("step08_package_unpacked_too_large")
                entries[member.name] = data
    except tarfile.TarError as exc:
        raise SupervisorGateError("step08_package_invalid_tar") from exc

    manifest_raw = entries.get("manifest.json")
    if manifest_raw is None:
        raise SupervisorGateError("step08_manifest_missing")
    manifest = _parse_json(manifest_raw, "step08_manifest")
    if not isinstance(manifest, dict) or manifest.get("schema") != PACKAGE_SCHEMA:
        raise SupervisorGateError("step08_manifest_schema_invalid")
    manifest_sha = _verify_self_hash(manifest, "manifest_sha256", "step08_manifest")
    if manifest_sha != receipt.get("manifest_sha256"):
        raise SupervisorGateError("step08_manifest_receipt_mismatch")
    if any(manifest.get(k) is not False for k in ("database_write_performed", "provider_call_performed", "canonical", "authority_effect", "r2_proven", "r3_proven", "persisted_seal_allowed")):
        raise SupervisorGateError("step08_manifest_authority_boundary_invalid")

    content = manifest.get("content_entries")
    if not isinstance(content, list) or not content:
        raise SupervisorGateError("step08_manifest_content_missing")
    expected_names: set[str] = set()
    for item in content:
        if not isinstance(item, dict):
            raise SupervisorGateError("step08_manifest_content_invalid")
        name = item.get("path")
        _safe_tar_path(name)
        if name == "manifest.json" or name in expected_names:
            raise SupervisorGateError("step08_manifest_content_duplicate")
        data = entries.get(name)
        if data is None:
            raise SupervisorGateError("step08_manifest_entry_missing")
        if item.get("bytes") != len(data) or item.get("sha256") != _sha_bytes(data):
            raise SupervisorGateError("step08_manifest_entry_identity_mismatch")
        expected_names.add(name)
    if set(entries) != expected_names | {"manifest.json"}:
        raise SupervisorGateError("step08_package_unmanifested_entry")

    projection_raw = entries.get("meta/r1-final-r2-db-ingestion-projection.json")
    if projection_raw is None:
        raise SupervisorGateError("step08_projection_missing")
    projection = _parse_json(projection_raw, "step08_projection")
    if not isinstance(projection, dict) or projection.get("schema") != PROJECTION_SCHEMA:
        raise SupervisorGateError("step08_projection_schema_invalid")
    projection_sha = _verify_self_hash(projection, "projection_sha256", "step08_projection")
    if projection_sha != receipt.get("db_projection_sha256") or projection_sha != manifest.get("db_projection_sha256"):
        raise SupervisorGateError("step08_projection_binding_mismatch")
    if any(projection.get(k) is not False for k in ("canonical", "authority_effect", "r2_proven", "r3_proven", "persisted_seal_allowed")):
        raise SupervisorGateError("step08_projection_authority_boundary_invalid")
    execution = projection.get("execution")
    if not isinstance(execution, dict) or execution.get("database_write_performed") is not False or execution.get("sql_included") is not False:
        raise SupervisorGateError("step08_projection_execution_boundary_invalid")
    return entries, receipt, manifest, projection


def _read_jsonl_bytes(path: Path, label: str) -> bytes:
    raw = _read_bytes(path, label, MAX_MEMBER_BYTES)
    count = 0
    for line in raw.splitlines():
        if not line.strip():
            continue
        _parse_json(line, label)
        count += 1
    if count < 1:
        raise SupervisorGateError(f"{label}_empty_jsonl")
    return raw


def expected_policy(source_head_sha: str, trusted_root_sha256: str) -> dict[str, Any]:
    if not isinstance(source_head_sha, str) or SHA40.fullmatch(source_head_sha) is None:
        raise SupervisorGateError("source_head_sha_invalid")
    _require_sha(trusted_root_sha256, "trusted_root_sha256")
    return {
        "repository": EXPECTED_REPOSITORY,
        "signer_workflow": f"{EXPECTED_REPOSITORY}/{SOURCE_WORKFLOW_PATH}",
        "signer_digest": source_head_sha,
        "source_ref": EXPECTED_SOURCE_REF,
        "source_digest": source_head_sha,
        "cert_oidc_issuer": EXPECTED_ISSUER,
        "predicate_type": SOURCE_PREDICATE_TYPE,
        "deny_self_hosted_runners": True,
        "custom_trusted_root_sha256": trusted_root_sha256,
        "format": "json",
    }


def build_root_context(*, trusted_root_path: Path, acquired_at: str, source_head_sha: str) -> dict[str, Any]:
    raw = _read_jsonl_bytes(trusted_root_path, "trusted_root")
    acquired = _parse_time(acquired_at, "trusted_root_acquired_at")
    root_sha = _sha_bytes(raw)
    core = {
        "schema": ROOT_CONTEXT_SCHEMA,
        "classification": ROOT_CONTEXT_CLASSIFICATION,
        "trusted_root_sha256": root_sha,
        "trusted_root_bytes": len(raw),
        "acquired_at": acquired.isoformat(),
        "online_fetch": True,
        "source": "GH_ATTESTATION_TRUSTED_ROOT",
        "policy": expected_policy(source_head_sha, root_sha),
        "database_credential_present": False,
        "database_write_performed": False,
        "authority_effect": False,
        "r2_proven": False,
        "persisted_seal_allowed": False,
    }
    out = dict(core)
    out["context_sha256"] = _sha_json(core)
    return out


def _validate_root_context(context: Any, trusted_root: bytes, effective_at: datetime, source_head_sha: str) -> dict[str, Any]:
    if not isinstance(context, dict) or context.get("schema") != ROOT_CONTEXT_SCHEMA or context.get("classification") != ROOT_CONTEXT_CLASSIFICATION:
        raise SupervisorGateError("trusted_root_context_schema_invalid")
    context_sha = _verify_self_hash(context, "context_sha256", "trusted_root_context")
    root_sha = _sha_bytes(trusted_root)
    if context.get("trusted_root_sha256") != root_sha or context.get("trusted_root_bytes") != len(trusted_root):
        raise SupervisorGateError("trusted_root_context_bytes_mismatch")
    if context.get("online_fetch") is not True or context.get("source") != "GH_ATTESTATION_TRUSTED_ROOT":
        raise SupervisorGateError("trusted_root_context_online_fetch_required")
    if context.get("policy") != expected_policy(source_head_sha, root_sha):
        raise SupervisorGateError("trusted_root_context_policy_mismatch")
    if context.get("database_credential_present") is not False or context.get("database_write_performed") is not False:
        raise SupervisorGateError("trusted_root_context_database_boundary_invalid")
    if context.get("authority_effect") is not False or context.get("r2_proven") is not False or context.get("persisted_seal_allowed") is not False:
        raise SupervisorGateError("trusted_root_context_authority_boundary_invalid")
    acquired = _parse_time(context.get("acquired_at"), "trusted_root_acquired_at")
    if acquired > effective_at:
        raise SupervisorGateError("trusted_root_acquired_in_future")
    if effective_at - acquired > ROOT_CONTEXT_MAX_AGE:
        raise SupervisorGateError("trusted_root_context_stale")
    return {"context_sha256": context_sha, "root_sha256": root_sha, "acquired_at": acquired.isoformat()}


def evaluate_gate(
    *,
    package_path: Path,
    package_receipt_path: Path,
    ciphertext_path: Path,
    verification_path: Path,
    fresh_trusted_root_path: Path,
    root_context_path: Path,
    effective_at: str,
) -> dict[str, Any]:
    entries, receipt, manifest, projection = _load_package(package_path, package_receipt_path)
    effective = _parse_time(effective_at, "effective_at")

    source_verification = _parse_json(entries["source/r1-recovery-source-verification.json"], "source_verification")
    source = source_verification.get("source") if isinstance(source_verification, dict) else None
    if not isinstance(source, dict):
        raise SupervisorGateError("source_verification_source_missing")
    source_head_sha = source.get("head_sha")
    source_run_id = _require_positive_int(source.get("run_id"), "source_run_id")
    if not isinstance(source_head_sha, str) or SHA40.fullmatch(source_head_sha) is None:
        raise SupervisorGateError("source_head_sha_invalid")

    fresh_root = _read_jsonl_bytes(fresh_trusted_root_path, "fresh_trusted_root")
    root_context = _read_json(root_context_path, "trusted_root_context")
    root = _validate_root_context(root_context, fresh_root, effective, source_head_sha)

    cipher = manifest.get("ciphertext")
    if not isinstance(cipher, dict) or cipher.get("included_in_package") is not False:
        raise SupervisorGateError("step08_ciphertext_manifest_invalid")
    expected_cipher_sha = _require_sha(cipher.get("sha256"), "ciphertext_sha256")
    expected_cipher_bytes = cipher.get("bytes")
    if not isinstance(expected_cipher_bytes, int) or isinstance(expected_cipher_bytes, bool) or expected_cipher_bytes < 1:
        raise SupervisorGateError("ciphertext_bytes_invalid")
    materialized = _read_bytes(ciphertext_path, "materialized_ciphertext", MAX_PACKAGE_BYTES * 16)
    if _sha_bytes(materialized) != expected_cipher_sha or len(materialized) != expected_cipher_bytes:
        raise SupervisorGateError("materialized_ciphertext_identity_mismatch")
    if receipt.get("ciphertext_sha256") != expected_cipher_sha:
        raise SupervisorGateError("step08_receipt_ciphertext_mismatch")

    freshness = projection.get("r2_freshness_contract")
    if not isinstance(freshness, dict) or freshness.get("package_does_not_refresh_readback_at") is not True:
        raise SupervisorGateError("r2_freshness_contract_invalid")
    if freshness.get("max_age_seconds") != 604800:
        raise SupervisorGateError("r2_freshness_window_mismatch")
    observations = projection.get("observation_inserts")
    if not isinstance(observations, list) or len(observations) != 2:
        raise SupervisorGateError("projection_requires_exactly_two_observations")
    readback_times = [_parse_time(item.get("readback_at") if isinstance(item, dict) else None, "readback_at") for item in observations]
    if effective < max(readback_times):
        raise SupervisorGateError("effective_at_before_readback")
    latest = _parse_time(freshness.get("latest_effective_at_for_both_current_readbacks"), "latest_effective_at")
    expected_latest = min(t + timedelta(days=7) for t in readback_times)
    if latest != expected_latest:
        raise SupervisorGateError("r2_freshness_boundary_recomputed_mismatch")
    if effective > latest:
        raise SupervisorGateError("r2_evidence_stale_for_ingestion")

    verification = _read_json(verification_path, "gh_attestation_verification")
    readiness = _parse_json(entries["source/r1-source-environment-readiness.json"], "source_readiness")
    approval = _parse_json(entries["source/r1-source-environment-approval.json"], "source_approval")
    packaged_predicate = _parse_json(entries["source/r1-recovery-source-predicate.json"], "source_predicate")
    envelope_raw = entries["source/r1-recovery-envelope-receipt.json"]
    with tempfile.TemporaryDirectory(prefix="h205f22-r1-step09a-") as temp_dir:
        envelope_path = Path(temp_dir) / "envelope.json"
        envelope_path.write_bytes(envelope_raw)
        try:
            base = validate_verification_result(
                verification=verification,
                ciphertext=ciphertext_path,
                envelope_receipt_path=envelope_path,
                expected_source_head_sha=source_head_sha,
                expected_source_run_id=source_run_id,
            )
        except Exception as exc:
            raise SupervisorGateError(f"source_attestation_reverification_failed:{exc}") from exc

    vr = verification[0].get("verificationResult") if isinstance(verification, list) and len(verification) == 1 and isinstance(verification[0], dict) else None
    statement = vr.get("statement") if isinstance(vr, dict) else None
    if not isinstance(statement, dict) or statement.get("predicate") != packaged_predicate:
        raise SupervisorGateError("verified_statement_predicate_package_mismatch")

    env_evidence = source_verification.get("source_environment_evidence")
    if not isinstance(env_evidence, dict):
        raise SupervisorGateError("source_environment_evidence_missing")
    config = env_evidence.get("configuration")
    approval_meta = env_evidence.get("approval")
    if not isinstance(config, dict) or not isinstance(approval_meta, dict):
        raise SupervisorGateError("source_environment_evidence_components_missing")
    try:
        rebound = bind_verification(
            source_verification=base,
            verification=verification,
            readiness=readiness,
            approval=approval,
            readiness_artifact_id=_require_positive_int(config.get("artifact_id"), "readiness_artifact_id"),
            approval_artifact_id=_require_positive_int(approval_meta.get("artifact_id"), "approval_artifact_id"),
        )
    except Exception as exc:
        raise SupervisorGateError(f"source_environment_rebinding_failed:{exc}") from exc
    if rebound != source_verification:
        raise SupervisorGateError("source_verification_package_reconstruction_mismatch")

    core = {
        "schema": GATE_SCHEMA,
        "classification": GATE_CLASSIFICATION,
        "package": {
            "package_sha256": receipt["package_sha256"],
            "manifest_sha256": receipt["manifest_sha256"],
            "db_projection_sha256": receipt["db_projection_sha256"],
        },
        "source": {
            "head_sha": source_head_sha,
            "run_id": source_run_id,
            "ciphertext_sha256": expected_cipher_sha,
            "ciphertext_bytes": expected_cipher_bytes,
            "source_verification_receipt_sha256": source_verification["verification_receipt_sha256"],
        },
        "trusted_root": {
            "context_sha256": root["context_sha256"],
            "sha256": root["root_sha256"],
            "acquired_at": root["acquired_at"],
            "max_context_age_seconds": int(ROOT_CONTEXT_MAX_AGE.total_seconds()),
            "online_fetch_required": True,
            "packaged_root_freshness_used_for_authority": False,
        },
        "verification": {
            "source_attestation_reverified": True,
            "source_environment_binding_reconstructed": True,
            "strict_cli_policy_context_bound": True,
            "verified_timestamp_count": base["verified_timestamp_count"],
        },
        "freshness": {
            "effective_at": effective.isoformat(),
            "latest_effective_at": latest.isoformat(),
            "readback_count": 2,
            "readback_max_age_seconds": 604800,
            "package_did_not_refresh_readbacks": True,
        },
        "ingestion_eligible": True,
        "required_next": "STEP09B_SUPERVISOR_APPEND_ONLY_DB_TRANSACTION_EXACT_MATCH_OR_INSERT_THEN_DB_DERIVED_R2_REEVALUATION",
        "database_credential_present": False,
        "database_write_performed": False,
        "provider_call_performed": False,
        "canonical": False,
        "authority_effect": False,
        "r2_proven": False,
        "r3_proven": False,
        "persisted_seal_allowed": False,
    }
    out = dict(core)
    out["gate_receipt_sha256"] = _sha_json(core)
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    root = sub.add_parser("build-root-context")
    root.add_argument("--trusted-root", required=True)
    root.add_argument("--acquired-at", required=True)
    root.add_argument("--source-head-sha", required=True)
    root.add_argument("--output", required=True)

    gate = sub.add_parser("evaluate")
    gate.add_argument("--package", required=True)
    gate.add_argument("--package-receipt", required=True)
    gate.add_argument("--ciphertext", required=True)
    gate.add_argument("--verification", required=True)
    gate.add_argument("--fresh-trusted-root", required=True)
    gate.add_argument("--root-context", required=True)
    gate.add_argument("--effective-at", required=True)
    gate.add_argument("--output", required=True)

    args = parser.parse_args(argv)
    try:
        if args.command == "build-root-context":
            result = build_root_context(
                trusted_root_path=Path(args.trusted_root),
                acquired_at=args.acquired_at,
                source_head_sha=args.source_head_sha,
            )
        else:
            result = evaluate_gate(
                package_path=Path(args.package),
                package_receipt_path=Path(args.package_receipt),
                ciphertext_path=Path(args.ciphertext),
                verification_path=Path(args.verification),
                fresh_trusted_root_path=Path(args.fresh_trusted_root),
                root_context_path=Path(args.root_context),
                effective_at=args.effective_at,
            )
        Path(args.output).write_bytes(_canonical(result) + b"\n")
        return 0
    except SupervisorGateError as exc:
        print(f"R1_SUPERVISOR_INGESTION_GATE_REJECTED:{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
