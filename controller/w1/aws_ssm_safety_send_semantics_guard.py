#!/usr/bin/env python3
"""Strict execution-semantics guard for W1 SSM safety provisioning.

The lower-level provisioning guard validates the immutable document, target and
courier transport. This layer additionally proves that the exact document was
invoked with the reviewed execution semantics: fixed timeout, no Targets fanout,
no S3/CloudWatch/SNS/alarm output surfaces, no service role, and no comment.

CloudTrail is treated as eventually consistent. A missing exact event is a
retryable observation state; duplicate exact events or malformed evidence fail
closed. Successful output remains noncanonical and cannot prove W1.
"""
from __future__ import annotations

import copy
from datetime import datetime, timedelta, timezone
import hashlib
import json
import re
from typing import Any

from controller.w1 import aws_ssm_safety_provision_guard as transport_guard
from controller.w1 import aws_ssm_safety_provision_provenance as provenance


SCHEMA = "metaengine.compute.w1-aws-ssm-safety-provision-provenance.h205f22.v2"
COMMAND_SEMANTICS_SCHEMA = "metaengine.compute.w1-aws-ssm-safety-command-semantics.h205f22.v1"
EXPECTED_TIMEOUT_SECONDS = 120
COMMAND_ID = re.compile(r"^[0-9a-fA-F-]{36}$")


class StrictSemanticsError(RuntimeError):
    pass


class CloudTrailEventNotYetVisible(StrictSemanticsError):
    """Retryable: CloudTrail lookup does not yet expose the exact event."""


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def _empty(value: Any) -> bool:
    return value in (None, "", [], {})


def _cloudwatch_disabled(value: Any) -> bool:
    if _empty(value):
        return True
    if not isinstance(value, dict):
        return False
    allowed = {"CloudWatchOutputEnabled", "CloudWatchLogGroupName"}
    if not set(value).issubset(allowed):
        return False
    return value.get("CloudWatchOutputEnabled") in (None, False) and value.get("CloudWatchLogGroupName") in (None, "")


def _cloudwatch_request_disabled(value: Any) -> bool:
    if _empty(value):
        return True
    if not isinstance(value, dict):
        return False
    enabled = value.get("cloudWatchOutputEnabled")
    group = value.get("cloudWatchLogGroupName")
    return enabled in (None, False) and group in (None, "") and set(value).issubset(
        {"cloudWatchOutputEnabled", "cloudWatchLogGroupName"}
    )


def validate_send_command_response_strict(value: Any, *, plan: dict[str, Any]) -> dict[str, Any]:
    """Validate the service echo of the reviewed SendCommand request."""
    command_id = transport_guard.validate_send_command_response(value, plan=plan)
    command = value["Command"]
    if plan.get("timeout_seconds") != EXPECTED_TIMEOUT_SECONDS:
        raise StrictSemanticsError("plan_timeout_semantics_invalid")
    if command.get("TimeoutSeconds") != EXPECTED_TIMEOUT_SECONDS:
        raise StrictSemanticsError("send_command_timeout_mismatch")
    if not _empty(command.get("Targets")):
        raise StrictSemanticsError("send_command_targets_forbidden")
    for key in ("OutputS3BucketName", "OutputS3KeyPrefix", "OutputS3Region", "ServiceRole", "Comment"):
        if not _empty(command.get(key)):
            raise StrictSemanticsError(f"send_command_surface_forbidden:{key}")
    if not _empty(command.get("NotificationConfig")):
        raise StrictSemanticsError("send_command_notification_forbidden")
    if not _cloudwatch_disabled(command.get("CloudWatchOutputConfig")):
        raise StrictSemanticsError("send_command_cloudwatch_forbidden")
    if not _empty(command.get("AlarmConfiguration")) or not _empty(command.get("TriggeredAlarms")):
        raise StrictSemanticsError("send_command_alarm_forbidden")
    if command.get("MaxErrors") not in (None, "0"):
        raise StrictSemanticsError("send_command_max_errors_invalid")
    if command.get("MaxConcurrency") not in (None, "50"):
        raise StrictSemanticsError("send_command_max_concurrency_invalid")

    evidence = {
        "command_id": command_id,
        "document_name": plan["document_name"],
        "document_version": plan["document_version"],
        "document_hash": plan["document_hash"],
        "document_hash_type": plan["document_hash_type"],
        "instance_ids": copy.deepcopy(plan["instance_ids"]),
        "timeout_seconds": EXPECTED_TIMEOUT_SECONDS,
        "parameters": {},
        "targets": [],
        "s3_output": False,
        "cloudwatch_output": False,
        "notifications": False,
        "alarms": False,
        "service_role": False,
    }
    return {
        "schema": COMMAND_SEMANTICS_SCHEMA,
        "classification": "W1_SSM_SEND_COMMAND_STRICT_SEMANTICS_VALIDATED_NONAUTHORITY",
        "evidence": evidence,
        "evidence_sha256": _sha(evidence),
        "provider_api_mutation_observed": True,
        "package_provisioning_verified": False,
        "host_safety_verified": False,
        "persistent_worker_proof": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }


