#!/usr/bin/env python3
"""Fail-closed W1 execution-marker correlation guard.

Pure validation/composition only: no network, credentials, SSM send, callback,
database write, reboot, admission, checkpoint seal, or W1 verification.

Trust split:
- strict provisioning provenance proves the reviewed package was installed first;
- AWS GetCommandInvocation proves an exact execution document/plugin completed;
- the host emits one small canonical JSON marker on stdout;
- an independent callback ingress attests receipt of the exact same marker body;
- this module correlates those observations into an UNINGESTED candidate only.

AWS GetCommandInvocation exposes no separate InvocationId. Provider invocation
identity is therefore the exact (CommandId, InstanceId, PluginName) tuple,
hashed below as invocation_key_sha256.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Any
import uuid

from controller.w1 import aws_ssm_safety_send_semantics_guard as strict_provision
from controller.w1 import build_host_safety_package as package_builder

MARKER_SCHEMA = "metaengine.compute.w1-execution-marker.h205f22.v1"
CALLBACK_SCHEMA = "metaengine.compute.w1-execution-callback-attestation.h205f22.v1"
CORRELATION_SCHEMA = "metaengine.compute.w1-execution-correlation.h205f22.v1"
CLASSIFICATION = "W1_EXECUTION_MARKER_CORRELATED_CANDIDATE_UNINGESTED"
EXECUTION_DOCUMENT_NAME = "Metaengine-W1-Execution-Marker-H205F22"
EXECUTION_DOCUMENT_VERSION = "1"
EXECUTION_PLUGIN_NAME = "emitExecutionMarker"
MARKER_PREFIX = "METAENGINE_W1_EXECUTION_MARKER_JSON="
MAX_MARKER_STDOUT_BYTES = 4096

UUID36 = re.compile(r"^[0-9a-fA-F-]{36}$")
INSTANCE_ID = re.compile(r"^i-[0-9a-f]{8}([0-9a-f]{9})?$")
WORKER_ID = re.compile(r"^[A-Za-z0-9._:-]{3,160}$")
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
AWS_ACCOUNT_ID = re.compile(r"^[0-9]{12}$")
AWS_REGION = re.compile(r"^[a-z]{2}(-gov)?-[a-z]+-[0-9]+$")
ALLOWED_CALLBACK_AUTH_KINDS = {"WORKER_ENROLLMENT_SIGNATURE_V1", "SIGNED_PROVIDER_IDENTITY"}


class ExecutionMarkerError(RuntimeError):
    pass


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical_bytes(value)).hexdigest()


def _parse_time(value: Any, label: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise ExecutionMarkerError(f"{label}_missing")
    try:
        result = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError as exc:
        raise ExecutionMarkerError(f"{label}_invalid") from exc
    if result.tzinfo is None:
        raise ExecutionMarkerError(f"{label}_timezone_required")
    return result.astimezone(timezone.utc)


def _require_text(value: Any, pattern: re.Pattern[str], label: str) -> str:
    if not isinstance(value, str) or pattern.fullmatch(value) is None:
        raise ExecutionMarkerError(f"{label}_invalid")
    return value


def _require_uuid(value: Any, label: str) -> str:
    text = _require_text(value, UUID36, label)
    try:
        return str(uuid.UUID(text))
    except ValueError as exc:
        raise ExecutionMarkerError(f"{label}_invalid") from exc


def _require_false(value: dict[str, Any], *fields: str, prefix: str) -> None:
    for field in fields:
        if value.get(field) is not False:
            raise ExecutionMarkerError(f"{prefix}_nonclaim_invalid:{field}")


def _cloudwatch_disabled(value: Any) -> bool:
    if value in (None, {}, ""):
        return True
    return (
        isinstance(value, dict)
        and value.get("CloudWatchOutputEnabled") in (None, False)
        and value.get("CloudWatchLogGroupName") in (None, "")
        and set(value).issubset({"CloudWatchOutputEnabled", "CloudWatchLogGroupName"})
    )


def validate_provisioning_provenance(value: Any, *, worker_id: str, instance_id: str) -> dict[str, Any]:
    _require_text(worker_id, WORKER_ID, "worker_id")
    _require_text(instance_id, INSTANCE_ID, "instance_id")
    if not isinstance(value, dict) or value.get("schema") != strict_provision.SCHEMA:
        raise ExecutionMarkerError("provisioning_schema_invalid")
    if value.get("package_provisioning_verified") is not True:
        raise ExecutionMarkerError("package_provisioning_not_verified")
    if value.get("strict_send_command_semantics_verified") is not True:
        raise ExecutionMarkerError("strict_provisioning_semantics_not_verified")
    _require_false(value, "capture_executed", "host_safety_verified", "reboot_completion_proven",
                   "persistent_worker_proof", "worker_admitted", "w1_verified", "database_mutation",
                   "canonical", "authority_effect", prefix="provisioning")
    evidence = value.get("evidence")
    if not isinstance(evidence, dict):
        raise ExecutionMarkerError("provisioning_evidence_invalid")
    if evidence.get("worker_id") != worker_id:
        raise ExecutionMarkerError("provisioning_worker_mismatch")
    if evidence.get("instance_id") != instance_id:
        raise ExecutionMarkerError("provisioning_instance_mismatch")
    command_id = _require_uuid(evidence.get("command_id"), "provisioning_command_id")
    package_sha = _require_text(evidence.get("package_sha256"), SHA256, "package_sha256")
    payload_lock_sha = _require_text(evidence.get("payload_lock_sha256"), SHA256, "payload_lock_sha256")
    account_id = _require_text(evidence.get("account_id"), AWS_ACCOUNT_ID, "account_id")
    region = _require_text(evidence.get("region"), AWS_REGION, "region")
    started = _parse_time(evidence.get("command_execution_started_at"), "provisioning_started_at")
    ended = _parse_time(evidence.get("command_execution_ended_at"), "provisioning_ended_at")
    if ended < started:
        raise ExecutionMarkerError("provisioning_time_reversed")
    return {"command_id": command_id, "package_sha256": package_sha,
            "payload_lock_sha256": payload_lock_sha, "account_id": account_id,
            "region": region, "started_at": started, "ended_at": ended}


def _validate_marker(marker: Any, *, worker_id: str, instance_id: str,
                     expected_execution_payload_sha256: str) -> dict[str, Any]:
    if not isinstance(marker, dict) or marker.get("schema") != MARKER_SCHEMA:
        raise ExecutionMarkerError("marker_schema_invalid")
    marker_id = _require_uuid(marker.get("marker_id"), "marker_id")
    if marker.get("worker_id") != worker_id:
        raise ExecutionMarkerError("marker_worker_mismatch")
    if marker.get("provider_instance_id") != instance_id:
        raise ExecutionMarkerError("marker_instance_mismatch")
    if marker.get("provider_kind") != "AWS_EC2":
        raise ExecutionMarkerError("marker_provider_invalid")
    if marker.get("package_source_commit") != package_builder.SOURCE_COMMIT:
        raise ExecutionMarkerError("marker_package_source_commit_mismatch")
    _require_text(marker.get("package_source_commit"), SHA40, "marker_package_source_commit")
    execution_payload_sha = _require_text(marker.get("execution_payload_sha256"), SHA256,
                                          "execution_payload_sha256")
    if execution_payload_sha != expected_execution_payload_sha256:
        raise ExecutionMarkerError("execution_payload_sha256_mismatch")
    package_sha = _require_text(marker.get("package_sha256"), SHA256, "marker_package_sha256")
    payload_lock_sha = _require_text(marker.get("payload_lock_sha256"), SHA256,
                                     "marker_payload_lock_sha256")
    observed_at = _parse_time(marker.get("observed_at"), "marker_observed_at")
    _require_false(marker, "host_safety_verified", "persistent_worker_proof", "worker_admitted",
                   "w1_verified", "canonical", "authority_effect", prefix="marker")
    return {"marker_id": marker_id, "worker_id": worker_id, "instance_id": instance_id,
            "execution_payload_sha256": execution_payload_sha, "package_sha256": package_sha,
            "payload_lock_sha256": payload_lock_sha, "observed_at": observed_at,
            "marker_sha256": _sha(marker), "marker": marker}


def validate_execution_invocation(value: Any, *, worker_id: str, instance_id: str,
                                  expected_execution_payload_sha256: str) -> dict[str, Any]:
    _require_text(worker_id, WORKER_ID, "worker_id")
    _require_text(instance_id, INSTANCE_ID, "instance_id")
    _require_text(expected_execution_payload_sha256, SHA256, "expected_execution_payload_sha256")
    if not isinstance(value, dict):
        raise ExecutionMarkerError("execution_invocation_invalid")
    command_id = _require_uuid(value.get("CommandId"), "execution_command_id")
    if value.get("InstanceId") != instance_id:
        raise ExecutionMarkerError("execution_instance_mismatch")
    if value.get("DocumentName") != EXECUTION_DOCUMENT_NAME:
        raise ExecutionMarkerError("execution_document_name_mismatch")
    if str(value.get("DocumentVersion")) != EXECUTION_DOCUMENT_VERSION:
        raise ExecutionMarkerError("execution_document_version_mismatch")
    if value.get("PluginName") != EXECUTION_PLUGIN_NAME:
        raise ExecutionMarkerError("execution_plugin_name_mismatch")
    if value.get("Status") != "Success" or value.get("StatusDetails") not in (None, "Success"):
        raise ExecutionMarkerError("execution_status_not_success")
    if value.get("ResponseCode") != 0:
        raise ExecutionMarkerError("execution_response_code_nonzero")
    if value.get("StandardErrorContent") not in (None, ""):
        raise ExecutionMarkerError("execution_stderr_nonempty")
    if value.get("StandardErrorUrl") not in (None, "") or value.get("StandardOutputUrl") not in (None, ""):
        raise ExecutionMarkerError("execution_output_url_forbidden")
    if not _cloudwatch_disabled(value.get("CloudWatchOutputConfig")):
        raise ExecutionMarkerError("execution_cloudwatch_output_forbidden")
    started = _parse_time(value.get("ExecutionStartDateTime"), "execution_started_at")
    ended = _parse_time(value.get("ExecutionEndDateTime"), "execution_ended_at")
    if ended < started:
        raise ExecutionMarkerError("execution_time_reversed")
    stdout = value.get("StandardOutputContent")
    if not isinstance(stdout, str) or not stdout:
        raise ExecutionMarkerError("execution_stdout_missing")
    if len(stdout.encode("utf-8")) > MAX_MARKER_STDOUT_BYTES:
        raise ExecutionMarkerError("execution_marker_stdout_too_large")
    normalized = stdout[:-1] if stdout.endswith("\n") else stdout
    if "\n" in normalized or "\r" in normalized:
        raise ExecutionMarkerError("execution_marker_stdout_must_be_single_line")
    if not normalized.startswith(MARKER_PREFIX):
        raise ExecutionMarkerError("execution_marker_prefix_missing")
    try:
        marker = json.loads(normalized[len(MARKER_PREFIX):])
    except json.JSONDecodeError as exc:
        raise ExecutionMarkerError("execution_marker_json_invalid") from exc
    validated = _validate_marker(marker, worker_id=worker_id, instance_id=instance_id,
                                 expected_execution_payload_sha256=expected_execution_payload_sha256)
    if not (started - timedelta(minutes=2) <= validated["observed_at"] <= ended + timedelta(minutes=2)):
        raise ExecutionMarkerError("marker_time_outside_execution_window")
    identity = {"command_id": command_id, "instance_id": instance_id,
                "plugin_name": EXECUTION_PLUGIN_NAME}
    return {**validated, "command_id": command_id, "invocation_key_sha256": _sha(identity),
            "started_at": started, "ended_at": ended}


def validate_callback_attestation(value: Any, *, marker: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema") != CALLBACK_SCHEMA:
        raise ExecutionMarkerError("callback_schema_invalid")
    receipt_id = _require_uuid(value.get("callback_receipt_id"), "callback_receipt_id")
    if value.get("accepted") is not True:
        raise ExecutionMarkerError("callback_not_accepted")
    auth_kind = value.get("auth_kind")
    if auth_kind not in ALLOWED_CALLBACK_AUTH_KINDS:
        raise ExecutionMarkerError("callback_auth_kind_invalid")
    if value.get("auth_verified") is not True:
        raise ExecutionMarkerError("callback_auth_not_verified")
    if value.get("marker_id") != marker["marker_id"] or value.get("worker_id") != marker["worker_id"]:
        raise ExecutionMarkerError("callback_marker_or_worker_mismatch")
    if value.get("provider_kind") != "AWS_EC2" or value.get("provider_instance_id") != marker["instance_id"]:
        raise ExecutionMarkerError("callback_provider_or_instance_mismatch")
    for key in ("execution_payload_sha256", "package_sha256", "payload_lock_sha256"):
        if value.get(key) != marker[key]:
            raise ExecutionMarkerError(f"callback_{key}_mismatch")
    marker_body_sha = _require_text(value.get("marker_body_sha256"), SHA256,
                                    "callback_marker_body_sha256")
    if marker_body_sha != marker["marker_sha256"]:
        raise ExecutionMarkerError("callback_marker_body_hash_mismatch")
    received_at = _parse_time(value.get("received_at"), "callback_received_at")
    _require_false(value, "database_persistence_verified", "persistent_worker_proof",
                   "worker_admitted", "w1_verified", "canonical", "authority_effect",
                   prefix="callback")
    return {"callback_receipt_id": receipt_id, "auth_kind": auth_kind,
            "received_at": received_at, "marker_body_sha256": marker_body_sha}


def compose_execution_correlation(*, provisioning_provenance: Any, execution_invocation: Any,
                                  callback_attestation: Any, worker_id: str, instance_id: str,
                                  expected_execution_payload_sha256: str) -> dict[str, Any]:
    provisioning = validate_provisioning_provenance(provisioning_provenance,
                                                    worker_id=worker_id, instance_id=instance_id)
    invocation = validate_execution_invocation(execution_invocation, worker_id=worker_id,
                                               instance_id=instance_id,
                                               expected_execution_payload_sha256=expected_execution_payload_sha256)
    if invocation["package_sha256"] != provisioning["package_sha256"]:
        raise ExecutionMarkerError("marker_package_provisioning_mismatch")
    if invocation["payload_lock_sha256"] != provisioning["payload_lock_sha256"]:
        raise ExecutionMarkerError("marker_payload_lock_provisioning_mismatch")
    if invocation["started_at"] < provisioning["ended_at"] - timedelta(seconds=30):
        raise ExecutionMarkerError("execution_precedes_package_provisioning_completion")
    callback = validate_callback_attestation(callback_attestation, marker=invocation)
    if callback["received_at"] < invocation["started_at"] - timedelta(seconds=30):
        raise ExecutionMarkerError("callback_precedes_execution_window")
    if callback["received_at"] > invocation["ended_at"] + timedelta(minutes=3):
        raise ExecutionMarkerError("callback_too_late_for_execution_window")
    evidence = {
        "provider_kind": "AWS_EC2", "worker_id": worker_id,
        "provider_instance_id": instance_id, "account_id": provisioning["account_id"],
        "region": provisioning["region"], "provisioning_command_id": provisioning["command_id"],
        "execution_command_id": invocation["command_id"],
        "invocation_key_sha256": invocation["invocation_key_sha256"],
        "execution_document_name": EXECUTION_DOCUMENT_NAME,
        "execution_document_version": EXECUTION_DOCUMENT_VERSION,
        "execution_plugin_name": EXECUTION_PLUGIN_NAME, "marker_id": invocation["marker_id"],
        "marker_sha256": invocation["marker_sha256"],
        "callback_receipt_id": callback["callback_receipt_id"],
        "callback_auth_kind": callback["auth_kind"],
        "callback_marker_body_sha256": callback["marker_body_sha256"],
        "package_source_commit": package_builder.SOURCE_COMMIT,
        "package_sha256": invocation["package_sha256"],
        "payload_lock_sha256": invocation["payload_lock_sha256"],
        "execution_payload_sha256": invocation["execution_payload_sha256"],
        "provisioning_completed_at": provisioning["ended_at"].isoformat(),
        "execution_started_at": invocation["started_at"].isoformat(),
        "marker_observed_at": invocation["observed_at"].isoformat(),
        "execution_completed_at": invocation["ended_at"].isoformat(),
        "callback_received_at": callback["received_at"].isoformat(),
    }
    return {
        "schema": CORRELATION_SCHEMA, "classification": CLASSIFICATION,
        "evidence": evidence, "evidence_sha256": _sha(evidence),
        "ssm_execution_observed": True, "execution_marker_correlated": True,
        "callback_attestation_observed": True, "callback_attestation_verified": True,
        "database_persistence_verified": False, "live_execution_evidence_candidate": True,
        "host_safety_verified": False, "reboot_completion_proven": False,
        "persistent_worker_proof": False, "worker_admitted": False,
        "w1_verified": False, "canonical": False, "authority_effect": False,
        "required_next": "PERSIST_EXACT_CORRELATION_RECEIPT_AND_READ_BACK_BEFORE_EVIDENCE_READY",
        "nonclaims": [
            "GET_COMMAND_INVOCATION_HAS_NO_SEPARATE_PROVIDER_INVOCATION_ID",
            "CORRELATION_CANDIDATE_IS_NOT_DATABASE_PERSISTENCE",
            "ONE_SUCCESSFUL_EXECUTION_DOES_NOT_PROVE_PERSISTENCE_ACROSS_REBOOT",
            "EXECUTION_MARKER_DOES_NOT_VERIFY_W1_BY_ITSELF",
        ],
    }


def _read(path: str) -> Any:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ExecutionMarkerError(f"invalid_json:{path}") from exc


def _write(path: str, value: Any) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--provisioning-provenance", required=True)
    parser.add_argument("--execution-invocation", required=True)
    parser.add_argument("--callback-attestation", required=True)
    parser.add_argument("--worker-id", required=True)
    parser.add_argument("--instance-id", required=True)
    parser.add_argument("--execution-payload-sha256", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    try:
        result = compose_execution_correlation(
            provisioning_provenance=_read(args.provisioning_provenance),
            execution_invocation=_read(args.execution_invocation),
            callback_attestation=_read(args.callback_attestation),
            worker_id=args.worker_id, instance_id=args.instance_id,
            expected_execution_payload_sha256=args.execution_payload_sha256,
        )
        _write(args.output, result)
        return 0
    except ExecutionMarkerError as exc:
        print(f"W1_EXECUTION_MARKER_REJECTED:{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
