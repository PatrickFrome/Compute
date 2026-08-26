#!/usr/bin/env python3
"""Fail-closed W1 verification-candidate oracle.

This is the last offline composition layer before authenticated GitHub provider
provenance and supervisor verification. It cross-binds the local pre-persistence
manifest, its persisted Supabase readback, the Codespaces /workspaces storage
receipt, and its persisted readback.

Even when every input matches, the strongest result is
WAITING_AUTHENTICATED_PROVIDER_PROVENANCE. This module cannot admit a worker or
assert W1_VERIFIED.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from controller.w1 import codespaces_persistent_storage_guard
from controller.w1 import pre_persistence_evidence_manifest

SCHEMA = "metaengine.compute.w1-verification-candidate.h205f22.v1"
STATUS = "WAITING_AUTHENTICATED_PROVIDER_PROVENANCE"
MANIFEST_READBACK_SCHEMA = "metaengine.compute.w1-pre-persistence-readback.h205f22.v1"
STORAGE_READBACK_SCHEMA = "metaengine.compute.w1-codespaces-storage-readback.h205f22.v1"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _sha(value: Any, label: str) -> str:
    if not isinstance(value, str) or not SHA256_RE.fullmatch(value):
        raise ValueError(f"invalid {label}")
    return value


def _uuid(value: Any, label: str) -> str:
    if not isinstance(value, str) or not UUID_RE.fullmatch(value):
        raise ValueError(f"invalid {label}")
    return value


def _false(value: dict[str, Any], keys: tuple[str, ...], label: str) -> None:
    for key in keys:
        if value.get(key) is not False:
            raise ValueError(f"{label}.{key} must be false")


def _manifest(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema") != pre_persistence_evidence_manifest.SCHEMA:
        raise ValueError("invalid pre-persistence manifest")
    if value.get("status") != pre_persistence_evidence_manifest.STATUS:
        raise ValueError("pre-persistence manifest status mismatch")
    bindings = value.get("bindings")
    if not isinstance(bindings, dict) or not bindings:
        raise ValueError("pre-persistence manifest bindings missing")
    manifest_sha = _sha(value.get("manifest_sha256"), "manifest_sha256")
    if pre_persistence_evidence_manifest.canonical_hash(bindings) != manifest_sha:
        raise ValueError("pre-persistence manifest hash mismatch")
    _false(value, (
        "authenticated_provenance_verified", "persisted_readback_verified",
        "persistent_worker_proof", "worker_admitted", "w1_verified", "canonical", "authority_effect",
    ), "manifest")
    source = bindings.get("source")
    if not isinstance(source, dict) or set(source) != {"git_sha", "tree_sha"}:
        raise ValueError("manifest source missing")
    return value


def _manifest_readback(value: Any, manifest: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema") != MANIFEST_READBACK_SCHEMA:
        raise ValueError("invalid manifest readback")
    if value.get("verification_status") != "PENDING_PERSISTED_READBACK":
        raise ValueError("manifest readback status mismatch")
    if value.get("persisted_readback_match") is not True:
        raise ValueError("manifest persisted readback mismatch")
    _false(value, (
        "authenticated_provenance_verified", "persisted_readback_verified",
        "persistent_worker_proof", "worker_admitted", "w1_verified", "canonical", "authority_effect",
    ), "manifest readback")
    manifest_sha = manifest["manifest_sha256"]
    for key in ("manifest_sha256", "recomputed_manifest_sha256"):
        if _sha(value.get(key), f"manifest readback {key}") != manifest_sha:
            raise ValueError(f"manifest readback {key} mismatch")
    _sha(value.get("recomputed_lifecycle_bundle_sha256"), "manifest lifecycle bundle hash")
    _sha(value.get("recomputed_outer_cgroup_witness_sha256"), "manifest outer witness hash")
    _uuid(value.get("pre_persistence_manifest_id"), "pre_persistence_manifest_id")
    _uuid(value.get("lifecycle_receipt_id"), "manifest lifecycle_receipt_id")
    return value


def _storage(value: Any, manifest: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema") != codespaces_persistent_storage_guard.RECEIPT_SCHEMA:
        raise ValueError("invalid Codespaces storage receipt")
    if value.get("outcome") != "CODESPACES_PERSISTENT_STORAGE_BOUND_NONAUTHORITY":
        raise ValueError("Codespaces storage receipt outcome mismatch")
    evidence = value.get("evidence")
    if not isinstance(evidence, dict) or not evidence:
        raise ValueError("Codespaces storage evidence missing")
    receipt_sha = _sha(value.get("receipt_sha256"), "storage receipt_sha256")
    if codespaces_persistent_storage_guard.canonical_hash(evidence) != receipt_sha:
        raise ValueError("Codespaces storage receipt hash mismatch")
    _false(value, (
        "provider_storage_contract_verified", "persisted_readback_verified",
        "persistent_worker_proof", "worker_admitted", "w1_verified", "canonical", "authority_effect",
    ), "storage receipt")
    if evidence.get("persistent_root") != "/workspaces":
        raise ValueError("storage persistent root mismatch")
    if evidence.get("sentinel_path") != "/workspaces/.metaengine-w1/persistent-sentinel.bin":
        raise ValueError("storage sentinel path mismatch")
    if evidence.get("source") != manifest["bindings"].get("source"):
        raise ValueError("storage source does not match manifest source")
    return value


def compose(
    *,
    pre_persistence_manifest: dict[str, Any],
    manifest_readback: dict[str, Any],
    storage_receipt: dict[str, Any],
    storage_readback: dict[str, Any],
    lifecycle_bundle: dict[str, Any],
) -> dict[str, Any]:
    manifest = _manifest(pre_persistence_manifest)
    mrb = _manifest_readback(manifest_readback, manifest)
    storage = _storage(storage_receipt, manifest)

    if not isinstance(lifecycle_bundle, dict) or lifecycle_bundle.get("schema") != "metaengine.compute.w1-lifecycle-evidence-harness.h205f22.v1":
        raise ValueError("invalid lifecycle bundle")
    if lifecycle_bundle.get("outcome") != "W1_LIFECYCLE_EVIDENCE_COMPOSED_NONAUTHORITY":
        raise ValueError("lifecycle bundle outcome mismatch")
    lifecycle_bundle_sha = pre_persistence_evidence_manifest.canonical_hash(lifecycle_bundle)
    if lifecycle_bundle_sha != mrb["recomputed_lifecycle_bundle_sha256"]:
        raise ValueError("lifecycle bundle does not match persisted manifest readback")
    life_evidence = lifecycle_bundle.get("evidence") or {}
    provider = life_evidence.get("provider") or {}
    lifecycle = life_evidence.get("lifecycle") or {}
    storage_evidence = storage["evidence"]
    if storage_evidence.get("provider_oracle_sha256") != provider.get("oracle_sha256"):
        raise ValueError("storage/provider oracle hash mismatch")
    if storage_evidence.get("stopped_snapshot_sha256") != ((provider.get("evidence") or {}).get("stopped_snapshot_sha256")):
        raise ValueError("storage stopped snapshot hash mismatch")
    life = lifecycle.get("evidence") or {}
    for field in ("pre_boot_id", "post_boot_id", "sentinel_sha256"):
        if storage_evidence.get(field) != life.get(field):
            raise ValueError(f"storage/lifecycle {field} mismatch")

    if not isinstance(storage_readback, dict) or storage_readback.get("schema") != STORAGE_READBACK_SCHEMA:
        raise ValueError("invalid storage readback")
    if storage_readback.get("verification_status") != "PENDING_STORAGE_PROVENANCE_READBACK":
        raise ValueError("storage readback status mismatch")
    if storage_readback.get("persisted_readback_match") is not True:
        raise ValueError("storage persisted readback mismatch")
    _false(storage_readback, (
        "provider_storage_contract_verified", "authenticated_github_provenance_verified",
        "persisted_readback_verified", "persistent_worker_proof", "worker_admitted",
        "w1_verified", "canonical", "authority_effect",
    ), "storage readback")
    storage_sha = storage["receipt_sha256"]
    if _sha(storage_readback.get("receipt_sha256"), "storage readback receipt_sha256") != storage_sha:
        raise ValueError("storage readback receipt hash mismatch")
    if _sha(storage_readback.get("recomputed_receipt_sha256"), "storage recomputed receipt_sha256") != storage_sha:
        raise ValueError("storage recomputed receipt hash mismatch")
    if storage_readback.get("pre_persistence_manifest_id") != mrb["pre_persistence_manifest_id"]:
        raise ValueError("storage readback manifest id mismatch")
    if storage_readback.get("lifecycle_receipt_id") != mrb["lifecycle_receipt_id"]:
        raise ValueError("storage readback lifecycle id mismatch")

    evidence = {
        "pre_persistence_manifest_id": mrb["pre_persistence_manifest_id"],
        "lifecycle_receipt_id": mrb["lifecycle_receipt_id"],
        "worker_id": mrb["worker_id"],
        "base_checkpoint_id": mrb["base_checkpoint_id"],
        "manifest_sha256": manifest["manifest_sha256"],
        "storage_receipt_sha256": storage_sha,
        "lifecycle_bundle_sha256": lifecycle_bundle_sha,
        "provider_oracle_sha256": storage_evidence["provider_oracle_sha256"],
        "stopped_snapshot_sha256": storage_evidence["stopped_snapshot_sha256"],
        "persistent_root": storage_evidence["persistent_root"],
        "sentinel_path_sha256": storage_evidence["sentinel_path_sha256"],
        "source": manifest["bindings"]["source"],
        "checks": {
            "manifest_persisted_readback_match": True,
            "storage_persisted_readback_match": True,
            "manifest_storage_identity_cross_bound": True,
            "source_identity_cross_bound": True,
            "provider_oracle_cross_bound": True,
            "raw_shutdown_snapshot_cross_bound": True,
            "boot_ids_cross_bound": True,
            "persistent_sentinel_cross_bound": True,
            "codespaces_persistent_root_bound": True,
        },
    }
    return {
        "schema": SCHEMA,
        "status": STATUS,
        "evidence": evidence,
        "candidate_sha256": canonical_hash(evidence),
        "ready_for_authenticated_provider_provenance": True,
        "authenticated_provider_provenance_verified": False,
        "provider_action_verified": False,
        "provider_storage_contract_verified": False,
        "supervisor_verified": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
        "next_required": [
            "authenticated_github_pre_shutdown_post_snapshot_provenance",
            "authenticated_github_stop_action_receipt",
            "authenticated_github_start_action_receipt",
            "persisted_provider_provenance_readback",
            "fresh_supervisor_w1_verification",
        ],
    }
