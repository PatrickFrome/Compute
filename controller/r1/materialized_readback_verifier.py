#!/usr/bin/env python3
"""Provider-neutral materialized-readback verifier for H205F22 R1.

The verifier has no network access and no Supabase authority. It consumes bytes that
were independently fetched from a durability domain plus a provider-controller
metadata descriptor, computes the content digest locally, classifies retention, and
emits a deterministic NON-AUTHORITATIVE receipt candidate.

It deliberately never treats ETag as a content hash and never marks R2/R3 proven.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
DOMAIN_RE = re.compile(r"^[A-Za-z0-9._:-]{3,160}$")
SUBJECT_KINDS = {"CHECKPOINT", "ARTIFACT", "BACKUP_SET"}
PROVIDER_OPERATOR = {
    "AWS_S3": "AMAZON_AWS",
    "BACKBLAZE_B2": "BACKBLAZE",
    "CLOUDFLARE_R2": "CLOUDFLARE",
}


class ReceiptError(RuntimeError):
    pass


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha256_json(value: Any) -> str:
    return hashlib.sha256(_canonical_bytes(value)).hexdigest()


def _read_json(path: str | Path) -> Any:
    try:
        return json.loads(Path(path).read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise ReceiptError(f"invalid_json:{path}") from exc


def _write_json(path: str | Path, value: Any) -> None:
    Path(path).write_bytes(_canonical_bytes(value) + b"\n")


def _parse_time(value: Any, field: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise ReceiptError(f"{field}_missing")
    text = value.strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError as exc:
        raise ReceiptError(f"{field}_invalid") from exc
    if dt.tzinfo is None:
        raise ReceiptError(f"{field}_timezone_required")
    return dt.astimezone(timezone.utc)


def _require_sha256(value: Any, field: str) -> str:
    if not isinstance(value, str) or not SHA256_RE.fullmatch(value):
        raise ReceiptError(f"{field}_invalid")
    return value


def _require_text(value: Any, field: str, *, minimum: int = 1, maximum: int = 512) -> str:
    if not isinstance(value, str) or not (minimum <= len(value.strip()) <= maximum):
        raise ReceiptError(f"{field}_invalid")
    return value.strip()


def _hash_file(path: str | Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    total = 0
    try:
        with Path(path).open("rb") as handle:
            while True:
                chunk = handle.read(1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
                total += len(chunk)
    except OSError as exc:
        raise ReceiptError(f"readback_file_unavailable:{path}") from exc
    return digest.hexdigest(), total


def _normalize_descriptor(descriptor: Any) -> dict[str, Any]:
    if not isinstance(descriptor, dict):
        raise ReceiptError("descriptor_shape_invalid")
    if descriptor.get("schema") != "metaengine.compute.r1-readback-descriptor.h205f22.v1":
        raise ReceiptError("descriptor_schema_invalid")

    domain_key = _require_text(descriptor.get("domain_key"), "domain_key", minimum=3, maximum=160)
    if not DOMAIN_RE.fullmatch(domain_key):
        raise ReceiptError("domain_key_invalid")

    provider_kind = _require_text(descriptor.get("provider_kind"), "provider_kind", maximum=64)
    operator_class = _require_text(descriptor.get("operator_class"), "operator_class", minimum=2, maximum=160)
    expected_operator = PROVIDER_OPERATOR.get(provider_kind)
    if expected_operator and operator_class != expected_operator:
        raise ReceiptError("operator_class_provider_mismatch")

    failure_domain = _require_text(descriptor.get("failure_domain"), "failure_domain", minimum=2, maximum=200)
    independence_basis = _require_text(descriptor.get("independence_basis"), "independence_basis", minimum=4, maximum=1000)
    account_scope_sha256 = _require_sha256(descriptor.get("account_scope_sha256"), "account_scope_sha256")

    obj = descriptor.get("object")
    provider_object = descriptor.get("provider_object")
    controller = descriptor.get("controller")
    if not isinstance(obj, dict) or not isinstance(provider_object, dict) or not isinstance(controller, dict):
        raise ReceiptError("descriptor_nested_shape_invalid")

    subject_kind = obj.get("subject_kind")
    if subject_kind not in SUBJECT_KINDS:
        raise ReceiptError("subject_kind_invalid")
    subject_id = _require_text(obj.get("subject_id"), "subject_id", maximum=512)
    expected_sha256 = _require_sha256(obj.get("expected_sha256"), "expected_sha256")
    expected_bytes = obj.get("expected_bytes")
    if not isinstance(expected_bytes, int) or isinstance(expected_bytes, bool) or expected_bytes < 0:
        raise ReceiptError("expected_bytes_invalid")
    payload_root_sha256 = obj.get("payload_root_sha256")
    if payload_root_sha256 is not None:
        payload_root_sha256 = _require_sha256(payload_root_sha256, "payload_root_sha256")
    manifest_checkpoint_id = obj.get("manifest_checkpoint_id")
    if manifest_checkpoint_id is not None:
        manifest_checkpoint_id = _require_text(manifest_checkpoint_id, "manifest_checkpoint_id", maximum=240)

    endpoint_host = _require_text(provider_object.get("endpoint_host"), "endpoint_host", maximum=255)
    bucket = _require_text(provider_object.get("bucket"), "bucket", maximum=255)
    key = _require_text(provider_object.get("key"), "key", maximum=2048)
    content_length = provider_object.get("content_length")
    if not isinstance(content_length, int) or isinstance(content_length, bool) or content_length < 0:
        raise ReceiptError("provider_content_length_invalid")
    provider_persisted_at = _parse_time(provider_object.get("last_modified"), "provider_last_modified")
    version_id = provider_object.get("version_id")
    if version_id is not None:
        version_id = _require_text(version_id, "version_id", maximum=1024)
    etag = provider_object.get("etag")
    if etag is not None:
        etag = _require_text(etag, "etag", maximum=512)

    controller_kind = _require_text(controller.get("kind"), "controller_kind", maximum=80)
    observed_at = _parse_time(controller.get("observed_at"), "controller_observed_at")
    controller_evidence_sha256 = _require_sha256(controller.get("evidence_sha256"), "controller_evidence_sha256")
    if observed_at < provider_persisted_at:
        raise ReceiptError("readback_observed_before_provider_persisted_at")

    retention = provider_object.get("retention")
    if retention is None:
        retention = {}
    if not isinstance(retention, dict):
        raise ReceiptError("retention_shape_invalid")

    return {
        "schema": descriptor["schema"],
        "domain_key": domain_key,
        "provider_kind": provider_kind,
        "operator_class": operator_class,
        "failure_domain": failure_domain,
        "independence_basis": independence_basis,
        "account_scope_sha256": account_scope_sha256,
        "object": {
            "subject_kind": subject_kind,
            "subject_id": subject_id,
            "expected_sha256": expected_sha256,
            "expected_bytes": expected_bytes,
            "payload_root_sha256": payload_root_sha256,
            "manifest_checkpoint_id": manifest_checkpoint_id,
        },
        "provider_object": {
            "endpoint_host": endpoint_host,
            "bucket": bucket,
            "key": key,
            "version_id": version_id,
            "etag": etag,
            "content_length": content_length,
            "last_modified": provider_persisted_at.isoformat(),
            "retention": retention,
        },
        "controller": {
            "kind": controller_kind,
            "observed_at": observed_at.isoformat(),
            "evidence_sha256": controller_evidence_sha256,
        },
    }


def classify_retention(provider_kind: str, retention: dict[str, Any], observed_at: datetime) -> dict[str, Any]:
    result = {
        "active": False,
        "grade": "UNPROTECTED",
        "strong_immutability": False,
        "retain_until": None,
        "indefinite": False,
        "source": None,
    }

    if provider_kind in {"AWS_S3", "BACKBLAZE_B2"}:
        mode = str(retention.get("mode") or "").upper()
        retain_until_raw = retention.get("retain_until")
        if not mode or retain_until_raw is None:
            return result
        retain_until = _parse_time(retain_until_raw, "retention_retain_until")
        result["retain_until"] = retain_until.isoformat()
        result["source"] = _require_text(retention.get("source"), "retention_source", maximum=120)
        if retain_until <= observed_at:
            result["grade"] = "EXPIRED"
            return result
        result["active"] = True
        if mode == "COMPLIANCE":
            result["grade"] = "COMPLIANCE_NON_SHORTENABLE"
            result["strong_immutability"] = True
        elif mode == "GOVERNANCE":
            result["grade"] = "GOVERNANCE_BYPASSABLE"
        else:
            raise ReceiptError("retention_mode_invalid")
        return result

    if provider_kind == "CLOUDFLARE_R2":
        active = retention.get("lock_rule_active") is True
        result["source"] = _require_text(retention.get("source"), "retention_source", maximum=120) if active else None
        if not active:
            return result
        result["active"] = True
        result["grade"] = "ADMIN_REVOCABLE_BUCKET_RULE"
        result["indefinite"] = retention.get("indefinite") is True
        until = retention.get("retain_until")
        if result["indefinite"]:
            return result
        if until is None:
            raise ReceiptError("r2_lock_retain_until_missing")
        retain_until = _parse_time(until, "retention_retain_until")
        result["retain_until"] = retain_until.isoformat()
        if retain_until <= observed_at:
            result["active"] = False
            result["grade"] = "EXPIRED"
        return result

    # Unknown S3-compatible systems can be represented, but they do not gain a
    # retention claim until a provider-specific verifier is added.
    if retention:
        result["grade"] = "UNVERIFIED_PROVIDER_RETENTION"
    return result


def verify_materialized_readback(path: str | Path, descriptor: Any) -> dict[str, Any]:
    d = _normalize_descriptor(descriptor)
    observed_sha256, observed_bytes = _hash_file(path)
    obj = d["object"]
    provider_object = d["provider_object"]
    observed_at = _parse_time(d["controller"]["observed_at"], "controller_observed_at")
    retention = classify_retention(d["provider_kind"], provider_object["retention"], observed_at)

    hash_match = observed_sha256 == obj["expected_sha256"]
    expected_size_match = observed_bytes == obj["expected_bytes"]
    provider_size_match = observed_bytes == provider_object["content_length"]
    status = "VERIFIED" if hash_match and expected_size_match and provider_size_match else "MISMATCH"
    eligible = status == "VERIFIED" and retention["active"]

    body = {
        "schema": "metaengine.compute.r1-materialized-readback-receipt.h205f22.v1",
        "classification": "MATERIALIZED_READBACK_RECEIPT_CANDIDATE",
        "domain_key": d["domain_key"],
        "provider_kind": d["provider_kind"],
        "operator_class": d["operator_class"],
        "failure_domain": d["failure_domain"],
        "independence_basis": d["independence_basis"],
        "account_scope_sha256": d["account_scope_sha256"],
        "object": obj,
        "provider_object": {
            "endpoint_host": provider_object["endpoint_host"],
            "bucket": provider_object["bucket"],
            "key": provider_object["key"],
            "version_id": provider_object["version_id"],
            "etag": provider_object["etag"],
            "content_length": provider_object["content_length"],
            "last_modified": provider_object["last_modified"],
        },
        "readback": {
            "observed_sha256": observed_sha256,
            "observed_bytes": observed_bytes,
            "hash_match": hash_match,
            "expected_size_match": expected_size_match,
            "provider_size_match": provider_size_match,
            "readback_at": d["controller"]["observed_at"],
            "status": status,
        },
        "retention": retention,
        "provenance": {
            "controller_kind": d["controller"]["kind"],
            "controller_evidence_sha256": d["controller"]["evidence_sha256"],
            "etag_recorded_for_identity_only": provider_object["etag"] is not None,
            "etag_used_as_content_proof": False,
            "content_proof": "LOCALLY_COMPUTED_SHA256_OVER_MATERIALIZED_BYTES",
        },
        "eligible_for_quorum_candidate": eligible,
        "canonical": False,
        "authority_effect": False,
        "r2_proven": False,
        "r3_proven": False,
        "persisted_seal_allowed": False,
    }
    body["receipt_sha256"] = _sha256_json(body)
    return body


def _validated_receipt(receipt: Any) -> dict[str, Any]:
    if not isinstance(receipt, dict) or receipt.get("schema") != "metaengine.compute.r1-materialized-readback-receipt.h205f22.v1":
        raise ReceiptError("receipt_schema_invalid")
    supplied = _require_sha256(receipt.get("receipt_sha256"), "receipt_sha256")
    check = dict(receipt)
    check.pop("receipt_sha256", None)
    if _sha256_json(check) != supplied:
        raise ReceiptError("receipt_digest_mismatch")
    return receipt


def evaluate_quorum(receipts: Iterable[Any]) -> dict[str, Any]:
    items = [_validated_receipt(item) for item in receipts]
    if len(items) < 2:
        raise ReceiptError("quorum_requires_at_least_two_receipts")

    object_keys = {
        (
            item["object"]["subject_kind"],
            item["object"]["subject_id"],
            item["object"]["expected_sha256"],
            item["object"]["expected_bytes"],
            item["object"].get("payload_root_sha256"),
        )
        for item in items
    }
    if len(object_keys) != 1:
        raise ReceiptError("quorum_object_identity_mismatch")

    eligible = [item for item in items if item.get("eligible_for_quorum_candidate") is True]
    domains = {item["domain_key"] for item in eligible}
    operators = {item["operator_class"] for item in eligible}
    failure_domains = {item["failure_domain"] for item in eligible}
    provider_kinds = {item["provider_kind"] for item in eligible}
    strong = [item for item in eligible if (item.get("retention") or {}).get("strong_immutability") is True]

    candidate = len(domains) >= 2 and len(operators) >= 2 and len(failure_domains) >= 2
    warnings: list[str] = []
    if candidate and len(strong) < len(eligible):
        warnings.append("ONE_OR_MORE_DOMAINS_USE_ADMIN_REVOCABLE_OR_GOVERNANCE_RETENTION")
    if candidate and len(provider_kinds) < 2:
        warnings.append("OPERATOR_CLASSES_ARE_DISTINCT_BUT_PROVIDER_KIND_IS_NOT")

    identity = next(iter(object_keys))
    result = {
        "schema": "metaengine.compute.r1-readback-quorum-candidate.h205f22.v1",
        "classification": "TWO_DOMAIN_READBACK_QUORUM_CANDIDATE",
        "object": {
            "subject_kind": identity[0],
            "subject_id": identity[1],
            "expected_sha256": identity[2],
            "expected_bytes": identity[3],
            "payload_root_sha256": identity[4],
        },
        "receipt_sha256s": sorted(item["receipt_sha256"] for item in eligible),
        "eligible_receipts": len(eligible),
        "distinct_domains": len(domains),
        "distinct_operator_classes": len(operators),
        "distinct_failure_domains": len(failure_domains),
        "distinct_provider_kinds": len(provider_kinds),
        "strong_immutability_domains": len(strong),
        "candidate_ready": candidate,
        "candidate_status": "R2_RECEIPT_QUORUM_CANDIDATE" if candidate else "R2_RECEIPT_QUORUM_NOT_READY",
        "warnings": warnings,
        "canonical": False,
        "authority_effect": False,
        "r2_proven": False,
        "r3_proven": False,
        "persisted_seal_allowed": False,
        "next_authority_step": "SUPERVISOR_VALIDATE_PROVIDER_EVIDENCE_THEN_INGEST_AND_REEVALUATE_DB_R2",
    }
    result["quorum_candidate_sha256"] = _sha256_json(result)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    verify = sub.add_parser("verify-readback")
    verify.add_argument("--file", required=True)
    verify.add_argument("--descriptor", required=True)
    verify.add_argument("--output", required=True)

    quorum = sub.add_parser("evaluate-quorum")
    quorum.add_argument("--receipt", action="append", required=True)
    quorum.add_argument("--output", required=True)

    args = parser.parse_args(argv)
    try:
        if args.command == "verify-readback":
            _write_json(args.output, verify_materialized_readback(args.file, _read_json(args.descriptor)))
        else:
            _write_json(args.output, evaluate_quorum(_read_json(path) for path in args.receipt))
        return 0
    except ReceiptError as exc:
        print(f"R1_READBACK_RECEIPT_REJECTED:{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
