#!/usr/bin/env python3
"""Offline Supabase Management credential provenance contract for W1 callback readback.

This module never contacts Supabase and never grants provider authority. It models what
can and cannot be proved about Management API credentials from provider-documented
mechanisms and sanitized exchange metadata.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

SCHEMA = "metaengine.compute.w1-supabase-management-credential-provenance.h205f22.v1"
PROJECT_REF = "xpeibufgzjknrhbhpffp"
EDGE_READ_SCOPE = "edge_functions:read"
EDGE_READ_PERMISSION = "edge_functions_read"
EDGE_WRITE_SCOPE = "edge_functions:write"
IDJAG_ELIGIBLE_PLANS = {"team", "enterprise"}
KNOWN_PLANS = {"free", "pro", "team", "enterprise"}
MECHANISMS = {"PAT_TRANSITIONAL", "OAUTH_REFRESH_SCOPED", "IDJAG_WORKLOAD_SCOPED"}
LOCAL_ACCESS_TOKEN_TTL_CAP_SECONDS = 3600
SHA256 = re.compile(r"^[0-9a-f]{64}$")

AUTHORITY_FIELDS = (
    "database_mutation_authorized",
    "edge_deployment_authorized",
    "supabase_management_write_authorized",
    "provider_mutation_authorized",
    "worker_admitted",
    "w1_verified",
    "canonical",
    "authority_effect",
)


class CredentialProvenanceError(RuntimeError):
    pass


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def _object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise CredentialProvenanceError(f"{label}_not_object")
    return value


def _normalize_plan(plan: str) -> str:
    value = plan.strip().lower()
    if value not in KNOWN_PLANS:
        raise CredentialProvenanceError("organization_plan_unknown")
    return value


def _normalize_scope(scope: str | None, *, required: bool) -> str | None:
    if scope is None or not scope.strip():
        if required:
            raise CredentialProvenanceError("requested_scope_required")
        return None
    value = scope.strip()
    if value != EDGE_READ_SCOPE:
        if EDGE_WRITE_SCOPE in value:
            raise CredentialProvenanceError("write_scope_forbidden")
        raise CredentialProvenanceError("requested_scope_must_be_exact_edge_read")
    return value


def _sanitize_token_response(value: Any | None) -> dict[str, Any]:
    if value is None:
        return {
            "exchange_observed": False,
            "access_token_observed": False,
            "refresh_token_observed": False,
            "token_type": None,
            "expires_in_seconds": None,
            "short_lived_access_token_within_local_cap": False,
        }
    response = _object(value, "token_response")
    access = response.get("access_token")
    if not isinstance(access, str) or not access:
        raise CredentialProvenanceError("access_token_missing")
    token_type = response.get("token_type")
    if token_type != "Bearer":
        raise CredentialProvenanceError("token_type_must_be_bearer")
    expires_in = response.get("expires_in")
    if not isinstance(expires_in, int) or isinstance(expires_in, bool) or expires_in <= 0:
        raise CredentialProvenanceError("expires_in_invalid")
    if expires_in > LOCAL_ACCESS_TOKEN_TTL_CAP_SECONDS:
        raise CredentialProvenanceError("access_token_ttl_exceeds_local_cap")
    refresh = response.get("refresh_token")
    if refresh is not None and (not isinstance(refresh, str) or not refresh):
        raise CredentialProvenanceError("refresh_token_invalid")
    return {
        "exchange_observed": True,
        "access_token_observed": True,
        "refresh_token_observed": isinstance(refresh, str) and bool(refresh),
        "token_type": "Bearer",
        "expires_in_seconds": expires_in,
        "short_lived_access_token_within_local_cap": True,
    }


def evaluate(*, organization_plan: str, mechanism: str,
             requested_scope: str | None = None,
             token_response: Any | None = None) -> dict[str, Any]:
    plan = _normalize_plan(organization_plan)
    if mechanism not in MECHANISMS:
        raise CredentialProvenanceError("mechanism_unknown")

    requested: str | None
    token_meta: dict[str, Any]
    mechanism_available = True
    workload_identity_exchange_capable = False
    long_lived_secret_required = False
    migration_blocker: str | None = None
    status: str

    if mechanism == "PAT_TRANSITIONAL":
        requested = _normalize_scope(requested_scope, required=False)
        if requested is not None:
            raise CredentialProvenanceError("pat_scope_claim_forbidden")
        if token_response is not None:
            raise CredentialProvenanceError("pat_token_response_forbidden")
        token_meta = _sanitize_token_response(None)
        long_lived_secret_required = True
        status = "UNVERIFIED_USER_ACCOUNT_AUTHORITY"
        migration_blocker = "PAT_INHERITS_USER_PRIVILEGES"
    elif mechanism == "OAUTH_REFRESH_SCOPED":
        requested = _normalize_scope(requested_scope, required=True)
        token_meta = _sanitize_token_response(token_response)
        long_lived_secret_required = True
        status = "REQUESTED_SCOPE_NOT_PROVIDER_INTROSPECTED"
        migration_blocker = "GRANTED_SCOPE_NOT_RETURNED_BY_DOCUMENTED_TOKEN_RESPONSE"
    else:
        requested = _normalize_scope(requested_scope, required=True)
        workload_identity_exchange_capable = plan in IDJAG_ELIGIBLE_PLANS
        if not workload_identity_exchange_capable:
            mechanism_available = False
            if token_response is not None:
                raise CredentialProvenanceError("idjag_exchange_observation_forbidden_on_ineligible_plan")
            token_meta = _sanitize_token_response(None)
            status = "BLOCKED_PLAN_TIER"
            migration_blocker = "IDJAG_REQUIRES_TEAM_OR_ENTERPRISE"
        else:
            token_meta = _sanitize_token_response(token_response)
            status = "REQUESTED_SCOPE_NOT_PROVIDER_INTROSPECTED"
            migration_blocker = "GRANTED_SCOPE_NOT_RETURNED_BY_DOCUMENTED_TOKEN_RESPONSE"

    if plan in IDJAG_ELIGIBLE_PLANS:
        recommended_target = "IDJAG_WORKLOAD_SCOPED"
    else:
        recommended_target = "OAUTH_REFRESH_SCOPED"

    core: dict[str, Any] = {
        "schema": SCHEMA,
        "classification": "W1_SUPABASE_MANAGEMENT_CREDENTIAL_PROVENANCE_NONAUTHORITY",
        "project_ref": PROJECT_REF,
        "organization_plan": plan,
        "mechanism": mechanism,
        "mechanism_available_on_plan": mechanism_available,
        "documented_edge_read_scope": EDGE_READ_SCOPE,
        "documented_edge_read_permission": EDGE_READ_PERMISSION,
        "documented_edge_write_scope": EDGE_WRITE_SCOPE,
        "requested_scope": requested,
        "requested_scope_exact_read_only": requested == EDGE_READ_SCOPE,
        "credential_scope_status": status,
        "provider_credential_scope_verified": False,
        "provider_scope_introspection_observed": False,
        "operation_surface_get_only": True,
        "write_scope_requested": False,
        "workload_identity_exchange_capable_on_plan": workload_identity_exchange_capable,
        "long_lived_secret_required_by_mechanism": long_lived_secret_required,
        "recommended_target_mechanism": recommended_target,
        "migration_blocker": migration_blocker,
        "access_token_observed": token_meta["access_token_observed"],
        "refresh_token_observed": token_meta["refresh_token_observed"],
        "raw_access_token_persisted": False,
        "raw_refresh_token_persisted": False,
        "token_type": token_meta["token_type"],
        "expires_in_seconds": token_meta["expires_in_seconds"],
        "local_access_token_ttl_cap_seconds": LOCAL_ACCESS_TOKEN_TTL_CAP_SECONDS,
        "short_lived_access_token_within_local_cap": token_meta["short_lived_access_token_within_local_cap"],
        "exchange_observed": token_meta["exchange_observed"],
        "database_mutation_authorized": False,
        "edge_deployment_authorized": False,
        "supabase_management_write_authorized": False,
        "provider_mutation_authorized": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }
    result = dict(core)
    result["receipt_sha256"] = _sha(core)
    return result


def validate_receipt(value: Any) -> dict[str, Any]:
    receipt = _object(value, "receipt")
    if receipt.get("schema") != SCHEMA:
        raise CredentialProvenanceError("receipt_schema_invalid")
    claimed = receipt.get("receipt_sha256")
    if not isinstance(claimed, str) or SHA256.fullmatch(claimed) is None:
        raise CredentialProvenanceError("receipt_sha256_invalid")
    core = dict(receipt)
    core.pop("receipt_sha256", None)
    if _sha(core) != claimed:
        raise CredentialProvenanceError("receipt_sha256_mismatch")
    if receipt.get("provider_credential_scope_verified") is not False:
        raise CredentialProvenanceError("credential_scope_must_not_be_claimed_verified")
    if receipt.get("provider_scope_introspection_observed") is not False:
        raise CredentialProvenanceError("provider_scope_introspection_must_be_false")
    if receipt.get("write_scope_requested") is not False:
        raise CredentialProvenanceError("write_scope_must_be_false")
    if receipt.get("raw_access_token_persisted") is not False or receipt.get("raw_refresh_token_persisted") is not False:
        raise CredentialProvenanceError("raw_token_persistence_forbidden")
    for field in AUTHORITY_FIELDS:
        if receipt.get(field) is not False:
            raise CredentialProvenanceError(f"receipt_{field}_must_be_false")
    return receipt


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise CredentialProvenanceError("token_response_invalid_json") from exc


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(_canonical(value) + b"\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    check = sub.add_parser("evaluate")
    check.add_argument("--organization-plan", required=True)
    check.add_argument("--mechanism", choices=sorted(MECHANISMS), required=True)
    check.add_argument("--requested-scope")
    check.add_argument("--token-response", type=Path)
    check.add_argument("--output", type=Path, required=True)

    validate = sub.add_parser("validate-receipt")
    validate.add_argument("--input", type=Path, required=True)

    args = parser.parse_args(argv)
    try:
        if args.command == "evaluate":
            token_response = _read_json(args.token_response) if args.token_response else None
            result = evaluate(
                organization_plan=args.organization_plan,
                mechanism=args.mechanism,
                requested_scope=args.requested_scope,
                token_response=token_response,
            )
            _write_json(args.output, result)
        else:
            validate_receipt(_read_json(args.input))
        return 0
    except CredentialProvenanceError as exc:
        print(f"W1_SUPABASE_MANAGEMENT_CREDENTIAL_PROVENANCE_REJECTED:{exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
