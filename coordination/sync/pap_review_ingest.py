#!/usr/bin/env python3
"""Fail-closed persisted PAP peer-review ingestion for H205F22.

Consumes the JSON returned by GET /pap/read?peer=glm, extracts a structured
GLM v2 peer-review receipt, validates it against an exact composite execution
subject, and emits a credential-free ingestion receipt.

The PAP bearer token and raw peer payload are intentionally outside the output
surface. Exact duplicate review roots are idempotent replays; distinct valid
reviews for the same execution subject are treated as a conflict and fail
closed rather than letting a later ACCEPT erase an earlier different review.

PREPARE_ONLY: this module grants no project/canonical authority.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import peer_review_barrier

PAP_SCHEMA = "metaengine.agent-message.h205f22.v1"
REVIEW_SCHEMA = "metaengine.compute.sync-peer-review.h205f22.v2"
INGEST_SCHEMA = "metaengine.compute.sync-pap-review-ingest.h205f22.v1"


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _extract_review(envelope: dict[str, Any]) -> dict[str, Any] | None:
    """Return only a structured review object; never interpret prose as a review."""
    embedded = envelope.get("peer_review_receipt")
    if isinstance(embedded, dict):
        return embedded

    # Compatibility for peers that serialize the exact receipt as JSON in
    # content. Markdown/fenced/prose content is deliberately not parsed.
    content = envelope.get("content")
    if isinstance(content, str):
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:
            return None
        if isinstance(parsed, dict) and parsed.get("schema") == REVIEW_SCHEMA:
            return parsed
    return None


def _validate_outer(envelope: dict[str, Any]) -> None:
    if envelope.get("schema") != PAP_SCHEMA:
        raise ValueError("unsupported PAP envelope schema")
    if envelope.get("from") != "glm" or envelope.get("to") != "chatgpt":
        raise ValueError("PAP envelope identity mismatch")
    if envelope.get("kind") != "REVIEW":
        raise ValueError("PAP envelope kind must be REVIEW")
    if envelope.get("authority_effect") is not False:
        raise ValueError("PAP review must be non-authority")
    if "canonical" in envelope and envelope.get("canonical") is not False:
        raise ValueError("PAP review canonical must be false")
    if not isinstance(envelope.get("id"), str) or not envelope["id"].startswith("glm-"):
        raise ValueError("invalid GLM PAP message id")
    seq = envelope.get("seq")
    if not isinstance(seq, int) or seq < 1:
        raise ValueError("invalid PAP sequence")


def select_glm_review(pap_read: dict[str, Any], execution_subject: dict[str, Any]) -> dict[str, Any]:
    peer_review_barrier.validate_subject(execution_subject)
    if pap_read.get("peer") != "glm":
        raise ValueError("PAP read peer must be glm")
    if pap_read.get("gap_detected") is not False:
        raise ValueError("PAP_SEQUENCE_GAP")
    messages = pap_read.get("messages")
    if not isinstance(messages, list):
        raise ValueError("PAP messages must be a list")

    valid: list[tuple[dict[str, Any], dict[str, Any], str]] = []
    malformed_for_subject = False
    subject_sha = execution_subject["execution_subject_sha256"]

    for raw in messages:
        if not isinstance(raw, dict) or raw.get("kind") != "REVIEW" or raw.get("from") != "glm":
            continue
        review = _extract_review(raw)
        if review is None:
            continue

        # A review for a different composite subject is simply stale/other work.
        digest = ((review.get("subject") or {}).get("digest") or {}).get("sha256")
        if digest != subject_sha:
            continue

        try:
            _validate_outer(raw)
            peer_review_barrier.validate_review(review, execution_subject)
        except (KeyError, TypeError, ValueError):
            malformed_for_subject = True
            continue
        if review.get("reviewer") != "glm":
            malformed_for_subject = True
            continue
        root = canonical_hash(review)
        valid.append((raw, review, root))

    if malformed_for_subject:
        raise ValueError("MALFORMED_GLM_REVIEW_FOR_CURRENT_SUBJECT")
    if not valid:
        raise ValueError("GLM_REVIEW_NOT_FOUND_FOR_CURRENT_SUBJECT")

    roots = {root for _, _, root in valid}
    if len(roots) != 1:
        raise ValueError("CONFLICTING_GLM_REVIEWS_FOR_CURRENT_SUBJECT")

    # Exact duplicate roots are idempotent transport replays. Select the
    # highest persisted sequence while retaining replay metadata only.
    valid.sort(key=lambda item: item[0]["seq"])
    selected_env, selected_review, review_root = valid[-1]
    message_ids = [env["id"] for env, _, _ in valid]
    message_roots = [canonical_hash(env) for env, _, _ in valid]

    neutral = {
        "reviewer": "glm",
        "execution_subject_sha256": subject_sha,
        "task_id": execution_subject["task_id"],
        "sync_epoch_sha256": execution_subject["sync_epoch_sha256"],
        "review_sha256": review_root,
        "review_id": selected_review["review_id"],
        "disposition": selected_review["disposition"],
        "blocking_finding_count": sum(
            1 for f in selected_review.get("findings", []) if f.get("severity") in {"HIGH", "CRIT"}
        ),
        "pap_message_id": selected_env["id"],
        "pap_sequence": selected_env["seq"],
        "pap_message_sha256": canonical_hash(selected_env),
        "idempotent_replay_count": len(valid) - 1,
        "idempotent_message_ids": message_ids,
        "idempotent_message_sha256": message_roots,
        "identity_source": "PAP_PERSISTED_READ_BYTES",
    }
    return {
        "schema": INGEST_SCHEMA,
        "evidence_class": "LIVE_PAP_PEER_REVIEW_INGESTED_NON_AUTHORITY",
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
    p.add_argument("--pap-read", required=True)
    p.add_argument("--execution-subject", required=True)
    p.add_argument("--output", required=True)
    args = p.parse_args()

    pap_read = json.loads(Path(args.pap_read).read_text(encoding="utf-8"))
    subject = json.loads(Path(args.execution_subject).read_text(encoding="utf-8"))
    if not isinstance(pap_read, dict) or not isinstance(subject, dict):
        raise ValueError("inputs must be JSON objects")
    receipt = select_glm_review(pap_read, subject)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(receipt, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": "PASS",
        "reviewer": "glm",
        "execution_subject_sha256": receipt["execution_subject_sha256"],
        "review_sha256": receipt["review_sha256"],
        "disposition": receipt["disposition"],
        "authority_effect": False,
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
