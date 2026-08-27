#!/usr/bin/env python3
"""Independent read-only provenance compositor for W1 SSM safety provisioning.

Trust split:
- a provisioning OIDC session may SendCommand only for the exact immutable W1
  provisioning document and exact tagged host;
- a separate verifier OIDC session has read-only EC2/SSM/CloudTrail access and
  cannot SendCommand, reboot, start sessions, mutate documents, or touch the DB;
- AWS-signed EC2 Instance Identity verification is delegated to the existing
  aws_instance_identity_verifier and cross-bound here to EC2/SSM/CloudTrail.

A successful composition can prove only package provisioning on the bound host.
It does NOT prove the active host-safety envelope, persistence across reboot,
worker admission, W1 verification, or canonical authority.
"""
from __future__ import annotations

import argparse
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Any

from controller.w1 import aws_instance_identity_verifier as iid_verifier
from controller.w1 import aws_provider_reboot_controller as provider_guard
from controller.w1 import aws_ssm_safety_provision_guard as provision_guard
from controller.w1 import build_host_safety_package as package_builder


VERIFIER_BOUNDARY_SCHEMA = "metaengine.compute.w1-aws-ssm-safety-provision-verifier-boundary.h205f22.v1"
PROVENANCE_SCHEMA = "metaengine.compute.w1-aws-ssm-safety-provision-provenance.h205f22.v1"
CLASSIFICATION = "LIVE_AWS_SSM_PACKAGE_PROVISIONING_VERIFIED_UNINGESTED"

INSTANCE_ID = re.compile(r"^i-[0-9a-f]+$")
ACCOUNT_ID = re.compile(r"^[0-9]{12}$")
REGION = re.compile(r"^[a-z]{2}(-gov)?-[a-z]+-[0-9]+$")
ROLE_SESSION = re.compile(r"^[A-Za-z0-9+=,.@_-]{2,64}$")
IAM_ROLE_ARN = re.compile(r"^arn:(aws|aws-us-gov|aws-cn):iam::([0-9]{12}):role/([A-Za-z0-9+=,.@_/-]{1,512})$")
COMMAND_ID = re.compile(r"^[0-9a-fA-F-]{36}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")


class ProvisionProvenanceError(RuntimeError):
    pass


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def _require(value: Any, pattern: re.Pattern[str], label: str) -> str:
    if not isinstance(value, str) or pattern.fullmatch(value) is None:
        raise ProvisionProvenanceError(f"{label}_invalid")
    return value


def _parse_time(value: Any, label: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise ProvisionProvenanceError(f"{label}_missing")
    text = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as exc:
        raise ProvisionProvenanceError(f"{label}_invalid") from exc
    if parsed.tzinfo is None:
        raise ProvisionProvenanceError(f"{label}_timezone_required")
    return parsed.astimezone(timezone.utc)


def _partition(region: str) -> str:
    if region.startswith("us-gov-"):
        return "aws-us-gov"
    if region.startswith("cn-"):
        return "aws-cn"
    return "aws"


def build_verifier_session_boundary(*, account_id: str, region: str) -> dict[str, Any]:
    """Return a read-only AWS session policy for independent provenance checks."""
    _require(account_id, ACCOUNT_ID, "account_id")
    _require(region, REGION, "region")
    partition = _partition(region)
    document_arn = f"arn:{partition}:ssm:{region}:{account_id}:document/{provision_guard.DOCUMENT_NAME}"
    policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "ReadExactProviderHostBinding",
                "Effect": "Allow",
                "Action": ["ec2:DescribeInstances", "ec2:DescribeVolumes", "ec2:DescribeSecurityGroups"],
                "Resource": "*",
            },
            {
                "Sid": "ReadExactManagedNodeState",
                "Effect": "Allow",
                "Action": "ssm:DescribeInstanceInformation",
                "Resource": "*",
            },
            {
                "Sid": "ReadExactProvisionDocument",
                "Effect": "Allow",
                "Action": ["ssm:DescribeDocument", "ssm:GetDocument"],
                "Resource": document_arn,
            },
            {
                "Sid": "ReadCommandInvocationOnly",
                "Effect": "Allow",
                "Action": "ssm:GetCommandInvocation",
                "Resource": "*",
            },
            {
                "Sid": "ReadProvisionAuditEvent",
                "Effect": "Allow",
                "Action": "cloudtrail:LookupEvents",
                "Resource": "*",
            },
        ],
    }
    core = {
        "schema": VERIFIER_BOUNDARY_SCHEMA,
        "classification": "W1_AWS_SSM_PROVISION_VERIFIER_READONLY_NONAUTHORITY",
        "account_id": account_id,
        "region": region,
        "document_name": provision_guard.DOCUMENT_NAME,
        "document_version": provision_guard.DOCUMENT_VERSION,
        "document_arn": document_arn,
        "session_policy": policy,
        "send_command_allowed": False,
        "start_session_allowed": False,
        "document_mutation_allowed": False,
        "reboot_allowed": False,
        "instance_lifecycle_mutation_allowed": False,
        "database_mutation_allowed": False,
        "package_provisioning_verified": False,
        "host_safety_verified": False,
        "persistent_worker_proof": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }
    out = copy.deepcopy(core)
    out["receipt_sha256"] = _sha(core)
    return out