def _parse_time(value: Any, label: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise StrictSemanticsError(f"{label}_missing")
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError as exc:
        raise StrictSemanticsError(f"{label}_invalid") from exc
    if parsed.tzinfo is None:
        raise StrictSemanticsError(f"{label}_timezone_required")
    return parsed.astimezone(timezone.utc)


def _strict_request_matches(request: Any, *, instance_id: str, document_sha256: str) -> bool:
    if not isinstance(request, dict):
        return False
    if request.get("documentName") != transport_guard.DOCUMENT_NAME:
        return False
    if str(request.get("documentVersion")) != transport_guard.DOCUMENT_VERSION:
        return False
    if request.get("documentHash") != document_sha256 or request.get("documentHashType") != transport_guard.DOCUMENT_HASH_TYPE:
        return False
    if request.get("instanceIds") != [instance_id]:
        return False
    if request.get("parameters") not in (None, {}):
        return False
    if request.get("timeoutSeconds") != EXPECTED_TIMEOUT_SECONDS:
        return False
    for key in (
        "targets",
        "serviceRoleArn",
        "notificationConfig",
        "outputS3BucketName",
        "outputS3KeyPrefix",
        "outputS3Region",
        "alarmConfiguration",
        "comment",
    ):
        if not _empty(request.get(key)):
            return False
    if not _cloudwatch_request_disabled(request.get("cloudWatchOutputConfig")):
        return False
    if request.get("maxErrors") not in (None, "0"):
        return False
    if request.get("maxConcurrency") not in (None, "50"):
        return False
    return True


def _response_command_matches(command: Any, *, instance_id: str) -> str | None:
    if not isinstance(command, dict):
        return None
    command_id = command.get("commandId") or command.get("CommandId")
    if not isinstance(command_id, str) or COMMAND_ID.fullmatch(command_id) is None:
        return None
    if (command.get("documentName") or command.get("DocumentName")) != transport_guard.DOCUMENT_NAME:
        return None
    version = command.get("documentVersion") if "documentVersion" in command else command.get("DocumentVersion")
    if str(version) != transport_guard.DOCUMENT_VERSION:
        return None
    instances = command.get("instanceIds") if "instanceIds" in command else command.get("InstanceIds")
    if instances != [instance_id]:
        return None
    parameters = command.get("parameters") if "parameters" in command else command.get("Parameters")
    if parameters not in (None, {}):
        return None
    timeout = command.get("timeoutSeconds") if "timeoutSeconds" in command else command.get("TimeoutSeconds")
    if timeout not in (None, EXPECTED_TIMEOUT_SECONDS):
        return None
    return command_id


def select_strict_send_command_event(
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
    """Select exactly one strict CloudTrail SendCommand event.

    Zero exact matches is retryable because CloudTrail/Run Command observation is
    asynchronous. More than one exact match is a fatal ambiguity.
    """
    request_time = _parse_time(requested_at, "requested_at")
    returned_time = _parse_time(api_returned_at, "api_returned_at")
    if returned_time < request_time:
        raise StrictSemanticsError("api_returned_before_request")
    lower = request_time - timedelta(minutes=2)
    upper = returned_time + timedelta(minutes=5)
    if not isinstance(lookup, dict) or not isinstance(lookup.get("Events"), list):
        raise StrictSemanticsError("cloudtrail_lookup_invalid")

    matches: list[tuple[datetime, dict[str, Any], dict[str, Any]]] = []
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
        if raw.get("eventType") != "AwsApiCall" or raw.get("eventCategory") != "Management":
            continue
        if raw.get("readOnly") not in (None, False):
            continue
        if raw.get("errorCode") is not None or raw.get("errorMessage") is not None:
            continue
        if raw.get("awsRegion") != region or raw.get("recipientAccountId") != account_id:
            continue
        if not provenance._event_identity_matches(
            raw,
            role_arn=provisioner_role_arn,
            role_session=role_session,
            account_id=account_id,
        ):
            continue
        try:
            event_time = _parse_time(raw.get("eventTime") or wrapper.get("EventTime"), "cloudtrail_event_time")
        except StrictSemanticsError:
            continue
        if not (lower <= event_time <= upper):
            continue
        request = raw.get("requestParameters")
        if not _strict_request_matches(request, instance_id=instance_id, document_sha256=aws_document_sha256):
            continue
        command = provenance._command_from_response_elements(raw)
        command_id = _response_command_matches(command, instance_id=instance_id)
        if command_id is None:
            continue
        event_id = raw.get("eventID")
        if not isinstance(event_id, str) or not event_id:
            continue
        matches.append((event_time, wrapper, {
            "event_id": event_id,
            "event_time": event_time.isoformat(),
            "command_id": command_id,
            "provisioner_role_arn": provisioner_role_arn,
            "role_session": role_session,
            "request_parameters_sha256": _sha(request),
            "cloudtrail_event_sha256": _sha(raw),
            "timeout_seconds": EXPECTED_TIMEOUT_SECONDS,
            "targets": [],
            "s3_output": False,
            "cloudwatch_output": False,
            "notifications": False,
            "alarms": False,
            "service_role": False,
        }))

    if not matches:
        raise CloudTrailEventNotYetVisible("matching_send_command_event_not_yet_visible")
    if len(matches) != 1:
        raise StrictSemanticsError("duplicate_matching_send_command_events")
    event_time, wrapper, summary = matches[0]
    return {"wrapper": copy.deepcopy(wrapper), "summary": summary}


def compose_strict_provisioning_provenance(*, cloudtrail_lookup: Any, **kwargs: Any) -> dict[str, Any]:
    description = kwargs.get("document_description")
    account_id = kwargs.get("account_id")
    remote = transport_guard.validate_remote_document(
        description=description,
        get_document=kwargs.get("get_document_response"),
        account_id=account_id,
    )
    selected = select_strict_send_command_event(
        cloudtrail_lookup,
        instance_id=kwargs.get("instance_id"),
        account_id=account_id,
        region=kwargs.get("region"),
        provisioner_role_arn=kwargs.get("provisioner_role_arn"),
        role_session=kwargs.get("role_session"),
        requested_at=kwargs.get("requested_at"),
        api_returned_at=kwargs.get("api_returned_at"),
        aws_document_sha256=remote["aws_document_sha256"],
    )
    base = provenance.compose_provisioning_provenance(
        cloudtrail_lookup={"Events": [selected["wrapper"]]},
        **kwargs,
    )
    if base["evidence"].get("command_id") != selected["summary"]["command_id"]:
        raise StrictSemanticsError("strict_cloudtrail_command_binding_mismatch")
    evidence = copy.deepcopy(base["evidence"])
    evidence["strict_send_command_semantics"] = selected["summary"]
    out = copy.deepcopy(base)
    out["schema"] = SCHEMA
    out["classification"] = "LIVE_AWS_SSM_PACKAGE_PROVISIONING_STRICTLY_VERIFIED_UNINGESTED"
    out["evidence"] = evidence
    out["evidence_sha256"] = _sha(evidence)
    out["strict_send_command_semantics_verified"] = True
    # Preserve every downstream nonclaim explicitly.
    out["capture_executed"] = False
    out["host_safety_verified"] = False
    out["reboot_completion_proven"] = False
    out["persistent_worker_proof"] = False
    out["worker_admitted"] = False
    out["w1_verified"] = False
    out["database_mutation"] = False
    out["canonical"] = False
    out["authority_effect"] = False
    return out
