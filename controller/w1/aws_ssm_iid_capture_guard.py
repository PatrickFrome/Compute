#!/usr/bin/env python3
"""Fail-closed AWS SSM transport contract for W1 signed IID capture.

The execution role may send only an account-owned, parameterless, immutable version-1
SSM Command document to the exact tagged W1 EC2 instance. The role cannot create,
update, delete, or start an interactive SSM session. Returned IID bytes remain
untrusted transport until the independent pinned AWS IID verifier accepts them.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

from controller.w1 import aws_iid_courier_verifier as offhost

BOUNDARY_SCHEMA = "metaengine.compute.w1-aws-ssm-iid-session-boundary.h205f22.v2"
PLAN_SCHEMA = "metaengine.compute.w1-aws-ssm-iid-command-plan.h205f22.v2"
CAPTURE_SCHEMA = "metaengine.compute.w1-aws-ssm-iid-capture.h205f22.v2"
DOCUMENT_NAME = "Metaengine-W1-IID-Capture-H205F22"
DOCUMENT_VERSION = "1"
DOCUMENT_HASH_TYPE = "Sha256"
MAX_STDOUT_CHARS = 24000
MAX_STDERR_CHARS = 8000

INSTANCE_ID = re.compile(r"^i-[0-9a-f]+$")
WORKER_ID = re.compile(r"^[A-Za-z0-9._:-]{3,160}$")
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
ACCOUNT_ID = re.compile(r"^[0-9]{12}$")
REGION = re.compile(r"^[a-z]{2}(-gov)?-[a-z]+-[0-9]+$")
COMMAND_ID = re.compile(r"^[0-9a-fA-F-]{36}$")


class SSMCaptureError(RuntimeError):
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
        raise SSMCaptureError(f"{label}_invalid")
    return value


def required_instance_tags(worker_id: str, w1_sha: str) -> dict[str, str]:
    return {
        "metaengine:project": "H205F22",
        "metaengine:milestone": "W1_PERSISTENT_LINUX_WORKER_SAFETY",
        "metaengine:worker_id": worker_id,
        "metaengine:github_sha": w1_sha,
        "metaengine:authority": "noncanonical-worker",
        "metaengine:execution_tier": "persistent-host",
    }


def validate_local_document(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SSMCaptureError("local_document_invalid")
    if set(value) != {"schemaVersion", "description", "parameters", "mainSteps"}:
        raise SSMCaptureError("local_document_shape_invalid")
    if value.get("schemaVersion") != "2.2":
        raise SSMCaptureError("local_document_schema_version_invalid")
    if value.get("parameters") != {}:
        raise SSMCaptureError("local_document_parameters_forbidden")
    steps = value.get("mainSteps")
    if not isinstance(steps, list) or len(steps) != 1 or not isinstance(steps[0], dict):
        raise SSMCaptureError("local_document_single_step_required")
    step = steps[0]
    if set(step) != {"action", "name", "inputs"}:
        raise SSMCaptureError("local_document_step_shape_invalid")
    if step.get("action") != "aws:runShellScript" or step.get("name") != "captureSignedIID":
        raise SSMCaptureError("local_document_step_identity_invalid")
    inputs = step.get("inputs")
    if not isinstance(inputs, dict) or set(inputs) != {"timeoutSeconds", "runCommand"}:
        raise SSMCaptureError("local_document_inputs_invalid")
    if inputs.get("timeoutSeconds") != "30":
        raise SSMCaptureError("local_document_timeout_invalid")
    commands = inputs.get("runCommand")
    if not isinstance(commands, list) or len(commands) != 1 or not isinstance(commands[0], str):
        raise SSMCaptureError("local_document_run_command_invalid")
    command = commands[0]
    required_literals = (
        "169.254.169.254",
        "/latest/api/token",
        "/latest/dynamic/instance-identity/document",
        "/latest/dynamic/instance-identity/rsa2048",
        "HOST_UNTRUSTED_TRANSPORT",
        "AWS_IMDSV2_LINK_LOCAL_IPV4",
        '"provider_identity_verified":False',
        '"reboot_completion_proven":False',
        '"persistent_worker_proof":False',
        '"w1_verified":False',
        '"canonical":False',
        '"authority_effect":False',
    )
    for literal in required_literals:
        if literal not in command:
            raise SSMCaptureError(f"local_document_required_literal_missing:{literal}")
    for forbidden in ("{{", "https://", "curl ", "wget ", "git ", "ssh ", "sudo ", "aws "):
        if forbidden in command:
            raise SSMCaptureError(f"local_document_forbidden_surface:{forbidden}")
    return value


def parse_local_document(source: bytes) -> dict[str, Any]:
    if not isinstance(source, bytes) or not source or len(source) > 65536:
        raise SSMCaptureError("local_document_source_size_invalid")
    try:
        value = json.loads(source)
    except json.JSONDecodeError as exc:
        raise SSMCaptureError("local_document_json_invalid") from exc
    return validate_local_document(value)


def build_session_boundary(
    *,
    instance_id: str,
    worker_id: str,
    w1_sha: str,
    account_id: str,
    region: str,
    local_document_source: bytes,
) -> dict[str, Any]:
    _require(instance_id, INSTANCE_ID, "instance_id")
    _require(worker_id, WORKER_ID, "worker_id")
    _require(w1_sha, SHA40, "w1_sha")
    _require(account_id, ACCOUNT_ID, "account_id")
    _require(region, REGION, "region")
    parse_local_document(local_document_source)

    partition = _partition(region)
    instance_arn = f"arn:{partition}:ec2:{region}:{account_id}:instance/{instance_id}"
    document_arn = f"arn:{partition}:ssm:{region}:{account_id}:document/{DOCUMENT_NAME}"
    tags = required_instance_tags(worker_id, w1_sha)
    tag_condition = {f"ssm:resourceTag/{key}": value for key, value in tags.items()}

    policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "ReadExactManagedNodeState",
                "Effect": "Allow",
                "Action": "ssm:DescribeInstanceInformation",
                "Resource": "*",
            },
            {
                "Sid": "ReadExactImmutableCaptureDocument",
                "Effect": "Allow",
                "Action": ["ssm:DescribeDocument", "ssm:GetDocument"],
                "Resource": document_arn,
            },
            {
                "Sid": "SendOnlyExactImmutableCaptureDocument",
                "Effect": "Allow",
                "Action": "ssm:SendCommand",
                "Resource": document_arn,
            },
            {
                "Sid": "SendOnlyExactTaggedW1Instance",
                "Effect": "Allow",
                "Action": "ssm:SendCommand",
                "Resource": instance_arn,
                "Condition": {"StringEquals": tag_condition},
            },
            {
                "Sid": "ReadExactCommandInvocationResult",
                "Effect": "Allow",
                "Action": "ssm:GetCommandInvocation",
                "Resource": "*",
            },
        ],
    }
    core = {
        "schema": BOUNDARY_SCHEMA,
        "classification": "W1_AWS_SSM_IID_CAPTURE_SESSION_BOUNDARY_NONAUTHORITY",
        "instance_id": instance_id,
        "worker_id": worker_id,
        "w1_sha": w1_sha,
        "account_id": account_id,
        "region": region,
        "instance_arn": instance_arn,
        "document_name": DOCUMENT_NAME,
        "document_version": DOCUMENT_VERSION,
        "document_arn": document_arn,
        "repository_document_source_sha256": _sha_bytes(local_document_source),
        "required_instance_tags": tags,
        "session_policy": policy,
        "document_mutation_allowed": False,
        "arbitrary_command_parameters_allowed": False,
        "ssh_allowed": False,
        "start_session_allowed": False,
        "port_forwarding_allowed": False,
        "s3_output_allowed": False,
        "cloudwatch_output_allowed": False,
        "provider_identity_verified": False,
        "reboot_completion_proven": False,
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
        raise SSMCaptureError("managed_node_response_invalid")
    items = value.get("InstanceInformationList")
    if not isinstance(items, list) or len(items) != 1 or not isinstance(items[0], dict):
        raise SSMCaptureError("managed_node_exact_singleton_required")
    node = items[0]
    if node.get("InstanceId") != expected_instance_id:
        raise SSMCaptureError("managed_node_instance_mismatch")
    if node.get("PingStatus") != "Online":
        raise SSMCaptureError("managed_node_not_online")
    if node.get("PlatformType") != "Linux":
        raise SSMCaptureError("managed_node_not_linux")
    if node.get("ResourceType") != "EC2Instance":
        raise SSMCaptureError("managed_node_not_ec2")
    agent = node.get("AgentVersion")
    if not isinstance(agent, str) or not agent or len(agent) > 64 or not re.fullmatch(r"[0-9A-Za-z.+_-]+", agent):
        raise SSMCaptureError("managed_node_agent_version_invalid")
    return {
        "instance_id": expected_instance_id,
        "ping_status": "Online",
        "platform_type": "Linux",
        "resource_type": "EC2Instance",
        "agent_version": agent,
        "last_ping_date_time": node.get("LastPingDateTime"),
    }


def validate_remote_document(
    *,
    description: Any,
    get_document: Any,
    account_id: str,
    local_document_source: bytes,
) -> dict[str, Any]:
    _require(account_id, ACCOUNT_ID, "account_id")
    local = parse_local_document(local_document_source)
    if not isinstance(description, dict):
        raise SSMCaptureError("document_description_invalid")
    doc = description.get("Document") if isinstance(description.get("Document"), dict) else description
    if doc.get("Name") != DOCUMENT_NAME:
        raise SSMCaptureError("document_name_mismatch")
    if doc.get("Owner") != account_id:
        raise SSMCaptureError("document_owner_account_mismatch")
    if doc.get("DocumentType") != "Command" or doc.get("Status") != "Active":
        raise SSMCaptureError("document_state_invalid")
    if str(doc.get("DocumentVersion")) != DOCUMENT_VERSION:
        raise SSMCaptureError("document_version_mismatch")
    aws_sha = doc.get("Hash")
    if doc.get("HashType") != DOCUMENT_HASH_TYPE or not isinstance(aws_sha, str) or SHA256.fullmatch(aws_sha) is None:
        raise SSMCaptureError("document_hash_invalid")
    platforms = doc.get("PlatformTypes")
    if not isinstance(platforms, list) or "Linux" not in platforms:
        raise SSMCaptureError("document_linux_platform_missing")

    if not isinstance(get_document, dict):
        raise SSMCaptureError("get_document_response_invalid")
    if get_document.get("Name") != DOCUMENT_NAME or str(get_document.get("DocumentVersion")) != DOCUMENT_VERSION:
        raise SSMCaptureError("get_document_identity_mismatch")
    if get_document.get("DocumentType") != "Command" or get_document.get("Status") != "Active":
        raise SSMCaptureError("get_document_state_invalid")
    content = get_document.get("Content")
    if not isinstance(content, str):
        raise SSMCaptureError("get_document_content_missing")
    try:
        remote = json.loads(content)
    except json.JSONDecodeError as exc:
        raise SSMCaptureError("get_document_content_invalid_json") from exc
    validate_local_document(remote)
    if _canonical(remote) != _canonical(local):
        raise SSMCaptureError("remote_document_content_mismatch")

    return {
        "name": DOCUMENT_NAME,
        "owner_account_id": account_id,
        "document_type": "Command",
        "document_version": DOCUMENT_VERSION,
        "hash_type": DOCUMENT_HASH_TYPE,
        "aws_document_sha256": aws_sha,
        "repository_document_source_sha256": _sha_bytes(local_document_source),
        "remote_content_matches_repository": True,
        "linux_supported": True,
        "document_parameters": {},
    }


def build_command_plan(
    *,
    instance_id: str,
    aws_document_sha256: str,
    repository_document_source_sha256: str,
) -> dict[str, Any]:
    _require(instance_id, INSTANCE_ID, "instance_id")
    _require(aws_document_sha256, SHA256, "aws_document_sha256")
    _require(repository_document_source_sha256, SHA256, "repository_document_source_sha256")
    core = {
        "schema": PLAN_SCHEMA,
        "classification": "W1_AWS_SSM_IID_CAPTURE_COMMAND_PLAN_NONAUTHORITY",
        "instance_ids": [instance_id],
        "document_name": DOCUMENT_NAME,
        "document_version": DOCUMENT_VERSION,
        "document_hash": aws_document_sha256,
        "document_hash_type": DOCUMENT_HASH_TYPE,
        "repository_document_source_sha256": repository_document_source_sha256,
        "timeout_seconds": 60,
        "parameters": {},
        "arbitrary_command_parameters_allowed": False,
        "command_output_contract": "STDOUT_EXACTLY_ONE_IID_COURIER_JSON_OBJECT",
        "contains_secrets": False,
        "s3_output": False,
        "cloudwatch_output": False,
        "provider_identity_verified": False,
        "reboot_completion_proven": False,
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
        raise SSMCaptureError("send_command_response_invalid")
    command = value["Command"]
    command_id = command.get("CommandId")
    if not isinstance(command_id, str) or COMMAND_ID.fullmatch(command_id) is None:
        raise SSMCaptureError("send_command_id_invalid")
    if command.get("DocumentName") != plan.get("document_name"):
        raise SSMCaptureError("send_command_document_mismatch")
    if str(command.get("DocumentVersion")) != plan.get("document_version"):
        raise SSMCaptureError("send_command_document_version_mismatch")
    if command.get("InstanceIds") != plan.get("instance_ids"):
        raise SSMCaptureError("send_command_instance_mismatch")
    parameters = command.get("Parameters", {})
    if parameters != {}:
        raise SSMCaptureError("send_command_parameters_forbidden")
    return command_id


def validate_invocation(
    value: Any,
    *,
    command_id: str,
    instance_id: str,
    aws_document_sha256: str,
    repository_document_source_sha256: str,
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SSMCaptureError("command_invocation_invalid")
    if value.get("CommandId") != command_id or value.get("InstanceId") != instance_id:
        raise SSMCaptureError("command_invocation_identity_mismatch")
    if value.get("DocumentName") != DOCUMENT_NAME or str(value.get("DocumentVersion")) != DOCUMENT_VERSION:
        raise SSMCaptureError("command_invocation_document_mismatch")
    if value.get("Status") != "Success" or value.get("ResponseCode") != 0:
        raise SSMCaptureError("command_invocation_not_success")
    stderr = value.get("StandardErrorContent", "")
    if not isinstance(stderr, str) or len(stderr) > MAX_STDERR_CHARS or stderr.strip():
        raise SSMCaptureError("command_invocation_stderr_not_empty")
    stdout = value.get("StandardOutputContent")
    if not isinstance(stdout, str) or not stdout.strip() or len(stdout) > MAX_STDOUT_CHARS:
        raise SSMCaptureError("command_invocation_stdout_invalid")
    try:
        envelope = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise SSMCaptureError("command_invocation_stdout_not_json") from exc
    try:
        offhost.decode_untrusted_envelope(envelope)
    except offhost.CourierVerificationError as exc:
        raise SSMCaptureError(f"command_invocation_courier_rejected:{exc}") from exc

    core = {
        "schema": CAPTURE_SCHEMA,
        "classification": "W1_AWS_SSM_IID_CAPTURE_UNTRUSTED_TRANSPORT_RECEIPT",
        "command_id": command_id,
        "instance_id": instance_id,
        "document_name": DOCUMENT_NAME,
        "document_version": DOCUMENT_VERSION,
        "aws_document_sha256": aws_document_sha256,
        "repository_document_source_sha256": repository_document_source_sha256,
        "ssm_status": "Success",
        "response_code": 0,
        "courier_envelope": envelope,
        "courier_envelope_sha256": _sha(envelope),
        "provider_identity_verified": False,
        "reboot_completion_proven": False,
        "persistent_worker_proof": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
        "required_next": "OFFHOST_PINNED_AWS_IID_CRYPTOGRAPHIC_VERIFICATION",
    }
    result = copy.deepcopy(core)
    result["receipt_sha256"] = _sha(core)
    return result


def _write_json(path: str, value: Any) -> None:
    Path(path).write_text(json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("build-boundary")
    p.add_argument("--instance-id", required=True)
    p.add_argument("--worker-id", required=True)
    p.add_argument("--w1-sha", required=True)
    p.add_argument("--account-id", required=True)
    p.add_argument("--region", required=True)
    p.add_argument("--document-source", required=True)
    p.add_argument("--output", required=True)

    args = parser.parse_args(argv)
    try:
        source = Path(args.document_source).read_bytes()
        result = build_session_boundary(
            instance_id=args.instance_id,
            worker_id=args.worker_id,
            w1_sha=args.w1_sha,
            account_id=args.account_id,
            region=args.region,
            local_document_source=source,
        )
        _write_json(args.output, result)
        return 0
    except (OSError, SSMCaptureError) as exc:
        print(f"W1_AWS_SSM_IID_CAPTURE_REJECTED:{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