def validate_verifier_caller(value: Any, *, account_id: str) -> dict[str, str]:
    _require(account_id, ACCOUNT_ID, "account_id")
    if not isinstance(value, dict):
        raise ProvisionProvenanceError("verifier_caller_identity_invalid")
    if value.get("Account") != account_id:
        raise ProvisionProvenanceError("verifier_caller_account_mismatch")
    arn = value.get("Arn")
    user_id = value.get("UserId")
    if not isinstance(arn, str) or f":sts::{account_id}:assumed-role/" not in arn:
        raise ProvisionProvenanceError("verifier_caller_must_be_assumed_role")
    if not isinstance(user_id, str) or not user_id:
        raise ProvisionProvenanceError("verifier_caller_user_id_missing")
    return {"account_id": account_id, "arn": arn, "user_id": user_id}


def validate_verified_iid(
    value: Any, *, instance_id: str, account_id: str, region: str
) -> dict[str, Any]:
    _require(instance_id, INSTANCE_ID, "instance_id")
    _require(account_id, ACCOUNT_ID, "account_id")
    _require(region, REGION, "region")
    if not isinstance(value, dict) or value.get("schema") != iid_verifier.VERIFICATION_SCHEMA:
        raise ProvisionProvenanceError("verified_iid_schema_invalid")
    if value.get("identity_attestation_verified") is not True:
        raise ProvisionProvenanceError("verified_iid_not_verified")
    for key in ("canonical", "authority_effect", "persistent_worker_proof", "w1_verified"):
        if value.get(key) is not False:
            raise ProvisionProvenanceError(f"verified_iid_authority_boundary_invalid:{key}")
    evidence = value.get("evidence")
    if not isinstance(evidence, dict):
        raise ProvisionProvenanceError("verified_iid_evidence_invalid")
    if evidence.get("provider_kind") != "AWS_EC2":
        raise ProvisionProvenanceError("verified_iid_provider_invalid")
    if evidence.get("provider_instance_id") != instance_id:
        raise ProvisionProvenanceError("verified_iid_instance_mismatch")
    if evidence.get("provider_account_id") != account_id:
        raise ProvisionProvenanceError("verified_iid_account_mismatch")
    if evidence.get("region") != region:
        raise ProvisionProvenanceError("verified_iid_region_mismatch")
    if value.get("verification_receipt_sha256") != _sha(evidence):
        raise ProvisionProvenanceError("verified_iid_receipt_hash_mismatch")
    return copy.deepcopy(evidence)


def validate_strict_command_invocation(
    value: Any, *, command_id: str, instance_id: str
) -> dict[str, Any]:
    """Add version/response/plugin/time checks above the transport guard."""
    base = provision_guard.validate_command_invocation(
        value,
        expected_command_id=command_id,
        expected_instance_id=instance_id,
    )
    if str(value.get("DocumentVersion")) != provision_guard.DOCUMENT_VERSION:
        raise ProvisionProvenanceError("command_invocation_document_version_mismatch")
    if value.get("PluginName") != "installPinnedSafetyPackage":
        raise ProvisionProvenanceError("command_invocation_plugin_mismatch")
    if value.get("ResponseCode") != 0:
        raise ProvisionProvenanceError("command_invocation_response_code_nonzero")
    if value.get("StatusDetails") not in (None, "Success"):
        raise ProvisionProvenanceError("command_invocation_status_details_invalid")
    started = _parse_time(value.get("ExecutionStartDateTime"), "command_execution_started_at")
    ended = _parse_time(value.get("ExecutionEndDateTime"), "command_execution_ended_at")
    if ended < started:
        raise ProvisionProvenanceError("command_execution_time_reversed")
    return {
        "transport_receipt": base,
        "command_id": command_id,
        "instance_id": instance_id,
        "document_version": provision_guard.DOCUMENT_VERSION,
        "plugin_name": "installPinnedSafetyPackage",
        "response_code": 0,
        "execution_started_at": started.isoformat(),
        "execution_ended_at": ended.isoformat(),
    }


