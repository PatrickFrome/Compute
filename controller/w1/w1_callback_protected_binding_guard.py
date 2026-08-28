#!/usr/bin/env python3
"""Fail-closed W1 callback protected readback binding.

Pure validation only: no network, credentials, provider mutation, admission or W1 authority.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import urllib.parse
from pathlib import Path
from typing import Any

ENVIRONMENT = "w1-callback-readback"
REPOSITORY = "PatrickFrome/Compute"
REPOSITORY_ID = "1341371143"
REPOSITORY_OWNER_ID = "20597814"
ISSUER = "https://token.actions.githubusercontent.com"
AUDIENCE = "sts.amazonaws.com"
EXPECTED_SUBJECT = "repo:PatrickFrome@20597814/Compute@1341371143:environment:w1-callback-readback"
WORKFLOW_PATH = ".github/workflows/w1-callback-protected-binding.yml"
EXPECTED_WORKFLOW_REF = f"{REPOSITORY}/{WORKFLOW_PATH}@refs/heads/main"
EXPECTED_REF = "refs/heads/main"
EXPECTED_EVENT = "workflow_dispatch"
EXPECTED_RUNNER_ENVIRONMENT = "github-hosted"

ENV_SCHEMA = "metaengine.compute.w1-callback-github-environment-preflight.h205f22.v1"
GATE_SCHEMA = "metaengine.compute.w1-callback-github-environment-gate.h205f22.v1"
OIDC_CONFIG_SCHEMA = "metaengine.compute.w1-callback-oidc-config-readback.h205f22.v1"
OIDC_CLAIMS_SCHEMA = "metaengine.compute.w1-callback-oidc-claims.h205f22.v1"
AWS_POLICY_SCHEMA = "metaengine.compute.w1-callback-aws-session-policy.h205f22.v1"
AWS_ATTESTATION_SCHEMA = "metaengine.compute.w1-callback-aws-oidc-attestation.h205f22.v1"
BINDING_SCHEMA = "metaengine.compute.w1-callback-protected-binding.h205f22.v1"
PROVIDER_SCHEMA = "metaengine.compute.w1-callback-provider-readback.h205f22.v2"
READINESS_SCHEMA = "metaengine.compute.w1-callback-ingress-readiness.h205f22.v1"

HEX40 = re.compile(r"^[0-9a-f]{40}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
ACCOUNT = re.compile(r"^[0-9]{12}$")
REGION = re.compile(r"^[a-z]{2}(-gov)?-[a-z]+-[0-9]+$")
RUN_ID = re.compile(r"^[1-9][0-9]*$")
JTI = re.compile(r"^[A-Za-z0-9._:-]{8,256}$")
ROLE_ARN = re.compile(r"^arn:(aws|aws-us-gov|aws-cn):iam::([0-9]{12}):role/([A-Za-z0-9+=,.@_/-]{1,512})$")

DOCUMENT_NAMES = (
    "Metaengine-W1-Callback-Key-Enroll-H205F22",
    "Metaengine-W1-Execution-Marker-H205F22",
)
AUTHORITY_FALSE = (
    "database_mutation_authorized", "edge_deployment_authorized", "aws_mutation_authorized",
    "send_command_authorized", "provider_identity_verified", "persistent_worker_proof",
    "worker_admitted", "w1_verified", "canonical", "authority_effect",
)


class CallbackProtectedBindingError(RuntimeError):
    pass


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def _obj(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise CallbackProtectedBindingError(f"{label}_not_object")
    return value


def _read(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise CallbackProtectedBindingError(f"{label}_invalid_json") from exc


def _write(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(_canonical(value) + b"\n")


def _self_hashed(value: Any, schema: str, label: str) -> dict[str, Any]:
    obj = _obj(value, label)
    if obj.get("schema") != schema:
        raise CallbackProtectedBindingError(f"{label}_schema_invalid")
    claimed = obj.get("receipt_sha256")
    if not isinstance(claimed, str) or HEX64.fullmatch(claimed) is None:
        raise CallbackProtectedBindingError(f"{label}_receipt_sha256_invalid")
    core = dict(obj)
    core.pop("receipt_sha256", None)
    if _sha(core) != claimed:
        raise CallbackProtectedBindingError(f"{label}_receipt_sha256_mismatch")
    return obj


def _false(obj: dict[str, Any], fields: tuple[str, ...], label: str) -> None:
    for field in fields:
        if obj.get(field) is not False:
            raise CallbackProtectedBindingError(f"{label}_{field}_must_be_false")


def _partition(region: str) -> str:
    if region.startswith("us-gov-"):
        return "aws-us-gov"
    if region.startswith("cn-"):
        return "aws-cn"
    return "aws"


def _role(role_arn: str, account_id: str, region: str) -> tuple[str, str]:
    if not isinstance(account_id, str) or ACCOUNT.fullmatch(account_id) is None:
        raise CallbackProtectedBindingError("aws_account_id_invalid")
    if not isinstance(region, str) or REGION.fullmatch(region) is None:
        raise CallbackProtectedBindingError("aws_region_invalid")
    match = ROLE_ARN.fullmatch(role_arn) if isinstance(role_arn, str) else None
    if match is None:
        raise CallbackProtectedBindingError("aws_role_arn_invalid")
    partition, arn_account, role_path = match.groups()
    if partition != _partition(region) or arn_account != account_id:
        raise CallbackProtectedBindingError("aws_role_arn_context_mismatch")
    return partition, role_path


def validate_oidc_config(value: Any) -> dict[str, Any]:
    raw = _obj(value, "oidc_config")
    if raw.get("use_default") is not True:
        raise CallbackProtectedBindingError("oidc_default_subject_required")
    if raw.get("include_claim_keys", []) not in (None, []):
        raise CallbackProtectedBindingError("oidc_custom_claim_template_forbidden")
    immutable = raw.get("use_immutable_subject")
    if immutable is False:
        raise CallbackProtectedBindingError("oidc_immutable_subject_explicitly_disabled")
    if immutable not in (None, True):
        raise CallbackProtectedBindingError("oidc_immutable_subject_flag_invalid")
    core = {
        "schema": OIDC_CONFIG_SCHEMA,
        "classification": "W1_CALLBACK_GITHUB_OIDC_CONFIG_NONAUTHORITY",
        "repository": REPOSITORY,
        "repository_id": REPOSITORY_ID,
        "repository_owner_id": REPOSITORY_OWNER_ID,
        "environment": ENVIRONMENT,
        "use_default": True,
        "custom_claim_template_enabled": False,
        "immutable_subject_not_disabled": True,
        "expected_subject": EXPECTED_SUBJECT,
        "provider_credentials_used": False,
        "oidc_token_requested": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }
    out = dict(core); out["receipt_sha256"] = _sha(core); return out


def validate_oidc_config_receipt(value: Any) -> dict[str, Any]:
    r = _self_hashed(value, OIDC_CONFIG_SCHEMA, "oidc_config_receipt")
    expected = (r.get("repository"), r.get("repository_id"), r.get("repository_owner_id"), r.get("environment"), r.get("expected_subject"))
    if expected != (REPOSITORY, REPOSITORY_ID, REPOSITORY_OWNER_ID, ENVIRONMENT, EXPECTED_SUBJECT):
        raise CallbackProtectedBindingError("oidc_config_identity_mismatch")
    if r.get("use_default") is not True or r.get("custom_claim_template_enabled") is not False or r.get("immutable_subject_not_disabled") is not True:
        raise CallbackProtectedBindingError("oidc_config_boundary_invalid")
    _false(r, ("provider_credentials_used", "oidc_token_requested", "w1_verified", "canonical", "authority_effect"), "oidc_config")
    return r


def compare_oidc_config(before: Any, after: Any) -> dict[str, Any]:
    left, right = validate_oidc_config_receipt(before), validate_oidc_config_receipt(after)
    if left != right:
        raise CallbackProtectedBindingError("oidc_config_drift_across_environment_gate")
    return left


def validate_environment_receipt(value: Any) -> dict[str, Any]:
    r = _self_hashed(value, ENV_SCHEMA, "environment_receipt")
    if (r.get("repository"), r.get("repository_id"), r.get("repository_owner_id"), r.get("environment")) != (REPOSITORY, REPOSITORY_ID, REPOSITORY_OWNER_ID, ENVIRONMENT):
        raise CallbackProtectedBindingError("environment_receipt_identity_mismatch")
    if r.get("can_admins_bypass") is not False or r.get("prevent_self_review") is not True:
        raise CallbackProtectedBindingError("environment_receipt_review_boundary_invalid")
    if r.get("deployment_branch_policy_mode") != "EXACT_CUSTOM_MAIN_ONLY" or r.get("main_branch_protected") is not True:
        raise CallbackProtectedBindingError("environment_receipt_deployment_boundary_invalid")
    if r.get("expected_oidc_context") != {"repository": REPOSITORY, "repository_id": REPOSITORY_ID, "repository_owner_id": REPOSITORY_OWNER_ID, "environment": ENVIRONMENT, "ref": EXPECTED_REF}:
        raise CallbackProtectedBindingError("environment_receipt_oidc_context_mismatch")
    _false(r, ("provider_credentials_used", "aws_execution_authorized", "supabase_mutation_authorized", "worker_admitted", "w1_verified", "canonical", "authority_effect"), "environment_receipt")
    return r


def validate_gate_receipt(value: Any) -> dict[str, Any]:
    r = _self_hashed(value, GATE_SCHEMA, "gate_receipt")
    if (r.get("repository"), r.get("repository_id"), r.get("repository_owner_id"), r.get("environment"), r.get("ref")) != (REPOSITORY, REPOSITORY_ID, REPOSITORY_OWNER_ID, ENVIRONMENT, EXPECTED_REF):
        raise CallbackProtectedBindingError("gate_identity_mismatch")
    if r.get("environment_gate_job_started_after_protection_rules") is not True or r.get("environment_metadata_stable_across_gate") is not True:
        raise CallbackProtectedBindingError("gate_protection_or_drift_invalid")
    for field in ("github_run_id", "github_run_attempt"):
        if not isinstance(r.get(field), str) or RUN_ID.fullmatch(r[field]) is None:
            raise CallbackProtectedBindingError(f"gate_{field}_invalid")
    _false(r, ("provider_credentials_used", "oidc_token_requested", "aws_execution_authorized", "supabase_mutation_authorized", "worker_admitted", "w1_verified", "canonical", "authority_effect"), "gate")
    return r


def validate_oidc_claims(value: Any, *, gate: Any, oidc_config: Any, git_sha: str, now_epoch: int | None = None) -> dict[str, Any]:
    claims = _obj(value, "oidc_claims")
    gate_r = validate_gate_receipt(gate)
    oidc_r = validate_oidc_config_receipt(oidc_config)
    if not isinstance(git_sha, str) or HEX40.fullmatch(git_sha) is None:
        raise CallbackProtectedBindingError("git_sha_invalid")
    expected = {
        "iss": ISSUER, "aud": AUDIENCE, "sub": EXPECTED_SUBJECT,
        "repository": REPOSITORY, "repository_id": REPOSITORY_ID, "repository_owner_id": REPOSITORY_OWNER_ID,
        "environment": ENVIRONMENT, "ref": EXPECTED_REF, "ref_type": "branch", "event_name": EXPECTED_EVENT,
        "sha": git_sha, "workflow_ref": EXPECTED_WORKFLOW_REF, "workflow_sha": git_sha,
        "run_id": gate_r["github_run_id"], "run_attempt": gate_r["github_run_attempt"],
        "runner_environment": EXPECTED_RUNNER_ENVIRONMENT,
    }
    for key, expected_value in expected.items():
        if str(claims.get(key)) != str(expected_value):
            raise CallbackProtectedBindingError(f"oidc_claim_mismatch:{key}")
    token_sha = claims.get("token_sha256")
    if not isinstance(token_sha, str) or HEX64.fullmatch(token_sha) is None:
        raise CallbackProtectedBindingError("oidc_token_sha256_invalid")
    jti = claims.get("jti")
    if not isinstance(jti, str) or JTI.fullmatch(jti) is None:
        raise CallbackProtectedBindingError("oidc_jti_invalid")
    times: dict[str, int] = {}
    for key in ("iat", "nbf", "exp"):
        raw = claims.get(key)
        if not isinstance(raw, int) or isinstance(raw, bool):
            raise CallbackProtectedBindingError(f"oidc_{key}_invalid")
        times[key] = raw
    # GitHub's documented JWT example has nbf before iat. Validate the complete token window.
    if not (times["nbf"] <= times["iat"] <= times["exp"]):
        raise CallbackProtectedBindingError("oidc_time_order_invalid")
    if times["exp"] - times["nbf"] > 1200:
        raise CallbackProtectedBindingError("oidc_lifetime_too_long")
    now = int(time.time()) if now_epoch is None else int(now_epoch)
    if times["iat"] > now + 60 or times["nbf"] > now + 60 or times["exp"] < now - 60:
        raise CallbackProtectedBindingError("oidc_token_not_current")
    core = {
        "schema": OIDC_CLAIMS_SCHEMA,
        "classification": "W1_CALLBACK_GITHUB_OIDC_CLAIMS_LOCALLY_BOUND_NONAUTHORITY",
        "environment_gate_receipt_sha256": gate_r["receipt_sha256"],
        "oidc_config_receipt_sha256": oidc_r["receipt_sha256"],
        "repository": REPOSITORY, "repository_id": REPOSITORY_ID, "repository_owner_id": REPOSITORY_OWNER_ID,
        "environment": ENVIRONMENT, "issuer": ISSUER, "audience": AUDIENCE, "subject": EXPECTED_SUBJECT,
        "ref": EXPECTED_REF, "event_name": EXPECTED_EVENT, "git_sha": git_sha,
        "workflow_ref": EXPECTED_WORKFLOW_REF, "runner_environment": EXPECTED_RUNNER_ENVIRONMENT,
        "github_run_id": gate_r["github_run_id"], "github_run_attempt": gate_r["github_run_attempt"],
        "jti": jti, "issued_at": times["iat"], "not_before": times["nbf"], "expires_at": times["exp"],
        "token_sha256": token_sha, "jwt_signature_locally_verified": False,
        "cloud_provider_acceptance_required": True, "provider_credentials_used": False,
        "aws_execution_authorized": False, "w1_verified": False, "canonical": False, "authority_effect": False,
    }
    out = dict(core); out["receipt_sha256"] = _sha(core); return out


def validate_oidc_claims_receipt(value: Any) -> dict[str, Any]:
    r = _self_hashed(value, OIDC_CLAIMS_SCHEMA, "oidc_claims_receipt")
    if r.get("subject") != EXPECTED_SUBJECT or r.get("audience") != AUDIENCE:
        raise CallbackProtectedBindingError("oidc_claims_receipt_identity_mismatch")
    if r.get("jwt_signature_locally_verified") is not False or r.get("cloud_provider_acceptance_required") is not True:
        raise CallbackProtectedBindingError("oidc_claims_receipt_verification_boundary_invalid")
    _false(r, ("provider_credentials_used", "aws_execution_authorized", "w1_verified", "canonical", "authority_effect"), "oidc_claims")
    return r


def build_aws_session_policy(*, role_arn: str, account_id: str, region: str) -> dict[str, Any]:
    partition, _ = _role(role_arn, account_id, region)
    doc_arns = [f"arn:{partition}:ssm:{region}:{account_id}:document/{name}" for name in DOCUMENT_NAMES]
    policy = {"Version": "2012-10-17", "Statement": [
        {"Sid": "ReadExactCallbackRoleTrust", "Effect": "Allow", "Action": "iam:GetRole", "Resource": role_arn},
        {"Sid": "InventoryOwnedCallbackDocuments", "Effect": "Allow", "Action": "ssm:ListDocuments", "Resource": "*"},
        {"Sid": "ReadExactCallbackDocuments", "Effect": "Allow", "Action": ["ssm:DescribeDocument", "ssm:GetDocument", "ssm:DescribeDocumentPermission"], "Resource": doc_arns},
    ]}
    policy_json = json.dumps(policy, separators=(",", ":"), sort_keys=True)
    if len(policy_json) > 2048:
        raise CallbackProtectedBindingError("aws_inline_session_policy_too_large")
    core = {
        "schema": AWS_POLICY_SCHEMA, "classification": "W1_CALLBACK_AWS_READONLY_SESSION_POLICY_NONAUTHORITY",
        "account_id": account_id, "region": region, "role_arn": role_arn, "session_policy": policy,
        "session_policy_chars": len(policy_json), "session_duration_seconds": 900, "mutation_actions_present": False,
        "database_mutation_authorized": False, "edge_deployment_authorized": False, "aws_mutation_authorized": False,
        "send_command_authorized": False, "w1_verified": False, "canonical": False, "authority_effect": False,
    }
    out = dict(core); out["receipt_sha256"] = _sha(core); return out


def validate_aws_policy_receipt(value: Any) -> dict[str, Any]:
    r = _self_hashed(value, AWS_POLICY_SCHEMA, "aws_policy_receipt")
    expected = build_aws_session_policy(role_arn=str(r.get("role_arn") or ""), account_id=str(r.get("account_id") or ""), region=str(r.get("region") or ""))
    if r != expected:
        raise CallbackProtectedBindingError("aws_policy_receipt_not_exact_contract")
    return r


def _trust_document(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(urllib.parse.unquote(value))
        except json.JSONDecodeError as exc:
            raise CallbackProtectedBindingError("iam_trust_policy_invalid_json") from exc
        if isinstance(parsed, dict):
            return parsed
    raise CallbackProtectedBindingError("iam_trust_policy_invalid")


def validate_exact_role_trust(*, get_role: Any, role_arn: str, account_id: str, region: str) -> dict[str, Any]:
    partition, role_path = _role(role_arn, account_id, region)
    role = _obj(_obj(get_role, "iam_get_role").get("Role"), "iam_role")
    role_name = role_path.rsplit("/", 1)[-1]
    if role.get("Arn") != role_arn or role.get("RoleName") != role_name:
        raise CallbackProtectedBindingError("iam_role_identity_mismatch")
    max_duration = role.get("MaxSessionDuration")
    if not isinstance(max_duration, int) or isinstance(max_duration, bool) or max_duration < 900:
        raise CallbackProtectedBindingError("iam_role_session_duration_too_short")
    policy = _trust_document(role.get("AssumeRolePolicyDocument"))
    statements = policy.get("Statement")
    if not isinstance(statements, list) or len(statements) != 1:
        raise CallbackProtectedBindingError("iam_trust_exactly_one_statement_required")
    st = _obj(statements[0], "iam_trust_statement")
    if st.get("Effect") != "Allow" or st.get("Action") != "sts:AssumeRoleWithWebIdentity":
        raise CallbackProtectedBindingError("iam_trust_effect_or_action_invalid")
    principal = _obj(st.get("Principal"), "iam_trust_principal")
    expected_provider = f"arn:{partition}:iam::{account_id}:oidc-provider/token.actions.githubusercontent.com"
    if set(principal) != {"Federated"} or principal.get("Federated") != expected_provider:
        raise CallbackProtectedBindingError("iam_trust_provider_mismatch")
    condition = _obj(st.get("Condition"), "iam_trust_condition")
    expected_equals = {"token.actions.githubusercontent.com:aud": AUDIENCE, "token.actions.githubusercontent.com:sub": EXPECTED_SUBJECT}
    if set(condition) != {"StringEquals"} or _obj(condition.get("StringEquals"), "iam_trust_stringequals") != expected_equals:
        raise CallbackProtectedBindingError("iam_trust_aud_sub_not_exact")
    return {"role_name": role_name, "role_arn": role_arn, "max_session_duration": max_duration,
            "oidc_provider_arn": expected_provider, "audience": AUDIENCE, "subject": EXPECTED_SUBJECT,
            "exact_single_statement": True}


def validate_aws_attestation(*, claims: Any, session_policy: Any, sts_proof: Any, get_role: Any,
                             role_arn: str, account_id: str, region: str) -> dict[str, Any]:
    claims_r = validate_oidc_claims_receipt(claims)
    policy_r = validate_aws_policy_receipt(session_policy)
    if (policy_r["role_arn"], policy_r["account_id"], policy_r["region"]) != (role_arn, account_id, region):
        raise CallbackProtectedBindingError("aws_policy_context_mismatch")
    proof = _obj(sts_proof, "sts_proof")
    expected_keys = {"subject_from_web_identity_token", "audience", "provider", "assumed_role_arn", "assumed_role_id", "packed_policy_size", "account_id", "caller_arn", "token_sha256", "role_session_name"}
    if set(proof) != expected_keys:
        raise CallbackProtectedBindingError("sts_proof_shape_invalid")
    if proof["subject_from_web_identity_token"] != EXPECTED_SUBJECT or proof["audience"] != AUDIENCE:
        raise CallbackProtectedBindingError("sts_subject_or_audience_mismatch")
    if not isinstance(proof["provider"], str) or not proof["provider"]:
        raise CallbackProtectedBindingError("sts_provider_invalid")
    if proof["token_sha256"] != claims_r["token_sha256"] or proof["account_id"] != account_id:
        raise CallbackProtectedBindingError("sts_token_hash_or_account_mismatch")
    session_name = f"w1-callback-bind-{claims_r['github_run_id']}-{claims_r['github_run_attempt']}"
    if proof["role_session_name"] != session_name:
        raise CallbackProtectedBindingError("sts_role_session_name_mismatch")
    partition, role_path = _role(role_arn, account_id, region)
    role_name = role_path.rsplit("/", 1)[-1]
    expected_arn = f"arn:{partition}:sts::{account_id}:assumed-role/{role_name}/{session_name}"
    if proof["assumed_role_arn"] != expected_arn or proof["caller_arn"] != expected_arn:
        raise CallbackProtectedBindingError("sts_assumed_role_identity_mismatch")
    if not isinstance(proof["assumed_role_id"], str) or not proof["assumed_role_id"]:
        raise CallbackProtectedBindingError("sts_assumed_role_id_invalid")
    if not isinstance(proof["packed_policy_size"], int) or isinstance(proof["packed_policy_size"], bool) or not 0 <= proof["packed_policy_size"] <= 100:
        raise CallbackProtectedBindingError("sts_packed_policy_size_invalid")
    trust = validate_exact_role_trust(get_role=get_role, role_arn=role_arn, account_id=account_id, region=region)
    core = {
        "schema": AWS_ATTESTATION_SCHEMA, "classification": "W1_CALLBACK_AWS_OIDC_ATTESTATION_NONAUTHORITY",
        "oidc_claims_receipt_sha256": claims_r["receipt_sha256"], "aws_session_policy_receipt_sha256": policy_r["receipt_sha256"],
        "account_id": account_id, "region": region, "role_arn": role_arn, "role_session_name": session_name,
        "subject_from_web_identity_token": EXPECTED_SUBJECT, "audience": AUDIENCE, "token_sha256": claims_r["token_sha256"],
        "packed_policy_size": proof["packed_policy_size"], "iam_role_trust": trust,
        "same_checked_oidc_token_submitted_to_sts": True, "aws_sts_accepted_subject": True,
        "aws_role_trust_policy_exact": True, "temporary_credentials_persisted": False,
        "database_mutation_authorized": False, "edge_deployment_authorized": False, "aws_mutation_authorized": False,
        "send_command_authorized": False, "provider_identity_verified": False, "persistent_worker_proof": False,
        "worker_admitted": False, "w1_verified": False, "canonical": False, "authority_effect": False,
    }
    out = dict(core); out["receipt_sha256"] = _sha(core); return out


def validate_aws_attestation_receipt(value: Any) -> dict[str, Any]:
    r = _self_hashed(value, AWS_ATTESTATION_SCHEMA, "aws_attestation_receipt")
    if r.get("subject_from_web_identity_token") != EXPECTED_SUBJECT or r.get("audience") != AUDIENCE:
        raise CallbackProtectedBindingError("aws_attestation_identity_mismatch")
    if not all(r.get(k) is True for k in ("same_checked_oidc_token_submitted_to_sts", "aws_sts_accepted_subject", "aws_role_trust_policy_exact")):
        raise CallbackProtectedBindingError("aws_attestation_boundary_invalid")
    trust = _obj(r.get("iam_role_trust"), "aws_attestation_role_trust")
    if trust.get("subject") != EXPECTED_SUBJECT or trust.get("audience") != AUDIENCE or trust.get("exact_single_statement") is not True:
        raise CallbackProtectedBindingError("aws_attestation_role_trust_invalid")
    _false(r, AUTHORITY_FALSE, "aws_attestation")
    return r


def validate_provider_readback(value: Any, *, git_sha: str, tree_sha: str) -> dict[str, Any]:
    root = _obj(value, "provider_readback")
    if root.get("schema") != PROVIDER_SCHEMA:
        raise CallbackProtectedBindingError("provider_readback_schema_invalid")
    _false(root, ("database_mutation_authorized", "edge_deployment_authorized", "aws_mutation_authorized", "send_command_authorized", "worker_admitted", "w1_verified", "canonical", "authority_effect"), "provider_readback")
    if root.get("absence_requires_authenticated_inventory") is not True or root.get("provider_error_treated_as_absence") is not False:
        raise CallbackProtectedBindingError("provider_readback_inventory_boundary_invalid")
    readiness = _obj(root.get("readiness"), "provider_readiness")
    if readiness.get("schema") != READINESS_SCHEMA or readiness.get("status") not in ("READY_CANDIDATE_NON_AUTHORITY", "NOT_READY"):
        raise CallbackProtectedBindingError("provider_readiness_schema_or_status_invalid")
    if readiness.get("ready_candidate") is not (readiness.get("status") == "READY_CANDIDATE_NON_AUTHORITY"):
        raise CallbackProtectedBindingError("provider_readiness_boolean_mismatch")
    _false(readiness, AUTHORITY_FALSE, "provider_readiness")
    evidence = _obj(readiness.get("evidence"), "provider_evidence")
    source = _obj(evidence.get("source"), "provider_source")
    if source.get("git_sha") != git_sha or source.get("tree_sha") != tree_sha:
        raise CallbackProtectedBindingError("provider_source_revision_mismatch")
    claimed = readiness.get("evidence_sha256")
    if not isinstance(claimed, str) or HEX64.fullmatch(claimed) is None or _sha(evidence) != claimed:
        raise CallbackProtectedBindingError("provider_evidence_sha256_mismatch")
    reasons = readiness.get("reasons")
    if not isinstance(reasons, list) or any(not isinstance(x, str) for x in reasons):
        raise CallbackProtectedBindingError("provider_reasons_invalid")
    return root


def seal_binding(*, environment: Any, gate: Any, oidc_config_before: Any, oidc_config_after: Any,
                 claims: Any, aws_attestation: Any, provider_readback: Any, git_sha: str, tree_sha: str) -> dict[str, Any]:
    env = validate_environment_receipt(environment)
    gate_r = validate_gate_receipt(gate)
    oidc = compare_oidc_config(oidc_config_before, oidc_config_after)
    claims_r = validate_oidc_claims_receipt(claims)
    aws = validate_aws_attestation_receipt(aws_attestation)
    if not isinstance(git_sha, str) or HEX40.fullmatch(git_sha) is None or not isinstance(tree_sha, str) or HEX40.fullmatch(tree_sha) is None:
        raise CallbackProtectedBindingError("binding_source_revision_invalid")
    provider = validate_provider_readback(provider_readback, git_sha=git_sha, tree_sha=tree_sha)
    if gate_r.get("preflight_receipt_sha256") != env["receipt_sha256"]:
        raise CallbackProtectedBindingError("binding_gate_environment_hash_mismatch")
    if claims_r.get("environment_gate_receipt_sha256") != gate_r["receipt_sha256"]:
        raise CallbackProtectedBindingError("binding_claim_gate_hash_mismatch")
    if claims_r.get("oidc_config_receipt_sha256") != oidc["receipt_sha256"]:
        raise CallbackProtectedBindingError("binding_claim_oidc_config_hash_mismatch")
    if aws.get("oidc_claims_receipt_sha256") != claims_r["receipt_sha256"]:
        raise CallbackProtectedBindingError("binding_aws_claim_hash_mismatch")
    readiness = provider["readiness"]
    core = {
        "schema": BINDING_SCHEMA, "classification": "W1_CALLBACK_PROTECTED_READBACK_BOUND_NONAUTHORITY",
        "repository": REPOSITORY, "repository_id": REPOSITORY_ID, "repository_owner_id": REPOSITORY_OWNER_ID,
        "environment": ENVIRONMENT, "git_sha": git_sha, "tree_sha": tree_sha,
        "github_run_id": gate_r["github_run_id"], "github_run_attempt": gate_r["github_run_attempt"],
        "environment_preflight_receipt_sha256": env["receipt_sha256"], "environment_gate_receipt_sha256": gate_r["receipt_sha256"],
        "oidc_config_receipt_sha256": oidc["receipt_sha256"], "oidc_claims_receipt_sha256": claims_r["receipt_sha256"],
        "aws_oidc_attestation_receipt_sha256": aws["receipt_sha256"], "provider_readback_sha256": _sha(provider),
        "provider_evidence_sha256": readiness["evidence_sha256"], "callback_readiness_status": readiness["status"],
        "callback_ready_candidate": readiness["ready_candidate"], "callback_readiness_reasons": readiness["reasons"],
        "environment_gate_verified": True, "environment_metadata_stable_across_gate": True,
        "oidc_config_stable_across_gate": True, "oidc_claims_locally_bound": True,
        "same_oidc_token_submitted_to_aws_sts": True, "aws_sts_accepted_expected_subject": True,
        "aws_role_trust_policy_exact": True, "authenticated_provider_readback_bound": True,
        "database_mutation_authorized": False, "edge_deployment_authorized": False, "aws_mutation_authorized": False,
        "send_command_authorized": False, "provider_identity_verified": False, "persistent_worker_proof": False,
        "worker_admitted": False, "w1_verified": False, "canonical": False, "authority_effect": False,
    }
    out = dict(core); out["receipt_sha256"] = _sha(core); return out


def validate_binding_receipt(value: Any) -> dict[str, Any]:
    r = _self_hashed(value, BINDING_SCHEMA, "binding_receipt")
    if r.get("callback_readiness_status") not in ("READY_CANDIDATE_NON_AUTHORITY", "NOT_READY"):
        raise CallbackProtectedBindingError("binding_readiness_status_invalid")
    if r.get("callback_ready_candidate") is not (r["callback_readiness_status"] == "READY_CANDIDATE_NON_AUTHORITY"):
        raise CallbackProtectedBindingError("binding_readiness_boolean_mismatch")
    _false(r, AUTHORITY_FALSE, "binding")
    return r


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(); sub = p.add_subparsers(dest="command", required=True)
    x=sub.add_parser("validate-oidc-config"); x.add_argument("--input",type=Path,required=True); x.add_argument("--output",type=Path,required=True)
    x=sub.add_parser("compare-oidc-config"); x.add_argument("--before",type=Path,required=True); x.add_argument("--after",type=Path,required=True)
    x=sub.add_parser("validate-oidc-claims"); x.add_argument("--input",type=Path,required=True); x.add_argument("--gate",type=Path,required=True); x.add_argument("--oidc-config",type=Path,required=True); x.add_argument("--git-sha",required=True); x.add_argument("--now-epoch",type=int); x.add_argument("--output",type=Path,required=True)
    x=sub.add_parser("build-aws-session-policy"); x.add_argument("--role-arn",required=True); x.add_argument("--account-id",required=True); x.add_argument("--region",required=True); x.add_argument("--output",type=Path,required=True)
    x=sub.add_parser("validate-aws-attestation"); x.add_argument("--claims",type=Path,required=True); x.add_argument("--session-policy",type=Path,required=True); x.add_argument("--sts-proof",type=Path,required=True); x.add_argument("--get-role",type=Path,required=True); x.add_argument("--role-arn",required=True); x.add_argument("--account-id",required=True); x.add_argument("--region",required=True); x.add_argument("--output",type=Path,required=True)
    x=sub.add_parser("seal-binding"); x.add_argument("--environment",type=Path,required=True); x.add_argument("--gate",type=Path,required=True); x.add_argument("--oidc-config-before",type=Path,required=True); x.add_argument("--oidc-config-after",type=Path,required=True); x.add_argument("--claims",type=Path,required=True); x.add_argument("--aws-attestation",type=Path,required=True); x.add_argument("--provider-readback",type=Path,required=True); x.add_argument("--git-sha",required=True); x.add_argument("--tree-sha",required=True); x.add_argument("--output",type=Path,required=True)
    x=sub.add_parser("validate-binding"); x.add_argument("--input",type=Path,required=True)
    a=p.parse_args(argv)
    try:
        if a.command=="validate-oidc-config": _write(a.output,validate_oidc_config(_read(a.input,"oidc_config")))
        elif a.command=="compare-oidc-config": compare_oidc_config(_read(a.before,"oidc_before"),_read(a.after,"oidc_after"))
        elif a.command=="validate-oidc-claims": _write(a.output,validate_oidc_claims(_read(a.input,"claims"),gate=_read(a.gate,"gate"),oidc_config=_read(a.oidc_config,"oidc"),git_sha=a.git_sha,now_epoch=a.now_epoch))
        elif a.command=="build-aws-session-policy": _write(a.output,build_aws_session_policy(role_arn=a.role_arn,account_id=a.account_id,region=a.region))
        elif a.command=="validate-aws-attestation": _write(a.output,validate_aws_attestation(claims=_read(a.claims,"claims"),session_policy=_read(a.session_policy,"policy"),sts_proof=_read(a.sts_proof,"sts"),get_role=_read(a.get_role,"role"),role_arn=a.role_arn,account_id=a.account_id,region=a.region))
        elif a.command=="seal-binding": _write(a.output,seal_binding(environment=_read(a.environment,"environment"),gate=_read(a.gate,"gate"),oidc_config_before=_read(a.oidc_config_before,"oidc_before"),oidc_config_after=_read(a.oidc_config_after,"oidc_after"),claims=_read(a.claims,"claims"),aws_attestation=_read(a.aws_attestation,"aws"),provider_readback=_read(a.provider_readback,"provider"),git_sha=a.git_sha,tree_sha=a.tree_sha))
        else: validate_binding_receipt(_read(a.input,"binding"))
        return 0
    except CallbackProtectedBindingError as exc:
        print(f"W1_CALLBACK_PROTECTED_BINDING_REJECTED:{exc}",file=sys.stderr); return 2

if __name__ == "__main__":
    raise SystemExit(main())
