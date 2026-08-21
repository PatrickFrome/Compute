#!/usr/bin/env python3
"""Idempotent wrapper for STEP05 exact-ciphertext replication.

A content-addressed object may already exist from a prior partial orchestration run.
This wrapper never weakens the original create-if-absent path. It first probes the
current object version and reuses it only after version-pinned COMPLIANCE retention,
provider metadata, full GET, and local SHA-256 all match the STEP04 ciphertext.

STEP05B additionally persists the normalized provider CLI response evidence used by
the controller so later evidence packaging can re-audit version/retention/readback
semantics even after the originating GitHub Actions run is gone. These are normalized
AWS-CLI/S3-compatible response structures, not raw HTTP transcripts or credentials.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from controller.r1.exact_ciphertext_replication_controller import (
    RESULT_CLASSIFICATION,
    RESULT_SCHEMA,
    ReplicationError,
    _endpoint_args,
    _head_fields,
    _parse_time,
    _subprocess_json,
    _validate_retention,
    build_get_command,
    build_retention_command,
    object_key,
    replicate_and_readback,
    validate_target,
)
from controller.r1.materialized_readback_verifier import verify_materialized_readback
from controller.r1.recovery_encryption_envelope import EnvelopeError, validate_envelope_receipt


EVIDENCE_SCHEMA = "metaengine.compute.r1-provider-controller-evidence.h205f22.v1"
MAX_PERSISTED_EVIDENCE_BYTES = 256 * 1024
EXPECTED_OBJECT_METADATA_KEYS = {"metaengine-sha256", "metaengine-contract"}
FORBIDDEN_EVIDENCE_KEYS = {
    "authorization",
    "authorizationtoken",
    "accesskeyid",
    "awsaccesskeyid",
    "secretaccesskey",
    "awssecretaccesskey",
    "sessiontoken",
    "awssessiontoken",
    "securitytoken",
    "xamzsecuritytoken",
    "credential",
    "xamzcredential",
    "applicationkey",
    "secretkey",
}


class IdempotentReplicationError(RuntimeError):
    pass


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha256_json(value: Any) -> str:
    return hashlib.sha256(_canonical_bytes(value)).hexdigest()


def _read_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise IdempotentReplicationError(f"{label}_invalid_json") from exc
    if not isinstance(value, dict):
        raise IdempotentReplicationError(f"{label}_must_be_object")
    return value


def _require_dict(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise IdempotentReplicationError(f"{field}_invalid")
    return value


def _require_text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise IdempotentReplicationError(f"{field}_invalid")
    return value.strip()


def _response_version(response: dict[str, Any], field: str) -> str | None:
    value = response.get("VersionId")
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip() or value == "null":
        raise IdempotentReplicationError(f"{field}_version_id_invalid")
    return value.strip()


def _normalized_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def _validate_evidence_safety(value: Any) -> None:
    encoded = _canonical_bytes(value)
    if len(encoded) > MAX_PERSISTED_EVIDENCE_BYTES:
        raise IdempotentReplicationError("provider_controller_evidence_too_large")

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            for key, nested in node.items():
                if not isinstance(key, str):
                    raise IdempotentReplicationError("provider_controller_evidence_non_text_key")
                if _normalized_key(key) in FORBIDDEN_EVIDENCE_KEYS:
                    raise IdempotentReplicationError("provider_controller_evidence_forbidden_sensitive_key")
                walk(nested)
        elif isinstance(node, list):
            for nested in node:
                walk(nested)

    walk(value)


def _validate_expected_metadata(response: dict[str, Any], ciphertext_sha256: str, *, required: bool) -> None:
    metadata = response.get("Metadata")
    if metadata is None and not required:
        return
    if not isinstance(metadata, dict):
        raise IdempotentReplicationError("provider_object_metadata_missing")
    if set(metadata) != EXPECTED_OBJECT_METADATA_KEYS:
        raise IdempotentReplicationError("provider_object_metadata_unexpected_keys")
    if metadata.get("metaengine-sha256") != ciphertext_sha256:
        raise IdempotentReplicationError("provider_object_metadata_sha256_mismatch")
    if metadata.get("metaengine-contract") != "h205f22-r1-v1":
        raise IdempotentReplicationError("provider_object_contract_metadata_mismatch")


def validate_persisted_provider_controller_evidence(result: Any) -> dict[str, Any]:
    """Fail closed on a persisted STEP05B normalized provider-evidence result."""
    if not isinstance(result, dict) or result.get("schema") != RESULT_SCHEMA:
        raise IdempotentReplicationError("provider_result_schema_invalid")
    if result.get("classification") != RESULT_CLASSIFICATION:
        raise IdempotentReplicationError("provider_result_classification_invalid")

    result_sha = _require_text(result.get("result_sha256"), "result_sha256")
    result_core = dict(result)
    result_core.pop("result_sha256", None)
    if _sha256_json(result_core) != result_sha:
        raise IdempotentReplicationError("provider_result_sha256_mismatch")

    target = _require_dict(result.get("target"), "provider_result_target")
    cipher = _require_dict(result.get("ciphertext"), "provider_result_ciphertext")
    replication = _require_dict(result.get("replication"), "provider_result_replication")
    evidence = _require_dict(result.get("provider_controller_evidence"), "provider_controller_evidence")
    if evidence.get("schema") != EVIDENCE_SCHEMA:
        raise IdempotentReplicationError("provider_controller_evidence_schema_invalid")
    evidence_sha = _require_text(result.get("provider_controller_evidence_sha256"), "provider_controller_evidence_sha256")
    if _sha256_json(evidence) != evidence_sha:
        raise IdempotentReplicationError("provider_controller_evidence_sha256_mismatch")
    if evidence.get("credentials_embedded") is not False:
        raise IdempotentReplicationError("provider_controller_evidence_credentials_boundary_invalid")
    _validate_evidence_safety(evidence)

    provider_kind = _require_text(target.get("provider_kind"), "provider_kind")
    domain_key = _require_text(target.get("domain_key"), "domain_key")
    version_id = _require_text(cipher.get("version_id"), "ciphertext_version_id")
    key = _require_text(cipher.get("key"), "ciphertext_key")
    ciphertext_sha256 = _require_text(cipher.get("sha256"), "ciphertext_sha256")
    cipher_bytes = cipher.get("bytes")
    if not isinstance(cipher_bytes, int) or isinstance(cipher_bytes, bool) or cipher_bytes < 0:
        raise IdempotentReplicationError("ciphertext_bytes_invalid")
    if evidence.get("provider_kind") != provider_kind or evidence.get("domain_key") != domain_key:
        raise IdempotentReplicationError("provider_controller_evidence_identity_mismatch")
    if evidence.get("version_id") != version_id or evidence.get("key") != key:
        raise IdempotentReplicationError("provider_controller_evidence_object_identity_mismatch")

    retention_response = _require_dict(evidence.get("retention_response"), "provider_retention_response")
    retention = _require_dict(retention_response.get("Retention"), "provider_retention")
    if str(retention.get("Mode") or "").upper() != "COMPLIANCE":
        raise IdempotentReplicationError("provider_controller_evidence_retention_not_compliance")
    _parse_time(retention.get("RetainUntilDate"), "provider_controller_evidence_retain_until")

    get_response = _require_dict(evidence.get("get_response"), "provider_get_response")
    get_version = _response_version(get_response, "provider_get_response")
    if get_version is not None and get_version != version_id:
        raise IdempotentReplicationError("provider_controller_evidence_get_version_mismatch")
    _validate_expected_metadata(get_response, ciphertext_sha256, required=False)

    mode = replication.get("mode")
    if mode == "CREATED_NEW_VERSION":
        if replication.get("new_provider_write") is not True:
            raise IdempotentReplicationError("provider_create_mode_write_flag_invalid")
        put_response = _require_dict(evidence.get("put_response"), "provider_put_response")
        head_response = _require_dict(evidence.get("head_response"), "provider_head_response")
        if _response_version(put_response, "provider_put_response") != version_id:
            raise IdempotentReplicationError("provider_controller_evidence_put_version_mismatch")
        head_version = _response_version(head_response, "provider_head_response")
        if head_version is not None and head_version != version_id:
            raise IdempotentReplicationError("provider_controller_evidence_head_version_mismatch")
        if head_response.get("ContentLength") != cipher_bytes:
            raise IdempotentReplicationError("provider_controller_evidence_head_size_mismatch")
        _validate_expected_metadata(head_response, ciphertext_sha256, required=True)
        if evidence.get("aws_if_none_match_used") is not (provider_kind == "AWS_S3"):
            raise IdempotentReplicationError("provider_controller_evidence_conditional_create_mismatch")
        if evidence.get("b2_conditional_create_claimed") is not False:
            raise IdempotentReplicationError("provider_controller_evidence_b2_conditional_claim_invalid")
    elif mode == "REUSED_EXISTING_VERSION":
        if replication.get("new_provider_write") is not False:
            raise IdempotentReplicationError("provider_reuse_mode_write_flag_invalid")
        if evidence.get("mode") != "REUSED_EXISTING_VERSION" or evidence.get("new_provider_write") is not False:
            raise IdempotentReplicationError("provider_controller_evidence_reuse_mode_invalid")
        head_response = _require_dict(evidence.get("head_current_response"), "provider_head_current_response")
        if _response_version(head_response, "provider_head_current_response") != version_id:
            raise IdempotentReplicationError("provider_controller_evidence_reuse_version_mismatch")
        if head_response.get("ContentLength") != cipher_bytes:
            raise IdempotentReplicationError("provider_controller_evidence_reuse_size_mismatch")
        _validate_expected_metadata(head_response, ciphertext_sha256, required=True)
        if evidence.get("aws_if_none_match_used_for_original_create_contract") is not (provider_kind == "AWS_S3"):
            raise IdempotentReplicationError("provider_controller_evidence_reuse_create_contract_mismatch")
    else:
        raise IdempotentReplicationError("provider_replication_mode_invalid")

    if any(result.get(field) is not False for field in ("canonical", "authority_effect", "r2_proven", "r3_proven", "persisted_seal_allowed")):
        raise IdempotentReplicationError("provider_result_authority_boundary_invalid")
    return result


def build_head_current_command(aws_bin: str, target: dict[str, Any], key: str) -> list[str]:
    return [
        aws_bin,
        "s3api",
        "head-object",
        "--bucket",
        target["bucket"],
        "--key",
        key,
        "--region",
        target["region"],
        "--output",
        "json",
        *_endpoint_args(target),
    ]


def _subprocess_json_optional(cmd: list[str]) -> dict[str, Any] | None:
    try:
        proc = subprocess.run(
            cmd,
            check=False,
            text=True,
            capture_output=True,
            stdin=subprocess.DEVNULL,
            timeout=120,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise IdempotentReplicationError("provider_current_version_probe_failed") from exc
    if proc.returncode == 0:
        try:
            value = json.loads(proc.stdout or "{}")
        except json.JSONDecodeError as exc:
            raise IdempotentReplicationError("provider_current_version_probe_non_json") from exc
        if not isinstance(value, dict):
            raise IdempotentReplicationError("provider_current_version_probe_shape_invalid")
        return value
    text = (proc.stderr or "").lower()
    if any(token in text for token in ("404", "not found", "nosuchkey", "no such key")):
        return None
    raise IdempotentReplicationError("provider_current_version_probe_failed")


def _metadata_matches(head: dict[str, Any], ciphertext_sha256: str) -> None:
    _validate_expected_metadata(head, ciphertext_sha256, required=True)


def _reuse_existing(
    *,
    ciphertext: Path,
    envelope_receipt_path: Path,
    target_raw: dict[str, Any],
    aws_bin: str,
    observed_start: datetime,
    probe_runner: Callable[[list[str]], dict[str, Any] | None],
    runner: Callable[[list[str]], dict[str, Any]],
) -> dict[str, Any] | None:
    envelope = validate_envelope_receipt(ciphertext, envelope_receipt_path, require_production_ready=True)
    target = validate_target(target_raw, observed_start)
    cipher = envelope["ciphertext"]
    ciphertext_sha256 = cipher["sha256"]
    ciphertext_bytes = cipher["bytes"]
    key = object_key(ciphertext_sha256)

    current_head = probe_runner(build_head_current_command(aws_bin, target, key))
    if current_head is None:
        return None
    content_length, last_modified, etag, version_id = _head_fields(current_head)
    if not isinstance(version_id, str) or not version_id.strip() or version_id == "null":
        raise IdempotentReplicationError("existing_object_version_id_missing")
    version_id = version_id.strip()
    if content_length != ciphertext_bytes:
        raise IdempotentReplicationError("existing_object_content_length_mismatch")
    _metadata_matches(current_head, ciphertext_sha256)

    observed_at = observed_start + timedelta(seconds=1)
    retention_response = runner(build_retention_command(aws_bin, target, key, version_id))
    retention = _validate_retention(
        retention_response,
        _parse_time(target["retain_until"], "retain_until"),
        observed_at,
    )

    evidence_core: dict[str, Any] = {
        "schema": EVIDENCE_SCHEMA,
        "provider_kind": target["provider_kind"],
        "domain_key": target["domain_key"],
        "bucket": target["bucket"],
        "key": key,
        "version_id": version_id,
        "mode": "REUSED_EXISTING_VERSION",
        "head_current_response": current_head,
        "retention_response": retention_response,
        "aws_if_none_match_used_for_original_create_contract": target["provider_kind"] == "AWS_S3",
        "new_provider_write": False,
        "credentials_embedded": False,
    }

    with tempfile.TemporaryDirectory(prefix="h205f22-r1-reuse-readback-") as temp_dir:
        readback_path = Path(temp_dir) / "readback.age"
        get_response = runner(build_get_command(aws_bin, target, key, version_id, readback_path))
        if not readback_path.is_file():
            raise IdempotentReplicationError("existing_object_get_did_not_materialize_file")
        evidence_core["get_response"] = get_response
        evidence_sha256 = _sha256_json(evidence_core)
        descriptor = {
            "schema": "metaengine.compute.r1-readback-descriptor.h205f22.v1",
            "domain_key": target["domain_key"],
            "provider_kind": target["provider_kind"],
            "operator_class": target["operator_class"],
            "failure_domain": target["failure_domain"],
            "independence_basis": target["independence_basis"],
            "account_scope_sha256": target["account_scope_sha256"],
            "object": {
                "subject_kind": "BACKUP_SET",
                "subject_id": f"r1-age-ciphertext:{ciphertext_sha256}",
                "expected_sha256": ciphertext_sha256,
                "expected_bytes": ciphertext_bytes,
                "payload_root_sha256": envelope["source_bundle"]["bundle_sha256"],
                "manifest_checkpoint_id": None,
            },
            "provider_object": {
                "endpoint_host": target["endpoint_host"],
                "bucket": target["bucket"],
                "key": key,
                "version_id": version_id,
                "etag": etag,
                "content_length": content_length,
                "last_modified": last_modified,
                "retention": retention,
            },
            "controller": {
                "kind": "R1_IDEMPOTENT_EXACT_CIPHERTEXT_REUSE_CONTROLLER_V1",
                "observed_at": observed_at.isoformat(),
                "evidence_sha256": evidence_sha256,
            },
        }
        readback_receipt = verify_materialized_readback(readback_path, descriptor)

    if readback_receipt.get("readback", {}).get("status") != "VERIFIED":
        raise IdempotentReplicationError("existing_object_materialized_readback_mismatch")
    if readback_receipt.get("retention", {}).get("grade") != "COMPLIANCE_NON_SHORTENABLE":
        raise IdempotentReplicationError("existing_object_retention_not_strong")

    core = {
        "schema": RESULT_SCHEMA,
        "classification": RESULT_CLASSIFICATION,
        "target": {
            "domain_key": target["domain_key"],
            "provider_kind": target["provider_kind"],
            "operator_class": target["operator_class"],
            "failure_domain": target["failure_domain"],
            "account_scope_sha256": target["account_scope_sha256"],
        },
        "ciphertext": {
            "sha256": ciphertext_sha256,
            "bytes": ciphertext_bytes,
            "key": key,
            "version_id": version_id,
        },
        "replication": {
            "mode": "REUSED_EXISTING_VERSION",
            "new_provider_write": False,
        },
        "provider_controller_evidence": evidence_core,
        "provider_controller_evidence_sha256": evidence_sha256,
        "readback_receipt": readback_receipt,
        "provenance": {
            "source_attestation_verified": False,
            "source_attestation_required_before_authority": True,
        },
        "canonical": False,
        "authority_effect": False,
        "r2_proven": False,
        "r3_proven": False,
        "persisted_seal_allowed": False,
        "required_next": "REPEAT_FOR_INDEPENDENT_SECOND_DOMAIN_THEN_EVALUATE_NONAUTHORITATIVE_QUORUM_AND_VERIFY_SOURCE_ATTESTATION_BEFORE_DB_AUTHORITY",
    }
    result = dict(core)
    result["result_sha256"] = _sha256_json(core)
    return validate_persisted_provider_controller_evidence(result)


def _persist_created_evidence(
    *,
    created: dict[str, Any],
    target_raw: dict[str, Any],
    observed_start: datetime,
    responses: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    required = {"put-object", "get-object-retention", "head-object", "get-object"}
    if not required.issubset(responses):
        raise IdempotentReplicationError("created_provider_controller_evidence_incomplete")
    target = validate_target(target_raw, observed_start)
    cipher = _require_dict(created.get("ciphertext"), "created_ciphertext")
    version_id = _require_text(cipher.get("version_id"), "created_version_id")
    key = _require_text(cipher.get("key"), "created_key")
    evidence_core = {
        "schema": EVIDENCE_SCHEMA,
        "provider_kind": target["provider_kind"],
        "domain_key": target["domain_key"],
        "bucket": target["bucket"],
        "key": key,
        "version_id": version_id,
        "put_response": responses["put-object"],
        "head_response": responses["head-object"],
        "retention_response": responses["get-object-retention"],
        "aws_if_none_match_used": target["provider_kind"] == "AWS_S3",
        "b2_conditional_create_claimed": False,
        "credentials_embedded": False,
        "get_response": responses["get-object"],
    }
    evidence_sha = _sha256_json(evidence_core)
    if created.get("provider_controller_evidence_sha256") != evidence_sha:
        raise IdempotentReplicationError("created_provider_controller_evidence_sha256_mismatch")
    core = dict(created)
    core.pop("result_sha256", None)
    core["replication"] = {"mode": "CREATED_NEW_VERSION", "new_provider_write": True}
    core["provider_controller_evidence"] = evidence_core
    result = dict(core)
    result["result_sha256"] = _sha256_json(core)
    return validate_persisted_provider_controller_evidence(result)


def replicate_or_reuse(
    *,
    ciphertext: Path,
    envelope_receipt_path: Path,
    target_raw: dict[str, Any],
    aws_bin: str = "aws",
    now: datetime | None = None,
    probe_runner: Callable[[list[str]], dict[str, Any] | None] = _subprocess_json_optional,
    runner: Callable[[list[str]], dict[str, Any]] = _subprocess_json,
) -> dict[str, Any]:
    observed_start = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    reused = _reuse_existing(
        ciphertext=ciphertext,
        envelope_receipt_path=envelope_receipt_path,
        target_raw=target_raw,
        aws_bin=aws_bin,
        observed_start=observed_start,
        probe_runner=probe_runner,
        runner=runner,
    )
    if reused is not None:
        return reused

    responses: dict[str, dict[str, Any]] = {}

    def recording_runner(cmd: list[str]) -> dict[str, Any]:
        value = runner(cmd)
        if len(cmd) >= 3 and cmd[1] == "s3api" and cmd[2] in {"put-object", "get-object-retention", "head-object", "get-object"}:
            responses[cmd[2]] = value
        return value

    try:
        created = replicate_and_readback(
            ciphertext=ciphertext,
            envelope_receipt_path=envelope_receipt_path,
            target_raw=target_raw,
            aws_bin=aws_bin,
            now=observed_start,
            runner=recording_runner,
        )
    except ReplicationError as original:
        raced = _reuse_existing(
            ciphertext=ciphertext,
            envelope_receipt_path=envelope_receipt_path,
            target_raw=target_raw,
            aws_bin=aws_bin,
            observed_start=observed_start,
            probe_runner=probe_runner,
            runner=runner,
        )
        if raced is not None:
            return raced
        raise original

    return _persist_created_evidence(
        created=created,
        target_raw=target_raw,
        observed_start=observed_start,
        responses=responses,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ciphertext", required=True)
    parser.add_argument("--envelope-receipt", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--aws-bin", default="aws")
    args = parser.parse_args(argv)
    try:
        result = replicate_or_reuse(
            ciphertext=Path(args.ciphertext),
            envelope_receipt_path=Path(args.envelope_receipt),
            target_raw=_read_json(Path(args.target), "target"),
            aws_bin=args.aws_bin,
        )
        validate_persisted_provider_controller_evidence(result)
        Path(args.output).write_bytes(_canonical_bytes(result) + b"\n")
        return 0
    except (IdempotentReplicationError, ReplicationError, EnvelopeError) as exc:
        print(f"R1_IDEMPOTENT_REPLICATION_REJECTED:{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