def _event_identity_matches(raw: dict[str, Any], *, role_arn: str, role_session: str, account_id: str) -> bool:
    identity = raw.get("userIdentity")
    if not isinstance(identity, dict) or identity.get("type") != "AssumedRole":
        return False
    if identity.get("accountId") != account_id:
        return False
    issuer = ((identity.get("sessionContext") or {}).get("sessionIssuer") or {})
    if issuer.get("arn") != role_arn or issuer.get("accountId") != account_id:
        return False
    arn = identity.get("arn")
    principal_id = identity.get("principalId")
    return (
        isinstance(arn, str)
        and arn.endswith("/" + role_session)
        and isinstance(principal_id, str)
        and principal_id.endswith(":" + role_session)
    )


def _command_from_response_elements(raw: dict[str, Any]) -> dict[str, Any] | None:
    response = raw.get("responseElements")
    if not isinstance(response, dict):
        return None
    for key in ("command", "Command"):
        command = response.get(key)
        if isinstance(command, dict):
            return command
    return None


def select_send_command_event(
    lookup: Any,
    *,
    instance_id: str,
    account_id: str,
    region: str,
    provisioner_role_arn: str,
    role_session: str,
    requested_at: str,
    api_returned_at: str,
    aws_document_sha256: str,
) -> dict[str, Any]:
    _require(instance_id, INSTANCE_ID, "instance_id")
    _require(account_id, ACCOUNT_ID, "account_id")
    _require(region, REGION, "region")
    _require(role_session, ROLE_SESSION, "role_session")
    _require(aws_document_sha256, SHA256, "aws_document_sha256")
    role_match = IAM_ROLE_ARN.fullmatch(provisioner_role_arn or "")
    if role_match is None or role_match.group(2) != account_id:
        raise ProvisionProvenanceError("provisioner_role_arn_invalid")

    request_time = _parse_time(requested_at, "requested_at")
    returned_time = _parse_time(api_returned_at, "api_returned_at")
    if returned_time < request_time:
        raise ProvisionProvenanceError("api_returned_before_request")
    lower = request_time - timedelta(minutes=2)
    upper = returned_time + timedelta(minutes=2)

    if not isinstance(lookup, dict) or not isinstance(lookup.get("Events"), list):
        raise ProvisionProvenanceError("cloudtrail_lookup_invalid")

    matches: list[tuple[datetime, dict[str, Any]]] = []
    for wrapper in lookup["Events"]:
        if not isinstance(wrapper, dict) or wrapper.get("EventName") != "SendCommand":
            continue
        raw_text = wrapper.get("CloudTrailEvent")
        if not isinstance(raw_text, str):
            continue
        try:
            raw = json.loads(raw_text)
        except json.JSONDecodeError:
            continue
        if raw.get("eventSource") != "ssm.amazonaws.com" or raw.get("eventName") != "SendCommand":
            continue
        if raw.get("awsRegion") != region or raw.get("recipientAccountId") != account_id:
            continue
        if not _event_identity_matches(
            raw,
            role_arn=provisioner_role_arn,
            role_session=role_session,
            account_id=account_id,
        ):
            continue
        try:
            event_time = _parse_time(raw.get("eventTime") or wrapper.get("EventTime"), "cloudtrail_event_time")
        except ProvisionProvenanceError:
            continue
        if not (lower <= event_time <= upper):
            continue

        request = raw.get("requestParameters")
        if not isinstance(request, dict):
            continue
        if request.get("documentName") != provision_guard.DOCUMENT_NAME:
            continue
        if str(request.get("documentVersion")) != provision_guard.DOCUMENT_VERSION:
            continue
        if request.get("documentHash") != aws_document_sha256 or request.get("documentHashType") != provision_guard.DOCUMENT_HASH_TYPE:
            continue
        if request.get("instanceIds") != [instance_id]:
            continue
        if request.get("parameters") not in (None, {}):
            continue
        forbidden_nonempty = (
            "targets",
            "serviceRoleArn",
            "notificationConfig",
            "outputS3BucketName",
            "outputS3KeyPrefix",
            "cloudWatchOutputConfig",
        )
        if any(request.get(key) not in (None, "", {}, []) for key in forbidden_nonempty):
            continue

        command = _command_from_response_elements(raw)
        if command is None:
            continue
        command_id = command.get("commandId") or command.get("CommandId")
        if not isinstance(command_id, str) or COMMAND_ID.fullmatch(command_id) is None:
            continue
        command_document = command.get("documentName") or command.get("DocumentName")
        command_version = command.get("documentVersion") or command.get("DocumentVersion")
        command_instances = command.get("instanceIds") or command.get("InstanceIds")
        command_parameters = command.get("parameters") if "parameters" in command else command.get("Parameters")
        if command_document != provision_guard.DOCUMENT_NAME:
            continue
        if str(command_version) != provision_guard.DOCUMENT_VERSION:
            continue
        if command_instances != [instance_id]:
            continue
        if command_parameters not in (None, {}):
            continue
        event_id = raw.get("eventID")
        if not isinstance(event_id, str) or not event_id:
            continue
        matches.append(
            (
                event_time,
                {
                    "event_id": event_id,
                    "event_time": event_time.isoformat(),
                    "command_id": command_id,
                    "provisioner_role_arn": provisioner_role_arn,
                    "role_session": role_session,
                    "request_parameters_sha256": _sha(request),
                    "cloudtrail_event_sha256": _sha(raw),
                },
            )
        )

    if len(matches) != 1:
        raise ProvisionProvenanceError("exact_single_matching_send_command_event_required")
    return matches[0][1]


