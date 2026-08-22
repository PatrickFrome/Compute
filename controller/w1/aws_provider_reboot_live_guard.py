#!/usr/bin/env python3
"""Fail-closed W1 live AWS boundary guard.

This module performs no network access, obtains no credentials, reboots no host, and
has no Supabase authority. It validates the GitHub environment protection shape and
constructs the exact AWS inline session policy used by the W1 provider controller.
All outputs are NON-AUTHORITATIVE preparation for a later explicitly approved live
preflight/reboot workflow.
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
INSTANCE_ID = re.compile(r"^i-[0-9a-f]+$")
AWS_ACCOUNT_ID = re.compile(r"^[0-9]{12}$")
AWS_REGION = re.compile(r"^[a-z]{2}(-gov)?-[a-z]+-[0-9]+$")


class LiveBoundaryError(RuntimeError):
    pass


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha_json(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def _read_json(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise LiveBoundaryError(f"{label}_invalid_json") from exc


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(_canonical(value) + b"\n")


def _safe_text(value: Any, field: str, *, maximum: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum:
        raise LiveBoundaryError(f"{field}_invalid")
    out = value.strip()
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in out):
        raise LiveBoundaryError(f"{field}_control_character")
    return out


def validate_environment(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("name") != ENVIRONMENT:
        raise LiveBoundaryError("environment_identity_mismatch")
    rules = value.get("protection_rules")
    if not isinstance(rules, list):
        raise LiveBoundaryError("environment_protection_rules_missing")
    reviewer_rules = [r for r in rules if isinstance(r, dict) and r.get("type") == "required_reviewers"]
    if len(reviewer_rules) != 1:
        raise LiveBoundaryError("environment_required_reviewers_missing")
    reviewers = reviewer_rules[0].get("reviewers")
    if not isinstance(reviewers, list) or not reviewers:
        raise LiveBoundaryError("environment_required_reviewers_empty")
    if reviewer_rules[0].get("prevent_self_review") is not True:
        raise LiveBoundaryError("environment_prevent_self_review_required")
    if not any(isinstance(r, dict) and r.get("type") == "branch_policy" for r in rules):
        raise LiveBoundaryError("environment_branch_policy_rule_missing")
    branch_policy = value.get("deployment_branch_policy")
    if not isinstance(branch_policy, dict):
        raise LiveBoundaryError("environment_branch_policy_missing")
    protected = branch_policy.get("protected_branches") is True
    custom = branch_policy.get("custom_branch_policies") is True
    if protected == custom:
        raise LiveBoundaryError("environment_branch_policy_invalid")

    core = {
        "schema": "metaengine.compute.w1-github-environment-preflight.h205f22.v1",
        "classification": "W1_GITHUB_ENVIRONMENT_PREFLIGHT_NONAUTHORITATIVE",
        "environment": ENVIRONMENT,
        "required_reviewer_count": len(reviewers),
        "prevent_self_review": True,
        "branch_policy": {
            "protected_branches": protected,
            "custom_branch_policies": custom,
        },
        "credential_release_requires_environment_approval": True,
        "provider_execution_authorized": False,
        "persistent_worker_proof": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }
    out = dict(core)
    out["receipt_sha256"] = _sha_json(core)
    return out


def _partition(region: str) -> str:
    if region.startswith("us-gov-"):
        return "aws-us-gov"
    if region.startswith("cn-"):
        return "aws-cn"
    return "aws"


def build_session_policy(*, instance_id: str, account_id: str, region: str) -> dict[str, Any]:
    instance_id = _safe_text(instance_id, "instance_id", maximum=64)
    account_id = _safe_text(account_id, "account_id", maximum=12)
    region = _safe_text(region, "region", maximum=64)
    if INSTANCE_ID.fullmatch(instance_id) is None:
        raise LiveBoundaryError("instance_id_invalid")
    if AWS_ACCOUNT_ID.fullmatch(account_id) is None:
        raise LiveBoundaryError("account_id_invalid")
    if AWS_REGION.fullmatch(region) is None:
        raise LiveBoundaryError("region_invalid")

    instance_arn = f"arn:{_partition(region)}:ec2:{region}:{account_id}:instance/{instance_id}"
    policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "ReadW1HostSurface",
                "Effect": "Allow",
                "Action": [
                    "ec2:DescribeInstances",
                    "ec2:DescribeVolumes",
                    "ec2:DescribeSecurityGroups",
                ],
                "Resource": "*",
            },
            {
                "Sid": "RebootExactTaggedW1Host",
                "Effect": "Allow",
                "Action": "ec2:RebootInstances",
                "Resource": instance_arn,
                "Condition": {
                    "StringEquals": {
                        "aws:ResourceTag/metaengine:project": "H205F22",
                        "aws:ResourceTag/metaengine:milestone": "W1_PERSISTENT_LINUX_WORKER_SAFETY",
                        "aws:ResourceTag/metaengine:authority": "noncanonical-worker",
                        "aws:ResourceTag/metaengine:execution_tier": "persistent-host",
                    }
                },
            },
            {
                "Sid": "ReadProviderAuditEvent",
                "Effect": "Allow",
                "Action": "cloudtrail:LookupEvents",
                "Resource": "*",
            },
        ],
    }
    core = {
        "schema": "metaengine.compute.w1-aws-session-boundary.h205f22.v1",
        "classification": "W1_EXACT_INSTANCE_SESSION_POLICY_NONAUTHORITATIVE",
        "instance_id": instance_id,
        "instance_arn": instance_arn,
        "account_id": account_id,
        "region": region,
        "session_policy": policy,
        "credential_export_mode": "STEP_OUTPUTS_ONLY",
        "static_aws_keys_allowed": False,
        "run_instances_allowed": False,
        "terminate_instances_allowed": False,
        "stop_instances_allowed": False,
        "security_group_mutation_allowed": False,
        "ssm_session_allowed": False,
        "provider_execution_authorized": False,
        "persistent_worker_proof": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }
    out = dict(core)
    out["receipt_sha256"] = _sha_json(core)
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    env = sub.add_parser("validate-environment")
    env.add_argument("--input", required=True)
    env.add_argument("--output", required=True)

    policy = sub.add_parser("build-session-policy")
    policy.add_argument("--instance-id", required=True)
    policy.add_argument("--account-id", required=True)
    policy.add_argument("--region", required=True)
    policy.add_argument("--output", required=True)

    args = parser.parse_args(argv)
    try:
        if args.command == "validate-environment":
            result = validate_environment(_read_json(Path(args.input), "environment"))
        else:
            result = build_session_policy(
                instance_id=args.instance_id,
                account_id=args.account_id,
                region=args.region,
            )
        _write_json(Path(args.output), result)
        return 0
    except LiveBoundaryError as exc:
        print(f"W1_LIVE_BOUNDARY_REJECTED:{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
