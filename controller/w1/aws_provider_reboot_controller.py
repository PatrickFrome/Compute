#!/usr/bin/env python3
"""Validate and normalize AWS provider-side evidence for H205F22 W1.

This controller never grants runtime authority and never writes to Supabase. It turns
AWS API observations into a deterministic evidence object that the independent W1
reboot-receipt plane can later ingest and correlate with worker heartbeats.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

SHA40 = re.compile(r"^[0-9a-f]{40}$")
INSTANCE_ID = re.compile(r"^i-[0-9a-f]+$")
WORKER_ID = re.compile(r"^[A-Za-z0-9._:-]{3,160}$")


class EvidenceError(RuntimeError):
    pass


def _read_json(path: str | Path) -> Any:
    try:
        return json.loads(Path(path).read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise EvidenceError(f"invalid_json:{path}") from exc


def _write_json(path: str | Path, value: Any) -> None:
    Path(path).write_text(json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n")


def _parse_time(value: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise EvidenceError("timestamp_missing")
    text = value.strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError as exc:
        raise EvidenceError("timestamp_invalid") from exc
    if dt.tzinfo is None:
        raise EvidenceError("timestamp_timezone_required")
    return dt.astimezone(timezone.utc)


def _canonical_sha256(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(payload).hexdigest()


def _tag_map(instance: dict[str, Any]) -> dict[str, str]:
    tags: dict[str, str] = {}
    for item in instance.get("Tags") or []:
        if isinstance(item, dict) and isinstance(item.get("Key"), str) and isinstance(item.get("Value"), str):
            tags[item["Key"]] = item["Value"]
    return tags


def validate_preflight_bundle(
    bundle: dict[str, Any], *, instance_id: str, worker_id: str, expected_worker_sha: str
) -> dict[str, Any]:
    if not INSTANCE_ID.fullmatch(instance_id):
        raise EvidenceError("instance_id_invalid")
    if not WORKER_ID.fullmatch(worker_id):
        raise EvidenceError("worker_id_invalid")
    if not SHA40.fullmatch(expected_worker_sha):
        raise EvidenceError("expected_worker_sha_invalid")

    instance = bundle.get("instance")
    groups = bundle.get("security_groups")
    volume = bundle.get("root_volume")
    if not isinstance(instance, dict) or not isinstance(groups, list) or not isinstance(volume, dict):
        raise EvidenceError("preflight_bundle_shape_invalid")

    if instance.get("InstanceId") != instance_id:
        raise EvidenceError("instance_identity_mismatch")
    if (instance.get("State") or {}).get("Name") != "running":
        raise EvidenceError("instance_not_running")

    tags = _tag_map(instance)
    required_tags = {
        "metaengine:project": "H205F22",
        "metaengine:milestone": "W1_PERSISTENT_LINUX_WORKER_SAFETY",
        "metaengine:worker_id": worker_id,
        "metaengine:github_sha": expected_worker_sha,
        "metaengine:authority": "noncanonical-worker",
        "metaengine:execution_tier": "persistent-host",
    }
    for key, expected in required_tags.items():
        if tags.get(key) != expected:
            raise EvidenceError(f"instance_tag_mismatch:{key}")

    metadata = instance.get("MetadataOptions") or {}
    if metadata.get("HttpTokens") != "required":
        raise EvidenceError("imdsv2_required")
    if int(metadata.get("HttpPutResponseHopLimit") or 0) != 1:
        raise EvidenceError("imds_hop_limit_must_be_one")
    if metadata.get("HttpEndpoint") != "enabled":
        raise EvidenceError("imds_endpoint_required")

    if volume.get("Encrypted") is not True:
        raise EvidenceError("root_volume_must_be_encrypted")
    if volume.get("VolumeType") != "gp3":
        raise EvidenceError("root_volume_must_be_gp3")

    observed_group_ids: set[str] = set()
    for group in groups:
        if not isinstance(group, dict):
            raise EvidenceError("security_group_shape_invalid")
        gid = group.get("GroupId")
        if isinstance(gid, str):
            observed_group_ids.add(gid)
        if group.get("IpPermissions"):
            raise EvidenceError(f"ingress_forbidden:{gid or 'unknown'}")

    attached_group_ids = {
        g.get("GroupId")
        for g in instance.get("SecurityGroups") or []
        if isinstance(g, dict) and isinstance(g.get("GroupId"), str)
    }
    if not attached_group_ids or attached_group_ids != observed_group_ids:
        raise EvidenceError("security_group_set_mismatch")

    return {
        "schema": "metaengine.compute.w1-aws-preflight.h205f22.v1",
        "instance_id": instance_id,
        "worker_id": worker_id,
        "worker_bundle_github_sha": expected_worker_sha,
        "state": "running",
        "availability_zone": (instance.get("Placement") or {}).get("AvailabilityZone"),
        "instance_type": instance.get("InstanceType"),
        "image_id": instance.get("ImageId"),
        "private_ip": instance.get("PrivateIpAddress"),
        "public_ip_present": bool(instance.get("PublicIpAddress")),
        "security_group_ids": sorted(observed_group_ids),
        "root_volume_id": volume.get("VolumeId"),
        "root_volume_encrypted": True,
        "root_volume_type": "gp3",
        "imdsv2_required": True,
        "imds_hop_limit": 1,
        "authority_effect": False,
        "canonical": False,
    }


def _event_instance_ids(raw: dict[str, Any]) -> set[str]:
    items = (((raw.get("requestParameters") or {}).get("instancesSet") or {}).get("items") or [])
    result: set[str] = set()
    for item in items:
        if isinstance(item, dict) and isinstance(item.get("instanceId"), str):
            result.add(item["instanceId"])
    return result


def _event_session_matches(raw: dict[str, Any], role_session: str) -> bool:
    identity = raw.get("userIdentity") or {}
    candidates = [
        identity.get("arn"),
        identity.get("principalId"),
        ((identity.get("sessionContext") or {}).get("sessionIssuer") or {}).get("arn"),
    ]
    return any(isinstance(value, str) and role_session in value for value in candidates)


def select_reboot_event(
    lookup: dict[str, Any], *, instance_id: str, role_session: str, requested_at: str
) -> dict[str, Any]:
    if not INSTANCE_ID.fullmatch(instance_id):
        raise EvidenceError("instance_id_invalid")
    if not re.fullmatch(r"[A-Za-z0-9+=,.@_-]{2,64}", role_session):
        raise EvidenceError("role_session_invalid")
    request_time = _parse_time(requested_at)
    lower_bound = request_time - timedelta(minutes=2)

    matches: list[tuple[datetime, dict[str, Any]]] = []
    for wrapper in lookup.get("Events") or []:
        if not isinstance(wrapper, dict) or wrapper.get("EventName") != "RebootInstances":
            continue
        raw_text = wrapper.get("CloudTrailEvent")
        if not isinstance(raw_text, str):
            continue
        try:
            raw = json.loads(raw_text)
        except json.JSONDecodeError:
            continue
        if raw.get("eventSource") != "ec2.amazonaws.com" or raw.get("eventName") != "RebootInstances":
            continue
        if instance_id not in _event_instance_ids(raw):
            continue
        if not _event_session_matches(raw, role_session):
            continue
        event_time = _parse_time(str(raw.get("eventTime") or wrapper.get("EventTime") or ""))
        if event_time < lower_bound:
            continue
        matches.append((event_time, {"lookup_event": wrapper, "cloudtrail_event": raw}))

    if not matches:
        raise EvidenceError("matching_reboot_event_not_found")
    matches.sort(key=lambda pair: pair[0])
    return matches[0][1]


def build_reboot_receipt(
    *,
    preflight: dict[str, Any],
    selected_event: dict[str, Any],
    caller_identity: dict[str, Any],
    requested_at: str,
    api_returned_at: str,
    github_run_id: str,
    github_run_attempt: str,
    role_session: str,
) -> dict[str, Any]:
    raw = selected_event.get("cloudtrail_event")
    if not isinstance(raw, dict):
        raise EvidenceError("cloudtrail_event_missing")
    request_time = _parse_time(requested_at)
    api_time = _parse_time(api_returned_at)
    event_time = _parse_time(str(raw.get("eventTime") or ""))
    if api_time < request_time:
        raise EvidenceError("api_returned_before_request")
    if event_time < request_time - timedelta(minutes=2):
        raise EvidenceError("cloudtrail_event_precedes_request")

    event_id = raw.get("eventID")
    if not isinstance(event_id, str) or not event_id:
        raise EvidenceError("cloudtrail_event_id_missing")

    instance_id = preflight.get("instance_id")
    worker_id = preflight.get("worker_id")
    if not isinstance(instance_id, str) or not isinstance(worker_id, str):
        raise EvidenceError("preflight_identity_missing")

    evidence = {
        "schema": "metaengine.compute.w1-aws-provider-evidence.h205f22.v1",
        "github": {
            "run_id": str(github_run_id),
            "run_attempt": str(github_run_attempt),
            "role_session": role_session,
        },
        "caller_identity": caller_identity,
        "preflight": preflight,
        "cloudtrail": selected_event,
        "api_returned_at": api_returned_at,
    }
    evidence_sha = _canonical_sha256(evidence)

    return {
        "schema": "metaengine.compute.w1-provider-reboot-receipt-candidate.h205f22.v1",
        "classification": "LIVE_PROVIDER_CONTROLLER_RECEIPT_UNINGESTED",
        "worker_id": worker_id,
        "provider_kind": "AWS_EC2",
        "provider_instance_id": instance_id,
        "action_kind": "REBOOT",
        "action_id": event_id,
        "requested_at": requested_at,
        # EC2 RebootInstances is a synchronous control-plane request without an
        # asynchronous action object. The CloudTrail event time is therefore
        # the provider-observed action point; the DB still requires a later
        # worker heartbeat with a distinct boot ID before proof can succeed.
        "completed_at": raw.get("eventTime"),
        "identity_attestation_kind": "PROVIDER_METADATA",
        "identity_attestation_verified": False,
        "evidence": evidence,
        "evidence_artifact_sha256": evidence_sha,
        "canonical": False,
        "authority_effect": False,
        "persistent_worker_proof": False,
        "w1_verified": False,
    }


def _cmd_validate(args: argparse.Namespace) -> int:
    summary = validate_preflight_bundle(
        _read_json(args.input),
        instance_id=args.instance_id,
        worker_id=args.worker_id,
        expected_worker_sha=args.expected_worker_sha,
    )
    _write_json(args.output, summary)
    return 0


def _cmd_select(args: argparse.Namespace) -> int:
    try:
        selected = select_reboot_event(
            _read_json(args.input),
            instance_id=args.instance_id,
            role_session=args.role_session,
            requested_at=args.requested_at,
        )
    except EvidenceError as exc:
        if str(exc) == "matching_reboot_event_not_found":
            return 2
        raise
    _write_json(args.output, selected)
    return 0


def _cmd_build(args: argparse.Namespace) -> int:
    receipt = build_reboot_receipt(
        preflight=_read_json(args.preflight),
        selected_event=_read_json(args.event),
        caller_identity=_read_json(args.caller_identity),
        requested_at=args.requested_at,
        api_returned_at=args.api_returned_at,
        github_run_id=args.github_run_id,
        github_run_attempt=args.github_run_attempt,
        role_session=args.role_session,
    )
    _write_json(args.output, receipt)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("validate-preflight")
    p.add_argument("--input", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--instance-id", required=True)
    p.add_argument("--worker-id", required=True)
    p.add_argument("--expected-worker-sha", required=True)
    p.set_defaults(func=_cmd_validate)

    p = sub.add_parser("select-event")
    p.add_argument("--input", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--instance-id", required=True)
    p.add_argument("--role-session", required=True)
    p.add_argument("--requested-at", required=True)
    p.set_defaults(func=_cmd_select)

    p = sub.add_parser("build-receipt")
    p.add_argument("--preflight", required=True)
    p.add_argument("--event", required=True)
    p.add_argument("--caller-identity", required=True)
    p.add_argument("--requested-at", required=True)
    p.add_argument("--api-returned-at", required=True)
    p.add_argument("--github-run-id", required=True)
    p.add_argument("--github-run-attempt", required=True)
    p.add_argument("--role-session", required=True)
    p.add_argument("--output", required=True)
    p.set_defaults(func=_cmd_build)

    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except EvidenceError as exc:
        print(f"W1_PROVIDER_EVIDENCE_REJECTED:{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
