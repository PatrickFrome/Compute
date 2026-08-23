#!/usr/bin/env python3
"""Fail-closed AWS SSM transport contract for W1 signed IID capture.

This module does not call AWS, obtain credentials, execute commands, or persist evidence.
It builds and validates the narrow Systems Manager Run Command boundary needed to move
raw IID bytes off the exact W1 EC2 host without opening SSH or granting host identity
authority.
"""
from __future__ import annotations

import argparse
import base64
import copy
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

from controller.w1 import aws_iid_courier_verifier as offhost

BOUNDARY_SCHEMA = "metaengine.compute.w1-aws-ssm-iid-session-boundary.h205f22.v1"
PLAN_SCHEMA = "metaengine.compute.w1-aws-ssm-iid-command-plan.h205f22.v1"
CAPTURE_SCHEMA = "metaengine.compute.w1-aws-ssm-iid-capture.h205f22.v1"
DOCUMENT_NAME = "AWS-RunShellScript"
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


def build_session_boundary(
    *,
    instance_id: str,
    worker_id: str,
    w1_sha: str,
    account_id: str,
    region: str,
    document_sha256: str,
) -> dict[str, Any]:
    _require(instance_id, INSTANCE_ID, "instance_id")
    _require(worker_id, WORKER_ID, "worker_id")
    _require(w1_sha, SHA40, "w1_sha")
    _require(account_id, ACCOUNT_ID, "account_id")
    _require(region, REGION, "region")
    _require(document_sha256, SHA256, "document_sha256")

    partition = _partition(region)
    instance_arn = f"arn:{partition}:ec2:{region}:{account_id}:instance/{instance_id}"
    document_arn = f"arn:{partition}:ssm:{region}::document/{DOCUMENT_NAME}"
    tags = required_instance_tags(worker_id, w1_sha)
    tag_condition = {f"ssm:resourceTag/{key}": value for key, value in tags.items()}

    # SendCommand is intentionally split across document and instance resources.
    # The tag condition belongs only to the instance-resource statement.
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
                "Sid": "ReadPinnedRunShellScriptDocument",
                "Effect": "Allow",
                "Action": ["ssm:DescribeDocument", "ssm:GetDocument"],
                "Resource": document_arn,
            },
            {
                "Sid": "SendOnlyPinnedRunShellScriptDocument",
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
        "document_sha256": document_sha256,
        "document_arn": document_arn,
        "required_instance_tags": tags,
        "session_policy": policy,
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


def validate_document_description(value: Any, *, expected_sha256: str) -> dict[str, Any]:
    _require(expected_sha256, SHA256, "expected_document_sha256")
    if not isinstance(value, dict):
        raise SSMCaptureError("document_description_invalid")
    doc = value.get("Document") if isinstance(value.get("Document"), dict) else value
    if doc.get("Name") != DOCUMENT_NAME:
        raise SSMCaptureError("document_name_mismatch")
    if doc.get("Owner") != "Amazon":
        raise SSMCaptureError("document_owner_not_amazon")
    if doc.get("DocumentType") != "Command" or doc.get("Status") != "Active":
        raise SSMCaptureError("document_state_invalid")
    if str(doc.get("DefaultVersion")) != DOCUMENT_VERSION:
        raise SSMCaptureError("document_default_version_mismatch")
    if doc.get("HashType") != DOCUMENT_HASH_TYPE or doc.get("Hash") != expected_sha256:
        raise SSMCaptureError("document_hash_mismatch")
    platforms = doc.get("PlatformTypes")
    if not isinstance(platforms, list) or "Linux" not in platforms:
        raise SSMCaptureError("document_linux_platform_missing")
    return {
        "name": DOCUMENT_NAME,
        "owner": "Amazon",
        "document_type": "Command",
        "document_version": DOCUMENT_VERSION,
        "hash_type": DOCUMENT_HASH_TYPE,
        "sha256": expected_sha256,
        "linux_supported": True,
    }


def build_command_plan(*, instance_id: str, document_sha256: str, courier_source: bytes) -> dict[str, Any]:
    _require(instance_id, INSTANCE_ID, "instance_id")
    _require(document_sha256, SHA256, "document_sha256")
    if not isinstance(courier_source, bytes) or not courier_source or len(courier_source) > 32768:
        raise SSMCaptureError("courier_source_size_invalid")
    source_sha = _sha_bytes(courier_source)
    source_b64 = base64.b64encode(courier_source).decode("ascii")
    command = "\n".join([
        "set -euo pipefail",
        "umask 077",
        "TMPDIR_W1=\"$(mktemp -d /tmp/metaengine-w1-iid.XXXXXX)\"",
        "trap 'rm -rf \"$TMPDIR_W1\"' EXIT HUP INT TERM",
        f"printf '%s' '{source_b64}' | base64 -d > \"$TMPDIR_W1/courier.py\"",
        f"printf '%s  %s\\n' '{source_sha}' \"$TMPDIR_W1/courier.py\" | sha256sum -c - >/dev/null",
        "python3 \"$TMPDIR_W1/courier.py\" --output \"$TMPDIR_W1/envelope.json\"",
        "cat \"$TMPDIR_W1/envelope.json\"",
    ])
    core = {
        "schema": PLAN_SCHEMA,
        "classification": "W1_AWS_SSM_IID_CAPTURE_COMMAND_PLAN_NONAUTHORITY",
        "instance_ids": [instance_id],
        "document_name": DOCUMENT_NAME,
        "document_version": DOCUMENT_VERSION,
        "document_hash": document_sha256,
        "document_hash_type": DOCUMENT_HASH_TYPE,
        "timeout_seconds": 60,
        "parameters": {"commands": [command], "executionTimeout": ["30"]},
        "courier_source_sha256": source_sha,
        "courier_source_size": len(courier_source),
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
    if command.get("Parameters") != plan.get("parameters"):
        raise SSMCaptureError("send_command_parameters_mismatch")
    return command_id


def validate_invocation(
    value: Any,
    *,
    command_id: str,
    instance_id: str,
    document_sha256: str,
    courier_source_sha256: str,
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
        "document_sha256": document_sha256,
        "courier_source_sha256": courier_source_sha256,
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


def _load_json(path: str) -> Any:
    try:
        return json.loads(Path(path).read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise SSMCaptureError(f"invalid_json:{path}") from exc


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
    p.add_argument("--document-sha256", required=True)
    p.add_argument("--output", required=True)

    p = sub.add_parser("build-plan")
    p.add_argument("--instance-id", required=True)
    p.add_argument("--document-sha256", required=True)
    p.add_argument("--courier-source", required=True)
    p.add_argument("--output", required=True)

    args = parser.parse_args(argv)
    try:
        if args.command == "build-boundary":
            result = build_session_boundary(
                instance_id=args.instance_id,
                worker_id=args.worker_id,
                w1_sha=args.w1_sha,
                account_id=args.account_id,
                region=args.region,
                document_sha256=args.document_sha256,
            )
        else:
            result = build_command_plan(
                instance_id=args.instance_id,
                document_sha256=args.document_sha256,
                courier_source=Path(args.courier_source).read_bytes(),
            )
        _write_json(args.output, result)
        return 0
    except (OSError, SSMCaptureError) as exc:
        print(f"W1_AWS_SSM_IID_CAPTURE_REJECTED:{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
