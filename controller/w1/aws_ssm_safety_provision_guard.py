#!/usr/bin/env python3
"""Fail-closed off-host contract for W1 safety-package SSM provisioning.

Provisioning and capture are separate trust domains. This guard permits only an
account-owned version-1 parameterless provisioning document whose content is
re-generated from the deterministic package builder, and only the exact tagged
candidate EC2 instance. It never calls AWS and cannot assert authenticated AWS
provenance from caller-supplied response objects.
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
from typing import Any

from controller.w1 import build_host_safety_package as package_builder
from controller.w1 import build_ssm_safety_provision_document as provision_builder


BOUNDARY_SCHEMA = "metaengine.compute.w1-aws-ssm-safety-provision-session-boundary.h205f22.v1"
PLAN_SCHEMA = "metaengine.compute.w1-aws-ssm-safety-provision-command-plan.h205f22.v1"
RECEIPT_SCHEMA = "metaengine.compute.w1-aws-ssm-safety-provision-capture.h205f22.v1"
COURIER_SCHEMA = "metaengine.compute.w1-aws-ssm-safety-provision-courier.h205f22.v1"
DOCUMENT_NAME = provision_builder.DOCUMENT_NAME
DOCUMENT_VERSION = "1"
DOCUMENT_HASH_TYPE = "Sha256"
MAX_STDOUT_CHARS = 12_000
MAX_STDERR_CHARS = 8_000

INSTANCE_ID = re.compile(r"^i-[0-9a-f]+$")
WORKER_ID = re.compile(r"^[A-Za-z0-9._:-]{3,160}$")
ACCOUNT_ID = re.compile(r"^[0-9]{12}$")
REGION = re.compile(r"^[a-z]{2}(-gov)?-[a-z]+-[0-9]+$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
COMMAND_ID = re.compile(r"^[0-9a-fA-F-]{36}$")


class SSMProvisionError(RuntimeError):
    pass


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def _sha_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _partition(region: str) -> str:
    if region.startswith("us-gov-"):
        return "aws-us-gov"
    if region.startswith("cn-"):
        return "aws-cn"
    return "aws"


def _require(value: str, pattern: re.Pattern[str], label: str) -> str:
    if not isinstance(value, str) or pattern.fullmatch(value) is None:
        raise SSMProvisionError(f"{label}_invalid")
    return value


def expected_build() -> dict[str, Any]:
    return provision_builder.build_document()


def expected_document_bytes() -> bytes:
    return provision_builder.canonical_bytes(expected_build()["document"])


def required_instance_tags(worker_id: str) -> dict[str, str]:
    _require(worker_id, WORKER_ID, "worker_id")
    return {
        "metaengine:project": "H205F22",
        "metaengine:milestone": "W1_PERSISTENT_LINUX_WORKER_SAFETY",
        "metaengine:worker_id": worker_id,
        "metaengine:github_sha": package_builder.SOURCE_COMMIT,
        "metaengine:authority": "noncanonical-worker",
        "metaengine:execution_tier": "persistent-host",
    }


def validate_expected_document(value: Any) -> dict[str, Any]:
    expected = expected_build()["document"]
    if value != expected:
        raise SSMProvisionError("provision_document_content_mismatch")
    if expected.get("parameters") != {}:
        raise SSMProvisionError("provision_document_parameters_forbidden")
    steps = expected.get("mainSteps")
    if not isinstance(steps, list) or len(steps) != 1:
        raise SSMProvisionError("provision_document_single_step_required")
    step = steps[0]
    if step.get("action") != "aws:runShellScript" or step.get("name") != "installPinnedSafetyPackage":
        raise SSMProvisionError("provision_document_step_identity_invalid")
    command = step.get("inputs", {}).get("runCommand")
    if not isinstance(command, list) or len(command) != 1 or not isinstance(command[0], str):
        raise SSMProvisionError("provision_document_single_command_required")
    lowered = command[0].lower()
    for forbidden in (
        "{{", "https://", "http://", "curl ", "wget ", "aws ", "ssh ",
        "aws-configureawspackage", "aws-rundocument", "ssm:sendcommand",
        "ec2:rebootinstances", "supabase",
    ):
        if forbidden in lowered:
            raise SSMProvisionError(f"provision_document_forbidden_surface:{forbidden}")
    return expected


def build_session_boundary(*, instance_id: str, worker_id: str, account_id: str, region: str) -> dict[str, Any]:
    _require(instance_id, INSTANCE_ID, "instance_id")
    _require(worker_id, WORKER_ID, "worker_id")
    _require(account_id, ACCOUNT_ID, "account_id")
    _require(region, REGION, "region")
    build = expected_build()
    validate_expected_document(build["document"])

    partition = _partition(region)
    instance_arn = f"arn:{partition}:ec2:{region}:{account_id}:instance/{instance_id}"
    document_arn = f"arn:{partition}:ssm:{region}:{account_id}:document/{DOCUMENT_NAME}"
    tags = required_instance_tags(worker_id)
    tag_condition = {f"ssm:resourceTag/{key}": value for key, value in tags.items()}
    policy = {
        "Version": "2012-10-17",
        "Statement": [
            {"Sid": "ReadExactManagedNodeState", "Effect": "Allow", "Action": "ssm:DescribeInstanceInformation", "Resource": "*"},
            {"Sid": "ReadExactImmutableProvisionDocument", "Effect": "Allow", "Action": ["ssm:DescribeDocument", "ssm:GetDocument"], "Resource": document_arn},
            {"Sid": "SendOnlyExactImmutableProvisionDocument", "Effect": "Allow", "Action": "ssm:SendCommand", "Resource": document_arn},
            {"Sid": "SendOnlyExactTaggedW1Instance", "Effect": "Allow", "Action": "ssm:SendCommand", "Resource": instance_arn, "Condition": {"StringEquals": tag_condition}},
            {"Sid": "ReadExactCommandInvocationResult", "Effect": "Allow", "Action": "ssm:GetCommandInvocation", "Resource": "*"},
        ],
    }
    core = {
        "schema": BOUNDARY_SCHEMA,
        "classification": "W1_AWS_SSM_SAFETY_PROVISION_SESSION_BOUNDARY_NONAUTHORITY",
        "instance_id": instance_id,
        "worker_id": worker_id,
        "account_id": account_id,
        "region": region,
        "instance_arn": instance_arn,
        "document_name": DOCUMENT_NAME,
        "document_version": DOCUMENT_VERSION,
        "document_arn": document_arn,
        "repository_generated_document_sha256": build["document_sha256"],
        "package_sha256": build["package_sha256"],
        "package_version": package_builder.PACKAGE_VERSION,
        "payload_lock_sha256": build["payload_lock_sha256"],
        "required_instance_tags": tags,
        "session_policy": policy,
        "arbitrary_command_parameters_allowed": False,
        "generic_package_document_allowed": False,
        "nested_document_execution_allowed": False,
        "capture_document_allowed": False,
        "start_session_allowed": False,
        "ssh_allowed": False,
        "port_forwarding_allowed": False,
        "reboot_allowed": False,
        "database_mutation_allowed": False,
        "package_provisioning_verified": False,
        "host_safety_verified": False,
        "persistent_worker_proof": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }
    result = copy.deepcopy(core)
    result["receipt_sha256"] = _sha(core)
    return result


def validate_managed_node(value: Any, *, expected_instance_id: str) -> dict[str, Any]:
    _require(expected_instance_id, INSTANCE_ID, "expected_instance_id")
    if not isinstance(value, dict):
        raise SSMProvisionError("managed_node_response_invalid")
    items = value.get("InstanceInformationList")
    if not isinstance(items, list) or len(items) != 1 or not isinstance(items[0], dict):
        raise SSMProvisionError("managed_node_exact_singleton_required")
    node = items[0]
    if node.get("InstanceId") != expected_instance_id:
        raise SSMProvisionError("managed_node_instance_mismatch")
    if node.get("PingStatus") != "Online":
        raise SSMProvisionError("managed_node_not_online")
    if node.get("PlatformType") != "Linux" or node.get("ResourceType") != "EC2Instance":
        raise SSMProvisionError("managed_node_platform_invalid")
    return {"instance_id": expected_instance_id, "ping_status": "Online", "platform_type": "Linux", "resource_type": "EC2Instance", "agent_version": node.get("AgentVersion"), "last_ping_date_time": node.get("LastPingDateTime")}


def validate_remote_document(*, description: Any, get_document: Any, account_id: str) -> dict[str, Any]:
    _require(account_id, ACCOUNT_ID, "account_id")
    build = expected_build()
    expected = validate_expected_document(build["document"])
    if not isinstance(description, dict):
        raise SSMProvisionError("document_description_invalid")
    doc = description.get("Document") if isinstance(description.get("Document"), dict) else description
    if doc.get("Name") != DOCUMENT_NAME or doc.get("Owner") != account_id:
        raise SSMProvisionError("document_identity_mismatch")
    if doc.get("DocumentType") != "Command" or doc.get("Status") != "Active":
        raise SSMProvisionError("document_state_invalid")
    if str(doc.get("DocumentVersion")) != DOCUMENT_VERSION:
        raise SSMProvisionError("document_version_mismatch")
    aws_sha = doc.get("Hash")
    if doc.get("HashType") != DOCUMENT_HASH_TYPE or not isinstance(aws_sha, str) or SHA256.fullmatch(aws_sha) is None:
        raise SSMProvisionError("document_hash_invalid")
    platforms = doc.get("PlatformTypes")
    if not isinstance(platforms, list) or "Linux" not in platforms:
        raise SSMProvisionError("document_linux_platform_missing")

    if not isinstance(get_document, dict):
        raise SSMProvisionError("get_document_response_invalid")
    if get_document.get("Name") != DOCUMENT_NAME or str(get_document.get("DocumentVersion")) != DOCUMENT_VERSION:
        raise SSMProvisionError("get_document_identity_mismatch")
    if get_document.get("DocumentType") != "Command" or get_document.get("Status") != "Active":
        raise SSMProvisionError("get_document_state_invalid")
    content = get_document.get("Content")
    if not isinstance(content, str):
        raise SSMProvisionError("get_document_content_missing")
    try:
        remote = json.loads(content)
    except json.JSONDecodeError as exc:
        raise SSMProvisionError("get_document_content_invalid_json") from exc
    if remote != expected:
        raise SSMProvisionError("remote_document_content_mismatch")
    if _sha_bytes(provision_builder.canonical_bytes(remote)) != build["document_sha256"]:
        raise SSMProvisionError("remote_document_repository_hash_mismatch")
    return {
        "name": DOCUMENT_NAME,
        "owner_account_id": account_id,
        "document_version": DOCUMENT_VERSION,
        "aws_document_sha256": aws_sha,
        "repository_generated_document_sha256": build["document_sha256"],
        "remote_content_matches_generated_document": True,
        "document_parameters": {},
        "package_sha256": build["package_sha256"],
        "payload_lock_sha256": build["payload_lock_sha256"],
    }


def build_command_plan(*, instance_id: str, aws_document_sha256: str) -> dict[str, Any]:
    _require(instance_id, INSTANCE_ID, "instance_id")
    _require(aws_document_sha256, SHA256, "aws_document_sha256")
    build = expected_build()
    core = {
        "schema": PLAN_SCHEMA,
        "classification": "W1_AWS_SSM_SAFETY_PROVISION_COMMAND_PLAN_NONAUTHORITY",
        "instance_ids": [instance_id],
        "document_name": DOCUMENT_NAME,
        "document_version": DOCUMENT_VERSION,
        "document_hash": aws_document_sha256,
        "document_hash_type": DOCUMENT_HASH_TYPE,
        "repository_generated_document_sha256": build["document_sha256"],
        "package_sha256": build["package_sha256"],
        "package_version": package_builder.PACKAGE_VERSION,
        "payload_lock_sha256": build["payload_lock_sha256"],
        "timeout_seconds": 120,
        "parameters": {},
        "arbitrary_command_parameters_allowed": False,
        "capture_authority": False,
        "reboot_authority": False,
        "database_mutation_authority": False,
        "package_provisioning_verified": False,
        "persistent_worker_proof": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }
    result = copy.deepcopy(core)
    result["plan_sha256"] = _sha(core)
    return result


def validate_send_command_response(value: Any, *, plan: dict[str, Any]) -> str:
    if not isinstance(value, dict) or not isinstance(value.get("Command"), dict):
        raise SSMProvisionError("send_command_response_invalid")
    command = value["Command"]
    command_id = command.get("CommandId")
    if not isinstance(command_id, str) or COMMAND_ID.fullmatch(command_id) is None:
        raise SSMProvisionError("send_command_id_invalid")
    if command.get("DocumentName") != plan.get("document_name"):
        raise SSMProvisionError("send_command_document_mismatch")
    if str(command.get("DocumentVersion")) != plan.get("document_version"):
        raise SSMProvisionError("send_command_document_version_mismatch")
    if command.get("InstanceIds") != plan.get("instance_ids"):
        raise SSMProvisionError("send_command_instance_mismatch")
    if command.get("Parameters") not in ({}, None):
        raise SSMProvisionError("send_command_parameters_not_empty")
    return command_id


def validate_courier(value: Any) -> dict[str, Any]:
    build = expected_build()
    required = {
        "schema", "source", "transport", "package_id", "package_version",
        "package_zip_sha256", "package_zip_bytes", "payload_lock_sha256",
        "source_commit_sha", "source_tree_sha", "install_root", "execution_user",
        "workspace_root", "package_install_observed", "package_provisioning_verified",
        "host_safety_verified", "capture_executed", "provider_identity_verified",
        "reboot_completion_proven", "persistent_worker_proof", "w1_verified",
        "canonical", "authority_effect",
    }
    if not isinstance(value, dict) or set(value) != required or value.get("schema") != COURIER_SCHEMA:
        raise SSMProvisionError("courier_shape_invalid")
    expected_values = {
        "source": "HOST_UNTRUSTED_TRANSPORT",
        "transport": "AWS_SSM_RUN_COMMAND_FIXED_EMBEDDED_PACKAGE",
        "package_id": package_builder.PACKAGE_ID,
        "package_version": package_builder.PACKAGE_VERSION,
        "package_zip_sha256": build["package_sha256"],
        "package_zip_bytes": build["package_bytes"],
        "payload_lock_sha256": build["payload_lock_sha256"],
        "source_commit_sha": package_builder.SOURCE_COMMIT,
        "source_tree_sha": package_builder.SOURCE_TREE,
        "install_root": package_builder.INSTALL_ROOT,
        "execution_user": package_builder.EXECUTION_USER,
        "workspace_root": package_builder.WORKSPACE_ROOT,
        "package_install_observed": True,
        "package_provisioning_verified": False,
        "host_safety_verified": False,
        "capture_executed": False,
        "provider_identity_verified": False,
        "reboot_completion_proven": False,
        "persistent_worker_proof": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }
    for key, expected in expected_values.items():
        if value.get(key) != expected:
            raise SSMProvisionError(f"courier_value_mismatch:{key}")
    return {"package_sha256": build["package_sha256"], "payload_lock_sha256": build["payload_lock_sha256"], "package_install_observed": True}


def validate_command_invocation(value: Any, *, expected_command_id: str, expected_instance_id: str) -> dict[str, Any]:
    _require(expected_command_id, COMMAND_ID, "expected_command_id")
    _require(expected_instance_id, INSTANCE_ID, "expected_instance_id")
    if not isinstance(value, dict):
        raise SSMProvisionError("command_invocation_invalid")
    if value.get("CommandId") != expected_command_id or value.get("InstanceId") != expected_instance_id:
        raise SSMProvisionError("command_invocation_identity_mismatch")
    if value.get("DocumentName") != DOCUMENT_NAME or value.get("Status") != "Success":
        raise SSMProvisionError("command_invocation_state_invalid")
    stdout = value.get("StandardOutputContent")
    stderr = value.get("StandardErrorContent")
    if not isinstance(stdout, str) or not stdout or len(stdout) > MAX_STDOUT_CHARS:
        raise SSMProvisionError("command_invocation_stdout_invalid")
    if not isinstance(stderr, str) or len(stderr) > MAX_STDERR_CHARS or stderr.strip():
        raise SSMProvisionError("command_invocation_stderr_not_empty")
    try:
        courier = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise SSMProvisionError("command_invocation_stdout_json_invalid") from exc
    validated = validate_courier(courier)
    build = expected_build()
    evidence = {
        "command_id": expected_command_id,
        "instance_id": expected_instance_id,
        "document_name": DOCUMENT_NAME,
        "document_version": DOCUMENT_VERSION,
        "repository_generated_document_sha256": build["document_sha256"],
        "package_sha256": validated["package_sha256"],
        "payload_lock_sha256": validated["payload_lock_sha256"],
        "package_install_observed": True,
        "aws_api_response_provenance_verified": False,
    }
    return {
        "schema": RECEIPT_SCHEMA,
        "classification": "W1_AWS_SSM_SAFETY_PROVISION_CAPTURE_VALIDATED_NONAUTHORITY",
        "evidence": evidence,
        "evidence_sha256": _sha(evidence),
        "provision_transport_validated": True,
        "package_install_observed": True,
        "package_provisioning_verified": False,
        "capture_executed": False,
        "host_safety_verified": False,
        "provider_identity_verified": False,
        "reboot_completion_proven": False,
        "persistent_worker_proof": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }
