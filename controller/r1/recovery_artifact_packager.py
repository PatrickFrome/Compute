#!/usr/bin/env python3
"""Build a deterministic LOCAL-ONLY recovery bundle for H205F22 R1.

The bundle is intentionally plaintext and MUST NOT be uploaded to external storage.
It is the canonical inner recovery payload that a later encryption step seals once,
after which the exact ciphertext can be replicated to two independent providers.

No network access, provider credentials, Supabase credentials, or DB writes exist here.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
import tarfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SHA40 = re.compile(r"^[0-9a-f]{40}$")
PROJECT_REF = re.compile(r"^[a-z0-9]{20}$")
SEMANTIC_HEAD = re.compile(r"^[A-Za-z0-9._:-]{8,240}$")

REQUIRED_INPUTS = {
    "database/schema.sql": "schema",
    "database/data.sql": "data",
    "database/roles.sql": "roles",
    "control/migration-ledger.json": "migration_ledger",
    "control/export-metadata.json": "export_metadata",
}


class BundleError(RuntimeError):
    pass


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _hash_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    total = 0
    try:
        with path.open("rb") as handle:
            while True:
                chunk = handle.read(1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
                total += len(chunk)
    except OSError as exc:
        raise BundleError(f"input_unavailable:{path}") from exc
    return digest.hexdigest(), total


def _parse_time(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise BundleError("snapshot_at_missing")
    text = value.strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError as exc:
        raise BundleError("snapshot_at_invalid") from exc
    if dt.tzinfo is None:
        raise BundleError("snapshot_at_timezone_required")
    return dt.astimezone(timezone.utc).isoformat()


def _read_json_object(path: Path, field: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise BundleError(f"{field}_invalid_json") from exc
    if not isinstance(value, dict):
        raise BundleError(f"{field}_must_be_object")
    return value


def _validate_inputs(inputs: dict[str, Path], storage_inventory: Path | None, storage_archive: Path | None) -> None:
    for archive_name in REQUIRED_INPUTS:
        path = inputs[archive_name]
        if not path.is_file():
            raise BundleError(f"required_input_missing:{archive_name}")
    if (storage_inventory is None) != (storage_archive is None):
        raise BundleError("storage_inventory_and_archive_must_be_supplied_together")
    if storage_inventory is not None:
        if not storage_inventory.is_file() or not storage_archive or not storage_archive.is_file():
            raise BundleError("storage_artifact_missing")


def _add_bytes(tar: tarfile.TarFile, name: str, content: bytes) -> None:
    info = tarfile.TarInfo(name=name)
    info.size = len(content)
    info.mtime = 0
    info.mode = 0o600
    info.uid = 0
    info.gid = 0
    info.uname = ""
    info.gname = ""
    tar.addfile(info, io.BytesIO(content))


def _add_file(tar: tarfile.TarFile, name: str, path: Path) -> None:
    try:
        size = path.stat().st_size
        handle = path.open("rb")
    except OSError as exc:
        raise BundleError(f"input_unavailable:{path}") from exc
    with handle:
        info = tarfile.TarInfo(name=name)
        info.size = size
        info.mtime = 0
        info.mode = 0o600
        info.uid = 0
        info.gid = 0
        info.uname = ""
        info.gname = ""
        tar.addfile(info, handle)


def build_bundle(
    *,
    project_ref: str,
    semantic_head: str,
    source_git_sha: str,
    snapshot_at: str,
    inputs: dict[str, Path],
    output_tar: Path,
    output_receipt: Path,
    storage_inventory: Path | None = None,
    storage_archive: Path | None = None,
) -> dict[str, Any]:
    if not PROJECT_REF.fullmatch(project_ref):
        raise BundleError("project_ref_invalid")
    if not SEMANTIC_HEAD.fullmatch(semantic_head):
        raise BundleError("semantic_head_invalid")
    if not SHA40.fullmatch(source_git_sha):
        raise BundleError("source_git_sha_invalid")
    snapshot_at_norm = _parse_time(snapshot_at)
    _validate_inputs(inputs, storage_inventory, storage_archive)

    migration_ledger = _read_json_object(inputs["control/migration-ledger.json"], "migration_ledger")
    export_metadata = _read_json_object(inputs["control/export-metadata.json"], "export_metadata")

    entries: list[dict[str, Any]] = []
    for archive_name in sorted(REQUIRED_INPUTS):
        digest, size = _hash_file(inputs[archive_name])
        entries.append({"path": archive_name, "sha256": digest, "bytes": size})

    storage_objects_included = storage_inventory is not None and storage_archive is not None
    storage_summary: dict[str, Any] = {
        "storage_api_objects_included": storage_objects_included,
        "coverage": "INCLUDED_WITH_INVENTORY_AND_ARCHIVE" if storage_objects_included else "NOT_INCLUDED",
        "warning": None if storage_objects_included else "SUPABASE_DATABASE_BACKUP_DOES_NOT_INCLUDE_STORAGE_API_OBJECT_BYTES",
    }
    if storage_objects_included:
        inventory = _read_json_object(storage_inventory, "storage_inventory")
        inventory_sha, inventory_bytes = _hash_file(storage_inventory)
        archive_sha, archive_bytes = _hash_file(storage_archive)
        entries.extend([
            {"path": "storage/storage-inventory.json", "sha256": inventory_sha, "bytes": inventory_bytes},
            {"path": "storage/storage-objects.tar", "sha256": archive_sha, "bytes": archive_bytes},
        ])
        storage_summary.update({
            "inventory_schema": inventory.get("schema"),
            "declared_object_count": inventory.get("object_count"),
        })

    manifest_core = {
        "schema": "metaengine.compute.r1-recovery-bundle-manifest.h205f22.v1",
        "classification": "SENSITIVE_RECOVERY_BUNDLE_PLAINTEXT_LOCAL_ONLY",
        "project_ref": project_ref,
        "semantic_head": semantic_head,
        "source_git_sha": source_git_sha,
        "snapshot_at": snapshot_at_norm,
        "database_export": {
            "project_owned_schema_focus": ["destruktion_meta", "supabase_migrations"],
            "public_schema_expected_empty_at_design_time": True,
            "supabase_managed_schemas_complete_claim": False,
            "physical_backup_export_claim": False,
            "export_metadata": export_metadata,
            "migration_ledger_summary": {
                "schema": migration_ledger.get("schema"),
                "row_count": migration_ledger.get("row_count"),
            },
        },
        "storage": storage_summary,
        "entries": sorted(entries, key=lambda x: x["path"]),
        "security": {
            "plaintext": True,
            "external_storage_ready": False,
            "required_next": "ENCRYPT_ONCE_TO_RECOVERY_RECIPIENTS_THEN_REPLICATE_IDENTICAL_CIPHERTEXT",
        },
        "authority": {
            "canonical": False,
            "authority_effect": False,
            "r2_proven": False,
            "r3_proven": False,
            "persisted_seal_allowed": False,
        },
    }
    manifest = dict(manifest_core)
    manifest["manifest_sha256"] = _sha256_bytes(_canonical_bytes(manifest_core))
    manifest_bytes = _canonical_bytes(manifest) + b"\n"

    output_tar.parent.mkdir(parents=True, exist_ok=True)
    try:
        with tarfile.open(output_tar, "w", format=tarfile.USTAR_FORMAT) as tar:
            _add_bytes(tar, "MANIFEST.json", manifest_bytes)
            for archive_name in sorted(REQUIRED_INPUTS):
                _add_file(tar, archive_name, inputs[archive_name])
            if storage_objects_included:
                assert storage_inventory is not None and storage_archive is not None
                _add_file(tar, "storage/storage-inventory.json", storage_inventory)
                _add_file(tar, "storage/storage-objects.tar", storage_archive)
    except (OSError, tarfile.TarError) as exc:
        raise BundleError("bundle_write_failed") from exc

    bundle_sha, bundle_bytes = _hash_file(output_tar)
    receipt_core = {
        "schema": "metaengine.compute.r1-recovery-bundle-build-receipt.h205f22.v1",
        "classification": "PLAINTEXT_BUNDLE_BUILD_RECEIPT_NONAUTHORITATIVE",
        "manifest_sha256": manifest["manifest_sha256"],
        "bundle_sha256": bundle_sha,
        "bundle_bytes": bundle_bytes,
        "storage_api_objects_included": storage_objects_included,
        "external_storage_ready": False,
        "canonical": False,
        "authority_effect": False,
        "r2_proven": False,
        "r3_proven": False,
        "persisted_seal_allowed": False,
        "required_next": "AGE_OR_EQUIVALENT_REVIEWED_ENCRYPTION_ENVELOPE",
    }
    receipt = dict(receipt_core)
    receipt["receipt_sha256"] = _sha256_bytes(_canonical_bytes(receipt_core))
    output_receipt.parent.mkdir(parents=True, exist_ok=True)
    output_receipt.write_bytes(_canonical_bytes(receipt) + b"\n")
    return receipt


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-ref", required=True)
    parser.add_argument("--semantic-head", required=True)
    parser.add_argument("--source-git-sha", required=True)
    parser.add_argument("--snapshot-at", required=True)
    parser.add_argument("--schema", required=True)
    parser.add_argument("--data", required=True)
    parser.add_argument("--roles", required=True)
    parser.add_argument("--migration-ledger", required=True)
    parser.add_argument("--export-metadata", required=True)
    parser.add_argument("--storage-inventory")
    parser.add_argument("--storage-archive")
    parser.add_argument("--output-tar", required=True)
    parser.add_argument("--output-receipt", required=True)
    args = parser.parse_args(argv)

    inputs = {
        "database/schema.sql": Path(args.schema),
        "database/data.sql": Path(args.data),
        "database/roles.sql": Path(args.roles),
        "control/migration-ledger.json": Path(args.migration_ledger),
        "control/export-metadata.json": Path(args.export_metadata),
    }
    try:
        build_bundle(
            project_ref=args.project_ref,
            semantic_head=args.semantic_head,
            source_git_sha=args.source_git_sha,
            snapshot_at=args.snapshot_at,
            inputs=inputs,
            output_tar=Path(args.output_tar),
            output_receipt=Path(args.output_receipt),
            storage_inventory=Path(args.storage_inventory) if args.storage_inventory else None,
            storage_archive=Path(args.storage_archive) if args.storage_archive else None,
        )
        return 0
    except BundleError as exc:
        print(f"R1_RECOVERY_BUNDLE_REJECTED:{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
