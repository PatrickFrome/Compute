#!/usr/bin/env python3
"""Fail-closed AWS SSM transport contract for W1 Linux safety capture.

The execution role may send only the account-owned, parameterless immutable
version-1 safety capture document to the exact tagged W1 EC2 instance. The
document itself pins a pre-existing runtime package revision and drops from the
root SSM transport identity to the dedicated non-root ``metaengine-w1`` user.

Returned bytes remain untrusted transport. This module performs deterministic
off-host validation and recomputes the safety decision, but it does not prove
AWS response provenance, persist evidence, admit a worker, or assert W1.
"""
from __future__ import annotations

import base64
import copy
import hashlib
import json
import re
from typing import Any

from controller.w1 import host_safety_envelope_validator as safety_validator


BOUNDARY_SCHEMA = "metaengine.compute.w1-aws-ssm-safety-session-boundary.h205f22.v1"
PLAN_SCHEMA = "metaengine.compute.w1-aws-ssm-safety-command-plan.h205f22.v1"
CAPTURE_SCHEMA = "metaengine.compute.w1-aws-ssm-safety-capture.h205f22.v1"
COURIER_SCHEMA = "metaengine.compute.w1-aws-ssm-safety-courier.h205f22.v1"
BUNDLE_SCHEMA = "metaengine.compute.w1-host-safety-evidence-bundle.h205f22.v2"

DOCUMENT_NAME = "Metaengine-W1-Safety-Capture-H205F22"
DOCUMENT_VERSION = "1"
DOCUMENT_HASH_TYPE = "Sha256"
PACKAGE_SOURCE_COMMIT = "73ab09c75b71a6ea40f11e953cbcf9d9b94b9a89"
PACKAGE_SOURCE_TREE = "c8ae850c8ce2ab9f688ae0525cbce55d39186d78"
PACKAGE_MANIFEST_SHA256 = "71f509fb4f8dd18117f48c8444698ef7127ded4a32beb73de548d3cfa67ee01a"
PACKAGE_ROOT = f"/opt/metaengine/w1/safety/{PACKAGE_SOURCE_COMMIT}"
EXECUTION_USER = "metaengine-w1"
WORKSPACE_ROOT = "/var/lib/metaengine/w1/workspace"
MAX_STDOUT_CHARS = 20_000
MAX_STDERR_CHARS = 8_000
MAX_BUNDLE_BYTES = 262_144

