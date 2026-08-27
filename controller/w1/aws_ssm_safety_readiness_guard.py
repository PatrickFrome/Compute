#!/usr/bin/env python3
"""Read-only external readiness compositor for the first W1 SSM live cycle.

This module never calls AWS/GitHub, never runs subprocesses, never mutates a host,
and has no Supabase authority. It composes already-reviewed GitHub environment,
EC2 host, SSM managed-node and exact-document validators into a deterministic
readiness receipt. A PASS means the external prerequisites are observable through
an independent read-only role; it is not authorization to run SendCommand.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Any

from controller.w1 import aws_persistent_host_preflight_guard as deployment_guard
from controller.w1 import aws_provider_reboot_controller as provider_guard
from controller.w1 import aws_provider_reboot_live_guard as environment_guard
from controller.w1 import aws_ssm_iid_capture_guard as iid_guard
from controller.w1 import aws_ssm_safety_provision_guard as provision_guard
from controller.w1 import build_host_safety_package as package_builder


SCHEMA = "metaengine.compute.w1-aws-ssm-safety-readiness.h205f22.v1"
BOUNDARY_SCHEMA = "metaengine.compute.w1-aws-ssm-safety-readiness-session-boundary.h205f22.v1"
IAM_ROLE_ARN = re.compile(r"^arn:(aws|aws-us-gov|aws-cn):iam::([0-9]{12}):role/([A-Za-z0-9+=,.@_/-]{1,512})$")
ASSUMED_ROLE_ARN = re.compile(r"^arn:(aws|aws-us-gov|aws-cn):sts::([0-9]{12}):assumed-role/([^/]+)/([^/]+)$")
ACCOUNT_ID = re.compile(r"^[0-9]{12}$")
REGION = re.compile(r"^[a-z]{2}(-gov)?-[a-z]+-[0-9]+$")


class ReadinessError(RuntimeError):
    pass


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def _partition(region: str) -> str:
    if region.startswith("us-gov-"):
        return "aws-us-gov"
    if region.startswith("cn-"):
        return "aws-cn"
    return "aws"


def _validate_role_arn(value: Any, *, account_id: str, label: str) -> str:
    if not isinstance(value, str):
        raise ReadinessError(f"{label}_missing")
    match = IAM_ROLE_ARN.fullmatch(value)
    if match is None or match.group(2) != account_id:
        raise ReadinessError(f"{label}_invalid")
    return value


def validate_role_configuration(
    *, account_id: str, provision_role_arn: str, iid_role_arn: str, verifier_role_arn: str
) -> dict[str, Any]:
    if ACCOUNT_ID.fullmatch(account_id or "") is None:
        raise ReadinessError("account_id_invalid")
    roles = {
        "provision": _validate_role_arn(provision_role_arn, account_id=account_id, label="provision_role_arn"),
        "iid_capture": _validate_role_arn(iid_role_arn, account_id=account_id, label="iid_role_arn"),
        "verifier": _validate_role_arn(verifier_role_arn, account_id=account_id, label="verifier_role_arn"),
    }
    if len(set(roles.values())) != 3:
        raise ReadinessError("distinct_role_arns_required")
    return roles


def build_readonly_session_boundary(*, account_id: str, region: str) -> dict[str, Any]:
    if ACCOUNT_ID.fullmatch(account_id or "") is None:
        raise ReadinessError("account_id_invalid")
    if REGION.fullmatch(region or "") is None:
        raise ReadinessError("region_invalid")
    partition = _partition(region)
    provision_document_arn = f"arn:{partition}:ssm:{region}:{account_id}:document/{provision_guard.DOCUMENT_NAME}"
    iid_document_arn = f"arn:{partition}:ssm:{region}:{account_id}:document/{iid_guard.DOCUMENT_NAME}"
    policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "ReadExactCandidateHost",
                "Effect": "Allow",
                "Action": ["ec2:DescribeInstances", "ec2:DescribeVolumes", "ec2:DescribeSecurityGroups"],
                "Resource": "*",
            },
            {
                "Sid": "ReadExactManagedNode",
                "Effect": "Allow",
                "Action": "ssm:DescribeInstanceInformation",
                "Resource": "*",
            },
            {
                "Sid": "ReadExactReviewedDocuments",
                "Effect": "Allow",
                "Action": ["ssm:DescribeDocument", "ssm:GetDocument"],
                "Resource": [provision_document_arn, iid_document_arn],
            },
        ],
    }
    core = {
        "schema": BOUNDARY_SCHEMA,
        "classification": "W1_SSM_SAFETY_READINESS_READONLY_SESSION_BOUNDARY_NONAUTHORITY",
        "account_id": account_id,
        "region": region,
        "provision_document_arn": provision_document_arn,
        "iid_document_arn": iid_document_arn,
        "session_policy": policy,
        "send_command_allowed": False,
        "start_session_allowed": False,
        "document_mutation_allowed": False,
        "instance_lifecycle_mutation_allowed": False,
        "database_mutation_allowed": False,
        "provider_execution_authorized": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }
    out = copy.deepcopy(core)
    out["receipt_sha256"] = _sha(core)
    return out


def validate_readonly_caller(value: Any, *, account_id: str, verifier_role_arn: str) -> dict[str, str]:
    verifier_role_arn = _validate_role_arn(verifier_role_arn, account_id=account_id, label="verifier_role_arn")
    if not isinstance(value, dict) or value.get("Account") != account_id:
        raise ReadinessError("readonly_caller_account_mismatch")
    caller_arn = value.get("Arn")
    user_id = value.get("UserId")
    match = ASSUMED_ROLE_ARN.fullmatch(caller_arn or "")
    if match is None or match.group(2) != account_id:
        raise ReadinessError("readonly_caller_must_be_assumed_role")
    role_name = verifier_role_arn.rsplit("/", 1)[-1]
    if match.group(3) != role_name:
        raise ReadinessError("readonly_caller_role_mismatch")
    if not isinstance(user_id, str) or not user_id:
        raise ReadinessError("readonly_caller_user_id_missing")
    return {"account_id": account_id, "arn": caller_arn, "role_name": role_name, "session_name": match.group(4)}


def compose_readiness(
    *,
    environment_receipt: Any,
    deployment_receipt: Any,
    caller_identity: Any,
    preflight_bundle: Any,
    managed_node_response: Any,
    provision_document_description: Any,
    provision_get_document: Any,
    iid_document_description: Any,
    iid_get_document: Any,
    iid_document_source: bytes,
    instance_id: str,
    worker_id: str,
    account_id: str,
    region: str,
    provision_role_arn: str,
    iid_role_arn: str,
    verifier_role_arn: str,
) -> dict[str, Any]:
    environment = deployment_guard.validate_environment_receipt(environment_receipt)
    deployment = deployment_guard.validate_deployment_receipt(deployment_receipt)
    roles = validate_role_configuration(
        account_id=account_id,
        provision_role_arn=provision_role_arn,
        iid_role_arn=iid_role_arn,
        verifier_role_arn=verifier_role_arn,
    )
    caller = validate_readonly_caller(caller_identity, account_id=account_id, verifier_role_arn=roles["verifier"])
    preflight = provider_guard.validate_preflight_bundle(
        preflight_bundle,
        instance_id=instance_id,
        worker_id=worker_id,
        expected_worker_sha=package_builder.SOURCE_COMMIT,
    )
    managed = provision_guard.validate_managed_node(managed_node_response, expected_instance_id=instance_id)
    provision_document = provision_guard.validate_remote_document(
        description=provision_document_description,
        get_document=provision_get_document,
        account_id=account_id,
    )
    iid_document = iid_guard.validate_remote_document(
        description=iid_document_description,
        get_document=iid_get_document,
        account_id=account_id,
        local_document_source=iid_document_source,
    )

    core = {
        "schema": SCHEMA,
        "classification": "W1_SSM_SAFETY_EXTERNAL_READINESS_VERIFIED_NONAUTHORITY",
        "environment_receipt_sha256": environment["receipt_sha256"],
        "deployment_receipt_sha256": deployment["receipt_sha256"],
        "readonly_caller": caller,
        "role_configuration_sha256": _sha(roles),
        "preflight_sha256": _sha(preflight),
        "managed_node_sha256": _sha(managed),
        "provision_document": {
            "name": provision_guard.DOCUMENT_NAME,
            "version": provision_guard.DOCUMENT_VERSION,
            "aws_document_sha256": provision_document["aws_document_sha256"],
            "repository_document_sha256": provision_document["repository_generated_document_sha256"],
            "package_sha256": provision_document["package_sha256"],
        },
        "iid_document": {
            "name": iid_guard.DOCUMENT_NAME,
            "version": iid_guard.DOCUMENT_VERSION,
            "aws_document_sha256": iid_document["aws_document_sha256"],
            "repository_document_sha256": iid_document["repository_document_source_sha256"],
        },
        "github_environment_verified": True,
        "main_deployment_route_verified": True,
        "distinct_aws_roles_verified": True,
        "readonly_verifier_identity_verified": True,
        "provider_host_binding_verified": True,
        "managed_node_online_verified": True,
        "provision_document_verified": True,
        "iid_capture_document_verified": True,
        "readiness_preflight_passed": True,
        "send_command_executed": False,
        "document_mutation": False,
        "host_filesystem_mutation": False,
        "reboot_performed": False,
        "database_mutation": False,
        "worker_admitted": False,
        "persistent_worker_proof": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
        "required_next": "EXPLICITLY_APPROVED_MAIN_BRANCH_W1_SSM_PROVISIONING_DISPATCH",
    }
    out = copy.deepcopy(core)
    out["receipt_sha256"] = _sha(core)
    return out


def _read(path: str) -> Any:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ReadinessError(f"invalid_json:{path}") from exc


def _write(path: str, value: Any) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    boundary = sub.add_parser("build-readonly-boundary")
    boundary.add_argument("--account-id", required=True)
    boundary.add_argument("--region", required=True)
    boundary.add_argument("--output", required=True)

    compose = sub.add_parser("compose")
    for flag in (
        "environment-receipt", "deployment-receipt", "caller-identity", "preflight-bundle",
        "managed-node", "provision-description", "provision-get-document",
        "iid-description", "iid-get-document", "iid-document-source",
        "instance-id", "worker-id", "account-id", "region",
        "provision-role-arn", "iid-role-arn", "verifier-role-arn", "output",
    ):
        compose.add_argument("--" + flag, required=True)

    args = parser.parse_args(argv)
    try:
        if args.command == "build-readonly-boundary":
            result = build_readonly_session_boundary(account_id=args.account_id, region=args.region)
        else:
            result = compose_readiness(
                environment_receipt=_read(args.environment_receipt),
                deployment_receipt=_read(args.deployment_receipt),
                caller_identity=_read(args.caller_identity),
                preflight_bundle=_read(args.preflight_bundle),
                managed_node_response=_read(args.managed_node),
                provision_document_description=_read(args.provision_description),
                provision_get_document=_read(args.provision_get_document),
                iid_document_description=_read(args.iid_description),
                iid_get_document=_read(args.iid_get_document),
                iid_document_source=Path(args.iid_document_source).read_bytes(),
                instance_id=args.instance_id,
                worker_id=args.worker_id,
                account_id=args.account_id,
                region=args.region,
                provision_role_arn=args.provision_role_arn,
                iid_role_arn=args.iid_role_arn,
                verifier_role_arn=args.verifier_role_arn,
            )
        _write(args.output, result)
        return 0
    except (ReadinessError, environment_guard.LiveBoundaryError, deployment_guard.ProtectedHostPreflightError,
            provider_guard.EvidenceError, provision_guard.SSMProvisionError, iid_guard.SSMCaptureError, OSError) as exc:
        print(f"W1_SSM_SAFETY_READINESS_REJECTED:{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
