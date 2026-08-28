#!/usr/bin/env python3
"""Fail-closed semantic guard for the reusable W1 receipt attestor.

V16 intentionally supports only the keyless attestation mechanism smoke profile.
It does not accept arbitrary W1 runtime receipts yet. The goal is to prove the
reusable signer identity and permission boundary before expanding the profile
allowlist to live provider evidence.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
from pathlib import Path
from typing import Any

SCHEMA = "metaengine.compute.w1-trusted-receipt-attestor-smoke.h205f22.v1"
CLASSIFICATION = "W1_REUSABLE_TRUSTED_ATTESTOR_MECHANISM_SMOKE_NONAUTHORITY"
VALIDATION_SCHEMA = "metaengine.compute.w1-trusted-receipt-attestor-validation.h205f22.v1"
VALIDATION_CLASSIFICATION = "W1_REUSABLE_ATTESTOR_SUBJECT_VALIDATED_NONAUTHORITY"
REPOSITORY = "PatrickFrome/Compute"
REPOSITORY_ID = "1341371143"
OWNER_ID = "20597814"
CALLER_WORKFLOW = ".github/workflows/w1-trusted-receipt-attestor-contract.yml"
SIGNER_WORKFLOW = ".github/workflows/w1-trusted-receipt-attestor.yml"

SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
RUN_ID = re.compile(r"^[1-9][0-9]{0,19}$")
RUN_ATTEMPT = re.compile(r"^[1-9][0-9]{0,5}$")

FALSE_FIELDS = (
    "same_world_chain_live_evidence",
    "aws_credentials_used",
    "provider_mutation_observed",
    "database_mutation_observed",
    "reboot_completion_proven",
    "boot_id_transition_verified",
    "database_persisted_readback_verified",
    "persistent_worker_proof",
    "worker_admitted",
    "w1_verified",
    "canonical",
    "authority_effect",
)


class AttestorGuardError(RuntimeError):
    pass


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _require(value: Any, pattern: re.Pattern[str], label: str) -> str:
    if not isinstance(value, str) or pattern.fullmatch(value) is None:
        raise AttestorGuardError(f"{label}_invalid")
    return value


def build_smoke_subject(
    *,
    source_sha: str,
    source_tree: str,
    source_ref: str,
    run_id: str,
    run_attempt: str,
) -> dict[str, Any]:
    _require(source_sha, SHA40, "source_sha")
    _require(source_tree, SHA40, "source_tree")
    _require(str(run_id), RUN_ID, "run_id")
    _require(str(run_attempt), RUN_ATTEMPT, "run_attempt")
    if not isinstance(source_ref, str) or not source_ref.startswith("refs/heads/work/main-roadmap-accelerators-v16"):
        raise AttestorGuardError("source_ref_not_v16_smoke_branch")

    return {
        "schema": SCHEMA,
        "classification": CLASSIFICATION,
        "repository": REPOSITORY,
        "repository_id": REPOSITORY_ID,
        "repository_owner_id": OWNER_ID,
        "source_sha": source_sha,
        "source_tree": source_tree,
        "source_ref": source_ref,
        "caller_workflow": CALLER_WORKFLOW,
        "signer_workflow": SIGNER_WORKFLOW,
        "github_run_id": str(run_id),
        "github_run_attempt": str(run_attempt),
        "same_world_chain_live_evidence": False,
        "aws_credentials_used": False,
        "provider_mutation_observed": False,
        "database_mutation_observed": False,
        "reboot_completion_proven": False,
        "boot_id_transition_verified": False,
        "database_persisted_readback_verified": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }


def validate_smoke_subject(
    value: Any,
    *,
    expected_sha256: str,
    source_sha: str,
    source_ref: str,
    run_id: str,
    run_attempt: str,
    workflow_ref: str,
) -> dict[str, Any]:
    _require(expected_sha256, SHA256, "expected_sha256")
    _require(source_sha, SHA40, "source_sha")
    _require(str(run_id), RUN_ID, "run_id")
    _require(str(run_attempt), RUN_ATTEMPT, "run_attempt")
    if not isinstance(value, dict):
        raise AttestorGuardError("subject_not_object")
    raw = canonical(value)
    observed_sha = sha256_bytes(raw)
    if observed_sha != expected_sha256:
        raise AttestorGuardError("subject_sha256_mismatch")

    expected_exact = {
        "schema": SCHEMA,
        "classification": CLASSIFICATION,
        "repository": REPOSITORY,
        "repository_id": REPOSITORY_ID,
        "repository_owner_id": OWNER_ID,
        "source_sha": source_sha,
        "source_ref": source_ref,
        "caller_workflow": CALLER_WORKFLOW,
        "signer_workflow": SIGNER_WORKFLOW,
        "github_run_id": str(run_id),
        "github_run_attempt": str(run_attempt),
    }
    for key, expected in expected_exact.items():
        if value.get(key) != expected:
            raise AttestorGuardError(f"subject_field_mismatch:{key}")
    _require(value.get("source_tree"), SHA40, "source_tree")
    for key in FALSE_FIELDS:
        if value.get(key) is not False:
            raise AttestorGuardError(f"subject_authority_boundary_invalid:{key}")

    expected_workflow_ref = f"{REPOSITORY}/{CALLER_WORKFLOW}@{source_ref}"
    if workflow_ref != expected_workflow_ref:
        raise AttestorGuardError("caller_workflow_ref_mismatch")

    evidence = {
        "subject_sha256": observed_sha,
        "source_sha": source_sha,
        "source_tree": value["source_tree"],
        "source_ref": source_ref,
        "repository": REPOSITORY,
        "repository_id": REPOSITORY_ID,
        "repository_owner_id": OWNER_ID,
        "caller_workflow": CALLER_WORKFLOW,
        "signer_workflow": SIGNER_WORKFLOW,
        "github_run_id": str(run_id),
        "github_run_attempt": str(run_attempt),
        "caller_workflow_ref": workflow_ref,
    }
    receipt = {
        "schema": VALIDATION_SCHEMA,
        "classification": VALIDATION_CLASSIFICATION,
        "evidence": evidence,
        "evidence_sha256": sha256_bytes(canonical(evidence)),
        "subject_semantics_validated": True,
        "caller_workflow_allowlist_verified": True,
        "reusable_signer_boundary_expected": True,
        "producer_attestation_verified": False,
        "live_w1_receipt_authenticated": False,
        "reboot_completion_proven": False,
        "boot_id_transition_verified": False,
        "database_persisted_readback_verified": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }
    return receipt


def _load(path: str) -> Any:
    return json.loads(Path(path).read_text())


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_build = sub.add_parser("build-smoke")
    p_build.add_argument("--source-sha", required=True)
    p_build.add_argument("--source-tree", required=True)
    p_build.add_argument("--source-ref", required=True)
    p_build.add_argument("--run-id", required=True)
    p_build.add_argument("--run-attempt", required=True)
    p_build.add_argument("--output", required=True)

    p_validate = sub.add_parser("validate-smoke")
    p_validate.add_argument("--input", required=True)
    p_validate.add_argument("--expected-sha256", required=True)
    p_validate.add_argument("--source-sha", required=True)
    p_validate.add_argument("--source-ref", required=True)
    p_validate.add_argument("--run-id", required=True)
    p_validate.add_argument("--run-attempt", required=True)
    p_validate.add_argument("--workflow-ref", required=True)
    p_validate.add_argument("--output", required=True)

    args = parser.parse_args()
    if args.cmd == "build-smoke":
        value = build_smoke_subject(
            source_sha=args.source_sha,
            source_tree=args.source_tree,
            source_ref=args.source_ref,
            run_id=args.run_id,
            run_attempt=args.run_attempt,
        )
        Path(args.output).write_bytes(canonical(value))
        return 0

    value = _load(args.input)
    receipt = validate_smoke_subject(
        value,
        expected_sha256=args.expected_sha256,
        source_sha=args.source_sha,
        source_ref=args.source_ref,
        run_id=args.run_id,
        run_attempt=args.run_attempt,
        workflow_ref=args.workflow_ref,
    )
    Path(args.output).write_bytes(canonical(receipt))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
