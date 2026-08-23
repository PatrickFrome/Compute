#!/usr/bin/env python3
"""Build a deterministic immutable evidence bundle for H205F22 sync work.

The bundle is a byte-stable tar archive containing validated credential-free
receipts plus a manifest and an in-toto-shaped internal statement. GitHub's
Sigstore-backed artifact attestation signs the resulting tar as a separate
step; neither this builder nor an attestation grants project authority.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import tarfile
from pathlib import Path
from typing import Any

from coordination.sync import schema_version_policy

BUNDLE_SCHEMA = "metaengine.compute.sync-evidence-bundle.h205f22.v1"
PREDICATE_SCHEMA = "metaengine.compute.sync-evidence-predicate.h205f22.v1"
STATEMENT_TYPE = "https://in-toto.io/Statement/v1"
PREDICATE_TYPE = "https://metaengine.dev/attestation/sync-evidence/v1"


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8") + b"\n"


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def canonical_hash(value: Any) -> str:
    return sha256_bytes(canonical_bytes(value).rstrip(b"\n"))


def load_json(path: str | Path) -> dict[str, Any]:
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path}: expected JSON object")
    return value


def require_non_authority(value: dict[str, Any], label: str) -> None:
    authority = value.get("authority") or {}
    for key in ("authority_effect", "canonical"):
        if authority.get(key) is not False:
            raise ValueError(f"{label}: authority.{key} must be false")
    if "project_claim_authority" in authority and authority.get("project_claim_authority") is not False:
        raise ValueError(f"{label}: project_claim_authority must be false")
    if "w1_verified" in authority and authority.get("w1_verified") is not False:
        raise ValueError(f"{label}: w1_verified must be false")


def barrier_neutral(barrier: dict[str, Any]) -> dict[str, Any]:
    keys = (
        "task_id", "execution_subject_sha256", "task_result_sha256", "task_sha256",
        "sync_epoch_sha256", "git_sha", "tree_sha", "execution_contract_sha256",
        "provider_neutral_result_sha256", "review_roots", "outcome", "blocking_finding_ids",
    )
    return {key: barrier[key] for key in keys}


def validate_inputs(execution_subject: dict[str, Any], cross: dict[str, Any],
                    chatgpt_ingest: dict[str, Any], glm_ingest: dict[str, Any],
                    barrier: dict[str, Any]) -> dict[str, Any]:
    if execution_subject.get("schema") != "metaengine.compute.sync-execution-subject.h205f22.v1":
        raise ValueError("unsupported execution subject schema")
    if cross.get("schema") != "metaengine.compute.a1.cross-provider-readback.h205f22.v1":
        raise ValueError("unsupported cross-provider schema")
    if chatgpt_ingest.get("schema") != "metaengine.compute.sync-github-review-ingest.h205f22.v1":
        raise ValueError("unsupported ChatGPT ingest schema")
    if glm_ingest.get("schema") != "metaengine.compute.sync-pap-review-ingest.h205f22.v1":
        raise ValueError("unsupported GLM ingest schema")
    if barrier.get("schema") != "metaengine.compute.sync-peer-review-barrier.h205f22.v2":
        raise ValueError("unsupported barrier schema")

    for label, value in (
        ("execution-subject", execution_subject), ("cross-provider", cross),
        ("chatgpt-ingest", chatgpt_ingest), ("glm-ingest", glm_ingest), ("barrier", barrier),
    ):
        require_non_authority(value, label)

    if cross.get("evidence_class") != "CROSS_PROVIDER_REPRODUCED_VERIFIED":
        raise ValueError("cross-provider evidence is not VERIFIED")
    if cross.get("identity_source") != "PERSISTED_APPVEYOR_ARTIFACT_BYTES":
        raise ValueError("cross-provider identity must come from persisted AppVeyor bytes")
    if cross.get("providers") != ["github-actions", "appveyor"]:
        raise ValueError("unexpected provider quorum")
    if execution_subject.get("cross_provider_evidence_class") != "CROSS_PROVIDER_REPRODUCED_VERIFIED":
        raise ValueError("execution subject lacks cross-provider verification")

    subject_sha = execution_subject.get("execution_subject_sha256")
    if barrier.get("execution_subject_sha256") != subject_sha:
        raise ValueError("barrier execution subject mismatch")
    if barrier.get("outcome") != "PEER_REVIEW_COMPLETE":
        raise ValueError("peer-review barrier is not complete")
    if barrier.get("blocking_finding_ids") != []:
        raise ValueError("blocking finding ids must be empty")
    if canonical_hash(barrier_neutral(barrier)) != barrier.get("barrier_sha256"):
        raise ValueError("barrier_sha256 mismatch")

    for key in ("task_id", "task_result_sha256", "task_sha256", "sync_epoch_sha256",
                "git_sha", "tree_sha", "execution_contract_sha256", "provider_neutral_result_sha256"):
        if barrier.get(key) != execution_subject.get(key):
            raise ValueError(f"barrier/subject mismatch: {key}")

    if chatgpt_ingest.get("identity_source") != "GITHUB_PERSISTED_REVIEW_API_BYTES":
        raise ValueError("ChatGPT identity source mismatch")
    if glm_ingest.get("identity_source") != "PAP_PERSISTED_READ_BYTES":
        raise ValueError("GLM identity source mismatch")
    for label, ingest in (("chatgpt", chatgpt_ingest), ("glm", glm_ingest)):
        if ingest.get("execution_subject_sha256") != subject_sha:
            raise ValueError(f"{label} ingest subject mismatch")
        if ingest.get("disposition") != "ACCEPT":
            raise ValueError(f"{label} review is not ACCEPT")
        if ingest.get("blocking_finding_count") != 0:
            raise ValueError(f"{label} ingest contains blocking findings")

    roots = barrier.get("review_roots") or {}
    if roots != {
        "chatgpt": chatgpt_ingest.get("review_sha256"),
        "glm": glm_ingest.get("review_sha256"),
    }:
        raise ValueError("barrier review roots do not match persisted ingests")

    root_map = cross.get("roots") or {}
    expected_roots = {
        "git_sha": execution_subject.get("git_sha"),
        "tree_sha": execution_subject.get("tree_sha"),
        "contract_sha256": execution_subject.get("execution_contract_sha256"),
        "provider_neutral_result_sha256": execution_subject.get("provider_neutral_result_sha256"),
    }
    if {key: root_map.get(key) for key in expected_roots} != expected_roots:
        raise ValueError("cross-provider roots do not match execution subject")

    binding = schema_version_policy.validate_historical_binding(
        execution_subject["task_id"],
        execution_subject_sha256=subject_sha,
        barrier_sha256=barrier["barrier_sha256"],
        outcome=barrier["outcome"],
    )
    verified_validators = schema_version_policy.verify_validator_files(execution_subject["task_id"])
    return {
        **binding,
        "validator_bytes_verified": True,
        "verified_validators": verified_validators,
    }


def _member_record(name: str, data: bytes) -> dict[str, Any]:
    return {"name": name, "sha256": sha256_bytes(data), "size_bytes": len(data)}


def _write_deterministic_tar(path: Path, members: dict[str, bytes]) -> None:
    with tarfile.open(path, "w", format=tarfile.PAX_FORMAT) as archive:
        for name in sorted(members):
            data = members[name]
            info = tarfile.TarInfo(name=name)
            info.size = len(data)
            info.mtime = 0
            info.uid = 0
            info.gid = 0
            info.uname = ""
            info.gname = ""
            info.mode = 0o644
            archive.addfile(info, io.BytesIO(data))


def build_bundle(*, execution_subject: dict[str, Any], cross: dict[str, Any],
                 chatgpt_ingest: dict[str, Any], glm_ingest: dict[str, Any],
                 barrier: dict[str, Any], output_dir: Path,
                 bundle_name: str = "h205f22-sync-l47-002-evidence.tar") -> dict[str, Any]:
    binding = validate_inputs(execution_subject, cross, chatgpt_ingest, glm_ingest, barrier)
    policy = schema_version_policy.policy_record()

    predicate = {
        "schema": PREDICATE_SCHEMA,
        "evidence_class": "EVIDENCE_READY_NON_AUTHORITY",
        "task_id": execution_subject["task_id"],
        "execution_subject_sha256": execution_subject["execution_subject_sha256"],
        "barrier_sha256": barrier["barrier_sha256"],
        "review_roots": barrier["review_roots"],
        "review_identity_sources": {
            "chatgpt": chatgpt_ingest["identity_source"],
            "glm": glm_ingest["identity_source"],
        },
        "cross_provider_identity_source": cross["identity_source"],
        "validator_binding": binding,
        "schema_policy_sha256": policy["policy_sha256"],
        "authority": {
            "authority_effect": False,
            "canonical": False,
            "project_claim_authority": False,
            "persistent_worker_proof": False,
            "w1_verified": False,
        },
    }
    statement = {
        "_type": STATEMENT_TYPE,
        "subject": [{
            "name": f"{execution_subject['task_id']}/execution-subject",
            "digest": {"sha256": execution_subject["execution_subject_sha256"]},
        }],
        "predicateType": PREDICATE_TYPE,
        "predicate": predicate,
    }

    members: dict[str, bytes] = {
        "barrier.json": canonical_bytes(barrier),
        "chatgpt-ingest.json": canonical_bytes(chatgpt_ingest),
        "cross-provider-readback.json": canonical_bytes(cross),
        "evidence-statement.json": canonical_bytes(statement),
        "execution-subject.json": canonical_bytes(execution_subject),
        "glm-ingest.json": canonical_bytes(glm_ingest),
        "schema-version-policy.json": canonical_bytes(policy),
    }
    member_records = [_member_record(name, members[name]) for name in sorted(members)]
    manifest_neutral = {
        "schema": BUNDLE_SCHEMA,
        "format_version": 1,
        "task_id": execution_subject["task_id"],
        "evidence_class": "EVIDENCE_READY_NON_AUTHORITY",
        "execution_subject_sha256": execution_subject["execution_subject_sha256"],
        "barrier_sha256": barrier["barrier_sha256"],
        "members": member_records,
        "deterministic_archive": {
            "format": "ustar-compatible-pax",
            "sorted_members": True,
            "mtime": 0,
            "uid": 0,
            "gid": 0,
            "mode": "0644",
        },
        "authority": {
            "authority_effect": False,
            "canonical": False,
            "project_claim_authority": False,
            "persistent_worker_proof": False,
            "w1_verified": False,
        },
    }
    manifest = {**manifest_neutral, "manifest_sha256": canonical_hash(manifest_neutral)}
    members["manifest.json"] = canonical_bytes(manifest)

    output_dir.mkdir(parents=True, exist_ok=True)
    bundle_path = output_dir / bundle_name
    _write_deterministic_tar(bundle_path, members)
    bundle_sha = sha256_bytes(bundle_path.read_bytes())

    receipt_neutral = {
        "schema": "metaengine.compute.sync-evidence-bundle-receipt.h205f22.v1",
        "task_id": execution_subject["task_id"],
        "evidence_class": "EVIDENCE_READY_NON_AUTHORITY",
        "bundle_name": bundle_name,
        "bundle_sha256": bundle_sha,
        "manifest_sha256": manifest["manifest_sha256"],
        "execution_subject_sha256": execution_subject["execution_subject_sha256"],
        "barrier_sha256": barrier["barrier_sha256"],
        "authority_effect": False,
        "canonical": False,
        "project_claim_authority": False,
        "persistent_worker_proof": False,
        "w1_verified": False,
    }
    receipt = {**receipt_neutral, "receipt_sha256": canonical_hash(receipt_neutral)}
    (output_dir / "bundle-receipt.json").write_bytes(canonical_bytes(receipt))
    (output_dir / "manifest.json").write_bytes(canonical_bytes(manifest))
    (output_dir / "evidence-statement.json").write_bytes(canonical_bytes(statement))
    (output_dir / "schema-version-policy.json").write_bytes(canonical_bytes(policy))
    return receipt


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--execution-subject", required=True)
    p.add_argument("--cross-provider-readback", required=True)
    p.add_argument("--chatgpt-ingest", required=True)
    p.add_argument("--glm-ingest", required=True)
    p.add_argument("--barrier", required=True)
    p.add_argument("--output-dir", required=True)
    p.add_argument("--bundle-name", default="h205f22-sync-l47-002-evidence.tar")
    args = p.parse_args()
    receipt = build_bundle(
        execution_subject=load_json(args.execution_subject),
        cross=load_json(args.cross_provider_readback),
        chatgpt_ingest=load_json(args.chatgpt_ingest),
        glm_ingest=load_json(args.glm_ingest),
        barrier=load_json(args.barrier),
        output_dir=Path(args.output_dir),
        bundle_name=args.bundle_name,
    )
    print(json.dumps({
        "status": "PASS",
        "bundle_sha256": receipt["bundle_sha256"],
        "receipt_sha256": receipt["receipt_sha256"],
        "evidence_class": receipt["evidence_class"],
        "authority_effect": False,
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
