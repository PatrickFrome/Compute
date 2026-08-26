#!/usr/bin/env python3
"""Fail-closed receipt for cryptographically verified W1 prep attestations.

Input is the deterministic W1 prep manifest plus JSON emitted by
`gh attestation verify --format json` under the strict repo/workflow/source
policy.  The receipt relies only on verified certificate/timestamp/statement
fields and remains non-authority with respect to W1 admission.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import re
from typing import Any

from controller.w1 import build_w1_prep_attestation_manifest as prep_manifest

SCHEMA = "metaengine.compute.w1-attestation-verification-receipt.h205f22.v1"
STATUS = "ATTESTATION_VERIFIED_NONAUTHORITY"
PREDICATE = "https://slsa.dev/provenance/v1"
OIDC_ISSUER = "https://token.actions.githubusercontent.com"
REKOR_URI = "https://rekor.sigstore.dev"
EXPECTED_REPOSITORY = "PatrickFrome/Compute"
EXPECTED_WORKFLOW_PATH = ".github/workflows/w1-prep-artifact-attestation.yml"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def manifest_file_bytes(manifest: dict[str, Any]) -> bytes:
    prep_manifest.validate_manifest(manifest)
    return (json.dumps(manifest, sort_keys=True, indent=2) + "\n").encode("utf-8")


def _sha(value: Any, label: str) -> str:
    if not isinstance(value, str) or not SHA256_RE.fullmatch(value):
        raise ValueError(f"invalid {label}")
    return value


def _utc_timestamp(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise ValueError(f"invalid {label}")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise ValueError(f"invalid {label}") from exc
    if parsed.utcoffset() != timezone.utc.utcoffset(parsed):
        raise ValueError(f"invalid {label}")
    return value


def compose(*, manifest: dict[str, Any], verification: Any) -> dict[str, Any]:
    prep_manifest.validate_manifest(manifest)
    if not isinstance(verification, list) or len(verification) != 1:
        raise ValueError("exactly one verified attestation is required")
    item = verification[0]
    if not isinstance(item, dict):
        raise ValueError("attestation verification item must be object")
    result = item.get("verificationResult")
    if not isinstance(result, dict):
        raise ValueError("verificationResult missing")

    source = manifest["evidence"]["source"]
    git_sha = source["git_sha"]
    source_ref = source["ref"]
    expected_san = f"https://github.com/{EXPECTED_REPOSITORY}/{EXPECTED_WORKFLOW_PATH}@{source_ref}"
    expected_signer = f"https://github.com/{EXPECTED_REPOSITORY}/{EXPECTED_WORKFLOW_PATH}@{source_ref}"
    expected_source_uri = f"https://github.com/{EXPECTED_REPOSITORY}"
    expected_dep_uri = f"git+https://github.com/{EXPECTED_REPOSITORY}@{source_ref}"

    signature = result.get("signature") or {}
    cert = signature.get("certificate") or {}
    immutable_cert_checks = {
        "oidc_issuer": cert.get("issuer") == OIDC_ISSUER,
        "signer_san": cert.get("subjectAlternativeName") == expected_san,
        "workflow_repo": cert.get("githubWorkflowRepository") == EXPECTED_REPOSITORY,
        "workflow_sha": cert.get("githubWorkflowSHA") == git_sha,
        "workflow_ref": cert.get("githubWorkflowRef") == source_ref,
        "build_signer_uri": cert.get("buildSignerURI") == expected_signer,
        "build_signer_digest": cert.get("buildSignerDigest") == git_sha,
        "runner_github_hosted": cert.get("runnerEnvironment") == "github-hosted",
        "source_repo_uri": cert.get("sourceRepositoryURI") == expected_source_uri,
        "source_repo_digest": cert.get("sourceRepositoryDigest") == git_sha,
        "source_repo_ref": cert.get("sourceRepositoryRef") == source_ref,
        "source_visibility_public": cert.get("sourceRepositoryVisibilityAtSigning") == "public",
        "build_config_digest": cert.get("buildConfigDigest") == git_sha,
    }
    failures = [k for k, ok in immutable_cert_checks.items() if not ok]
    if failures:
        raise ValueError(f"attestation certificate identity mismatch: {failures}")

    verified_identity = result.get("verifiedIdentity") or {}
    if verified_identity.get("runnerEnvironment") != "github-hosted":
        raise ValueError("verified identity is not github-hosted")

    timestamps = result.get("verifiedTimestamps")
    if not isinstance(timestamps, list) or not timestamps:
        raise ValueError("verified timestamp evidence required")
    tlog = None
    for ts in timestamps:
        if isinstance(ts, dict) and ts.get("type") == "Tlog" and ts.get("uri") == REKOR_URI:
            _utc_timestamp(ts.get("timestamp"), "Rekor timestamp")
            tlog = ts
            break
    if tlog is None:
        raise ValueError("verified Rekor transparency timestamp required")

    statement = result.get("statement") or {}
    if statement.get("_type") != "https://in-toto.io/Statement/v1":
        raise ValueError("in-toto statement v1 required")
    if statement.get("predicateType") != PREDICATE:
        raise ValueError("SLSA provenance v1 predicate required")
    subject = statement.get("subject")
    if not isinstance(subject, list) or len(subject) != 1:
        raise ValueError("exactly one attested subject required")
    subject_item = subject[0]
    if not isinstance(subject_item, dict) or subject_item.get("name") != "w1-prep-attestation-manifest.json":
        raise ValueError("unexpected attested subject name")
    subject_sha = _sha(((subject_item.get("digest") or {}).get("sha256")), "attested subject sha256")
    local_subject_sha = hashlib.sha256(manifest_file_bytes(manifest)).hexdigest()
    if subject_sha != local_subject_sha:
        raise ValueError("attested subject digest does not match manifest bytes")

    predicate = statement.get("predicate") or {}
    build = predicate.get("buildDefinition") or {}
    external = build.get("externalParameters") or {}
    workflow = external.get("workflow") or {}
    if workflow.get("repository") != expected_source_uri or workflow.get("path") != EXPECTED_WORKFLOW_PATH or workflow.get("ref") != source_ref:
        raise ValueError("attested workflow definition mismatch")
    deps = build.get("resolvedDependencies")
    if not isinstance(deps, list) or len(deps) != 1:
        raise ValueError("exact source dependency required")
    dep = deps[0]
    if dep.get("uri") != expected_dep_uri or ((dep.get("digest") or {}).get("gitCommit")) != git_sha:
        raise ValueError("attested source dependency mismatch")

    evidence = {
        "repository": EXPECTED_REPOSITORY,
        "workflow_path": EXPECTED_WORKFLOW_PATH,
        "source_git_sha": git_sha,
        "source_tree_sha": source["tree_sha"],
        "source_ref": source_ref,
        "manifest_evidence_sha256": manifest["evidence_sha256"],
        "manifest_subject_sha256": subject_sha,
        "predicate_type": PREDICATE,
        "oidc_issuer": OIDC_ISSUER,
        "runner_environment": "github-hosted",
        "rekor_uri": REKOR_URI,
        "rekor_timestamp": tlog["timestamp"],
        "verified_timestamp_count": len(timestamps),
        "immutable_certificate_checks": immutable_cert_checks,
    }
    return {
        "schema": SCHEMA,
        "status": STATUS,
        "evidence": evidence,
        "receipt_sha256": canonical_hash(evidence),
        "artifact_attestation_verified": True,
        "cryptographic_source_provenance_verified": True,
        "runtime_safety_verified": False,
        "provider_lifecycle_verified": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
        "next_required": [
            "cross_bind_attestation_receipt_to_w1_supervisor_candidate",
            "fresh_w1_authority_before_live_execution",
        ],
    }
