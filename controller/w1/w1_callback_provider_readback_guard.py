#!/usr/bin/env python3
"""Normalize protected provider readback into the W1 callback readiness guard.

This module is pure/offline. It validates raw readback files produced by a protected
read-only workflow, compares provider content with reviewed repository sources, and
then invokes the non-authority readiness guard. It cannot authenticate provenance by
itself and cannot mutate any provider.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from controller.w1 import w1_callback_ingress_readiness_guard as readiness

SCHEMA = "metaengine.compute.w1-callback-provider-readback.h205f22.v1"
ROOT = Path(__file__).resolve().parents[2]
EDGE_SOURCE = ROOT / "supabase/functions/w1-execution-callback/index.ts"
DOCUMENT_SOURCE = {
    "key_enrollment": ROOT / "infra/w1/ssm/Metaengine-W1-Callback-Key-Enroll-H205F22.json",
    "execution_marker": ROOT / "infra/w1/ssm/Metaengine-W1-Execution-Marker-H205F22.json",
}


class ProviderReadbackError(RuntimeError):
    pass


def _object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ProviderReadbackError(f"{label}_not_object")
    return value


def _read_json(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise ProviderReadbackError(f"{label}_invalid_json") from exc


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _git_blob_sha(data: bytes) -> str:
    header = f"blob {len(data)}\0".encode()
    return hashlib.sha1(header + data).hexdigest()


def reviewed_artifacts() -> dict[str, str]:
    mapping = {
        "prep_sql": ROOT / "supabase/prep/w1_callback_auth_v1.sql",
        "edge_index": EDGE_SOURCE,
        "config": ROOT / "supabase/config.toml",
        "key_document": DOCUMENT_SOURCE["key_enrollment"],
        "execution_document": DOCUMENT_SOURCE["execution_marker"],
    }
    result = {name: _git_blob_sha(path.read_bytes()) for name, path in mapping.items()}
    if result != readiness.SOURCE_BLOBS:
        raise ProviderReadbackError("reviewed_source_identity_drift")
    return result


def normalize_db(value: Any) -> dict[str, Any]:
    db = _object(value, "db")
    if db.get("provenance_class") != readiness.PROTECTED_DB:
        raise ProviderReadbackError("db_provenance_class_invalid")
    # Let the readiness guard own exact DB shape/privilege semantics.
    readiness.validate_db(db)
    return db


def normalize_edge(metadata_value: Any, downloaded_source: bytes, observed_at: str) -> dict[str, Any]:
    meta = _object(metadata_value, "edge_metadata")
    if not isinstance(observed_at, str) or not observed_at:
        raise ProviderReadbackError("edge_observed_at_invalid")
    if meta.get("slug") != readiness.EDGE_SLUG:
        raise ProviderReadbackError("edge_slug_mismatch")
    if meta.get("status") != "ACTIVE":
        raise ProviderReadbackError("edge_not_active")
    if meta.get("verify_jwt") is not False:
        raise ProviderReadbackError("edge_verify_jwt_mismatch")
    version = meta.get("version")
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        raise ProviderReadbackError("edge_version_invalid")
    if not downloaded_source:
        raise ProviderReadbackError("edge_source_empty")
    local = EDGE_SOURCE.read_bytes()
    if downloaded_source != local:
        raise ProviderReadbackError("edge_source_bytes_mismatch")
    blob = _git_blob_sha(downloaded_source)
    if blob != readiness.SOURCE_BLOBS["edge_index"]:
        raise ProviderReadbackError("edge_source_blob_mismatch")
    return {
        "provenance_class": readiness.PROTECTED_EDGE,
        "observed_at": observed_at,
        "present": True,
        "slug": meta["slug"],
        "status": meta["status"],
        "verify_jwt": meta["verify_jwt"],
        "version": version,
        "index_git_blob_sha": blob,
    }


def _doc_description(value: Any, label: str) -> dict[str, Any]:
    root = _object(value, label)
    doc = root.get("Document") if isinstance(root.get("Document"), dict) else root.get("DocumentDescription")
    if not isinstance(doc, dict):
        raise ProviderReadbackError(f"{label}_document_missing")
    return doc


def _normalize_document(label: str, account_id: str, describe_value: Any, get_value: Any,
                        permission_value: Any) -> dict[str, Any]:
    expected_name, expected_blob = readiness.DOCUMENTS[label]
    desc = _doc_description(describe_value, f"aws_{label}_describe")
    if desc.get("Name") != expected_name:
        raise ProviderReadbackError(f"aws_{label}_name_mismatch")
    if desc.get("Owner") != account_id:
        raise ProviderReadbackError(f"aws_{label}_owner_mismatch")
    for field in ("DocumentVersion", "LatestVersion", "DefaultVersion"):
        if str(desc.get(field)) != "1":
            raise ProviderReadbackError(f"aws_{label}_{field}_mismatch")
    if desc.get("Status") != "Active":
        raise ProviderReadbackError(f"aws_{label}_not_active")
    hash_value = desc.get("Hash")
    if desc.get("HashType") != "Sha256" or not isinstance(hash_value, str) or readiness.HEX64.fullmatch(hash_value) is None:
        raise ProviderReadbackError(f"aws_{label}_hash_invalid")

    got = _object(get_value, f"aws_{label}_get")
    if got.get("Name") != expected_name or str(got.get("DocumentVersion")) != "1":
        raise ProviderReadbackError(f"aws_{label}_get_identity_mismatch")
    if got.get("DocumentType") != "Command" or got.get("Status") != "Active":
        raise ProviderReadbackError(f"aws_{label}_get_state_mismatch")
    content = got.get("Content")
    if not isinstance(content, str):
        raise ProviderReadbackError(f"aws_{label}_content_missing")
    try:
        remote = json.loads(content)
        local = json.loads(DOCUMENT_SOURCE[label].read_text())
    except json.JSONDecodeError as exc:
        raise ProviderReadbackError(f"aws_{label}_content_invalid_json") from exc
    if _canonical(remote) != _canonical(local):
        raise ProviderReadbackError(f"aws_{label}_content_mismatch")
    local_blob = _git_blob_sha(DOCUMENT_SOURCE[label].read_bytes())
    if local_blob != expected_blob:
        raise ProviderReadbackError(f"aws_{label}_reviewed_blob_drift")

    permission = _object(permission_value, f"aws_{label}_permission")
    account_ids = permission.get("AccountIds")
    sharing = permission.get("AccountSharingInfoList")
    if not isinstance(account_ids, list) or any(not isinstance(x, str) for x in account_ids):
        raise ProviderReadbackError(f"aws_{label}_permission_accounts_invalid")
    if not isinstance(sharing, list) or any(not isinstance(x, dict) for x in sharing):
        raise ProviderReadbackError(f"aws_{label}_permission_sharing_invalid")
    if account_ids or sharing:
        raise ProviderReadbackError(f"aws_{label}_document_shared")
    if permission.get("NextToken") not in (None, ""):
        raise ProviderReadbackError(f"aws_{label}_permission_pagination_forbidden")

    return {
        "present": True,
        "name": expected_name,
        "owner_account_id": account_id,
        "document_version": "1",
        "latest_version": "1",
        "default_version": "1",
        "status": "Active",
        "hash_type": "Sha256",
        "hash": hash_value,
        "content_git_blob_sha": expected_blob,
    }


def normalize_aws(value: Any, observed_at: str) -> dict[str, Any]:
    root = _object(value, "aws_raw")
    if set(root) != {"account_id", "documents"}:
        raise ProviderReadbackError("aws_raw_shape_invalid")
    account_id = root.get("account_id")
    if not isinstance(account_id, str) or readiness.ACCOUNT.fullmatch(account_id) is None:
        raise ProviderReadbackError("aws_account_id_invalid")
    if not isinstance(observed_at, str) or not observed_at:
        raise ProviderReadbackError("aws_observed_at_invalid")
    docs = _object(root.get("documents"), "aws_documents")
    if set(docs) != set(readiness.DOCUMENTS):
        raise ProviderReadbackError("aws_documents_shape_invalid")
    normalized = {}
    for label, raw in docs.items():
        raw_obj = _object(raw, f"aws_{label}")
        if set(raw_obj) != {"describe", "get", "permission"}:
            raise ProviderReadbackError(f"aws_{label}_shape_invalid")
        normalized[label] = _normalize_document(label, account_id, raw_obj["describe"], raw_obj["get"], raw_obj["permission"])
    return {
        "provenance_class": readiness.PROTECTED_AWS,
        "observed_at": observed_at,
        "account_id": account_id,
        "documents": normalized,
    }


def compose(*, git_sha: str, tree_sha: str, db_value: Any, edge_metadata: Any,
            edge_source: bytes, edge_observed_at: str, aws_value: Any,
            aws_observed_at: str) -> dict[str, Any]:
    artifacts = reviewed_artifacts()
    source = {"git_sha": git_sha, "tree_sha": tree_sha, "artifacts": artifacts}
    readiness.validate_source(source)
    db = normalize_db(db_value)
    edge = normalize_edge(edge_metadata, edge_source, edge_observed_at)
    aws = normalize_aws(aws_value, aws_observed_at)
    readiness_input = {"schema": readiness.INPUT_SCHEMA, "source": source, "db": db, "edge": edge, "aws": aws}
    result = readiness.evaluate(readiness_input)
    return {
        "schema": SCHEMA,
        "collection_classification": "PROTECTED_READBACK_NORMALIZED_NON_AUTHORITY",
        "readiness": result,
        "raw_provider_secrets_persisted": False,
        "database_mutation_authorized": False,
        "edge_deployment_authorized": False,
        "aws_mutation_authorized": False,
        "send_command_authorized": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--git-sha", required=True)
    parser.add_argument("--tree-sha", required=True)
    parser.add_argument("--db", type=Path, required=True)
    parser.add_argument("--edge-metadata", type=Path, required=True)
    parser.add_argument("--edge-source", type=Path, required=True)
    parser.add_argument("--edge-observed-at", required=True)
    parser.add_argument("--aws", type=Path, required=True)
    parser.add_argument("--aws-observed-at", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = compose(
            git_sha=args.git_sha,
            tree_sha=args.tree_sha,
            db_value=_read_json(args.db, "db"),
            edge_metadata=_read_json(args.edge_metadata, "edge_metadata"),
            edge_source=args.edge_source.read_bytes(),
            edge_observed_at=args.edge_observed_at,
            aws_value=_read_json(args.aws, "aws"),
            aws_observed_at=args.aws_observed_at,
        )
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n")
        return 0
    except (ProviderReadbackError, readiness.ReadinessError, OSError) as exc:
        print(f"W1_CALLBACK_PROVIDER_READBACK_REJECTED:{exc}", file=__import__("sys").stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
