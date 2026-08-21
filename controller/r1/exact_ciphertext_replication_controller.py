#!/usr/bin/env python3
"""Replicate one STEP04 ciphertext to one S3-compatible durability domain.

The controller is deliberately NON-AUTHORITATIVE. It validates the hardened STEP04
receipt, uploads the exact ciphertext bytes with COMPLIANCE retention, pins the
returned object version, materializes that exact version back to local disk, and
feeds it into the STEP02 verifier.

Provider credentials are consumed only by the external AWS CLI process/environment.
They are never accepted in target configuration and never written to evidence.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

from controller.r1.materialized_readback_verifier import verify_materialized_readback
from controller.r1.recovery_encryption_envelope import validate_envelope_receipt

TARGET_SCHEMA = "metaengine.compute.r1-s3-replication-target.h205f22.v1"
RESULT_SCHEMA = "metaengine.compute.r1-provider-replication-result.h205f22.v1"
RESULT_CLASSIFICATION = "PROVIDER_REPLICATION_READBACK_CANDIDATE_NONAUTHORITATIVE"
SUPPORTED_PROVIDERS = {
    "AWS_S3": "AMAZON_AWS",
    "BACKBLAZE_B2": "BACKBLAZE",
}
SHA256 = re.compile(r"^[0-9a-f]{64}$")
DOMAIN = re.compile(r"^[A-Za-z0-9._:-]{3,160}$")
REGION = re.compile(r"^[a-z0-9-]{3,40}$")
BUCKET = re.compile(r"^[A-Za-z0-9._-]{3,255}$")


class ReplicationError(RuntimeError):
    pass


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha256_json(value: Any) -> str:
    return hashlib.sha256(_canonical_bytes(value)).hexdigest()


def _read_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise ReplicationError(f"{label}_invalid_json") from exc
    if not isinstance(value, dict):
        raise ReplicationError(f"{label}_must_be_object")
    return value


def _require_text(value: Any, field: str, minimum: int = 1, maximum: int = 512) -> str:
    if not isinstance(value, str) or not (minimum <= len(value.strip()) <= maximum):
        raise ReplicationError(f"{field}_invalid")
    return value.strip()


def _require_sha(value: Any, field: str) -> str:
    if not isinstance(value, str) or not SHA256.fullmatch(value):
        raise ReplicationError(f"{field}_invalid")
    return value


def _parse_time(value: Any, field: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise ReplicationError(f"{field}_missing")
    try:
        dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError as exc:
        raise ReplicationError(f"{field}_invalid") from exc
    if dt.tzinfo is None:
        raise ReplicationError(f"{field}_timezone_required")
    return dt.astimezone(timezone.utc)


def _endpoint_host(endpoint_url: str | None, provider_kind: str, region: str) -> str:
    if provider_kind == "AWS_S3":
        if endpoint_url is not None:
            raise ReplicationError("aws_endpoint_override_forbidden")
        return f"s3.{region}.amazonaws.com"
    if endpoint_url is None:
        raise ReplicationError("b2_endpoint_url_required")
    parsed = urlparse(endpoint_url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise ReplicationError("b2_endpoint_url_invalid")
    if not parsed.hostname.endswith(".backblazeb2.com"):
        raise ReplicationError("b2_endpoint_host_invalid")
    return parsed.hostname


def validate_target(target: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    if target.get("schema") != TARGET_SCHEMA:
        raise ReplicationError("target_schema_invalid")
    provider_kind = _require_text(target.get("provider_kind"), "provider_kind", maximum=64)
    expected_operator = SUPPORTED_PROVIDERS.get(provider_kind)
    if expected_operator is None:
        raise ReplicationError("provider_kind_unsupported")
    operator_class = _require_text(target.get("operator_class"), "operator_class", minimum=2, maximum=160)
    if operator_class != expected_operator:
        raise ReplicationError("operator_class_provider_mismatch")
    domain_key = _require_text(target.get("domain_key"), "domain_key", minimum=3, maximum=160)
    if not DOMAIN.fullmatch(domain_key):
        raise ReplicationError("domain_key_invalid")
    failure_domain = _require_text(target.get("failure_domain"), "failure_domain", minimum=2, maximum=200)
    independence_basis = _require_text(target.get("independence_basis"), "independence_basis", minimum=8, maximum=1000)
    account_scope_sha256 = _require_sha(target.get("account_scope_sha256"), "account_scope_sha256")
    bucket = _require_text(target.get("bucket"), "bucket", minimum=3, maximum=255)
    if not BUCKET.fullmatch(bucket):
        raise ReplicationError("bucket_invalid")
    region = _require_text(target.get("region"), "region", minimum=3, maximum=40)
    if not REGION.fullmatch(region):
        raise ReplicationError("region_invalid")
    endpoint_url = target.get("endpoint_url")
    if endpoint_url is not None:
        endpoint_url = _require_text(endpoint_url, "endpoint_url", maximum=500)
    endpoint_host = _endpoint_host(endpoint_url, provider_kind, region)
    retain_until = _parse_time(target.get("retain_until"), "retain_until")
    observed_now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    if retain_until <= observed_now + timedelta(hours=24):
        raise ReplicationError("retention_must_extend_at_least_24h")
    return {
        "schema": TARGET_SCHEMA,
        "domain_key": domain_key,
        "provider_kind": provider_kind,
        "operator_class": operator_class,
        "failure_domain": failure_domain,
        "independence_basis": independence_basis,
        "account_scope_sha256": account_scope_sha256,
        "bucket": bucket,
        "region": region,
        "endpoint_url": endpoint_url,
        "endpoint_host": endpoint_host,
        "retain_until": retain_until.isoformat(),
    }


def object_key(ciphertext_sha256: str) -> str:
    digest = _require_sha(ciphertext_sha256, "ciphertext_sha256")
    return f"h205f22/r1/sha256/{digest}.age"


def _endpoint_args(target: dict[str, Any]) -> list[str]:
    return ["--endpoint-url", target["endpoint_url"]] if target["endpoint_url"] else []


def build_put_command(aws_bin: str, target: dict[str, Any], ciphertext: Path, ciphertext_sha256: str) -> list[str]:
    cmd = [
        aws_bin, "s3api", "put-object",
        "--bucket", target["bucket"],
        "--key", object_key(ciphertext_sha256),
        "--body", str(ciphertext),
        "--object-lock-mode", "COMPLIANCE",
        "--object-lock-retain-until-date", target["retain_until"],
        "--metadata", f"metaengine-sha256={ciphertext_sha256},metaengine-contract=h205f22-r1-v1",
        "--region", target["region"],
        "--output", "json",
    ]
    if target["provider_kind"] == "AWS_S3":
        cmd.extend(["--if-none-match", "*"])
    cmd.extend(_endpoint_args(target))
    return cmd


def _version_args(version_id: str) -> list[str]:
    return ["--version-id", version_id]


def build_retention_command(aws_bin: str, target: dict[str, Any], key: str, version_id: str) -> list[str]:
    return [aws_bin, "s3api", "get-object-retention", "--bucket", target["bucket"], "--key", key, *_version_args(version_id), "--region", target["region"], "--output", "json", *_endpoint_args(target)]


def build_head_command(aws_bin: str, target: dict[str, Any], key: str, version_id: str) -> list[str]:
    return [aws_bin, "s3api", "head-object", "--bucket", target["bucket"], "--key", key, *_version_args(version_id), "--region", target["region"], "--output", "json", *_endpoint_args(target)]


def build_get_command(aws_bin: str, target: dict[str, Any], key: str, version_id: str, output_path: Path) -> list[str]:
    return [aws_bin, "s3api", "get-object", "--bucket", target["bucket"], "--key", key, *_version_args(version_id), "--region", target["region"], "--output", "json", *_endpoint_args(target), str(output_path)]


def _subprocess_json(cmd: list[str]) -> dict[str, Any]:
    try:
        proc = subprocess.run(cmd, check=True, text=True, capture_output=True, stdin=subprocess.DEVNULL, timeout=900)
    except (OSError, subprocess.SubprocessError) as exc:
        raise ReplicationError(f"provider_command_failed:{cmd[1]}:{cmd[2]}") from exc
    try:
        value = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError as exc:
        raise ReplicationError(f"provider_command_non_json:{cmd[1]}:{cmd[2]}") from exc
    if not isinstance(value, dict):
        raise ReplicationError("provider_response_shape_invalid")
    return value


def _extract_version_id(put_response: dict[str, Any]) -> str:
    value = put_response.get("VersionId")
    if not isinstance(value, str) or not value.strip() or value == "null":
        raise ReplicationError("provider_version_id_missing")
    return value.strip()


def _validate_retention(response: dict[str, Any], requested_until: datetime, observed_at: datetime) -> dict[str, Any]:
    retention = response.get("Retention")
    if not isinstance(retention, dict):
        raise ReplicationError("provider_retention_missing")
    if str(retention.get("Mode") or "").upper() != "COMPLIANCE":
        raise ReplicationError("provider_retention_not_compliance")
    actual_until = _parse_time(retention.get("RetainUntilDate"), "provider_retain_until")
    if actual_until < requested_until:
        raise ReplicationError("provider_retention_shorter_than_requested")
    if actual_until <= observed_at:
        raise ReplicationError("provider_retention_already_expired")
    return {
        "mode": "COMPLIANCE",
        "retain_until": actual_until.isoformat(),
        "source": "S3_GET_OBJECT_RETENTION_VERSION_PINNED",
    }


def _head_fields(response: dict[str, Any]) -> tuple[int, str, str | None, str | None]:
    length = response.get("ContentLength")
    if not isinstance(length, int) or isinstance(length, bool) or length < 0:
        raise ReplicationError("head_content_length_invalid")
    last_modified = response.get("LastModified")
    if not isinstance(last_modified, str):
        raise ReplicationError("head_last_modified_missing")
    _parse_time(last_modified, "head_last_modified")
    etag = response.get("ETag")
    if etag is not None and not isinstance(etag, str):
        raise ReplicationError("head_etag_invalid")
    version = response.get("VersionId")
    if version is not None and not isinstance(version, str):
        raise ReplicationError("head_version_id_invalid")
    return length, last_modified, etag, version


def replicate_and_readback(
    *,
    ciphertext: Path,
    envelope_receipt_path: Path,
    target_raw: dict[str, Any],
    aws_bin: str = "aws",
    now: datetime | None = None,
    runner: Callable[[list[str]], dict[str, Any]] = _subprocess_json,
) -> dict[str, Any]:
    observed_start = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    envelope = validate_envelope_receipt(ciphertext, envelope_receipt_path, require_production_ready=True)
    target = validate_target(target_raw, observed_start)
    cipher = envelope["ciphertext"]
    ciphertext_sha256 = cipher["sha256"]
    ciphertext_bytes = cipher["bytes"]
    key = object_key(ciphertext_sha256)

    put_cmd = build_put_command(aws_bin, target, ciphertext, ciphertext_sha256)
    put_response = runner(put_cmd)
    version_id = _extract_version_id(put_response)

    retention_response = runner(build_retention_command(aws_bin, target, key, version_id))
    head_response = runner(build_head_command(aws_bin, target, key, version_id))
    content_length, last_modified, etag, head_version = _head_fields(head_response)
    if head_version not in (None, version_id):
        raise ReplicationError("head_version_id_mismatch")

    observed_at = datetime.now(timezone.utc) if now is None else observed_start + timedelta(seconds=1)
    retention = _validate_retention(retention_response, _parse_time(target["retain_until"], "retain_until"), observed_at)

    evidence_core = {
        "schema": "metaengine.compute.r1-provider-controller-evidence.h205f22.v1",
        "provider_kind": target["provider_kind"],
        "domain_key": target["domain_key"],
        "bucket": target["bucket"],
        "key": key,
        "version_id": version_id,
        "put_response": put_response,
        "head_response": head_response,
        "retention_response": retention_response,
        "aws_if_none_match_used": target["provider_kind"] == "AWS_S3",
        "b2_conditional_create_claimed": False,
        "credentials_embedded": False,
    }
    controller_evidence_sha256 = _sha256_json(evidence_core)

    with tempfile.TemporaryDirectory(prefix="h205f22-r1-readback-") as temp_dir:
        readback_path = Path(temp_dir) / "readback.age"
        get_response = runner(build_get_command(aws_bin, target, key, version_id, readback_path))
        if not readback_path.is_file():
            raise ReplicationError("provider_get_did_not_materialize_file")
        evidence_core["get_response"] = get_response
        controller_evidence_sha256 = _sha256_json(evidence_core)
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
                "kind": "R1_EXACT_CIPHERTEXT_S3_REPLICATION_CONTROLLER_V1",
                "observed_at": observed_at.isoformat(),
                "evidence_sha256": controller_evidence_sha256,
            },
        }
        readback_receipt = verify_materialized_readback(readback_path, descriptor)

    if readback_receipt.get("readback", {}).get("status") != "VERIFIED":
        raise ReplicationError("materialized_readback_mismatch")
    if readback_receipt.get("retention", {}).get("grade") != "COMPLIANCE_NON_SHORTENABLE":
        raise ReplicationError("materialized_readback_retention_not_strong")

    result = {
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
        "provider_controller_evidence_sha256": controller_evidence_sha256,
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
    result["result_sha256"] = _sha256_json(result)
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
        result = replicate_and_readback(
            ciphertext=Path(args.ciphertext),
            envelope_receipt_path=Path(args.envelope_receipt),
            target_raw=_read_json(Path(args.target), "target"),
            aws_bin=args.aws_bin,
        )
        Path(args.output).write_bytes(_canonical_bytes(result) + b"\n")
        return 0
    except (ReplicationError, Exception) as exc:
        # Preserve known contract errors while preventing provider CLI details from
        # being promoted into an evidence file. stderr is operational only.
        if isinstance(exc, ReplicationError):
            message = str(exc)
        else:
            message = "unexpected_controller_failure"
        print(f"R1_REPLICATION_REJECTED:{message}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
