#!/usr/bin/env python3
"""Fail-closed guard for R1 live two-domain orchestration.

This module performs no provider writes and holds no credentials. It validates:
- a trusted same-repository source workflow run and immutable artifact metadata;
- pre-existing protected GitHub environments before provider jobs can reference them;
- Backblaze B2 application-key scope returned by b2_authorize_account v4;
- STEP05 provider results and the credential-free STEP02 two-domain quorum candidate.

All outputs remain NON-AUTHORITATIVE. Source attestation is still a later mandatory
trust gate before any Supabase R2 authority or persisted seal is possible.
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

from controller.r1.materialized_readback_verifier import _validated_receipt, evaluate_quorum

EXPECTED_REPOSITORY_ID = 1341371143
EXPECTED_REPOSITORY = "PatrickFrome/Compute"
EXPECTED_SOURCE_WORKFLOW_PATH = ".github/workflows/r1-live-recovery-source.yml"
EXPECTED_SOURCE_BRANCH = "main"
AWS_ENVIRONMENT = "r1-aws-durability-proof"
B2_ENVIRONMENT = "r1-b2-durability-proof"
CIPHERTEXT_ARTIFACT_NAME = "r1-recovery-ciphertext.age"
ENVELOPE_ARTIFACT_NAME = "r1-recovery-envelope-receipt.json"
MAX_SINGLE_PUT_BYTES = 5 * 1024 * 1024 * 1024
MAX_ENVELOPE_RECEIPT_BYTES = 1024 * 1024
B2_REQUIRED_PREFIX = "h205f22/r1/sha256/"
B2_REQUIRED_CAPABILITIES = {
    "readFiles",
    "writeFiles",
    "readFileRetentions",
    "writeFileRetentions",
}
B2_ALLOWED_CAPABILITIES = B2_REQUIRED_CAPABILITIES | {
    "listFiles",
    "listAllBucketNames",
    "listBuckets",
    "readBuckets",
}
PROVIDER_OPERATOR = {
    "AWS_S3": "AMAZON_AWS",
    "BACKBLAZE_B2": "BACKBLAZE",
}
SHA256 = re.compile(r"^[0-9a-f]{64}$")
SHA40 = re.compile(r"^[0-9a-f]{40}$")
ARTIFACT_DIGEST = re.compile(r"^sha256:([0-9a-f]{64})$")


class OrchestrationError(RuntimeError):
    pass


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha256_json(value: Any) -> str:
    return hashlib.sha256(_canonical_bytes(value)).hexdigest()


def _read_json(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise OrchestrationError(f"{label}_invalid_json") from exc


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(_canonical_bytes(value) + b"\n")


def _require_text(value: Any, field: str, minimum: int = 1, maximum: int = 2048) -> str:
    if not isinstance(value, str) or not (minimum <= len(value.strip()) <= maximum):
        raise OrchestrationError(f"{field}_invalid")
    return value.strip()


def _require_int(value: Any, field: str, minimum: int = 1) -> int:
    if isinstance(value, bool):
        raise OrchestrationError(f"{field}_invalid")
    try:
        result = int(value)
    except (TypeError, ValueError) as exc:
        raise OrchestrationError(f"{field}_invalid") from exc
    if result < minimum:
        raise OrchestrationError(f"{field}_invalid")
    return result


def _require_sha256(value: Any, field: str) -> str:
    if not isinstance(value, str) or not SHA256.fullmatch(value):
        raise OrchestrationError(f"{field}_invalid")
    return value


def _parse_time(value: Any, field: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise OrchestrationError(f"{field}_missing")
    try:
        dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError as exc:
        raise OrchestrationError(f"{field}_invalid") from exc
    if dt.tzinfo is None:
        raise OrchestrationError(f"{field}_timezone_required")
    return dt.astimezone(timezone.utc)


def _verify_self_hash(value: dict[str, Any], field: str, label: str) -> None:
    claimed = _require_sha256(value.get(field), field)
    core = dict(value)
    core.pop(field, None)
    if _sha256_json(core) != claimed:
        raise OrchestrationError(f"{label}_{field}_mismatch")


def _validate_environment(value: Any, expected_name: str) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("name") != expected_name:
        raise OrchestrationError(f"environment_invalid:{expected_name}")
    rules = value.get("protection_rules")
    if not isinstance(rules, list):
        raise OrchestrationError(f"environment_protection_rules_missing:{expected_name}")
    reviewer_rules = [rule for rule in rules if isinstance(rule, dict) and rule.get("type") == "required_reviewers"]
    if len(reviewer_rules) != 1:
        raise OrchestrationError(f"environment_required_reviewers_missing:{expected_name}")
    reviewer_rule = reviewer_rules[0]
    reviewers = reviewer_rule.get("reviewers")
    if not isinstance(reviewers, list) or not reviewers:
        raise OrchestrationError(f"environment_required_reviewers_empty:{expected_name}")
    if reviewer_rule.get("prevent_self_review") is not True:
        raise OrchestrationError(f"environment_prevent_self_review_required:{expected_name}")

    branch_policy = value.get("deployment_branch_policy")
    if not isinstance(branch_policy, dict):
        raise OrchestrationError(f"environment_branch_policy_missing:{expected_name}")
    protected = branch_policy.get("protected_branches") is True
    custom = branch_policy.get("custom_branch_policies") is True
    if protected == custom:
        raise OrchestrationError(f"environment_branch_policy_invalid:{expected_name}")
    if not any(isinstance(rule, dict) and rule.get("type") == "branch_policy" for rule in rules):
        raise OrchestrationError(f"environment_branch_policy_rule_missing:{expected_name}")

    return {
        "name": expected_name,
        "required_reviewer_count": len(reviewers),
        "prevent_self_review": True,
        "branch_policy": {
            "protected_branches": protected,
            "custom_branch_policies": custom,
        },
    }


def _selected_artifact(artifacts: Any, artifact_id: int, expected_name: str, run: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(artifacts, dict) or not isinstance(artifacts.get("artifacts"), list):
        raise OrchestrationError("artifacts_shape_invalid")
    matches = [item for item in artifacts["artifacts"] if isinstance(item, dict) and item.get("id") == artifact_id]
    if len(matches) != 1:
        raise OrchestrationError(f"artifact_id_not_unique_or_missing:{artifact_id}")
    item = matches[0]
    if item.get("name") != expected_name:
        raise OrchestrationError(f"artifact_name_mismatch:{expected_name}")
    if item.get("expired") is not False:
        raise OrchestrationError(f"artifact_expired:{expected_name}")
    size = _require_int(item.get("size_in_bytes"), f"artifact_size:{expected_name}")
    digest_text = _require_text(item.get("digest"), f"artifact_digest:{expected_name}", maximum=80)
    digest_match = ARTIFACT_DIGEST.fullmatch(digest_text)
    if digest_match is None:
        raise OrchestrationError(f"artifact_digest_invalid:{expected_name}")
    workflow_run = item.get("workflow_run")
    if not isinstance(workflow_run, dict):
        raise OrchestrationError(f"artifact_workflow_run_missing:{expected_name}")
    expected = {
        "id": run["id"],
        "repository_id": EXPECTED_REPOSITORY_ID,
        "head_repository_id": EXPECTED_REPOSITORY_ID,
        "head_branch": EXPECTED_SOURCE_BRANCH,
        "head_sha": run["head_sha"],
    }
    for key, expected_value in expected.items():
        if workflow_run.get(key) != expected_value:
            raise OrchestrationError(f"artifact_workflow_binding_mismatch:{expected_name}:{key}")
    return {
        "id": artifact_id,
        "name": expected_name,
        "size_in_bytes": size,
        "digest_sha256": digest_match.group(1),
    }


def validate_preflight(
    *,
    source_run: Any,
    artifacts: Any,
    aws_environment: Any,
    b2_environment: Any,
    source_run_id: int,
    ciphertext_artifact_id: int,
    envelope_artifact_id: int,
) -> dict[str, Any]:
    if not isinstance(source_run, dict):
        raise OrchestrationError("source_run_shape_invalid")
    if source_run.get("id") != source_run_id:
        raise OrchestrationError("source_run_id_mismatch")
    if source_run.get("repository", {}).get("id") != EXPECTED_REPOSITORY_ID:
        raise OrchestrationError("source_repository_id_mismatch")
    if source_run.get("repository", {}).get("full_name") != EXPECTED_REPOSITORY:
        raise OrchestrationError("source_repository_name_mismatch")
    if source_run.get("head_repository", {}).get("id") != EXPECTED_REPOSITORY_ID:
        raise OrchestrationError("source_head_repository_id_mismatch")
    if source_run.get("head_repository", {}).get("full_name") != EXPECTED_REPOSITORY:
        raise OrchestrationError("source_head_repository_name_mismatch")
    if source_run.get("path") != EXPECTED_SOURCE_WORKFLOW_PATH:
        raise OrchestrationError("source_workflow_path_mismatch")
    if source_run.get("head_branch") != EXPECTED_SOURCE_BRANCH:
        raise OrchestrationError("source_branch_mismatch")
    if source_run.get("event") != "workflow_dispatch":
        raise OrchestrationError("source_event_must_be_workflow_dispatch")
    if source_run.get("status") != "completed" or source_run.get("conclusion") != "success":
        raise OrchestrationError("source_run_not_successful")
    head_sha = _require_text(source_run.get("head_sha"), "source_head_sha", minimum=40, maximum=40)
    if not SHA40.fullmatch(head_sha):
        raise OrchestrationError("source_head_sha_invalid")

    ciphertext = _selected_artifact(artifacts, ciphertext_artifact_id, CIPHERTEXT_ARTIFACT_NAME, source_run)
    envelope = _selected_artifact(artifacts, envelope_artifact_id, ENVELOPE_ARTIFACT_NAME, source_run)
    if ciphertext["size_in_bytes"] > MAX_SINGLE_PUT_BYTES:
        raise OrchestrationError("ciphertext_exceeds_step05_single_put_limit")
    if envelope["size_in_bytes"] > MAX_ENVELOPE_RECEIPT_BYTES:
        raise OrchestrationError("envelope_receipt_unreasonably_large")

    aws_env = _validate_environment(aws_environment, AWS_ENVIRONMENT)
    b2_env = _validate_environment(b2_environment, B2_ENVIRONMENT)

    core = {
        "schema": "metaengine.compute.r1-live-two-domain-preflight.h205f22.v1",
        "classification": "LIVE_ORCHESTRATION_PREFLIGHT_NONAUTHORITATIVE",
        "source": {
            "run_id": source_run_id,
            "workflow_path": EXPECTED_SOURCE_WORKFLOW_PATH,
            "branch": EXPECTED_SOURCE_BRANCH,
            "head_sha": head_sha,
            "repository_id": EXPECTED_REPOSITORY_ID,
            "repository": EXPECTED_REPOSITORY,
            "ciphertext_artifact": ciphertext,
            "envelope_artifact": envelope,
        },
        "environments": {
            "aws": aws_env,
            "b2": b2_env,
        },
        "provider_execution_authorized": False,
        "source_attestation_verified": False,
        "source_attestation_required_before_authority": True,
        "canonical": False,
        "authority_effect": False,
        "r2_proven": False,
        "r3_proven": False,
        "persisted_seal_allowed": False,
    }
    result = dict(core)
    result["preflight_sha256"] = _sha256_json(core)
    return result


def validate_b2_authorization(
    value: Any,
    *,
    expected_bucket: str,
    expected_endpoint_host: str,
    expected_account_scope_sha256: str,
    now: datetime | None = None,
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise OrchestrationError("b2_authorization_shape_invalid")
    account_id = _require_text(value.get("accountId"), "b2_account_id", maximum=256)
    actual_account_hash = hashlib.sha256(account_id.encode("utf-8")).hexdigest()
    if actual_account_hash != _require_sha256(expected_account_scope_sha256, "expected_account_scope_sha256"):
        raise OrchestrationError("b2_account_scope_mismatch")

    storage = (value.get("apiInfo") or {}).get("storageApi") if isinstance(value.get("apiInfo"), dict) else None
    if not isinstance(storage, dict):
        raise OrchestrationError("b2_storage_api_info_missing")
    s3_url = _require_text(storage.get("s3ApiUrl"), "b2_s3_api_url", maximum=500)
    parsed = urlparse(s3_url)
    if parsed.scheme != "https" or parsed.hostname != expected_endpoint_host or parsed.path not in ("", "/"):
        raise OrchestrationError("b2_s3_endpoint_mismatch")

    allowed = storage.get("allowed")
    if not isinstance(allowed, dict):
        raise OrchestrationError("b2_allowed_scope_missing")
    buckets = allowed.get("buckets")
    if not isinstance(buckets, list) or len(buckets) != 1 or not isinstance(buckets[0], dict):
        raise OrchestrationError("b2_key_must_be_single_bucket_scoped")
    if buckets[0].get("name") != expected_bucket:
        raise OrchestrationError("b2_key_bucket_scope_mismatch")
    if allowed.get("namePrefix") != B2_REQUIRED_PREFIX:
        raise OrchestrationError("b2_key_prefix_scope_mismatch")

    capabilities = allowed.get("capabilities")
    if not isinstance(capabilities, list) or any(not isinstance(item, str) for item in capabilities):
        raise OrchestrationError("b2_capabilities_invalid")
    capability_set = set(capabilities)
    if not B2_REQUIRED_CAPABILITIES.issubset(capability_set):
        raise OrchestrationError("b2_required_capabilities_missing")
    unexpected = capability_set - B2_ALLOWED_CAPABILITIES
    if unexpected:
        raise OrchestrationError("b2_key_capabilities_too_broad:" + ",".join(sorted(unexpected)))

    expiry_ms = _require_int(value.get("applicationKeyExpirationTimestamp"), "b2_key_expiration_timestamp")
    observed = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    expiry = datetime.fromtimestamp(expiry_ms / 1000, tz=timezone.utc)
    if expiry <= observed + timedelta(minutes=10):
        raise OrchestrationError("b2_key_expiry_too_soon")
    if expiry > observed + timedelta(hours=24):
        raise OrchestrationError("b2_key_expiry_exceeds_24h")

    return {
        "schema": "metaengine.compute.r1-b2-key-scope-check.h205f22.v1",
        "classification": "B2_RUNTIME_KEY_SCOPE_CHECK_NONAUTHORITATIVE",
        "account_scope_sha256": actual_account_hash,
        "bucket": expected_bucket,
        "name_prefix": B2_REQUIRED_PREFIX,
        "capabilities": sorted(capability_set),
        "expiration_timestamp": expiry.isoformat(),
        "s3_endpoint_host": parsed.hostname,
        "authorization_token_recorded": False,
        "application_key_recorded": False,
        "canonical": False,
        "authority_effect": False,
    }


def validate_provider_result(value: Any, expected_provider: str) -> dict[str, Any]:
    if expected_provider not in PROVIDER_OPERATOR:
        raise OrchestrationError("expected_provider_unsupported")
    if not isinstance(value, dict):
        raise OrchestrationError("provider_result_shape_invalid")
    if value.get("schema") != "metaengine.compute.r1-provider-replication-result.h205f22.v1":
        raise OrchestrationError("provider_result_schema_invalid")
    if value.get("classification") != "PROVIDER_REPLICATION_READBACK_CANDIDATE_NONAUTHORITATIVE":
        raise OrchestrationError("provider_result_classification_invalid")
    _verify_self_hash(value, "result_sha256", "provider_result")
    if any(value.get(field) is not False for field in ("canonical", "authority_effect", "r2_proven", "r3_proven", "persisted_seal_allowed")):
        raise OrchestrationError("provider_result_authority_boundary_invalid")
    provenance = value.get("provenance")
    if not isinstance(provenance, dict) or provenance.get("source_attestation_verified") is not False or provenance.get("source_attestation_required_before_authority") is not True:
        raise OrchestrationError("provider_result_provenance_boundary_invalid")

    target = value.get("target")
    cipher = value.get("ciphertext")
    if not isinstance(target, dict) or not isinstance(cipher, dict):
        raise OrchestrationError("provider_result_nested_shape_invalid")
    if target.get("provider_kind") != expected_provider or target.get("operator_class") != PROVIDER_OPERATOR[expected_provider]:
        raise OrchestrationError("provider_result_target_mismatch")
    cipher_sha = _require_sha256(cipher.get("sha256"), "provider_ciphertext_sha256")
    cipher_bytes = _require_int(cipher.get("bytes"), "provider_ciphertext_bytes")
    _require_text(cipher.get("version_id"), "provider_version_id", maximum=1024)

    readback = _validated_receipt(value.get("readback_receipt"))
    if readback.get("provider_kind") != expected_provider or readback.get("operator_class") != PROVIDER_OPERATOR[expected_provider]:
        raise OrchestrationError("provider_readback_identity_mismatch")
    if readback.get("readback", {}).get("status") != "VERIFIED":
        raise OrchestrationError("provider_readback_not_verified")
    if readback.get("retention", {}).get("grade") != "COMPLIANCE_NON_SHORTENABLE" or readback.get("retention", {}).get("strong_immutability") is not True:
        raise OrchestrationError("provider_readback_retention_not_strong")
    if readback.get("eligible_for_quorum_candidate") is not True:
        raise OrchestrationError("provider_readback_not_quorum_eligible")
    if any(readback.get(field) is not False for field in ("canonical", "authority_effect", "r2_proven", "r3_proven", "persisted_seal_allowed")):
        raise OrchestrationError("provider_readback_authority_boundary_invalid")
    obj = readback.get("object") or {}
    if obj.get("expected_sha256") != cipher_sha or obj.get("expected_bytes") != cipher_bytes:
        raise OrchestrationError("provider_result_readback_ciphertext_mismatch")
    if readback.get("domain_key") != target.get("domain_key"):
        raise OrchestrationError("provider_result_domain_mismatch")
    return value


def _validated_preflight(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema") != "metaengine.compute.r1-live-two-domain-preflight.h205f22.v1":
        raise OrchestrationError("preflight_schema_invalid")
    _verify_self_hash(value, "preflight_sha256", "preflight")
    if any(value.get(field) is not False for field in ("provider_execution_authorized", "source_attestation_verified", "canonical", "authority_effect", "r2_proven", "r3_proven", "persisted_seal_allowed")):
        raise OrchestrationError("preflight_authority_boundary_invalid")
    if value.get("source_attestation_required_before_authority") is not True:
        raise OrchestrationError("preflight_source_attestation_gate_missing")
    return value


def evaluate_results(aws_result: Any, b2_result: Any, preflight: Any) -> dict[str, Any]:
    aws = validate_provider_result(aws_result, "AWS_S3")
    b2 = validate_provider_result(b2_result, "BACKBLAZE_B2")
    source = _validated_preflight(preflight)

    if aws["ciphertext"]["sha256"] != b2["ciphertext"]["sha256"] or aws["ciphertext"]["bytes"] != b2["ciphertext"]["bytes"]:
        raise OrchestrationError("provider_ciphertext_identity_mismatch")
    quorum = evaluate_quorum([aws["readback_receipt"], b2["readback_receipt"]])
    if quorum.get("candidate_ready") is not True:
        raise OrchestrationError("two_domain_quorum_not_ready")
    if quorum.get("distinct_domains") != 2 or quorum.get("distinct_operator_classes") != 2 or quorum.get("distinct_provider_kinds") != 2:
        raise OrchestrationError("two_domain_independence_not_proven_as_candidate")
    if quorum.get("strong_immutability_domains") != 2:
        raise OrchestrationError("two_domain_strong_immutability_missing")

    core = {
        "schema": "metaengine.compute.r1-live-two-domain-orchestration-result.h205f22.v1",
        "classification": "TWO_DOMAIN_PROVIDER_READBACK_CANDIDATE_NONAUTHORITATIVE",
        "source": source["source"],
        "ciphertext": {
            "sha256": aws["ciphertext"]["sha256"],
            "bytes": aws["ciphertext"]["bytes"],
        },
        "provider_results": {
            "aws_result_sha256": aws["result_sha256"],
            "b2_result_sha256": b2["result_sha256"],
        },
        "quorum": quorum,
        "source_attestation_verified": False,
        "source_attestation_required_before_authority": True,
        "canonical": False,
        "authority_effect": False,
        "r2_proven": False,
        "r3_proven": False,
        "persisted_seal_allowed": False,
        "required_next": "VERIFY_DSSE_IN_TOTO_SIGSTORE_SOURCE_ATTESTATION_THEN_SUPERVISOR_INGEST_PROVIDER_EVIDENCE_AND_REEVALUATE_R2",
    }
    result = dict(core)
    result["orchestration_result_sha256"] = _sha256_json(core)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    pre = sub.add_parser("validate-preflight")
    pre.add_argument("--source-run", required=True)
    pre.add_argument("--artifacts", required=True)
    pre.add_argument("--aws-environment", required=True)
    pre.add_argument("--b2-environment", required=True)
    pre.add_argument("--source-run-id", required=True)
    pre.add_argument("--ciphertext-artifact-id", required=True)
    pre.add_argument("--envelope-artifact-id", required=True)
    pre.add_argument("--output", required=True)

    b2 = sub.add_parser("validate-b2-auth")
    b2.add_argument("--authorization", required=True)
    b2.add_argument("--expected-bucket", required=True)
    b2.add_argument("--expected-endpoint-host", required=True)
    b2.add_argument("--expected-account-scope-sha256", required=True)
    b2.add_argument("--output", required=True)

    provider = sub.add_parser("validate-provider-result")
    provider.add_argument("--provider", choices=sorted(PROVIDER_OPERATOR), required=True)
    provider.add_argument("--result", required=True)
    provider.add_argument("--output", required=True)

    quorum = sub.add_parser("evaluate-results")
    quorum.add_argument("--aws-result", required=True)
    quorum.add_argument("--b2-result", required=True)
    quorum.add_argument("--preflight", required=True)
    quorum.add_argument("--output", required=True)

    args = parser.parse_args(argv)
    try:
        if args.command == "validate-preflight":
            result = validate_preflight(
                source_run=_read_json(Path(args.source_run), "source_run"),
                artifacts=_read_json(Path(args.artifacts), "artifacts"),
                aws_environment=_read_json(Path(args.aws_environment), "aws_environment"),
                b2_environment=_read_json(Path(args.b2_environment), "b2_environment"),
                source_run_id=_require_int(args.source_run_id, "source_run_id"),
                ciphertext_artifact_id=_require_int(args.ciphertext_artifact_id, "ciphertext_artifact_id"),
                envelope_artifact_id=_require_int(args.envelope_artifact_id, "envelope_artifact_id"),
            )
        elif args.command == "validate-b2-auth":
            endpoint = _require_text(args.expected_endpoint_host, "expected_endpoint_host", maximum=255)
            result = validate_b2_authorization(
                _read_json(Path(args.authorization), "b2_authorization"),
                expected_bucket=_require_text(args.expected_bucket, "expected_bucket", maximum=255),
                expected_endpoint_host=endpoint,
                expected_account_scope_sha256=args.expected_account_scope_sha256,
            )
        elif args.command == "validate-provider-result":
            validated = validate_provider_result(_read_json(Path(args.result), "provider_result"), args.provider)
            result = {
                "schema": "metaengine.compute.r1-provider-result-validation.h205f22.v1",
                "provider_kind": args.provider,
                "result_sha256": validated["result_sha256"],
                "readback_receipt_sha256": validated["readback_receipt"]["receipt_sha256"],
                "canonical": False,
                "authority_effect": False,
            }
        else:
            result = evaluate_results(
                _read_json(Path(args.aws_result), "aws_result"),
                _read_json(Path(args.b2_result), "b2_result"),
                _read_json(Path(args.preflight), "preflight"),
            )
        _write_json(Path(args.output), result)
        return 0
    except OrchestrationError as exc:
        print(f"R1_LIVE_ORCHESTRATION_REJECTED:{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
