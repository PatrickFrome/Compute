#!/usr/bin/env python3
"""Fail-closed W1 callback ingress readiness/readback guard.

This guard composes caller-supplied readback from three independent surfaces:
Postgres objects/grants, Supabase Edge deployment identity, and AWS SSM document
identity. It never mutates providers and never emits authority.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from typing import Any

SCHEMA = "metaengine.compute.w1-callback-ingress-readiness.h205f22.v1"
INPUT_SCHEMA = "metaengine.compute.w1-callback-ingress-readiness-input.h205f22.v1"
STATUS_READY = "READY_CANDIDATE_NON_AUTHORITY"
STATUS_NOT_READY = "NOT_READY"
MAX_STDIN_CHARS = 500_000
HEX40 = re.compile(r"^[0-9a-f]{40}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
ACCOUNT = re.compile(r"^[0-9]{12}$")

SOURCE_BLOBS = {
    "prep_sql": "8122603e6b87d726460937cc84d6c0bdb2fd7663",
    "edge_index": "3426721cf6b0f7a3bc1b74d23967da7b420a59a7",
    "config": "00a51f24203799703afe2de034dbd4ff0d45d556",
    "key_document": "d5a74d4a00799f46259c740d32dbc0bfad6abb37",
    "execution_document": "7660ee6b837e0cf07eca17845350fd045c2b2a86",
}
EDGE_SLUG = "w1-execution-callback"
KEY_TABLE = "compute_fabric_w1_callback_key_h205f22"
RECEIPT_TABLE = "compute_fabric_w1_execution_callback_receipt_h205f22"
FUNCTIONS = {
    "register_key": "compute_fabric_register_w1_callback_key_h205f22(jsonb)",
    "revoke_key": "compute_fabric_revoke_w1_callback_key_h205f22(text,timestamp with time zone)",
    "get_key": "compute_fabric_get_w1_callback_key_h205f22(text)",
    "record_callback": "compute_fabric_record_w1_execution_callback_h205f22(jsonb)",
}
DOCUMENTS = {
    "key_enrollment": ("Metaengine-W1-Callback-Key-Enroll-H205F22", SOURCE_BLOBS["key_document"]),
    "execution_marker": ("Metaengine-W1-Execution-Marker-H205F22", SOURCE_BLOBS["execution_document"]),
}
PROTECTED_DB = "PROTECTED_SUPABASE_SQL_READBACK"
PROTECTED_EDGE = "PROTECTED_SUPABASE_EDGE_READBACK"
PROTECTED_AWS = "PROTECTED_AWS_API_READBACK"


class ReadinessError(RuntimeError):
    pass


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _digest(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode()).hexdigest()


def _obj(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ReadinessError(f"{label}_not_object")
    return value


def _exact_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    if set(value) != expected:
        raise ReadinessError(f"{label}_shape_invalid")


def _bool(value: Any, label: str) -> bool:
    if not isinstance(value, bool):
        raise ReadinessError(f"{label}_not_boolean")
    return value


def _privs(value: Any, label: str) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(x, str) for x in value):
        raise ReadinessError(f"{label}_invalid")
    if len(set(value)) != len(value):
        raise ReadinessError(f"{label}_duplicate")
    allowed = {"SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"}
    if any(x not in allowed for x in value):
        raise ReadinessError(f"{label}_unknown")
    return sorted(value)


def validate_source(value: Any) -> tuple[dict[str, Any], list[str]]:
    source = _obj(value, "source")
    _exact_keys(source, {"git_sha", "tree_sha", "artifacts"}, "source")
    for field in ("git_sha", "tree_sha"):
        if not isinstance(source[field], str) or HEX40.fullmatch(source[field]) is None:
            raise ReadinessError(f"source_{field}_invalid")
    artifacts = _obj(source["artifacts"], "source_artifacts")
    _exact_keys(artifacts, set(SOURCE_BLOBS), "source_artifacts")
    reasons: list[str] = []
    for name, expected in SOURCE_BLOBS.items():
        if artifacts.get(name) != expected:
            reasons.append(f"SOURCE_BLOB_MISMATCH:{name}")
    return source, reasons


def validate_table(name: str, value: Any) -> tuple[dict[str, Any], list[str]]:
    table = _obj(value, f"table_{name}")
    _exact_keys(table, {"present", "schema", "rls_enabled", "privileges", "service_role_column_updates"}, f"table_{name}")
    reasons: list[str] = []
    if not _bool(table["present"], f"table_{name}_present"):
        reasons.append(f"DB_TABLE_ABSENT:{name}")
        return table, reasons
    if table.get("schema") != "public":
        reasons.append(f"DB_TABLE_SCHEMA_MISMATCH:{name}")
    if not _bool(table["rls_enabled"], f"table_{name}_rls"):
        reasons.append(f"DB_RLS_DISABLED:{name}")
    privileges = _obj(table["privileges"], f"table_{name}_privileges")
    _exact_keys(privileges, {"public", "anon", "authenticated", "service_role"}, f"table_{name}_privileges")
    normalized = {role: _privs(privileges[role], f"table_{name}_{role}_privileges") for role in privileges}
    for role in ("public", "anon", "authenticated"):
        if normalized[role]:
            reasons.append(f"DB_EXPOSED_TABLE_PRIVILEGE:{name}:{role}")
    expected_service = ["INSERT", "SELECT"]
    if normalized["service_role"] != expected_service:
        reasons.append(f"DB_SERVICE_TABLE_PRIVILEGES_MISMATCH:{name}")
    updates = table["service_role_column_updates"]
    if not isinstance(updates, list) or any(not isinstance(x, str) for x in updates):
        raise ReadinessError(f"table_{name}_column_updates_invalid")
    expected_updates = ["revoked_at"] if name == KEY_TABLE else []
    if sorted(set(updates)) != expected_updates or len(updates) != len(set(updates)):
        reasons.append(f"DB_SERVICE_COLUMN_UPDATE_MISMATCH:{name}")
    return table, reasons


def validate_function(label: str, value: Any) -> tuple[dict[str, Any], list[str]]:
    fn = _obj(value, f"function_{label}")
    _exact_keys(fn, {"present", "schema", "identity", "security_definer", "execute"}, f"function_{label}")
    reasons: list[str] = []
    if not _bool(fn["present"], f"function_{label}_present"):
        reasons.append(f"DB_FUNCTION_ABSENT:{label}")
        return fn, reasons
    if fn.get("schema") != "public":
        reasons.append(f"DB_FUNCTION_SCHEMA_MISMATCH:{label}")
    if fn.get("identity") != FUNCTIONS[label]:
        reasons.append(f"DB_FUNCTION_IDENTITY_MISMATCH:{label}")
    if _bool(fn["security_definer"], f"function_{label}_security_definer"):
        reasons.append(f"DB_SECURITY_DEFINER_FORBIDDEN:{label}")
    execute = _obj(fn["execute"], f"function_{label}_execute")
    _exact_keys(execute, {"public", "anon", "authenticated", "service_role"}, f"function_{label}_execute")
    for role in execute:
        _bool(execute[role], f"function_{label}_execute_{role}")
    for role in ("public", "anon", "authenticated"):
        if execute[role]:
            reasons.append(f"DB_EXPOSED_FUNCTION_EXECUTE:{label}:{role}")
    if not execute["service_role"]:
        reasons.append(f"DB_SERVICE_EXECUTE_MISSING:{label}")
    return fn, reasons


def validate_db(value: Any) -> tuple[dict[str, Any], list[str]]:
    db = _obj(value, "db")
    _exact_keys(db, {"provenance_class", "observed_at", "tables", "functions"}, "db")
    reasons: list[str] = []
    if db.get("provenance_class") != PROTECTED_DB:
        reasons.append("DB_PROVENANCE_NOT_PROTECTED")
    if not isinstance(db.get("observed_at"), str) or not db["observed_at"]:
        raise ReadinessError("db_observed_at_invalid")
    tables = _obj(db["tables"], "db_tables")
    _exact_keys(tables, {KEY_TABLE, RECEIPT_TABLE}, "db_tables")
    for name, payload in tables.items():
        _, rs = validate_table(name, payload)
        reasons.extend(rs)
    functions = _obj(db["functions"], "db_functions")
    _exact_keys(functions, set(FUNCTIONS), "db_functions")
    for label, payload in functions.items():
        _, rs = validate_function(label, payload)
        reasons.extend(rs)
    return db, reasons


def validate_edge(value: Any) -> tuple[dict[str, Any], list[str]]:
    edge = _obj(value, "edge")
    _exact_keys(edge, {"provenance_class", "observed_at", "present", "slug", "status", "verify_jwt", "version", "index_git_blob_sha"}, "edge")
    reasons: list[str] = []
    if edge.get("provenance_class") != PROTECTED_EDGE:
        reasons.append("EDGE_PROVENANCE_NOT_PROTECTED")
    if not isinstance(edge.get("observed_at"), str) or not edge["observed_at"]:
        raise ReadinessError("edge_observed_at_invalid")
    if not _bool(edge["present"], "edge_present"):
        reasons.append("EDGE_FUNCTION_ABSENT")
        return edge, reasons
    if edge.get("slug") != EDGE_SLUG:
        reasons.append("EDGE_SLUG_MISMATCH")
    if edge.get("status") != "ACTIVE":
        reasons.append("EDGE_NOT_ACTIVE")
    if _bool(edge["verify_jwt"], "edge_verify_jwt"):
        reasons.append("EDGE_VERIFY_JWT_MUST_BE_FALSE_FOR_SIGNED_WEBHOOK")
    version = edge.get("version")
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        reasons.append("EDGE_VERSION_INVALID")
    if edge.get("index_git_blob_sha") != SOURCE_BLOBS["edge_index"]:
        reasons.append("EDGE_SOURCE_BLOB_MISMATCH")
    return edge, reasons


def validate_document(label: str, value: Any, account_id: str) -> tuple[dict[str, Any], list[str]]:
    doc = _obj(value, f"aws_{label}")
    _exact_keys(doc, {"present", "name", "owner_account_id", "document_version", "latest_version", "default_version",
                      "status", "hash_type", "hash", "content_git_blob_sha"}, f"aws_{label}")
    expected_name, expected_blob = DOCUMENTS[label]
    reasons: list[str] = []
    if not _bool(doc["present"], f"aws_{label}_present"):
        reasons.append(f"AWS_DOCUMENT_ABSENT:{label}")
        return doc, reasons
    if doc.get("name") != expected_name:
        reasons.append(f"AWS_DOCUMENT_NAME_MISMATCH:{label}")
    if doc.get("owner_account_id") != account_id:
        reasons.append(f"AWS_DOCUMENT_OWNER_MISMATCH:{label}")
    for field in ("document_version", "latest_version", "default_version"):
        if str(doc.get(field)) != "1":
            reasons.append(f"AWS_DOCUMENT_VERSION_MISMATCH:{label}:{field}")
    if doc.get("status") != "Active":
        reasons.append(f"AWS_DOCUMENT_NOT_ACTIVE:{label}")
    if doc.get("hash_type") != "Sha256" or not isinstance(doc.get("hash"), str) or HEX64.fullmatch(doc["hash"]) is None:
        reasons.append(f"AWS_DOCUMENT_HASH_INVALID:{label}")
    if doc.get("content_git_blob_sha") != expected_blob:
        reasons.append(f"AWS_DOCUMENT_CONTENT_MISMATCH:{label}")
    return doc, reasons


def validate_aws(value: Any) -> tuple[dict[str, Any], list[str]]:
    aws = _obj(value, "aws")
    _exact_keys(aws, {"provenance_class", "observed_at", "account_id", "documents"}, "aws")
    reasons: list[str] = []
    if aws.get("provenance_class") != PROTECTED_AWS:
        reasons.append("AWS_PROVENANCE_NOT_PROTECTED")
    if not isinstance(aws.get("observed_at"), str) or not aws["observed_at"]:
        raise ReadinessError("aws_observed_at_invalid")
    account_id = aws.get("account_id")
    if not isinstance(account_id, str) or ACCOUNT.fullmatch(account_id) is None:
        raise ReadinessError("aws_account_id_invalid")
    docs = _obj(aws["documents"], "aws_documents")
    _exact_keys(docs, set(DOCUMENTS), "aws_documents")
    for label, payload in docs.items():
        _, rs = validate_document(label, payload, account_id)
        reasons.extend(rs)
    return aws, reasons


def evaluate(value: Any) -> dict[str, Any]:
    root = _obj(value, "input")
    _exact_keys(root, {"schema", "source", "db", "edge", "aws"}, "input")
    if root.get("schema") != INPUT_SCHEMA:
        raise ReadinessError("input_schema_invalid")
    source, source_reasons = validate_source(root["source"])
    db, db_reasons = validate_db(root["db"])
    edge, edge_reasons = validate_edge(root["edge"])
    aws, aws_reasons = validate_aws(root["aws"])
    reasons = source_reasons + db_reasons + edge_reasons + aws_reasons
    surfaces = {
        "source": {"ready": not source_reasons, "reasons": source_reasons},
        "database": {"ready": not db_reasons, "reasons": db_reasons},
        "edge": {"ready": not edge_reasons, "reasons": edge_reasons},
        "aws_documents": {"ready": not aws_reasons, "reasons": aws_reasons},
    }
    evidence = {
        "source": source,
        "observed_at": {"database": db["observed_at"], "edge": edge["observed_at"], "aws": aws["observed_at"]},
        "surface_readiness": surfaces,
    }
    ready = not reasons
    return {
        "schema": SCHEMA,
        "status": STATUS_READY if ready else STATUS_NOT_READY,
        "ready_candidate": ready,
        "reasons": reasons,
        "evidence": evidence,
        "evidence_sha256": _digest(evidence),
        "provenance_labels_are_self_asserted": True,
        "live_provider_readback_cryptographically_verified_by_guard": False,
        "database_mutation_authorized": False,
        "edge_deployment_authorized": False,
        "aws_mutation_authorized": False,
        "send_command_authorized": False,
        "provider_identity_verified": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }


def main() -> int:
    try:
        raw = sys.stdin.read(MAX_STDIN_CHARS + 1)
        if len(raw) > MAX_STDIN_CHARS:
            raise ReadinessError("stdin_too_large")
        result = evaluate(json.loads(raw))
        json.dump(result, sys.stdout, sort_keys=True, separators=(",", ":"))
        sys.stdout.write("\n")
        return 0
    except (ReadinessError, json.JSONDecodeError) as exc:
        print(f"W1_CALLBACK_INGRESS_READINESS_REJECTED:{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