INSTANCE_ID = re.compile(r"^i-[0-9a-f]+$")
WORKER_ID = re.compile(r"^[A-Za-z0-9._:-]{3,160}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
ACCOUNT_ID = re.compile(r"^[0-9]{12}$")
REGION = re.compile(r"^[a-z]{2}(-gov)?-[a-z]+-[0-9]+$")
COMMAND_ID = re.compile(r"^[0-9a-fA-F-]{36}$")


class SSMSafetyCaptureError(RuntimeError):
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
        raise SSMSafetyCaptureError(f"{label}_invalid")
    return value


def required_instance_tags(worker_id: str) -> dict[str, str]:
    _require(worker_id, WORKER_ID, "worker_id")
    return {
        "metaengine:project": "H205F22",
        "metaengine:milestone": "W1_PERSISTENT_LINUX_WORKER_SAFETY",
        "metaengine:worker_id": worker_id,
        "metaengine:github_sha": PACKAGE_SOURCE_COMMIT,
        "metaengine:authority": "noncanonical-worker",
        "metaengine:execution_tier": "persistent-host",
    }


def validate_local_document(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SSMSafetyCaptureError("local_document_invalid")
    if set(value) != {"schemaVersion", "description", "parameters", "mainSteps"}:
        raise SSMSafetyCaptureError("local_document_shape_invalid")
    if value.get("schemaVersion") != "2.2":
        raise SSMSafetyCaptureError("local_document_schema_version_invalid")
    if value.get("parameters") != {}:
        raise SSMSafetyCaptureError("local_document_parameters_forbidden")
    steps = value.get("mainSteps")
    if not isinstance(steps, list) or len(steps) != 1 or not isinstance(steps[0], dict):
        raise SSMSafetyCaptureError("local_document_single_step_required")
    step = steps[0]
    if set(step) != {"action", "name", "inputs"}:
        raise SSMSafetyCaptureError("local_document_step_shape_invalid")
    if step.get("action") != "aws:runShellScript" or step.get("name") != "capturePinnedSafetyEvidence":
        raise SSMSafetyCaptureError("local_document_step_identity_invalid")
    inputs = step.get("inputs")
    if not isinstance(inputs, dict) or set(inputs) != {"timeoutSeconds", "runCommand"}:
        raise SSMSafetyCaptureError("local_document_inputs_invalid")
    if inputs.get("timeoutSeconds") != "60":
        raise SSMSafetyCaptureError("local_document_timeout_invalid")
    commands = inputs.get("runCommand")
    if not isinstance(commands, list) or len(commands) != 1 or not isinstance(commands[0], str):
        raise SSMSafetyCaptureError("local_document_run_command_invalid")
    command = commands[0]

    required_literals = (
        PACKAGE_SOURCE_COMMIT,
        PACKAGE_SOURCE_TREE,
        PACKAGE_MANIFEST_SHA256,
        PACKAGE_ROOT,
        EXECUTION_USER,
        WORKSPACE_ROOT,
        "runuser -u",
        "package_file_git_blob_mismatch",
        "workspace_group_world_writable",
        COURIER_SCHEMA,
        BUNDLE_SCHEMA,
        "'host_safety_verified':False",
        "'persistent_worker_proof':False",
        "'w1_verified':False",
        "'canonical':False",
        "'authority_effect':False",
    )
    for literal in required_literals:
        if literal not in command:
            raise SSMSafetyCaptureError(f"local_document_required_literal_missing:{literal}")

    forbidden = (
        "{{",
        "https://",
        "http://",
        "curl ",
        "wget ",
        "git clone",
        "git pull",
        "ssh ",
        "sudo ",
        "aws ",
        "AWS-RunDocument",
        "aws:runDocument",
        "s3://",
        "secretsmanager",
        "kms:Decrypt",
    )
    lowered = command.lower()
    for marker in forbidden:
        if marker.lower() in lowered:
            raise SSMSafetyCaptureError(f"local_document_forbidden_surface:{marker}")
    return value


def parse_local_document(source: bytes) -> dict[str, Any]:
    if not isinstance(source, bytes) or not source or len(source) > 128_000:
        raise SSMSafetyCaptureError("local_document_source_size_invalid")
    try:
        value = json.loads(source)
    except json.JSONDecodeError as exc:
        raise SSMSafetyCaptureError("local_document_json_invalid") from exc
    return validate_local_document(value)


def build_session_boundary(*, instance_id: str, worker_id: str, account_id: str, region: str, local_document_source: bytes) -> dict[str, Any]:
    _require(instance_id, INSTANCE_ID, "instance_id")
    _require(worker_id, WORKER_ID, "worker_id")
    _require(account_id, ACCOUNT_ID, "account_id")
    _require(region, REGION, "region")
    parse_local_document(local_document_source)

    partition = _partition(region)
    instance_arn = f"arn:{partition}:ec2:{region}:{account_id}:instance/{instance_id}"
    document_arn = f"arn:{partition}:ssm:{region}:{account_id}:document/{DOCUMENT_NAME}"
    tags = required_instance_tags(worker_id)
    tag_condition = {f"ssm:resourceTag/{key}": value for key, value in tags.items()}
    policy = {
        "Version": "2012-10-17",
        "Statement": [
            {"Sid": "ReadExactManagedNodeState", "Effect": "Allow", "Action": "ssm:DescribeInstanceInformation", "Resource": "*"},
            {"Sid": "ReadExactImmutableSafetyDocument", "Effect": "Allow", "Action": ["ssm:DescribeDocument", "ssm:GetDocument"], "Resource": document_arn},
            {"Sid": "SendOnlyExactImmutableSafetyDocument", "Effect": "Allow", "Action": "ssm:SendCommand", "Resource": document_arn},
            {"Sid": "SendOnlyExactTaggedW1Instance", "Effect": "Allow", "Action": "ssm:SendCommand", "Resource": instance_arn, "Condition": {"StringEquals": tag_condition}},
            {"Sid": "ReadExactCommandInvocationResult", "Effect": "Allow", "Action": "ssm:GetCommandInvocation", "Resource": "*"},
        ],
    }
    core = {
        "schema": BOUNDARY_SCHEMA,
        "classification": "W1_AWS_SSM_SAFETY_CAPTURE_SESSION_BOUNDARY_NONAUTHORITY",
        "instance_id": instance_id,
        "worker_id": worker_id,
        "account_id": account_id,
        "region": region,
        "instance_arn": instance_arn,
        "document_name": DOCUMENT_NAME,
        "document_version": DOCUMENT_VERSION,
        "document_arn": document_arn,
        "repository_document_source_sha256": _sha_bytes(local_document_source),
        "required_instance_tags": tags,
        "session_policy": policy,
        "package_source_commit_sha": PACKAGE_SOURCE_COMMIT,
        "package_source_tree_sha": PACKAGE_SOURCE_TREE,
        "package_manifest_sha256": PACKAGE_MANIFEST_SHA256,
        "arbitrary_command_parameters_allowed": False,
        "nested_document_execution_allowed": False,
        "document_mutation_allowed": False,
        "ssh_allowed": False,
        "start_session_allowed": False,
        "port_forwarding_allowed": False,
        "s3_output_allowed": False,
        "cloudwatch_output_allowed": False,
        "provider_mutation_allowed": False,
        "reboot_allowed": False,
        "host_safety_verified": False,
        "provider_identity_verified": False,
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
        raise SSMSafetyCaptureError("managed_node_response_invalid")
    items = value.get("InstanceInformationList")
    if not isinstance(items, list) or len(items) != 1 or not isinstance(items[0], dict):
        raise SSMSafetyCaptureError("managed_node_exact_singleton_required")
    node = items[0]
    if node.get("InstanceId") != expected_instance_id:
        raise SSMSafetyCaptureError("managed_node_instance_mismatch")
    if node.get("PingStatus") != "Online":
        raise SSMSafetyCaptureError("managed_node_not_online")
    if node.get("PlatformType") != "Linux" or node.get("ResourceType") != "EC2Instance":
        raise SSMSafetyCaptureError("managed_node_platform_invalid")
    return {"instance_id": expected_instance_id, "ping_status": "Online", "platform_type": "Linux", "resource_type": "EC2Instance", "agent_version": node.get("AgentVersion"), "last_ping_date_time": node.get("LastPingDateTime")}


def validate_remote_document(*, description: Any, get_document: Any, account_id: str, local_document_source: bytes) -> dict[str, Any]:
    _require(account_id, ACCOUNT_ID, "account_id")
    local = parse_local_document(local_document_source)
    if not isinstance(description, dict):
        raise SSMSafetyCaptureError("document_description_invalid")
    doc = description.get("Document") if isinstance(description.get("Document"), dict) else description
    if doc.get("Name") != DOCUMENT_NAME or doc.get("Owner") != account_id:
        raise SSMSafetyCaptureError("document_identity_mismatch")
    if doc.get("DocumentType") != "Command" or doc.get("Status") != "Active":
        raise SSMSafetyCaptureError("document_state_invalid")
    if str(doc.get("DocumentVersion")) != DOCUMENT_VERSION:
        raise SSMSafetyCaptureError("document_version_mismatch")
    aws_sha = doc.get("Hash")
    if doc.get("HashType") != DOCUMENT_HASH_TYPE or not isinstance(aws_sha, str) or SHA256.fullmatch(aws_sha) is None:
        raise SSMSafetyCaptureError("document_hash_invalid")
    platforms = doc.get("PlatformTypes")
    if not isinstance(platforms, list) or "Linux" not in platforms:
        raise SSMSafetyCaptureError("document_linux_platform_missing")

    if not isinstance(get_document, dict):
        raise SSMSafetyCaptureError("get_document_response_invalid")
    if get_document.get("Name") != DOCUMENT_NAME or str(get_document.get("DocumentVersion")) != DOCUMENT_VERSION:
        raise SSMSafetyCaptureError("get_document_identity_mismatch")
    if get_document.get("DocumentType") != "Command" or get_document.get("Status") != "Active":
        raise SSMSafetyCaptureError("get_document_state_invalid")
    content = get_document.get("Content")
    if not isinstance(content, str):
        raise SSMSafetyCaptureError("get_document_content_missing")
    try:
        remote = json.loads(content)
    except json.JSONDecodeError as exc:
        raise SSMSafetyCaptureError("get_document_content_invalid_json") from exc
    validate_local_document(remote)
    if _canonical(remote) != _canonical(local):
        raise SSMSafetyCaptureError("remote_document_content_mismatch")
    return {"name": DOCUMENT_NAME, "owner_account_id": account_id, "document_version": DOCUMENT_VERSION, "aws_document_sha256": aws_sha, "repository_document_source_sha256": _sha_bytes(local_document_source), "remote_content_matches_repository": True, "document_parameters": {}}


def build_command_plan(*, instance_id: str, aws_document_sha256: str, repository_document_source_sha256: str) -> dict[str, Any]:
    _require(instance_id, INSTANCE_ID, "instance_id")
    _require(aws_document_sha256, SHA256, "aws_document_sha256")
    _require(repository_document_source_sha256, SHA256, "repository_document_source_sha256")
    core = {
        "schema": PLAN_SCHEMA,
        "classification": "W1_AWS_SSM_SAFETY_CAPTURE_COMMAND_PLAN_NONAUTHORITY",
        "instance_ids": [instance_id],
        "document_name": DOCUMENT_NAME,
        "document_version": DOCUMENT_VERSION,
        "document_hash": aws_document_sha256,
        "document_hash_type": DOCUMENT_HASH_TYPE,
        "repository_document_source_sha256": repository_document_source_sha256,
        "timeout_seconds": 90,
        "parameters": {},
        "arbitrary_command_parameters_allowed": False,
        "nested_document_execution_allowed": False,
        "s3_output": False,
        "cloudwatch_output": False,
        "provider_mutation": False,
        "reboot_authorized": False,
        "host_safety_verified": False,
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
        raise SSMSafetyCaptureError("send_command_response_invalid")
    command = value["Command"]
    command_id = command.get("CommandId")
    if not isinstance(command_id, str) or COMMAND_ID.fullmatch(command_id) is None:
        raise SSMSafetyCaptureError("send_command_id_invalid")
    if command.get("DocumentName") != plan.get("document_name"):
        raise SSMSafetyCaptureError("send_command_document_mismatch")
    if str(command.get("DocumentVersion")) != plan.get("document_version"):
        raise SSMSafetyCaptureError("send_command_document_version_mismatch")
    if command.get("InstanceIds") != plan.get("instance_ids"):
        raise SSMSafetyCaptureError("send_command_instance_mismatch")
    if command.get("Parameters") not in ({}, None):
        raise SSMSafetyCaptureError("send_command_parameters_not_empty")
    return command_id


def _validate_bundle(raw: bytes) -> tuple[dict[str, Any], dict[str, Any]]:
    if not raw or len(raw) > MAX_BUNDLE_BYTES:
        raise SSMSafetyCaptureError("bundle_size_invalid")
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SSMSafetyCaptureError("bundle_json_invalid") from exc
    if not isinstance(value, dict) or value.get("schema") != BUNDLE_SCHEMA:
        raise SSMSafetyCaptureError("bundle_schema_invalid")
    obs = value.get("observation")
    if not isinstance(obs, dict) or obs.get("source") != {"git_sha": PACKAGE_SOURCE_COMMIT, "tree_sha": PACKAGE_SOURCE_TREE}:
        raise SSMSafetyCaptureError("bundle_source_mismatch")
    ctx = value.get("execution_context")
    if not isinstance(ctx, dict):
        raise SSMSafetyCaptureError("bundle_execution_context_missing")
    if ctx.get("execution_user") != EXECUTION_USER or ctx.get("workspace_root") != WORKSPACE_ROOT:
        raise SSMSafetyCaptureError("bundle_execution_context_mismatch")
    if ctx.get("effective_uid") in (None, 0):
        raise SSMSafetyCaptureError("bundle_execution_uid_invalid")
    if ctx.get("workspace_owned_by_execution_user") is not True or ctx.get("workspace_group_world_writable") is not False:
        raise SSMSafetyCaptureError("bundle_workspace_contract_invalid")
    authority = value.get("authority")
    if authority != {"canonical": False, "authority_effect": False, "database_mutation": False, "provider_mutation": False, "reboot_authorized": False, "worker_admitted": False, "w1_verified": False}:
        raise SSMSafetyCaptureError("bundle_authority_not_neutral")
    neutral = {key: item for key, item in value.items() if key not in {"schema", "bundle_sha256"}}
    if _sha(neutral) != value.get("bundle_sha256"):
        raise SSMSafetyCaptureError("bundle_self_hash_invalid")
    recomputed = safety_validator.evaluate(obs)
    if value.get("decision") != recomputed:
        raise SSMSafetyCaptureError("bundle_decision_mismatch")
    if value.get("safety_eligible") is not recomputed.get("safety_eligible"):
        raise SSMSafetyCaptureError("bundle_safety_flag_mismatch")
    return value, recomputed


def validate_courier(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SSMSafetyCaptureError("courier_invalid")
    required = {"schema", "source", "transport", "package_source_commit_sha", "package_source_tree_sha", "package_manifest_sha256", "bundle_base64", "bundle_transport_sha256", "bundle_safety_eligible", "host_safety_verified", "provider_identity_verified", "reboot_completion_proven", "persistent_worker_proof", "w1_verified", "canonical", "authority_effect"}
    if set(value) != required or value.get("schema") != COURIER_SCHEMA:
        raise SSMSafetyCaptureError("courier_shape_invalid")
    if value.get("source") != "HOST_UNTRUSTED_TRANSPORT" or value.get("transport") != "AWS_SSM_RUN_COMMAND_FIXED_DOCUMENT":
        raise SSMSafetyCaptureError("courier_transport_invalid")
    if value.get("package_source_commit_sha") != PACKAGE_SOURCE_COMMIT or value.get("package_source_tree_sha") != PACKAGE_SOURCE_TREE:
        raise SSMSafetyCaptureError("courier_package_source_mismatch")
    if value.get("package_manifest_sha256") != PACKAGE_MANIFEST_SHA256:
        raise SSMSafetyCaptureError("courier_manifest_mismatch")
    for key in ("host_safety_verified", "provider_identity_verified", "reboot_completion_proven", "persistent_worker_proof", "w1_verified", "canonical", "authority_effect"):
        if value.get(key) is not False:
            raise SSMSafetyCaptureError(f"courier_authority_injection:{key}")
    encoded = value.get("bundle_base64")
    if not isinstance(encoded, str) or not encoded:
        raise SSMSafetyCaptureError("courier_bundle_missing")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise SSMSafetyCaptureError("courier_bundle_base64_invalid") from exc
    if _sha_bytes(raw) != value.get("bundle_transport_sha256"):
        raise SSMSafetyCaptureError("courier_bundle_transport_hash_mismatch")
    bundle, decision = _validate_bundle(raw)
    if value.get("bundle_safety_eligible") is not decision.get("safety_eligible"):
        raise SSMSafetyCaptureError("courier_safety_flag_mismatch")
    return {"bundle": bundle, "decision": decision, "bundle_transport_sha256": value["bundle_transport_sha256"], "package_manifest_sha256": PACKAGE_MANIFEST_SHA256}


def validate_command_invocation(value: Any, *, expected_command_id: str, expected_instance_id: str) -> dict[str, Any]:
    _require(expected_command_id, COMMAND_ID, "expected_command_id")
    _require(expected_instance_id, INSTANCE_ID, "expected_instance_id")
    if not isinstance(value, dict):
        raise SSMSafetyCaptureError("command_invocation_invalid")
    if value.get("CommandId") != expected_command_id or value.get("InstanceId") != expected_instance_id:
        raise SSMSafetyCaptureError("command_invocation_identity_mismatch")
    if value.get("DocumentName") != DOCUMENT_NAME:
        raise SSMSafetyCaptureError("command_invocation_document_mismatch")
    if value.get("Status") != "Success":
        raise SSMSafetyCaptureError("command_invocation_not_success")
    stdout = value.get("StandardOutputContent")
    stderr = value.get("StandardErrorContent")
    if not isinstance(stdout, str) or not stdout or len(stdout) > MAX_STDOUT_CHARS:
        raise SSMSafetyCaptureError("command_invocation_stdout_invalid")
    if not isinstance(stderr, str) or len(stderr) > MAX_STDERR_CHARS or stderr.strip():
        raise SSMSafetyCaptureError("command_invocation_stderr_not_empty")
    try:
        courier = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise SSMSafetyCaptureError("command_invocation_stdout_json_invalid") from exc
    validated = validate_courier(courier)
    decision = validated["decision"]
    evidence = {"command_id": expected_command_id, "instance_id": expected_instance_id, "document_name": DOCUMENT_NAME, "document_version": DOCUMENT_VERSION, "package_source_commit_sha": PACKAGE_SOURCE_COMMIT, "package_source_tree_sha": PACKAGE_SOURCE_TREE, "package_manifest_sha256": PACKAGE_MANIFEST_SHA256, "bundle_transport_sha256": validated["bundle_transport_sha256"], "safety_outcome": decision["outcome"], "safety_eligible": decision["safety_eligible"], "offhost_decision_recomputed": True, "aws_api_response_provenance_verified": False}
    return {"schema": CAPTURE_SCHEMA, "classification": "W1_AWS_SSM_SAFETY_CAPTURE_VALIDATED_NONAUTHORITY", "evidence": evidence, "evidence_sha256": _sha(evidence), "capture_transport_validated": True, "host_safety_eligible_observed": bool(decision["safety_eligible"]), "host_safety_verified": False, "provider_identity_verified": False, "reboot_completion_proven": False, "persistent_worker_proof": False, "w1_verified": False, "canonical": False, "authority_effect": False}
