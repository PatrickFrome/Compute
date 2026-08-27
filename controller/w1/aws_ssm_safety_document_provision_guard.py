#!/usr/bin/env python3
"""Create-once contract for the W1 immutable safety provisioning SSM document.

This module never calls AWS. It builds a least-authority create/read policy and
validates caller-supplied AWS response transport against the deterministic
parameterless document generated from the pinned W1 safety package.

The provisioning principal cannot SendCommand, update/delete/share documents,
reboot instances, start sessions, or touch the database. Validation of response
transport is not authenticated AWS provenance and cannot claim the document was
provisioned authoritatively.
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
from typing import Any

from controller.w1 import build_host_safety_package as package_builder
from controller.w1 import build_ssm_safety_provision_document as document_builder
from controller.w1 import aws_ssm_safety_provision_guard as runtime_guard


PLAN_SCHEMA = "metaengine.compute.w1-aws-ssm-safety-document-provision-plan.h205f22.v1"
RECEIPT_SCHEMA = "metaengine.compute.w1-aws-ssm-safety-document-provision-receipt.h205f22.v1"
TARGET_TYPE = "/AWS::EC2::Instance"
VERSION_NAME = f"w1-safety-{package_builder.PACKAGE_VERSION}"
ACCOUNT_ID = re.compile(r"^[0-9]{12}$")
REGION = re.compile(r"^[a-z]{2}(-gov)?-[a-z]+-[0-9]+$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")


class SafetyDocumentProvisionError(RuntimeError):
    pass


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _partition(region: str) -> str:
    if region.startswith("us-gov-"):
        return "aws-us-gov"
    if region.startswith("cn-"):
        return "aws-cn"
    return "aws"


def _require(value: Any, pattern: re.Pattern[str], label: str) -> str:
    if not isinstance(value, str) or pattern.fullmatch(value) is None:
        raise SafetyDocumentProvisionError(f"{label}_invalid")
    return value


def _tags() -> dict[str, str]:
    return {
        "metaengine:project": "H205F22",
        "metaengine:milestone": "W1_PERSISTENT_LINUX_WORKER_SAFETY",
        "metaengine:purpose": "immutable-safety-package-provision",
        "metaengine:authority": "noncanonical-provisioning",
        "metaengine:package_sha256": document_builder.build_document()["package_sha256"],
    }


def expected_document() -> dict[str, Any]:
    built = document_builder.build_document()
    runtime_guard.validate_expected_document(built["document"])
    return built


def build_provision_plan(*, account_id: str, region: str) -> dict[str, Any]:
    _require(account_id, ACCOUNT_ID, "account_id")
    _require(region, REGION, "region")
    built = expected_document()
    content = _canonical(built["document"])
    if len(content.encode("utf-8")) > document_builder.MAX_SSM_DOCUMENT_BYTES:
        raise SafetyDocumentProvisionError("document_size_limit_exceeded")
    partition = _partition(region)
    document_arn = f"arn:{partition}:ssm:{region}:{account_id}:document/{runtime_guard.DOCUMENT_NAME}"
    tags = _tags()
    policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "CreateOnlyReviewedW1SafetyDocument",
                "Effect": "Allow",
                "Action": "ssm:CreateDocument",
                "Resource": document_arn,
                "Condition": {
                    "StringEquals": {
                        "ssm:DocumentType": "Command",
                        **{f"aws:RequestTag/{key}": value for key, value in tags.items()},
                    },
                    "ForAllValues:StringEquals": {"aws:TagKeys": sorted(tags)},
                },
            },
            {
                "Sid": "ReadBackExactW1SafetyDocument",
                "Effect": "Allow",
                "Action": ["ssm:DescribeDocument", "ssm:GetDocument"],
                "Resource": document_arn,
            },
        ],
    }
    create_request = {
        "Name": runtime_guard.DOCUMENT_NAME,
        "DocumentType": "Command",
        "DocumentFormat": "JSON",
        "TargetType": TARGET_TYPE,
        "VersionName": VERSION_NAME,
        "Content": content,
        "Tags": [{"Key": key, "Value": tags[key]} for key in sorted(tags)],
    }
    core = {
        "schema": PLAN_SCHEMA,
        "classification": "W1_SSM_SAFETY_DOCUMENT_CREATE_ONCE_PLAN_NONAUTHORITY",
        "account_id": account_id,
        "region": region,
        "document_name": runtime_guard.DOCUMENT_NAME,
        "document_arn": document_arn,
        "document_version_required": "1",
        "version_name": VERSION_NAME,
        "repository_generated_document_sha256": built["document_sha256"],
        "package_sha256": built["package_sha256"],
        "payload_lock_sha256": built["payload_lock_sha256"],
        "create_request": create_request,
        "provisioning_policy": policy,
        "create_once": True,
        "update_allowed": False,
        "delete_allowed": False,
        "share_allowed": False,
        "send_command_allowed": False,
        "start_session_allowed": False,
        "reboot_allowed": False,
        "database_mutation_allowed": False,
        "document_provisioned": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }
    out = copy.deepcopy(core)
    out["plan_sha256"] = _sha(core)
    return out


def _description(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SafetyDocumentProvisionError(f"{label}_invalid")
    for key in ("DocumentDescription", "Document"):
        if isinstance(value.get(key), dict):
            return value[key]
    return value


def _validate_version_one(doc: dict[str, Any], *, account_id: str, label: str, require_active: bool) -> None:
    if doc.get("Name") != runtime_guard.DOCUMENT_NAME:
        raise SafetyDocumentProvisionError(f"{label}_name_mismatch")
    if doc.get("Owner") != account_id:
        raise SafetyDocumentProvisionError(f"{label}_owner_mismatch")
    if doc.get("DocumentType") != "Command":
        raise SafetyDocumentProvisionError(f"{label}_type_mismatch")
    if str(doc.get("DocumentVersion")) != "1":
        raise SafetyDocumentProvisionError(f"{label}_version_not_one")
    if str(doc.get("LatestVersion")) != "1":
        raise SafetyDocumentProvisionError(f"{label}_latest_version_not_one")
    if str(doc.get("DefaultVersion")) != "1":
        raise SafetyDocumentProvisionError(f"{label}_default_version_not_one")
    if require_active and doc.get("Status") != "Active":
        raise SafetyDocumentProvisionError(f"{label}_not_active")
    if doc.get("HashType") != "Sha256" or not isinstance(doc.get("Hash"), str) or SHA256.fullmatch(doc["Hash"]) is None:
        raise SafetyDocumentProvisionError(f"{label}_sha256_missing")
    if doc.get("DocumentFormat") not in (None, "JSON"):
        raise SafetyDocumentProvisionError(f"{label}_format_mismatch")
    if doc.get("TargetType") not in (None, TARGET_TYPE):
        raise SafetyDocumentProvisionError(f"{label}_target_type_mismatch")
    if doc.get("VersionName") not in (None, VERSION_NAME):
        raise SafetyDocumentProvisionError(f"{label}_version_name_mismatch")
    parameters = doc.get("Parameters")
    if parameters not in (None, []):
        raise SafetyDocumentProvisionError(f"{label}_parameters_not_empty")


def validate_provisioned_document(
    *,
    plan: dict[str, Any],
    create_response: Any,
    describe_response: Any,
    get_document_response: Any,
) -> dict[str, Any]:
    if not isinstance(plan, dict) or plan.get("schema") != PLAN_SCHEMA:
        raise SafetyDocumentProvisionError("plan_schema_invalid")
    account_id = _require(plan.get("account_id"), ACCOUNT_ID, "plan_account_id")
    region = _require(plan.get("region"), REGION, "plan_region")
    expected_plan = build_provision_plan(account_id=account_id, region=region)
    if plan != expected_plan:
        raise SafetyDocumentProvisionError("plan_content_mismatch")

    created = _description(create_response, "create_response")
    _validate_version_one(created, account_id=account_id, label="create_response", require_active=False)
    described = _description(describe_response, "describe_response")
    _validate_version_one(described, account_id=account_id, label="describe_response", require_active=True)

    remote = runtime_guard.validate_remote_document(
        description=describe_response,
        get_document=get_document_response,
        account_id=account_id,
    )
    if remote.get("remote_content_matches_generated_document") is not True:
        raise SafetyDocumentProvisionError("remote_document_content_not_exact")
    if remote.get("repository_generated_document_sha256") != expected_plan["repository_generated_document_sha256"]:
        raise SafetyDocumentProvisionError("repository_document_hash_binding_mismatch")
    if remote.get("package_sha256") != expected_plan["package_sha256"]:
        raise SafetyDocumentProvisionError("package_hash_binding_mismatch")
    if remote.get("payload_lock_sha256") != expected_plan["payload_lock_sha256"]:
        raise SafetyDocumentProvisionError("payload_lock_binding_mismatch")

    evidence = {
        "account_id": account_id,
        "region": region,
        "document_name": runtime_guard.DOCUMENT_NAME,
        "document_arn": expected_plan["document_arn"],
        "document_version": "1",
        "latest_version": "1",
        "default_version": "1",
        "version_name": VERSION_NAME,
        "aws_document_sha256": described["Hash"],
        "repository_generated_document_sha256": expected_plan["repository_generated_document_sha256"],
        "package_sha256": expected_plan["package_sha256"],
        "payload_lock_sha256": expected_plan["payload_lock_sha256"],
        "remote_content_matches_generated_document": True,
        "create_once_policy_template": True,
        "policy_template_update_allow": False,
        "policy_template_delete_allow": False,
        "policy_template_share_allow": False,
        "policy_template_send_command_allow": False,
        "aws_api_response_provenance": "CALLER_SUPPLIED_AWS_RESPONSE_TRANSPORT_NON_AUTHORITY",
        "live_aws_api_provenance_verified": False,
    }
    return {
        "schema": RECEIPT_SCHEMA,
        "classification": "W1_SSM_SAFETY_DOCUMENT_PROVISIONING_OBSERVED_NONAUTHORITY",
        "evidence": evidence,
        "evidence_sha256": _sha(evidence),
        "document_provisioning_observation_validated": True,
        "document_provisioned": False,
        "document_provisioned_authoritatively_verified": False,
        "runtime_execution_authority": False,
        "provider_identity_verified": False,
        "host_safety_verified": False,
        "persistent_worker_proof": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }
