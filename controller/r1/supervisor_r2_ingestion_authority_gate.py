#!/usr/bin/env python3
"""Production STEP09A authority boundary around the pure ingestion-gate core.

Unlike the core verifier, this wrapper does not accept a precomputed GitHub
attestation-verification JSON file. It materializes the attestation bundle from the
validated STEP08 package and executes `gh attestation verify` itself with the exact
repository/signer/source/issuer/predicate/self-hosted/trusted-root policy. Only this
wrapper emits a receipt that STEP09B may accept.

It still has no database credential, provider credential, database write, R2/R3
transition, or persisted-seal authority.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Callable

from controller.r1.supervisor_r2_ingestion_gate import (
    EXPECTED_ISSUER,
    EXPECTED_REPOSITORY,
    EXPECTED_SOURCE_REF,
    SOURCE_PREDICATE_TYPE,
    SOURCE_WORKFLOW_PATH,
    SupervisorGateError,
    _canonical,
    _load_package,
    _read_json,
    _read_jsonl_bytes,
    _sha_bytes,
    _sha_json,
    _validate_root_context,
    _parse_time,
    evaluate_gate,
)

AUTHORITY_GATE_SCHEMA = "metaengine.compute.r1-supervisor-r2-ingestion-authority-gate.h205f22.v1"
AUTHORITY_GATE_CLASSIFICATION = "SUPERVISOR_R2_STEP09B_ELIGIBILITY_NONAUTHORITATIVE"
GH_VERIFY_TIMEOUT_SECONDS = 120


class AuthorityGateError(RuntimeError):
    pass


def build_gh_verify_command(
    *,
    gh_bin: str,
    ciphertext_path: Path,
    bundle_path: Path,
    trusted_root_path: Path,
    source_head_sha: str,
) -> list[str]:
    return [
        gh_bin,
        "attestation",
        "verify",
        str(ciphertext_path),
        "--repo",
        EXPECTED_REPOSITORY,
        "--bundle",
        str(bundle_path),
        "--signer-workflow",
        f"{EXPECTED_REPOSITORY}/{SOURCE_WORKFLOW_PATH}",
        "--signer-digest",
        source_head_sha,
        "--source-ref",
        EXPECTED_SOURCE_REF,
        "--source-digest",
        source_head_sha,
        "--cert-oidc-issuer",
        EXPECTED_ISSUER,
        "--predicate-type",
        SOURCE_PREDICATE_TYPE,
        "--deny-self-hosted-runners",
        "--custom-trusted-root",
        str(trusted_root_path),
        "--format",
        "json",
    ]


def _subprocess_verify(command: list[str]) -> str:
    try:
        proc = subprocess.run(
            command,
            check=True,
            text=True,
            capture_output=True,
            stdin=subprocess.DEVNULL,
            timeout=GH_VERIFY_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise AuthorityGateError("gh_attestation_verify_failed") from exc
    if not proc.stdout.strip():
        raise AuthorityGateError("gh_attestation_verify_empty_output")
    return proc.stdout


def evaluate_authority_gate(
    *,
    package_path: Path,
    package_receipt_path: Path,
    ciphertext_path: Path,
    fresh_trusted_root_path: Path,
    root_context_path: Path,
    effective_at: str,
    gh_bin: str = "gh",
    runner: Callable[[list[str]], str] = _subprocess_verify,
) -> dict[str, Any]:
    entries, receipt, _manifest, _projection = _load_package(package_path, package_receipt_path)
    source_verification = json.loads(entries["source/r1-recovery-source-verification.json"])
    source = source_verification.get("source") if isinstance(source_verification, dict) else None
    if not isinstance(source, dict) or not isinstance(source.get("head_sha"), str):
        raise AuthorityGateError("source_verification_identity_missing")
    source_head_sha = source["head_sha"]

    effective = _parse_time(effective_at, "effective_at")
    fresh_root = _read_jsonl_bytes(fresh_trusted_root_path, "fresh_trusted_root")
    root_context = _read_json(root_context_path, "trusted_root_context")
    root_info = _validate_root_context(root_context, fresh_root, effective, source_head_sha)

    bundle = entries.get("source/r1-recovery-source-attestation.sigstore.jsonl")
    if bundle is None or not bundle.strip():
        raise AuthorityGateError("step08_attestation_bundle_missing")
    for line in bundle.splitlines():
        if line.strip():
            try:
                json.loads(line)
            except json.JSONDecodeError as exc:
                raise AuthorityGateError("step08_attestation_bundle_invalid_jsonl") from exc

    with tempfile.TemporaryDirectory(prefix="h205f22-r1-step09a-authority-") as temp_dir:
        bundle_path = Path(temp_dir) / "attestation.sigstore.jsonl"
        verification_path = Path(temp_dir) / "gh-attestation-verification.json"
        bundle_path.write_bytes(bundle)
        command = build_gh_verify_command(
            gh_bin=gh_bin,
            ciphertext_path=ciphertext_path,
            bundle_path=bundle_path,
            trusted_root_path=fresh_trusted_root_path,
            source_head_sha=source_head_sha,
        )
        raw_output = runner(command)
        try:
            verification = json.loads(raw_output)
        except json.JSONDecodeError as exc:
            raise AuthorityGateError("gh_attestation_verify_invalid_json") from exc
        if not isinstance(verification, list) or len(verification) != 1:
            raise AuthorityGateError("gh_attestation_verify_result_not_single")
        verification_path.write_bytes(_canonical(verification) + b"\n")

        try:
            core = evaluate_gate(
                package_path=package_path,
                package_receipt_path=package_receipt_path,
                ciphertext_path=ciphertext_path,
                verification_path=verification_path,
                fresh_trusted_root_path=fresh_trusted_root_path,
                root_context_path=root_context_path,
                effective_at=effective_at,
            )
        except SupervisorGateError as exc:
            raise AuthorityGateError(str(exc)) from exc

    if core.get("ingestion_eligible") is not True:
        raise AuthorityGateError("core_ingestion_gate_not_eligible")
    if any(core.get(k) is not False for k in ("database_write_performed", "canonical", "authority_effect", "r2_proven", "r3_proven", "persisted_seal_allowed")):
        raise AuthorityGateError("core_ingestion_gate_authority_boundary_invalid")

    policy = root_context.get("policy")
    command_policy_sha256 = _sha_json(policy)
    verification_sha256 = _sha_json(verification)
    core_body = {
        "schema": AUTHORITY_GATE_SCHEMA,
        "classification": AUTHORITY_GATE_CLASSIFICATION,
        "package_sha256": receipt["package_sha256"],
        "db_projection_sha256": receipt["db_projection_sha256"],
        "core_gate_receipt_sha256": core["gate_receipt_sha256"],
        "source_head_sha": source_head_sha,
        "trusted_root": {
            "sha256": root_info["root_sha256"],
            "context_sha256": root_info["context_sha256"],
            "acquired_at": root_info["acquired_at"],
            "online_fetch_required": True,
        },
        "gh_attestation_verification": {
            "executed_by_this_gate": True,
            "offline_bundle_used": True,
            "custom_fresh_trusted_root_used": True,
            "strict_policy_sha256": command_policy_sha256,
            "verification_json_sha256": verification_sha256,
            "result_count": 1,
        },
        "step09b_ingestion_eligible": True,
        "required_next": "STEP09B_APPEND_ONLY_DB_TRANSACTION_USING_THIS_GATE_AND_EXACT_STEP08_PROJECTION",
        "database_credential_present": False,
        "database_write_performed": False,
        "provider_credential_present": False,
        "provider_call_performed": False,
        "canonical": False,
        "authority_effect": False,
        "r2_proven": False,
        "r3_proven": False,
        "persisted_seal_allowed": False,
    }
    out = dict(core_body)
    out["authority_gate_receipt_sha256"] = _sha_json(core_body)
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--package", required=True)
    p.add_argument("--package-receipt", required=True)
    p.add_argument("--ciphertext", required=True)
    p.add_argument("--fresh-trusted-root", required=True)
    p.add_argument("--root-context", required=True)
    p.add_argument("--effective-at", required=True)
    p.add_argument("--gh-bin", default="gh")
    p.add_argument("--output", required=True)
    a = p.parse_args(argv)
    try:
        result = evaluate_authority_gate(
            package_path=Path(a.package),
            package_receipt_path=Path(a.package_receipt),
            ciphertext_path=Path(a.ciphertext),
            fresh_trusted_root_path=Path(a.fresh_trusted_root),
            root_context_path=Path(a.root_context),
            effective_at=a.effective_at,
            gh_bin=a.gh_bin,
        )
        Path(a.output).write_bytes(_canonical(result) + b"\n")
        return 0
    except (AuthorityGateError, SupervisorGateError) as exc:
        print(f"R1_SUPERVISOR_AUTHORITY_GATE_REJECTED:{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
