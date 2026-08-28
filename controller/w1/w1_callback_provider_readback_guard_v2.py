#!/usr/bin/env python3
"""Normalize authenticated inventory-first provider readback for W1 callback readiness.

v10 distinguishes a provider-authenticated absence from transport/authentication failure.
It never mutates a provider and never upgrades readiness into authority.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from controller.w1 import w1_callback_ingress_readiness_guard as readiness
from controller.w1 import w1_callback_provider_readback_guard as v1

SCHEMA = "metaengine.compute.w1-callback-provider-readback.h205f22.v2"


class ProviderInventoryReadbackError(RuntimeError):
    pass


def _object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ProviderInventoryReadbackError(f"{label}_not_object")
    return value


def _read_json(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise ProviderInventoryReadbackError(f"{label}_invalid_json") from exc


def _edge_absent(observed_at: str) -> dict[str, Any]:
    return {
        "provenance_class": readiness.PROTECTED_EDGE,
        "observed_at": observed_at,
        "present": False,
        "slug": readiness.EDGE_SLUG,
        "status": None,
        "verify_jwt": False,
        "version": None,
        "index_git_blob_sha": None,
    }


def normalize_edge_inventory(inventory_value: Any, metadata_value: Any, body_value: Any,
                             observed_at: str) -> dict[str, Any]:
    if not isinstance(observed_at, str) or not observed_at:
        raise ProviderInventoryReadbackError("edge_observed_at_invalid")
    if not isinstance(inventory_value, list):
        raise ProviderInventoryReadbackError("edge_inventory_not_array")
    if any(not isinstance(item, dict) for item in inventory_value):
        raise ProviderInventoryReadbackError("edge_inventory_item_invalid")

    matches = [item for item in inventory_value if item.get("slug") == readiness.EDGE_SLUG]
    if len(matches) > 1:
        raise ProviderInventoryReadbackError("edge_inventory_duplicate_slug")
    if not matches:
        if metadata_value is not None or body_value is not None:
            raise ProviderInventoryReadbackError("edge_absent_with_detail_payload")
        return _edge_absent(observed_at)

    inventory = matches[0]
    metadata = _object(metadata_value, "edge_metadata")
    for field in ("id", "slug", "status", "version", "verify_jwt"):
        if inventory.get(field) != metadata.get(field):
            raise ProviderInventoryReadbackError(f"edge_inventory_metadata_{field}_mismatch")

    body = _object(body_value, "edge_body")
    files = body.get("files")
    if not isinstance(files, list) or any(not isinstance(item, dict) for item in files):
        raise ProviderInventoryReadbackError("edge_body_files_invalid")
    if len(files) != 1 or files[0].get("name") != "index.ts":
        raise ProviderInventoryReadbackError("edge_body_exact_file_set_required")
    content = files[0].get("content")
    if not isinstance(content, str) or not content:
        raise ProviderInventoryReadbackError("edge_body_index_content_invalid")

    return v1.normalize_edge(metadata, content.encode("utf-8"), observed_at)


def _aws_absent_document(label: str, account_id: str) -> dict[str, Any]:
    name, _ = readiness.DOCUMENTS[label]
    return {
        "present": False,
        "name": name,
        "owner_account_id": account_id,
        "document_version": None,
        "latest_version": None,
        "default_version": None,
        "status": None,
        "hash_type": None,
        "hash": None,
        "content_git_blob_sha": None,
    }


def _inventory_identifiers(value: Any, label: str) -> list[dict[str, Any]]:
    inventory = _object(value, f"aws_{label}_inventory")
    if inventory.get("NextToken") not in (None, ""):
        raise ProviderInventoryReadbackError(f"aws_{label}_inventory_pagination_incomplete")
    identifiers = inventory.get("DocumentIdentifiers")
    if not isinstance(identifiers, list) or any(not isinstance(item, dict) for item in identifiers):
        raise ProviderInventoryReadbackError(f"aws_{label}_inventory_identifiers_invalid")
    return identifiers


def normalize_aws_inventory(value: Any, observed_at: str) -> dict[str, Any]:
    root = _object(value, "aws_raw_v2")
    if set(root) != {"account_id", "documents"}:
        raise ProviderInventoryReadbackError("aws_raw_v2_shape_invalid")
    account_id = root.get("account_id")
    if not isinstance(account_id, str) or readiness.ACCOUNT.fullmatch(account_id) is None:
        raise ProviderInventoryReadbackError("aws_account_id_invalid")
    if not isinstance(observed_at, str) or not observed_at:
        raise ProviderInventoryReadbackError("aws_observed_at_invalid")
    docs = _object(root.get("documents"), "aws_documents_v2")
    if set(docs) != set(readiness.DOCUMENTS):
        raise ProviderInventoryReadbackError("aws_documents_v2_shape_invalid")

    normalized: dict[str, Any] = {}
    for label in readiness.DOCUMENTS:
        expected_name, _ = readiness.DOCUMENTS[label]
        raw = _object(docs[label], f"aws_{label}_v2")
        if "inventory" not in raw:
            raise ProviderInventoryReadbackError(f"aws_{label}_inventory_missing")
        identifiers = _inventory_identifiers(raw["inventory"], label)
        exact = [item for item in identifiers if item.get("Name") == expected_name]
        if len(exact) > 1:
            raise ProviderInventoryReadbackError(f"aws_{label}_inventory_duplicate_exact_name")

        if not exact:
            if set(raw) != {"inventory"}:
                raise ProviderInventoryReadbackError(f"aws_{label}_absent_with_detail_payload")
            normalized[label] = _aws_absent_document(label, account_id)
            continue

        identifier = exact[0]
        if identifier.get("Owner") != account_id:
            raise ProviderInventoryReadbackError(f"aws_{label}_inventory_owner_mismatch")
        if identifier.get("DocumentType") != "Command":
            raise ProviderInventoryReadbackError(f"aws_{label}_inventory_type_mismatch")
        if str(identifier.get("DocumentVersion")) != "1":
            raise ProviderInventoryReadbackError(f"aws_{label}_inventory_version_mismatch")
        if set(raw) != {"inventory", "describe", "get", "permission"}:
            raise ProviderInventoryReadbackError(f"aws_{label}_present_shape_invalid")
        normalized[label] = v1._normalize_document(
            label, account_id, raw["describe"], raw["get"], raw["permission"]
        )

    return {
        "provenance_class": readiness.PROTECTED_AWS,
        "observed_at": observed_at,
        "account_id": account_id,
        "documents": normalized,
    }


def compose(*, git_sha: str, tree_sha: str, db_value: Any, edge_inventory: Any,
            edge_metadata: Any, edge_body: Any, edge_observed_at: str,
            aws_value: Any, aws_observed_at: str) -> dict[str, Any]:
    artifacts = v1.reviewed_artifacts()
    source = {"git_sha": git_sha, "tree_sha": tree_sha, "artifacts": artifacts}
    readiness.validate_source(source)
    db = v1.normalize_db(db_value)
    edge = normalize_edge_inventory(edge_inventory, edge_metadata, edge_body, edge_observed_at)
    aws = normalize_aws_inventory(aws_value, aws_observed_at)
    readiness_input = {
        "schema": readiness.INPUT_SCHEMA,
        "source": source,
        "db": db,
        "edge": edge,
        "aws": aws,
    }
    result = readiness.evaluate(readiness_input)
    return {
        "schema": SCHEMA,
        "collection_classification": "AUTHENTICATED_INVENTORY_READBACK_NORMALIZED_NON_AUTHORITY",
        "absence_requires_authenticated_inventory": True,
        "provider_error_treated_as_absence": False,
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
    parser.add_argument("--edge-inventory", type=Path, required=True)
    parser.add_argument("--edge-metadata", type=Path, required=True)
    parser.add_argument("--edge-body", type=Path, required=True)
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
            edge_inventory=_read_json(args.edge_inventory, "edge_inventory"),
            edge_metadata=_read_json(args.edge_metadata, "edge_metadata"),
            edge_body=_read_json(args.edge_body, "edge_body"),
            edge_observed_at=args.edge_observed_at,
            aws_value=_read_json(args.aws, "aws"),
            aws_observed_at=args.aws_observed_at,
        )
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n")
        return 0
    except (ProviderInventoryReadbackError, v1.ProviderReadbackError, readiness.ReadinessError, OSError) as exc:
        print(f"W1_CALLBACK_PROVIDER_READBACK_V2_REJECTED:{exc}", file=__import__("sys").stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
