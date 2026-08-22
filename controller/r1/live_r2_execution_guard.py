#!/usr/bin/env python3
"""Fail-closed guard for the live R1 R2 execution chain.

This module bridges already-verified source/provider workflow runs into the
credential-separated STEP08 -> provider materialization -> STEP09A -> STEP09B
execution path. It never performs provider calls or database writes itself.

Authority boundary:
- run/artifact/environment preflight is NON-AUTHORITATIVE;
- AWS materialization proves only that bytes were freshly read from the exact
  version pinned by the existing provider result;
- canonical roadmap R2, R1 sealing, R3, and persisted seals remain out of scope.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from controller.r1.idempotent_exact_ciphertext_replication import (
    validate_persisted_provider_controller_evidence,
)
from controller.r1.live_two_domain_orchestration_guard import validate_provider_result

EXPECTED_REPOSITORY_ID = 1341371143
EXPECTED_REPOSITORY = "PatrickFrome/Compute"
EXPECTED_BRANCH = "main"
SOURCE_WORKFLOW_PATH = ".github/workflows/r1-live-recovery-source.yml"
PROVIDER_WORKFLOW_PATH = ".github/workflows/r1-live-two-domain-orchestration.yml"
AWS_ENVIRONMENT = "r1-aws-durability-proof"
DB_ENVIRONMENT = "r1-supervisor-r2-db-ingestion"

SOURCE_ARTIFACTS = (
    "r1-source-environment-readiness.json",
    "r1-source-environment-approval.json",
    "r1-recovery-ciphertext.age",
    "r1-recovery-envelope-receipt.json",
    "r1-recovery-source-predicate.json",
    "r1-recovery-source-attestation.sigstore.jsonl",
    "r1-recovery-source-verification.json",
)
PROVIDER_ARTIFACTS = (
    "r1-live-preflight.json",
    "r1-verified-source-handoff.json",
    "r1-aws-provider-readiness.json",
    "r1-aws-provider-result.json",
    "r1-b2-provider-readiness.json",
    "r1-b2-provider-result.json",
    "r1-two-domain-quorum-candidate.json",
)

SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
ARTIFACT_DIGEST = re.compile(r"^sha256:([0-9a-f]{64})$")
AWS_ACCOUNT = re.compile(r"^[0-9]{12}$")


class LiveR2ExecutionError(RuntimeError):
    pass


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha_json(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def _read_json(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise LiveR2ExecutionError(f"{label}_invalid_json") from exc


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(_canonical(value) + b"\n")


def _require_text(value: Any, field: str, maximum: int = 2048) -> str:
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum:
        raise LiveR2ExecutionError(f"{field}_invalid")
    return value.strip()


def _require_int(value: Any, field: str) -> int:
    if isinstance(value, bool):
        raise LiveR2ExecutionError(f"{field}_invalid")
    try:
        out = int(value)
    except (TypeError, ValueError) as exc:
        raise LiveR2ExecutionError(f"{field}_invalid") from exc
    if out < 1:
        raise LiveR2ExecutionError(f"{field}_invalid")
    return out


def _require_sha256(value: Any, field: str) -> str:
    if not isinstance(value, str) or SHA256.fullmatch(value) is None:
        raise LiveR2ExecutionError(f"{field}_invalid")
    return value


def _parse_time(value: Any, field: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise LiveR2ExecutionError(f"{field}_missing")
    try:
        dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError as exc:
        raise LiveR2ExecutionError(f"{field}_invalid") from exc
    if dt.tzinfo is None:
        raise LiveR2ExecutionError(f"{field}_timezone_required")
    return dt.astimezone(timezone.utc)


def _validate_run(value: Any, *, run_id: int, workflow_path: str, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise LiveR2ExecutionError(f"{label}_run_shape_invalid")
    if value.get("id") != run_id:
        raise LiveR2ExecutionError(f"{label}_run_id_mismatch")
    repo = value.get("repository")
    head_repo = value.get("head_repository")
    if not isinstance(repo, dict) or repo.get("id") != EXPECTED_REPOSITORY_ID or repo.get("full_name") != EXPECTED_REPOSITORY:
        raise LiveR2ExecutionError(f"{label}_repository_mismatch")
    if not isinstance(head_repo, dict) or head_repo.get("id") != EXPECTED_REPOSITORY_ID or head_repo.get("full_name") != EXPECTED_REPOSITORY:
        raise LiveR2ExecutionError(f"{label}_head_repository_mismatch")
    if value.get("path") != workflow_path:
        raise LiveR2ExecutionError(f"{label}_workflow_path_mismatch")
    if value.get("head_branch") != EXPECTED_BRANCH:
        raise LiveR2ExecutionError(f"{label}_branch_mismatch")
    if value.get("event") != "workflow_dispatch":
        raise LiveR2ExecutionError(f"{label}_event_must_be_workflow_dispatch")
    if value.get("status") != "completed" or value.get("conclusion") != "success":
        raise LiveR2ExecutionError(f"{label}_run_not_successful")
    head_sha = _require_text(value.get("head_sha"), f"{label}_head_sha", maximum=40)
    if SHA40.fullmatch(head_sha) is None:
        raise LiveR2ExecutionError(f"{label}_head_sha_invalid")
    return {
        "run_id": run_id,
        "workflow_path": workflow_path,
        "head_sha": head_sha,
        "branch": EXPECTED_BRANCH,
        "repository": EXPECTED_REPOSITORY,
        "repository_id": EXPECTED_REPOSITORY_ID,
    }


def _artifact_set(artifacts: Any, run: dict[str, Any], required: tuple[str, ...], label: str) -> dict[str, Any]:
    if not isinstance(artifacts, dict) or not isinstance(artifacts.get("artifacts"), list):
        raise LiveR2ExecutionError(f"{label}_artifacts_shape_invalid")
    result: dict[str, Any] = {}
    for name in required:
        matches = [a for a in artifacts["artifacts"] if isinstance(a, dict) and a.get("name") == name]
        if len(matches) != 1:
            raise LiveR2ExecutionError(f"{label}_artifact_not_unique:{name}")
        item = matches[0]
        if item.get("expired") is not False:
            raise LiveR2ExecutionError(f"{label}_artifact_expired:{name}")
        artifact_id = _require_int(item.get("id"), f"{label}_artifact_id:{name}")
        size = _require_int(item.get("size_in_bytes"), f"{label}_artifact_size:{name}")
        digest = _require_text(item.get("digest"), f"{label}_artifact_digest:{name}", maximum=80)
        match = ARTIFACT_DIGEST.fullmatch(digest)
        if match is None:
            raise LiveR2ExecutionError(f"{label}_artifact_digest_invalid:{name}")
        workflow_run = item.get("workflow_run")
        if not isinstance(workflow_run, dict):
            raise LiveR2ExecutionError(f"{label}_artifact_workflow_run_missing:{name}")
        expected = {
            "id": run["id"],
            "repository_id": EXPECTED_REPOSITORY_ID,
            "head_repository_id": EXPECTED_REPOSITORY_ID,
            "head_branch": EXPECTED_BRANCH,
            "head_sha": run["head_sha"],
        }
        for key, expected_value in expected.items():
            if workflow_run.get(key) != expected_value:
                raise LiveR2ExecutionError(f"{label}_artifact_binding_mismatch:{name}:{key}")
        result[name] = {"id": artifact_id, "size_in_bytes": size, "digest_sha256": match.group(1)}
    return result


def _validate_environment(value: Any, expected_name: str) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("name") != expected_name:
        raise LiveR2ExecutionError(f"environment_invalid:{expected_name}")
    rules = value.get("protection_rules")
    if not isinstance(rules, list):
        raise LiveR2ExecutionError(f"environment_protection_rules_missing:{expected_name}")
    reviewer_rules = [r for r in rules if isinstance(r, dict) and r.get("type") == "required_reviewers"]
    if len(reviewer_rules) != 1:
        raise LiveR2ExecutionError(f"environment_required_reviewers_missing:{expected_name}")
    reviewers = reviewer_rules[0].get("reviewers")
    if not isinstance(reviewers, list) or not reviewers:
        raise LiveR2ExecutionError(f"environment_required_reviewers_empty:{expected_name}")
    if reviewer_rules[0].get("prevent_self_review") is not True:
        raise LiveR2ExecutionError(f"environment_prevent_self_review_required:{expected_name}")
    branch_policy = value.get("deployment_branch_policy")
    if not isinstance(branch_policy, dict):
        raise LiveR2ExecutionError(f"environment_branch_policy_missing:{expected_name}")
    protected = branch_policy.get("protected_branches") is True
    custom = branch_policy.get("custom_branch_policies") is True
    if protected == custom:
        raise LiveR2ExecutionError(f"environment_branch_policy_invalid:{expected_name}")
    if not any(isinstance(r, dict) and r.get("type") == "branch_policy" for r in rules):
        raise LiveR2ExecutionError(f"environment_branch_policy_rule_missing:{expected_name}")
    return {
        "name": expected_name,
        "required_reviewer_count": len(reviewers),
        "prevent_self_review": True,
        "branch_policy": {"protected_branches": protected, "custom_branch_policies": custom},
    }


def build_preflight(*, source_run: Any, source_artifacts: Any, provider_run: Any, provider_artifacts: Any,
                    aws_environment: Any, db_environment: Any, source_run_id: int, provider_run_id: int) -> dict[str, Any]:
    source = _validate_run(source_run, run_id=source_run_id, workflow_path=SOURCE_WORKFLOW_PATH, label="source")
    provider = _validate_run(provider_run, run_id=provider_run_id, workflow_path=PROVIDER_WORKFLOW_PATH, label="provider")
    source_set = _artifact_set(source_artifacts, source_run, SOURCE_ARTIFACTS, "source")
    provider_set = _artifact_set(provider_artifacts, provider_run, PROVIDER_ARTIFACTS, "provider")
    aws_env = _validate_environment(aws_environment, AWS_ENVIRONMENT)
    db_env = _validate_environment(db_environment, DB_ENVIRONMENT)
    core = {
        "schema": "metaengine.compute.r1-live-r2-execution-preflight.h205f22.v1",
        "classification": "LIVE_R2_EXECUTION_PREFLIGHT_NONAUTHORITATIVE",
        "source": source,
        "provider": provider,
        "artifacts": {"source": source_set, "provider": provider_set},
        "environments": {"aws_materialization": aws_env, "database_ingestion": db_env},
        "artifact_content_validation_required": True,
        "fresh_provider_materialization_required": True,
        "fresh_trusted_root_required": True,
        "database_write_authorized": False,
        "canonical": False,
        "authority_effect": False,
        "r2_proven": False,
        "r3_proven": False,
        "persisted_seal_allowed": False,
    }
    out = dict(core)
    out["preflight_sha256"] = _sha_json(core)
    return out


def _object_arn(bucket: str, key: str) -> str:
    if any(ch in bucket for ch in ('"', "'", " ", "\n", "\r", "\t")):
        raise LiveR2ExecutionError("aws_bucket_invalid")
    if not key or any(ch in key for ch in ("\n", "\r")):
        raise LiveR2ExecutionError("aws_object_key_invalid")
    return f"arn:aws:s3:::{bucket}/{key}"


def build_aws_materialization_plan(*, provider_result: Any, expected_bucket: str, expected_domain_key: str,
                                   expected_account_scope_sha256: str, expected_account_id: str,
                                   expected_region: str) -> dict[str, Any]:
    result = validate_persisted_provider_controller_evidence(provider_result)
    validate_provider_result(result, "AWS_S3")
    bucket = _require_text(expected_bucket, "expected_bucket", maximum=255)
    domain_key = _require_text(expected_domain_key, "expected_domain_key", maximum=160)
    account_scope = _require_sha256(expected_account_scope_sha256, "expected_account_scope_sha256")
    account_id = _require_text(expected_account_id, "expected_account_id", maximum=12)
    if AWS_ACCOUNT.fullmatch(account_id) is None:
        raise LiveR2ExecutionError("expected_account_id_invalid")
    region = _require_text(expected_region, "expected_region", maximum=64)
    target = result["target"]
    evidence = result["provider_controller_evidence"]
    if target.get("domain_key") != domain_key:
        raise LiveR2ExecutionError("aws_domain_key_mismatch")
    if target.get("account_scope_sha256") != account_scope:
        raise LiveR2ExecutionError("aws_account_scope_mismatch")
    if evidence.get("bucket") != bucket:
        raise LiveR2ExecutionError("aws_bucket_mismatch")
    key = _require_text(evidence.get("key"), "aws_key", maximum=2048)
    version_id = _require_text(evidence.get("version_id"), "aws_version_id", maximum=1024)
    if result.get("ciphertext", {}).get("key") != key or result.get("ciphertext", {}).get("version_id") != version_id:
        raise LiveR2ExecutionError("aws_provider_result_locator_mismatch")
    resource = _object_arn(bucket, key)
    policy = {
        "Version": "2012-10-17",
        "Statement": [
            {"Sid": "ReadExactRecoveryVersion", "Effect": "Allow",
             "Action": ["s3:GetObjectVersion", "s3:GetObjectRetention"], "Resource": resource},
            {"Sid": "DenyRecoveryMutation", "Effect": "Deny",
             "Action": ["s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion",
                        "s3:PutObjectRetention", "s3:PutObjectLegalHold"], "Resource": resource},
        ],
    }
    core = {
        "schema": "metaengine.compute.r1-aws-authority-materialization-plan.h205f22.v1",
        "classification": "AWS_VERSION_PINNED_READ_ONLY_MATERIALIZATION_PLAN_NONAUTHORITATIVE",
        "provider_result_sha256": result["result_sha256"],
        "bucket": bucket,
        "key": key,
        "version_id": version_id,
        "region": region,
        "expected_bucket_owner": account_id,
        "ciphertext_sha256": result["ciphertext"]["sha256"],
        "ciphertext_bytes": result["ciphertext"]["bytes"],
        "session_policy": policy,
        "provider_write_allowed": False,
        "database_credential_present": False,
        "authority_effect": False,
        "r2_proven": False,
        "persisted_seal_allowed": False,
    }
    out = dict(core)
    out["plan_sha256"] = _sha_json(core)
    return out


def _hash_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    total = 0
    try:
        with path.open("rb") as handle:
            while True:
                chunk = handle.read(1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
                total += len(chunk)
    except OSError as exc:
        raise LiveR2ExecutionError("materialized_ciphertext_unavailable") from exc
    return digest.hexdigest(), total


def validate_aws_materialized(*, provider_result: Any, plan: Any, get_response: Any, retention_response: Any,
                              materialized_path: Path, now: datetime | None = None) -> dict[str, Any]:
    result = validate_persisted_provider_controller_evidence(provider_result)
    validate_provider_result(result, "AWS_S3")
    if not isinstance(plan, dict) or plan.get("schema") != "metaengine.compute.r1-aws-authority-materialization-plan.h205f22.v1":
        raise LiveR2ExecutionError("aws_materialization_plan_invalid")
    plan_sha = _require_sha256(plan.get("plan_sha256"), "plan_sha256")
    core_plan = dict(plan)
    core_plan.pop("plan_sha256", None)
    if _sha_json(core_plan) != plan_sha:
        raise LiveR2ExecutionError("aws_materialization_plan_hash_mismatch")
    if plan.get("provider_result_sha256") != result["result_sha256"]:
        raise LiveR2ExecutionError("aws_materialization_plan_provider_mismatch")
    if not isinstance(get_response, dict) or not isinstance(retention_response, dict):
        raise LiveR2ExecutionError("aws_materialization_response_invalid")
    if get_response.get("VersionId") != plan.get("version_id"):
        raise LiveR2ExecutionError("aws_materialized_version_mismatch")
    if get_response.get("ContentLength") != plan.get("ciphertext_bytes"):
        raise LiveR2ExecutionError("aws_materialized_content_length_mismatch")
    metadata = get_response.get("Metadata")
    if not isinstance(metadata, dict) or set(metadata) != {"metaengine-sha256", "metaengine-contract"}:
        raise LiveR2ExecutionError("aws_materialized_metadata_invalid")
    if metadata.get("metaengine-sha256") != plan.get("ciphertext_sha256") or metadata.get("metaengine-contract") != "h205f22-r1-v1":
        raise LiveR2ExecutionError("aws_materialized_metadata_mismatch")
    retention = retention_response.get("Retention")
    if not isinstance(retention, dict) or str(retention.get("Mode") or "").upper() != "COMPLIANCE":
        raise LiveR2ExecutionError("aws_materialized_retention_not_compliance")
    retain_until = _parse_time(retention.get("RetainUntilDate"), "aws_materialized_retain_until")
    observed = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    if retain_until <= observed:
        raise LiveR2ExecutionError("aws_materialized_retention_expired")
    original_until = _parse_time(result["readback_receipt"]["retention"]["retain_until"], "provider_result_retain_until")
    if retain_until < original_until:
        raise LiveR2ExecutionError("aws_materialized_retention_shortened")
    observed_sha, observed_bytes = _hash_file(materialized_path)
    if observed_sha != plan.get("ciphertext_sha256") or observed_bytes != plan.get("ciphertext_bytes"):
        raise LiveR2ExecutionError("aws_materialized_ciphertext_identity_mismatch")
    body = {
        "schema": "metaengine.compute.r1-aws-authority-materialization-receipt.h205f22.v1",
        "classification": "VERSION_PINNED_PROVIDER_CIPHERTEXT_MATERIALIZATION_NONAUTHORITATIVE",
        "provider_result_sha256": result["result_sha256"],
        "plan_sha256": plan_sha,
        "bucket": plan["bucket"],
        "key": plan["key"],
        "version_id": plan["version_id"],
        "ciphertext_sha256": observed_sha,
        "ciphertext_bytes": observed_bytes,
        "retention": {"mode": "COMPLIANCE", "retain_until": retain_until.isoformat()},
        "version_pinned_provider_read_performed": True,
        "local_sha256_recomputed": True,
        "provider_write_performed": False,
        "database_credential_present": False,
        "source_attestation_reverified": False,
        "required_next": "STEP09A_FRESH_TRUSTED_ROOT_OFFLINE_BUNDLE_REVERIFICATION",
        "canonical": False,
        "authority_effect": False,
        "r2_proven": False,
        "r3_proven": False,
        "persisted_seal_allowed": False,
    }
    out = dict(body)
    out["receipt_sha256"] = _sha_json(body)
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    pre = sub.add_parser("preflight")
    for arg in ("source-run", "source-artifacts", "provider-run", "provider-artifacts", "aws-environment",
                "db-environment", "source-run-id", "provider-run-id", "output"):
        pre.add_argument("--" + arg, required=True)
    plan = sub.add_parser("build-aws-plan")
    for arg in ("provider-result", "expected-bucket", "expected-domain-key", "expected-account-scope-sha256",
                "expected-account-id", "expected-region", "output"):
        plan.add_argument("--" + arg, required=True)
    materialized = sub.add_parser("validate-aws-materialized")
    for arg in ("provider-result", "plan", "get-response", "retention-response", "ciphertext", "output"):
        materialized.add_argument("--" + arg, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "preflight":
            result = build_preflight(
                source_run=_read_json(Path(args.source_run), "source_run"),
                source_artifacts=_read_json(Path(args.source_artifacts), "source_artifacts"),
                provider_run=_read_json(Path(args.provider_run), "provider_run"),
                provider_artifacts=_read_json(Path(args.provider_artifacts), "provider_artifacts"),
                aws_environment=_read_json(Path(args.aws_environment), "aws_environment"),
                db_environment=_read_json(Path(args.db_environment), "db_environment"),
                source_run_id=_require_int(args.source_run_id, "source_run_id"),
                provider_run_id=_require_int(args.provider_run_id, "provider_run_id"),
            )
        elif args.command == "build-aws-plan":
            result = build_aws_materialization_plan(
                provider_result=_read_json(Path(args.provider_result), "provider_result"),
                expected_bucket=args.expected_bucket,
                expected_domain_key=args.expected_domain_key,
                expected_account_scope_sha256=args.expected_account_scope_sha256,
                expected_account_id=args.expected_account_id,
                expected_region=args.expected_region,
            )
        else:
            result = validate_aws_materialized(
                provider_result=_read_json(Path(args.provider_result), "provider_result"),
                plan=_read_json(Path(args.plan), "materialization_plan"),
                get_response=_read_json(Path(args.get_response), "get_response"),
                retention_response=_read_json(Path(args.retention_response), "retention_response"),
                materialized_path=Path(args.ciphertext),
            )
        _write_json(Path(args.output), result)
        return 0
    except Exception as exc:
        message = str(exc) if isinstance(exc, LiveR2ExecutionError) else f"dependency_validation_failed:{exc.__class__.__name__}:{exc}"
        print(f"R1_LIVE_R2_EXECUTION_REJECTED:{message}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
