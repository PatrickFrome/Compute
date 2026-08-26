#!/usr/bin/env python3
"""Terminal non-authority W1 candidate before the supervisor seal.

Inputs must already have passed:
- pre-persistence manifest persisted readback,
- Codespaces /workspaces storage persisted readback,
- authenticated GitHub lifecycle provenance persisted readback.

A successful composition is still NOT W1 verification. It merely proves that the
offline/persisted evidence graph is internally cross-bound and ready for a fresh
supervisor decision under current authority.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from controller.w1 import github_codespaces_lifecycle_provenance
from controller.w1 import w1_verification_candidate

SCHEMA = "metaengine.compute.w1-supervisor-verification-candidate.h205f22.v1"
STATUS = "READY_FOR_FRESH_SUPERVISOR_VERIFICATION_NONAUTHORITY"
PROVENANCE_READBACK_SCHEMA = "metaengine.compute.w1-github-codespaces-provenance-readback.h205f22.v1"
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


def compose(*, verification_candidate: dict[str, Any], provenance_receipt: dict[str, Any], provenance_readback: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(verification_candidate, dict) or verification_candidate.get("schema") != w1_verification_candidate.SCHEMA:
        raise ValueError("invalid W1 verification candidate")
    if verification_candidate.get("status") != w1_verification_candidate.STATUS:
        raise ValueError("W1 verification candidate status mismatch")
    evidence = verification_candidate.get("evidence")
    if not isinstance(evidence, dict) or not evidence:
        raise ValueError("W1 verification candidate evidence missing")
    candidate_sha = _sha(verification_candidate.get("candidate_sha256"), "candidate_sha256")
    if w1_verification_candidate.canonical_hash(evidence) != candidate_sha:
        raise ValueError("W1 verification candidate hash mismatch")
    if verification_candidate.get("ready_for_authenticated_provider_provenance") is not True:
        raise ValueError("W1 verification candidate is not ready for provider provenance")
    _false(verification_candidate, (
        "authenticated_provider_provenance_verified", "provider_action_verified",
        "provider_storage_contract_verified", "supervisor_verified", "persistent_worker_proof",
        "worker_admitted", "w1_verified", "canonical", "authority_effect",
    ), "verification candidate")

    if not isinstance(provenance_receipt, dict) or provenance_receipt.get("schema") != github_codespaces_lifecycle_provenance.SCHEMA:
        raise ValueError("invalid GitHub provenance receipt")
    if provenance_receipt.get("mode") != "EXECUTE" or provenance_receipt.get("outcome") != "CAPTURED_NONAUTHORITY":
        raise ValueError("GitHub provenance receipt outcome mismatch")
    if provenance_receipt.get("api_authentication_observed") is not True:
        raise ValueError("GitHub provenance receipt lacks authenticated API observation")
    p_evidence = provenance_receipt.get("evidence")
    if not isinstance(p_evidence, dict) or not p_evidence:
        raise ValueError("GitHub provenance evidence missing")
    provenance_sha = _sha(provenance_receipt.get("receipt_sha256"), "provenance receipt_sha256")
    if github_codespaces_lifecycle_provenance.canonical_hash(p_evidence) != provenance_sha:
        raise ValueError("GitHub provenance receipt hash mismatch")
    _false(provenance_receipt, (
        "provider_identity_verified", "provider_action_verified", "authenticated_provider_provenance_verified",
        "persisted_readback_verified", "persistent_worker_proof", "worker_admitted",
        "w1_verified", "canonical", "authority_effect",
    ), "provenance receipt")
    if p_evidence.get("api_version") != "2026-03-10" or p_evidence.get("api_base") != "https://api.github.com":
        raise ValueError("GitHub provenance API contract mismatch")
    if p_evidence.get("provider_oracle_sha256") != evidence.get("provider_oracle_sha256"):
        raise ValueError("provider oracle hash does not match verification candidate")
    if p_evidence.get("stopped_snapshot_sha256") != evidence.get("stopped_snapshot_sha256"):
        raise ValueError("stopped snapshot hash does not match verification candidate")

    if not isinstance(provenance_readback, dict) or provenance_readback.get("schema") != PROVENANCE_READBACK_SCHEMA:
        raise ValueError("invalid provenance readback")
    if provenance_readback.get("verification_status") != "PENDING_PROVIDER_PROVENANCE_READBACK":
        raise ValueError("provenance readback status mismatch")
    if provenance_readback.get("api_authentication_observed") is not True:
        raise ValueError("provenance readback lost authentication observation")
    if provenance_readback.get("persisted_readback_match") is not True:
        raise ValueError("provenance persisted readback mismatch")
    _false(provenance_readback, (
        "provider_identity_verified", "provider_action_verified", "authenticated_provider_provenance_verified",
        "persisted_readback_verified", "provider_storage_contract_verified", "persistent_worker_proof",
        "worker_admitted", "w1_verified", "canonical", "authority_effect",
    ), "provenance readback")
    if _sha(provenance_readback.get("receipt_sha256"), "provenance readback receipt_sha256") != provenance_sha:
        raise ValueError("provenance readback receipt hash mismatch")
    if _sha(provenance_readback.get("recomputed_receipt_sha256"), "provenance recomputed receipt_sha256") != provenance_sha:
        raise ValueError("provenance recomputed receipt hash mismatch")
    if _sha(provenance_readback.get("recomputed_provider_oracle_sha256"), "provenance recomputed provider oracle") != evidence.get("provider_oracle_sha256"):
        raise ValueError("provenance readback provider oracle mismatch")
    for key in ("pre_persistence_manifest_id", "lifecycle_receipt_id"):
        if provenance_readback.get(key) != evidence.get(key):
            raise ValueError(f"provenance readback {key} mismatch")
    if provenance_readback.get("worker_id") != evidence.get("worker_id"):
        raise ValueError("provenance readback worker_id mismatch")
    if provenance_readback.get("base_checkpoint_id") != evidence.get("base_checkpoint_id"):
        raise ValueError("provenance readback base checkpoint mismatch")
    _uuid(provenance_readback.get("provenance_receipt_id"), "provenance_receipt_id")
    _uuid(provenance_readback.get("storage_receipt_id"), "storage_receipt_id")

    final_evidence = {
        "pre_persistence_manifest_id": evidence["pre_persistence_manifest_id"],
        "lifecycle_receipt_id": evidence["lifecycle_receipt_id"],
        "provenance_receipt_id": provenance_readback["provenance_receipt_id"],
        "storage_receipt_id": provenance_readback["storage_receipt_id"],
        "worker_id": evidence["worker_id"],
        "base_checkpoint_id": evidence["base_checkpoint_id"],
        "verification_candidate_sha256": candidate_sha,
        "provider_provenance_receipt_sha256": provenance_sha,
        "provider_oracle_sha256": evidence["provider_oracle_sha256"],
        "stopped_snapshot_sha256": evidence["stopped_snapshot_sha256"],
        "manifest_sha256": evidence["manifest_sha256"],
        "storage_receipt_sha256": evidence["storage_receipt_sha256"],
        "source": evidence["source"],
        "checks": {
            "offline_candidate_integrity": True,
            "provider_provenance_receipt_integrity": True,
            "provider_provenance_persisted_readback_match": True,
            "provider_oracle_cross_bound": True,
            "raw_shutdown_snapshot_cross_bound": True,
            "worker_identity_cross_bound": True,
            "semantic_checkpoint_cross_bound": True,
        },
    }
    return {
        "schema": SCHEMA,
        "status": STATUS,
        "evidence": final_evidence,
        "candidate_sha256": canonical_hash(final_evidence),
        "ready_for_fresh_supervisor_verification": True,
        "authenticated_provider_provenance_verified": False,
        "provider_action_verified": False,
        "provider_storage_contract_verified": False,
        "supervisor_verified": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
        "next_required": ["fresh_supervisor_w1_verification_under_current_authority"],
    }