def compose_provisioning_provenance(
    *,
    instance_id: str,
    worker_id: str,
    account_id: str,
    region: str,
    provisioner_role_arn: str,
    role_session: str,
    requested_at: str,
    api_returned_at: str,
    verifier_caller_identity: Any,
    preflight_bundle: Any,
    managed_node_response: Any,
    document_description: Any,
    get_document_response: Any,
    cloudtrail_lookup: Any,
    command_invocation: Any,
    verified_iid: Any,
) -> dict[str, Any]:
    _require(instance_id, INSTANCE_ID, "instance_id")
    _require(account_id, ACCOUNT_ID, "account_id")
    _require(region, REGION, "region")
    if not isinstance(worker_id, str) or provision_guard.WORKER_ID.fullmatch(worker_id) is None:
        raise ProvisionProvenanceError("worker_id_invalid")

    verifier = validate_verifier_caller(verifier_caller_identity, account_id=account_id)
    preflight = provider_guard.validate_preflight_bundle(
        preflight_bundle,
        instance_id=instance_id,
        worker_id=worker_id,
        expected_worker_sha=package_builder.SOURCE_COMMIT,
    )
    managed_node = provision_guard.validate_managed_node(
        managed_node_response,
        expected_instance_id=instance_id,
    )
    remote_document = provision_guard.validate_remote_document(
        description=document_description,
        get_document=get_document_response,
        account_id=account_id,
    )
    identity = validate_verified_iid(
        verified_iid,
        instance_id=instance_id,
        account_id=account_id,
        region=region,
    )

    if preflight.get("image_id") != identity.get("image_id"):
        raise ProvisionProvenanceError("iid_preflight_image_mismatch")
    if preflight.get("availability_zone") != identity.get("availability_zone"):
        raise ProvisionProvenanceError("iid_preflight_availability_zone_mismatch")

    cloudtrail = select_send_command_event(
        cloudtrail_lookup,
        instance_id=instance_id,
        account_id=account_id,
        region=region,
        provisioner_role_arn=provisioner_role_arn,
        role_session=role_session,
        requested_at=requested_at,
        api_returned_at=api_returned_at,
        aws_document_sha256=remote_document["aws_document_sha256"],
    )
    invocation = validate_strict_command_invocation(
        command_invocation,
        command_id=cloudtrail["command_id"],
        instance_id=instance_id,
    )

    transport = invocation["transport_receipt"]
    if transport["evidence"].get("package_sha256") != remote_document["package_sha256"]:
        raise ProvisionProvenanceError("invocation_document_package_binding_mismatch")
    if transport["evidence"].get("payload_lock_sha256") != remote_document["payload_lock_sha256"]:
        raise ProvisionProvenanceError("invocation_document_payload_lock_binding_mismatch")

    evidence = {
        "provider_kind": "AWS_EC2",
        "instance_id": instance_id,
        "worker_id": worker_id,
        "account_id": account_id,
        "region": region,
        "verifier_caller": verifier,
        "provisioner_role_arn": provisioner_role_arn,
        "provisioner_role_session": role_session,
        "cloudtrail": cloudtrail,
        "preflight_sha256": _sha(preflight),
        "managed_node_sha256": _sha(managed_node),
        "signed_iid_receipt_sha256": verified_iid["verification_receipt_sha256"],
        "signed_iid_document_sha256": identity.get("document_sha256"),
        "aws_document_sha256": remote_document["aws_document_sha256"],
        "repository_generated_document_sha256": remote_document["repository_generated_document_sha256"],
        "package_sha256": remote_document["package_sha256"],
        "payload_lock_sha256": remote_document["payload_lock_sha256"],
        "command_id": cloudtrail["command_id"],
        "command_execution_started_at": invocation["execution_started_at"],
        "command_execution_ended_at": invocation["execution_ended_at"],
        "transport_evidence_sha256": transport["evidence_sha256"],
    }
    return {
        "schema": PROVENANCE_SCHEMA,
        "classification": CLASSIFICATION,
        "evidence": evidence,
        "evidence_sha256": _sha(evidence),
        "independent_readonly_verifier_required": True,
        "cloudtrail_send_command_verified": True,
        "signed_provider_identity_verified": True,
        "provider_host_binding_verified": True,
        "managed_node_binding_verified": True,
        "remote_document_identity_verified": True,
        "command_invocation_verified": True,
        "package_install_observed": True,
        "package_provisioning_verified": True,
        "provider_api_mutation_observed": True,
        "host_filesystem_mutation_observed": True,
        "capture_executed": False,
        "host_safety_verified": False,
        "reboot_completion_proven": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "database_mutation": False,
        "canonical": False,
        "authority_effect": False,
    }


