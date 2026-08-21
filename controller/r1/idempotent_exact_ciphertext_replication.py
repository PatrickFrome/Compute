#!/usr/bin/env python3
"""Idempotent wrapper for STEP05 exact-ciphertext replication.

A content-addressed object may already exist from a prior partial orchestration run.
This wrapper never weakens the original create-if-absent path. It first probes the
current object version and reuses it only after version-pinned COMPLIANCE retention,
provider metadata, full GET, and local SHA-256 all match the STEP04 ciphertext.

If no current object exists, it delegates creation to STEP05. If creation loses a
race, it probes once more and accepts only a fully verified existing version.
"""

from __future__ import annotations

import argparse
import hashlib
import json
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
    metadata = head.get("Metadata")
    if not isinstance(metadata, dict):
        raise IdempotentReplicationError("existing_object_metadata_missing")
    if metadata.get("metaengine-sha256") != ciphertext_sha256:
        raise IdempotentReplicationError("existing_object_metadata_sha256_mismatch")
    if metadata.get("metaengine-contract") != "h205f22-r1-v1":
        raise IdempotentReplicationError("existing_object_contract_metadata_mismatch")


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
        "schema": "metaengine.compute.r1-provider-controller-evidence.h205f22.v1",
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
    return result


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

    try:
        created = replicate_and_readback(
            ciphertext=ciphertext,
            envelope_receipt_path=envelope_receipt_path,
            target_raw=target_raw,
            aws_bin=aws_bin,
            now=observed_start,
            runner=runner,
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

    core = dict(created)
    core.pop("result_sha256", None)
    core["replication"] = {
        "mode": "CREATED_NEW_VERSION",
        "new_provider_write": True,
    }
    result = dict(core)
    result["result_sha256"] = _sha256_json(core)
    return result


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
        Path(args.output).write_bytes(_canonical_bytes(result) + b"\n")
        return 0
    except (IdempotentReplicationError, ReplicationError, EnvelopeError) as exc:
        print(f"R1_IDEMPOTENT_REPLICATION_REJECTED:{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
