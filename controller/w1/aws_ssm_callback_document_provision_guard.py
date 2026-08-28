#!/usr/bin/env python3
"""Create-once provisioning contract for W1 callback SSM documents.

Pure offline validation/composition. This module never calls AWS, never grants Run
Command authority, and never proves effective IAM permissions. AWS response objects
accepted by verify mode are caller-supplied transport and remain non-authority.
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
import sys
from typing import Any

from controller.w1 import build_host_safety_package as package_builder

PLAN_SCHEMA = "metaengine.compute.w1-aws-ssm-callback-document-provision-plan.h205f22.v1"
RECEIPT_SCHEMA = "metaengine.compute.w1-aws-ssm-callback-document-provision-receipt.h205f22.v1"
DOCUMENT_VERSION = "1"
DOCUMENT_HASH_TYPE = "Sha256"
TARGET_TYPE = "/AWS::EC2::Instance"
MAX_STDIN_CHARS = 600_000
MAX_DOCUMENT_SOURCE_BYTES = 65_536
AWS_RESPONSE_PROVENANCE = "CALLER_SUPPLIED_AWS_RESPONSE_TRANSPORT_NON_AUTHORITY"

KEY_KIND = "CALLBACK_KEY_ENROLLMENT"
EXEC_KIND = "EXECUTION_MARKER"
DOCUMENTS = {
    KEY_KIND: {
        "name": "Metaengine-W1-Callback-Key-Enroll-H205F22",
        "step_name": "enrollCallbackSigningKey",
        "purpose": "callback-key-enrollment",
    },
    EXEC_KIND: {
        "name": "Metaengine-W1-Execution-Marker-H205F22",
        "step_name": "emitExecutionMarker",
        "purpose": "signed-execution-marker",
    },
}
ACCOUNT_ID = re.compile(r"^[0-9]{12}$")
REGION = re.compile(r"^[a-z]{2}(-gov)?-[a-z]+-[0-9]+$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
WORKER_PATTERN = r"^[A-Za-z0-9._:-]{3,160}$"
HEX64_PATTERN = r"^[0-9a-f]{64}$"

EXEC_PARAMETERS = {
    "WorkerId": {
        "type": "String",
        "description": "Expected W1 worker id; non-secret correlation input.",
        "interpolationType": "ENV_VAR",
        "allowedPattern": WORKER_PATTERN,
        "minChars": 3,
        "maxChars": 160,
    },
    "PackageSha256": {
        "type": "String",
        "description": "Expected installed package SHA-256; non-secret.",
        "interpolationType": "ENV_VAR",
        "allowedPattern": HEX64_PATTERN,
        "minChars": 64,
        "maxChars": 64,
    },
    "PayloadLockSha256": {
        "type": "String",
        "description": "Expected payload lock SHA-256; non-secret.",
        "interpolationType": "ENV_VAR",
        "allowedPattern": HEX64_PATTERN,
        "minChars": 64,
        "maxChars": 64,
    },
    "ExecutionPayloadSha256": {
        "type": "String",
        "description": "Off-host execution payload SHA-256; non-secret.",
        "interpolationType": "ENV_VAR",
        "allowedPattern": HEX64_PATTERN,
        "minChars": 64,
        "maxChars": 64,
    },
    "ChallengeNonce": {
        "type": "String",
        "description": "Per-dispatch non-secret correlation nonce, 256 bits encoded as lowercase hex.",
        "interpolationType": "ENV_VAR",
        "allowedPattern": HEX64_PATTERN,
        "minChars": 64,
        "maxChars": 64,
    },
}


class CallbackDocumentProvisionError(RuntimeError):
    pass


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _sha_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _partition(region: str) -> str:
    if region.startswith("us-gov-"):
        return "aws-us-gov"
    if region.startswith("cn-"):
        return "aws-cn"
    return "aws"


def _spec(kind: Any) -> dict[str, str]:
    if not isinstance(kind, str) or kind not in DOCUMENTS:
        raise CallbackDocumentProvisionError("document_kind_invalid")
    return DOCUMENTS[kind]


def _validate_step(doc: dict[str, Any], *, kind: str) -> str:
    steps = doc.get("mainSteps")
    if not isinstance(steps, list) or len(steps) != 1 or not isinstance(steps[0], dict):
        raise CallbackDocumentProvisionError("local_document_single_step_required")
    step = steps[0]
    if set(step) != {"action", "name", "precondition", "inputs"}:
        raise CallbackDocumentProvisionError("local_document_step_shape_invalid")
    if step.get("action") != "aws:runShellScript" or step.get("name") != _spec(kind)["step_name"]:
        raise CallbackDocumentProvisionError("local_document_step_identity_invalid")
    if step.get("precondition") != {"StringEquals": ["platformType", "Linux"]}:
        raise CallbackDocumentProvisionError("local_document_linux_precondition_invalid")
    inputs = step.get("inputs")
    if not isinstance(inputs, dict) or set(inputs) != {"timeoutSeconds", "runCommand"}:
        raise CallbackDocumentProvisionError("local_document_inputs_invalid")
    if inputs.get("timeoutSeconds") != "60":
        raise CallbackDocumentProvisionError("local_document_timeout_invalid")
    commands = inputs.get("runCommand")
    if not isinstance(commands, list) or len(commands) != 1 or not isinstance(commands[0], str):
        raise CallbackDocumentProvisionError("local_document_run_command_invalid")
    return commands[0]


def _validate_key_document(doc: dict[str, Any], command: str) -> None:
    if doc.get("parameters") != {}:
        raise CallbackDocumentProvisionError("key_document_parameters_forbidden")
    required = (
        "metaengine-w1", "/var/lib/metaengine/w1/identity", "callback-es256-private.pem",
        "callback-es256-public.jwk.json", "ec_paramgen_curve:P-256", "runuser -u \"$EXEC_USER\"",
        "/latest/api/token", "/latest/meta-data/instance-id", "ES256-P1363-SHA256",
        "'private_key_exported':False", "'worker_admitted':False", "'w1_verified':False",
        "'persistent_worker_proof':False", "'reboot_completion_proven':False",
        "'canonical':False", "'authority_effect':False",
    )
    for literal in required:
        if literal not in command:
            raise CallbackDocumentProvisionError(f"key_document_required_literal_missing:{literal}")
    for forbidden in ("{{", "AWS-RunDocument", "aws:runDocument", "github.com", "s3://",
                      "SUPABASE_", "Authorization:"):
        if forbidden in command:
            raise CallbackDocumentProvisionError(f"key_document_forbidden_surface:{forbidden}")


def _validate_exec_document(doc: dict[str, Any], command: str) -> None:
    if doc.get("parameters") != EXEC_PARAMETERS:
        raise CallbackDocumentProvisionError("execution_document_parameters_mismatch")
    required = (
        "metaengine-w1", "/var/lib/metaengine/w1/identity", "callback-es256-private.pem",
        "callback-es256-public.jwk.json", "runuser -u \"$EXEC_USER\"",
        "SSM Agent 3.3.2746.0+ ENV_VAR interpolation required",
        "METAENGINE:H205F22:W1:EXECUTION-CALLBACK:v1", "ES256-P1363-SHA256",
        "https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/w1-execution-callback",
        f"PACKAGE_SOURCE_COMMIT='{package_builder.SOURCE_COMMIT}'",
        "METAENGINE_W1_EXECUTION_MARKER_JSON=", "'host_safety_verified':False",
        "'persistent_worker_proof':False", "'worker_admitted':False", "'w1_verified':False",
        "'canonical':False", "'authority_effect':False",
    )
    for literal in required:
        if literal not in command:
            raise CallbackDocumentProvisionError(f"execution_document_required_literal_missing:{literal}")
    for forbidden in ("{{", "AWS-RunDocument", "aws:runDocument", "github.com", "s3://",
                      "SUPABASE_SECRET", "SUPABASE_SERVICE_ROLE", "Authorization:"):
        if forbidden in command:
            raise CallbackDocumentProvisionError(f"execution_document_forbidden_surface:{forbidden}")


def validate_local_document(value: Any, *, kind: str) -> dict[str, Any]:
    _spec(kind)
    if not isinstance(value, dict):
        raise CallbackDocumentProvisionError("local_document_invalid")
    if set(value) != {"schemaVersion", "description", "parameters", "mainSteps"}:
        raise CallbackDocumentProvisionError("local_document_shape_invalid")
    if value.get("schemaVersion") != "2.2":
        raise CallbackDocumentProvisionError("local_document_schema_version_invalid")
    description = value.get("description")
    if not isinstance(description, str) or not description or len(description) > 2048:
        raise CallbackDocumentProvisionError("local_document_description_invalid")
    command = _validate_step(value, kind=kind)
    if kind == KEY_KIND:
        _validate_key_document(value, command)
    else:
        _validate_exec_document(value, command)
    return value


def parse_local_document(source: bytes, *, kind: str) -> dict[str, Any]:
    if not isinstance(source, bytes) or not source or len(source) > MAX_DOCUMENT_SOURCE_BYTES:
        raise CallbackDocumentProvisionError("local_document_source_size_invalid")
    try:
        value = json.loads(source)
    except json.JSONDecodeError as exc:
        raise CallbackDocumentProvisionError("local_document_json_invalid") from exc
    return validate_local_document(value, kind=kind)


def _tags(kind: str) -> dict[str, str]:
    return {
        "metaengine:project": "H205F22",
        "metaengine:milestone": "W1_PERSISTENT_LINUX_WORKER_SAFETY",
        "metaengine:purpose": _spec(kind)["purpose"],
        "metaengine:authority": "noncanonical-provisioning",
    }


def build_provision_plan(*, document_kind: str, account_id: str, region: str,
                         local_document_source: bytes) -> dict[str, Any]:
    spec = _spec(document_kind)
    if not isinstance(account_id, str) or ACCOUNT_ID.fullmatch(account_id) is None:
        raise CallbackDocumentProvisionError("account_id_invalid")
    if not isinstance(region, str) or REGION.fullmatch(region) is None:
        raise CallbackDocumentProvisionError("region_invalid")
    local = parse_local_document(local_document_source, kind=document_kind)
    document_arn = f"arn:{_partition(region)}:ssm:{region}:{account_id}:document/{spec['name']}"
    tags = _tags(document_kind)
    policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "CreateOnlyReviewedW1CallbackDocument", "Effect": "Allow",
                "Action": "ssm:CreateDocument", "Resource": document_arn,
                "Condition": {
                    "StringEquals": {
                        "ssm:DocumentType": "Command",
                        **{f"aws:RequestTag/{key}": value for key, value in tags.items()},
                    },
                    "ForAllValues:StringEquals": {"aws:TagKeys": sorted(tags)},
                },
            },
            {
                "Sid": "ReadBackExactW1CallbackDocument", "Effect": "Allow",
                "Action": ["ssm:DescribeDocument", "ssm:GetDocument"], "Resource": document_arn,
            },
        ],
    }
    request = {
        "Name": spec["name"], "DocumentType": "Command", "DocumentFormat": "JSON",
        "TargetType": TARGET_TYPE, "Content": _canonical(local),
        "Tags": [{"Key": key, "Value": tags[key]} for key in sorted(tags)],
    }
    neutral = {
        "document_kind": document_kind, "account_id": account_id, "region": region,
        "document_name": spec["name"], "document_arn": document_arn,
        "required_document_version": DOCUMENT_VERSION,
        "repository_document_source_sha256": _sha_bytes(local_document_source),
        "create_request": request, "provisioning_policy": policy, "required_tags": tags,
        "create_once": True,
        "policy_template_update_document_allow": False,
        "policy_template_update_default_version_allow": False,
        "policy_template_delete_document_allow": False,
        "policy_template_modify_document_permission_allow": False,
        "policy_template_put_resource_policy_allow": False,
        "policy_template_send_command_allow": False,
        "policy_template_start_session_allow": False,
        "effective_principal_permissions_verified": False,
    }
    return {
        "schema": PLAN_SCHEMA, **neutral,
        "plan_sha256": hashlib.sha256(_canonical(neutral).encode("utf-8")).hexdigest(),
        "canonical": False, "authority_effect": False, "runtime_execution_authority": False,
        "provider_identity_verified": False, "persistent_worker_proof": False,
        "worker_admitted": False, "w1_verified": False,
    }


def _description(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise CallbackDocumentProvisionError(f"{label}_invalid")
    if isinstance(value.get("DocumentDescription"), dict):
        doc = value["DocumentDescription"]
    elif isinstance(value.get("Document"), dict):
        doc = value["Document"]
    else:
        doc = value
    if not isinstance(doc, dict):
        raise CallbackDocumentProvisionError(f"{label}_document_invalid")
    return doc


def _require_version_one(doc: dict[str, Any], *, label: str, document_name: str,
                         account_id: str, require_active: bool) -> str:
    if doc.get("Name") != document_name:
        raise CallbackDocumentProvisionError(f"{label}_name_mismatch")
    if doc.get("Owner") != account_id:
        raise CallbackDocumentProvisionError(f"{label}_owner_mismatch")
    if doc.get("DocumentType") != "Command":
        raise CallbackDocumentProvisionError(f"{label}_type_mismatch")
    if doc.get("DocumentFormat") not in (None, "JSON"):
        raise CallbackDocumentProvisionError(f"{label}_format_mismatch")
    if str(doc.get("DocumentVersion")) != DOCUMENT_VERSION:
        raise CallbackDocumentProvisionError(f"{label}_document_version_not_one")
    if str(doc.get("LatestVersion")) != DOCUMENT_VERSION:
        raise CallbackDocumentProvisionError(f"{label}_latest_version_not_one")
    if str(doc.get("DefaultVersion")) != DOCUMENT_VERSION:
        raise CallbackDocumentProvisionError(f"{label}_default_version_not_one")
    if require_active and doc.get("Status") != "Active":
        raise CallbackDocumentProvisionError(f"{label}_not_active")
    if doc.get("TargetType") not in (None, TARGET_TYPE):
        raise CallbackDocumentProvisionError(f"{label}_target_type_mismatch")
    platforms = doc.get("PlatformTypes")
    if require_active and (not isinstance(platforms, list) or "Linux" not in platforms):
        raise CallbackDocumentProvisionError(f"{label}_linux_platform_missing")
    aws_hash = doc.get("Hash")
    if doc.get("HashType") != DOCUMENT_HASH_TYPE or not isinstance(aws_hash, str) or SHA256.fullmatch(aws_hash) is None:
        raise CallbackDocumentProvisionError(f"{label}_sha256_missing")
    return aws_hash


def validate_provisioned_document(*, plan: dict[str, Any], create_response: dict[str, Any],
                                  describe_response: dict[str, Any],
                                  get_document_response: dict[str, Any],
                                  local_document_source: bytes) -> dict[str, Any]:
    if not isinstance(plan, dict) or plan.get("schema") != PLAN_SCHEMA:
        raise CallbackDocumentProvisionError("plan_schema_invalid")
    kind = plan.get("document_kind")
    spec = _spec(kind)
    account_id = plan.get("account_id")
    region = plan.get("region")
    if not isinstance(account_id, str) or ACCOUNT_ID.fullmatch(account_id) is None:
        raise CallbackDocumentProvisionError("plan_account_id_invalid")
    if not isinstance(region, str) or REGION.fullmatch(region) is None:
        raise CallbackDocumentProvisionError("plan_region_invalid")
    expected_plan = build_provision_plan(document_kind=kind, account_id=account_id, region=region,
                                         local_document_source=local_document_source)
    if plan != expected_plan:
        raise CallbackDocumentProvisionError("plan_content_mismatch")

    created = _description(create_response, "create_response")
    create_hash = _require_version_one(created, label="create_response", document_name=spec["name"],
                                       account_id=account_id, require_active=False)
    described = _description(describe_response, "describe_response")
    describe_hash = _require_version_one(described, label="describe_response", document_name=spec["name"],
                                         account_id=account_id, require_active=True)
    if create_hash != describe_hash:
        raise CallbackDocumentProvisionError("aws_document_hash_changed_after_create")

    if not isinstance(get_document_response, dict):
        raise CallbackDocumentProvisionError("get_document_response_invalid")
    if get_document_response.get("Name") != spec["name"]:
        raise CallbackDocumentProvisionError("get_document_name_mismatch")
    if str(get_document_response.get("DocumentVersion")) != DOCUMENT_VERSION:
        raise CallbackDocumentProvisionError("get_document_version_mismatch")
    if get_document_response.get("DocumentType") != "Command":
        raise CallbackDocumentProvisionError("get_document_type_mismatch")
    if get_document_response.get("DocumentFormat") not in (None, "JSON"):
        raise CallbackDocumentProvisionError("get_document_format_mismatch")
    if get_document_response.get("Status") != "Active":
        raise CallbackDocumentProvisionError("get_document_not_active")
    content = get_document_response.get("Content")
    if not isinstance(content, str):
        raise CallbackDocumentProvisionError("get_document_content_missing")
    try:
        remote = json.loads(content)
    except json.JSONDecodeError as exc:
        raise CallbackDocumentProvisionError("get_document_content_invalid_json") from exc
    local = parse_local_document(local_document_source, kind=kind)
    validate_local_document(remote, kind=kind)
    if _canonical(remote) != _canonical(local):
        raise CallbackDocumentProvisionError("remote_document_content_mismatch")

    evidence = {
        "document_kind": kind, "account_id": account_id, "region": region,
        "document_name": spec["name"], "document_arn": expected_plan["document_arn"],
        "document_version": DOCUMENT_VERSION, "latest_version": DOCUMENT_VERSION,
        "default_version": DOCUMENT_VERSION, "aws_document_sha256": describe_hash,
        "repository_document_source_sha256": expected_plan["repository_document_source_sha256"],
        "remote_content_matches_repository": True,
        "document_parameter_names": sorted(local["parameters"]),
        "create_once_policy_template": True,
        "policy_template_update_document_allow": False,
        "policy_template_update_default_version_allow": False,
        "policy_template_delete_document_allow": False,
        "policy_template_modify_document_permission_allow": False,
        "policy_template_put_resource_policy_allow": False,
        "policy_template_send_command_allow": False,
        "policy_template_start_session_allow": False,
        "effective_principal_permissions_verified": False,
        "aws_api_response_provenance": AWS_RESPONSE_PROVENANCE,
        "live_aws_api_provenance_verified": False,
    }
    return {
        "schema": RECEIPT_SCHEMA,
        "classification": "W1_AWS_SSM_CALLBACK_DOCUMENT_PROVISIONING_OBSERVATION_NON_AUTHORITY",
        "evidence": evidence, "evidence_sha256": _sha(evidence),
        "document_provisioning_observation_validated": True,
        "document_provisioned": False, "document_provisioned_authoritatively_verified": False,
        "runtime_execution_authority": False, "provider_identity_verified": False,
        "reboot_completion_proven": False, "persistent_worker_proof": False,
        "worker_admitted": False, "w1_verified": False, "canonical": False,
        "authority_effect": False,
    }


def _decode_document_source(value: Any, *, kind: str) -> bytes:
    if not isinstance(value, str) or not value:
        raise CallbackDocumentProvisionError("document_source_base64_missing")
    try:
        raw = base64.b64decode(value, validate=True)
    except Exception as exc:
        raise CallbackDocumentProvisionError("document_source_base64_invalid") from exc
    if not raw or len(raw) > MAX_DOCUMENT_SOURCE_BYTES:
        raise CallbackDocumentProvisionError("document_source_size_invalid")
    parse_local_document(raw, kind=kind)
    return raw


def _require_request_keys(value: Any, expected: set[str]) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise CallbackDocumentProvisionError("request_not_object")
    if set(value) != expected:
        raise CallbackDocumentProvisionError("request_shape_invalid")
    return value


def handle_request(request: Any) -> dict[str, Any]:
    if not isinstance(request, dict):
        raise CallbackDocumentProvisionError("request_not_object")
    command = request.get("command")
    if command == "plan":
        req = _require_request_keys(request, {"command", "document_kind", "account_id", "region",
                                              "document_source_base64"})
        kind = req["document_kind"]
        _spec(kind)
        source = _decode_document_source(req["document_source_base64"], kind=kind)
        return build_provision_plan(document_kind=kind, account_id=req["account_id"], region=req["region"],
                                    local_document_source=source)
    if command == "verify":
        req = _require_request_keys(request, {"command", "plan", "create_response", "describe_response",
                                              "get_document_response", "document_source_base64"})
        plan = req["plan"]
        if not isinstance(plan, dict):
            raise CallbackDocumentProvisionError("plan_invalid")
        kind = plan.get("document_kind")
        _spec(kind)
        source = _decode_document_source(req["document_source_base64"], kind=kind)
        return validate_provisioned_document(plan=plan, create_response=req["create_response"],
                                             describe_response=req["describe_response"],
                                             get_document_response=req["get_document_response"],
                                             local_document_source=source)
    raise CallbackDocumentProvisionError("command_invalid")


def main() -> int:
    try:
        raw = sys.stdin.read(MAX_STDIN_CHARS + 1)
        if len(raw) > MAX_STDIN_CHARS:
            raise CallbackDocumentProvisionError("stdin_too_large")
        result = handle_request(json.loads(raw))
        json.dump(result, sys.stdout, sort_keys=True, separators=(",", ":"))
        sys.stdout.write("\n")
        return 0
    except (CallbackDocumentProvisionError, json.JSONDecodeError) as exc:
        print(f"W1_SSM_CALLBACK_DOCUMENT_PROVISION_REJECTED:{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