def _read_json(path: str) -> Any:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ProvisionProvenanceError(f"invalid_json:{path}") from exc


def _write_json(path: str, value: Any) -> None:
    Path(path).write_bytes(_canonical(value) + b"\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("build-verifier-boundary")
    p.add_argument("--account-id", required=True)
    p.add_argument("--region", required=True)
    p.add_argument("--output", required=True)

    p = sub.add_parser("compose")
    p.add_argument("--instance-id", required=True)
    p.add_argument("--worker-id", required=True)
    p.add_argument("--account-id", required=True)
    p.add_argument("--region", required=True)
    p.add_argument("--provisioner-role-arn", required=True)
    p.add_argument("--role-session", required=True)
    p.add_argument("--requested-at", required=True)
    p.add_argument("--api-returned-at", required=True)
    p.add_argument("--verifier-caller-identity", required=True)
    p.add_argument("--preflight-bundle", required=True)
    p.add_argument("--managed-node-response", required=True)
    p.add_argument("--document-description", required=True)
    p.add_argument("--get-document-response", required=True)
    p.add_argument("--cloudtrail-lookup", required=True)
    p.add_argument("--command-invocation", required=True)
    p.add_argument("--verified-iid", required=True)
    p.add_argument("--output", required=True)

    args = parser.parse_args(argv)
    try:
        if args.command == "build-verifier-boundary":
            result = build_verifier_session_boundary(account_id=args.account_id, region=args.region)
        else:
            result = compose_provisioning_provenance(
                instance_id=args.instance_id,
                worker_id=args.worker_id,
                account_id=args.account_id,
                region=args.region,
                provisioner_role_arn=args.provisioner_role_arn,
                role_session=args.role_session,
                requested_at=args.requested_at,
                api_returned_at=args.api_returned_at,
                verifier_caller_identity=_read_json(args.verifier_caller_identity),
                preflight_bundle=_read_json(args.preflight_bundle),
                managed_node_response=_read_json(args.managed_node_response),
                document_description=_read_json(args.document_description),
                get_document_response=_read_json(args.get_document_response),
                cloudtrail_lookup=_read_json(args.cloudtrail_lookup),
                command_invocation=_read_json(args.command_invocation),
                verified_iid=_read_json(args.verified_iid),
            )
        _write_json(args.output, result)
        return 0
    except (ProvisionProvenanceError, provision_guard.SSMProvisionError, provider_guard.EvidenceError) as exc:
        print(f"W1_SSM_PROVISION_PROVENANCE_REJECTED:{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
