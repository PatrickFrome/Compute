#!/usr/bin/env python3
"""Fail-closed GitHub persisted peer-review ingestion for H205F22.

Consumes the GitHub Pull Request reviews API JSON, extracts an exact structured
ChatGPT v2 review receipt from a fenced JSON block (or an all-JSON body),
validates it against a composite execution subject, and emits a credential-free
receipt. Distinct valid reviews for the same subject conflict; exact duplicate
review roots are idempotent replays.

PREPARE_ONLY: this module grants no project/canonical authority.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

import peer_review_barrier

REVIEW_SCHEMA = "metaengine.compute.sync-peer-review.h205f22.v2"
INGEST_SCHEMA = "metaengine.compute.sync-github-review-ingest.h205f22.v1"
JSON_FENCE_RE = re.compile(r"```json\s*(\{.*?\})\s*```", re.DOTALL | re.IGNORECASE)


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _extract_review(body: Any) -> dict[str, Any] | None:
    if not isinstance(body, str) or not body.strip():
        return None
    stripped = body.strip()
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError:
        parsed = None
    if isinstance(parsed, dict) and parsed.get("schema") == REVIEW_SCHEMA:
        return parsed

    matches = JSON_FENCE_RE.findall(body)
    candidates: list[dict[str, Any]] = []
    for raw in matches:
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and value.get("schema") == REVIEW_SCHEMA:
            candidates.append(value)
    if len(candidates) > 1:
        raise ValueError("MULTIPLE_STRUCTURED_REVIEWS_IN_GITHUB_BODY")
    return candidates[0] if candidates else None


def select_chatgpt_review(github_reviews: list[dict[str, Any]], execution_subject: dict[str, Any]) -> dict[str, Any]:
    peer_review_barrier.validate_subject(execution_subject)
    if not isinstance(github_reviews, list):
        raise ValueError("GitHub reviews payload must be an array")

    subject_sha = execution_subject["execution_subject_sha256"]
    valid: list[tuple[dict[str, Any], dict[str, Any], str]] = []
    malformed_for_subject = False

    for raw in github_reviews:
        if not isinstance(raw, dict):
            continue
        review = _extract_review(raw.get("body"))
        if review is None:
            continue
        digest = ((review.get("subject") or {}).get("digest") or {}).get("sha256")
        if digest != subject_sha:
            continue
        try:
            peer_review_barrier.validate_review(review, execution_subject)
        except (KeyError, TypeError, ValueError):
            malformed_for_subject = True
            continue
        if review.get("reviewer") != "chatgpt":
            malformed_for_subject = True
            continue
        root = canonical_hash(review)
        valid.append((raw, review, root))

    if malformed_for_subject:
        raise ValueError("MALFORMED_CHATGPT_REVIEW_FOR_CURRENT_SUBJECT")
    if not valid:
        raise ValueError("CHATGPT_REVIEW_NOT_FOUND_FOR_CURRENT_SUBJECT")

    roots = {root for _, _, root in valid}
    if len(roots) != 1:
        raise ValueError("CONFLICTING_CHATGPT_REVIEWS_FOR_CURRENT_SUBJECT")

    def order_key(item: tuple[dict[str, Any], dict[str, Any], str]) -> tuple[str, str]:
        raw = item[0]
        return (str(raw.get("submitted_at") or ""), str(raw.get("id") or ""))

    valid.sort(key=order_key)
    selected_raw, selected_review, review_root = valid[-1]
    source_ids = [str(raw.get("id") or "") for raw, _, _ in valid]

    neutral = {
        "reviewer": "chatgpt",
        "execution_subject_sha256": subject_sha,
        "task_id": execution_subject["task_id"],
        "sync_epoch_sha256": execution_subject["sync_epoch_sha256"],
        "review_sha256": review_root,
        "review_id": selected_review["review_id"],
        "disposition": selected_review["disposition"],
        "blocking_finding_count": sum(
            1 for f in selected_review.get("findings", []) if f.get("severity") in {"HIGH", "CRIT"}
        ),
        "github_review_id": str(selected_raw.get("id") or ""),
        "github_review_state": str(selected_raw.get("state") or ""),
        "github_submitted_at": str(selected_raw.get("submitted_at") or ""),
        "idempotent_replay_count": len(valid) - 1,
        "idempotent_github_review_ids": source_ids,
        "identity_source": "GITHUB_PERSISTED_REVIEW_API_BYTES",
    }
    return {
        "schema": INGEST_SCHEMA,
        "evidence_class": "LIVE_GITHUB_PEER_REVIEW_INGESTED_NON_AUTHORITY",
        **neutral,
        "ingest_sha256": canonical_hash(neutral),
        "review": selected_review,
        "authority": {
            "authority_effect": False,
            "canonical": False,
            "project_claim_authority": False,
        },
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--github-reviews", required=True)
    p.add_argument("--execution-subject", required=True)
    p.add_argument("--output", required=True)
    args = p.parse_args()
    reviews = json.loads(Path(args.github_reviews).read_text(encoding="utf-8"))
    subject = json.loads(Path(args.execution_subject).read_text(encoding="utf-8"))
    if not isinstance(reviews, list) or not isinstance(subject, dict):
        raise ValueError("invalid input JSON shapes")
    receipt = select_chatgpt_review(reviews, subject)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(receipt, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": "PASS",
        "reviewer": "chatgpt",
        "execution_subject_sha256": receipt["execution_subject_sha256"],
        "review_sha256": receipt["review_sha256"],
        "disposition": receipt["disposition"],
        "authority_effect": False,
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
