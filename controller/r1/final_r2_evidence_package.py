#!/usr/bin/env python3
"""Build a deterministic, non-authoritative R1 final evidence package.

STEP08 is an evidence compiler, not a durability authority. It revalidates the
existing STEP05B/STEP06/STEP07 contracts, preserves the source/provider evidence
needed for later audit, and emits a proposed continuity-DB ingestion projection.

It performs no network access, provider calls, credential handling, database writes,
R2/R3 transition, or persisted-seal creation.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
import tarfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from controller.r1.idempotent_exact_ciphertext_replication import (
    validate_persisted_provider_controller_evidence,
)
from controller.r1.live_two_domain_orchestration_guard import (
    evaluate_results,
    validate_provider_result,
)
from controller.r1.provider_configuration_readiness import (
    AWS_READINESS_SCHEMA,
    B2_READINESS_SCHEMA,
    CLASSIFICATION as PROVIDER_READINESS_CLASSIFICATION,
)
from controller.r1.source_bound_quorum_candidate import bind_candidate
from controller.r1.source_environment_evidence_binding import (
    validate_approval,
    validate_bound_predicate,
    validate_readiness,
)

PACKAGE_SCHEMA = "metaengine.compute.r1-final-r2-evidence-package.h205f22.v1"
RECEIPT_SCHEMA = "metaengine.compute.r1-final-r2-evidence-package-receipt.h205f22.v1"
PROJECTION_SCHEMA = "metaengine.compute.r1-final-r2-db-ingestion-projection.h205f22.v1"
PACKAGE_CLASSIFICATION = "FINAL_R2_EVIDENCE_PACKAGE_NONAUTHORITATIVE"
MAX_JSON_BYTES = 4 * 1024 * 1024
MAX_JSONL_BYTES = 16 * 1024 * 1024
READBACK_MAX_AGE = timedelta(days=7)
SHA256 = re.compile(r"^[0-9a-f]{64}$")


class FinalEvidenceError(RuntimeError):
    pass


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha_json(value: Any) -> str:
    return _sha_bytes(_canonical(value))


def _read_bytes(path: Path, label: str, maximum: int) -> bytes:
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise FinalEvidenceError(f"{label}_unavailable") from exc
    if not data:
        raise FinalEvidenceError(f"{label}_empty")
    if len(data) > maximum:
        raise FinalEvidenceError(f"{label}_too_large")
    return data


def _read_json(path: Path, label: str) -> tuple[Any, bytes]:
    data = _read_bytes(path, label, MAX_JSON_BYTES)
    try:
        value = json.loads(data)
    except json.JSONDecodeError as exc:
        raise FinalEvidenceError(f"{label}_invalid_json") from exc
    return value, data


def _read_jsonl(path: Path, label: str) -> bytes:
    data = _read_bytes(path, label, MAX_JSONL_BYTES)
    seen = 0
    for raw in data.splitlines():
        if not raw.strip():
            continue
        try:
            json.loads(raw)
        except json.JSONDecodeError as exc:
            raise FinalEvidenceError(f"{label}_invalid_jsonl") from exc
        seen += 1
    if seen < 1:
        raise FinalEvidenceError(f"{label}_jsonl_empty")
    return data


def _parse_time(value: Any, field: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise FinalEvidenceError(f"{field}_missing")
    try:
        dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError as exc:
        raise FinalEvidenceError(f"{field}_invalid") from exc
    if dt.tzinfo is None:
        raise FinalEvidenceError(f"{field}_timezone_required")
    return dt.astimezone(timezone.utc)


def _require_sha(value: Any, field: str) -> str:
    if not isinstance(value, str) or SHA256.fullmatch(value) is None:
        raise FinalEvidenceError(f"{field}_invalid")
    return value


def _self_hash(value: Any, field: str, label: str) -> str:
    if not isinstance(value, dict):
        raise FinalEvidenceError(f"{label}_shape_invalid")
    claimed = _require_sha(value.get(field), field)
    core = dict(value)
    core.pop(field, None)
    if _sha_json(core) != claimed:
        raise FinalEvidenceError(f"{label}_{field}_mismatch")
    return claimed


def _provider_readiness(value: Any, provider: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise FinalEvidenceError(f"{provider}_readiness_shape_invalid")
    expected_schema = AWS_READINESS_SCHEMA if provider == "AWS_S3" else B2_READINESS_SCHEMA
    if value.get("schema") != expected_schema:
        raise FinalEvidenceError(f"{provider}_readiness_schema_invalid")
    if value.get("classification") != PROVIDER_READINESS_CLASSIFICATION:
        raise FinalEvidenceError(f"{provider}_readiness_classification_invalid")
    _self_hash(value, "receipt_sha256", f"{provider}_readiness")
    if value.get("provider_kind") != provider:
        raise FinalEvidenceError(f"{provider}_readiness_provider_mismatch")
    if value.get("ready_for_step05a_candidate_generation") is not True:
        raise FinalEvidenceError(f"{provider}_readiness_not_ready")
    if any(value.get(k) is not False for k in ("canonical", "authority_effect", "r2_proven", "r3_proven", "persisted_seal_allowed")):
        raise FinalEvidenceError(f"{provider}_readiness_authority_boundary_invalid")
    return value


def _validate_source_chain(
    *,
    readiness: Any,
    approval: Any,
    predicate: Any,
    source_verification: Any,
    handoff: Any,
    source_bound: Any,
    envelope: Any,
) -> dict[str, Any]:
    if not isinstance(handoff, dict):
        raise FinalEvidenceError("handoff_shape_invalid")
    handoff_sha = _self_hash(handoff, "handoff_sha256", "handoff")
    hs = handoff.get("source")
    if not isinstance(hs, dict):
        raise FinalEvidenceError("handoff_source_missing")

    readiness_info = validate_readiness(readiness)
    approval_info = validate_approval(approval)
    if readiness_info["readiness_sha256"] != hs.get("source_environment_readiness_sha256"):
        raise FinalEvidenceError("source_readiness_handoff_hash_mismatch")
    if approval_info["approval_receipt_sha256"] != hs.get("source_environment_approval_sha256"):
        raise FinalEvidenceError("source_approval_handoff_hash_mismatch")

    binding = validate_bound_predicate(
        predicate,
        readiness,
        approval,
        int(hs.get("source_environment_readiness_artifact_id")),
        int(hs.get("source_environment_approval_artifact_id")),
    )
    if binding["predicate_sha256"] != hs.get("predicate_sha256"):
        raise FinalEvidenceError("predicate_handoff_hash_mismatch")

    verification_sha = _self_hash(source_verification, "verification_receipt_sha256", "source_verification")
    if source_verification.get("predicate_sha256") != binding["predicate_sha256"]:
        raise FinalEvidenceError("source_verification_predicate_mismatch")
    if verification_sha != hs.get("source_verification_receipt_sha256"):
        raise FinalEvidenceError("source_verification_handoff_hash_mismatch")
    if source_verification.get("source_attestation_verified") is not True:
        raise FinalEvidenceError("source_verification_not_verified")
    if any(source_verification.get(k) is not False for k in ("authority_effect", "r2_proven", "r3_proven", "persisted_seal_allowed")):
        raise FinalEvidenceError("source_verification_authority_boundary_invalid")

    if not isinstance(envelope, dict):
        raise FinalEvidenceError("envelope_shape_invalid")
    envelope_sha = _self_hash(envelope, "receipt_sha256", "envelope")
    if envelope_sha != hs.get("envelope_receipt_sha256"):
        raise FinalEvidenceError("envelope_handoff_hash_mismatch")
    cipher = envelope.get("ciphertext")
    if not isinstance(cipher, dict):
        raise FinalEvidenceError("envelope_ciphertext_missing")
    if cipher.get("sha256") != hs.get("ciphertext_sha256") or cipher.get("bytes") != hs.get("ciphertext_bytes"):
        raise FinalEvidenceError("envelope_handoff_ciphertext_mismatch")

    if not isinstance(source_bound, dict):
        raise FinalEvidenceError("source_bound_shape_invalid")
    _self_hash(source_bound, "candidate_sha256", "source_bound")
    if source_bound.get("source_provenance", {}).get("handoff_sha256") != handoff_sha:
        raise FinalEvidenceError("source_bound_handoff_hash_mismatch")
    if source_bound.get("ciphertext", {}).get("sha256") != cipher.get("sha256"):
        raise FinalEvidenceError("source_bound_ciphertext_mismatch")
    if any(source_bound.get(k) is not False for k in ("canonical", "authority_effect", "r2_proven", "r3_proven", "persisted_seal_allowed")):
        raise FinalEvidenceError("source_bound_authority_boundary_invalid")

    return {
        "readiness_sha256": readiness_info["readiness_sha256"],
        "approval_sha256": approval_info["approval_receipt_sha256"],
        "predicate_sha256": binding["predicate_sha256"],
        "source_verification_sha256": verification_sha,
        "handoff_sha256": handoff_sha,
        "ciphertext_sha256": cipher["sha256"],
        "ciphertext_bytes": cipher["bytes"],
    }


def _provider_projection(provider_result: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    target = provider_result["target"]
    readback = provider_result["readback_receipt"]
    obj = readback["object"]
    rb = readback["readback"]
    po = readback["provider_object"]

    domain = {
        "domain_key": target["domain_key"],
        "provider_kind": target["provider_kind"],
        "operator_class": target["operator_class"],
        "failure_domain": target["failure_domain"],
        "independence_basis": readback["independence_basis"],
        "physical_region_independence_claimed": False,
        "metadata": {
            "account_scope_sha256": target["account_scope_sha256"],
            "provider_result_sha256": provider_result["result_sha256"],
            "step08_projection_only": True,
        },
    }
    object_row = {
        "subject_kind": obj["subject_kind"],
        "subject_id": obj["subject_id"],
        "expected_sha256": obj["expected_sha256"],
        "expected_bytes": obj["expected_bytes"],
        "payload_root_sha256": obj.get("payload_root_sha256"),
        "manifest_checkpoint_id": obj.get("manifest_checkpoint_id"),
        "metadata": {
            "ciphertext_format": "age-encryption.org/v1",
            "step08_projection_only": True,
        },
    }
    observation = {
        "object_selector": {
            "subject_kind": obj["subject_kind"],
            "subject_id": obj["subject_id"],
            "expected_sha256": obj["expected_sha256"],
        },
        "domain_key": target["domain_key"],
        "status": "VERIFIED",
        "observed_sha256": rb["observed_sha256"],
        "observed_bytes": rb["observed_bytes"],
        "persisted_at": po["last_modified"],
        "readback_at": rb["readback_at"],
        "evidence": {
            "schema": "metaengine.compute.r1-step08-observation-evidence.h205f22.v1",
            "provider_result": provider_result,
            "step08_projection_only": True,
            "authority_effect": False,
        },
    }
    return domain, object_row, observation


def _db_projection(aws: dict[str, Any], b2: dict[str, Any], source_bound: dict[str, Any]) -> dict[str, Any]:
    aws_domain, aws_obj, aws_obs = _provider_projection(aws)
    b2_domain, b2_obj, b2_obs = _provider_projection(b2)
    if aws_obj != b2_obj:
        raise FinalEvidenceError("provider_object_projection_mismatch")
    times = [_parse_time(aws_obs["readback_at"], "aws_readback_at"), _parse_time(b2_obs["readback_at"], "b2_readback_at")]
    window_end = min(t + READBACK_MAX_AGE for t in times)
    core = {
        "schema": PROJECTION_SCHEMA,
        "classification": "PROPOSED_CONTINUITY_DB_INGESTION_NONAUTHORITATIVE",
        "object_insert_or_exact_match": aws_obj,
        "domain_insert_or_exact_match": sorted([aws_domain, b2_domain], key=lambda x: x["domain_key"]),
        "observation_inserts": sorted([aws_obs, b2_obs], key=lambda x: x["domain_key"]),
        "r2_freshness_contract": {
            "max_age_seconds": int(READBACK_MAX_AGE.total_seconds()),
            "latest_effective_at_for_both_current_readbacks": window_end.isoformat(),
            "package_does_not_refresh_readback_at": True,
        },
        "source_bound_candidate_sha256": source_bound["candidate_sha256"],
        "execution": {
            "sql_included": False,
            "database_write_performed": False,
            "object_id_must_be_resolved_by_unique_object_identity": True,
            "existing_domain_key_must_exactly_match_or_ingestion_must_fail": True,
        },
        "canonical": False,
        "authority_effect": False,
        "r2_proven": False,
        "r3_proven": False,
        "persisted_seal_allowed": False,
    }
    out = dict(core)
    out["projection_sha256"] = _sha_json(core)
    return out


def _tar_bytes(entries: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w", format=tarfile.USTAR_FORMAT) as tf:
        for name in sorted(entries):
            data = entries[name]
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mtime = 0
            info.mode = 0o600
            info.uid = 0
            info.gid = 0
            info.uname = ""
            info.gname = ""
            tf.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


def build_package(
    *,
    readiness_path: Path,
    approval_path: Path,
    predicate_path: Path,
    attestation_bundle_path: Path,
    trusted_root_path: Path,
    source_verification_path: Path,
    handoff_path: Path,
    preflight_path: Path,
    aws_readiness_path: Path,
    b2_readiness_path: Path,
    aws_result_path: Path,
    b2_result_path: Path,
    orchestration_path: Path,
    source_bound_path: Path,
    envelope_path: Path,
) -> tuple[bytes, dict[str, Any], dict[str, Any]]:
    readiness, readiness_bytes = _read_json(readiness_path, "source_readiness")
    approval, approval_bytes = _read_json(approval_path, "source_approval")
    predicate, predicate_bytes = _read_json(predicate_path, "source_predicate")
    source_verification, source_verification_bytes = _read_json(source_verification_path, "source_verification")
    handoff, handoff_bytes = _read_json(handoff_path, "source_handoff")
    preflight, preflight_bytes = _read_json(preflight_path, "orchestration_preflight")
    aws_readiness, aws_readiness_bytes = _read_json(aws_readiness_path, "aws_readiness")
    b2_readiness, b2_readiness_bytes = _read_json(b2_readiness_path, "b2_readiness")
    aws_result, aws_result_bytes = _read_json(aws_result_path, "aws_result")
    b2_result, b2_result_bytes = _read_json(b2_result_path, "b2_result")
    orchestration, orchestration_bytes = _read_json(orchestration_path, "orchestration_result")
    source_bound, source_bound_bytes = _read_json(source_bound_path, "source_bound_candidate")
    envelope, envelope_bytes = _read_json(envelope_path, "envelope_receipt")
    attestation_bundle_bytes = _read_jsonl(attestation_bundle_path, "source_attestation_bundle")
    trusted_root_bytes = _read_jsonl(trusted_root_path, "sigstore_trusted_root")

    source_chain = _validate_source_chain(
        readiness=readiness,
        approval=approval,
        predicate=predicate,
        source_verification=source_verification,
        handoff=handoff,
        source_bound=source_bound,
        envelope=envelope,
    )

    _provider_readiness(aws_readiness, "AWS_S3")
    _provider_readiness(b2_readiness, "BACKBLAZE_B2")
    validate_persisted_provider_controller_evidence(aws_result)
    validate_persisted_provider_controller_evidence(b2_result)
    validate_provider_result(aws_result, "AWS_S3")
    validate_provider_result(b2_result, "BACKBLAZE_B2")

    reconstructed_orchestration = evaluate_results(aws_result, b2_result, preflight)
    if reconstructed_orchestration != orchestration:
        raise FinalEvidenceError("orchestration_result_reconstruction_mismatch")
    reconstructed_source_bound = bind_candidate(orchestration, handoff)
    if reconstructed_source_bound != source_bound:
        raise FinalEvidenceError("source_bound_candidate_reconstruction_mismatch")

    projection = _db_projection(aws_result, b2_result, source_bound)
    projection_bytes = _canonical(projection) + b"\n"

    entries = {
        "source/r1-source-environment-readiness.json": readiness_bytes,
        "source/r1-source-environment-approval.json": approval_bytes,
        "source/r1-recovery-source-predicate.json": predicate_bytes,
        "source/r1-recovery-source-attestation.sigstore.jsonl": attestation_bundle_bytes,
        "source/trusted_root.jsonl": trusted_root_bytes,
        "source/r1-recovery-source-verification.json": source_verification_bytes,
        "source/r1-verified-source-handoff.json": handoff_bytes,
        "source/r1-recovery-envelope-receipt.json": envelope_bytes,
        "provider/r1-live-two-domain-preflight.json": preflight_bytes,
        "provider/r1-aws-provider-readiness.json": aws_readiness_bytes,
        "provider/r1-b2-provider-readiness.json": b2_readiness_bytes,
        "provider/r1-aws-provider-result.json": aws_result_bytes,
        "provider/r1-b2-provider-result.json": b2_result_bytes,
        "provider/r1-live-two-domain-orchestration-result.json": orchestration_bytes,
        "provider/r1-source-bound-two-domain-candidate.json": source_bound_bytes,
        "meta/r1-final-r2-db-ingestion-projection.json": projection_bytes,
    }
    content_entries = [
        {"path": name, "sha256": _sha_bytes(data), "bytes": len(data)}
        for name, data in sorted(entries.items())
    ]
    manifest_core = {
        "schema": PACKAGE_SCHEMA,
        "classification": PACKAGE_CLASSIFICATION,
        "content_entries": content_entries,
        "source_identity": source_chain,
        "ciphertext": {
            "sha256": source_chain["ciphertext_sha256"],
            "bytes": source_chain["ciphertext_bytes"],
            "included_in_package": False,
            "materialize_from_version_pinned_provider_locator_for_offline_reverification": True,
        },
        "offline_attestation": {
            "bundle_included": True,
            "trusted_root_included": True,
            "cryptographic_reverification_performed_by_step08_compiler": False,
            "offline_reverification_required_before_authority": True,
        },
        "db_projection_sha256": projection["projection_sha256"],
        "package_is_not_continuity_domain": True,
        "database_write_performed": False,
        "provider_call_performed": False,
        "canonical": False,
        "authority_effect": False,
        "r2_proven": False,
        "r3_proven": False,
        "persisted_seal_allowed": False,
        "required_next": "OFFLINE_REVERIFY_SIGSTORE_AGAINST_MATERIALIZED_PROVIDER_CIPHERTEXT_THEN_SUPERVISOR_VALIDATE_AND_INGEST_PROJECTION_BEFORE_R2_REEVALUATION",
    }
    manifest = dict(manifest_core)
    manifest["manifest_sha256"] = _sha_json(manifest_core)
    manifest_bytes = _canonical(manifest) + b"\n"
    entries["manifest.json"] = manifest_bytes
    package_bytes = _tar_bytes(entries)

    receipt_core = {
        "schema": RECEIPT_SCHEMA,
        "classification": PACKAGE_CLASSIFICATION,
        "package_sha256": _sha_bytes(package_bytes),
        "package_bytes": len(package_bytes),
        "manifest_sha256": manifest["manifest_sha256"],
        "db_projection_sha256": projection["projection_sha256"],
        "ciphertext_sha256": source_chain["ciphertext_sha256"],
        "ciphertext_included": False,
        "offline_reverification_required": True,
        "database_write_performed": False,
        "provider_call_performed": False,
        "canonical": False,
        "authority_effect": False,
        "r2_proven": False,
        "r3_proven": False,
        "persisted_seal_allowed": False,
    }
    receipt = dict(receipt_core)
    receipt["receipt_sha256"] = _sha_json(receipt_core)
    return package_bytes, receipt, projection


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    for arg in (
        "readiness", "approval", "predicate", "attestation-bundle", "trusted-root",
        "source-verification", "handoff", "preflight", "aws-readiness", "b2-readiness",
        "aws-result", "b2-result", "orchestration", "source-bound", "envelope",
        "output-tar", "output-receipt", "output-projection",
    ):
        p.add_argument("--" + arg, required=True)
    a = p.parse_args(argv)
    try:
        package, receipt, projection = build_package(
            readiness_path=Path(a.readiness),
            approval_path=Path(a.approval),
            predicate_path=Path(a.predicate),
            attestation_bundle_path=Path(a.attestation_bundle),
            trusted_root_path=Path(a.trusted_root),
            source_verification_path=Path(a.source_verification),
            handoff_path=Path(a.handoff),
            preflight_path=Path(a.preflight),
            aws_readiness_path=Path(a.aws_readiness),
            b2_readiness_path=Path(a.b2_readiness),
            aws_result_path=Path(a.aws_result),
            b2_result_path=Path(a.b2_result),
            orchestration_path=Path(a.orchestration),
            source_bound_path=Path(a.source_bound),
            envelope_path=Path(a.envelope),
        )
        Path(a.output_tar).write_bytes(package)
        Path(a.output_receipt).write_bytes(_canonical(receipt) + b"\n")
        Path(a.output_projection).write_bytes(_canonical(projection) + b"\n")
        return 0
    except Exception as exc:
        if isinstance(exc, FinalEvidenceError):
            message = str(exc)
        else:
            message = f"dependency_validation_failed:{exc.__class__.__name__}:{exc}"
        print(f"R1_FINAL_R2_EVIDENCE_REJECTED:{message}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
