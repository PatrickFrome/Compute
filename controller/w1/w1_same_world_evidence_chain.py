#!/usr/bin/env python3
"""Compose a fail-closed same-world provenance chain for W1 live evidence.

V14 does not perform AWS or database operations. It binds already-produced
non-authority receipts to one immutable execution world and an ordered
materials->subject chain inspired by SLSA/in-toto pipeline provenance.

A successful result means only that the supplied receipts are internally
consistent with one world anchor and with each other. Producer signatures,
reboot completion, persistence, admission and W1 verification remain separate.
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
from typing import Any

from controller.w1 import aws_ssm_safety_capture_guard as capture_guard
from controller.w1 import aws_ssm_safety_provision_provenance as provision_provenance
from controller.w1 import build_host_safety_package as package_builder

ANCHOR_SCHEMA = "metaengine.compute.w1-same-world-anchor.h205f22.v1"
LINK_SCHEMA = "metaengine.compute.w1-same-world-link.h205f22.v1"
CHAIN_SCHEMA = "metaengine.compute.w1-same-world-evidence-chain.h205f22.v1"
CHAIN_CLASSIFICATION = "W1_SAME_WORLD_EVIDENCE_CHAIN_LINKED_NONAUTHORITY"

REPOSITORY = "PatrickFrome/Compute"
REPOSITORY_ID = "1341371143"
OWNER_ID = "20597814"
REF = "refs/heads/main"
ENVIRONMENT = "w1-persistent-host-proof"
SAFETY_POLICY_KEY = "linux-h1-h13-v1"
SAFETY_POLICY_SHA256 = "3dba3ce69e945e52ff1a2ab23e2981dd543296c72f229673bcc44c94c9e70122"
EXPECTED_PACKAGE_SHA256 = "9700938abdeabae54357c2b0c8d9c620c2672b7d8d35c76249ca7a66f8163896"

STAGES = (
    "PROVISION",
    "PRE_REBOOT_SAFETY_CAPTURE",
    "REBOOT_REQUEST",
    "POST_REBOOT_SAFETY_CAPTURE",
)
STAGE_ORDINAL = {stage: i + 1 for i, stage in enumerate(STAGES)}
ALLOWED_WORKFLOWS = {
    "PROVISION": ".github/workflows/w1-aws-ssm-safety-provision-live.yml",
    "PRE_REBOOT_SAFETY_CAPTURE": ".github/workflows/w1-aws-ssm-safety-capture-live.yml",
    "REBOOT_REQUEST": ".github/workflows/w1-aws-provider-reboot-proof.yml",
    "POST_REBOOT_SAFETY_CAPTURE": ".github/workflows/w1-aws-ssm-safety-capture-live.yml",
}

SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
INSTANCE_ID = re.compile(r"^i-[0-9a-f]+$")
WORKER_ID = re.compile(r"^[A-Za-z0-9._:-]{3,160}$")
ACCOUNT_ID = re.compile(r"^[0-9]{12}$")
REGION = re.compile(r"^[a-z]{2}(-gov)?-[a-z]+-[0-9]+$")
RUN_ID = re.compile(r"^[1-9][0-9]{0,19}$")
RUN_ATTEMPT = re.compile(r"^[1-9][0-9]{0,5}$")
ROLE_SESSION = re.compile(r"^[A-Za-z0-9+=,.@_-]{2,64}$")
COMMAND_ID = re.compile(r"^[0-9a-fA-F-]{36}$")


class SameWorldError(RuntimeError):
    pass


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def _require(value: Any, pattern: re.Pattern[str], label: str) -> str:
    if not isinstance(value, str) or pattern.fullmatch(value) is None:
        raise SameWorldError(f"{label}_invalid")
    return value


def _assert_false(value: dict[str, Any], keys: tuple[str, ...], prefix: str) -> None:
    for key in keys:
        if value.get(key) is not False:
            raise SameWorldError(f"{prefix}_authority_boundary_invalid:{key}")


def build_world_anchor(
    *,
    source_sha: str,
    source_tree: str,
    instance_id: str,
    worker_id: str,
    account_id: str,
    region: str,
    safety_policy_sha256: str = SAFETY_POLICY_SHA256,
) -> dict[str, Any]:
    _require(source_sha, SHA40, "source_sha")
    _require(source_tree, SHA40, "source_tree")
    _require(instance_id, INSTANCE_ID, "instance_id")
    _require(worker_id, WORKER_ID, "worker_id")
    _require(account_id, ACCOUNT_ID, "account_id")
    _require(region, REGION, "region")
    _require(safety_policy_sha256, SHA256, "safety_policy_sha256")
    if safety_policy_sha256 != SAFETY_POLICY_SHA256:
        raise SameWorldError("safety_policy_pin_mismatch")

    core = {
        "schema": ANCHOR_SCHEMA,
        "classification": "W1_SAME_WORLD_ANCHOR_NONAUTHORITY",
        "repository": REPOSITORY,
        "repository_id": REPOSITORY_ID,
        "owner_id": OWNER_ID,
        "ref": REF,
        "environment": ENVIRONMENT,
        "source_sha": source_sha,
        "source_tree": source_tree,
        "instance_id": instance_id,
        "worker_id": worker_id,
        "provider_kind": "AWS_EC2",
        "account_id": account_id,
        "region": region,
        "package_source_commit_sha": package_builder.SOURCE_COMMIT,
        "package_source_tree_sha": package_builder.SOURCE_TREE,
        "package_manifest_sha256": package_builder.STATIC_MANIFEST_SHA256,
        "safety_policy_key": SAFETY_POLICY_KEY,
        "safety_policy_sha256": safety_policy_sha256,
        "external_parameters_complete": True,
        "producer_attestations_authenticated": False,
        "provider_identity_verified": False,
        "reboot_completion_proven": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }
    out = copy.deepcopy(core)
    out["world_id"] = _sha(core)
    return out


def validate_world_anchor(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema") != ANCHOR_SCHEMA:
        raise SameWorldError("world_anchor_schema_invalid")
    world_id = value.get("world_id")
    _require(world_id, SHA256, "world_id")
    core = {k: copy.deepcopy(v) for k, v in value.items() if k != "world_id"}
    if _sha(core) != world_id:
        raise SameWorldError("world_anchor_hash_mismatch")

    exact = {
        "classification": "W1_SAME_WORLD_ANCHOR_NONAUTHORITY",
        "repository": REPOSITORY,
        "repository_id": REPOSITORY_ID,
        "owner_id": OWNER_ID,
        "ref": REF,
        "environment": ENVIRONMENT,
        "provider_kind": "AWS_EC2",
        "package_source_commit_sha": package_builder.SOURCE_COMMIT,
        "package_source_tree_sha": package_builder.SOURCE_TREE,
        "package_manifest_sha256": package_builder.STATIC_MANIFEST_SHA256,
        "safety_policy_key": SAFETY_POLICY_KEY,
        "safety_policy_sha256": SAFETY_POLICY_SHA256,
        "external_parameters_complete": True,
        "producer_attestations_authenticated": False,
    }
    for key, expected in exact.items():
        if value.get(key) != expected:
            raise SameWorldError(f"world_anchor_field_mismatch:{key}")
    _require(value.get("source_sha"), SHA40, "source_sha")
    _require(value.get("source_tree"), SHA40, "source_tree")
    _require(value.get("instance_id"), INSTANCE_ID, "instance_id")
    _require(value.get("worker_id"), WORKER_ID, "worker_id")
    _require(value.get("account_id"), ACCOUNT_ID, "account_id")
    _require(value.get("region"), REGION, "region")
    _assert_false(
        value,
        (
            "provider_identity_verified",
            "reboot_completion_proven",
            "persistent_worker_proof",
            "worker_admitted",
            "w1_verified",
            "canonical",
            "authority_effect",
        ),
        "world_anchor",
    )
    return copy.deepcopy(value)


def _validate_provision_receipt(value: Any, anchor: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema") != provision_provenance.PROVENANCE_SCHEMA:
        raise SameWorldError("provision_receipt_schema_invalid")
    if value.get("classification") != provision_provenance.CLASSIFICATION:
        raise SameWorldError("provision_receipt_classification_invalid")
    evidence = value.get("evidence")
    if not isinstance(evidence, dict) or value.get("evidence_sha256") != _sha(evidence):
        raise SameWorldError("provision_receipt_hash_invalid")
    identity_expectations = {
        "provider_kind": "AWS_EC2",
        "instance_id": anchor["instance_id"],
        "worker_id": anchor["worker_id"],
        "account_id": anchor["account_id"],
        "region": anchor["region"],
    }
    for key, expected in identity_expectations.items():
        if evidence.get(key) != expected:
            raise SameWorldError(f"provision_receipt_world_mismatch:{key}")
    if evidence.get("package_sha256") != EXPECTED_PACKAGE_SHA256:
        raise SameWorldError("provision_receipt_package_sha_mismatch")
    _require(evidence.get("payload_lock_sha256"), SHA256, "provision_payload_lock_sha256")
    _require(evidence.get("signed_iid_receipt_sha256"), SHA256, "provision_signed_iid_receipt_sha256")
    _require(evidence.get("transport_evidence_sha256"), SHA256, "provision_transport_evidence_sha256")
    if value.get("package_provisioning_verified") is not True:
        raise SameWorldError("provision_receipt_not_verified")
    if value.get("signed_provider_identity_verified") is not True or value.get("provider_host_binding_verified") is not True:
        raise SameWorldError("provision_provider_binding_not_verified")
    if value.get("managed_node_binding_verified") is not True or value.get("remote_document_identity_verified") is not True:
        raise SameWorldError("provision_remote_binding_not_verified")
    if value.get("command_invocation_verified") is not True or value.get("cloudtrail_send_command_verified") is not True:
        raise SameWorldError("provision_command_provenance_not_verified")
    _assert_false(
        value,
        (
            "host_safety_verified",
            "reboot_completion_proven",
            "persistent_worker_proof",
            "worker_admitted",
            "w1_verified",
            "database_mutation",
            "canonical",
            "authority_effect",
        ),
        "provision_receipt",
    )
    return copy.deepcopy(evidence)


def _validate_capture_receipt(value: Any, anchor: dict[str, Any], label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema") != capture_guard.CAPTURE_SCHEMA:
        raise SameWorldError(f"{label}_schema_invalid")
    if value.get("classification") != "W1_AWS_SSM_SAFETY_CAPTURE_VALIDATED_NONAUTHORITY":
        raise SameWorldError(f"{label}_classification_invalid")
    evidence = value.get("evidence")
    if not isinstance(evidence, dict) or value.get("evidence_sha256") != _sha(evidence):
        raise SameWorldError(f"{label}_hash_invalid")
    exact = {
        "instance_id": anchor["instance_id"],
        "package_source_commit_sha": package_builder.SOURCE_COMMIT,
        "package_source_tree_sha": package_builder.SOURCE_TREE,
        "package_manifest_sha256": package_builder.STATIC_MANIFEST_SHA256,
        "offhost_decision_recomputed": True,
    }
    for key, expected in exact.items():
        if evidence.get(key) != expected:
            raise SameWorldError(f"{label}_world_mismatch:{key}")
    if evidence.get("safety_eligible") is not True or value.get("host_safety_eligible_observed") is not True:
        raise SameWorldError(f"{label}_not_safety_eligible")
    _require(evidence.get("command_id"), COMMAND_ID, f"{label}_command_id")
    _require(evidence.get("bundle_transport_sha256"), SHA256, f"{label}_bundle_transport_sha256")
    if value.get("capture_transport_validated") is not True:
        raise SameWorldError(f"{label}_transport_not_validated")
    _assert_false(
        value,
        (
            "host_safety_verified",
            "provider_identity_verified",
            "reboot_completion_proven",
            "persistent_worker_proof",
            "w1_verified",
            "canonical",
            "authority_effect",
        ),
        label,
    )
    return copy.deepcopy(evidence)


def _validate_reboot_receipt(value: Any, anchor: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema") != "metaengine.compute.w1-provider-reboot-receipt-candidate.h205f22.v1":
        raise SameWorldError("reboot_receipt_schema_invalid")
    exact = {
        "classification": "LIVE_PROVIDER_CONTROLLER_RECEIPT_UNINGESTED",
        "worker_id": anchor["worker_id"],
        "provider_kind": "AWS_EC2",
        "provider_instance_id": anchor["instance_id"],
        "action_kind": "REBOOT",
        "completed_at_semantics": "PROVIDER_REQUEST_ACCEPTED_AT_NOT_REBOOT_COMPLETION",
        "identity_attestation_kind": "PROVIDER_METADATA",
        "identity_attestation_verified": False,
    }
    for key, expected in exact.items():
        if value.get(key) != expected:
            raise SameWorldError(f"reboot_receipt_world_mismatch:{key}")
    evidence = value.get("evidence")
    if not isinstance(evidence, dict) or value.get("evidence_artifact_sha256") != _sha(evidence):
        raise SameWorldError("reboot_receipt_hash_invalid")
    if evidence.get("schema") != "metaengine.compute.w1-aws-provider-evidence.h205f22.v1":
        raise SameWorldError("reboot_evidence_schema_invalid")
    if evidence.get("provider_action_semantics") != "ASYNC_REBOOT_REQUEST_ACCEPTED":
        raise SameWorldError("reboot_semantics_invalid")
    preflight = evidence.get("preflight")
    if not isinstance(preflight, dict):
        raise SameWorldError("reboot_preflight_missing")
    preflight_expected = {
        "instance_id": anchor["instance_id"],
        "worker_id": anchor["worker_id"],
        "worker_bundle_github_sha": package_builder.SOURCE_COMMIT,
        "authority_effect": False,
        "canonical": False,
    }
    for key, expected in preflight_expected.items():
        if preflight.get(key) != expected:
            raise SameWorldError(f"reboot_preflight_world_mismatch:{key}")
    github = evidence.get("github")
    if not isinstance(github, dict):
        raise SameWorldError("reboot_github_context_missing")
    _require(str(github.get("run_id")), RUN_ID, "reboot_run_id")
    _require(str(github.get("run_attempt")), RUN_ATTEMPT, "reboot_run_attempt")
    _require(github.get("role_session"), ROLE_SESSION, "reboot_role_session")
    _assert_false(
        value,
        ("canonical", "authority_effect", "persistent_worker_proof", "w1_verified"),
        "reboot_receipt",
    )
    return copy.deepcopy(evidence)


def validate_stage_receipt(stage: str, receipt: Any, anchor: dict[str, Any]) -> dict[str, Any]:
    if stage == "PROVISION":
        return _validate_provision_receipt(receipt, anchor)
    if stage in ("PRE_REBOOT_SAFETY_CAPTURE", "POST_REBOOT_SAFETY_CAPTURE"):
        return _validate_capture_receipt(receipt, anchor, stage.lower())
    if stage == "REBOOT_REQUEST":
        return _validate_reboot_receipt(receipt, anchor)
    raise SameWorldError("stage_invalid")


def build_stage_link(
    *,
    world_anchor: Any,
    stage: str,
    receipt: Any,
    workflow_path: str,
    run_id: str,
    run_attempt: str,
    previous_link: Any | None = None,
    previous_receipt: Any | None = None,
) -> dict[str, Any]:
    anchor = validate_world_anchor(world_anchor)
    if stage not in STAGE_ORDINAL:
        raise SameWorldError("stage_invalid")
    if workflow_path != ALLOWED_WORKFLOWS[stage]:
        raise SameWorldError("workflow_path_not_allowed")
    _require(str(run_id), RUN_ID, "run_id")
    _require(str(run_attempt), RUN_ATTEMPT, "run_attempt")
    validate_stage_receipt(stage, receipt, anchor)

    ordinal = STAGE_ORDINAL[stage]
    materials = [{"name": "world-anchor", "sha256": anchor["world_id"]}]
    previous_link_sha256 = None
    previous_receipt_sha256 = None
    if ordinal == 1:
        if previous_link is not None or previous_receipt is not None:
            raise SameWorldError("first_stage_previous_material_forbidden")
    else:
        if not isinstance(previous_link, dict) or not isinstance(previous_receipt, dict):
            raise SameWorldError("previous_stage_material_required")
        previous_link_sha256 = previous_link.get("link_sha256")
        _require(previous_link_sha256, SHA256, "previous_link_sha256")
        previous_receipt_sha256 = _sha(previous_receipt)
        materials.extend(
            [
                {"name": "previous-link", "sha256": previous_link_sha256},
                {"name": "previous-receipt", "sha256": previous_receipt_sha256},
            ]
        )

    subject_sha256 = _sha(receipt)
    core = {
        "schema": LINK_SCHEMA,
        "classification": "W1_SAME_WORLD_STAGE_LINK_NONAUTHORITY",
        "world_id": anchor["world_id"],
        "world_anchor_sha256": anchor["world_id"],
        "stage": stage,
        "ordinal": ordinal,
        "workflow_path": workflow_path,
        "run_id": str(run_id),
        "run_attempt": str(run_attempt),
        "source_sha": anchor["source_sha"],
        "source_tree": anchor["source_tree"],
        "repository_id": REPOSITORY_ID,
        "owner_id": OWNER_ID,
        "environment": ENVIRONMENT,
        "materials": materials,
        "subject": {"name": stage.lower() + "-receipt", "sha256": subject_sha256},
        "previous_link_sha256": previous_link_sha256,
        "previous_receipt_sha256": previous_receipt_sha256,
        "producer_attestation_authenticated": False,
        "provider_mutation_authorized_by_link": False,
        "database_mutation_authorized_by_link": False,
        "reboot_completion_proven": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }
    out = copy.deepcopy(core)
    out["link_sha256"] = _sha(core)
    return out


def validate_stage_link(
    value: Any,
    *,
    anchor: dict[str, Any],
    stage: str,
    receipt: Any,
    previous_link: Any | None,
    previous_receipt: Any | None,
) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema") != LINK_SCHEMA:
        raise SameWorldError(f"{stage}_link_schema_invalid")
    link_sha = value.get("link_sha256")
    _require(link_sha, SHA256, f"{stage}_link_sha256")
    core = {k: copy.deepcopy(v) for k, v in value.items() if k != "link_sha256"}
    if _sha(core) != link_sha:
        raise SameWorldError(f"{stage}_link_hash_mismatch")
    exact = {
        "classification": "W1_SAME_WORLD_STAGE_LINK_NONAUTHORITY",
        "world_id": anchor["world_id"],
        "world_anchor_sha256": anchor["world_id"],
        "stage": stage,
        "ordinal": STAGE_ORDINAL[stage],
        "workflow_path": ALLOWED_WORKFLOWS[stage],
        "source_sha": anchor["source_sha"],
        "source_tree": anchor["source_tree"],
        "repository_id": REPOSITORY_ID,
        "owner_id": OWNER_ID,
        "environment": ENVIRONMENT,
        "producer_attestation_authenticated": False,
    }
    for key, expected in exact.items():
        if value.get(key) != expected:
            raise SameWorldError(f"{stage}_link_field_mismatch:{key}")
    _require(value.get("run_id"), RUN_ID, f"{stage}_run_id")
    _require(value.get("run_attempt"), RUN_ATTEMPT, f"{stage}_run_attempt")
    subject = value.get("subject")
    if subject != {"name": stage.lower() + "-receipt", "sha256": _sha(receipt)}:
        raise SameWorldError(f"{stage}_subject_mismatch")

    expected_materials = [{"name": "world-anchor", "sha256": anchor["world_id"]}]
    if STAGE_ORDINAL[stage] == 1:
        if value.get("previous_link_sha256") is not None or value.get("previous_receipt_sha256") is not None:
            raise SameWorldError("provision_previous_material_forbidden")
    else:
        if not isinstance(previous_link, dict) or not isinstance(previous_receipt, dict):
            raise SameWorldError(f"{stage}_previous_material_missing")
        prev_link_sha = previous_link.get("link_sha256")
        _require(prev_link_sha, SHA256, f"{stage}_previous_link_sha256")
        prev_receipt_sha = _sha(previous_receipt)
        if value.get("previous_link_sha256") != prev_link_sha:
            raise SameWorldError(f"{stage}_previous_link_mismatch")
        if value.get("previous_receipt_sha256") != prev_receipt_sha:
            raise SameWorldError(f"{stage}_previous_receipt_mismatch")
        expected_materials.extend(
            [
                {"name": "previous-link", "sha256": prev_link_sha},
                {"name": "previous-receipt", "sha256": prev_receipt_sha},
            ]
        )
    if value.get("materials") != expected_materials:
        raise SameWorldError(f"{stage}_materials_mismatch")
    _assert_false(
        value,
        (
            "provider_mutation_authorized_by_link",
            "database_mutation_authorized_by_link",
            "reboot_completion_proven",
            "persistent_worker_proof",
            "worker_admitted",
            "w1_verified",
            "canonical",
            "authority_effect",
        ),
        f"{stage}_link",
    )
    validate_stage_receipt(stage, receipt, anchor)
    return copy.deepcopy(value)


def compose_same_world_chain(
    *,
    world_anchor: Any,
    provision_receipt: Any,
    provision_link: Any,
    pre_capture_receipt: Any,
    pre_capture_link: Any,
    reboot_receipt: Any,
    reboot_link: Any,
    post_capture_receipt: Any,
    post_capture_link: Any,
) -> dict[str, Any]:
    anchor = validate_world_anchor(world_anchor)
    stage_items = [
        ("PROVISION", provision_receipt, provision_link, None, None),
        ("PRE_REBOOT_SAFETY_CAPTURE", pre_capture_receipt, pre_capture_link, provision_link, provision_receipt),
        ("REBOOT_REQUEST", reboot_receipt, reboot_link, pre_capture_link, pre_capture_receipt),
        ("POST_REBOOT_SAFETY_CAPTURE", post_capture_receipt, post_capture_link, reboot_link, reboot_receipt),
    ]
    for stage, receipt, link, prev_link, prev_receipt in stage_items:
        validate_stage_link(
            link,
            anchor=anchor,
            stage=stage,
            receipt=receipt,
            previous_link=prev_link,
            previous_receipt=prev_receipt,
        )

    pre_evidence = pre_capture_receipt["evidence"]
    post_evidence = post_capture_receipt["evidence"]
    if pre_evidence.get("command_id") == post_evidence.get("command_id"):
        raise SameWorldError("pre_post_capture_command_id_reuse")
    if pre_evidence.get("bundle_transport_sha256") == post_evidence.get("bundle_transport_sha256"):
        raise SameWorldError("pre_post_capture_bundle_reuse")

    evidence = {
        "world_id": anchor["world_id"],
        "repository_id": REPOSITORY_ID,
        "owner_id": OWNER_ID,
        "source_sha": anchor["source_sha"],
        "source_tree": anchor["source_tree"],
        "instance_id": anchor["instance_id"],
        "worker_id": anchor["worker_id"],
        "account_id": anchor["account_id"],
        "region": anchor["region"],
        "package_source_commit_sha": package_builder.SOURCE_COMMIT,
        "package_source_tree_sha": package_builder.SOURCE_TREE,
        "safety_policy_sha256": anchor["safety_policy_sha256"],
        "stage_link_sha256": {stage: link["link_sha256"] for stage, _, link, _, _ in stage_items},
        "stage_receipt_sha256": {stage: _sha(receipt) for stage, receipt, _, _, _ in stage_items},
        "pre_capture_command_id": pre_evidence["command_id"],
        "post_capture_command_id": post_evidence["command_id"],
        "pre_capture_bundle_transport_sha256": pre_evidence["bundle_transport_sha256"],
        "post_capture_bundle_transport_sha256": post_evidence["bundle_transport_sha256"],
        "reboot_action_id": reboot_receipt["action_id"],
        "provision_command_id": provision_receipt["evidence"]["command_id"],
    }
    return {
        "schema": CHAIN_SCHEMA,
        "classification": CHAIN_CLASSIFICATION,
        "evidence": evidence,
        "evidence_sha256": _sha(evidence),
        "same_world_linkage_verified": True,
        "ordered_material_chain_verified": True,
        "stage_receipt_self_hashes_verified": True,
        "pre_post_capture_distinct": True,
        "producer_attestations_authenticated": False,
        "signed_provider_identity_verified_for_provisioning": True,
        "reboot_request_provider_event_observed": True,
        "reboot_completion_proven": False,
        "boot_id_transition_verified": False,
        "database_persisted_readback_verified": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }
