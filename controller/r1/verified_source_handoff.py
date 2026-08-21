#!/usr/bin/env python3
"""Credential-free handoff gate from R1 STEP07 into STEP06 provider orchestration.

This module performs no network access and holds no credentials. It validates an
immutable STEP07 source-verification artifact against the already validated STEP06
source preflight plus the materialized ciphertext/envelope bytes. Passing this gate
only makes provider jobs *eligible for their own protected-environment/readiness
checks*; it never establishes R2/R3 or seal authority.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

from controller.r1.recovery_encryption_envelope import EnvelopeError, validate_envelope_receipt

EXPECTED_REPOSITORY_ID = 1341371143
EXPECTED_REPOSITORY = "PatrickFrome/Compute"
EXPECTED_SOURCE_WORKFLOW_PATH = ".github/workflows/r1-live-recovery-source.yml"
EXPECTED_SOURCE_BRANCH = "main"
SOURCE_VERIFICATION_ARTIFACT_NAME = "r1-recovery-source-verification.json"
SOURCE_VERIFICATION_SCHEMA = "metaengine.compute.r1-recovery-source-attestation-verification.h205f22.v1"
SOURCE_VERIFICATION_CLASSIFICATION = "CRYPTOGRAPHICALLY_VERIFIED_RECOVERY_SOURCE_NONAUTHORITATIVE"
PREFLIGHT_SCHEMA = "metaengine.compute.r1-live-two-domain-preflight.h205f22.v1"
HANDOFF_SCHEMA = "metaengine.compute.r1-verified-source-handoff.h205f22.v1"
HANDOFF_CLASSIFICATION = "VERIFIED_SOURCE_HANDOFF_PROVIDER_ELIGIBILITY_NONAUTHORITATIVE"
MAX_VERIFICATION_RECEIPT_BYTES = 1024 * 1024
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
ARTIFACT_DIGEST = re.compile(r"^sha256:([0-9a-f]{64})$")


class HandoffError(RuntimeError):
    pass


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_json(value: Any) -> str:
    return _sha256_bytes(_canonical_bytes(value))


def _read_json(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise HandoffError(f"{label}_invalid_json") from exc


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(_canonical_bytes(value) + b"\n")


def _hash_file(path: Path) -> tuple[str, int]:
    h = hashlib.sha256()
    total = 0
    try:
        with path.open("rb") as handle:
            while True:
                chunk = handle.read(1024 * 1024)
                if not chunk:
                    break
                h.update(chunk)
                total += len(chunk)
    except OSError as exc:
        raise HandoffError(f"file_unavailable:{path}") from exc
    return h.hexdigest(), total


def _require_int(value: Any, field: str, minimum: int = 1) -> int:
    if isinstance(value, bool):
        raise HandoffError(f"{field}_invalid")
    try:
        out = int(value)
    except (TypeError, ValueError) as exc:
        raise HandoffError(f"{field}_invalid") from exc
    if out < minimum:
        raise HandoffError(f"{field}_invalid")
    return out


def _require_sha(value: Any, field: str) -> str:
    if not isinstance(value, str) or not SHA256.fullmatch(value):
        raise HandoffError(f"{field}_invalid")
    return value


def _verify_self_hash(value: dict[str, Any], field: str, label: str) -> str:
    claimed = _require_sha(value.get(field), field)
    core = dict(value)
    core.pop(field, None)
    actual = _sha256_json(core)
    if actual != claimed:
        raise HandoffError(f"{label}_{field}_mismatch")
    return claimed


def _validated_preflight(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema") != PREFLIGHT_SCHEMA:
        raise HandoffError("preflight_schema_invalid")
    if value.get("classification") != "LIVE_ORCHESTRATION_PREFLIGHT_NONAUTHORITATIVE":
        raise HandoffError("preflight_classification_invalid")
    _verify_self_hash(value, "preflight_sha256", "preflight")
    source = value.get("source")
    if not isinstance(source, dict):
        raise HandoffError("preflight_source_missing")
    run_id = _require_int(source.get("run_id"), "preflight_source_run_id")
    head_sha = source.get("head_sha")
    if not isinstance(head_sha, str) or not SHA40.fullmatch(head_sha):
        raise HandoffError("preflight_source_head_sha_invalid")
    if source.get("workflow_path") != EXPECTED_SOURCE_WORKFLOW_PATH:
        raise HandoffError("preflight_source_workflow_mismatch")
    if source.get("branch") != EXPECTED_SOURCE_BRANCH:
        raise HandoffError("preflight_source_branch_mismatch")
    if source.get("repository_id") != EXPECTED_REPOSITORY_ID or source.get("repository") != EXPECTED_REPOSITORY:
        raise HandoffError("preflight_source_repository_mismatch")
    if value.get("provider_execution_authorized") is not False:
        raise HandoffError("preflight_must_not_authorize_provider")
    if value.get("authority_effect") is not False or value.get("r2_proven") is not False or value.get("persisted_seal_allowed") is not False:
        raise HandoffError("preflight_authority_boundary_invalid")
    return {"run_id": run_id, "head_sha": head_sha, "source": source, "preflight_sha256": value["preflight_sha256"]}


def _selected_verification_artifact(artifacts: Any, artifact_id: int, *, run_id: int, head_sha: str) -> dict[str, Any]:
    artifact_id = _require_int(artifact_id, "source_verification_artifact_id")
    if not isinstance(artifacts, dict) or not isinstance(artifacts.get("artifacts"), list):
        raise HandoffError("artifacts_shape_invalid")
    matches = [x for x in artifacts["artifacts"] if isinstance(x, dict) and x.get("id") == artifact_id]
    if len(matches) != 1:
        raise HandoffError("source_verification_artifact_missing_or_not_unique")
    item = matches[0]
    if item.get("name") != SOURCE_VERIFICATION_ARTIFACT_NAME:
        raise HandoffError("source_verification_artifact_name_mismatch")
    if item.get("expired") is not False:
        raise HandoffError("source_verification_artifact_expired")
    size = _require_int(item.get("size_in_bytes"), "source_verification_artifact_size")
    if size > MAX_VERIFICATION_RECEIPT_BYTES:
        raise HandoffError("source_verification_artifact_unreasonably_large")
    digest_text = item.get("digest")
    if not isinstance(digest_text, str):
        raise HandoffError("source_verification_artifact_digest_missing")
    match = ARTIFACT_DIGEST.fullmatch(digest_text)
    if match is None:
        raise HandoffError("source_verification_artifact_digest_invalid")
    wr = item.get("workflow_run")
    if not isinstance(wr, dict):
        raise HandoffError("source_verification_artifact_workflow_run_missing")
    expected = {
        "id": run_id,
        "repository_id": EXPECTED_REPOSITORY_ID,
        "head_repository_id": EXPECTED_REPOSITORY_ID,
        "head_branch": EXPECTED_SOURCE_BRANCH,
        "head_sha": head_sha,
    }
    for key, val in expected.items():
        if wr.get(key) != val:
            raise HandoffError(f"source_verification_artifact_workflow_binding_mismatch:{key}")
    return {"id": artifact_id, "name": SOURCE_VERIFICATION_ARTIFACT_NAME, "size_in_bytes": size, "digest_sha256": match.group(1)}


def _validated_source_verification(value: Any, *, run_id: int, head_sha: str, ciphertext_sha: str, ciphertext_bytes: int, envelope_receipt_sha: str) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema") != SOURCE_VERIFICATION_SCHEMA:
        raise HandoffError("source_verification_schema_invalid")
    if value.get("classification") != SOURCE_VERIFICATION_CLASSIFICATION:
        raise HandoffError("source_verification_classification_invalid")
    receipt_sha = _verify_self_hash(value, "verification_receipt_sha256", "source_verification")
    source = value.get("source")
    if not isinstance(source, dict):
        raise HandoffError("source_verification_source_missing")
    expected = {
        "repository_id": EXPECTED_REPOSITORY_ID,
        "repository": EXPECTED_REPOSITORY,
        "workflow_path": EXPECTED_SOURCE_WORKFLOW_PATH,
        "head_sha": head_sha,
        "run_id": run_id,
    }
    for key, val in expected.items():
        if source.get(key) != val:
            raise HandoffError(f"source_verification_source_binding_mismatch:{key}")
    if value.get("ciphertext_sha256") != ciphertext_sha or value.get("ciphertext_bytes") != ciphertext_bytes:
        raise HandoffError("source_verification_ciphertext_binding_mismatch")
    if value.get("envelope_receipt_sha256") != envelope_receipt_sha:
        raise HandoffError("source_verification_envelope_binding_mismatch")
    if value.get("source_attestation_verified") is not True:
        raise HandoffError("source_attestation_not_verified")
    if _require_int(value.get("verified_timestamp_count"), "verified_timestamp_count") < 1:
        raise HandoffError("verified_timestamp_missing")
    if value.get("final_r2_evidence_binding_required") is not True:
        raise HandoffError("final_r2_evidence_binding_requirement_missing")
    if value.get("authority_effect") is not False or value.get("r2_proven") is not False or value.get("r3_proven") is not False or value.get("persisted_seal_allowed") is not False:
        raise HandoffError("source_verification_authority_boundary_invalid")
    for field in ("predicate_sha256", "canonical_digest_at_source", "migration_ledger_sha256"):
        _require_sha(value.get(field), field)
    return {"verification_receipt_sha256": receipt_sha, "predicate_sha256": value["predicate_sha256"], "canonical_digest_at_source": value["canonical_digest_at_source"], "semantic_head_at_source": value.get("semantic_head_at_source"), "migration_ledger_sha256": value["migration_ledger_sha256"]}


def validate_handoff(*, preflight: Any, artifacts: Any, source_verification_artifact_id: int, source_verification: Any, ciphertext: Path, envelope_receipt: Path) -> dict[str, Any]:
    pf = _validated_preflight(preflight)
    artifact = _selected_verification_artifact(artifacts, source_verification_artifact_id, run_id=pf["run_id"], head_sha=pf["head_sha"])
    cipher_sha, cipher_bytes = _hash_file(ciphertext)
    try:
        envelope = validate_envelope_receipt(ciphertext, envelope_receipt, require_production_ready=True)
    except EnvelopeError as exc:
        raise HandoffError(str(exc)) from exc
    envelope_sha = envelope.get("receipt_sha256")
    _require_sha(envelope_sha, "envelope_receipt_sha256")

    source = pf["source"]
    cipher_meta = source.get("ciphertext_artifact")
    envelope_meta = source.get("envelope_artifact")
    if not isinstance(cipher_meta, dict) or not isinstance(envelope_meta, dict):
        raise HandoffError("preflight_artifact_metadata_missing")
    if cipher_meta.get("size_in_bytes") != cipher_bytes:
        raise HandoffError("preflight_ciphertext_size_mismatch")

    sv = _validated_source_verification(
        source_verification,
        run_id=pf["run_id"],
        head_sha=pf["head_sha"],
        ciphertext_sha=cipher_sha,
        ciphertext_bytes=cipher_bytes,
        envelope_receipt_sha=envelope_sha,
    )

    core = {
        "schema": HANDOFF_SCHEMA,
        "classification": HANDOFF_CLASSIFICATION,
        "source": {
            "run_id": pf["run_id"],
            "head_sha": pf["head_sha"],
            "workflow_path": EXPECTED_SOURCE_WORKFLOW_PATH,
            "preflight_sha256": pf["preflight_sha256"],
            "ciphertext_sha256": cipher_sha,
            "ciphertext_bytes": cipher_bytes,
            "envelope_receipt_sha256": envelope_sha,
            "source_verification_artifact": artifact,
            "source_verification_receipt_sha256": sv["verification_receipt_sha256"],
            "predicate_sha256": sv["predicate_sha256"],
            "semantic_head_at_source": sv["semantic_head_at_source"],
            "canonical_digest_at_source": sv["canonical_digest_at_source"],
            "migration_ledger_sha256": sv["migration_ledger_sha256"],
        },
        "source_attestation_verified": True,
        "provider_credentials_eligible_after_environment_and_readiness_gates": True,
        "provider_execution_authorized": False,
        "final_r2_evidence_binding_required": True,
        "canonical": False,
        "authority_effect": False,
        "r2_proven": False,
        "r3_proven": False,
        "persisted_seal_allowed": False,
    }
    out = dict(core)
    out["handoff_sha256"] = _sha256_json(core)
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--preflight", required=True)
    p.add_argument("--artifacts", required=True)
    p.add_argument("--source-verification-artifact-id", required=True, type=int)
    p.add_argument("--source-verification", required=True)
    p.add_argument("--ciphertext", required=True)
    p.add_argument("--envelope-receipt", required=True)
    p.add_argument("--output", required=True)
    a = p.parse_args(argv)
    try:
        result = validate_handoff(
            preflight=_read_json(Path(a.preflight), "preflight"),
            artifacts=_read_json(Path(a.artifacts), "artifacts"),
            source_verification_artifact_id=a.source_verification_artifact_id,
            source_verification=_read_json(Path(a.source_verification), "source_verification"),
            ciphertext=Path(a.ciphertext),
            envelope_receipt=Path(a.envelope_receipt),
        )
        _write_json(Path(a.output), result)
        return 0
    except HandoffError as exc:
        print(f"R1_VERIFIED_SOURCE_HANDOFF_REJECTED:{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
