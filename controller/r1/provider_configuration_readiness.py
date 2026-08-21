#!/usr/bin/env python3
"""Fail-closed provider configuration readiness for R1 STEP06A.

This module performs no provider writes and accepts only already-captured provider
configuration JSON. It validates the surrounding bucket configuration before the
STEP05A object-write/readback controller is allowed to run.

Authority remains NON-AUTHORITATIVE: readiness permits candidate generation only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

RECOVERY_PREFIX = "h205f22/r1/sha256/"
AWS_READINESS_SCHEMA = "metaengine.compute.r1-aws-provider-readiness.h205f22.v1"
B2_READINESS_SCHEMA = "metaengine.compute.r1-b2-provider-readiness.h205f22.v1"
CLASSIFICATION = "PROVIDER_CONFIGURATION_READY_FOR_NONAUTHORITATIVE_REPLICATION"
SHA256 = re.compile(r"^[0-9a-f]{64}$")
BUCKET = re.compile(r"^[A-Za-z0-9._-]{3,255}$")

AWS_BUCKET_READ_ACTIONS = (
    "s3:GetBucketVersioning",
    "s3:GetBucketObjectLockConfiguration",
    "s3:GetLifecycleConfiguration",
    "s3:ListBucket",
)
AWS_OBJECT_ACTIONS = (
    "s3:GetObject",
    "s3:GetObjectVersion",
    "s3:GetObjectRetention",
    "s3:PutObject",
    "s3:PutObjectRetention",
)
AWS_DESTRUCTIVE_DENY_ACTIONS = (
    "s3:DeleteObject",
    "s3:DeleteObjectVersion",
    "s3:PutLifecycleConfiguration",
    "s3:PutBucketVersioning",
    "s3:PutBucketObjectLockConfiguration",
    "s3:BypassGovernanceRetention",
    "s3:PutBucketPolicy",
    "s3:DeleteBucketPolicy",
)
B2_REQUIRED_CAPABILITIES = {
    "readFiles",
    "writeFiles",
    "readFileRetentions",
    "writeFileRetentions",
    "listBuckets",
    "readBucketRetentions",
}
B2_OPTIONAL_CAPABILITIES = {"listFiles"}
B2_ALLOWED_CAPABILITIES = B2_REQUIRED_CAPABILITIES | B2_OPTIONAL_CAPABILITIES


class ReadinessError(RuntimeError):
    pass


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha256_json(value: Any) -> str:
    return hashlib.sha256(_canonical_bytes(value)).hexdigest()


def _read_json(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise ReadinessError(f"{label}_invalid_json") from exc


def _write_receipt(path: Path, core: dict[str, Any]) -> dict[str, Any]:
    result = dict(core)
    result["receipt_sha256"] = _sha256_json(core)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(_canonical_bytes(result) + b"\n")
    return result


def _require_text(value: Any, field: str, minimum: int = 1, maximum: int = 2048) -> str:
    if not isinstance(value, str) or not (minimum <= len(value.strip()) <= maximum):
        raise ReadinessError(f"{field}_invalid")
    return value.strip()


def _require_sha(value: Any, field: str) -> str:
    if not isinstance(value, str) or not SHA256.fullmatch(value):
        raise ReadinessError(f"{field}_invalid")
    return value


def _parse_time(value: Any, field: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise ReadinessError(f"{field}_missing")
    try:
        dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError as exc:
        raise ReadinessError(f"{field}_invalid") from exc
    if dt.tzinfo is None:
        raise ReadinessError(f"{field}_timezone_required")
    return dt.astimezone(timezone.utc)


def _prefixes_overlap(a: str, b: str) -> bool:
    return a.startswith(b) or b.startswith(a)


def build_aws_session_policy(bucket: str) -> dict[str, Any]:
    bucket = _require_text(bucket, "bucket", minimum=3, maximum=255)
    if not BUCKET.fullmatch(bucket):
        raise ReadinessError("bucket_invalid")
    bucket_arn = f"arn:aws:s3:::{bucket}"
    object_arn = f"{bucket_arn}/{RECOVERY_PREFIX}*"
    return {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "ReadRecoveryBucketConfiguration",
                "Effect": "Allow",
                "Action": list(AWS_BUCKET_READ_ACTIONS),
                "Resource": bucket_arn,
            },
            {
                "Sid": "ReadWriteExactRecoveryPrefix",
                "Effect": "Allow",
                "Action": list(AWS_OBJECT_ACTIONS),
                "Resource": object_arn,
            },
            {
                "Sid": "DenyDestructiveRecoveryMutations",
                "Effect": "Deny",
                "Action": list(AWS_DESTRUCTIVE_DENY_ACTIONS),
                "Resource": [bucket_arn, f"{bucket_arn}/*"],
            },
        ],
    }


def validate_aws_session_policy(policy: Any, bucket: str) -> None:
    expected = build_aws_session_policy(bucket)
    if policy != expected:
        raise ReadinessError("aws_session_policy_not_exact_contract")
    serialized = json.dumps(policy, sort_keys=True)
    if '"Action": "*"' in serialized or '"Resource": "*"' in serialized:
        raise ReadinessError("aws_session_policy_wildcard_forbidden")


def _aws_rule_prefix(rule: dict[str, Any]) -> tuple[str | None, bool]:
    if "Prefix" in rule:
        value = rule.get("Prefix")
        return (str(value) if value is not None else ""), False
    filt = rule.get("Filter")
    if filt is None:
        return "", False
    if not isinstance(filt, dict):
        return None, True
    if "Prefix" in filt:
        value = filt.get("Prefix")
        return (str(value) if value is not None else ""), False
    conjunction = filt.get("And")
    if isinstance(conjunction, dict) and "Prefix" in conjunction:
        value = conjunction.get("Prefix")
        return (str(value) if value is not None else ""), bool(
            conjunction.get("Tags") or conjunction.get("Tag") or conjunction.get("ObjectSizeGreaterThan") is not None or conjunction.get("ObjectSizeLessThan") is not None
        )
    # Tag-only, size-only and unknown filters are treated conservatively as
    # potentially matching future recovery objects.
    return None, True


def _aws_rule_has_recovery_affecting_action(rule: dict[str, Any]) -> bool:
    action_keys = {
        "Expiration",
        "Transition",
        "Transitions",
        "NoncurrentVersionTransition",
        "NoncurrentVersionTransitions",
        "NoncurrentVersionExpiration",
    }
    return any(key in rule for key in action_keys)


def _aws_lifecycle_conflicts(lifecycle: Any) -> list[str]:
    if lifecycle is None:
        return []
    if not isinstance(lifecycle, dict):
        raise ReadinessError("aws_lifecycle_shape_invalid")
    rules = lifecycle.get("Rules", [])
    if rules is None:
        rules = []
    if not isinstance(rules, list):
        raise ReadinessError("aws_lifecycle_rules_invalid")
    conflicts: list[str] = []
    for index, rule in enumerate(rules):
        if not isinstance(rule, dict):
            raise ReadinessError("aws_lifecycle_rule_invalid")
        if str(rule.get("Status") or "").lower() != "enabled":
            continue
        if not _aws_rule_has_recovery_affecting_action(rule):
            continue
        prefix, uncertain = _aws_rule_prefix(rule)
        applies = uncertain or prefix is None or _prefixes_overlap(prefix, RECOVERY_PREFIX)
        if applies:
            conflicts.append(str(rule.get("ID") or f"rule-{index}"))
    return conflicts


def validate_aws_readiness(
    *,
    versioning: Any,
    object_lock: Any,
    lifecycle: Any,
    bucket: str,
    account_id: str,
    session_policy: Any,
) -> dict[str, Any]:
    bucket = _require_text(bucket, "bucket", minimum=3, maximum=255)
    if not BUCKET.fullmatch(bucket):
        raise ReadinessError("bucket_invalid")
    account_id = _require_text(account_id, "account_id", minimum=12, maximum=12)
    if not account_id.isdigit():
        raise ReadinessError("account_id_invalid")
    if not isinstance(versioning, dict) or versioning.get("Status") != "Enabled":
        raise ReadinessError("aws_bucket_versioning_not_enabled")
    if not isinstance(object_lock, dict) or object_lock.get("ObjectLockEnabled") != "Enabled":
        raise ReadinessError("aws_object_lock_not_enabled")
    validate_aws_session_policy(session_policy, bucket)
    conflicts = _aws_lifecycle_conflicts(lifecycle)
    if conflicts:
        raise ReadinessError("aws_recovery_prefix_lifecycle_conflict:" + ",".join(conflicts))

    default_retention = None
    rule = object_lock.get("Rule")
    if isinstance(rule, dict):
        default_retention = rule.get("DefaultRetention")

    return {
        "schema": AWS_READINESS_SCHEMA,
        "classification": CLASSIFICATION,
        "provider_kind": "AWS_S3",
        "operator_class": "AMAZON_AWS",
        "bucket": bucket,
        "account_id_sha256": hashlib.sha256(account_id.encode("utf-8")).hexdigest(),
        "recovery_prefix": RECOVERY_PREFIX,
        "versioning": "Enabled",
        "object_lock_enabled": True,
        "bucket_default_retention": default_retention,
        "conflicting_lifecycle_rules": [],
        "session_policy_sha256": _sha256_json(session_policy),
        "session_policy_destructive_actions_denied": True,
        "ready_for_step05a_candidate_generation": True,
        "canonical": False,
        "authority_effect": False,
        "r2_proven": False,
        "r3_proven": False,
        "persisted_seal_allowed": False,
    }


def _b2_authorization_contract(
    authorization: Any,
    *,
    expected_bucket: str,
    expected_endpoint_host: str,
    expected_account_scope_sha256: str,
    now: datetime,
) -> dict[str, Any]:
    if not isinstance(authorization, dict):
        raise ReadinessError("b2_authorization_shape_invalid")
    account_id = _require_text(authorization.get("accountId"), "b2_account_id", maximum=256)
    account_hash = hashlib.sha256(account_id.encode("utf-8")).hexdigest()
    if account_hash != _require_sha(expected_account_scope_sha256, "expected_account_scope_sha256"):
        raise ReadinessError("b2_account_scope_mismatch")

    storage = (authorization.get("apiInfo") or {}).get("storageApi") if isinstance(authorization.get("apiInfo"), dict) else None
    if not isinstance(storage, dict):
        raise ReadinessError("b2_storage_api_info_missing")
    s3_url = _require_text(storage.get("s3ApiUrl"), "b2_s3_api_url", maximum=500)
    parsed = urlparse(s3_url)
    if parsed.scheme != "https" or parsed.hostname != expected_endpoint_host or parsed.path not in ("", "/"):
        raise ReadinessError("b2_s3_endpoint_mismatch")

    allowed = storage.get("allowed")
    if not isinstance(allowed, dict):
        raise ReadinessError("b2_allowed_scope_missing")
    buckets = allowed.get("buckets")
    if not isinstance(buckets, list) or len(buckets) != 1 or not isinstance(buckets[0], dict) or buckets[0].get("name") != expected_bucket:
        raise ReadinessError("b2_key_must_be_exact_single_bucket")
    if allowed.get("namePrefix") != RECOVERY_PREFIX:
        raise ReadinessError("b2_key_prefix_scope_mismatch")

    caps = allowed.get("capabilities")
    if not isinstance(caps, list) or any(not isinstance(item, str) for item in caps):
        raise ReadinessError("b2_capabilities_invalid")
    capset = set(caps)
    if not B2_REQUIRED_CAPABILITIES.issubset(capset):
        missing = sorted(B2_REQUIRED_CAPABILITIES - capset)
        raise ReadinessError("b2_required_capabilities_missing:" + ",".join(missing))
    unexpected = capset - B2_ALLOWED_CAPABILITIES
    if unexpected:
        raise ReadinessError("b2_key_capabilities_too_broad:" + ",".join(sorted(unexpected)))

    expiry_raw = authorization.get("applicationKeyExpirationTimestamp")
    if isinstance(expiry_raw, bool):
        raise ReadinessError("b2_key_expiration_invalid")
    try:
        expiry_ms = int(expiry_raw)
    except (TypeError, ValueError) as exc:
        raise ReadinessError("b2_key_expiration_invalid") from exc
    expiry = datetime.fromtimestamp(expiry_ms / 1000, tz=timezone.utc)
    if expiry <= now + timedelta(minutes=10):
        raise ReadinessError("b2_key_expiry_too_soon")
    if expiry > now + timedelta(hours=24):
        raise ReadinessError("b2_key_expiry_exceeds_24h")

    return {
        "account_id": account_id,
        "account_scope_sha256": account_hash,
        "capabilities": sorted(capset),
        "expiration": expiry.isoformat(),
        "s3_endpoint_host": parsed.hostname,
    }


def _b2_lifecycle_conflicts(rules: Any) -> list[str]:
    if rules is None:
        return []
    if not isinstance(rules, list):
        raise ReadinessError("b2_lifecycle_rules_invalid")
    conflicts: list[str] = []
    for index, rule in enumerate(rules):
        if not isinstance(rule, dict):
            raise ReadinessError("b2_lifecycle_rule_invalid")
        prefix = str(rule.get("fileNamePrefix") or "")
        has_action = rule.get("daysFromUploadingToHiding") is not None or rule.get("daysFromHidingToDeleting") is not None
        if has_action and _prefixes_overlap(prefix, RECOVERY_PREFIX):
            conflicts.append(f"rule-{index}:{prefix}")
    return conflicts


def validate_b2_readiness(
    *,
    authorization: Any,
    buckets_response: Any,
    expected_bucket: str,
    expected_endpoint_host: str,
    expected_account_scope_sha256: str,
    now: datetime | None = None,
) -> dict[str, Any]:
    observed = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    auth = _b2_authorization_contract(
        authorization,
        expected_bucket=expected_bucket,
        expected_endpoint_host=expected_endpoint_host,
        expected_account_scope_sha256=expected_account_scope_sha256,
        now=observed,
    )
    if not isinstance(buckets_response, dict) or not isinstance(buckets_response.get("buckets"), list):
        raise ReadinessError("b2_bucket_response_shape_invalid")
    buckets = buckets_response["buckets"]
    if len(buckets) != 1 or not isinstance(buckets[0], dict) or buckets[0].get("bucketName") != expected_bucket:
        raise ReadinessError("b2_bucket_response_not_exact_single_bucket")
    bucket = buckets[0]
    if bucket.get("accountId") != auth["account_id"]:
        raise ReadinessError("b2_bucket_account_mismatch")
    if bucket.get("bucketType") != "allPrivate":
        raise ReadinessError("b2_recovery_bucket_must_be_private")
    lock = bucket.get("fileLockConfiguration")
    if not isinstance(lock, dict) or lock.get("isClientAuthorizedToRead") is not True:
        raise ReadinessError("b2_object_lock_configuration_not_readable")
    lock_value = lock.get("value")
    if not isinstance(lock_value, dict) or lock_value.get("isFileLockEnabled") is not True:
        raise ReadinessError("b2_object_lock_not_enabled")
    conflicts = _b2_lifecycle_conflicts(bucket.get("lifecycleRules"))
    if conflicts:
        raise ReadinessError("b2_recovery_prefix_lifecycle_conflict:" + ",".join(conflicts))

    return {
        "schema": B2_READINESS_SCHEMA,
        "classification": CLASSIFICATION,
        "provider_kind": "BACKBLAZE_B2",
        "operator_class": "BACKBLAZE",
        "bucket": expected_bucket,
        "account_scope_sha256": auth["account_scope_sha256"],
        "recovery_prefix": RECOVERY_PREFIX,
        "object_lock_enabled": True,
        "bucket_default_retention": lock_value.get("defaultRetention"),
        "conflicting_lifecycle_rules": [],
        "runtime_key_capabilities": auth["capabilities"],
        "runtime_key_expiration": auth["expiration"],
        "s3_endpoint_host": auth["s3_endpoint_host"],
        "ready_for_step05a_candidate_generation": True,
        "canonical": False,
        "authority_effect": False,
        "r2_proven": False,
        "r3_proven": False,
        "persisted_seal_allowed": False,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    emit = sub.add_parser("emit-aws-session-policy")
    emit.add_argument("--bucket", required=True)

    aws = sub.add_parser("validate-aws")
    aws.add_argument("--versioning", required=True)
    aws.add_argument("--object-lock", required=True)
    aws.add_argument("--lifecycle", required=True)
    aws.add_argument("--session-policy", required=True)
    aws.add_argument("--bucket", required=True)
    aws.add_argument("--account-id", required=True)
    aws.add_argument("--output", required=True)

    b2 = sub.add_parser("validate-b2")
    b2.add_argument("--authorization", required=True)
    b2.add_argument("--buckets", required=True)
    b2.add_argument("--expected-bucket", required=True)
    b2.add_argument("--expected-endpoint-host", required=True)
    b2.add_argument("--expected-account-scope-sha256", required=True)
    b2.add_argument("--output", required=True)

    args = parser.parse_args(argv)
    try:
        if args.command == "emit-aws-session-policy":
            print(_canonical_bytes(build_aws_session_policy(args.bucket)).decode("utf-8"))
            return 0
        if args.command == "validate-aws":
            core = validate_aws_readiness(
                versioning=_read_json(Path(args.versioning), "aws_versioning"),
                object_lock=_read_json(Path(args.object_lock), "aws_object_lock"),
                lifecycle=_read_json(Path(args.lifecycle), "aws_lifecycle"),
                bucket=args.bucket,
                account_id=args.account_id,
                session_policy=_read_json(Path(args.session_policy), "aws_session_policy"),
            )
            _write_receipt(Path(args.output), core)
            return 0
        if args.command == "validate-b2":
            core = validate_b2_readiness(
                authorization=_read_json(Path(args.authorization), "b2_authorization"),
                buckets_response=_read_json(Path(args.buckets), "b2_buckets"),
                expected_bucket=args.expected_bucket,
                expected_endpoint_host=args.expected_endpoint_host,
                expected_account_scope_sha256=args.expected_account_scope_sha256,
            )
            _write_receipt(Path(args.output), core)
            return 0
        raise ReadinessError("unknown_command")
    except ReadinessError as exc:
        print(f"R1_PROVIDER_READINESS_REJECTED:{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
