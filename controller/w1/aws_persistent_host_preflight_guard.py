#!/usr/bin/env python3
"""Fail-closed W1 protected-host identity boundary for preflight-only AWS checks.

This module performs no network access, obtains no credentials, calls no provider API,
and writes no Supabase state. It binds a protected GitHub-environment host identity to
an exact EC2 instance, W1 worker id, W1 implementation SHA, AWS account and region,
then constructs the narrow session policy used by the preflight-only workflow.

The resulting receipts are deliberately NON-AUTHORITATIVE. A successful DryRun proves
only that the reviewed short-lived session could call RebootInstances on the exact,
correctly tagged host; it does not prove that a reboot occurred, that the worker is
persistent, or that W1/C1 is verified.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

ENVIRONMENT = "w1-persistent-host-proof"
BOUNDARY_SCHEMA = "metaengine.compute.w1-protected-host-session-boundary.h205f22.v1"
BINDING_SCHEMA = "metaengine.compute.w1-protected-host-preflight-binding.h205f22.v1"
BINDING_CLASSIFICATION = "LIVE_AWS_OIDC_PROTECTED_HOST_PREFLIGHT_ONLY"
ENV_RECEIPT_SCHEMA = "metaengine.compute.w1-github-environment-preflight.h205f22.v1"
ENV_RECEIPT_CLASSIFICATION = "W1_GITHUB_ENVIRONMENT_PREFLIGHT_NONAUTHORITATIVE"
PREFLIGHT_SCHEMA = "metaengine.compute.w1-aws-preflight.h205f22.v1"

INSTANCE_ID = re.compile(r"^i-[0-9a-f]+$")
WORKER_ID = re.compile(r"^[A-Za-z0-9._:-]{3,160}$")
SHA40 = re.compile(r"^[0-9a-f]{40}$")
AWS_ACCOUNT_ID = re.compile(r"^[0-9]{12}$")
AWS_REGION = re.compile(r"^[a-z]{2}(-gov)?-[a-z]+-[0-9]+$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")


class ProtectedHostPreflightError(RuntimeError):
    pass


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha_json(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def _read_json(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise ProtectedHostPreflightError(f"{label}_invalid_json") from exc


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(_canonical(value) + b"\n")


def _safe_text(value: Any, field: str, *, maximum: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum:
        raise ProtectedHostPreflightError(f"{field}_invalid")
    result = value.strip()
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in result):
        raise ProtectedHostPreflightError(f"{field}_control_character")
    return result


def _require_self_hash(value: Any, *, schema: str, hash_field: str, label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema") != schema:
        raise ProtectedHostPreflightError(f"{label}_schema_invalid")
    claimed = value.get(hash_field)
    if not isinstance(claimed, str) or SHA256.fullmatch(claimed) is None:
        raise ProtectedHostPreflightError(f"{label}_{hash_field}_invalid")
    core = dict(value)
    core.pop(hash_field, None)
    if _sha_json(core) != claimed:
        raise ProtectedHostPreflightError(f"{label}_{hash_field}_mismatch")
    return value


def _partition(region: str) -> str:
    if region.startswith("us-gov-"):
        return "aws-us-gov"
    if region.startswith("cn-"):
        return "aws-cn"
    return "aws"


def build_session_boundary(
    *, instance_id: str, worker_id: str, w1_sha: str, account_id: str, region: str
) -> dict[str, Any]:
    instance_id = _safe_text(instance_id, "instance_id", maximum=64)
    worker_id = _safe_text(worker_id, "worker_id", maximum=160)
    w1_sha = _safe_text(w1_sha, "w1_sha", maximum=40)
    account_id = _safe_text(account_id, "account_id", maximum=12)
    region = _safe_text(region, "region", maximum=64)

    if INSTANCE_ID.fullmatch(instance_id) is None:
        raise ProtectedHostPreflightError("instance_id_invalid")
    if WORKER_ID.fullmatch(worker_id) is None:
        raise ProtectedHostPreflightError("worker_id_invalid")
    if SHA40.fullmatch(w1_sha) is None:
        raise ProtectedHostPreflightError("w1_sha_invalid")
    if AWS_ACCOUNT_ID.fullmatch(account_id) is None:
        raise ProtectedHostPreflightError("account_id_invalid")
    if AWS_REGION.fullmatch(region) is None:
        raise ProtectedHostPreflightError("region_invalid")

    instance_arn = f"arn:{_partition(region)}:ec2:{region}:{account_id}:instance/{instance_id}"
    required_tags = {
        "metaengine:project": "H205F22",
        "metaengine:milestone": "W1_PERSISTENT_LINUX_WORKER_SAFETY",
        "metaengine:worker_id": worker_id,
        "metaengine:github_sha": w1_sha,
        "metaengine:authority": "noncanonical-worker",
        "metaengine:execution_tier": "persistent-host",
    }
    condition = {f"aws:ResourceTag/{key}": value for key, value in required_tags.items()}
    policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "ReadProtectedW1HostSurface",
                "Effect": "Allow",
                "Action": [
                    "ec2:DescribeInstances",
                    "ec2:DescribeVolumes",
                    "ec2:DescribeSecurityGroups",
                ],
                "Resource": "*",
            },
            {
                "Sid": "DryRunExactProtectedW1Host",
                "Effect": "Allow",
                "Action": "ec2:RebootInstances",
                "Resource": instance_arn,
                "Condition": {"StringEquals": condition},
            },
        ],
    }
    core = {
        "schema": BOUNDARY_SCHEMA,
        "classification": "W1_PROTECTED_HOST_PREFLIGHT_SESSION_BOUNDARY_NONAUTHORITATIVE",
        "environment": ENVIRONMENT,
        "instance_id": instance_id,
        "worker_id": worker_id,
        "w1_sha": w1_sha,
        "account_id": account_id,
        "region": region,
        "instance_arn": instance_arn,
        "required_instance_tags": required_tags,
        "session_policy": policy,
        "credential_export_mode": "STEP_OUTPUTS_ONLY",
        "static_aws_keys_allowed": False,
        "run_instances_allowed": False,
        "real_reboot_requested": False,
        "dry_run_required": True,
        "provider_execution_authorized": False,
        "persistent_worker_proof": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }
    result = dict(core)
    result["receipt_sha256"] = _sha_json(core)
    return result


def validate_environment_receipt(value: Any) -> dict[str, Any]:
    receipt = _require_self_hash(
        value, schema=ENV_RECEIPT_SCHEMA, hash_field="receipt_sha256", label="environment_receipt"
    )
    if receipt.get("classification") != ENV_RECEIPT_CLASSIFICATION:
        raise ProtectedHostPreflightError("environment_receipt_classification_invalid")
    if receipt.get("environment") != ENVIRONMENT:
        raise ProtectedHostPreflightError("environment_receipt_identity_mismatch")
    if receipt.get("prevent_self_review") is not True:
        raise ProtectedHostPreflightError("environment_receipt_self_review_boundary_invalid")
    if receipt.get("credential_release_requires_environment_approval") is not True:
        raise ProtectedHostPreflightError("environment_receipt_approval_boundary_invalid")
    if any(receipt.get(field) is not False for field in (
        "provider_execution_authorized", "persistent_worker_proof", "w1_verified", "canonical", "authority_effect"
    )):
        raise ProtectedHostPreflightError("environment_receipt_authority_boundary_invalid")
    return receipt


def validate_boundary(value: Any) -> dict[str, Any]:
    boundary = _require_self_hash(value, schema=BOUNDARY_SCHEMA, hash_field="receipt_sha256", label="session_boundary")
    expected = build_session_boundary(
        instance_id=str(boundary.get("instance_id") or ""),
        worker_id=str(boundary.get("worker_id") or ""),
        w1_sha=str(boundary.get("w1_sha") or ""),
        account_id=str(boundary.get("account_id") or ""),
        region=str(boundary.get("region") or ""),
    )
    if boundary != expected:
        raise ProtectedHostPreflightError("session_boundary_not_exact_contract")
    return boundary


def finalize_preflight_binding(
    *, environment_receipt: Any, session_boundary: Any, preflight_summary: Any, dry_run_result: str
) -> dict[str, Any]:
    environment = validate_environment_receipt(environment_receipt)
    boundary = validate_boundary(session_boundary)
    if not isinstance(preflight_summary, dict) or preflight_summary.get("schema") != PREFLIGHT_SCHEMA:
        raise ProtectedHostPreflightError("preflight_summary_schema_invalid")
    if preflight_summary.get("authority_effect") is not False or preflight_summary.get("canonical") is not False:
        raise ProtectedHostPreflightError("preflight_summary_authority_boundary_invalid")
    if preflight_summary.get("instance_id") != boundary["instance_id"]:
        raise ProtectedHostPreflightError("preflight_instance_identity_mismatch")
    if preflight_summary.get("worker_id") != boundary["worker_id"]:
        raise ProtectedHostPreflightError("preflight_worker_identity_mismatch")
    if preflight_summary.get("worker_bundle_github_sha") != boundary["w1_sha"]:
        raise ProtectedHostPreflightError("preflight_w1_sha_mismatch")
    if dry_run_result != "DryRunOperation":
        raise ProtectedHostPreflightError("reboot_permission_dry_run_not_proven")

    core = {
        "schema": BINDING_SCHEMA,
        "classification": BINDING_CLASSIFICATION,
        "environment_receipt_sha256": environment["receipt_sha256"],
        "session_boundary_receipt_sha256": boundary["receipt_sha256"],
        "instance_id": boundary["instance_id"],
        "worker_id": boundary["worker_id"],
        "w1_sha": boundary["w1_sha"],
        "account_id": boundary["account_id"],
        "region": boundary["region"],
        "preflight_summary_sha256": _sha_json(preflight_summary),
        "host_surface_validated": True,
        "reboot_permission_dry_run": "DryRunOperation",
        "real_reboot_requested": False,
        "real_reboot_performed": False,
        "backend_binding_created": False,
        "persistent_worker_proof": False,
        "w1_verified": False,
        "canonical_c1_promoted": False,
        "canonical": False,
        "authority_effect": False,
        "required_next": "SUPERVISOR_REVIEW_PREFLIGHT_EVIDENCE_BEFORE_ANY_REAL_REBOOT",
    }
    result = dict(core)
    result["receipt_sha256"] = _sha_json(core)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    build = sub.add_parser("build-session-boundary")
    build.add_argument("--instance-id", required=True)
    build.add_argument("--worker-id", required=True)
    build.add_argument("--w1-sha", required=True)
    build.add_argument("--account-id", required=True)
    build.add_argument("--region", required=True)
    build.add_argument("--output", required=True)

    final = sub.add_parser("finalize")
    final.add_argument("--environment-receipt", required=True)
    final.add_argument("--session-boundary", required=True)
    final.add_argument("--preflight-summary", required=True)
    final.add_argument("--dry-run-result", required=True)
    final.add_argument("--output", required=True)

    args = parser.parse_args(argv)
    try:
        if args.command == "build-session-boundary":
            result = build_session_boundary(
                instance_id=args.instance_id,
                worker_id=args.worker_id,
                w1_sha=args.w1_sha,
                account_id=args.account_id,
                region=args.region,
            )
        else:
            result = finalize_preflight_binding(
                environment_receipt=_read_json(Path(args.environment_receipt), "environment_receipt"),
                session_boundary=_read_json(Path(args.session_boundary), "session_boundary"),
                preflight_summary=_read_json(Path(args.preflight_summary), "preflight_summary"),
                dry_run_result=args.dry_run_result,
            )
        _write_json(Path(args.output), result)
        return 0
    except ProtectedHostPreflightError as exc:
        print(f"W1_PROTECTED_HOST_PREFLIGHT_REJECTED:{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
