#!/usr/bin/env python3
"""Composite-digest GPT↔GLM peer-review barrier for H205F22.

A v2 review is about an exact cross-provider execution subject, not merely a
task-result digest. The subject binds task result, Git SHA, tree SHA, execution
contract and provider-neutral result. Unknown fields and stale/different roots
fail closed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

SHA256_LEN = 64
REVIEWERS = {"chatgpt", "glm"}
SEVERITIES = {"INFO", "LOW", "MED", "HIGH", "CRIT"}
DISPOSITIONS = {"ACCEPT", "CHANGES_REQUIRED"}
TOP_KEYS = {
    "schema", "review_id", "reviewer", "subject", "external_parameters",
    "review_kind", "disposition", "findings", "authority_effect", "canonical",
}
SUBJECT_KEYS = {"name", "digest"}
EXTERNAL_KEYS = {"task_sha256", "sync_epoch_sha256"}
FINDING_KEYS = {"finding_id", "severity", "invariant", "evidence_ref"}


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return hashlib.sha256(raw).hexdigest()


def _sha(value: Any, label: str) -> str:
    value = str(value or "").lower()
    if len(value) != SHA256_LEN or any(c not in "0123456789abcdef" for c in value):
        raise ValueError(f"invalid {label}")
    return value


def validate_subject(subject: dict[str, Any]) -> None:
    if subject.get("schema") != "metaengine.compute.sync-execution-subject.h205f22.v1":
        raise ValueError("unsupported execution-subject schema")
    authority = subject.get("authority") or {}
    if any(authority.get(k) is not False for k in ("authority_effect", "canonical", "execution_authority", "project_claim_authority")):
        raise ValueError("execution subject must be non-authority")
    for key in ("task_result_sha256", "task_sha256", "sync_epoch_sha256", "execution_contract_sha256", "provider_neutral_result_sha256", "execution_subject_sha256"):
        _sha(subject.get(key), key)
    for key in ("git_sha", "tree_sha"):
        value = str(subject.get(key) or "").lower()
        if len(value) != 40 or any(c not in "0123456789abcdef" for c in value):
            raise ValueError(f"invalid {key}")
    if subject.get("cross_provider_evidence_class") != "CROSS_PROVIDER_REPRODUCED_VERIFIED":
        raise ValueError("execution subject is not cross-provider VERIFIED")
    if subject.get("identity_source") != "PERSISTED_APPVEYOR_ARTIFACT_BYTES":
        raise ValueError("execution subject lacks persisted AppVeyor identity")

    neutral = {
        "task_id": subject["task_id"],
        "task_result_sha256": subject["task_result_sha256"],
        "task_sha256": subject["task_sha256"],
        "sync_epoch_sha256": subject["sync_epoch_sha256"],
        "git_sha": subject["git_sha"],
        "tree_sha": subject["tree_sha"],
        "execution_contract_sha256": subject["execution_contract_sha256"],
        "provider_neutral_result_sha256": subject["provider_neutral_result_sha256"],
        "cross_provider_evidence_class": subject["cross_provider_evidence_class"],
        "identity_source": subject["identity_source"],
    }
    if canonical_hash(neutral) != subject["execution_subject_sha256"]:
        raise ValueError("execution_subject_sha256 mismatch")


def validate_review(review: dict[str, Any], execution_subject: dict[str, Any]) -> None:
    if set(review) != TOP_KEYS:
        raise ValueError(f"review keys mismatch: {sorted(set(review) ^ TOP_KEYS)}")
    if review["schema"] != "metaengine.compute.sync-peer-review.h205f22.v2":
        raise ValueError("unsupported peer-review schema")
    if review["reviewer"] not in REVIEWERS:
        raise ValueError("unknown reviewer identity")
    if review["review_kind"] != "REVIEW":
        raise ValueError("unsupported review_kind")
    if review["disposition"] not in DISPOSITIONS:
        raise ValueError("unsupported disposition")
    if review["authority_effect"] is not False or review["canonical"] is not False:
        raise ValueError("peer review must be non-authority")

    subject = review["subject"]
    if not isinstance(subject, dict) or set(subject) != SUBJECT_KEYS:
        raise ValueError("subject keys mismatch")
    digest = subject["digest"]
    if not isinstance(digest, dict) or set(digest) != {"sha256"}:
        raise ValueError("subject digest must contain only sha256")
    if subject["name"] != execution_subject.get("task_id"):
        raise ValueError("review subject task_id mismatch")
    if _sha(digest["sha256"], "subject sha256") != _sha(execution_subject.get("execution_subject_sha256"), "execution subject sha256"):
        raise ValueError("review subject digest mismatch")

    external = review["external_parameters"]
    if not isinstance(external, dict) or set(external) != EXTERNAL_KEYS:
        raise ValueError("external_parameters keys mismatch")
    if _sha(external["task_sha256"], "task sha256") != _sha(execution_subject.get("task_sha256"), "subject task sha256"):
        raise ValueError("review task_sha256 mismatch")
    if _sha(external["sync_epoch_sha256"], "sync epoch sha256") != _sha(execution_subject.get("sync_epoch_sha256"), "subject sync epoch sha256"):
        raise ValueError("review sync_epoch_sha256 mismatch")

    findings = review["findings"]
    if not isinstance(findings, list):
        raise ValueError("findings must be a list")
    ids: set[str] = set()
    for finding in findings:
        if not isinstance(finding, dict) or set(finding) != FINDING_KEYS:
            raise ValueError("finding keys mismatch")
        fid = str(finding["finding_id"])
        if not fid or fid in ids:
            raise ValueError("finding ids must be non-empty and unique per review")
        ids.add(fid)
        if finding["severity"] not in SEVERITIES:
            raise ValueError("unsupported finding severity")
        if not str(finding["invariant"]):
            raise ValueError("finding invariant missing")
        if not str(finding["evidence_ref"]):
            raise ValueError("finding evidence_ref missing")

    blocking = [f for f in findings if f["severity"] in {"HIGH", "CRIT"}]
    if blocking and review["disposition"] != "CHANGES_REQUIRED":
        raise ValueError("HIGH/CRIT finding requires CHANGES_REQUIRED")


def evaluate(execution_subject: dict[str, Any], reviews: list[dict[str, Any]]) -> dict[str, Any]:
    validate_subject(execution_subject)
    if len(reviews) != 2:
        raise ValueError("exactly two independent reviews required")
    for review in reviews:
        validate_review(review, execution_subject)
    identities = {r["reviewer"] for r in reviews}
    if identities != REVIEWERS:
        raise ValueError("reviews must contain exactly chatgpt and glm")

    findings = [{"reviewer": r["reviewer"], **f} for r in reviews for f in r["findings"]]
    blocking = [f for f in findings if f["severity"] in {"HIGH", "CRIT"}]
    changes_required = any(r["disposition"] == "CHANGES_REQUIRED" for r in reviews)
    outcome = "FIX_REQUIRED" if (blocking or changes_required) else "PEER_REVIEW_COMPLETE"
    review_roots = {r["reviewer"]: canonical_hash(r) for r in sorted(reviews, key=lambda x: x["reviewer"])}
    neutral = {
        "task_id": execution_subject["task_id"],
        "execution_subject_sha256": execution_subject["execution_subject_sha256"],
        "task_result_sha256": execution_subject["task_result_sha256"],
        "task_sha256": execution_subject["task_sha256"],
        "sync_epoch_sha256": execution_subject["sync_epoch_sha256"],
        "git_sha": execution_subject["git_sha"],
        "tree_sha": execution_subject["tree_sha"],
        "execution_contract_sha256": execution_subject["execution_contract_sha256"],
        "provider_neutral_result_sha256": execution_subject["provider_neutral_result_sha256"],
        "review_roots": review_roots,
        "outcome": outcome,
        "blocking_finding_ids": sorted(f["finding_id"] for f in blocking),
    }
    return {
        "schema": "metaengine.compute.sync-peer-review-barrier.h205f22.v2",
        **neutral,
        "barrier_sha256": canonical_hash(neutral),
        "findings": findings,
        "authority": {"authority_effect": False, "canonical": False, "project_claim_authority": False},
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--execution-subject", required=True)
    p.add_argument("--review", action="append", required=True)
    p.add_argument("--output", required=True)
    args = p.parse_args()
    execution_subject = json.loads(Path(args.execution_subject).read_text())
    reviews = [json.loads(Path(path).read_text()) for path in args.review]
    receipt = evaluate(execution_subject, reviews)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(receipt, sort_keys=True, indent=2) + "\n")
    print(json.dumps({"outcome": receipt["outcome"], "barrier_sha256": receipt["barrier_sha256"], "authority_effect": False}, sort_keys=True))
    return 0 if receipt["outcome"] == "PEER_REVIEW_COMPLETE" else 2


if __name__ == "__main__":
    raise SystemExit(main())
