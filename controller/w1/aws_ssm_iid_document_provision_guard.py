#!/usr/bin/env python3
"""Create-once provisioning contract for the W1 account-owned SSM IID document.

This module never calls AWS and grants no Run Command/runtime authority. It builds the
narrow create/read boundary used by an independent provisioning principal, then
validates persisted AWS readback of version 1 against the reviewed repository bytes.
Any update/delete/share/send-command capability is deliberately outside this role.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

from controller.w1 import aws_ssm_iid_capture_guard as capture

PLAN_SCHEMA = "metaengine.compute.w1-aws-ssm-iid-document-provision-plan.h205f22.v1"
RECEIPT_SCHEMA = "metaengine.compute.w1-aws-ssm-iid-document-provision-receipt.h205f22.v1"
ACCOUNT_ID = re.compile(r"^[0-9]{12}$")
REGION = re.compile(r"^[a-z]{2}(-gov)?-[a-z]+-[0-9]+$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
TARGET_TYPE = "/AWS::EC2::Instance"


class ProvisionError(RuntimeError):
    pass


def _partition(region: str) -> str:
    return "aws-us-gov" if region.startswith("us-gov-") else "aws"


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _tags() -> dict[str, str]:
    return {
        "metaengine:project": "H205F22",
        "metaengine:milestone": "W1_PERSISTENT_LINUX_WORKER_SAFETY",
        "metaengine:purpose": "signed-iid-capture",
        "metaengine:authority": "noncanonical-provisioning",
    }


def build_provision_plan(*, account_id: str, region: str, local_document_source: bytes) -> dict[str, Any]:
    if not ACCOUNT_ID.fullmatch(account_id):
        raise ProvisionError("account_id_invalid")
    if not REGION.fullmatch(region):
        raise ProvisionError("region_invalid")
    local = capture.parse_local_document(local_document_source)
    partition = _partition(region)
    document_arn = f"arn:{partition}:ssm:{region}:{account_id}:document/{capture.DOCUMENT_NAME}"
    tags = _tags()

    policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "CreateOnlyReviewedW1IIDDocument",
                "Effect": "Allow",
                "Action": "ssm:CreateDocument",
                "Resource": document_arn,
                "Condition": {
                    "StringEquals": {
                        "ssm:DocumentType": "Command",
                        **{f"aws:RequestTag/{k}": v for k, v in tags.items()},
                    },
                    "ForAllValues:StringEquals": {"aws:TagKeys": sorted(tags)},
                },
            },
            {
                "Sid": "ReadBackExactW1IIDDocument",
                "Effect": "Allow",
                "Action": ["ssm:DescribeDocument", "ssm:GetDocument"],
                "Resource": document_arn,
            },
        ],
    }
    request = {
        "Name": capture.DOCUMENT_NAME,
        "DocumentType": "Command",
        "DocumentFormat": "JSON",
        "TargetType": TARGET_TYPE,
        "Content": _canonical(local),
        "Tags": [{"Key": key, "Value": tags[key]} for key in sorted(tags)],
    }
    neutral = {
        "account_id": account_id,
        "region": region,
        "document_name": capture.DOCUMENT_NAME,
        "document_arn": document_arn,
        "required_document_version": capture.DOCUMENT_VERSION,
        "repository_document_source_sha256": _sha_bytes(local_document_source),
        "create_request": request,
        "provisioning_policy": policy,
        "create_once": True,
        "document_update_allowed": False,
        "document_delete_allowed": False,
        "document_share_allowed": False,
        "send_command_allowed": False,
    }
    return {
        "schema": PLAN_SCHEMA,
        **neutral,
        "plan_sha256": hashlib.sha256(_canonical(neutral).encode()).hexdigest(),
        "canonical": False,
        "authority_effect": False,
        "execution_authority": False,
        "persistent_worker_proof": False,
        "w1_verified": False,
    }


def _description(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ProvisionError(f"{label}_invalid")
    doc = value.get("DocumentDescription") if isinstance(value.get("DocumentDescription"), dict) else value.get("Document") if isinstance(value.get("Document"), dict) else value
    if not isinstance(doc, dict):
        raise ProvisionError(f"{label}_document_invalid")
    return doc


def _require_version_one(doc: dict[str, Any], *, label: str, require_active: bool) -> None:
    if doc.get("Name") != capture.DOCUMENT_NAME:
        raise ProvisionError(f"{label}_name_mismatch")
    if doc.get("DocumentType") != "Command":
        raise ProvisionError(f"{label}_type_mismatch")
    if str(doc.get("DocumentVersion")) != "1":
        raise ProvisionError(f"{label}_document_version_not_one")
    if str(doc.get("LatestVersion")) != "1":
        raise ProvisionError(f"{label}_latest_version_not_one")
    if str(doc.get("DefaultVersion")) != "1":
        raise ProvisionError(f"{label}_default_version_not_one")
    if require_active and doc.get("Status") != "Active":
        raise ProvisionError(f"{label}_not_active")
    if doc.get("HashType") != "Sha256" or not isinstance(doc.get("Hash"), str) or SHA256.fullmatch(doc["Hash"]) is None:
        raise ProvisionError(f"{label}_sha256_missing")


def validate_provisioned_document(
    *,
    plan: dict[str, Any],
    create_response: dict[str, Any],
    describe_response: dict[str, Any],
    get_document_response: dict[str, Any],
    local_document_source: bytes,
) -> dict[str, Any]:
    if not isinstance(plan, dict) or plan.get("schema") != PLAN_SCHEMA:
        raise ProvisionError("plan_schema_invalid")
    if plan.get("canonical") is not False or plan.get("authority_effect") is not False:
        raise ProvisionError("plan_authority_invalid")
    if plan.get("create_once") is not True or plan.get("required_document_version") != "1":
        raise ProvisionError("plan_create_once_boundary_invalid")
    if plan.get("repository_document_source_sha256") != _sha_bytes(local_document_source):
        raise ProvisionError("local_document_digest_mismatch")

    account_id = str(plan.get("account_id") or "")
    if not ACCOUNT_ID.fullmatch(account_id):
        raise ProvisionError("plan_account_id_invalid")

    created = _description(create_response, "create_response")
    if created.get("Owner") != account_id:
        raise ProvisionError("create_response_owner_mismatch")
    _require_version_one(created, label="create_response", require_active=False)

    described = _description(describe_response, "describe_response")
    if described.get("Owner") != account_id:
        raise ProvisionError("describe_response_owner_mismatch")
    _require_version_one(described, label="describe_response", require_active=True)

    verified_remote = capture.validate_remote_document(
        description=describe_response,
        get_document=get_document_response,
        account_id=account_id,
        local_document_source=local_document_source,
    )
    if verified_remote.get("remote_content_matches_repository") is not True:
        raise ProvisionError("remote_document_not_repository_exact")

    evidence = {
        "account_id": account_id,
        "region": plan["region"],
        "document_name": capture.DOCUMENT_NAME,
        "document_arn": plan["document_arn"],
        "document_version": "1",
        "latest_version": "1",
        "default_version": "1",
        "aws_document_sha256": described["Hash"],
        "repository_document_source_sha256": plan["repository_document_source_sha256"],
        "remote_content_matches_repository": True,
        "create_once": True,
        "provisioning_role_can_update": False,
        "provisioning_role_can_delete": False,
        "provisioning_role_can_share": False,
        "provisioning_role_can_send_command": False,
    }
    return {
        "schema": RECEIPT_SCHEMA,
        "classification": "W1_AWS_SSM_IID_DOCUMENT_PROVISIONED_NON_AUTHORITY",
        "evidence": evidence,
        "evidence_sha256": hashlib.sha256(_canonical(evidence).encode()).hexdigest(),
        "document_provisioned": True,
        "runtime_execution_authority": False,
        "provider_identity_verified": False,
        "reboot_completion_proven": False,
        "persistent_worker_proof": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }


def _read(path: str) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="command", required=True)
    make = sub.add_parser("plan")
    make.add_argument("--account-id", required=True)
    make.add_argument("--region", required=True)
    make.add_argument("--document", required=True)
    make.add_argument("--output", required=True)
    verify = sub.add_parser("verify")
    verify.add_argument("--plan", required=True)
    verify.add_argument("--create-response", required=True)
    verify.add_argument("--describe-response", required=True)
    verify.add_argument("--get-document-response", required=True)
    verify.add_argument("--document", required=True)
    verify.add_argument("--output", required=True)
    args = p.parse_args(argv)
    try:
        if args.command == "plan":
            source = Path(args.document).read_bytes()
            result = build_provision_plan(account_id=args.account_id, region=args.region, local_document_source=source)
        else:
            source = Path(args.document).read_bytes()
            result = validate_provisioned_document(
                plan=_read(args.plan), create_response=_read(args.create_response),
                describe_response=_read(args.describe_response), get_document_response=_read(args.get_document_response),
                local_document_source=source,
            )
        Path(args.output).write_text(json.dumps(result, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        return 0
    except (ProvisionError, capture.SSMCaptureError, OSError, json.JSONDecodeError) as exc:
        print(f"W1_SSM_DOCUMENT_PROVISION_REJECTED:{exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
