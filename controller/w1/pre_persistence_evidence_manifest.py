#!/usr/bin/env python3
"""Fail-closed W1 pre-persistence evidence manifest composer.

This module binds the already-composed provider lifecycle evidence to an
ELIGIBLE_NONAUTHORITY privileged outer-cgroup witness. It does not authenticate
GitHub/provider provenance and does not persist anything to Supabase; therefore
its strongest possible result remains PRE_PERSISTENCE_ELIGIBLE_NONAUTHORITY.

The manifest is intended to be the single hash-bound object handed to the later
persisted-readback transaction after a fresh aligned W1 claim/directive exists.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from controller.w1 import github_codespaces_snapshot_guard
from controller.w1 import provider_neutral_lifecycle_guard
from controller.w1 import s2_runtime_canary_receipt
from worker.native_linux import h1_h13_prereq_probe
from worker.native_linux import outer_privileged_cgroup_witness
from worker.native_linux import w1_lifecycle_evidence_harness

SCHEMA = "metaengine.compute.w1-pre-persistence-evidence-manifest.h205f22.v1"
STATUS = "PRE_PERSISTENCE_ELIGIBLE_NONAUTHORITY"
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
IMAGE_ID_RE = re.compile(r"^sha256:[0-9a-f]{64}$")

LIFECYCLE_TOP_KEYS = {
    "schema", "outcome", "evidence", "evidence_sha256",
    "provider_identity_verified", "provider_action_verified", "s2_runtime_verified",
    "outer_cgroup_witness_verified", "persisted_readback_verified",
    "persistent_worker_proof", "worker_admitted", "w1_verified", "canonical",
    "authority_effect", "next_required",
}
LIFECYCLE_EVIDENCE_KEYS = {
    "source", "s2_runtime", "provider", "lifecycle", "local_checks", "post_h1_h13",
}
LOCAL_CHECK_KEYS = {
    "source_identity_stable", "machine_identity_stable", "kernel_boot_id_changed",
    "persistent_sentinel_stable", "s2_runtime_receipt_pass",
    "post_h1_h13_prerequisites_pass",
}
OUTER_TOP_KEYS = {
    "schema", "mode", "outcome", "image_id", "container_id_sha256",
    "outer_namespaces", "inner", "inner_checks", "two_plane_checks",
    "security_requests_verified", "prebound_before_sudo", "sudo",
    "privilege_scope", "sudo_before_exact_binding", "worker_launch_via_sudo",
    "worker_exec_via_sudo", "cgroup", "canonical", "authority_effect",
    "worker_admitted", "w1_verified", "requires_persisted_two_plane_composition",
}
CGROUP_KEYS = {
    "path", "path_sha256", "exact_target_valid", "target_error", "limits",
    "limit_checks", "pre_events", "pre_process_count", "pre_process_ids_sha256",
    "sudo_kill_write", "post_events", "post_unpopulated", "pre_processes_gone",
    "docker_running_after", "tree_kill_proven",
}
NONCLAIM_KEYS = {
    "canonical", "authority_effect", "persistent_worker_proof", "worker_admitted", "w1_verified",
}


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _exact_object(value: Any, keys: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    diff = set(value) ^ keys
    if diff:
        raise ValueError(f"{label} keys mismatch: {sorted(diff)}")
    return value


def _all_true(value: Any, label: str) -> dict[str, bool]:
    if not isinstance(value, dict) or not value:
        raise ValueError(f"{label} must be a nonempty object")
    if any(v is not True for v in value.values()):
        raise ValueError(f"{label} must all be true")
    return value


def _sha256(value: Any, label: str) -> str:
    if not isinstance(value, str) or not SHA256_RE.fullmatch(value):
        raise ValueError(f"invalid {label}")
    return value


def _validate_lifecycle(bundle: Any) -> dict[str, Any]:
    root = _exact_object(bundle, LIFECYCLE_TOP_KEYS, "lifecycle bundle")
    if root["schema"] != w1_lifecycle_evidence_harness.COMPOSE_SCHEMA:
        raise ValueError("unsupported lifecycle bundle schema")
    if root["outcome"] != "W1_LIFECYCLE_EVIDENCE_COMPOSED_NONAUTHORITY":
        raise ValueError("lifecycle bundle is not composed-eligible")
    for key in (
        "provider_identity_verified", "provider_action_verified", "s2_runtime_verified",
        "outer_cgroup_witness_verified", "persisted_readback_verified",
        "persistent_worker_proof", "worker_admitted", "w1_verified", "canonical", "authority_effect",
    ):
        if root[key] is not False:
            raise ValueError(f"lifecycle bundle {key} must be false")

    evidence = _exact_object(root["evidence"], LIFECYCLE_EVIDENCE_KEYS, "lifecycle evidence")
    evidence_sha = _sha256(root["evidence_sha256"], "lifecycle evidence_sha256")
    if evidence_sha != provider_neutral_lifecycle_guard.canonical_hash(evidence):
        raise ValueError("lifecycle evidence hash mismatch")

    source = _exact_object(evidence["source"], {"git_sha", "tree_sha"}, "lifecycle source")
    for key, value in source.items():
        if not isinstance(value, str) or not SHA40_RE.fullmatch(value):
            raise ValueError(f"invalid lifecycle source.{key}")

    s2 = s2_runtime_canary_receipt.validate(
        evidence["s2_runtime"],
        require_pass=True,
        expected_source_sha256=w1_lifecycle_evidence_harness.EXPECTED_S2_SOURCE_SHA256,
    )
    local_checks = _exact_object(evidence["local_checks"], LOCAL_CHECK_KEYS, "lifecycle local_checks")
    _all_true(local_checks, "lifecycle local_checks")

    provider = evidence["provider"]
    if not isinstance(provider, dict) or provider.get("schema") != github_codespaces_snapshot_guard.OUTPUT_SCHEMA:
        raise ValueError("invalid Codespaces provider evidence")
    if provider.get("outcome") != "CODESPACES_SNAPSHOTS_STRUCTURALLY_ELIGIBLE_NONAUTHORITY":
        raise ValueError("Codespaces provider evidence not eligible")
    for key in ("provider_identity_verified", "provider_action_verified", "persisted_readback_verified", "persistent_worker_proof", "worker_admitted", "w1_verified", "canonical", "authority_effect"):
        if provider.get(key) is not False:
            raise ValueError(f"Codespaces provider {key} must be false")

    lifecycle = evidence["lifecycle"]
    if not isinstance(lifecycle, dict) or lifecycle.get("schema") != provider_neutral_lifecycle_guard.OUTPUT_SCHEMA:
        raise ValueError("invalid provider-neutral lifecycle evidence")
    if lifecycle.get("outcome") != "LIFECYCLE_EVIDENCE_STRUCTURALLY_ELIGIBLE_NONAUTHORITY":
        raise ValueError("provider-neutral lifecycle evidence not eligible")
    lifecycle_checks = ((lifecycle.get("evidence") or {}).get("checks"))
    _all_true(lifecycle_checks, "provider-neutral lifecycle checks")

    h1 = evidence["post_h1_h13"]
    if not isinstance(h1, dict) or h1.get("schema") != h1_h13_prereq_probe.SCHEMA:
        raise ValueError("invalid post H1-H13 evidence")
    if h1.get("ready_for_production_evidence") is not True:
        raise ValueError("post H1-H13 evidence not ready")
    _all_true(h1.get("checks"), "post H1-H13 checks")
    for key in ("canonical", "authority_effect", "worker_admitted", "w1_verified"):
        if h1.get(key) is not False:
            raise ValueError(f"post H1-H13 {key} must be false")

    return root


def _validate_outer_witness(value: Any) -> dict[str, Any]:
    root = _exact_object(value, OUTER_TOP_KEYS, "outer cgroup witness")
    if root["schema"] != outer_privileged_cgroup_witness.SCHEMA:
        raise ValueError("unsupported outer cgroup witness schema")
    if root["mode"] != "EXECUTE" or root["outcome"] != "ELIGIBLE_NONAUTHORITY":
        raise ValueError("outer cgroup witness must be EXECUTE/ELIGIBLE_NONAUTHORITY")
    if not isinstance(root["image_id"], str) or not IMAGE_ID_RE.fullmatch(root["image_id"]):
        raise ValueError("invalid outer witness image_id")
    _sha256(root["container_id_sha256"], "outer container_id_sha256")
    for key in ("canonical", "authority_effect", "worker_admitted", "w1_verified"):
        if root[key] is not False:
            raise ValueError(f"outer witness {key} must be false")
    if root["requires_persisted_two_plane_composition"] is not True:
        raise ValueError("outer witness must require persisted composition")
    if root["prebound_before_sudo"] is not True:
        raise ValueError("outer witness target was not prebound before sudo")
    if root["privilege_scope"] != "PREBOUND_EXACT_CGROUP_KILL_WRITE_ONLY":
        raise ValueError("outer witness privilege scope mismatch")
    for key in ("sudo_before_exact_binding", "worker_launch_via_sudo", "worker_exec_via_sudo"):
        if root[key] is not False:
            raise ValueError(f"outer witness {key} must be false")

    _all_true(root["inner_checks"], "outer inner_checks")
    _all_true(root["two_plane_checks"], "outer two_plane_checks")
    _all_true(root["security_requests_verified"], "outer security checks")
    namespaces = _exact_object(root["outer_namespaces"], {"pid_ns", "mnt_ns", "net_ns"}, "outer namespaces")
    if any(not isinstance(v, int) or isinstance(v, bool) or v <= 0 for v in namespaces.values()):
        raise ValueError("outer namespace inode values must be positive integers")

    sudo = _exact_object(root["sudo"], {"available", "uid", "stderr_sha256"}, "outer sudo")
    if sudo["available"] is not True or sudo["uid"] != "0":
        raise ValueError("outer sudo root principal not proven")
    if sudo["stderr_sha256"] is not None:
        _sha256(sudo["stderr_sha256"], "outer sudo stderr_sha256")

    cgroup = _exact_object(root["cgroup"], CGROUP_KEYS, "outer cgroup")
    if not isinstance(cgroup["path"], str) or not cgroup["path"]:
        raise ValueError("outer cgroup path required")
    path_sha = _sha256(cgroup["path_sha256"], "outer cgroup path_sha256")
    if path_sha != _sha256_text(cgroup["path"]):
        raise ValueError("outer cgroup path hash mismatch")
    _sha256(cgroup["pre_process_ids_sha256"], "outer pre_process_ids_sha256")
    if cgroup["exact_target_valid"] is not True or cgroup["target_error"] is not None:
        raise ValueError("outer exact cgroup target invalid")
    _all_true(cgroup["limit_checks"], "outer cgroup limit_checks")
    if not isinstance(cgroup["pre_process_count"], int) or isinstance(cgroup["pre_process_count"], bool) or cgroup["pre_process_count"] < 2:
        raise ValueError("outer witness needs at least two pre-kill processes")
    kill = _exact_object(cgroup["sudo_kill_write"], {"returncode", "stdout", "stderr_sha256", "succeeded"}, "outer sudo_kill_write")
    if kill["returncode"] != 0 or kill["succeeded"] is not True or kill["stdout"] != "1":
        raise ValueError("outer cgroup.kill write not proven")
    if kill["stderr_sha256"] is not None:
        _sha256(kill["stderr_sha256"], "outer kill stderr_sha256")
    if cgroup["post_unpopulated"] is not True or cgroup["pre_processes_gone"] is not True:
        raise ValueError("outer cgroup tree did not quiesce")
    if cgroup["docker_running_after"] is not False or cgroup["tree_kill_proven"] is not True:
        raise ValueError("outer tree kill not proven")
    return root


def compose(*, lifecycle_bundle: dict[str, Any], outer_cgroup_witness: dict[str, Any]) -> dict[str, Any]:
    lifecycle = _validate_lifecycle(lifecycle_bundle)
    outer = _validate_outer_witness(outer_cgroup_witness)
    evidence = lifecycle["evidence"]
    s2 = evidence["s2_runtime"]
    h1 = evidence["post_h1_h13"]
    bindings = {
        "source": evidence["source"],
        "s2_source_sha256": s2["evidence"]["source_sha256"],
        "s2_receipt_sha256": s2["receipt_sha256"],
        "lifecycle_evidence_sha256": lifecycle["evidence_sha256"],
        "lifecycle_bundle_sha256": canonical_hash(lifecycle),
        "post_h1_h13_sha256": canonical_hash(h1),
        "outer_cgroup_witness_sha256": canonical_hash(outer),
        "outer_image_id": outer["image_id"],
        "outer_container_id_sha256": outer["container_id_sha256"],
        "outer_cgroup_path_sha256": outer["cgroup"]["path_sha256"],
    }
    manifest_sha = canonical_hash(bindings)
    return {
        "schema": SCHEMA,
        "status": STATUS,
        "bindings": bindings,
        "manifest_sha256": manifest_sha,
        "causal_chain": [
            "EXACT_S2_SOURCE",
            "S2_RUNTIME_PASS_NONAUTHORITY",
            "PROVIDER_PRE_STOP_RESUME_POST",
            "POST_H1_H13_PASS",
            "PREBOUND_OUTER_CGROUP_TREE_KILL",
        ],
        "authenticated_provenance_verified": False,
        "persisted_readback_verified": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
        "next_required": [
            "fresh_aligned_w1_claim_directive",
            "authenticated_source_and_artifact_provenance",
            "persist_manifest_and_evidence_in_supabase",
            "persisted_readback_recompose_and_match_manifest_sha256",
            "supervisor_verification",
        ],
    }
